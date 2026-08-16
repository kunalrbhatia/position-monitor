### Description

Implements independent position file monitoring and calculation of `marginUtilized` using Angel One's Batch Margin Calculator API. Updates the project documentation (`README.md`) with a multi-position strategy execution example.

### Changes

- Added `marginUtilized` field support to `PositionSchema` ([`src/types/position.ts`](file:///C:/Users/Kunal/Desktop/hobby-projects/position-monitor/src/types/position.ts)).
- Added `fetchBasketMarginUtilized()` in [`src/helpers/margin.ts`](file:///C:/Users/Kunal/Desktop/hobby-projects/position-monitor/src/helpers/margin.ts) using Angel One's Batch Margin Calculator API (`/rest/secure/angelbroking/margin/v1/batch`).
- Updated [`src/store/index.ts`](file:///C:/Users/Kunal/Desktop/hobby-projects/position-monitor/src/store/index.ts) to calculate and persist `marginUtilized` for each position file independently.
- Isolated threshold checking and exit execution per position file in [`src/jobs/positionWatcher.ts`](file:///C:/Users/Kunal/Desktop/hobby-projects/position-monitor/src/jobs/positionWatcher.ts), [`src/jobs/exitExecutor.ts`](file:///C:/Users/Kunal/Desktop/hobby-projects/position-monitor/src/jobs/exitExecutor.ts), and [`src/server.ts`](file:///C:/Users/Kunal/Desktop/hobby-projects/position-monitor/src/server.ts).
- Documented multi-position strategy execution behavior (calendar spread vs call spread) in [`README.md`](file:///C:/Users/Kunal/Desktop/hobby-projects/position-monitor/README.md).
- Updated unit tests in [`tests/store.test.ts`](file:///C:/Users/Kunal/Desktop/hobby-projects/position-monitor/tests/store.test.ts), [`tests/jobs.test.ts`](file:///C:/Users/Kunal/Desktop/hobby-projects/position-monitor/tests/jobs.test.ts), and [`tests/margin.test.ts`](file:///C:/Users/Kunal/Desktop/hobby-projects/position-monitor/tests/margin.test.ts).

### Verification

- `pnpm run verify` passed cleanly (Prettier, tsc typecheck, ESLint, 100% passing Jest test suite, and build).
