import { describe, test, expect, jest, beforeEach } from '@jest/globals';

describe('Margin Helper Unit Tests', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('successfully returns parsed margin utilized number from RMS API', async () => {
    jest.unstable_mockModule('axios', () => ({
      default: {
        get: jest.fn().mockResolvedValue({
          data: {
            status: true,
            message: 'SUCCESS',
            data: {
              utiliseddebits: '12345.67',
            },
          },
        }),
        post: jest.fn(),
      },
    }));

    const { fetchMarginUtilized: fetchMargin } = await import('../src/helpers/margin.js');
    const margin = await fetchMargin('mock_jwt_token');
    expect(margin).toBe(12345.67);
  });

  test('successfully returns batch margin from Angel One Batch Margin API', async () => {
    jest.unstable_mockModule('axios', () => ({
      default: {
        get: jest.fn(),
        post: jest.fn().mockResolvedValue({
          data: {
            status: true,
            message: 'SUCCESS',
            data: {
              totalMargin: 75000.5,
            },
          },
        }),
      },
    }));

    const { fetchBasketMarginUtilized } = await import('../src/helpers/margin.js');
    const margin = await fetchBasketMarginUtilized('mock_jwt_token', [
      {
        exchange: 'NFO',
        token: '1001',
        qty: 50,
        entryPrice: 100,
        side: 'BUY',
      },
    ]);
    expect(margin).toBe(75000.5);
  });

  test('fetchBasketMarginUtilized returns 0 when legs array is empty', async () => {
    const { fetchBasketMarginUtilized } = await import('../src/helpers/margin.js');
    const margin = await fetchBasketMarginUtilized('mock_jwt_token', []);
    expect(margin).toBe(0);
  });

  test('fetchBasketMarginUtilized throws error on broker failure or invalid response', async () => {
    jest.unstable_mockModule('axios', () => ({
      default: {
        get: jest.fn(),
        post: jest.fn().mockResolvedValue({
          data: {
            status: false,
            message: 'Margin calculation failed',
          },
        }),
      },
    }));

    const { fetchBasketMarginUtilized } = await import('../src/helpers/margin.js');
    await expect(
      fetchBasketMarginUtilized('mock_jwt_token', [
        {
          exchange: 'NFO',
          token: '1001',
          qty: 50,
          entryPrice: 100,
          side: 'BUY',
        },
      ]),
    ).rejects.toThrow('Margin calculation failed');
  });

  test('throws error on non-true status from broker RMS', async () => {
    jest.unstable_mockModule('axios', () => ({
      default: {
        get: jest.fn().mockResolvedValue({
          data: {
            status: false,
            message: 'Invalid token',
          },
        }),
        post: jest.fn(),
      },
    }));

    const { fetchMarginUtilized: fetchMargin } = await import('../src/helpers/margin.js');
    await expect(fetchMargin('bad_jwt')).rejects.toThrow('Invalid token');
  });

  test('throws error when utiliseddebits is invalid or NaN', async () => {
    jest.unstable_mockModule('axios', () => ({
      default: {
        get: jest.fn().mockResolvedValue({
          data: {
            status: true,
            data: {
              utiliseddebits: 'invalid_number',
            },
          },
        }),
        post: jest.fn(),
      },
    }));

    const { fetchMarginUtilized: fetchMargin } = await import('../src/helpers/margin.js');
    await expect(fetchMargin('mock_jwt')).rejects.toThrow(
      'Invalid margin value returned: invalid_number',
    );
  });

  test('throws error on network or HTTP failure', async () => {
    jest.unstable_mockModule('axios', () => ({
      default: {
        get: jest.fn().mockRejectedValue(new Error('Network Error')),
        post: jest.fn(),
      },
    }));

    const { fetchMarginUtilized: fetchMargin } = await import('../src/helpers/margin.js');
    await expect(fetchMargin('mock_jwt')).rejects.toThrow('Network Error');
  });
});
