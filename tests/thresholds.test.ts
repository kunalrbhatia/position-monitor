import { checkThresholds } from '../src/helpers/thresholds.js';

describe('Thresholds Unit Tests', () => {
  const baseline = 100000;
  // PT = +1.5% = +1500, SL = -2.0% = -2000

  test('returns breached: false when MTM within range', () => {
    expect(checkThresholds('pos1', baseline, 0)).toEqual({ breached: false });
    expect(checkThresholds('pos1', baseline, 1499)).toEqual({ breached: false });
    expect(checkThresholds('pos1', baseline, -1999)).toEqual({ breached: false });
  });

  test('returns PROFIT_TARGET when MTM >= +1.5%', () => {
    const res = checkThresholds('pos1', baseline, 1500);
    expect(res.breached).toBe(true);
    expect(res.type).toBe('PROFIT_TARGET');
    expect(res.thresholdValue).toBe(1500);
  });

  test('returns STOP_LOSS when MTM <= -2.0%', () => {
    const res = checkThresholds('pos1', baseline, -2000);
    expect(res.breached).toBe(true);
    expect(res.type).toBe('STOP_LOSS');
    expect(res.thresholdValue).toBe(-2000);
  });

  test('blocks checks and alerts when baselineValue is missing or invalid', () => {
    expect(checkThresholds('pos1', undefined, 5000)).toEqual({ breached: false });
    expect(checkThresholds('pos1', 0, 5000)).toEqual({ breached: false });
    expect(checkThresholds('pos1', -100, 5000)).toEqual({ breached: false });
  });

  test('absolute PT hit with baselineValue = null triggers PROFIT_TARGET without baselineValue', () => {
    const res = checkThresholds('pos1', null, 43200, undefined, undefined, 43200, null);
    expect(res).toEqual({
      breached: true,
      type: 'PROFIT_TARGET',
      thresholdValue: 43200,
    });
  });

  test('slAmount = null with large negative MTM has breached: false (SL disabled)', () => {
    const res = checkThresholds('pos1', baseline, -500000, undefined, undefined, undefined, null);
    expect(res).toEqual({ breached: false });
  });

  test('legacy call (no overrides) still uses percentage behaviour', () => {
    expect(checkThresholds('pos1', baseline, 1500)).toEqual({
      breached: true,
      type: 'PROFIT_TARGET',
      thresholdValue: 1500,
    });
    expect(checkThresholds('pos1', baseline, -2000)).toEqual({
      breached: true,
      type: 'STOP_LOSS',
      thresholdValue: -2000,
    });
  });

  test('absolute slAmount triggers STOP_LOSS at the right value', () => {
    const res = checkThresholds('pos1', baseline, -3000, undefined, undefined, undefined, 3000);
    expect(res).toEqual({
      breached: true,
      type: 'STOP_LOSS',
      thresholdValue: -3000,
    });
    expect(checkThresholds('pos1', baseline, -2500, undefined, undefined, undefined, 3000)).toEqual(
      {
        breached: false,
      },
    );
  });

  test('absolute PT takes precedence over percentage', () => {
    // baseline 100000, default PT is 1500, but absolute ptAmount is 5000
    expect(checkThresholds('pos1', baseline, 2000, 1.5, 2.0, 5000, undefined)).toEqual({
      breached: false,
    });
    expect(checkThresholds('pos1', baseline, 5000, 1.5, 2.0, 5000, undefined)).toEqual({
      breached: true,
      type: 'PROFIT_TARGET',
      thresholdValue: 5000,
    });
  });
});
