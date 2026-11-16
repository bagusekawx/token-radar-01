// Token Radar's model (radar-2): one sealed snapshot in, one ranked board out.
//
// The board ranks EVERY rankable pre-token protocol in the snapshot: the 40 watchlist slugs (the
// floor, never a ceiling) plus every pre-token protocol below the floor that passes the watchlist's
// own exclusion rule — not a wrapped, staked or bridged product of a token that already trades, not
// an exchange product, not a versioned pool. Protocols whose token already trades are never ranked;
// they are set aside in a Live view with their market caps, and they double as the model's price
// evidence (below).
//
// Implied value is derived only from the snapshot's own figures. The key idea: the snapshot already
// contains the market's price for comparable tokens, so each category's multiple is measured from it
// instead of assumed:
//
//   comps(category) = live-token protocols in the category with a market cap and a TVL
//   catMult         = median(mcap_usd / tvl_usd) over the comps, shrunk toward the global median
//                     when the category has few comps, clamped to [0.05, 1.50]
//   A category needs at least 2 live comps to earn its own multiple; with fewer it uses the
//   global median (a single observation is not a category signal). Each comp's ratio is clamped
//   to [0.005, 5] before the median so one misattributed record cannot set a category's price.
//   growthMult      = 1 + clamp(change_7d, -50, 100) / 100 * 0.40
//   maturityMult    = 0.70 + min(age_days, 730) / 730 * 0.30   (age unknown: 365 days)
//   chainMult       = 1 + 0.05 * min(chains - 1, 4)
//   implied         = max(1, round(tvl_usd * catMult * growthMult * maturityMult * chainMult))
//
// A category with no live comps at all falls back to the global median multiple. No protocol name is
// ever special-cased: the same function scores every row, and the dashboard recomputes each row from
// the same figures so the page's arithmetic and board.json agree.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard's model panel. */
export interface ModelConstants {
  multiple_min: number;
  multiple_max: number;
  comps_for_full_weight: number;
  min_comps_for_category: number;
  ratio_min: number;
  ratio_max: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_steps: number;
}

export const MODEL: ModelConstants = {
  multiple_min: 0.05,
  multiple_max: 1.5,
  comps_for_full_weight: 3,
  min_comps_for_category: 2,
  ratio_min: 0.005,
  ratio_max: 5,
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 730,
  unknown_age_days: 365,
  chain_step: 0.05,
  chain_max_steps: 4,
};

export const MODEL_VERSION = 'radar-2';

/** Live-token protocols shown apart from the ranking, by market cap. */
export const LIVE_ROWS = 24;

/** A farm plan step: the action, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_comps: number;
    multiple_source: 'category' | 'global';
    global_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js; the page regenerates the farm plan from the same inputs. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  category_comps: number;
  multiple_source: 'category' | 'global';
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: the market's own value, shown apart, never modelled. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  multiples: { category: string; multiple: number; comps: number }[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Median of a non-empty list; null when empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The category multiples measured from the snapshot's own live-token protocols: for each category,
 * the median mcap/TVL of its live comps (each comp's ratio clamped first, so one misattributed
 * record cannot set a category's price), shrunk toward the global median when the category has few
 * comps, then clamped. Categories with fewer than `min_comps_for_category` comps get no entry: they
 * fall back to the global median. Returns the per-category table, the global median, and the comp
 * count per category (the dashboard shows all three).
 */
export interface Multiples {
  byCategory: Map<string, number>;
  comps: Map<string, number>;
  global: number;
}

export function measureMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Multiples {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    // A market cap of 0 is unrecorded data, not a price: the protocol has a token (a CoinGecko id
    // and a symbol) but no market cap to measure against, so it is no comp.
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = Math.min(model.ratio_max, Math.max(model.ratio_min, p.mcap_usd / p.tvl_usd));
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    allRatios.push(ratio);
    const key = p.category ?? 'Other';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const global = median(allRatios) ?? 0.25;
  const byCategory = new Map<string, number>();
  const comps = new Map<string, number>();
  for (const [cat, ratios] of ratiosByCategory) {
    comps.set(cat, ratios.length);
    if (ratios.length < model.min_comps_for_category) continue;
    const catMedian = median(ratios) ?? global;
    // Shrinkage: a category with n comps gets weight n/N toward its own median, the rest global.
    const w = Math.min(ratios.length, model.comps_for_full_weight) / model.comps_for_full_weight;
    const blended = w * catMedian + (1 - w) * global;
    byCategory.set(cat, Math.min(model.multiple_max, Math.max(model.multiple_min, blended)));
  }
  return { byCategory, comps, global: round4(global) };
}

/**
 * The multiple a protocol's category gets, and where it came from: its own shrunk median when the
 * category has enough live comps, else the global median.
 */
function multipleFor(category: string | null, multiples: Multiples, model: ModelConstants): { multiple: number; comps: number; source: 'category' | 'global' } {
  const key = category ?? 'Other';
  const m = multiples.byCategory.get(key);
  const n = multiples.comps.get(key) ?? 0;
  if (m !== undefined) return { multiple: m, comps: n, source: 'category' };
  return { multiple: Math.min(model.multiple_max, Math.max(model.multiple_min, multiples.global)), comps: n, source: 'global' };
}

/** The multipliers and implied value one protocol gets. */
export function impliedValue(
  protocol: SnapProtocol,
  asOf: string,
  multiples: Multiples,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; comps: number; source: 'category' | 'global'; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, comps, source } = multipleFor(protocol.category, multiples, model);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_steps) * model.chain_step;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, multiple, comps, source, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose products are a wrapped, staked or bridged form of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word wrapped, staked or staking is a wrapped product, not a launch. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol name must not begin with (an exchange's own product, not a launch). */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades — the watchlist's own exclusion rule, applied to every row.
 * WBTC is Bitcoin on Ethereum and Binance Bitcoin is BTC in an exchange product: neither is a token
 * still waiting on a launch of its own, so neither is ranked, however large its TVL.
 */
export function isRankable(p: SnapProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return !EXCHANGES.some((x) => p.name.startsWith(x));
}

/** The board: every watchlist slug plus every rankable pre-token protocol below the floor. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = measureMultiples(snapshot, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const watchlist = new Set(snapshot.watchlist);
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      category_multiple: round4(s.v.multiple),
      category_comps: s.v.comps,
      multiple_source: s.v.source,
      global_multiple: multiples.global,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      chain_multiplier: round4(s.v.chainMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: action, then cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Typical gas for one transaction on a chain, in dollars, from the chain's own fee market. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $8';
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'near') return 'under $0.10';
  if (c === 'bitcoin') return 'about $2';
  if (c === 'tron') return 'about $1';
  return 'about $0.50';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main farming action, in words a farmer can follow. */
function actionFor(p: SnapProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('curator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in your wallet.`;
  if (c.includes('uncollateralized lending') || c.includes('lending') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, borrow a small amount against it once, and keep the position open.`;
  if (c.includes('dex') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position open.`;
  if (c.includes('leveraged farm') || c.includes('yield aggregator') || c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into ${name}'s highest-TVL strategy on ${chain} and let the yield compound.`;
  if (c.includes('canonical bridge') || c.includes('bridge')) return `Bridge $${capital} of USDC through ${name} to ${chain} and use the bridged funds inside its app.`;
  if (c.includes('liquid restaking') || c.includes('restak') || c.includes('liquid staking') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} and hold the liquid receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('synthetic') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('basis trading')) return `Deposit $${capital} into ${name}'s basis strategy on ${chain} and hold the position through one funding cycle.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one position on a market that settles after 30 days.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
  if (c.includes('stablecoin') || c.includes('algo-stables')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and keep it staked.`;
  if (c.includes('launchpad')) return `Stake $${capital} on ${name}'s launchpad on ${chain} to qualify for allocations.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${name}'s shielded pool on ${chain} and keep the note safe.`;
  if (c.includes('payment')) return `Fund $${capital} on ${name} and make one real payment through it.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name}'s chain and use one of its native apps each week.`;
  if (c.includes('ai') || c.includes('decentralized ai')) return `Deposit $${capital} into ${name} on ${chain} and run one agent task a week.`;
  if (c.includes('nft')) return `List or buy one item through ${name} on ${chain} for about $${capital} and keep the receipt.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote on one proposal.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, category-specific weekly action, so the plan is not one generic line. */
function weeklyFor(p: SnapProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('liquidity manager')) return 'Swap a small amount through the pool and re-check the position range.';
  if (c.includes('lending') || c.includes('cdp') || c.includes('collateral')) return 'Adjust the borrow slightly, repay a little, or top the supply up.';
  if (c.includes('bridge')) return 'Bridge a small amount back or onward so the route stays active.';
  if (c.includes('staking') || c.includes('restak')) return "Check the receipt token's value and restake any rewards.";
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return "Check the vault's APY and add a small top-up when it rises.";
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('synthetic') || c.includes('options')) return 'Rebalance the hedge and close it if the funding turns against you.';
  if (c.includes('prediction')) return 'Review open markets and close or roll a position before it settles.';
  if (c.includes('rwa') || c.includes('stablecoin')) return "Check the asset's peg and yield, and claim any accrued rewards.";
  return 'Make one qualifying action: a deposit, a swap, a vote or a claim.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Each week, do one qualifying action on ${p.name}: ${weeklyFor(p)}`,
      cost: `${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    on_watchlist: row.on_watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    category_comps: row.model.category_comps,
    multiple_source: row.model.multiple_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = measureMultiples(snapshot, model);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: multiples.global,
    multiples: [...multiples.byCategory.entries()]
      .map(([category, multiple]) => ({ category, multiple, comps: multiples.comps.get(category) ?? 0 }))
      .sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1)),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `row ${i + 1} carries rank ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows share the same implied value`;
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
