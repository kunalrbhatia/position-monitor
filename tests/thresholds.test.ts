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
    expect(checkThresholds('pos1', undefined as any, 5000)).toEqual({ breached: false });
    expect(checkThresholds('pos1', 0, 5000)).toEqual({ breached: false });
    expect(checkThresholds('pos1', -100, 5000)).toEqual({ breached: false });
  });
});
