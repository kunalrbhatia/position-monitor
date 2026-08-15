import { describe, test, expect } from '@jest/globals';
import { placeBrokerExitOrder } from '../src/helpers/api.js';
import { getBrokerSessionToken } from '../src/helpers/login.js';

describe('API & Login Helpers Unit Tests', () => {
  test('placeBrokerExitOrder handles failure gracefully without token', async () => {
    const res = await placeBrokerExitOrder('invalid_token', {
      tradingsymbol: 'NIFTY28OCT25C25500',
      symboltoken: '45234',
      transactiontype: 'SELL',
      exchange: 'NFO',
      ordertype: 'MARKET',
      producttype: 'CARRYFORWARD',
      quantity: 65,
    });
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });

  test('getBrokerSessionToken returns null when env variables missing', async () => {
    const token = await getBrokerSessionToken();
    expect(token).toBeNull();
  });
});
