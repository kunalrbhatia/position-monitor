#!/usr/bin/env node
/**
 * Position P&L Reporter (ESM)
 * Fetches live LTPs for all position legs and prints a formatted
 * P&L report with PT/SL thresholds + delta-neutrality check per position.
 * Designed to run as a no_agent cron job.
 *
 * Quiet when: weekend, outside market hours (9:30-15:30 IST), no position
 * files, or no open legs — so the cron stays silent outside trading windows.
 */
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as otplibModule from 'otplib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const POSITIONS_DIR = path.join(__dirname, '..', 'data', 'positions');
const BASE_URL = 'https://apiconnect.angelbroking.com';

// Underlying → equity spot lookup (NSE). Used for the delta-neutrality check.
// RELIANCE=2885, ABB=13 (verified from Angel's full scrip master). NIFTY is an index (99926000).
const UNDERLYING_SPOT_MAP = {
  NIFTY: { token: '99926000', symbol: 'Nifty 50' },
  BANKNIFTY: { token: '99926009', symbol: 'Nifty Bank' },
  FINNIFTY: { token: '99926037', symbol: 'Nifty Fin Service' },
  SENSEX: { token: '99926000', symbol: 'Nifty 50' },
  RELIANCE: { token: '2885', symbol: 'RELIANCE-EQ' },
  ABB: { token: '13', symbol: 'ABB-EQ' },
  // Commodities have no index spot — use the nearest GOLDM futures as the underlying proxy.
  GOLDM: { token: '571445', symbol: 'GOLDM05NOV26FUT', exchange: 'MCX' },
};

// Commodity F&O lives on MCX, SENSEX on BFO, everything else on NFO.
function exchangeFor(index) {
  if (index === 'SENSEX') return 'BFO';
  if (
    [
      'GOLDM',
      'GOLDMINI',
      'SILVER',
      'SILVERMINI',
      'CRUDEOIL',
      'CRUDEOILMINI',
      'NATURALGAS',
    ].includes(index)
  ) {
    return 'MCX';
  }
  return 'NFO';
}

const MONTHS = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

// ---------- Time gating (IST) ----------
function isTradingTime() {
  if (process.env.PNL_FORCE === '1') return true; // test bypass
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false; // weekend
  const h = ist.getHours();
  const m = ist.getMinutes();
  const minutes = h * 60 + m;
  return minutes >= 9 * 60 + 30 && minutes <= 15 * 60 + 30; // 9:30 - 15:30
}

// ---------- Login ----------
async function login() {
  const secret = process.env.CLIENT_TOTP_PIN || process.env.ANGEL_TOTP_SECRET;
  const generateSync = otplibModule.generateSync;
  const createGuardrails = otplibModule.createGuardrails;
  const totp = generateSync({
    secret,
    guardrails: createGuardrails({
      MIN_SECRET_BYTES: Math.min(10, secret.length),
    }),
  });
  const publicIP = await axios
    .get('https://api.ipify.org', { timeout: 5000 })
    .then((r) => r.data)
    .catch(() => '127.0.0.1');

  const resp = await axios.post(
    `${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`,
    {
      clientcode: process.env.CLIENT_CODE || process.env.ANGEL_CLIENT_ID,
      password: process.env.CLIENT_PIN || process.env.ANGEL_PASSWORD,
      totp,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': publicIP,
        'X-MACAddress': '02:00:00:00:00:00',
        'X-PrivateKey': process.env.API_KEY || process.env.ANGEL_API_KEY,
      },
      timeout: 15000,
    },
  );

  if (resp.data && resp.data.status === true && resp.data.data?.jwtToken) {
    return { jwtToken: resp.data.data.jwtToken, publicIP };
  }
  throw new Error(resp.data?.message || 'Login failed');
}

// ---------- Fetch LTP for one leg (with rate-limit friendly pacing) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchLTP(jwtToken, publicIP, exchange, symbol, token, retries = 2) {
  try {
    const resp = await axios.post(
      `${BASE_URL}/rest/secure/angelbroking/order/v1/getLtpData`,
      {
        exchange,
        tradingsymbol: symbol,
        symboltoken: token,
      },
      {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': '127.0.0.1',
          'X-ClientPublicIP': publicIP,
          'X-MACAddress': '02:00:00:00:00:00',
          'X-PrivateKey': process.env.API_KEY || process.env.ANGEL_API_KEY,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        timeout: 10000,
      },
    );

    if (resp.data && resp.data.status === true && resp.data.data) {
      return parseFloat(resp.data.data.ltp);
    }
    throw new Error(resp.data?.message || `LTP fetch failed for ${symbol}`);
  } catch (err) {
    // 403 = rate limit — wait and retry with backoff
    const status = err.response?.status;
    if ((status === 403 || status === 429) && retries > 0) {
      await sleep(2000);
      return fetchLTP(jwtToken, publicIP, exchange, symbol, token, retries - 1);
    }
    throw err;
  }
}

// ---------- Greeks (Black-Scholes) ----------
// Today"s fills — the only place an EXIT price exists: exitExecutor flips a leg to CLOSED without
// recording what it filled at. Angel scopes this to the current day, so the ledger accumulates it.
async function fetchTradeBook(jwtToken, publicIP) {
  try {
    const resp = await axios.post(
      `${BASE_URL}/rest/secure/angelbroking/order/v1/getTradeBook`,
      {},
      {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': '127.0.0.1',
          'X-ClientPublicIP': publicIP,
          'X-MACAddress': '02:00:00:00:00:00',
          'X-PrivateKey': process.env.API_KEY || process.env.ANGEL_API_KEY,
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 10000,
      },
    );
    const rows = resp.data && Array.isArray(resp.data.data) ? resp.data.data : [];
    return rows
      .map((t) => ({
        symbol: t.tradingsymbol,
        side: t.transactiontype,
        // Angel names the filled quantity `fillsize`; there is no `quantity` on a trade row.
        qty: Number(t.fillsize || t.fillsquantity || t.quantity || 0),
        price: Number(t.fillprice || t.averageprice || 0),
        time: t.filltime || '',
        orderId: t.orderid || '',
        fillId: t.fillid || '',
      }))
      .filter((t) => t.symbol && t.qty > 0 && t.price > 0);
  } catch {
    return null; // best-effort: a ledger gap beats a failed banner
  }
}

function normalCdf(x) {
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * absX);
  const erf = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * erf);
}

function blackScholesDelta(spot, strike, optionType, daysToExpiry, iv = 0.35) {
  if (daysToExpiry <= 0) {
    if (optionType === 'CE') return spot >= strike ? 1 : 0;
    return spot <= strike ? -1 : 0;
  }
  const t = daysToExpiry / 365;
  const d1 = (Math.log(spot / strike) + (0.06 + 0.5 * iv * iv) * t) / (iv * Math.sqrt(t));
  if (optionType === 'CE') return normalCdf(d1);
  return normalCdf(d1) - 1;
}

// Parse '29SEP2026' or '29SEP26' → days from today
function daysToExpiry(expiryStr) {
  if (!expiryStr) return 30;
  const m = expiryStr.match(/^(\d{2})([A-Z]{3})(\d{2,4})$/);
  if (!m) return 30;
  const day = parseInt(m[1], 10);
  const month = MONTHS[m[2]];
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month === undefined) return 30;
  const expiry = new Date(year, month, day);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// Derive underlying root from a tradingsymbol, e.g. RELIANCE29SEP261220PE → RELIANCE
function deriveUnderlying(symbol) {
  const m = symbol.match(/^([A-Z]+)\d/);
  return m ? m[1] : null;
}

// Extract strike from a tradingsymbol, e.g. RELIANCE29SEP261220PE → 1220, NIFTY25AUG2624800CE → 24800
// Pattern: <ROOT><DD><MMM><YY><4-6 digit strike><CE|PE>
// The anchored \d{2}[A-Z]{3}\d{2} consumes the expiry token (e.g. 29SEP26) so the
// strike capture only gets the strike digits (e.g. 1220), not expiry-year leftovers.
function extractStrike(symbol) {
  if (!symbol) return null;
  const m = symbol.match(/^[A-Z]+\d{2}[A-Z]{3}\d{2}(\d{4,6})(CE|PE)$/);
  return m ? parseInt(m[1], 10) : null;
}

// Compute net position delta (in qty units, per ₹1 spot move)
function computeNetDelta(legs, spot) {
  let net = 0;
  const legDeltas = [];
  for (const leg of legs) {
    if (leg.status !== 'OPEN') continue;
    const strike = leg.strike || extractStrike(leg.symbol);
    if (!strike) continue;
    const optionType = leg.optionType || (leg.symbol.endsWith('CE') ? 'CE' : 'PE');
    const d = blackScholesDelta(spot, strike, optionType, daysToExpiry(leg.expiry));
    const signed = leg.side === 'BUY' ? d : -d;
    const positionDelta = signed * leg.qty;
    net += positionDelta;
    legDeltas.push({ symbol: leg.symbol, delta: positionDelta });
  }
  return { net, legDeltas };
}

// ---------- Formatting ----------
function fmt(n) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildReport(position, legDetails, deltaInfo, realised = 0) {
  const margin = position.marginUtilized || position.baselineValue || 0;
  const ptPct = parseFloat(process.env.PROFIT_TARGET_PCT || '1.5');
  const slPct = parseFloat(process.env.STOPLOSS_PCT || '2.0');

  const hasAbsolutePT = typeof position.ptAmount === 'number' && position.ptAmount > 0;
  const pt = hasAbsolutePT ? position.ptAmount : margin * (ptPct / 100);

  const isSlDisabled = position.slAmount === null;
  const hasAbsoluteSL = typeof position.slAmount === 'number' && position.slAmount > 0;
  const sl = isSlDisabled ? null : hasAbsoluteSL ? position.slAmount : margin * (slPct / 100);

  const totalMTM = legDetails.reduce((s, l) => s + l.mtm, 0);
  const pct = margin > 0 ? (totalMTM / margin) * 100 : 0;

  // Thresholds are judged on NET P&L (open + realised on closed legs) — the same figure the
  // monitor's exit path uses. Displaying "Target Achieved" off the open mark alone made the
  // banner disagree with the engine (30 Oct: banner said hit at +43,313 while the monitor,
  // correctly netting a −23,643 wing loss, saw +19,670 and did nothing).
  const net = totalMTM + realised;

  let status = 'Monitoring';
  if (net >= pt) status = 'Target Achieved 🚀';
  else if (!isSlDisabled && sl !== null && net <= -sl) status = 'Stop Loss Hit 🛑';

  const lines = [];
  lines.push('┏━━━━━━━━━━━━━━━━━━━━━━━━━┓');
  lines.push('   ⚡️ TRADE PERFORMANCE ⚡️');
  lines.push('┗━━━━━━━━━━━━━━━━━━━━━━━━━┛');
  lines.push('');
  lines.push(`📌 Position: ${position.positionId}`);
  lines.push(
    `💰 Total PnL:        ${totalMTM >= 0 ? '+' : ''}₹${fmt(totalMTM)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`,
  );
  lines.push('');
  lines.push('─────────────────────────');
  lines.push(`🎯 PT (Target):       ₹${fmt(pt)} ${net >= pt ? '✅' : ''}`);
  if (isSlDisabled) {
    lines.push(`🛑 SL (Stop Loss):    disabled`);
  } else {
    lines.push(`🛑 SL (Stop Loss):    ₹${fmt(sl)} ${net <= -sl ? '✅' : ''}`);
  }
  lines.push(`💼 Margin Utilized:   ₹${fmt(margin)}`);
  // Adjustments closed on earlier days: their money is already banked, so show it separately
  // and give the net — the open MTM alone understates (or overstates) the trade's real result.
  if (realised && Math.abs(realised) >= 0.005) {
    lines.push(`📜 Adjustments (realised): ${realised >= 0 ? '+' : ''}₹${fmt(realised)}`);
    const net = totalMTM + realised;
    lines.push(`🧮 Net incl. realised:    ${net >= 0 ? '+' : ''}₹${fmt(net)}`);
  }
  if (deltaInfo && deltaInfo.spot > 0) {
    const absDelta = Math.abs(deltaInfo.net);
    const neutral = absDelta < 50;
    const bias = neutral
      ? 'Neutral ✅'
      : deltaInfo.net > 0
        ? 'Delta + (Bullish) 🟢'
        : 'Delta - (Bearish) 🔴';
    lines.push(
      `📐 Net Delta:        ${deltaInfo.net >= 0 ? '+' : ''}${deltaInfo.net.toFixed(1)} (${bias})`,
    );
    lines.push(`   Spot: ${deltaInfo.underlying} ₹${fmt(deltaInfo.spot)}`);
  }
  lines.push('─────────────────────────');
  lines.push('');
  lines.push(`📌 Status: ${status}`);
  return lines.join('\n');
}

// ---------- Main ----------
async function main() {
  if (!isTradingTime()) {
    return; // silent outside market hours / weekends
  }

  if (!fs.existsSync(POSITIONS_DIR)) {
    console.log('⚠️ Positions directory not found:', POSITIONS_DIR);
    return;
  }

  const files = fs.readdirSync(POSITIONS_DIR).filter((f) => f.endsWith('.json'));

  if (files.length === 0) {
    return; // no position files — nothing to report (silent)
  }

  const { jwtToken, publicIP } = await login();
  const reports = [];
  const snapshots = [];
  const tradeBook = await fetchTradeBook(jwtToken, publicIP);

  for (const file of files) {
    const filePath = path.join(POSITIONS_DIR, file);
    let position;
    try {
      position = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      continue; // skip unreadable files
    }

    const openLegs = position.legs.filter((l) => l.status === 'OPEN');
    if (openLegs.length === 0) {
      continue; // no open legs in this position
    }

    const legDetails = [];
    for (const leg of openLegs) {
      const ltp = await fetchLTP(
        jwtToken,
        publicIP,
        exchangeFor(position.index),
        leg.symbol,
        leg.token,
      );
      const mtm =
        leg.side === 'BUY' ? (ltp - leg.entryPrice) * leg.qty : (leg.entryPrice - ltp) * leg.qty;
      legDetails.push({ symbol: leg.symbol, side: leg.side, qty: leg.qty, ltp, mtm });
      await sleep(300); // pace requests — Angel rate-limits getLtpData bursts
    }

    // Delta-neutrality check: resolve the underlying's spot, compute net delta
    let deltaInfo = null;
    try {
      const underlying = deriveUnderlying(openLegs[0]?.symbol || '');
      const spotCfg = underlying ? UNDERLYING_SPOT_MAP[underlying] : null;
      if (spotCfg) {
        const spot = await fetchLTP(
          jwtToken,
          publicIP,
          spotCfg.exchange || 'NSE',
          spotCfg.symbol,
          spotCfg.token,
        );
        if (spot > 0) {
          const { net } = computeNetDelta(openLegs, spot);
          deltaInfo = { net, spot, underlying };
        }
      }
    } catch {
      deltaInfo = null; // delta check is best-effort — never fail the report over it
    }

    reports.push(
      buildReport(
        position,
        legDetails,
        deltaInfo,
        position.legs
          .filter((l) => l.status !== 'OPEN' && typeof l.realisedPnl === 'number')
          .reduce((s, l) => s + l.realisedPnl, 0),
      ),
    );

    // Machine-readable snapshot for the payoff chart and the realisation ledger. One login, so
    // Angel sees one run not two. ALL legs, not just open ones — closed legs are the book history.
    const ltpBySymbol = new Map(legDetails.map((d) => [d.symbol, d.ltp]));
    snapshots.push({
      positionId: position.positionId,
      index: position.index,
      status: position.status,
      expiry: openLegs[0]?.expiry || null,
      spot: deltaInfo ? deltaInfo.spot : null,
      legs: position.legs.map((leg) => ({
        legId: leg.legId,
        symbol: leg.symbol,
        side: leg.side,
        qty: leg.qty,
        status: leg.status,
        optionType:
          leg.optionType ||
          (leg.symbol.endsWith(String.fromCharCode(67, 69))
            ? String.fromCharCode(67, 69)
            : String.fromCharCode(80, 69)),
        strike: leg.strike || extractStrike(leg.symbol),
        expiry: leg.expiry,
        entryPrice: leg.entryPrice,
        ltp: ltpBySymbol.has(leg.symbol) ? ltpBySymbol.get(leg.symbol) : null,
        realisedPnl: typeof leg.realisedPnl === 'number' ? leg.realisedPnl : null,
      })),
    });
  }

  if (reports.length > 0) {
    console.log(reports.join('\n\n'));
  }

  // --json: one machine-readable line AFTER the human report, so the banner and the payoff chart
  // share a single run (and a single Angel login).
  if (process.argv.includes('--json')) {
    console.log(
      '@@SNAPSHOT@@' +
        JSON.stringify({
          generatedAt: new Date().toISOString(),
          trades: tradeBook || [],
          positions: snapshots,
        }),
    );
  }
}

main().catch((err) => {
  console.log(`⚠️ PnL report failed: ${err.message}`);
});
