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
    const watcherFileContent = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'watcher-pos-1.json'), 'utf-8'),
    );
    expect(watcherFileContent.status).toBe('CLOSED');

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
    processTick('99001', 200); // pos-A MTM = +6500 (1st check: recorded in breachStateMap)
    processTick('99001', 200); // pos-A MTM = +6500 (2nd check: breach confirmed & exit executed)

    const updatedB = positionStore.getPosition('pos-B');

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

  test('cooldown skips broker order when called within EXIT_RETRY_COOLDOWN_MS', async () => {
    const pos: Position = {
      positionId: 'cooldown-pos',
      index: 'NIFTY',
      status: 'OPEN',
      marginUtilized: 100000,
      entryTimestamp: '2026-08-14T09:45:00+05:30',
      legs: [
        {
          legId: 'L-CD1',
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
    positionStore.updateTick('99001', 200);

    const axiosModule = await import('axios');
    const postSpy = jest.spyOn(axiosModule.default, 'post').mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: 'Invalid order' } },
    });

    env.API_KEY = 'test';
    env.CLIENT_CODE = 'test';
    env.CLIENT_PIN = 'test';
    env.CLIENT_TOTP_PIN = 'test';
    const paperSpy = jest.spyOn(modeManager, 'isPaperMode').mockReturnValue(false);

    // First attempt: should call broker (axios.post)
    const res1 = await executePositionExit(pos, 'PROFIT_TARGET', 5000);
    expect(res1.closedLegs.length).toBe(0);

    // Second attempt immediately after: skipped due to cooldown
    const res2 = await executePositionExit(pos, 'PROFIT_TARGET', 5000);
    expect(res2.success).toBe(false);

    postSpy.mockRestore();
    paperSpy.mockRestore();
  });

  test('max attempts cap blocks execution after EXIT_MAX_ATTEMPTS_PER_DAY failures', async () => {
    const pos: Position = {
      positionId: 'max-attempts-pos',
      index: 'NIFTY',
      status: 'OPEN',
      marginUtilized: 100000,
      entryTimestamp: '2026-08-14T09:45:00+05:30',
      legs: [
        {
          legId: 'L-MA1',
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
      exitState: {
        attemptCount: 5,
        lastAttemptDate: new Date().toISOString().split('T')[0],
      },
    };
    positionStore.setPosition(pos);

    const axiosModule = await import('axios');
    const postSpy = jest.spyOn(axiosModule.default, 'post');

    const res = await executePositionExit(pos, 'PROFIT_TARGET', 5000);
    expect(res.success).toBe(false);
    expect(postSpy).not.toHaveBeenCalled();

    postSpy.mockRestore();
  });

  test('does not rewrite JSON file when all legs fail and no status changed', async () => {
    const pos: Position = {
      positionId: 'no-rewrite-pos',
      index: 'NIFTY',
      status: 'OPEN',
      marginUtilized: 100000,
      entryTimestamp: '2026-08-14T09:45:00+05:30',
      legs: [
        {
          legId: 'L-NR1',
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

    const writeSpy = jest.spyOn(fs, 'writeFileSync');
    const axiosModule = await import('axios');
    const paperSpy = jest.spyOn(modeManager, 'isPaperMode').mockReturnValue(false);

    const postSpy = jest.spyOn(axiosModule.default, 'post').mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: 'Order failed' } },
    });

    await executePositionExit(pos, 'PROFIT_TARGET', 5000);
    expect(writeSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('no-rewrite-pos.json'),
      expect.any(String),
      expect.any(String),
    );

    writeSpy.mockRestore();
    postSpy.mockRestore();
    paperSpy.mockRestore();
  });

  test('executePositionExit Guard C refuses exit when MTM > 5x margin', async () => {
    const pos: Position = {
      positionId: 'guard-c-pos',
      index: 'RELIANCE',
      status: 'OPEN',
      marginUtilized: 100000,
      entryTimestamp: '2026-08-26T09:45:00+05:30',
      legs: [
        {
          legId: 'L1',
          symbol: 'RELIANCE28OCT25C2500',
          token: '144389',
          expiry: '2026-10-28',
          optionType: 'CE',
          side: 'BUY',
          qty: 250,
          lotSize: 250,
          entryPrice: 10,
          status: 'OPEN',
        },
      ],
    };
    positionStore.setPosition(pos);

    const res = await executePositionExit(pos, 'STOP_LOSS', -17_877_319_518_125);
    expect(res.success).toBe(false);
    expect(res.failedLegs).toEqual(['L1']);
  });

  test('executePositionExit Guard D refuses exit when .kill file exists', async () => {
    const killPath = path.join(process.cwd(), '.kill');
    fs.writeFileSync(killPath, '');

    const pos: Position = {
      positionId: 'guard-d-pos',
      index: 'RELIANCE',
      status: 'OPEN',
      marginUtilized: 100000,
      entryTimestamp: '2026-08-26T09:45:00+05:30',
      legs: [
        {
          legId: 'L1',
          symbol: 'RELIANCE28OCT25C2500',
          token: '144389',
          expiry: '2026-10-28',
          optionType: 'CE',
          side: 'BUY',
          qty: 250,
          lotSize: 250,
          entryPrice: 10,
          status: 'OPEN',
        },
      ],
    };
    positionStore.setPosition(pos);

    const res = await executePositionExit(pos, 'STOP_LOSS', -5000);
    expect(res.success).toBe(false);
    expect(res.failedLegs).toEqual(['L1']);

    if (fs.existsSync(killPath)) fs.unlinkSync(killPath);
  });
});
