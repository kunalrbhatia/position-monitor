import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { positionStore } from '../src/store/index.js';
import { Position } from '../src/types/position.js';
import { PositionMarginLegParam } from '../src/helpers/margin.js';

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

  test('successfully calculates marginUtilized per position and saves to JSON file', async () => {
    const posWithoutMargin: Position = {
      positionId: 'pos-backfill-1',
      index: 'NIFTY',
      status: 'OPEN',
      marginUtilized: null,
      entryTimestamp: '2026-08-15T10:00:00+05:30',
      legs: [
        {
          legId: 'L1',
          symbol: 'NIFTY28OCT25C25500',
          token: '1001',
          expiry: '2026-10-28',
          optionType: 'CE',
          side: 'BUY',
          qty: 50,
          lotSize: 50,
          entryPrice: 100,
          status: 'OPEN',
        },
      ],
    };

    const filePath = path.join(tempDir, 'pos-backfill-1.json');
    fs.writeFileSync(filePath, JSON.stringify(posWithoutMargin, null, 2));

    positionStore.setPosition(posWithoutMargin);

    const getBrokerSessionToken = jest
      .fn<() => Promise<string | null>>()
      .mockResolvedValue('valid_mock_jwt');
    const getMarginForLegs = jest
      .fn<(jwt: string, legs: PositionMarginLegParam[]) => Promise<number>>()
      .mockResolvedValue(75000.0);
    const getRMSMargin = jest.fn<(jwt: string) => Promise<number>>().mockResolvedValue(150000.0);

    await positionStore.backfillBaselineValues(
      tempDir,
      getBrokerSessionToken,
      getMarginForLegs,
      getRMSMargin,
    );

    const updatedPos = positionStore.getPosition('pos-backfill-1');
    expect(positionStore.getPositionMargin(updatedPos!)).toBe(75000.0);

    const savedFileContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(savedFileContent.marginUtilized).toBe(75000.0);
  });

  test('throws alert error when JWT token is missing', async () => {
    const posWithoutMargin: Position = {
      positionId: 'pos-backfill-2',
      index: 'NIFTY',
      status: 'OPEN',
      marginUtilized: null,
      entryTimestamp: '2026-08-15T10:00:00+05:30',
      legs: [],
    };

    positionStore.setPosition(posWithoutMargin);

    const getBrokerSessionToken = jest.fn<() => Promise<string | null>>().mockResolvedValue(null);
    const getMarginForLegs =
      jest.fn<(jwt: string, legs: PositionMarginLegParam[]) => Promise<number>>();
    const getRMSMargin = jest.fn<(jwt: string) => Promise<number>>();

    await expect(
      positionStore.backfillBaselineValues(
        tempDir,
        getBrokerSessionToken,
        getMarginForLegs,
        getRMSMargin,
      ),
    ).rejects.toThrow();
  });
});
