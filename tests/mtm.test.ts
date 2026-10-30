import {
  calculateLegMTM,
  calculatePositionMTM,
  isMTMPlausible,
  realisedPnlOf,
} from '../src/helpers/mtm.js';
import { Position, Leg } from '../src/types/position.js';
import { positionStore } from '../src/store/index.js';

describe('MTM Helper Unit Tests', () => {
  const sampleLegBuy: Leg = {
    legId: 'L1',
    symbol: 'NIFTY28OCT25C25500',
    token: '45234',
    expiry: '2026-10-28',
    optionType: 'CE',
    side: 'BUY',
    qty: 65,
    lotSize: 65,
    entryPrice: 140.0,
    status: 'OPEN',
  };

  const sampleLegSell: Leg = {
    legId: 'L2',
    symbol: 'NIFTY21OCT25C25500',
    token: '44987',
    expiry: '2026-10-21',
    optionType: 'CE',
    side: 'SELL',
    qty: 130,
    lotSize: 65,
    entryPrice: 70.0,
    status: 'OPEN',
  };

  test('calculateLegMTM for BUY leg', () => {
    // BUY 65 qty @ 140.0, current LTP 150.0 => +10 * 65 = +650
    expect(calculateLegMTM(sampleLegBuy, 150.0)).toBe(650);
    // current LTP 130.0 => -10 * 65 = -650
    expect(calculateLegMTM(sampleLegBuy, 130.0)).toBe(-650);
  });

  test('calculateLegMTM for SELL leg', () => {
    // SELL 130 qty @ 70.0, current LTP 60.0 => +10 * 130 = +1300
    expect(calculateLegMTM(sampleLegSell, 60.0)).toBe(1300);
    // current LTP 80.0 => -10 * 130 = -1300
    expect(calculateLegMTM(sampleLegSell, 80.0)).toBe(-1300);
  });

  test('calculateLegMTM for CLOSED / EXPIRED_UNBOOKED leg returns 0', () => {
    const closedLeg: Leg = { ...sampleLegBuy, status: 'CLOSED' };
    const expiredLeg: Leg = { ...sampleLegBuy, status: 'EXPIRED_UNBOOKED' };
    expect(calculateLegMTM(closedLeg, 200.0)).toBe(0);
    expect(calculateLegMTM(expiredLeg, 0.0)).toBe(0);
  });

  test('calculatePositionMTM calculates total and handles missing LTPs', () => {
    const position: Position = {
      positionId: 'test-pos-01',
      index: 'NIFTY',
      status: 'OPEN',
      baselineValue: 100000,
      entryTimestamp: '2026-08-14T09:45:00+05:30',
      legs: [sampleLegBuy, sampleLegSell],
    };

    const cachePartial = new Map<string, number>([['45234', 150.0]]);
    const resPartial = calculatePositionMTM(position, cachePartial);
    expect(resPartial.hasAllLTPs).toBe(false);
    expect(resPartial.missingTokens).toEqual(['44987']);

    const cacheFull = new Map<string, number>([
      ['45234', 150.0], // +650
      ['44987', 60.0], // +1300
    ]);
    const resFull = calculatePositionMTM(position, cacheFull);
    expect(resFull.hasAllLTPs).toBe(true);
    expect(resFull.totalMTM).toBe(1950);
  });

  test('isMTMPlausible checks MTM against 5x margin', () => {
    const position: Position = {
      positionId: 'test-pos-01',
      index: 'RELIANCE',
      status: 'OPEN',
      marginUtilized: 165626.5,
      entryTimestamp: '2026-08-26T09:45:00+05:30',
      legs: [sampleLegBuy],
    };

    positionStore.setPosition(position);

    expect(isMTMPlausible(position, -5000)).toBe(true);
    expect(isMTMPlausible(position, 800000)).toBe(true);
    expect(isMTMPlausible(position, -17_877_319_518_125)).toBe(false);

    const noMarginPos: Position = { ...position, marginUtilized: undefined };
    positionStore.setPosition(noMarginPos);
    expect(isMTMPlausible(noMarginPos, -100)).toBe(false);
  });
});

describe('Realised-aware MTM (closed legs must not vanish from the P&L)', () => {
  const openLeg: Leg = {
    legId: 'L1',
    symbol: 'BANKNIFTY23NOV2655500CE',
    token: 't1',
    expiry: '2026-11-23',
    optionType: 'CE',
    side: 'SELL',
    qty: 90,
    lotSize: 30,
    entryPrice: 1227.38,
    status: 'OPEN',
  };
  const closedWithRealised: Leg = {
    legId: 'C1',
    symbol: 'BANKNIFTY23NOV2657800CE',
    token: 't2',
    expiry: '2026-11-23',
    optionType: 'CE',
    side: 'BUY',
    qty: 90,
    lotSize: 30,
    entryPrice: 314.4,
    realisedPnl: -23643,
    status: 'CLOSED',
  };
  const closedWithoutRealised: Leg = { ...closedWithRealised, legId: 'C2', realisedPnl: undefined };

  const makePos = (legs: Leg[]): Position => ({
    positionId: 'realised-pos',
    index: 'BANKNIFTY',
    status: 'OPEN',
    marginUtilized: 420106.72,
    ptAmount: 43200,
    entryTimestamp: '2026-09-30T09:58:29.913Z',
    legs,
  });

  test('realisedPnlOf returns 0 when every leg is open', () => {
    expect(realisedPnlOf(makePos([openLeg]))).toBe(0);
  });

  test('realisedPnlOf sums realisedPnl of closed legs and treats a missing value as 0', () => {
    expect(realisedPnlOf(makePos([openLeg, closedWithRealised, closedWithoutRealised]))).toBe(
      -23643,
    );
  });

  test('calculatePositionMTM includes realised P&L from closed legs', () => {
    // SELL 90 @1227.38 marked at 982.27 => +245.11 * 90 = +22,059.90 open
    const { totalMTM, hasAllLTPs } = calculatePositionMTM(
      makePos([openLeg, closedWithRealised]),
      new Map([['t1', 982.27]]),
    );
    expect(hasAllLTPs).toBe(true);
    expect(totalMTM).toBe(22059.9 - 23643);
    // The bug being fixed: open-only MTM (+22,059.90) is under the ₹43,200 PT, but a far larger
    // open mark used to sail past it once the losing leg disappeared from the file.
    expect(totalMTM).toBeLessThan(43200);
  });

  test('calculatePositionMTM is unchanged for positions with no closed legs', () => {
    const { totalMTM } = calculatePositionMTM(makePos([openLeg]), new Map([['t1', 982.27]]));
    expect(totalMTM).toBe(22059.9);
  });
});
