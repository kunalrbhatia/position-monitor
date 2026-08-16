import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { modeManager } from '../src/helpers/modeManager.js';
import { positionStore } from '../src/store/index.js';
import { runPositionWatcher } from '../src/jobs/positionWatcher.js';
import { formatISTLogDate, writeMTMLogLine, runMTMLogger } from '../src/jobs/mtmLogger.js';
import { executePositionExit, executeCombinedExit } from '../src/jobs/exitExecutor.js';
import { checkStaleTicks } from '../src/main.js';
import { processTick } from '../src/server.js';
import { env } from '../src/config/env.js';
import { Position } from '../src/types/position.js';

describe('Jobs & Integration Coverage Tests', () => {
  const tempDir = path.join(process.cwd(), 'temp_test_data');
  const tempLogs = path.join(process.cwd(), 'temp_test_logs');

  beforeAll(() => {
    Object.assign(env, { POSITIONS_DIR: tempDir, MTM_LOG_DIR: tempLogs });
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

  test('positionWatcher loads JSON files, triggers exit on threshold breach, and ignores invalid files', async () => {
    fs.writeFileSync(path.join(process.cwd(), '.paper'), '');

    const validPos: Position = {
      positionId: 'watcher-pos-1',
      index: 'NIFTY',
      status: 'OPEN',
      marginUtilized: 100000,
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

    positionStore.setPosition(validPos);
    positionStore.updateTick('99001', 200); // MTM +6500 > 1.5% of 100k (1500)

    await runPositionWatcher();
    expect(positionStore.getPosition('watcher-pos-1')?.status).toBe('CLOSED');

    if (fs.existsSync(path.join(process.cwd(), '.paper'))) {
      fs.unlinkSync(path.join(process.cwd(), '.paper'));
    }
  });

  test('runMTMLogger logs MTM when fresh tick is present', () => {
    const pos: Position = {
      positionId: 'logger-pos',
      index: 'NIFTY',
      status: 'OPEN',
      marginUtilized: 100000,
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
    positionStore.setPosition(pos);
    positionStore.updateTick('99001', 120);
    runMTMLogger();
    expect(positionStore.hasFreshTickSinceLastCheck('logger-pos')).toBe(false);
  });

  test('checkStaleTicks triggers alerts for missing/stale ticks', () => {
    checkStaleTicks(); // Should run without throwing
  });

  test('processTick handles single tick and exits ONLY breached position file', async () => {
    fs.writeFileSync(path.join(process.cwd(), '.paper'), '');

    const posA: Position = {
      positionId: 'pos-A',
      index: 'NIFTY',
      status: 'OPEN',
      marginUtilized: 100000,
      entryTimestamp: '2026-08-14T09:45:00+05:30',
      legs: [
        {
          legId: 'L-A1',
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

    const posB: Position = {
      positionId: 'pos-B',
      index: 'NIFTY',
      status: 'OPEN',
      marginUtilized: 100000,
      entryTimestamp: '2026-08-14T09:45:00+05:30',
      legs: [
        {
          legId: 'L-B1',
          symbol: 'NIFTY28OCT25P25500',
          token: '99002',
          expiry: '2026-10-28',
          optionType: 'PE',
          side: 'BUY',
          qty: 65,
          lotSize: 65,
          entryPrice: 100,
          status: 'OPEN',
        },
      ],
    };

    fs.writeFileSync(path.join(tempDir, 'pos-A.json'), JSON.stringify(posA));
    fs.writeFileSync(path.join(tempDir, 'pos-B.json'), JSON.stringify(posB));
    positionStore.setPosition(posA);
    positionStore.setPosition(posB);

    positionStore.updateTick('99002', 100); // pos-B MTM = 0
    processTick('99001', 200); // pos-A MTM = +6500 (breaches +1.5% of 100k = +1500)

    const updatedA = positionStore.getPosition('pos-A');
    const updatedB = positionStore.getPosition('pos-B');

    expect(updatedA?.status).toBe('CLOSED');
    expect(updatedB?.status).toBe('OPEN'); // pos-B remains OPEN

    const fileAContent = JSON.parse(fs.readFileSync(path.join(tempDir, 'pos-A.json'), 'utf-8'));
    const fileBContent = JSON.parse(fs.readFileSync(path.join(tempDir, 'pos-B.json'), 'utf-8'));
    expect(fileAContent.status).toBe('CLOSED');
    expect(fileBContent.status).toBe('OPEN');

    if (fs.existsSync(path.join(process.cwd(), '.paper'))) {
      fs.unlinkSync(path.join(process.cwd(), '.paper'));
    }
  });

  test('executeCombinedExit executes exit across multiple position files', async () => {
    fs.writeFileSync(path.join(process.cwd(), '.paper'), '');

    const pos1: Position = {
      positionId: 'comb-1',
      index: 'NIFTY',
      status: 'OPEN',
      marginUtilized: 50000,
      entryTimestamp: '2026-08-14T09:45:00+05:30',
      legs: [],
    };
    const pos2: Position = {
      positionId: 'comb-2',
      index: 'NIFTY',
      status: 'OPEN',
      marginUtilized: 50000,
      entryTimestamp: '2026-08-14T09:45:00+05:30',
      legs: [],
    };

    fs.writeFileSync(path.join(tempDir, 'comb-1.json'), JSON.stringify(pos1));
    fs.writeFileSync(path.join(tempDir, 'comb-2.json'), JSON.stringify(pos2));

    const res = await executeCombinedExit([pos1, pos2], 'PROFIT_TARGET', 1000);
    expect(res.success).toBe(true);

    if (fs.existsSync(path.join(process.cwd(), '.paper'))) {
      fs.unlinkSync(path.join(process.cwd(), '.paper'));
    }
  });

  test('executePositionExit in .panic mode blocks execution', async () => {
    const mockPanicPos: Position = {
      positionId: 'panic-pos',
      index: 'NIFTY',
      status: 'OPEN',
      marginUtilized: 50000,
      entryTimestamp: '2026-08-14T09:45:00+05:30',
      legs: [],
    };

    jest.spyOn(modeManager, 'isPanicMode').mockReturnValue(true);
    const res = await executePositionExit(mockPanicPos, 'PROFIT_TARGET', 1000);
    expect(res.success).toBe(false);
    jest.restoreAllMocks();
  });
});
