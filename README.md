# Position Monitor

A **monitoring-only** algorithm for Angel One SmartAPI built with Node.js, TypeScript, Express, Zod, and Winston.

This algorithm tracks live position MTM P&L via tick webhooks from Angel One SmartAPI, logs MTM every 5 minutes aligned to the clock, and automatically places exit market orders upon breaching asymmetric Profit Target (`+1.5%`) or Stop Loss (`-2.0%`) thresholds.

## Features

- **Independent Position File Monitoring**: Every position file in `data/positions/*.json` (`status: "OPEN"`) is tracked as an isolated trade/strategy.
  - **`marginUtilized`**: Each position file contains its own `marginUtilized` field representing the total margin required for the legs in that JSON file. If missing, it is automatically calculated via Angel One SmartAPI Batch Margin Calculator API (`/rest/secure/angelbroking/margin/v1/batch`) and saved back into the position JSON file.
  - **Independent PT / SL**: `+1.5%` Profit Target and `-2.0%` Stop Loss are computed specifically against each file's `marginUtilized`.
- **Targeted Exit**: When a threshold breach occurs for a position file, only the legs belonging to that specific position JSON file are exited. Other position files remain unaffected and active.
- **Tick Ingestion**: Receives tick updates via `POST /webhook/ticks`.
- **5-Minute Clock-Aligned MTM Logs**: Appends IST timestamped MTM records to `logs/mtm/mtm-{positionId}-{YYYY-MM-DD}.log`.
- **Control Switches**:
  - `.paper`: Runs exit logic in paper trading mode without sending broker orders.
  - `.kill`: Soft pause — blocks scanning/pickup of new position files.
  - `.panic`: Hard stop — blocks exit order placement.
- **Dedicated Alerts**: Logs warnings/errors (missing marginUtilized, API failures, stale ticks, failed order fills) to `logs/alerts/alerts.log`.

## Multi-Position Behavior Example

Suppose you have **two separate position files** running in `data/positions/`:

1. `pos-calendar.json` (Weekly Calendar spread)
2. `pos-callspread.json` (Pure Call Spread with 1 call sell and 1 far OTM call buy hedge)

### 1. Margin Setup (`marginUtilized`)

When the monitor starts up:

- **`pos-calendar.json`**:
  - The monitor calls Angel One's Batch Margin Calculator API for the calendar's legs.
  - SmartAPI returns the calculated margin (e.g. `₹80,000`), which is saved into `pos-calendar.json` as `"marginUtilized": 80000`.
- **`pos-callspread.json`**:
  - The monitor calls the margin API for the call sell + far OTM buy hedge legs.
  - SmartAPI returns the hedged margin (e.g. `₹30,000`), which is saved into `pos-callspread.json` as `"marginUtilized": 30000`.

### 2. Independent Threshold Calculation

Each file gets its own explicit PT and SL targets based strictly on its `marginUtilized`:

- **`pos-calendar.json` (`marginUtilized = ₹80,000`)**:
  - **Profit Target (+1.5%):** `+₹1,200`
  - **Stop Loss (-2.0%):** `-₹1,600`
- **`pos-callspread.json` (`marginUtilized = ₹30,000`)**:
  - **Profit Target (+1.5%):** `+₹450`
  - **Stop Loss (-2.0%):** `-₹600`

### 3. Live Tick Monitoring & Isolated Exits

#### **Scenario A: Call Spread hits Stop Loss (`-₹600`), Weekly Calendar is performing well (`+₹800`)**

1. An incoming tick causes `pos-callspread.json` MTM to reach **`-₹620`**.
2. The threshold check for `pos-callspread` triggers **`STOP_LOSS`**.
3. **Exit Execution:**
   - **`pos-callspread.json`**: Market exit orders are placed for the Call Sell and Far OTM Buy legs. All legs are marked `CLOSED` and saved to `pos-callspread.json`.
   - **`pos-calendar.json`**: **UNTOUCHED.** The calendar position continues running and being monitored normally.

#### **Scenario B: Weekly Calendar hits Profit Target (`+₹1,200`)**

1. Later in the day, ticks push `pos-calendar.json` MTM to **`+₹1,250`**.
2. The threshold check for `pos-calendar` triggers **`PROFIT_TARGET`**.
3. **Exit Execution:**
   - **`pos-calendar.json`**: Market exit orders close both calendar legs, status updated to `CLOSED`.

### Summary Table

| Position File         | `marginUtilized` | Profit Target (+1.5%) | Stop Loss (-2.0%) | On Breach                       |
| :-------------------- | :--------------- | :-------------------- | :---------------- | :------------------------------ |
| `pos-calendar.json`   | ₹80,000          | +₹1,200               | -₹1,600           | Exits **only** calendar legs    |
| `pos-callspread.json` | ₹30,000          | +₹450                 | -₹600             | Exits **only** call spread legs |

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
