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
}

export async function placeBrokerExitOrder(
  jwtToken: string,
  order: OrderPayload,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const response = await axios.post(
      'https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/placeOrder',
      order,
      {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': '127.0.0.1',
          'X-ClientPublicIP': '127.0.0.1',
          'X-MACAddress': 'MAC',
          'X-PrivateKey': env.API_KEY,
        },
        timeout: 10000,
      },
    );

    if (response.data && response.data.status === true) {
      return { success: true, data: response.data };
    }
    return { success: false, error: response.data?.message || 'Order failed at broker' };
  } catch (err: any) {
    return { success: false, error: err.message || 'API request error' };
  }
}
