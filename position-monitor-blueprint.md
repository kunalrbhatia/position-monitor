# Position Monitoring Algo — Blueprint

_A blueprint for a **monitoring-only** algo on Angel One SmartAPI. This algo has **no entry logic and no strategy logic** — positions are supplied externally as JSON, filled in by hand once a trade is live. The algo's only job is: find the live positions, track combined MTM P&L, log it, and auto-exit at fixed SL/PT thresholds. Section 1 documents the monitor. Section 2 is a strategy-agnostic engineering checklist — treat these as non-negotiable defaults for this algo and any future algo. Section 3 is stack/structure. Section 4 is the pre-launch checklist._

---

## 1. Position Monitoring Algo

### Overview

This algo does **not** decide what to buy or sell, when to enter, or how to construct a position. All of that happens outside the algo (manually, or by another system). Its only inputs are:

1. A **position JSON file** (one per position) that you fill in by hand once a trade is live.
2. Live tick data delivered via **webhook from Angel One SmartAPI**.

Its only jobs:

- Resolve which legs are open from the position JSON.
- Recompute combined **MTM P&L** on every relevant webhook tick.
- Append an **MTM log line every 5 minutes**.
- Auto-exit (place exit orders for every non-worthless open leg) when combined P&L crosses **+1.5% (profit target)** or **−2% (stop-loss)**.
- Never touch entries. There is no entry cron, no strike selection, no expiry resolution.

### §1.0 Position JSON — the only input

Since this is filled in manually per trade, the schema needs to be simple, unambiguous, and self-describing. One JSON file per position, dropped into `data/positions/`.

**Baseline value for % thresholds:** SL/PT thresholds are computed against a fixed **`baselineValue`** captured once at entry (either margin utilized or net premium paid/received — pick one convention and be consistent). This field is filled in by hand, since the algo never runs an entry phase and cannot fetch margin itself. If it's left blank, monitoring still starts, but **threshold checks are blocked and an alert is raised** ("baselineValue missing") instead of guessing.

#### Schema

```
{
  "positionId": string,              // your own reference id, e.g. "nifty-2026-08-14-01"
  "index": "NIFTY" | "SENSEX",
  "status": "OPEN" | "CLOSED",
  "baselineValue": number,           // ₹ — margin utilized or net premium at entry; SL/PT % computed against this
  "entryTimestamp": string,          // ISO 8601
  "legs": [
    {
      "legId": string,               // stable id, e.g. "L1"
      "symbol": string,              // exact tradingsymbol from scrip master, e.g. "NIFTY28OCT25C25000"
      "token": string,               // Angel One instrument token, needed to match incoming webhook ticks
      "expiry": string,              // "YYYY-MM-DD"
      "optionType": "CE" | "PE",
      "side": "BUY" | "SELL",
      "qty": number,                 // total quantity (lots × lot size)
      "lotSize": number,             // verified lot size at entry — not re-derived mid-trade
      "entryPrice": number,          // fill premium per unit
      "status": "OPEN" | "CLOSED" | "EXPIRED_UNBOOKED"
    }
  ]
}
```

#### Example — `data/positions/nifty-2026-08-14-01.json`

```json
{
  "positionId": "nifty-2026-08-14-01",
  "index": "NIFTY",
  "status": "OPEN",
  "baselineValue": 185000,
  "entryTimestamp": "2026-08-14T09:45:00+05:30",
  "legs": [
    {
      "legId": "L1",
      "symbol": "NIFTY28OCT25C25500",
      "token": "45234",
      "expiry": "2026-10-28",
      "optionType": "CE",
      "side": "BUY",
      "qty": 65,
      "lotSize": 65,
      "entryPrice": 142.5,
      "status": "OPEN"
    },
    {
      "legId": "L2",
      "symbol": "NIFTY28OCT25P24500",
      "token": "45241",
      "expiry": "2026-10-28",
      "optionType": "PE",
      "side": "BUY",
      "qty": 65,
      "lotSize": 65,
      "entryPrice": 138.75,
      "status": "OPEN"
    },
    {
      "legId": "L3",
      "symbol": "NIFTY21OCT25C25500",
      "token": "44987",
      "expiry": "2026-10-21",
      "optionType": "CE",
      "side": "SELL",
      "qty": 130,
      "lotSize": 65,
      "entryPrice": 71.25,
      "status": "OPEN"
    },
    {
      "legId": "L4",
      "symbol": "NIFTY21OCT25P24500",
      "token": "44992",
      "expiry": "2026-10-21",
      "optionType": "PE",
      "side": "SELL",
      "qty": 130,
      "lotSize": 65,
      "entryPrice": 69.4,
      "status": "OPEN"
    }
  ]
}
```

The example uses a 4-leg calendar-ratio shape, but the schema itself is generic — any number of legs, any side/qty combination — since this monitor doesn't know or care what strategy produced the position.

### §1.1 Discovery — finding open positions

On startup and on a recurring poll (e.g. every 60s, cheap idempotent read — §2.4), scan `data/positions/*.json` for files with `status: "OPEN"`. Build the set of tokens to watch from every `token` across every `OPEN` leg of every `OPEN` position — incoming webhook ticks are matched against this set. Re-scan on file changes (a new or edited JSON file while the process is running) rather than requiring a restart — this is the primary way new positions enter monitoring.

### §1.2 MTM calculation

For each open position, combined unrealized MTM = sum across all `OPEN` legs of:

```
legMTM = (side === 'BUY')
  ? (currentLTP - entryPrice) * qty
  : (entryPrice - currentLTP) * qty
```

- `EXPIRED_UNBOOKED` legs contribute ₹0.
- Recompute on every webhook tick for a token belonging to an open leg.

### §1.3 Exit thresholds — asymmetric SL/PT

```
profitThreshold₹ = baselineValue × (PROFIT_TARGET_PCT / 100)   // default 1.5
lossThreshold₹   = baselineValue × (STOPLOSS_PCT / 100)         // default 2.0
```

| Condition                                | Action                                                      |
| ---------------------------------------- | ----------------------------------------------------------- |
| Combined MTM P&L **≥ +profitThreshold₹** | Close position — exit every non-worthless open leg (PT hit) |
| Combined MTM P&L **≤ −lossThreshold₹**   | Close position — exit every non-worthless open leg (SL hit) |

**Example:** `baselineValue = ₹1,85,000` → PT at **+₹2,775** (1.5%), SL at **−₹3,700** (2%).

**Worthless legs:** a leg is worthless when `LTP < WORTHLESS_LTP_THRESHOLD` (default ₹5). Worthless legs are never sent exit orders on any exit path — marked ~₹0 for MTM but excluded from order placement.

**Exit execution:** on threshold breach, place exit orders immediately for every open, non-worthless leg (buy back shorts, sell longs). Track per-leg exit success/failure independently; alert on any leg that fails to close.

### §1.4 Tick ingestion — webhook from Angel One SmartAPI

Positions are monitored via a webhook endpoint that receives ticks pushed from Angel One SmartAPI (rather than the algo owning a persistent client-side WebSocket subscription loop itself):

```
POST /webhook/ticks
Body: { "token": string, "ltp": number, "timestamp": string (ISO 8601) }
```

or a batch variant `{ "ticks": [...] }` if the feed pushes multiple instruments per call.

- Since the feed originates from Angel One's own infrastructure rather than a third party, no separate shared-secret header is required. Endpoint access should still be restricted at the network layer (firewall/security-group rule to Angel One's known source, or a private tunnel), so this is an infra decision to make explicitly at deploy time — not a bare public POST.
- On a valid tick, update the in-memory LTP cache for that token, then recompute MTM for every open position whose legs include that token (§1.2), then check thresholds (§1.3).
- If ticks stop arriving for a token that belongs to an open leg for longer than `STALE_TICK_SECONDS` (default 90s during market hours), alert — a stale MTM is as dangerous as a wrong one.
- Idempotency: duplicate ticks (same token+timestamp replayed) are safe — recomputing MTM from the same LTP is a pure function, not a mutation. The _exit orders_ this algo places are the non-idempotent operation and must never be blindly retried (§2.4).

### §1.5 MTM log — every 5 minutes

- **Directory:** `logs/mtm/`
- **Pattern:** `mtm-{positionId}-{YYYY-MM-DD}.log` (keyed by `positionId`, since multiple positions on the same index can be open at once)
- **Cadence:** once every 5 minutes, aligned to the clock (`:00`, `:05`, `:10`, ...).
- **Line format (exact):**

```
[DD/MM/YYYY, H:mm:SS am/pm] [INFO] INDEX: MTM = VALUE
```

```
[14/8/2026, 3:15:00 pm] [INFO] NIFTY: MTM = 2145.00
[14/8/2026, 3:20:00 pm] [INFO] NIFTY: MTM = -1830.50
```

- Write the aligned 5-minute line **only if at least one webhook tick was received for that position since the last write** — never fabricate a line from stale cached LTPs when the feed has gone quiet.
- **Also append immediately, out of cadence,** the instant SL or PT is breached.
- Append-only. Never rewrite or truncate a day's file from the live process.

### §1.6 What this algo explicitly does NOT do

- No entry orders, no strike selection, no expiry resolution, no lot-size derivation at runtime (lot size is supplied in the JSON, verified by hand at entry time).
- No scheduled entry cron jobs — monitoring starts the moment a position JSON with `status: "OPEN"` appears and stops when it's flipped to `"CLOSED"` (by hand, or by the algo itself after an SL/PT exit).
- No daily trade report in v1 — out of scope for now; if added later, it should read from the append-only MTM log (§1.5), never from live mutable state, same as any report built on this system.

### §1.7 Alerting (no Telegram/Slack)

There is no external chat integration in this build. All alerts (stale ticks, missing `baselineValue`, failed exit-leg closes, fallback-value usage) are written to a dedicated `logs/alerts/` Winston stream, distinct from the general application log, so they're easy to grep or tail separately. If an external notification channel is wanted later, it should hang off this same alert-emission point rather than being scattered through the codebase.

---

## 2. Core Engineering Principles — Apply to This Algo and Any Future One

These are not strategy-specific. Treat each as a non-negotiable default.

### 2.1 Never let cleanup destroy data another process still needs

Before any store/state "clear" or "reset" operation, ask _who else reads this state after I clear it?_ If a downstream job (reporting, reconciliation, audit) depends on post-trade values, either (a) write an immutable snapshot/log entry _before_ clearing, or (b) have downstream consumers read from an append-only log, never from the same mutable file the live process clears. Cleanup and reporting must never share a single mutable source of truth.

### 2.2 Fallback values are a production incident waiting to happen — never let them be silent

Any fallback/default value that feeds into a risk calculation (SL, margin, position sizing) must:

- Trigger an explicit alert every time it's used, not just a log line.
- Be visibly labeled in every downstream output (e.g. `₹3,50,000 (fallback)` never bare `₹3,50,000`).
- Have a retry budget before falling back at all — and the retry failure itself should be alerted.
- Be treated as a "degrade, don't guess" trigger where possible — block rather than trade/act on fabricated numbers when the risk math is safety-critical. This same principle applies to a `baselineValue` missing from the position JSON (§1.0) and to stale webhook ticks (§1.4) — both should block/alert, never silently proceed on a guess.

### 2.3 Separate "pause new activity" from "stop everything, no exceptions"

Every algo needs at least two independent switches:

- A **soft pause** (`.kill`) — blocks new position files from being picked up. The default, low-risk lever.
- A **hard stop** (`.panic`) — blocks exit-order placement too. Reserved, clearly named, never the first thing reached for mid-trade.

Never conflate these into one flag, and never let the "obvious" command name map to the more dangerous behavior.

### 2.4 Order placement must never be blindly auto-retried

Classify every external call as **idempotent** (safe to retry: quotes, margin reads, LTP) or **non-idempotent** (never blind-retry: order placement). If a placed exit order succeeds broker-side but the HTTP response drops/times out, blind retry would submit a duplicate live order. Non-idempotent calls should either skip retry entirely, or check the broker's order/trade book for an existing matching order before resubmitting.

### 2.5 Timezone logic must not depend on the host machine's config

Use `Intl.DateTimeFormat` + explicit `Date.UTC(...)` reconstruction for all "what day/date/5-minute-boundary is it in IST" logic — never a `toLocaleString` round-trip that implicitly assumes the server's OS timezone. Pin `TZ=UTC` explicitly in the process manager config as a second, independent safety layer.

### 2.6 Reports and audit trails must read from append-only data, not live mutable state

Any "what happened" artifact (MTM history, audit log, future report) should be built from its own independent, append-only log written incrementally during the day — never reconstructed after the fact from the current value of live/mutable state. Snapshot early and often; read snapshots, not live state, when summarizing.

### 2.7 Verify every broker endpoint before trusting it in production

Before this algo goes live, do a dry-run checklist against real (paper-mode-safe) calls to every endpoint it touches: auth, LTP/quote (if used for any reconciliation), and order placement. Don't assume an endpoint copied from docs or another project is current — hit it once in paper mode first.

### 2.8 Decide deliberately what trading data becomes public

Before wiring any automated commit-based logging/reporting pipeline, explicitly decide the visibility of the output (public repo, private repo, or gitignored entirely) as a deliberate step.

### 2.9 Keep report-generation code changes independent of trading-logic changes

Whenever the position-JSON schema or MTM-log format changes (new fields, renamed fields), grep every consumer of that shape in the same change, not as a follow-up. Add a smoke test that renders/parses a fixture MTM log as part of CI, so a broken consumer is caught before it silently produces wrong numbers.

### 2.10 Never hardcode lot size — verify it, don't blindly trust a single source

Lot size is supplied per-position in the JSON (§1.0). At position-file load time, cross-check it once against the scrip master rather than trusting the hand-entered value blindly — but do not re-derive it mid-trade (lot size doesn't change intraday, and re-deriving it introduces the "last row wins" bug class instead of guarding against it).

---

## 3. Project Stack, Structure & Environment (Reference)

### Stack

| Concern         | Choice                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Runtime         | Node.js >= 22 LTS                                                                                                        |
| Language        | TypeScript (strict), ES modules                                                                                          |
| Package manager | pnpm                                                                                                                     |
| Framework       | Express — health check **and** the `/webhook/ticks` ingestion endpoint (§1.4)                                            |
| Broker          | Angel One SmartAPI (exit-order placement only — no entry, no scrip-master resolution beyond what's supplied in the JSON) |
| Tick source     | Inbound webhook from Angel One SmartAPI (§1.4)                                                                           |
| Logging         | Winston (daily rotated files, IST timestamps) + 5-minute MTM append log (§1.5) + separate alerts stream (§1.7)           |
| Persistence     | Local JSON files — one file per position under `data/positions/` (§1.0)                                                  |
| Switches        | `.paper` (paper mode), `.kill` (soft pause — blocks new position pickup), `.panic` (hard stop — blocks exits too)        |
| Testing         | Jest + ts-jest, coverage enforced — see §3.2 `pnpm verify`                                                               |
| Env             | `.env` via `dotenv`, no `process.env` access outside `src/config/env.ts`                                                 |
| Process manager | PM2, with `TZ=UTC` pinned explicitly (§2.5)                                                                              |

### §3.1 Structure

```
position-monitor/
├── src/
│   ├── server.ts                # Express: health route + POST /webhook/ticks (§1.4)
│   ├── config/env.ts            # dotenv validation + typed config
│   ├── store/                   # In-memory LTP cache + position file watcher (§1.1)
│   ├── helpers/
│   │   ├── api.ts               # axios wrapper for exit-order placement only (§2.4 — non-idempotent)
│   │   ├── login.ts             # TOTP + session login (needed for order placement)
│   │   ├── mtm.ts                # legMTM / combined MTM calc (§1.2)
│   │   ├── thresholds.ts         # PT/SL breach check against baselineValue (§1.3)
│   │   └── modeManager.ts        # .paper / .kill / .panic switches (§2.3)
│   ├── jobs/
│   │   ├── positionWatcher.ts    # re-scans data/positions/*.json on change (§1.1)
│   │   ├── mtmLogger.ts          # 5-minute-aligned append-only writer (§1.5)
│   │   └── exitExecutor.ts       # places exit orders on breach, never blind-retried (§2.4)
│   ├── alerts/notifier.ts        # writes to logs/alerts/ (§1.7) — single emission point for all alerts
│   └── main.ts                   # Express bootstrap + cron for stale-tick check (§1.4)
├── logs/
│   ├── mtm/                      # mtm-{positionId}-{YYYY-MM-DD}.log — §1.5
│   └── alerts/                   # dedicated alert stream — §1.7
└── data/
    └── positions/                 # <positionId>.json — the only input to this algo (§1.0)
```

### §3.2 `pnpm verify` — required CI/pre-push pipeline

A single `pnpm verify` script runs the following checks **in sequence**, stopping at the first failure:

1. **Prettier format check** — `prettier --check .`
2. **Typecheck** — `tsc --noEmit`
3. **Lint** — `eslint .`
4. **Jest coverage** — `jest --coverage`, with a **minimum coverage threshold of 90%** (branches, functions, lines, statements) enforced via `coverageThreshold` in Jest config, not just reported
5. **Build** — `tsc -p tsconfig.build.json` (or the project's actual build command)

`package.json` scripts:

```json
{
  "scripts": {
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test:coverage": "jest --coverage",
    "build": "tsc -p tsconfig.build.json",
    "verify": "pnpm format:check && pnpm typecheck && pnpm lint && pnpm test:coverage && pnpm build"
  }
}
```

Jest config excerpt enforcing the 90% floor:

```json
{
  "coverageThreshold": {
    "global": {
      "branches": 90,
      "functions": 90,
      "lines": 90,
      "statements": 90
    }
  }
}
```

`pnpm verify` should run in CI on every push/PR, and be the single command a developer runs locally before pushing — no partial subset of these checks is sufficient on its own.

### §3.3 Environment Variables

```
PORT=3000
NODE_ENV=production

# Broker Credentials (exit-order placement only)
API_KEY=
CLIENT_CODE=
CLIENT_PIN=
CLIENT_TOTP_PIN=

# Monitoring toggles
PROFIT_TARGET_PCT=1.5         # §1.3: exit when combined P&L >= +this% of baselineValue
STOPLOSS_PCT=2                # §1.3: exit when combined P&L <= -this% of baselineValue
WORTHLESS_LTP_THRESHOLD=5     # legs below this LTP are never sent exit orders
STALE_TICK_SECONDS=90         # alert if no tick for an open leg's token within this window
MTM_LOG_INTERVAL_MINUTES=5    # §1.5
```

No Telegram/Slack variables and no webhook shared-secret — see §1.4 and §1.7 for why.

---

## 4. Pre-Launch Checklist

- [ ] `POST /webhook/ticks` endpoint access is restricted at the network layer to Angel One's source (§1.4)
- [ ] Position JSON schema validated on load (Zod) — malformed/missing `baselineValue` blocks threshold checks and alerts, never guesses (§1.0, §2.2)
- [ ] Exit-order placement excluded from generic retry (§2.4)
- [ ] Soft pause (`.kill`, blocks new position pickup) and hard stop (`.panic`, blocks exits) are separate switches (§2.3)
- [ ] All date/5-minute-alignment logic uses `Intl.DateTimeFormat`, `TZ=UTC` pinned in PM2 config (§2.5)
- [ ] MTM log writer only fires when a fresh webhook tick has been received since the last write — never fabricates a line from stale cache (§1.5)
- [ ] Stale-tick alerting configured and tested (`STALE_TICK_SECONDS`) (§1.4, §2.2)
- [ ] `pnpm verify` passes locally and in CI: prettier check → typecheck → lint → jest coverage ≥ 90% → build, in that order (§3.2)
- [ ] Visibility of any auto-committed position/MTM data explicitly decided (§2.8)
- [ ] Lot size in each position JSON cross-checked once against the scrip master at position-file load time (§2.10)
