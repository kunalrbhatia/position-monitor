import axios from 'axios';
import { env } from '../config/env.js';

export async function fetchMarginUtilized(jwtToken: string): Promise<number> {
  const response = await axios.get(
    'https://apiconnect.angelbroking.com/rest/secure/angelbroking/user/v1/getRMS',
    {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '02:00:00:00:00:00',
        'X-PrivateKey': env.API_KEY,
      },
      timeout: 10000,
    },
  );

  if (response.data && response.data.status === true && response.data.data) {
    const rawVal = response.data.data.utiliseddebits;
    const margin = parseFloat(rawVal);
    if (isNaN(margin) || margin <= 0) {
      throw new Error(`Invalid margin value returned: ${rawVal}`);
    }
    return margin;
  }

  throw new Error(response.data?.message || 'Failed to fetch RMS margin from Angel One');
}

export interface PositionMarginLegParam {
  exchange: 'NFO' | 'BFO';
  token: string;
  qty: number;
  entryPrice: number;
  side: 'BUY' | 'SELL';
}

export async function fetchBasketMarginUtilized(
  jwtToken: string,
  legs: PositionMarginLegParam[],
): Promise<number> {
  if (legs.length === 0) return 0;

  const positionsPayload = legs.map((leg) => ({
    exchange: leg.exchange,
    qty: leg.qty,
    price: leg.entryPrice,
    productType: 'CARRYFORWARD',
    token: leg.token,
    tradeType: leg.side,
  }));

  const response = await axios.post(
    'https://apiconnect.angelbroking.com/rest/secure/angelbroking/margin/v1/batch',
    { positions: positionsPayload },
    {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '02:00:00:00:00:00',
        'X-PrivateKey': env.API_KEY,
      },
      timeout: 10000,
    },
  );

  if (response.data && response.data.status === true && response.data.data) {
    const totalMargin =
      response.data.data.totalMargin ||
      response.data.data.marginRequired ||
      response.data.data.margin;
    const margin = typeof totalMargin === 'number' ? totalMargin : parseFloat(totalMargin);
    if (!isNaN(margin) && margin > 0) {
      return margin;
    }
  }

  throw new Error(response.data?.message || 'Failed to fetch batch margin from Angel One');
}
