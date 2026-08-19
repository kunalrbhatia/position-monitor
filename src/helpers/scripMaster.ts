import fs from 'node:fs';
import axios from 'axios';
import zlib from 'zlib';
import { env } from '../config/env.js';
import { notifyAlert } from '../alerts/notifier.js';
import { Leg } from '../types/position.js';

export interface ScripRecord {
  token: string;
  symbol: string;
  name?: string;
  expiry?: string;
  strike?: string;
  lotsize?: string;
  instrumenttype?: string;
  exch_seg?: string;
}

let inMemoryScripMaster: Map<string, ScripRecord> | null = null;

export function parseScripMasterJson(jsonArray: unknown[]): Map<string, ScripRecord> {
  const map = new Map<string, ScripRecord>();
  if (!Array.isArray(jsonArray)) return map;

  for (const item of jsonArray) {
    if (typeof item === 'object' && item !== null) {
      const rec = item as Record<string, unknown>;
      const symbol = String(rec.symbol || rec.tradingsymbol || '').trim();
      const token = String(rec.token || '').trim();
      if (symbol && token) {
        map.set(symbol, {
          token,
          symbol,
          name: rec.name ? String(rec.name) : undefined,
          expiry: rec.expiry ? String(rec.expiry) : undefined,
          strike: rec.strike ? String(rec.strike) : undefined,
          lotsize: rec.lotsize ? String(rec.lotsize) : undefined,
          instrumenttype: rec.instrumenttype ? String(rec.instrumenttype) : undefined,
          exch_seg: rec.exch_seg ? String(rec.exch_seg) : undefined,
        });
      }
    }
  }
  return map;
}

export async function downloadScripMaster(): Promise<Map<string, ScripRecord>> {
  const url =
    'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    let jsonString: string;
    const buffer = Buffer.from(response.data);
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      jsonString = zlib.gunzipSync(buffer).toString('utf-8');
    } else {
      jsonString = buffer.toString('utf-8');
    }

    const data = JSON.parse(jsonString);
    return parseScripMasterJson(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notifyAlert(`[scripMaster] Failed to download scrip master: ${msg}`);
    return new Map();
  }
}

export async function loadScripMaster(customPath?: string): Promise<Map<string, ScripRecord>> {
  const filePath = customPath || env.SCRIP_MASTER_PATH;

  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      inMemoryScripMaster = parseScripMasterJson(data);
      return inMemoryScripMaster;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notifyAlert(`[scripMaster] Failed to parse local scrip master ${filePath}: ${msg}`);
    }
  }

  // Fallback download if local file is missing or invalid
  inMemoryScripMaster = await downloadScripMaster();
  return inMemoryScripMaster;
}

export interface ResolveTokensResult {
  tokenMap: Map<string, string>; // leg symbol -> resolved token
  updatedCount: number;
  missingSymbols: string[];
}

export function resolveTokensFromScripMaster(
  legs: Leg[],
  scripMaster: Map<string, ScripRecord>,
): ResolveTokensResult {
  const tokenMap = new Map<string, string>();
  let updatedCount = 0;
  const missingSymbols: string[] = [];

  for (const leg of legs) {
    if (leg.status !== 'OPEN') continue;

    const record = scripMaster.get(leg.symbol);
    if (record) {
      tokenMap.set(leg.symbol, record.token);
      if (record.token !== leg.token) {
        updatedCount++;
      }
    } else {
      missingSymbols.push(leg.symbol);
      tokenMap.set(leg.symbol, leg.token); // Keep existing if not found
    }
  }

  return {
    tokenMap,
    updatedCount,
    missingSymbols,
  };
}
