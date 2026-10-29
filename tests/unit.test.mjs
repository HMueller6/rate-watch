import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/analytics.js';
import { parseValet, fetchValet } from '../scripts/lib/valet.mjs';
import { parseFredCsv, parseFredJson } from '../scripts/lib/fred.mjs';
import { parseStatcan } from '../scripts/lib/statcan.mjs';
import { compress, inferFreq } from '../scripts/lib/util.mjs';
import { loadOne } from '../scripts/refresh.mjs';
import { CATALOG } from '../scripts/lib/catalog.mjs';

const near = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// ---------- analytics ----------
test('date shifting clamps to month length', () => {
  assert.equal(A.shiftMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(A.shiftMonths('2024-03-31', -1), '2024-02-29');
  assert.equal(A.shiftMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(A.shiftMonths('2026-01-15', -13), '2024-12-15');
});

test('valueAt returns last observation on or before date', () => {
  const p = [['2020-01-01', 1], ['2020-03-01', 2], ['2020-06-01', 3]];
  assert.equal(A.valueAt(p, '2019-12-31'), null);
  assert.equal(A.valueAt(p, '2020-01-01'), 1);
  assert.equal(A.valueAt(p, '2020-04-15'), 2);
  assert.equal(A.valueAt(p, '2030-01-01'), 3);
});

test('yoy matches by calendar month', () => {
  const p = [['2025-01-01', 100], ['2025-02-01', 101], ['2026-01-01', 103], ['2026-02-01', 102.01]];
  const y = A.yoy(p);
  assert.equal(y.length, 2);
  near(y[0][1], 3);
  near(y[1][1], 1);
});

test('mortgage payments agree with independent reference values', () => {
  near(A.payment(500000, 5, 25), 2908.02);
  near(A.payment(500000, 5.25, 25), 2979.59);
  near(A.payment(500000, 4.75, 25, 'monthly'), 2850.59);
  near(A.payment(400000, 4, 30), 1902.07);
  near(A.payment(120000, 0, 10), 1000);
  assert.equal(A.stressRate(3.5), 5.5);
  assert.equal(A.stressRate(2), 5.25);
});

test('hike cycles need a 12-month gap since the previous hike', () => {
  const p = [['1999-01-01', 4], ['1999-06-01', 4.5], ['2000-02-01', 5], ['2002-04-01', 2], ['2002-06-01', 2.25],
    ['2002-09-01', 2.5], ['2004-02-01', 2], ['2004-09-01', 2.25], ['2005-01-01', 2.5], ['2007-01-01', 4]];
  const c = A.hikeCycles(p);
  assert.deepEqual(c.map((x) => x.date), ['1999-06-01', '2002-06-01', '2004-09-01', '2007-01-01']); // 2007 follows a 2-year pause
  assert.equal(c[1].from, 2);
  assert.equal(c[1].to, 2.25);
});

test('backtest measures price change after first hike against the unconditional baseline', () => {
  // price index grows exactly 1%/month for 10 years => every 12m window is +12.68%
  const nhpi = [];
  for (let i = 0; i < 120; i++) nhpi.push([A.shiftMonths('2010-01-01', i), 100 * Math.pow(1.01, i)]);
  const policy = [['2010-01-01', 1], ['2012-03-01', 1.25], ['2012-04-01', 1.5], ['2014-01-01', 1.5]]; // last point = as-of date
  const y5 = [['2010-01-01', 2], ['2012-02-28', 2], ['2012-09-01', 3], ['2013-03-01', 3.5]];
  const bt = A.backtest({ policy, nhpi, y5 }, [6, 12]);
  assert.equal(bt.rows.length, 1);
  const r = bt.rows[0];
  assert.equal(r.date, '2012-03-01');
  near(r.horizons[12].price, (Math.pow(1.01, 12) - 1) * 100, 0.01);
  near(r.horizons[12].excess, 0, 0.01);
  near(r.horizons[12].policy, 0.5);          // rate went 1 -> 1.5
  near(r.horizons[6].y5, 1);                 // 2 -> 3 by 2012-09-01
  near(r.horizons[12].y5, 1.5);              // 2 -> 3.5 by 2013-03-01
  near(bt.summary[12].price, r.horizons[12].price);
});

test('backtest leaves not-yet-observable horizons empty rather than inventing them', () => {
  const nhpi = [['2026-01-01', 100], ['2026-09-01', 102]];
  const policy = [['2025-01-01', 2.25], ['2026-10-28', 2.5]];
  const bt = A.backtest({ policy, nhpi, y5: [['2026-10-28', 3]] }, [6, 12]);
  assert.equal(bt.rows[0].horizons[6].price, null);
  assert.equal(bt.rows[0].horizons[12].policy, null);
  assert.equal(bt.summary[12].n, 0);
});

test('policy reconciliation: match, pending (feed lagging) and mismatch', () => {
  const ann = { date: '2026-10-28', newRate: 2.5 };
  assert.equal(A.reconcilePolicy([['2025-10-29', 2.25], ['2026-10-28', 2.5]], ann).status, 'match');
  assert.equal(A.reconcilePolicy([['2025-10-29', 2.25], ['2026-10-27', 2.25]], ann).status, 'pending');
  assert.equal(A.reconcilePolicy([['2025-10-29', 2.25], ['2026-10-28', 2.25]], ann).status, 'pending'); // same-day old value = feed lag
  assert.equal(A.reconcilePolicy([['2025-10-29', 2.25], ['2026-11-05', 2.25]], ann).status, 'mismatch'); // still old a week later
  assert.equal(A.reconcilePolicy([], ann).status, 'nodata');
  const eff = A.effectivePolicy([['2025-10-29', 2.25], ['2026-10-27', 2.25]], ann);
  assert.deepEqual(A.last(eff), ['2026-10-28', 2.5]);
});

test('housing signals tilt as documented and composite labels them', () => {
  const S = {
    ca_policy: [['2025-10-29', 2.25], ['2026-10-28', 2.5]],
    ca_y5: [['2026-07-28', 3.0], ['2026-10-28', 3.4]],
    ca_y2: [['2026-10-28', 2.9]],
    ca_cpi_trim: [['2026-09-01', 3.2]], ca_cpi_median: [['2026-09-01', 3.4]],
    ca_unemp: [['2026-03-01', 6.8], ['2026-09-01', 6.9]],
    ca_nhpi: [['2025-09-01', 100], ['2026-09-01', 101]],
    us_y10: [['2026-07-28', 4.2], ['2026-10-28', 4.6]],
  };
  const sig = A.housingSignals(S);
  const t = Object.fromEntries(sig.map((s) => [s.id, s.tilt]));
  assert.deepEqual(t, { policy: -1, y5: -1, implied: -1, inflation: -1, labour: 0, momentum: 0, us10: -1 });
  const c = A.composite(sig);
  assert.equal(c.score, -5);
  assert.equal(c.label, 'Headwinds');
  assert.equal(c.headwinds, 5);
  assert.equal(A.composite([]).label, 'No data');
});

test('inflation signal looks at headline as well as core', () => {
  const idx = (end) => [['2025-09-01', 100], ['2026-09-01', end]];
  const base = { ca_cpi_trim: [['2026-09-01', 1.8]], ca_cpi_median: [['2026-09-01', 1.9]] };
  const tilt = (S) => A.housingSignals(S).find((s) => s.id === 'inflation').tilt;
  assert.equal(tilt({ ...base, ca_cpi_index: idx(103.4) }), -1); // energy-driven headline 3.4% outweighs calm core
  assert.equal(tilt({ ...base, ca_cpi_index: idx(101.5) }), 1);  // both below 2%
  assert.equal(tilt({ ...base, ca_cpi_index: idx(102.5) }), 0);
  assert.equal(tilt(base), 1);                                   // core only: still computed from what exists
});

test('housing signals skip missing inputs instead of guessing', () => {
  assert.equal(A.housingSignals({}).length, 0);
});

// ---------- parsers ----------
test('parseValet reads observations and drops blanks', () => {
  const j = {
    seriesDetail: { V39079: { label: 'Target for the overnight rate' } },
    observations: [{ d: '2026-10-27', V39079: { v: '2.25' } }, { d: '2026-10-28', V39079: { v: '2.5' } }, { d: '2026-10-29', V39079: { v: '' } }],
  };
  const r = parseValet(j, 'V39079');
  assert.equal(r.label, 'Target for the overnight rate');
  assert.deepEqual(r.points, [['2026-10-27', 2.25], ['2026-10-28', 2.5]]);
  assert.equal(r.description, '');
});

test('parseFredCsv handles both header styles and missing "." values', () => {
  const a = parseFredCsv('observation_date,DGS10\n2026-10-27,4.1\n2026-10-28,.\n2026-10-29,4.2\n', 'DGS10');
  assert.deepEqual(a, [['2026-10-27', 4.1], ['2026-10-29', 4.2]]);
  assert.equal(parseFredCsv('DATE,DGS10\n2026-10-27,4.1\n', 'DGS10').length, 1);
  assert.throws(() => parseFredCsv('<html>error</html>', 'DGS10'), /header/);
  assert.throws(() => parseFredCsv('observation_date,OTHER\n2026-10-27,4.1\n', 'DGS10'), /header/);
});

test('parseFredJson skips "." values', () => {
  assert.deepEqual(parseFredJson({ observations: [{ date: '2026-01-01', value: '.' }, { date: '2026-01-02', value: '3.5' }] }), [['2026-01-02', 3.5]]);
});

test('parseStatcan reads vector data points and rejects failures', () => {
  const ok = [{ status: 'SUCCESS', object: { vectorId: 1, vectorDataPoint: [{ refPer: '2026-08-01', value: '165.2' }, { refPer: '2026-09-01', value: '' }] } }];
  assert.deepEqual(parseStatcan(ok), [['2026-08-01', 165.2]]);
  assert.throws(() => parseStatcan([{ status: 'FAILED', object: 'bad vector' }]), /FAILED/);
});

test('compress keeps change points for step series and thins old daily data', () => {
  const step = compress([['2020-01-01', 1], ['2020-01-02', 1], ['2020-01-03', 2], ['2020-01-04', 2]], { stepOnly: true });
  assert.deepEqual(step, [['2020-01-01', 1], ['2020-01-03', 2], ['2020-01-04', 2]]);
  const daily = [['2020-01-02', 1], ['2020-01-30', 2], ['2020-02-03', 3], ['2026-10-27', 4], ['2026-10-28', 5]];
  const c = compress(daily, { dailyYears: 3, today: new Date('2026-10-29T00:00:00Z') });
  assert.deepEqual(c, [['2020-01-30', 2], ['2020-02-03', 3], ['2026-10-27', 4], ['2026-10-28', 5]]);
});

// ---------- fetch layer with a mocked network ----------
function mockFetch(routes) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    for (const [pat, body] of routes) {
      if (url.includes(pat)) {
        if (body instanceof Error) throw body;
        const text = typeof body === 'string' ? body : JSON.stringify(body);
        return new Response(text, { status: 200 });
      }
    }
    return new Response('not found', { status: 404, statusText: 'Not Found' });
  };
  return () => { globalThis.fetch = real; };
}

test('fetchValet rejects a series whose label does not match, then finds the right one via the group', async () => {
  const restore = mockFetch([
    ['observations/WRONG/json', { seriesDetail: { WRONG: { label: 'Some FX rate' } }, observations: [{ d: '2026-10-28', WRONG: { v: '1.3' } }] }],
    ['observations/group/g1/json', { seriesDetail: { WRONG: { label: 'Some FX rate' }, V1: { label: 'Prime rate - chartered banks' } } }],
    ['observations/V1/json', { seriesDetail: { V1: { label: 'Prime rate - chartered banks' } }, observations: [{ d: '2026-10-28', V1: { v: '4.7' } }] }],
  ]);
  try {
    const r = await fetchValet({ ids: ['WRONG'], expect: /prime/i, group: 'g1' }, '1990-01-01');
    assert.equal(r.id, 'V1');
    assert.deepEqual(r.points, [['2026-10-28', 4.7]]);
    await assert.rejects(fetchValet({ ids: ['WRONG'], expect: /prime/i }, '1990-01-01'), /does not match/);
  } finally { restore(); }
});

test('loadOne refuses implausible values and compresses step series', async () => {
  const restore = mockFetch([
    ['observations/V39079/json', {
      seriesDetail: { V39079: { label: 'Target for the overnight rate' } },
      observations: [['2026-10-26', '2.25'], ['2026-10-27', '2.25'], ['2026-10-28', '2.5']].map(([d, v]) => ({ d, V39079: { v } })),
    }],
  ]);
  try {
    const spec = { key: 'ca_policy', source: 'valet', label: 'x', ids: ['V39079'], expect: /overnight/i, unit: '%', stepOnly: true, sane: [0, 25] };
    const ok = await loadOne(spec);
    assert.deepEqual(ok.points, [['2026-10-26', 2.25], ['2026-10-28', 2.5]]);
    assert.equal(ok.asOf, '2026-10-28');
    await assert.rejects(loadOne({ ...spec, sane: [5, 25] }), /plausible range/);
  } finally { restore(); }
});

test('loadOne via keyless FRED CSV and via API key', async () => {
  const restore = mockFetch([
    ['fredgraph.csv?id=DGS10', 'observation_date,DGS10\n2026-10-27,4.1\n2026-10-28,4.2\n'],
    ['api.stlouisfed.org/fred/series/observations?series_id=DGS2', { observations: [{ date: '2026-10-28', value: '3.9' }] }],
  ]);
  try {
    const spec = { key: 'us_y10', source: 'fred', label: 'x', id: 'DGS10', unit: '%', sane: [-1, 25], daily: true };
    assert.equal((await loadOne(spec, { fredKey: '' })).asOf, '2026-10-28');
    const r = await loadOne({ ...spec, id: 'DGS2' }, { fredKey: 'k' });
    assert.deepEqual(r.points, [['2026-10-28', 3.9]]);
  } finally { restore(); }
});

test('inferFreq distinguishes daily, weekly, monthly and quarterly series', () => {
  const mk = (gapDays, n = 8) => Array.from({ length: n }, (_, i) => [new Date(Date.UTC(2026, 0, 1) + i * gapDays * 864e5).toISOString().slice(0, 10), 1]);
  assert.equal(inferFreq(mk(1)), 'd');
  assert.equal(inferFreq(mk(7)), 'w');
  assert.equal(inferFreq(mk(31)), 'm');
  assert.equal(inferFreq(mk(92)), 'q');
});

test('spread aligns on the first series dates', () => {
  const s = A.spread([['2026-01-02', 4], ['2026-01-05', 4.5]], [['2026-01-01', 3], ['2026-01-05', 3.2]]);
  assert.deepEqual(s.map((p) => +p[1].toFixed(2)), [1, 1.3]);
  assert.deepEqual(A.spread([['2025-01-01', 4]], [['2026-01-01', 3]]), []);
});

test('lastMove finds the latest change in a step series', () => {
  assert.deepEqual(A.lastMove([['2025-10-29', 2.25], ['2026-10-28', 2.5], ['2026-10-29', 2.5]]), { date: '2026-10-28', from: 2.25, to: 2.5 });
  assert.equal(A.lastMove([['2025-10-29', 2.25], ['2026-10-28', 2.25]]), null);
});

test('catalog is well-formed: no holes, unique keys, every entry has what its fetcher needs', () => {
  assert.equal(CATALOG.length, Object.keys(CATALOG).length);
  const keys = new Set();
  CATALOG.forEach((s, i) => {
    assert.ok(s && typeof s === 'object', `entry ${i} is empty`);
    assert.ok(!keys.has(s.key), `duplicate key ${s.key}`);
    keys.add(s.key);
    assert.ok(Array.isArray(s.sane) && s.sane.length === 2, `${s.key}: sane range`);
    if (s.source === 'valet') assert.ok(Array.isArray(s.ids) && s.expect instanceof RegExp && (s.ids.length || s.group), `${s.key}: valet spec`);
    if (s.source === 'statcan') assert.ok(Number.isInteger(s.vector), `${s.key}: vector`);
    if (s.source === 'fred') assert.ok(typeof s.id === 'string', `${s.key}: fred id`);
    assert.ok(['valet', 'statcan', 'fred'].includes(s.source), `${s.key}: source`);
  });
  assert.equal(CATALOG.length, 49);
});

test('Valet series labelled just "Total" are identified by their description', async () => {
  const j = { seriesDetail: { V36857: { label: 'Total', description: 'Canadian dollar assets - Less liquid assets - Mortgages' }, V36855: { label: 'Total', description: 'Canadian dollar assets - Less liquid assets - Non-mortgage loans' } },
    observations: [{ d: '2026-08-01', V36857: { v: '1841357' }, V36855: { v: '1815256' } }] };
  const restore = (() => { const real = globalThis.fetch; globalThis.fetch = async (url) => new Response(JSON.stringify(j)); return () => { globalThis.fetch = real; }; })();
  try {
    assert.equal((await fetchValet({ ids: ['V36857'], expect: /mortgages/i }, '1990-01-01')).points[0][1], 1841357);
    // the non-mortgage series also contains the word "mortgage" in its description, so a loose pattern would accept the wrong series;
    // the catalog uses /non-mortgage loans/ for that one, and /mortgages/ (plural) for the mortgage one
    await assert.rejects(fetchValet({ ids: ['V36857'], expect: /non-mortgage loans/i }, '1990-01-01'), /does not match/);
  } finally { restore(); }
});

test('a feed that carries the old rate forward under the announcement date is pending, not a mismatch', () => {
  const ann = { date: '2026-10-28', newRate: 2.5 };
  const feed = [['2025-10-29', 2.25], ['2026-10-27', 2.25], ['2026-10-28', 2.25]]; // what the real feed looked like on Oct 29
  assert.equal(A.reconcilePolicy(feed, ann).status, 'pending');
  const eff = A.effectivePolicy(feed, ann);
  assert.deepEqual(A.last(eff), ['2026-10-28', 2.5]);
  assert.deepEqual(A.lastMove(eff), { date: '2026-10-28', from: 2.25, to: 2.5 });
  assert.equal(eff.filter((p) => p[0] === '2026-10-28').length, 1);
  // still wrong three days later: that is a real disagreement
  assert.equal(A.reconcilePolicy([...feed, ['2026-11-04', 2.25]], ann).status, 'mismatch');
  // feed later catches up
  assert.equal(A.reconcilePolicy([...feed.slice(0, 2), ['2026-10-28', 2.5]], ann).status, 'match');
  // feed behind by a couple of days with later (still old) dates: overlay carries the new rate to the feed's last date
  const eff2 = A.effectivePolicy([...feed, ['2026-10-30', 2.25]], ann);
  assert.deepEqual(A.last(eff2), ['2026-10-30', 2.5]);
});
