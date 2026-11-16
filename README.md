# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bagusekawx/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bagusekawx/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: a program that reads a sealed DefiLlama snapshot, ranks every rankable
pre-token protocol by an implied value, and hands in a dashboard a reader can use to
decide what to farm next. The board covers all 40 watchlist protocols plus every
rankable pre-token protocol below the floor (198 rows), each with a concrete farm
plan. Protocols whose token already trades are set aside with their market caps —
and their market caps are the model's price evidence.

## The model (radar-2)

Implied value follows only from the snapshot's own figures:

```
implied = round( tvl_usd × category multiple × growth × maturity × chains )
```

- **Category multiple, measured:** for each category, the median mcap/TVL of its
  live-token protocols in this snapshot, shrunk toward the global median when the
  category has few comps, clamped to 0.05–1.50. A category needs at least 2 live
  comps to earn its own multiple; with fewer it uses the global median.
- **Growth:** seven-day TVL change, clamped to −50%…+100%, weighted 0.40.
- **Maturity:** age with no token raises the value toward a plateau at two years.
- **Chains:** a protocol live on more chains earns up to +20%.

No protocol name is ever special-cased. Wrapped, staked and bridged products of
tokens that already trade (WBTC, exchange Bitcoin products) are never ranked:
they are not token launches.

## Layout

- `main.ts` — the entry program: reads the snapshot, writes `board.json`,
  `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to `/output`.
- `lib/model.ts` — the model, the board builder and the farm-plan generator.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte.
- `dashboard/` — the static page (index.html, app.css, app.js). No network.
- `screenshots/` — the board, a detail view and a filtered view, rendered from
  the dashboard's own files.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
