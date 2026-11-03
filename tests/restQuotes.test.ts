import { describe, test, expect, jest } from '@jest/globals';
import axios from 'axios';
import { fetchPositionLTPs } from '../src/helpers/restQuotes.js';
import { Position } from '../src/types/position.js';

const makePos = (): Position => ({
  positionId: 'reprice-pos',
  index: 'NIFTY',
  status: 'OPEN',
  marginUtilized: 150000,
  entryTimestamp: '2026-11-03T09:45:00+05:30',
  legs: [
    {
      legId: 'L1',
      symbol: 'NIFTY23NOV2622900CE',
      token: '64325',
      expiry: '2026-11-26',
      optionType: 'CE',
      side: 'BUY',
      qty: 130,
      lotSize: 65,
      entryPrice: 491.73,
      status: 'OPEN',
    },
    {
      legId: 'L2',
      symbol: 'NIFTY23NOV2623200CE',
      token: '64351',
      expiry: '2026-11-26',
      optionType: 'CE',
      side: 'SELL',
      qty: 260,
      lotSize: 65,
      entryPrice: 321.8,
      status: 'OPEN',
    },
    {
      legId: 'L3',
      symbol: 'NIFTY23NOV2623300CE',
      token: '64357',
      expiry: '2026-11-26',
      optionType: 'CE',
      side: 'BUY',
      qty: 130,
      lotSize: 65,
      entryPrice: 278.06,
      status: 'CLOSED',
    },
  ],
});

describe('restQuotes — re-pricing before an exit', () => {
  test('returns a price per OPEN leg and skips closed legs', async () => {
    const post = jest
      .spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { data: { ltp: 751.83 } } })
      .mockResolvedValueOnce({ data: { data: { ltp: 570.0 } } });

    const prices = await fetchPositionLTPs(makePos(), async () => 'jwt');

    expect(post).toHaveBeenCalledTimes(2);
    expect(prices?.get('64325')).toBe(751.83);
    expect(prices?.get('64351')).toBe(570.0);
    expect(prices?.has('64357')).toBe(false);
    post.mockRestore();
  });

  test('returns null without a broker token', async () => {
    const prices = await fetchPositionLTPs(makePos(), async () => null);
    expect(prices).toBeNull();
  });

  test('returns null when the broker sends no usable ltp', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: { data: { ltp: 0 } } });
    const prices = await fetchPositionLTPs(makePos(), async () => 'jwt');
    expect(prices).toBeNull();
    post.mockRestore();
  });

  test('returns null when a request throws, rather than a partial quote set', async () => {
    const post = jest.spyOn(axios, 'post').mockRejectedValueOnce(new Error('403'));
    const prices = await fetchPositionLTPs(makePos(), async () => 'jwt');
    expect(prices).toBeNull();
    post.mockRestore();
  });

  test('an all-closed position needs no quotes at all', async () => {
    const pos = makePos();
    pos.legs = pos.legs.map((leg) => ({ ...leg, status: 'CLOSED' as const }));
    const post = jest.spyOn(axios, 'post');
    const prices = await fetchPositionLTPs(pos, async () => 'jwt');
    expect(prices?.size).toBe(0);
    expect(post).not.toHaveBeenCalled();
    post.mockRestore();
  });
});
