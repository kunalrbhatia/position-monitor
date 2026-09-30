import { PositionSchema } from '../src/types/position.js';

describe('Position Schema Validation', () => {
  test('successfully parses a position with index BANKNIFTY, ptAmount, and slAmount = null', () => {
    const rawPosition = {
      positionId: 'banknifty_ironfly_23_nov_26',
      index: 'BANKNIFTY',
      status: 'OPEN',
      ptAmount: 43200,
      slAmount: null,
      entryTimestamp: '2026-09-30T09:15:00+05:30',
      legs: [
        {
          legId: 'L1',
          symbol: 'BANKNIFTY23NOV2655500CE',
          token: '62165',
          expiry: '2026-11-23',
          optionType: 'CE',
          side: 'SELL',
          qty: 90,
          lotSize: 15,
          entryPrice: 1230.0,
          status: 'OPEN',
        },
        {
          legId: 'L2',
          symbol: 'BANKNIFTY23NOV2655500PE',
          token: '62167',
          expiry: '2026-11-23',
          optionType: 'PE',
          side: 'SELL',
          qty: 90,
          lotSize: 15,
          entryPrice: 1055.0,
          status: 'OPEN',
        },
        {
          legId: 'L3',
          symbol: 'BANKNIFTY23NOV2653200PE',
          token: '62103',
          expiry: '2026-11-23',
          optionType: 'PE',
          side: 'BUY',
          qty: 90,
          lotSize: 15,
          entryPrice: 410.0,
          status: 'OPEN',
        },
        {
          legId: 'L4',
          symbol: 'BANKNIFTY23NOV2657800CE',
          token: '62231',
          expiry: '2026-11-23',
          optionType: 'CE',
          side: 'BUY',
          qty: 90,
          lotSize: 15,
          entryPrice: 314.0,
          status: 'OPEN',
        },
      ],
    };

    const parsed = PositionSchema.safeParse(rawPosition);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.index).toBe('BANKNIFTY');
      expect(parsed.data.ptAmount).toBe(43200);
      expect(parsed.data.slAmount).toBeNull();
    }
  });

  test('rejects negative or zero ptAmount/slAmount when provided as number', () => {
    const invalidPt = {
      positionId: 'pos-invalid-pt',
      index: 'BANKNIFTY',
      status: 'OPEN',
      ptAmount: -100,
      entryTimestamp: '2026-09-30T09:15:00+05:30',
      legs: [],
    };
    expect(PositionSchema.safeParse(invalidPt).success).toBe(false);

    const zeroPt = {
      positionId: 'pos-zero-pt',
      index: 'BANKNIFTY',
      status: 'OPEN',
      ptAmount: 0,
      entryTimestamp: '2026-09-30T09:15:00+05:30',
      legs: [],
    };
    expect(PositionSchema.safeParse(zeroPt).success).toBe(false);
  });
});
