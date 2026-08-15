import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { positionStore } from '../src/store/index.js';
import { Position } from '../src/types/position.js';

describe('PositionStore backfillBaselineValues Unit Tests', () => {
  const tempDir = path.join(process.cwd(), 'temp_store_test_data');

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('successfully backfills missing baselineValue from RMS margin and updates JSON file', async () => {
    const posWithoutBaseline: Position = {
      positionId: 'pos-backfill-1',
      index: 'NIFTY',
      status: 'OPEN',
      baselineValue: null,
      entryTimestamp: '2026-08-15T10:00:00+05:30',
      legs: [],
    };

    const filePath = path.join(tempDir, 'pos-backfill-1.json');
    fs.writeFileSync(filePath, JSON.stringify(posWithoutBaseline, null, 2));

    positionStore.setPosition(posWithoutBaseline);

    const getBrokerSessionToken = jest.fn<any>().mockResolvedValue('valid_mock_jwt');
    const fetchMarginUtilized = jest.fn<any>().mockResolvedValue(150000.5);

    await positionStore.backfillBaselineValues(tempDir, getBrokerSessionToken, fetchMarginUtilized);

    const updatedPos = positionStore.getPosition('pos-backfill-1');
    expect(updatedPos?.baselineValue).toBe(150000.5);

    const savedFileContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(savedFileContent.baselineValue).toBe(150000.5);
  });

  test('handles missing JWT token gracefully without throwing', async () => {
    const posWithoutBaseline: Position = {
      positionId: 'pos-backfill-2',
      index: 'NIFTY',
      status: 'OPEN',
      baselineValue: null,
      entryTimestamp: '2026-08-15T10:00:00+05:30',
      legs: [],
    };

    positionStore.setPosition(posWithoutBaseline);

    const getBrokerSessionToken = jest.fn<any>().mockResolvedValue(null);
    const fetchMarginUtilized = jest.fn<any>();

    await positionStore.backfillBaselineValues(tempDir, getBrokerSessionToken, fetchMarginUtilized);

    const pos = positionStore.getPosition('pos-backfill-2');
    expect(pos?.baselineValue).toBeNull();
  });

  test('handles margin fetch exception gracefully without throwing', async () => {
    const posWithoutBaseline: Position = {
      positionId: 'pos-backfill-3',
      index: 'NIFTY',
      status: 'OPEN',
      baselineValue: null,
      entryTimestamp: '2026-08-15T10:00:00+05:30',
      legs: [],
    };

    positionStore.setPosition(posWithoutBaseline);

    const getBrokerSessionToken = jest.fn<any>().mockResolvedValue('valid_jwt');
    const fetchMarginUtilized = jest
      .fn<any>()
      .mockRejectedValue(new Error('Broker API maintenance'));

    await positionStore.backfillBaselineValues(tempDir, getBrokerSessionToken, fetchMarginUtilized);

    const pos = positionStore.getPosition('pos-backfill-3');
    expect(pos?.baselineValue).toBeNull();
  });
});
