import axios from 'axios';
import { env } from '../config/env.js';

export interface OrderPayload {
  tradingsymbol: string;
  symboltoken: string;
  transactiontype: 'BUY' | 'SELL';
  exchange: 'NFO' | 'BFO';
  ordertype: 'MARKET';
  producttype: 'CARRYFORWARD' | 'INTRADAY';
  quantity: number;
  variety: 'NORMAL';
  duration: 'DAY';
}

export function buildCommonHeaders(
  jwtToken?: string,
  publicIP = '127.0.0.1',
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '127.0.0.1',
    'X-ClientPublicIP': publicIP,
    'X-MACAddress': '02:00:00:00:00:00',
    'X-PrivateKey': env.API_KEY,
  };
  if (jwtToken) {
    headers.Authorization = `Bearer ${jwtToken}`;
  }
  return headers;
}

export interface PlaceOrderResult {
  success: boolean;
  data?: unknown;
  error?: string;
  status?: number;
  rateLimited?: boolean;
}

export async function placeBrokerExitOrder(
  jwtToken: string,
  order: OrderPayload,
): Promise<PlaceOrderResult> {
  try {
    const response = await axios.post(
      'https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/placeOrder',
      order,
      {
        headers: buildCommonHeaders(jwtToken),
        timeout: 10000,
      },
    );

    if (response.data && response.data.status === true) {
      return { success: true, data: response.data };
    }

    const message = response.data?.message || 'Order failed at broker';
    const errorCode = response.data?.errorcode ? ` [Code: ${response.data.errorcode}]` : '';
    const fullError = `${message}${errorCode}`;
    const rateLimited = /rate|exceed|too many requests/i.test(fullError);

    return {
      success: false,
      error: fullError,
      status: response.status,
      rateLimited,
    };
  } catch (err: unknown) {
    let status: number | undefined;
    let errorMsg = 'API request error';
    let rateLimited = false;

    if (axios.isAxiosError(err)) {
      status = err.response?.status;
      const data = err.response?.data;
      const apiMessage = data?.message || data?.messageStr || err.message;
      const errorCode = data?.errorcode ? ` [Code: ${data.errorcode}]` : '';
      errorMsg = `${status ? `${status} | ` : ''}${apiMessage}${errorCode}`;
      const resString = JSON.stringify(data || {});
      rateLimited =
        status === 429 || /rate|exceed|too many requests/i.test(`${err.message} ${resString}`);
    } else if (err instanceof Error) {
      errorMsg = err.message;
      rateLimited = /rate|exceed|too many requests/i.test(errorMsg);
    }

    return {
      success: false,
      error: errorMsg,
      status,
      rateLimited,
    };
  }
}
