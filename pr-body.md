### Description

Implements the initial Position Monitor algorithm based on [`position-monitor-blueprint.md`](file:///C:/Users/Kunal/Desktop/hobby-projects/position-monitor/position-monitor-blueprint.md).

### Changes

- Added Zod schemas for positions and legs in `src/types/position.ts`
- Implemented in-memory store and position file watcher in `src/store/index.ts` and `src/jobs/positionWatcher.ts`
- Added MTM calculation and 5-min clock-aligned IST logger in `src/helpers/mtm.ts` and `src/jobs/mtmLogger.ts`
- Implemented exit executor and broker order API in `src/jobs/exitExecutor.ts` and `src/helpers/api.ts`
- Added Express web server with health and tick webhook routes in `src/server.ts`
- Created unit and integration test suite with `pnpm run verify` check

### Verification

- `pnpm run verify` passed cleanly (formatting, typecheck, linting, test coverage, and build)
