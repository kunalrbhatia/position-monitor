# Position Monitor

A **monitoring-only** algorithm for Angel One SmartAPI built with Node.js, TypeScript, Express, Zod, and Winston.

This algorithm tracks live position MTM P&L via tick webhooks from Angel One SmartAPI, logs MTM every 5 minutes aligned to the clock, and automatically places exit market orders upon breaching asymmetric Profit Target (`+1.5%`) or Stop Loss (`-2.0%`) thresholds.

## Features

- **External Position Input**: Accepts position JSON files in `data/positions/*.json` (`status: "OPEN"`).
- **Asymmetric Threshold Exit**: Auto-exits non-worthless open legs (`LTP >= ₹5`) on `+1.5%` PT or `-2.0%` SL relative to `baselineValue`.
- **Tick Ingestion**: Receives tick updates via `POST /webhook/ticks`.
- **5-Minute Clock-Aligned MTM Logs**: Appends IST timestamped MTM records to `logs/mtm/mtm-{positionId}-{YYYY-MM-DD}.log`.
- **Control Switches**:
  - `.paper`: Runs exit logic in paper trading mode without sending broker orders.
  - `.kill`: Soft pause — blocks scanning/pickup of new position files.
  - `.panic`: Hard stop — blocks exit order placement.
- **Dedicated Alerts**: Logs warnings/errors (missing baselineValue, stale ticks, failed order fills) to `logs/alerts/alerts.log`.

## Installation & Setup

```bash
pnpm install
cp .env.example .env
```

## Running the Monitor

```bash
# Build TypeScript output
pnpm run build

# Start production server
pnpm start
```

## Pre-Push Verification Pipeline

Runs formatting, strict type checking, linting, Jest coverage, and compilation:

```bash
pnpm run verify
```
