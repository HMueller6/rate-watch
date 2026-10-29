// Generates SYNTHETIC data in the dashboard.json format, for layout/behaviour tests only.
// meta.synthetic = true makes the app show a red banner. None of these numbers are real.
import { CATALOG } from '../scripts/lib/catalog.mjs';
import { shiftMonths } from '../js/analytics.js';

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(42);
const gauss = () => (rand() + rand() + rand() + rand() - 2) * 1.2;
const iso = (d) => d.toISOString().slice(0, 10);

const END = '2026-10-28';
const monthly = (from, end = '2026-09-01') => { const out = []; for (let d = from; d <= end; d = shiftMonths(d, 1)) out.push(d); return out; };
function dailyDates() {
  const out = [];
  for (let d = new Date('2023-10-30T00:00:00Z'); iso(d) <= END; d = new Date(d.getTime() + 864e5)) if (![0, 6].includes(d.getUTCDay())) out.push(iso(d));
  return out;
}
const monthEnds = () => monthly('1990-01-01', '2023-09-01').map((d) => shiftMonths(d, 1).slice(0, 8) + '01').map((d) => iso(new Date(Date.parse(d + 'T00:00:00Z') - 864e5)));
const dense = () => [...monthEnds(), ...dailyDates()];

function walk(dates, start, vol, lo, hi, pull = 0, mean = start) {
  let v = start;
  return dates.map((d, i) => { v += gauss() * vol + (mean - v) * pull; v = Math.min(hi, Math.max(lo, v)); return [d, +v.toFixed(3)]; });
}
function stepFrom(changes, end = END) {
  const out = changes.map(([d, v]) => [d, v]);
  const l = out[out.length - 1];
  if (l[0] < end) out.push([end, l[1]]);
  return out;
}
const POLICY = [['1990-01-01', 12], ['1994-02-01', 5], ['1995-01-01', 7.5], ['1997-01-01', 3], ['1998-08-27', 5.25], ['1999-11-17', 5.0], ['2000-02-01', 5.75],
  ['2001-06-01', 4.5], ['2002-04-16', 2.25], ['2002-07-01', 2.75], ['2004-09-08', 2.25], ['2005-10-04', 3.0], ['2006-07-12', 4.25], ['2008-04-22', 3.0],
  ['2009-04-21', 0.25], ['2010-06-01', 0.5], ['2010-09-08', 1.0], ['2015-01-21', 0.75], ['2017-07-12', 0.75], ['2018-01-17', 1.25], ['2018-10-24', 1.75], ['2020-03-27', 0.25],
  ['2022-03-02', 0.5], ['2022-07-13', 2.5], ['2022-12-07', 4.25], ['2023-07-12', 5.0], ['2024-06-05', 4.75], ['2024-12-11', 3.25], ['2025-10-29', 2.25], ['2026-10-28', 2.5]];
const policySeries = stepFrom(POLICY);
const pAt = (d) => { let v = policySeries[0][1]; for (const [pd, pv] of policySeries) { if (pd <= d) v = pv; else break; } return v; };

const make = {
  ca_policy: () => policySeries,
  ca_prime: () => stepFrom(POLICY.map(([d, v]) => [d, +(v + 2.2).toFixed(2)])),
  ca_corra: () => dailyDates().map((d) => [d, +(pAt(d) - 0.02).toFixed(3)]),
  ca_mort5_posted: () => monthly('1990-01-01', '2026-10-01').map((d) => [d, +(pAt(d) + 3.2 + gauss() * 0.1).toFixed(2)]),
  ca_cpi_index: () => { let v = 78; return monthly('1990-01-01').map((d) => [d, +(v *= 1 + 0.0018 + gauss() * 0.0015).toFixed(2)]); },
  ca_unemp: () => walk(monthly('1990-01-01'), 8.5, 0.18, 4.8, 13, 0.03, 7),
  ca_nhpi: () => { let v = 50; return monthly('1990-01-01', '2026-08-01').map((d) => [d, +(v *= 1 + 0.0025 + gauss() * 0.0025).toFixed(2)]); },
  ca_starts: () => walk(monthly('1990-01-01', '2026-09-01'), 200, 9, 120, 330, 0.05, 240),
  ca_cpi_trim: () => walk(monthly('2001-01-01'), 2.0, 0.12, 0.8, 4.5, 0.05, 2.4),
  ca_cpi_median: () => walk(monthly('2001-01-01'), 2.0, 0.12, 0.8, 4.5, 0.05, 2.5),
  ca_cpi_common: () => walk(monthly('2001-01-01'), 2.0, 0.1, 1, 4.5, 0.05, 2.2),
  ca_boc_assets: () => walk(monthly('2003-01-01', '2026-10-01'), 60000, 8000, 40000, 600000, 0.01, 240000),
  ca_bank_mortgages: () => { let v = 300000; return monthly('1990-01-01', '2026-08-01').map((d) => [d, Math.round((v *= 1 + 0.005 + gauss() * 0.002))]); },
  ca_bank_nonmortgage: () => { let v = 300000; return monthly('1990-01-01', '2026-08-01').map((d) => [d, Math.round((v *= 1 + 0.004 + gauss() * 0.003))]); },
  ca_arrears_mtg: () => walk(monthly('2001-01-01', '2026-04-01').filter((_, i) => i % 3 === 0), 0.3, 0.02, 0.1, 0.6, 0.05, 0.25),
  ca_employment: () => { let v = 13000; return monthly('1990-01-01').map((d) => [d, Math.round((v += 38 + gauss() * 40) * 10) / 10]); },
  us_cpi_index: () => { let v = 128; return monthly('1990-01-01').map((d) => [d, +(v *= 1 + 0.0023 + gauss() * 0.0015).toFixed(3)]); },
  us_core_cpi_index: () => { let v = 130; return monthly('1990-01-01').map((d) => [d, +(v *= 1 + 0.0022 + gauss() * 0.001).toFixed(3)]); },
  us_core_pce_index: () => { let v = 60; return monthly('1990-01-01').map((d) => [d, +(v *= 1 + 0.0018 + gauss() * 0.0008).toFixed(3)]); },
  us_unemp: () => walk(monthly('1990-01-01'), 6, 0.15, 3.4, 10, 0.03, 5.5),
  us_payrolls: () => { let v = 110000; return monthly('1990-01-01').map((d) => [d, Math.round((v += 130 + gauss() * 90))]); },
  us_walcl: () => walk(monthly('2003-01-01', '2026-10-01'), 700000, 60000, 600000, 9000000, 0.01, 6000000),
  us_bank_credit: () => { let v = 3000; return monthly('1990-01-01', '2026-10-01').map((d) => [d, +(v *= 1 + 0.0055 + gauss() * 0.003).toFixed(1)]); },
  us_delinq_mort: () => walk(monthly('1991-01-01', '2026-07-01').filter((_, i) => i % 3 === 0), 2.4, 0.2, 1.2, 11, 0.03, 2.5),
  us_debt_fed: () => walk(monthly('1990-01-01', '2026-07-01').filter((_, i) => i % 3 === 0), 230, 40, 200, 8000, 0.005, 4500),
  us_debt_foreign: () => walk(monthly('1990-01-01', '2026-07-01').filter((_, i) => i % 3 === 0), 300, 60, 250, 9000, 0.005, 7500),
  us_debt_private: () => walk(monthly('1990-01-01', '2026-07-01').filter((_, i) => i % 3 === 0), 2100, 90, 2000, 40000, 0.004, 22000),
};
const dailyKeys = {
  ca_y2: [3.0, 0.03, 0.2, 6], ca_y3: [3.1, 0.03, 0.2, 6], ca_y5: [3.3, 0.03, 0.3, 6.5], ca_y7: [3.5, 0.03, 0.3, 6.5], ca_y10: [3.7, 0.03, 0.4, 6.5], ca_y30: [4.0, 0.03, 0.5, 6.5], ca_rrb: [1.8, 0.02, 0, 4],
  us_effr: [5.3, 0.01, 0, 6], us_sofr: [5.3, 0.01, 0, 6], us_y3m: [5.3, 0.03, 0, 6], us_y2: [4.6, 0.05, 0.2, 6], us_y5: [4.2, 0.05, 0.3, 6], us_y10: [4.2, 0.04, 0.4, 6], us_y30: [4.4, 0.04, 0.5, 6],
  us_10y2y: [-0.4, 0.02, -1.5, 1.5], us_be10: [2.3, 0.02, 1, 3.5], us_mort30: [6.5, 0.04, 2.5, 8], us_hy_oas: [3.4, 0.05, 2.5, 9], us_wti: [78, 1.4, 40, 120], usdcad: [1.36, 0.004, 1.2, 1.45],
};

const specs = Object.fromEntries(CATALOG.map((s) => [s.key, s]));
const series = {};
const pols = { us_ff_upper: [5.5], us_ff_lower: [5.25] };
for (const k of Object.keys(specs)) {
  let pts;
  if (make[k]) pts = make[k]();
  else if (dailyKeys[k]) { const [s, v, lo, hi] = dailyKeys[k]; pts = walk(dense(), s, v, lo, hi, 0.002); }
  else if (pols[k]) pts = stepFrom([['2008-12-16', 0.25], ['2022-03-17', 0.5], ['2023-07-26', pols[k][0]], ['2024-12-19', pols[k][0] - 1.25], ['2025-12-11', pols[k][0] - 1.75]]);
  else throw new Error('no generator for ' + k);
  const s = specs[k];
  const gaps = pts.slice(-6).map((p, i, a) => (i ? (Date.parse(p[0]) - Date.parse(a[i - 1][0])) / 864e5 : 0)).slice(1).sort((a, b) => a - b);
  const g = gaps[gaps.length >> 1];
  series[k] = { label: s.label, sourceLabel: s.label + ' (synthetic)', sourceId: 'SYNTH', verified: null, source: s.source, unit: s.unit, asOf: pts[pts.length - 1][0], freq: g <= 4 ? 'd' : g <= 10 ? 'w' : g <= 40 ? 'm' : 'q', points: pts };
}
const doc = {
  meta: { generatedAt: '2026-10-29T12:00:00.000Z', version: 1, synthetic: true, sources: {} },
  errors: [{ key: 'ca_mort5_posted', source: 'valet', optional: true, keptPrevious: false, message: 'synthetic example of an optional series that failed' }],
  series,
};
delete doc.series.ca_mort5_posted; // exercise the "failed series" path
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
const out = new URL('./fixtures/dashboard.synthetic.json', import.meta.url);
writeFileSync(out, JSON.stringify(doc));
console.log('wrote', out.pathname, (JSON.stringify(doc).length / 1024).toFixed(0) + ' KB,', Object.keys(series).length, 'series');
