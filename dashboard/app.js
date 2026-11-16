// Token Radar's dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, filters, a per-protocol detail drawer with the model's own arithmetic and the
// protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: '0', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(2); }

  // The model in one function: the page recomputes a row from the snapshot figures and the multiples
  // table main.ts measured, and checks the number board.json carries, so the page's arithmetic and
  // the board's data are visibly the same function.
  function multipleOf(row) {
    var hit = null;
    (DATA.multiples || []).forEach(function (m) { if (m.category === (row.category || 'Other')) hit = m; });
    return hit ? hit.multiple : DATA.global_multiple;
  }
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var chainMult = 1 + Math.min(Math.max(chains - 1, 0), m.chain_max_steps) * m.chain_step;
    return Math.max(1, Math.round(row.tvl_usd * multipleOf(row) * growthMult * maturity * chainMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the gas, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum') return 'about $8';
    if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'near') return 'under $0.10';
    if (c === 'bitcoin') return 'about $2';
    if (c === 'tron') return 'about $1';
    return 'about $0.50';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('capital allocator') >= 0 || c.indexOf('curator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares in your wallet.';
    if (c.indexOf('uncollateralized lending') >= 0 || c.indexOf('lending') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', borrow a small amount against it once, and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and keep the LP position open.';
    if (c.indexOf('leveraged farm') >= 0 || c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + capital + " into " + name + "'s highest-TVL strategy on " + chain + ' and let the yield compound.';
    if (c.indexOf('canonical bridge') >= 0 || c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC through ' + name + ' to ' + chain + ' and use the bridged funds inside its app.';
    if (c.indexOf('liquid restaking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('liquid staking') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and hold the liquid receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('synthetic') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('basis trading') >= 0) return 'Deposit $' + capital + " into " + name + "'s basis strategy on " + chain + ' and hold the position through one funding cycle.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one position on a market that settles after 30 days.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it in your wallet.';
    if (c.indexOf('stablecoin') >= 0 || c.indexOf('algo-stables') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and keep it staked.';
    if (c.indexOf('launchpad') >= 0) return 'Stake $' + capital + ' on ' + name + "'s launchpad on " + chain + ' to qualify for allocations.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('privacy') >= 0) return 'Deposit $' + capital + " through " + name + "'s shielded pool on " + chain + ' and keep the note safe.';
    if (c.indexOf('payment') >= 0) return 'Fund $' + capital + ' on ' + name + ' and make one real payment through it.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to ' + name + "'s chain and use one of its native apps each week.";
    if (c.indexOf('ai') >= 0 || c.indexOf('decentralized ai') >= 0) return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' and run one agent task a week.';
    if (c.indexOf('nft') >= 0) return 'List or buy one item through ' + name + ' on ' + chain + ' for about $' + capital + ' and keep the receipt.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + " of " + name + "'s index token on " + chain + ' and hold it.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' and vote on one proposal.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Swap a small amount through the pool and re-check the position range.';
    if (c.indexOf('lending') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Adjust the borrow slightly, repay a little, or top the supply up.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a small amount back or onward so the route stays active.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Check the receipt token's value and restake any rewards.";
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield') >= 0) return "Check the vault's APY and add a small top-up when it rises.";
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('synthetic') >= 0 || c.indexOf('options') >= 0) return 'Rebalance the hedge and close it if the funding turns against you.';
    if (c.indexOf('prediction') >= 0) return 'Review open markets and close or roll a position before it settles.';
    if (c.indexOf('rwa') >= 0 || c.indexOf('stablecoin') >= 0) return "Check the asset's peg and yield, and claim any accrued rewards.";
    return 'Make one qualifying action: a deposit, a swap, a vote or a claim.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas + ' of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Each week, do one qualifying action on ' + p.name + ': ' + weeklyFor(p), cost: gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open " + p.name + "'s own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('minTvl')) state.minTvl = params.get('minTvl');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl !== '0') params.set('minTvl', state.minTvl);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    var min = parseFloat(state.minTvl) || 0;
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < min) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'sweep', 'aria-hidden': 'true' }),
        el('div', null,
          el('div', { class: 'brand-name', text: 'TOKEN RADAR' }),
          el('div', { class: 'brand-sub', text: 'PRE-TOKEN PROTOCOLS · RANKED BY IMPLIED VALUE' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Which pre-token protocol is worth farming next?' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least $', el('b', { text: Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) }),
          ' more pre-token protocols below that floor — every rankable one in the snapshot. Implied value is a model, not a promise.'
        )
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat hot' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: '100% of the floor' })),
        el('div', { class: 'stat' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) }), el('small', { text: 'every rankable protocol' })),
        el('div', { class: 'stat' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) }), el('small', { text: 'the radar finds them' })),
        el('div', { class: 'stat' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(DATA.total_implied_usd) }), el('small', { text: 'across the whole board' })),
        el('div', { class: 'stat' }, el('span', { text: 'Live-token set aside' }), el('b', { text: String(DATA.live_size) }), el('small', { text: 'market caps, not models' }))
      )
    );
  }

  function selectField(id, label, options, value, onChange) {
    var select = el('select', { id: id, 'aria-label': label },
      options.map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === value ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { onChange(select.value); writeHash(); render(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), select);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      selectField('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }),
      selectField('minTvl', 'Min TVL', [['0', 'Any TVL'], ['5000000', '$5M+'], ['50000000', '$50M+'], ['500000000', '$500M+'], ['1000000000', '$1B+']], state.minTvl, function (v) { state.minTvl = v; }),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or TVL floor to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = '0'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        'class': r.on_watchlist ? 'watch' : null,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: r.on_watchlist ? 'badge watch' : 'badge', text: r.on_watchlist ? 'watchlist · no token' : 'early · no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Amber edge: the house watchlist. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'badge live', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'badge live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. Set aside from the pre-token ranking — and the source of the category multiples the model measures.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var top = (DATA.multiples || []).slice().sort(function (a, b) { return b.comps - a.comps; }).slice(0, 8);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed ' }, el('span', { class: 'tag', text: DATA.model_version })),
      el('p', { class: 'sub', text: 'One function scores every row from the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd',
        el('span', { class: 'dim', text: '  ×  category multiple (measured, below)' }),
        ' × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + ')',
        ' × (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + ')',
        ' × (1 + 0.05 × min(chains − 1, 4)) )'
      ),
      el('div', { class: 'model-grid' },
        el('div', { class: 'model-cell' },
          el('b', { text: 'Category multiple, measured' }),
          el('span', { text: 'For each category, the median mcap/TVL of its live-token protocols in this snapshot, shrunk toward the global median (' + fmtMult(DATA.global_multiple) + ') when the category has few comps, clamped to ' + fmtMult(m.multiple_min) + '–' + fmtMult(m.multiple_max) + '. A category needs at least ' + m.min_comps_for_category + ' live comps to earn its own multiple; with fewer it uses the global median. The market prices the comparables; the model borrows that price.' })
        ),
        el('div', { class: 'model-cell' },
          el('b', { text: 'Growth and maturity' }),
          el('span', { text: 'Seven-day TVL change, clamped, moves the value up or down; age with no token raises it toward a plateau at two years. An unlisted age uses ' + m.unknown_age_days + ' days.' })
        ),
        el('div', { class: 'model-cell' },
          el('b', { text: 'Chain breadth and coverage' }),
          el('span', { text: 'A protocol live on more chains earns up to +20%: distribution is reach. The board ranks every rankable pre-token protocol in the snapshot — the 40 watchlist slugs and all ' + DATA.early_size + ' early ones below the floor.' })
        )
      ),
      top.length ? el('p', { class: 'sub', text: 'Multiples measured from this snapshot (most comps first): ' + top.map(function (t) { return t.category + ' ' + fmtMult(t.multiple) + ' (' + t.comps + ' comps)'; }).join(' · ') + '.' }) : null
    );
  }

  function foot() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Source: ' + DATA.source }),
      el('span', { text: 'Implied value is the entry\u2019s own claim from the snapshot figures, never a price and never a prediction that a token is issued. A protocol on this board records no token in DefiLlama; it may still have one its record does not carry.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    var match = recomputed === row.implied_value_usd;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'RANK ' + row.rank + ' OF ' + DATA.board_size + (row.on_watchlist ? ' · WATCHLIST' : ' · EARLY') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · listed ' + (row.listed_at || 'unknown') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the arithmetic' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: row.multiple_source === 'category' ? (row.category || 'Other') + ' multiple (' + row.category_comps + ' live comps)' : 'Global median multiple (only ' + row.category_comps + ' live comp' + (row.category_comps === 1 ? '' : 's') + ' in ' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth ' + fmtPct(row.change_7d) }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token (' + fmtAge(row.age_days) + ')' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chains (' + (row.chains ? row.chains.length : 0) + ')' }), el('b', { class: 'num', text: fmtMult(row.chain_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (match ? ', the same number board.json carries.' : ' — the data would be stale.') + ' An estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(foot());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
