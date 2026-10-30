# Session History & Activity Log

This file tracks all modifications, additions, and procedures executed in the repository. It is continuously preserved and updated.

> **CRITICAL RULE**: Before opening any Pull Request, you must update this file by appending the latest work done, verification and sanity checks performed, and key decisions made.

---

## 2026-09-30 — Support BANKNIFTY Positions & Per-Position Absolute PT / SL-Disable Overrides

### Context & Requirements

- Supported index enum was previously restricted to `NIFTY` and `SENSEX`.
- Kunal holds a `BANKNIFTY` iron fly (`23NOV2026`) requiring an absolute profit target of ₹43,200 (`ptAmount: 43200`) and explicitly disabled stop loss (`slAmount: null`).
- Threshold checks needed to support per-position overrides while strictly preserving backwards-compatible percentage-based derivations for legacy positions.

### Work Executed

1. **Position Schema Update (`src/types/position.ts`)**:
   - Expanded `index` enum from `['NIFTY', 'SENSEX']` to `['NIFTY', 'SENSEX', 'BANKNIFTY']`.
   - Added optional fields:
     - `ptAmount`: `z.number().positive().nullable().optional()` (positive number = absolute rupee target; overrides percentage).
     - `slAmount`: `z.number().positive().nullable().optional()` (positive number = absolute stop-loss; explicit `null` = stop-loss disabled; absent/undefined = fallback to percentage).
2. **Threshold Override Logic (`src/helpers/thresholds.ts`)**:
   - Updated `checkThresholds()` signature to accept `ptAmount?: number | null` and `slAmount?: number | null`.
   - Preserved `null` vs `undefined` distinction for `slAmount`.
   - Configured threshold evaluation so that if `ptAmount` is provided and SL is disabled or has absolute SL, `baselineValue` is not required, suppressing unnecessary alerts when margin is absent.
3. **Engine Call Sites Updated**:
   - `src/server.ts`: Passed `pos.ptAmount` and `pos.slAmount` directly into `checkThresholds()`.
   - `src/jobs/positionWatcher.ts`: Passed `pos.ptAmount` and `pos.slAmount` directly into `checkThresholds()`.
4. **P&L Reporting Script (`scripts/pnl_report.js`)**:
   - Updated `buildReport()` to check for `position.ptAmount` override.
   - Displayed `🛑 SL (Stop Loss):    disabled` when `slAmount === null`.
   - Maintained delta-neutrality calculations and exchange routing (`BFO` for SENSEX, `NFO` for NIFTY/BANKNIFTY).
5. **Documentation & Verification Pipeline**:
   - Updated `README.md` to document `BANKNIFTY` support and per-position absolute threshold overrides.
   - Added `tests/schema.test.ts` to validate parsing of `BANKNIFTY` positions with `ptAmount` and `slAmount: null`.
   - Added unit tests in `tests/thresholds.test.ts` covering absolute PT without baseline, disabled SL, legacy percentages, absolute SL breach, and override precedence.

### Sanity Checks & Verification Steps

- Ran `pnpm run format:check` to ensure full compliance with Prettier.
- Ran `pnpm run lint` with zero ESLint errors or warnings.
- Ran `pnpm run build` (`tsc -p tsconfig.build.json`) with strict TypeScript checks passing.
- Ran `pnpm run test` executing all 10 Jest test suites (61 total tests passing).
- Verified `node .agents/skills/readme-auto-update/scripts/check-readme.cjs` passed.
- Verified PR description using `node .agents/skills/pr-description-check/scripts/verify.cjs`.
- Monitored GitHub CI status using `node .agents/skills/verify-pr-status/scripts/verify-checks.cjs` until all checks passed.
- Pull Request created: [#14](https://github.com/kunalrbhatia/position-monitor/pull/14).

---

## 2026-10-30 — Realised-Aware MTM (fix: closing a losing leg faked a profit-target hit) + MCX/GOLDM support

### Context & Requirements

- **Incident:** on 30 Oct the BANKNIFTY iron fly auto-exited with real orders at 10:52 IST. Kunal had just closed the 57,800 CE wing for −₹23,643. `calculatePositionMTM()` summed **OPEN legs only**, so the closed losing leg's negative mark disappeared instead of being booked: MTM jumped ₹20,029 → ₹44,110, crossed the ₹43,200 absolute PT, and `PROFIT_TARGET` flattened the whole fly (+₹43,805.70 realised on four legs).
- **Requirement:** thresholds must measure **net** P&L (open + realised) so taking a loss can never inflate the mark into a target hit; and a commodity (MCX/GOLDM) book must be trackable with the same tooling.

### Work Executed

1. **`src/helpers/mtm.ts`** — added `realisedPnlOf(position)` (sums `realisedPnl` over non-OPEN legs); `calculatePositionMTM()` now starts from that figure before adding open-leg marks.
2. **`src/jobs/mtmLogger.ts`** — optional suffix on the MTM log line: `(net incl. realised ±X)` when a position carries realised P&L, so historical logs cannot be misread as open-only.
3. **`scripts/pnl_report.js`** — status / PT / SL check-marks now evaluate **net** (open + realised), matching the engine; per-position exchange routing (NFO / BFO / **MCX**); GOLDM spot proxy (nearest futures); `realisedPnl` carried into the `@@SNAPSHOT@@` payload.
4. **`src/types/position.ts`** — `index` enum gains `GOLDM`; `realisedPnl` added to `LegSchema` (adjustments closed on earlier days have no trade-book fills left to price); new `exchangeForIndex()` helper (GOLDM/SILVER/CRUDEOIL → MCX).
5. **`src/helpers/api.ts`, `src/helpers/margin.ts`, `src/jobs/exitExecutor.ts`, `src/store/index.ts`** — `MCX` added to the order/margin exchange unions and both call sites switched to `exchangeForIndex()`, so an exit can never be fired at the wrong exchange.
6. **Tests** — `tests/mtm.test.ts` (no closed legs / with realised / missing realised / unchanged-open behaviour) and `tests/jobs.test.ts` (log suffix).
7. **New operational scripts** — `scripts/verify-realised-mtm.mjs` (replays the incident numbers and asserts old behaviour fires the PT while the fixed one does not) and `scripts/verify-positions.mjs` (per-leg broker reconciliation, accounts for the GOLDM ×10 multiplier).

### Sanity Checks & Verification Steps

- `node scripts/verify-realised-mtm.mjs` → **PASS**: open-only MTM 44,109.90 would fire the ₹43,200 PT; realised-aware MTM 20,466.90 does not.
- `pnpm run build` (`tsc -p tsconfig.build.json`) — clean.
- Broker reconciliation `node scripts/verify-positions.mjs` → 0 mismatches, 0 untracked rows, per-leg MTM Δ₹0.00 against the broker's own `pnl`.
- Jest **not** run on the 1 GB algo box (deliberate) — CI runs the suite.

### Key Decisions

- **Threshold semantics = NET P&L** (open + realised), identical to the banner's `🧮 Net incl. realised`.
- Exchange mapping centralised in `exchangeForIndex()` — one place, no duplicated ternaries.
- GOLDM stored with `qty: 10` / `lotSize: 100` because MCX quotes the premium per 10 g in a 100 g lot; using 100 inflates MTM 10×.
- Builds must move off the 1 GB host: two `tsc` runs took the machine (and sshd) down.

---

## 2026-10-30 — Banner leads with NET P&L (the figure the engine exits on)

- Swapped the two P&L lines in `scripts/pnl_report.js`: positions that carry realised money now show `🧮 Net incl. realised` directly under the position id (with a % of margin), and `💰 Total PnL (open)` moves into the threshold block below `📜 Adjustments (realised)`.
- Rationale: the exit path fires on **net**; leading with the open mark (₹38,984 vs ₹15,341 on the BANKNIFTY fly) made the card read as if the target were close when it was not.
- Positions with no realised P&L are unchanged — they still print a single `💰 Total PnL` line.
- Verified both paths on live data (BANKNIFTY = realised, NIFTY BF = none).
