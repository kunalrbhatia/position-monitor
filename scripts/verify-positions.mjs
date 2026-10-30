// READ-ONLY reconciliation: every OPEN leg in data/positions/*.json vs the broker's netqty.
// Accounts for the GOLDM price multiplier: MCX GOLDM options quote per 10 g in a 100 g lot, so the
// monitor stores qty=10 per lot while the broker reports netqty in grams (-100).
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { getBrokerAuthSession } from '../dist/helpers/login.js';
import { buildCommonHeaders } from '../dist/helpers/api.js';

const MULT = { GOLDM: 10 }; // file qty -> broker qty factor
const DIR = path.join(process.cwd(), 'data', 'positions');
const BASE = 'https://apiconnect.angelbroking.com';

const session = await getBrokerAuthSession();
if (!session) throw new Error('login failed');
let publicIP = '127.0.0.1';
try {
  publicIP = (await axios.get('https://api.ipify.org', { timeout: 5000 })).data.trim();
} catch {}
const headers = buildCommonHeaders(session.jwtToken, publicIP);

const resp = await axios.get(`${BASE}/rest/secure/angelbroking/order/v1/getPosition`, { headers });
const rows = resp.data?.data || [];
const broker = new Map(rows.filter((r) => Number(r.netqty) !== 0).map((r) => [r.tradingsymbol, r]));

console.log(`broker open rows: ${broker.size}\n`);

const seen = new Set();
let problems = 0;

for (const f of fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const pos = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const mult = MULT[pos.index] || 1;
  console.log(`== ${pos.positionId}  (index ${pos.index}, x${mult})`);
  for (const leg of pos.legs) {
    if (leg.status !== 'OPEN') continue;
    seen.add(leg.symbol);
    const expect = (leg.side === 'BUY' ? 1 : -1) * leg.qty * mult;
    const row = broker.get(leg.symbol);
    if (!row) {
      console.log(`   ✗ MISSING AT BROKER  ${leg.symbol}  file expects ${expect}`);
      problems++;
      continue;
    }
    const actual = Number(row.netqty);
    const ok = actual === expect;
    // P&L check uses the file qty (10 for GOLDM), not qty x mult: the broker's netqty is in grams
    // but its pnl already applies the per-lot rupee multiplier.
    const mtm =
      (leg.side === 'BUY' ? Number(row.ltp) - leg.entryPrice : leg.entryPrice - Number(row.ltp)) *
      leg.qty;
    const diff = mtm - Number(row.pnl);
    const mtmOk = Math.abs(diff) < 1;
    if (!mtmOk) problems++;
    console.log(
      `   ${ok && mtmOk ? '✓' : '✗'} ${leg.symbol.padEnd(24)} qty file ${String(expect).padStart(5)} / broker ${String(actual).padStart(5)}` +
        `   mtm file ${mtm.toFixed(2).padStart(11)} / broker ${String(row.pnl).padStart(11)}  Δ${diff.toFixed(2)}` +
        (ok && mtmOk ? '' : '   <-- MISMATCH'),
    );
  }
}

console.log('\n== broker rows NOT covered by any OPEN file leg ==');
let extra = 0;
for (const [sym, r] of broker) {
  if (!seen.has(sym)) {
    console.log(
      `   ! ${sym.padEnd(24)} netqty=${String(r.netqty).padStart(5)} ltp=${r.ltp} pnl=${r.pnl}`,
    );
    extra++;
  }
}

console.log(`\nsummary: ${problems} mismatch(es) in file legs, ${extra} untracked broker row(s)`);
