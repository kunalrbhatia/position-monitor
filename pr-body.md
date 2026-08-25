### Description

Fixes position-monitor exit order failure loop and rate-limit storm by adding required order payload fields (`variety: 'NORMAL'`, `duration: 'DAY'`), introducing per-position retry cooldowns, max daily attempt caps, in-flight execution guards, rate-limit backoff, session refresh on auth errors, and conditional disk writes.

### Changes

- Added `variety: 'NORMAL'` and `duration: 'DAY'` to `OrderPayload` in `src/helpers/api.ts`.
- Standardized request headers (`User-Agent` and public IP) via `buildCommonHeaders`.
- Added per-position retry cooldown (`EXIT_RETRY_COOLDOWN_MS`) and max daily attempt caps (`EXIT_MAX_ATTEMPTS_PER_DAY`) in `src/jobs/exitExecutor.ts`.
- Added per-position in-flight state tracking in `src/store/index.ts`.
- Implemented rate-limit detection (`rateLimitHit`) with backoff (`RATE_LIMIT_BACKOFF_MS`) and JWT session auto-refresh on HTTP authentication errors.
- Conditioned position file disk writes on actual status changes to prevent disk churn and position file resurrection loops.
- Added reconnect backoff and alert suppression to WebSocket close handling in `src/helpers/tickFeeder.ts`.
- Updated unit tests in `tests/api.test.ts` and `tests/jobs.test.ts`.

### Verification

- `pnpm run verify` passed (Prettier formatting, TypeScript typecheck, ESLint, 100% test suite pass rate across 49 unit tests, and tsc build).
