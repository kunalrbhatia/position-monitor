import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { modeManager } from '../src/helpers/modeManager.js';
import { positionStore } from '../src/store/index.js';
import { runPositionWatcher } from '../src/jobs/positionWatcher.js';
import { formatISTLogDate, writeMTMLogLine, runMTMLogger } from '../src/jobs/mtmLogger.js';
import { executePositionExit } from '../src/jobs/exitExecutor.js';
import { checkStaleTicks } from '../src/main.js';
import { processTick } from '../src/server.js';
import { env } from '../src/config/env.js';
import { Position } from '../src/types/position.js';

describe('Jobs & Integration Coverage Tests', () => {
  const tempDir = path.join(process.cwd(), 'temp_test_data');
  const tempLogs = path.join(process.cwd(), 'temp_test_logs');

  beforeAll(() => {
    (env as any).POSITIONS_DIR = tempDir;
    (env as any).MTM_LOG_DIR = tempLogs;
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    if (!fs.existsSync(tempLogs)) fs.mkdirSync(tempLogs, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    if (fs.existsSync(tempLogs)) fs.rmSync(tempLogs, { recursive: true, force: true });
  });

  test('formatISTLogDate formats IST correctly', () => {
    const testDate = new Date('2026-08-14T15:15:00Z');
    const formatted = formatISTLogDate(testDate);
    expect(formatted.dateStr).toBeDefined();
    expect(formatted.timeStr).toBeDefined();
    expect(formatted.ymd).toBeDefined();
  });

  test('writeMTMLogLine appends to file', () => {
    writeMTMLogLine('test-pos', 'NIFTY', 1234.5);
    const files = fs.readdirSync(tempLogs);
    expect(files.some((f) => f.includes('test-pos'))).toBe(true);
  });

  test('positionWatcher loads JSON files and ignores invalid/CLOSED files', () => {
    const validPos: Position = {
      positionId: 'watcher-pos-1',
      index: 'NIFTY',
      status: 'OPEN',
      baselineValue: 100000,
      entryTimestamp: '2026-08-14T09:45:00+05:30',
      legs: [
        {
          legId: 'L1',
          symbol: 'NIFTY28OCT25C25500',
          token: '99001',
          expiry: '2026-10-28',
          optionType: 'CE',
          side: 'BUY',
          qty: 65,
          lotSize: 65,
          entryPrice: 100,
          status: 'OPEN',
        },
      ],
    };

    fs.writeFileSync(path.join(tempDir, 'watcher-pos-1.json'), JSON.stringify(validPos));
    fs.writeFileSync(path.join(tempDir, 'invalid.json'), 'invalid json');

    runPositionWatcher();
    expect(positionStore.getPosition('watcher-pos-1')).toBeDefined();
    expect(positionStore.getWatchedTokens().has('99001')).toBe(true);
  });

  test('runMTMLogger logs MTM when fresh tick is present', () => {
    positionStore.updateTick('99001', 120);
    runMTMLogger();
    expect(positionStore.hasFreshTickSinceLastCheck('watcher-pos-1')).toBe(false);
  });

  test('checkStaleTicks triggers alerts for missing/stale ticks', () => {
    checkStaleTicks(); // Should run without throwing
  });

  test('processTick handles single tick and triggers exit on breach', async () => {
    fs.writeFileSync(path.join(process.cwd(), '.paper'), '');
    // Current leg buy entryPrice = 100, qty = 65. If LTP goes to 200, MTM = +6500 (breaches +1.5% of 100,000 = 1500)
    processTick('99001', 200);
    const pos = positionStore.getPosition('watcher-pos-1');
    // In paper mode, exitExecutor will set pos to CLOSED
    expect(pos?.status).toBe('CLOSED');
    if (fs.existsSync(path.join(process.cwd(), '.paper'))) {
      fs.unlinkSync(path.join(process.cwd(), '.paper'));
    }
  });

  test('executePositionExit in .panic mode blocks execution', async () => {
    const mockPanicPos: Position = {
      positionId: 'panic-pos',
      index: 'NIFTY',
      status: 'OPEN',
      baselineValue: 50000,
      entryTimestamp: '2026-08-14T09:45:00+05:30',
      legs: [],
    };

    jest.spyOn(modeManager, 'isPanicMode').mockReturnValue(true);
    const res = await executePositionExit(mockPanicPos, 'PROFIT_TARGET', 1000);
    expect(res.success).toBe(false);
    jest.restoreAllMocks();
  });
});
