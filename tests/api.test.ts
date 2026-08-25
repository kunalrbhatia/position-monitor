import { describe, test, expect, jest } from '@jest/globals';
import axios from 'axios';
import { placeBrokerExitOrder, buildCommonHeaders } from '../src/helpers/api.js';
import { getBrokerSessionToken } from '../src/helpers/login.js';

describe('API & Login Helpers Unit Tests', () => {
  test('buildCommonHeaders generates proper headers', () => {
    const headers = buildCommonHeaders('test_jwt', '1.2.3.4');
    expect(headers.Authorization).toBe('Bearer test_jwt');
    expect(headers['X-ClientPublicIP']).toBe('1.2.3.4');
    expect(headers['User-Agent']).toContain('Mozilla/5.0');
    expect(headers['X-MACAddress']).toBe('02:00:00:00:00:00');
  });

  test('placeBrokerExitOrder sends variety NORMAL and duration DAY in request payload', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { status: true, message: 'SUCCESS', data: { orderid: '123' } },
    });

    const res = await placeBrokerExitOrder('token_abc', {
      tradingsymbol: 'RELIANCE28SEP26C2500',
      symboltoken: '12345',
      transactiontype: 'SELL',
      exchange: 'NFO',
      ordertype: 'MARKET',
      producttype: 'CARRYFORWARD',
      quantity: 250,
      variety: 'NORMAL',
      duration: 'DAY',
    });

    expect(res.success).toBe(true);
    expect(postSpy).toHaveBeenCalledWith(
      'https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/placeOrder',
      expect.objectContaining({
        variety: 'NORMAL',
        duration: 'DAY',
        tradingsymbol: 'RELIANCE28SEP26C2500',
      }),
      expect.any(Object),
    );
    postSpy.mockRestore();
  });

  test('placeBrokerExitOrder detects rate limit errors and formats error message', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 403,
        data: {
          message: 'exceeding access rate',
          errorcode: 'AB1001',
        },
      },
    });

    const res = await placeBrokerExitOrder('token_abc', {
      tradingsymbol: 'RELIANCE28SEP26C2500',
      symboltoken: '12345',
      transactiontype: 'SELL',
      exchange: 'NFO',
      ordertype: 'MARKET',
      producttype: 'CARRYFORWARD',
      quantity: 250,
      variety: 'NORMAL',
      duration: 'DAY',
    });

    expect(res.success).toBe(false);
    expect(res.rateLimited).toBe(true);
    expect(res.error).toContain('403 | exceeding access rate [Code: AB1001]');
    postSpy.mockRestore();
  });

  test('placeBrokerExitOrder handles failure gracefully without token', async () => {
    const res = await placeBrokerExitOrder('invalid_token', {
      tradingsymbol: 'NIFTY28OCT25C25500',
      symboltoken: '45234',
      transactiontype: 'SELL',
      exchange: 'NFO',
      ordertype: 'MARKET',
      producttype: 'CARRYFORWARD',
      quantity: 65,
      variety: 'NORMAL',
      duration: 'DAY',
    });
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  }, 15000);

  test('getBrokerSessionToken returns null when env variables missing', async () => {
    const token = await getBrokerSessionToken();
    expect(token).toBeNull();
  });
});
