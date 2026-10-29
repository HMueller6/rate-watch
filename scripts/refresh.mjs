#!/usr/bin/env node
// Fetches every series in the catalog and writes data/dashboard.json for the web app.
//
//   node scripts/refresh.mjs                 write ../data/dashboard.json
//   node scripts/refresh.mjs --check         fetch and report, write nothing
//   node scripts/refresh.mjs --only ca_y     only keys starting with "ca_y"
//   node scripts/refresh.mjs --min-ok 0.8    exit 1 (and write nothing) if fewer than 80% of series load
//   node scripts/refresh.mjs --discover      list Bank of Canada Valet groups; add a group name to list its series
//
// Optional env: FRED_API_KEY (official FRED API instead of the keyless CSV download).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, START_DATE } from './lib/catalog.mjs';
import { isStale } from '../js/analytics.js';
import { fetchValet, listGroups, listGroupSeries } from './lib/valet.mjs';
import { fetchStatcan } from './lib/statcan.mjs';
import { fetchFred } from './lib/fred.mjs';
import { compress, inferFreq } from './lib/util.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCES = {
  valet: { name: 'Bank of Canada Valet API', url: 'https://www.bankofcanada.ca/valet/docs' },
  statcan: { name: 'Statistics Canada WDS', url: 'https://www.statcan.gc.ca/en/developers/wds' },
  fred: { name: 'FRED, Federal Reserve Bank of St. Louis', url: 'https://fred.stlouisfed.org' },
};

export async function loadOne(spec, { fredKey = process.env.FRED_API_KEY, today = new Date() } = {}) {
  const got =
    spec.source === 'valet' ? await fetchValet(spec, START_DATE)
    : spec.source === 'statcan' ? await fetchStatcan(spec)
    : await fetchFred(spec, START_DATE, fredKey);
  const l = got.points[got.points.length - 1];
  if (spec.sane && (l[1] < spec.sane[0] || l[1] > spec.sane[1])) {
    throw new Error(`latest value ${l[1]} on ${l[0]} is outside the plausible range ${spec.sane[0]}..${spec.sane[1]} (wrong series?)`);
  }
  const points = compress(got.points, { stepOnly: spec.stepOnly, dailyYears: spec.daily ? 3 : 0, today });
  return {
    label: spec.label,
    sourceLabel: got.label || null, // label as reported by the source, for eyeballing
    sourceId: got.id,
    verified: spec.source === 'fred' ? null : spec.source === 'valet' ? true : got.verified,
    source: spec.source,
    unit: spec.unit,
    asOf: l[0],
    freq: inferFreq(got.points),
    points,
  };
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(`--${n}`);
  const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);

  if (process.env.RW_PROBE) {
    const { probe } = await import('./probe.mjs');
    await probe(process.env.RW_PROBE);
  }

  if (flag('discover')) {
    const group = opt('discover', '');
    if (group && !group.startsWith('--')) {
      for (const s of await listGroupSeries(group)) console.log(`${s.id}\t${s.label}`);
    } else {
      for (const g of await listGroups()) console.log(`${g.name}\t${g.label}`);
    }
    return;
  }

  const outPath = resolve(here, opt('out', '../data/dashboard.json'));
  const only = opt('only', '');
  const minOk = Number(opt('min-ok', '0.7'));
  const specs = CATALOG.filter((s) => s.key.startsWith(only));

  let previous = {};
  try { previous = JSON.parse(await readFile(outPath, 'utf8')).series ?? {}; } catch { /* first run */ }

  const series = {};
  const errors = [];
  const t0 = Date.now();
  const one = async (spec) => {
    try {
      series[spec.key] = await loadOne(spec);
    } catch (e) {
      const kept = previous[spec.key];
      if (kept) series[spec.key] = { ...kept, stale: true };
      errors.push({ key: spec.key, source: spec.source, optional: Boolean(spec.optional), keptPrevious: Boolean(kept), message: e.message });
    }
  };
  // sources run side by side; StatCan answers 430 (too many requests) if hit in parallel, so it goes one at a time
  const SIZE = { valet: 3, statcan: 1, fred: 4 };
  await Promise.all(Object.entries(SIZE).map(([src, n]) => pool(specs.filter((s) => s.source === src), n, one)));

  const rows = specs.map((s) => {
    const r = series[s.key];
    const e = errors.find((x) => x.key === s.key);
    const l = r && r.points[r.points.length - 1];
    return `${e ? (r ? 'STALE' : 'FAIL ') : 'ok   '} ${s.key.padEnd(20)} ${l ? `${l[0]} ${l[1]}` : ''}${e ? `  ${e.message}` : ''}`;
  });
  console.log(rows.join('\n'));
  const fresh = specs.filter((s) => series[s.key] && !series[s.key].stale).length;
  console.log(`\n${fresh}/${specs.length} series loaded fresh in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const today = new Date().toISOString().slice(0, 10);
  const stale = specs.filter((s) => series[s.key] && isStale(series[s.key], today));
  const failedReq = errors.filter((e) => !e.optional && !series[e.key]);
  console.log(`dashboard banner: ${failedReq.length} required series failed, ${stale.length} flagged stale${stale.length ? ' (' + stale.map((s) => `${s.key} as of ${series[s.key].asOf}`).join(', ') + ')' : ''}`);

  if (fresh / specs.length < minOk) {
    console.error(`Fewer than ${Math.round(minOk * 100)}% of series loaded; not writing output.`);
    process.exit(1);
  }
  if (flag('check')) return;

  const doc = {
    meta: { generatedAt: new Date().toISOString(), version: 1, fredKeyUsed: Boolean(process.env.FRED_API_KEY), sources: SOURCES },
    errors,
    series,
  };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(doc));
  console.log(`Wrote ${outPath} (${(JSON.stringify(doc).length / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
