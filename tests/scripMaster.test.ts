import {
  parseScripMasterJson,
  resolveTokensFromScripMaster,
  ScripRecord,
} from '../src/helpers/scripMaster.js';
import { Leg } from '../src/types/position.js';

describe('scripMaster helper tests', () => {
  it('parses raw scrip master JSON array correctly', () => {
    const rawData = [
      {
        token: '67046',
        symbol: 'ABB25AUG267500PE',
        name: 'ABB',
        expiry: '25AUG2026',
        strike: '7500',
        lotsize: '125',
        instrumenttype: 'OPTSTK',
        exch_seg: 'NFO',
      },
      {
        tradingsymbol: 'NIFTY25AUG2624500CE',
        token: '99001',
      },
    ];

    const map = parseScripMasterJson(rawData);
    expect(map.size).toBe(2);

    const record1 = map.get('ABB25AUG267500PE');
    expect(record1).toBeDefined();
    expect(record1?.token).toBe('67046');

    const record2 = map.get('NIFTY25AUG2624500CE');
    expect(record2).toBeDefined();
    expect(record2?.token).toBe('99001');
  });

  it('resolves tokens and identifies missing or updated symbols', () => {
    const scripMap = new Map<string, ScripRecord>([
      ['ABB25AUG267500PE', { token: '67123', symbol: 'ABB25AUG267500PE' }],
      ['NIFTY25AUG2624500CE', { token: '99001', symbol: 'NIFTY25AUG2624500CE' }],
    ]);

    const openLegs: Leg[] = [
      {
        token: '67046', // Old token
        symbol: 'ABB25AUG267500PE',
        qty: 125,
        side: 'BUY',
        entryPrice: 100,
        status: 'OPEN',
      },
      {
        token: '99001', // Same token
        symbol: 'NIFTY25AUG2624500CE',
        qty: 50,
        side: 'SELL',
        entryPrice: 200,
        status: 'OPEN',
      },
      {
        token: '55555',
        symbol: 'UNKNOWN_SYMBOL',
        qty: 25,
        side: 'BUY',
        entryPrice: 50,
        status: 'OPEN',
      },
    ];

    const result = resolveTokensFromScripMaster(openLegs, scripMap);

    expect(result.updatedCount).toBe(1);
    expect(result.missingSymbols).toEqual(['UNKNOWN_SYMBOL']);
    expect(result.tokenMap.get('ABB25AUG267500PE')).toBe('67123');
    expect(result.tokenMap.get('NIFTY25AUG2624500CE')).toBe('99001');
    expect(result.tokenMap.get('UNKNOWN_SYMBOL')).toBe('55555');
  });
});
