import * as A from './analytics.js';
import { drawLineChart, chartTable, sparkline } from './chart.js';

// ---------- tiny helpers ----------
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else e.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return e;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem('rw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rw.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLong = (iso) => { const { y, m, d } = A.parseISO(iso); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const dateShort = (iso) => { const { y, m, d } = A.parseISO(iso); return `${MONTHS[m - 1]} ${d}${y === new Date().getFullYear() ? '' : ', ' + y}`; };
const monthYear = (iso) => { const { y, m } = A.parseISO(iso); return `${MONTHS[m - 1]} ${y}`; };
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysUntil = (iso) => Math.round((A.toMs(iso) - A.toMs(todayISO())) / 864e5);
const num = (v, d = 2) => (v == null ? '—' : v.toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d }));
const signed = (v, d = 2) => {
  if (v == null) return '—';
  const r = Number(v.toFixed(d));
  return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const money = (v) => (v == null ? '—' : '$' + Math.round(v).toLocaleString('en-CA'));
const signedMoney = (v) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('en-CA'));

// y-axis / tooltip formatters. ticks stay short; `full` is used in legends, tooltips and tables.
const fmtPct = (v, full) => (full ? v.toFixed(2) : String(+v.toFixed(2))) + '%';
const fmtPts = (v, full) => (full ? signed(v) : String(+v.toFixed(2))) + (full ? ' pts' : '');
const fmtInt = (v) => Math.round(v).toLocaleString('en-CA');
const fmtMoneyPer = (v, full) => (full ? '$' + v.toFixed(2) : '$' + +v.toFixed(0));
const fmtTn = (v, full) => '$' + (full ? v.toFixed(2) : +v.toFixed(1)) + 'T';
const fmtK = (v, full) => (full ? signedPlain(v, 1) : String(Math.round(v))) + 'k';
const fmtBn = (v, full) => '$' + (full ? v.toFixed(1) : String(Math.round(v))) + 'B';
const signedPlain = (v, d) => v.toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtCad = (v, full) => (full ? v.toFixed(4) : String(+v.toFixed(2)));

// ---------- state ----------
const TABS = [
  { id: 'overview', label: 'Overview', icon: '◉' },
  { id: 'canada', label: 'Canada', icon: '◧', ranged: true },
  { id: 'us', label: 'US', icon: '◨', ranged: true },
  { id: 'bonds', label: 'Bonds', icon: '≋', ranged: true },
  { id: 'housing', label: 'Housing', icon: '⌂', ranged: true },
  { id: 'data', label: 'Data', icon: '⋯' },
];
const RANGES = { '1Y': 12, '3Y': 36, '5Y': 60, '10Y': 120, Max: null };
const st = {
  doc: null, ann: null, cal: null, players: null, S: {}, loadedAt: 0, loadError: null,
  range: store.get('range', '5Y'),
  tab: 'overview',
  calc: { amount: 500000, years: 25, kind: 'fixed', rate: null, spread: 1.2, ...store.get('calc', {}) },
  btH: store.get('btH', 12),
};

const get = (k) => st.S[k] || [];
const meta = (k) => (st.doc && st.doc.series[k]) || null;
const has = (k) => get(k).length > 0;

// ---------- data ----------
async function fetchJson(path, optional) {
  try {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (optional) return null;
    throw e;
  }
}

function buildSeries() {
  const S = {};
  for (const [k, v] of Object.entries((st.doc && st.doc.series) || {})) S[k] = v.points;
  S.ca_policy_feed = S.ca_policy || [];
  if (S.ca_policy && st.ann) S.ca_policy = A.effectivePolicy(S.ca_policy, st.ann);
  const set = (k, f) => { try { const v = f(); if (v && v.length) S[k] = v; } catch { /* leave undefined */ } };
  if (S.ca_cpi_index) set('ca_cpi_yoy', () => A.yoy(S.ca_cpi_index));
  if (S.ca_nhpi) set('ca_nhpi_yoy', () => A.yoy(S.ca_nhpi));
  if (S.us_cpi_index) set('us_cpi_yoy', () => A.yoy(S.us_cpi_index));
  if (S.us_core_cpi_index) set('us_core_cpi_yoy', () => A.yoy(S.us_core_cpi_index));
  if (S.us_core_pce_index) set('us_core_pce_yoy', () => A.yoy(S.us_core_pce_index));
  if (S.us_payrolls) set('us_payrolls_chg', () => A.diff(S.us_payrolls));
  if (S.us_bank_credit) set('us_bank_credit_yoy', () => A.yoy(S.us_bank_credit));
  if (S.us_walcl) set('us_walcl_tn', () => S.us_walcl.map(([d, v]) => [d, v / 1e6]));
  if (S.ca_y10 && S.ca_y2) set('ca_10_2', () => A.spread(S.ca_y10, S.ca_y2));
  if (S.ca_y10 && S.us_y10) set('ca_us10', () => A.spread(S.ca_y10, S.us_y10));
  if (S.ca_employment) set('ca_employment_chg', () => A.diff(S.ca_employment));
  if (S.ca_bank_mortgages) set('ca_bank_mortgages_yoy', () => A.yoy(S.ca_bank_mortgages));
  if (S.ca_bank_nonmortgage) set('ca_bank_nonmortgage_yoy', () => A.yoy(S.ca_bank_nonmortgage));
  if (S.ca_boc_assets) set('ca_boc_assets_bn', () => S.ca_boc_assets.map(([d, v]) => [d, v / 1e3]));
  if (S.ca_y30 && S.ca_rrb) set('ca_breakeven', () => A.spread(S.ca_y30, S.ca_rrb));
  if (S.ca_y5) set('ca_fixed_est', () => A.addConst(S.ca_y5, st.calc.spread));
  st.S = S;
}

async function load() {
  st.loadError = null;
  const [doc, ann, cal, players] = await Promise.all([
    fetchJson('data/dashboard.json', true), fetchJson('data/announcement.json', true),
    fetchJson('data/calendar.json', true), fetchJson('data/players.json', true),
  ]);
  st.doc = doc; st.ann = ann; st.cal = cal; st.players = players;
  st.loadedAt = Date.now();
  buildSeries();
}

// freshness: a series is flagged when its latest observation is much older than its cadence implies (see analytics.js)
const isStale = (key) => A.isStale(meta(key), todayISO());

// ---------- building blocks ----------
function tile({ label, pts, base, d = 2, suffix = '%', delta = 'prior', deltaLabel, money: isMoney, scale = 1 }) {
  if (!pts || !pts.length) return null;
  const [date, raw] = A.last(pts);
  const v = raw * scale;
  let prev = null;
  if (delta === 'prior') prev = pts.length > 1 ? pts[pts.length - 2][1] * scale : null;
  else if (delta) { const b = A.valueAt(pts, A.shiftMonths(date, -delta)); prev = b == null ? null : b * scale; }
  const dv = prev == null ? null : v - prev;
  const stale = base ? isStale(base) : false;
  const valTxt = isMoney ? '$' + num(v, d) : num(v, d) + suffix;
  const arrow = dv == null ? '' : Number(dv.toFixed(d)) === 0 ? '▬' : dv > 0 ? '▲' : '▼';
  return h('div', { class: 'tile' },
    h('div', { class: 't-lbl', title: label }, label),
    h('div', { class: 't-row' }, h('div', { class: 't-val' }, valTxt), sparkline(pts.slice(-(pts.length > 400 ? 90 : 24)), 1)),
    h('div', { class: 't-delta' }, dv == null ? '' : `${arrow} ${signed(dv, d)} ${deltaLabel || (delta === 'prior' ? 'vs prior' : `vs ${delta} mo ago`)}`),
    h('div', { class: 't-asof' }, 'as of ', dateShort(date), stale ? h('span', { class: 'stale' }, ' ⚠ stale') : ''));
}

function windowed(points, months, step) {
  if (months == null || !points.length) return points;
  const cutoff = A.shiftMonths(A.last(points)[0], -months);
  const out = points.filter((p) => p[0] >= cutoff);
  if (step) { const v = A.valueAt(points, cutoff); if (v != null && (!out.length || out[0][0] > cutoff)) out.unshift([cutoff, v]); }
  return out;
}

function missingCard(title, keys) {
  return h('section', { class: 'card' }, h('h3', null, title),
    h('p', { class: 'sub' }, 'Not loaded yet. ', keys.length ? 'Missing: ' + keys.join(', ') + '. ' : '', 'See the Data tab.'));
}

/** series: [{label, points:[[iso,v]], step?}] */
function lineCard({ title, sub, series, yFormat, refLines, markers, step, base, fixedRange, source, height }) {
  const ser = series.filter((s) => s.points && s.points.length);
  if (!ser.length) return missingCard(title, series.map((s) => s.label));
  const range = fixedRange || st.range;
  const months = RANGES[range];
  const build = () => ({
    xType: 'time',
    series: ser.map((s, i) => ({
      label: s.label, color: i + 1, step: s.step ?? step,
      points: windowed(s.points, months, s.step ?? step).map(([d, v]) => [A.toMs(d), v]),
    })),
    yFormat, refLines, height,
    markers: (markers || []).map((d) => ({ x: A.toMs(d) })),
    ariaLabel: `${title}. ` + ser.map((s) => `${s.label}: ${yFormat(A.last(s.points)[1], true)}`).join('; '),
  });
  const host = h('div', { class: 'chart' });
  const tableHost = h('div', { class: 'table-wrap', hidden: true });
  const toggle = h('button', { class: 'linkbtn', type: 'button', 'aria-expanded': 'false' }, 'Show table');
  toggle.addEventListener('click', () => {
    const open = tableHost.hidden;
    tableHost.hidden = !open;
    toggle.textContent = open ? 'Hide table' : 'Show table';
    toggle.setAttribute('aria-expanded', String(open));
    if (open) tableHost.replaceChildren(chartTable(build()));
  });
  const asOf = ser.reduce((a, s) => { const d = A.last(s.points)[0]; return d > a ? d : a; }, '');
  const card = h('section', { class: 'card' },
    h('h3', null, title), sub ? h('p', { class: 'sub' }, sub) : null,
    h('div', { class: 'legend' }, ser.map((s, i) => h('span', { class: 'item' },
      h('span', { class: `swatch s${i + 1} d${i}` }), s.label, ' ', h('b', null, yFormat(A.last(s.points)[1], true))))),
    host, tableHost,
    h('div', { class: 'foot' }, toggle, h('span', null, 'as of ', dateShort(asOf)),
      base && isStale(base) ? h('span', { class: 'status-stale' }, '⚠ stale') : null,
      markers && markers.length ? h('span', null, '┆ dotted lines: first hike of a cycle') : null,
      source ? h('span', null, source) : null));
  queueMicrotask(() => drawLineChart(host, build()));
  return card;
}

function curveCard({ title, sub, tenors, snaps }) {
  const live = tenors.filter((t) => has(t.key));
  if (live.length < 2) return missingCard(title, tenors.map((t) => t.key));
  const refDate = A.last(get(live[0].key))[0];
  const series = snaps.map((sn) => ({
    label: sn.months ? `${sn.label} (${monthYear(A.shiftMonths(refDate, -sn.months))})` : `${sn.label} (${dateShort(refDate)})`,
    points: live.map((t, i) => {
      const pts = get(t.key);
      const v = sn.months ? A.valueAt(pts, A.shiftMonths(refDate, -sn.months)) : A.last(pts)[1];
      return v == null ? null : [i, v];
    }).filter(Boolean),
  })).filter((s) => s.points.length);
  const cfg = {
    xType: 'category', categories: live.map((t) => t.label),
    series: series.map((s, i) => ({ ...s, color: i + 1 })), yFormat: fmtPct, height: 200,
    ariaLabel: `${title} across ${live.map((t) => t.label).join(', ')}`,
  };
  const host = h('div', { class: 'chart' });
  const tableHost = h('div', { class: 'table-wrap', hidden: true }, chartTable(cfg));
  const toggle = h('button', { class: 'linkbtn', type: 'button', 'aria-expanded': 'false' }, 'Show table');
  toggle.addEventListener('click', () => {
    tableHost.hidden = !tableHost.hidden;
    toggle.textContent = tableHost.hidden ? 'Show table' : 'Hide table';
    toggle.setAttribute('aria-expanded', String(!tableHost.hidden));
  });
  const card = h('section', { class: 'card' }, h('h3', null, title), sub ? h('p', { class: 'sub' }, sub) : null,
    h('div', { class: 'legend' }, series.map((s, i) => h('span', { class: 'item' }, h('span', { class: `swatch s${i + 1} d${i}` }), s.label))),
    host, tableHost, h('div', { class: 'foot' }, toggle));
  queueMicrotask(() => drawLineChart(host, cfg));
  return card;
}

const SNAPS = [{ label: 'Latest', months: 0 }, { label: '3 months ago', months: 3 }, { label: '1 year ago', months: 12 }];

// ---------- tabs ----------
function banners() {
  const out = [];
  if (st.doc && st.doc.meta && st.doc.meta.synthetic) {
    out.push(h('div', { class: 'banner bad', role: 'alert' }, h('b', null, 'SYNTHETIC TEST DATA. '), 'These numbers are generated for layout testing and are not real market data.'));
  }
  if (!st.doc) {
    out.push(h('div', { class: 'banner warn' }, h('b', null, 'No market data yet. '),
      'The announcement below is loaded, but charts need ', h('code', null, 'data/dashboard.json'), '. Generate it with:',
      h('pre', null, 'node scripts/refresh.mjs        # fetches Bank of Canada, StatCan and FRED (no API keys)\nnode scripts/serve.mjs          # then open http://localhost:8080')));
  } else {
    const errs = (st.doc.errors || []).filter((e) => !e.optional);
    const stale = Object.keys(st.doc.series).filter(isStale);
    if (errs.length || stale.length) {
      out.push(h('div', { class: 'banner warn' }, h('b', null, 'Some data is missing or stale. '),
        errs.length ? `${errs.length} required series failed to load. ` : '', stale.length ? `${stale.length} ${stale.length === 1 ? 'series looks' : 'series look'} out of date. ` : '',
        h('a', { href: '#/data' }, 'See Data tab')));
    }
  }
  return out;
}

function reconcileChip() {
  const ann = st.ann;
  if (!ann) return null;
  const rec = A.reconcilePolicy(get('ca_policy_feed'), ann);
  const feed = rec.feed;
  const map = {
    match: ['good', '✓ Matches Bank of Canada data'],
    pending: ['warn', `⏳ Bank of Canada data feed still shows ${feed ? feed[1].toFixed(2) : '?'}% (${feed ? dateShort(feed[0]) : ''}); using the announced ${ann.newRate.toFixed(2)}% until it catches up`],
    mismatch: ['bad', `⚠ Data feed shows ${feed ? feed[1].toFixed(2) : '?'}%, announcement says ${ann.newRate.toFixed(2)}%. Check data/announcement.json`],
    nodata: ['', 'Announced rate (no data feed loaded)'],
    none: ['', ''],
  };
  const [cls, txt] = map[rec.status];
  return txt ? h('span', { class: `chip ${cls}` }, txt) : null;
}

function hero() {
  const ann = st.ann;
  const pol = get('ca_policy');
  const polNow = pol.length ? A.last(pol)[1] : ann ? ann.newRate : null;
  const mv = pol.length ? A.lastMove(pol) : ann ? { date: ann.date, from: ann.previousRate, to: ann.newRate } : null;
  let prime = null, primeNote = '';
  const pr = get('ca_prime');
  if (ann && (!pr.length || A.last(pr)[0] < ann.date)) { prime = ann.newPrime; primeNote = `announced ${dateShort(ann.date)}`; }
  else if (pr.length) { prime = A.last(pr)[1]; primeNote = `as of ${dateShort(A.last(pr)[0])}`; }
  const nextDate = ann && ann.nextDecision;
  const dn = nextDate ? daysUntil(nextDate) : null;
  const ff = get('us_ff_upper'), ffl = get('us_ff_lower');
  return h('section', { class: 'card' },
    h('div', { class: 'hero' },
      h('div', null, h('div', { class: 'lbl' }, 'Bank of Canada policy rate'), h('div', { class: 'big' }, polNow == null ? '—' : num(polNow) + '%'),
        h('div', { class: 'meta' }, mv ? `${mv.to > mv.from ? '▲ +' : '▼ '}${num(Math.abs(mv.to - mv.from))} pts on ${dateShort(mv.date)} (from ${num(mv.from)}%)` : '')),
      h('div', null, h('div', { class: 'lbl' }, 'Prime rate'), h('div', { class: 'big' }, prime == null ? '—' : num(prime) + '%'), h('div', { class: 'meta' }, primeNote)),
      h('div', null, h('div', { class: 'lbl' }, 'Next BoC decision'), h('div', { class: 'big' }, nextDate ? dateShort(nextDate).replace(/, \d{4}$/, '') : '—'),
        h('div', { class: 'meta' }, dn == null ? '' : dn > 0 ? `in ${dn} day${dn === 1 ? '' : 's'}` : dn === 0 ? 'today' : 'date has passed; update announcement.json')),
      ff.length ? h('div', null, h('div', { class: 'lbl' }, 'US fed funds target'),
        h('div', { class: 'big' }, `${num(A.last(ffl.length ? ffl : ff)[1])}–${num(A.last(ff)[1])}%`),
        h('div', { class: 'meta' }, 'as of ', dateShort(A.last(ff)[0]))) : null),
    h('div', { class: 'foot' }, reconcileChip()));
}

function announcementCard() {
  const a = st.ann;
  if (!a) return null;
  return h('section', { class: 'card' }, h('h3', null, a.title), h('p', { class: 'sub' }, dateLong(a.date)),
    h('ul', { class: 'bul' }, a.points.map((p) => h('li', null, p))),
    h('div', { class: 'foot' }, a.source));
}

function calendarCard() {
  const ev = ((st.cal && st.cal.events) || []).filter((e) => daysUntil(e.date) >= 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!ev.length) return null;
  return h('section', { class: 'card' }, h('h3', null, 'Coming up'),
    h('div', { class: 'who' }, ev.map((e) => h('div', null, h('b', null, `${dateLong(e.date)} · ${e.who}`),
      h('span', null, `${e.what} (in ${daysUntil(e.date)} days)`), e.detail ? h('span', { class: 'small' }, e.detail) : null))));
}

function housingTeaser() {
  const sig = A.housingSignals(st.S);
  const c = A.composite(sig);
  if (!sig.length) return null;
  const icon = c.label === 'Headwinds' ? '▼' : c.label === 'Supportive' ? '▲' : '●';
  return h('section', { class: 'card' }, h('h3', null, 'Canadian housing read'),
    h('p', { class: 'sub' }, h('span', { class: `chip ${c.label === 'Headwinds' ? 'bad' : c.label === 'Supportive' ? 'good' : ''}` }, `${icon} ${c.label}`),
      ` ${c.headwinds} of ${c.n} signals lean negative, ${c.supports} positive.`),
    h('div', { class: 'foot' }, h('a', { href: '#/housing' }, 'See signals, payment calculator and rate-hike backtest →')));
}

function viewOverview() {
  const t = [
    tile({ label: 'CPI inflation (y/y)', pts: get('ca_cpi_yoy'), base: 'ca_cpi_index', d: 1, deltaLabel: 'vs prior month' }),
    tile({ label: 'CPI-trim (core)', pts: get('ca_cpi_trim'), base: 'ca_cpi_trim', d: 1 }),
    tile({ label: 'CPI-median (core)', pts: get('ca_cpi_median'), base: 'ca_cpi_median', d: 1 }),
    tile({ label: 'Unemployment', pts: get('ca_unemp'), base: 'ca_unemp', d: 1 }),
    tile({ label: 'GoC 2-yr yield', pts: get('ca_y2'), base: 'ca_y2', delta: 1 }),
    tile({ label: 'GoC 5-yr yield', pts: get('ca_y5'), base: 'ca_y5', delta: 1 }),
    tile({ label: 'GoC 10-yr yield', pts: get('ca_y10'), base: 'ca_y10', delta: 1 }),
    tile({ label: '5-yr fixed (estimate)', pts: get('ca_fixed_est'), base: 'ca_y5', delta: 1 }),
    tile({ label: 'US 10-yr Treasury', pts: get('us_y10'), base: 'us_y10', delta: 1 }),
    tile({ label: 'US CPI (y/y)', pts: get('us_cpi_yoy'), base: 'us_cpi_index', d: 1, deltaLabel: 'vs prior month' }),
    tile({ label: 'US unemployment', pts: get('us_unemp'), base: 'us_unemp', d: 1 }),
    tile({ label: 'US 30-yr mortgage', pts: get('us_mort30'), base: 'us_mort30', delta: 1 }),
    tile({ label: 'WTI crude oil', pts: get('us_wti'), base: 'us_wti', money: true, d: 2, delta: 1 }),
    tile({ label: 'CAD per USD', pts: get('usdcad'), base: 'usdcad', d: 4, suffix: '', delta: 1 }),
  ].filter(Boolean);
  return [
    ...banners(), hero(), announcementCard(), calendarCard(),
    t.length ? h('h2', { class: 'section' }, 'Key numbers') : null,
    t.length ? h('div', { class: 'tiles' }, t) : null,
    housingTeaser(),
    has('ca_fixed_est') ? h('p', { class: 'small' }, '5-yr fixed (estimate) = GoC 5-yr yield + ', num(st.calc.spread, 2), ' pts lender spread (editable on the Housing tab). It is an estimate, not a quoted rate.') : null,
  ];
}

function viewCanada() {
  return [
    ...banners(),
    lineCard({
      title: 'Policy rate and prime', sub: 'Overnight target set by the Bank of Canada; prime follows it. CORRA is the overnight repo rate.', step: true, base: 'ca_policy', yFormat: fmtPct,
      series: [{ label: 'Policy rate', points: get('ca_policy') }, { label: 'Prime rate', points: get('ca_prime') }, { label: 'CORRA', points: get('ca_corra'), step: false }],
    }),
    curveCard({
      title: 'Government of Canada yield curve', sub: 'Benchmark bond yields by maturity.',
      tenors: [{ key: 'ca_y2', label: '2y' }, { key: 'ca_y3', label: '3y' }, { key: 'ca_y5', label: '5y' }, { key: 'ca_y7', label: '7y' }, { key: 'ca_y10', label: '10y' }, { key: 'ca_y30', label: 'Long' }],
      snaps: SNAPS,
    }),
    lineCard({
      title: 'Government of Canada yields', sub: 'Fixed mortgage rates follow the 5-year yield.', base: 'ca_y10', yFormat: fmtPct,
      series: [{ label: '2-year', points: get('ca_y2') }, { label: '10-year', points: get('ca_y10') }, { label: 'Long-term', points: get('ca_y30') }],
    }),
    lineCard({
      title: 'Inflation', sub: 'Year over year. Bank of Canada target: 2%, inside a 1–3% control range.', base: 'ca_cpi_trim', yFormat: fmtPct,
      refLines: [{ y: 2, label: '2% target' }, { y: 3, label: '3%' }],
      series: [{ label: 'CPI', points: get('ca_cpi_yoy') }, { label: 'CPI-trim', points: get('ca_cpi_trim') }, { label: 'CPI-median', points: get('ca_cpi_median') }, { label: 'CPI-common', points: get('ca_cpi_common') }],
    }),
    lineCard({ title: 'Unemployment rate', sub: 'Seasonally adjusted.', base: 'ca_unemp', yFormat: fmtPct, series: [{ label: 'Canada', points: get('ca_unemp') }] }),
    lineCard({ title: 'Employment, monthly change', sub: 'Thousands of jobs, seasonally adjusted (Labour Force Survey).', base: 'ca_employment', yFormat: fmtK, refLines: [{ y: 0, label: '0' }], series: [{ label: 'Change', points: get('ca_employment_chg') }] }),
    lineCard({
      title: '5-year fixed mortgage rate', sub: 'Posted by the big banks (what discounted rates are measured against) and an estimate of a typical discounted rate.', base: 'ca_y5', yFormat: fmtPct,
      series: [{ label: 'Posted 5-year', points: get('ca_mort5_posted') }, { label: 'Estimated discounted', points: get('ca_fixed_est') }],
    }),
    lineCard({ title: 'New housing price index, y/y', sub: 'New homes only (house and land); lags resale prices.', base: 'ca_nhpi', yFormat: fmtPct, refLines: [{ y: 0, label: '0%' }], series: [{ label: 'Canada', points: get('ca_nhpi_yoy') }] }),
    lineCard({ title: 'Housing starts', sub: 'Thousands of units, annualised (CMHC via Statistics Canada).', base: 'ca_starts', yFormat: fmtK, series: [{ label: 'Starts', points: get('ca_starts') }] }),
    h('h2', { class: 'section' }, 'Canadian banks and the Bank of Canada'),
    lineCard({ title: 'Bank of Canada balance sheet', sub: 'Total assets, billions of dollars, weekly.', base: 'ca_boc_assets', yFormat: fmtBn, series: [{ label: 'Total assets', points: get('ca_boc_assets_bn') }] }),
    lineCard({
      title: 'Bank loan growth', sub: 'Chartered banks, Canadian-dollar loans, year over year.', base: 'ca_bank_mortgages', yFormat: fmtPct, refLines: [{ y: 0, label: '0%' }],
      series: [{ label: 'Mortgage loans', points: get('ca_bank_mortgages_yoy') }, { label: 'Non-mortgage loans', points: get('ca_bank_nonmortgage_yoy') }],
    }),
    lineCard({
      title: 'Mortgage delinquency at banks', sub: 'Residential mortgages, share in arrears (Bank of Canada financial vulnerabilities indicator, quarterly).', base: 'ca_arrears_mtg', yFormat: fmtPct,
      series: [{ label: 'Mortgage arrears', points: get('ca_arrears_mtg') }], source: 'Not directly comparable with the US share-past-due measure.',
    }),
    h('p', { class: 'small' }, 'Credit spreads: the US tab shows a high-yield spread. No free, current Canadian equivalent was found (the Bank of Canada only publishes old chart snapshots), so none is shown.'),
  ];
}

function viewUS() {
  return [
    ...banners(),
    lineCard({
      title: 'Fed funds', sub: 'FOMC target range and the effective rate.', step: true, base: 'us_ff_upper', yFormat: fmtPct,
      series: [{ label: 'Target, upper', points: get('us_ff_upper') }, { label: 'Target, lower', points: get('us_ff_lower') }, { label: 'Effective rate', points: get('us_effr'), step: false }],
    }),
    curveCard({
      title: 'US Treasury yield curve', sub: 'Constant-maturity yields.',
      tenors: [{ key: 'us_y3m', label: '3m' }, { key: 'us_y2', label: '2y' }, { key: 'us_y5', label: '5y' }, { key: 'us_y10', label: '10y' }, { key: 'us_y30', label: '30y' }],
      snaps: SNAPS,
    }),
    lineCard({
      title: 'Treasury yields', base: 'us_y10', yFormat: fmtPct,
      series: [{ label: '2-year', points: get('us_y2') }, { label: '10-year', points: get('us_y10') }, { label: '30-year', points: get('us_y30') }],
    }),
    lineCard({
      title: 'Inflation', sub: 'Year over year, computed from the price indexes. Fed target: 2% (PCE).', base: 'us_cpi_index', yFormat: fmtPct, refLines: [{ y: 2, label: '2%' }],
      series: [{ label: 'CPI', points: get('us_cpi_yoy') }, { label: 'Core CPI', points: get('us_core_cpi_yoy') }, { label: 'Core PCE', points: get('us_core_pce_yoy') }],
    }),
    lineCard({ title: 'Unemployment rate', base: 'us_unemp', yFormat: fmtPct, series: [{ label: 'US', points: get('us_unemp') }] }),
    lineCard({ title: 'Nonfarm payrolls, monthly change', sub: 'Thousands of jobs.', base: 'us_payrolls', yFormat: (v) => fmtInt(v), refLines: [{ y: 0, label: '0' }], series: [{ label: 'Change', points: get('us_payrolls_chg') }] }),
    lineCard({ title: '30-year fixed mortgage rate', sub: 'Freddie Mac weekly survey.', base: 'us_mort30', yFormat: fmtPct, series: [{ label: 'US 30-yr', points: get('us_mort30') }] }),
    h('h2', { class: 'section' }, 'US banks and the Fed'),
    lineCard({ title: 'Fed balance sheet', sub: 'Total assets, trillions of dollars.', base: 'us_walcl', yFormat: fmtTn, series: [{ label: 'Total assets', points: get('us_walcl_tn') }] }),
    lineCard({ title: 'Bank credit growth', sub: 'All US commercial banks, year over year.', base: 'us_bank_credit', yFormat: fmtPct, refLines: [{ y: 0, label: '0%' }], series: [{ label: 'Bank credit', points: get('us_bank_credit_yoy') }] }),
    lineCard({ title: 'Mortgage delinquency at banks', sub: 'Single-family residential loans, share past due.', base: 'us_delinq_mort', yFormat: fmtPct, series: [{ label: 'Delinquency', points: get('us_delinq_mort') }] }),
    lineCard({ title: 'High-yield credit spread', sub: 'Extra yield investors demand over Treasuries; widens in stress.', base: 'us_hy_oas', yFormat: fmtPct, series: [{ label: 'ICE BofA HY OAS', points: get('us_hy_oas') }] }),
  ];
}

function tenorTable() {
  const rows = [['2-year', 'ca_y2', 'us_y2'], ['5-year', 'ca_y5', 'us_y5'], ['10-year', 'ca_y10', 'us_y10'], ['30-year / long', 'ca_y30', 'us_y30']];
  const cell = (k) => (has(k) ? A.last(get(k))[1] : null);
  const d3 = (k) => A.change(get(k), 3);
  const body = rows.map(([lbl, c, u]) => {
    const cv = cell(c), uv = cell(u);
    return h('tr', null, h('td', null, lbl), h('td', null, cv == null ? '—' : num(cv) + '%'), h('td', null, uv == null ? '—' : num(uv) + '%'),
      h('td', null, cv != null && uv != null ? signed(cv - uv) : '—'), h('td', null, signed(has(c) ? d3(c) : null)), h('td', null, signed(has(u) ? d3(u) : null)));
  });
  return h('section', { class: 'card wide' }, h('h3', null, 'Benchmark yields: Canada vs US'), h('p', { class: 'sub' }, 'Spread and 3-month change in percentage points.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
      h('thead', null, h('tr', null, ['Maturity', 'Canada', 'US', 'CA − US', 'CA 3m Δ', 'US 3m Δ'].map((x) => h('th', null, x)))),
      h('tbody', null, body))));
}

function holdersCard() {
  const fed = has('us_debt_fed') ? A.last(get('us_debt_fed')) : null;
  const frn = has('us_debt_foreign') ? A.last(get('us_debt_foreign')) : null;
  const prv = has('us_debt_private') ? A.last(get('us_debt_private')) : null;
  if (!fed || !frn || !prv) return missingCard('Who holds US government debt', ['us_debt_fed', 'us_debt_foreign', 'us_debt_private']);
  if (frn[1] > prv[1]) return h('section', { class: 'card' }, h('h3', null, 'Who holds US government debt'), h('p', { class: 'sub' }, 'Foreign holdings exceed total private holdings in the data; the split assumption does not hold, so nothing is shown.'));
  const dom = prv[1] - frn[1];
  const tot = fed[1] + prv[1];
  const parts = [['Federal Reserve', fed[1], 1], ['Foreign & international', frn[1], 2], ['US private investors', dom, 3]];
  return h('section', { class: 'card' }, h('h3', null, 'Who holds US government debt'), h('p', { class: 'sub' }, `Share of debt held by the public, ${dateShort(fed[0])} (quarterly data).`),
    h('div', { class: 'bar', role: 'img', 'aria-label': parts.map(([n, v]) => `${n} ${(v / tot * 100).toFixed(1)}%`).join(', ') },
      parts.map(([n, v, c]) => h('div', { class: `s${c}`, style: `width:${(v / tot * 100).toFixed(2)}%`, title: n }))),
    h('div', { class: 'legend' }, parts.map(([n, v, c]) => h('span', { class: 'item' }, h('span', { class: `swatch s${c} d${c - 1}` }), n, ' ', h('b', null, (v / tot * 100).toFixed(1) + '%'), ` ($${(v / 1e3).toFixed(1)}T)`))),
    h('div', { class: 'foot' }, 'Source: FRED (Treasury Fiscal Service). Foreign holdings are treated as a subset of private-investor holdings.'));
}

function playersCards() {
  const p = st.players;
  if (!p) return [];
  return [h('h2', { class: 'section' }, 'The players'), h('p', { class: 'small' }, p.note),
    h('div', { class: 'grid' }, p.groups.map((g) => h('section', { class: 'card' }, h('h3', null, g.title),
      h('div', { class: 'who' }, g.players.map((x) => h('div', null, h('b', null, x.name), h('span', null, x.role), h('span', { class: 'small' }, 'Why it matters: ' + x.why)))))))];
}

function viewBonds() {
  return [
    ...banners(), tenorTable(),
    lineCard({ title: '10-year yield: Canada vs US', base: 'ca_y10', yFormat: fmtPct, series: [{ label: 'Canada 10y', points: get('ca_y10') }, { label: 'US 10y', points: get('us_y10') }] }),
    lineCard({ title: 'Canada minus US, 10-year', sub: 'Negative means Canadian yields are below US yields.', base: 'ca_y10', yFormat: fmtPts, refLines: [{ y: 0, label: '0' }], series: [{ label: 'CA − US', points: get('ca_us10') }] }),
    lineCard({ title: 'Curve slope: 10-year minus 2-year', sub: 'Below zero = inverted curve, historically a slowdown signal.', base: 'ca_y10', yFormat: fmtPts, refLines: [{ y: 0, label: '0' }], series: [{ label: 'Canada', points: get('ca_10_2') }, { label: 'US', points: get('us_10y2y') }] }),
    lineCard({
      title: 'Breakeven inflation', sub: 'Inflation the bond market is pricing in: US 10-year, and Canada long-term (nominal minus real-return bond yield).', base: 'us_be10', yFormat: fmtPct,
      series: [{ label: 'US 10-year', points: get('us_be10') }, { label: 'Canada long-term', points: get('ca_breakeven') }],
    }),
    holdersCard(),
    ...playersCards(),
  ];
}

// ---- housing ----
function signalsCard() {
  const sig = A.housingSignals(st.S);
  const c = A.composite(sig);
  if (!sig.length) return missingCard('Housing backdrop', ['ca_policy', 'ca_y5', 'ca_cpi_trim']);
  const icon = { '-1': ['▼', 'dn', 'Headwind'], '0': ['●', 'nu', 'Neutral'], '1': ['▲', 'up', 'Supportive'] };
  return h('section', { class: 'card' }, h('h3', null, 'What the backdrop says'),
    h('p', { class: 'sub' }, h('span', { class: `chip ${c.label === 'Headwinds' ? 'bad' : c.label === 'Supportive' ? 'good' : ''}` }, `${c.label === 'Headwinds' ? '▼' : c.label === 'Supportive' ? '▲' : '●'} ${c.label}`),
      ` score ${c.score > 0 ? '+' : ''}${c.score} across ${c.n} signals`),
    h('div', null, sig.map((s) => { const [g, cls, word] = icon[String(s.tilt)]; return h('div', { class: 'signal' },
      h('span', { class: `ic ${cls}`, 'aria-label': word, title: word }, g), h('span', null, s.label), h('span', { class: 'val' }, s.value), h('span', { class: 'rule' }, `Reads as ${word.toLowerCase()}. Rule: ${s.rule}`)); })),
    h('div', { class: 'foot' }, 'Rules-based reading of public data, one point per signal. Not a forecast and not financial advice.'));
}

function calcCard() {
  const c = st.calc;
  const y5 = has('ca_y5') ? A.last(get('ca_y5'))[1] : null;
  const out = h('div', { class: 'table-wrap' });
  const save = () => store.set('calc', c);
  const inputs = {
    amount: h('input', { type: 'number', inputmode: 'numeric', min: '0', step: '5000', value: c.amount, id: 'c-amount' }),
    years: h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '40', step: '1', value: c.years, id: 'c-years' }),
    kind: h('select', { id: 'c-kind' }, h('option', { value: 'fixed' }, 'Fixed'), h('option', { value: 'variable' }, 'Variable')),
    rate: h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.05', id: 'c-rate', placeholder: y5 == null ? 'e.g. 4.5' : `est. ${num(y5 + c.spread)}` }),
    spread: h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.1', value: c.spread, id: 'c-spread' }),
  };
  inputs.kind.value = c.kind;
  if (c.rate != null) inputs.rate.value = c.rate;
  const draw = () => {
    const est = y5 == null ? null : y5 + c.spread;
    const rate = c.rate != null && c.rate !== '' ? Number(c.rate) : est;
    if (!(c.amount > 0) || !(c.years > 0) || rate == null || !Number.isFinite(rate)) { out.replaceChildren(h('p', { class: 'small' }, 'Enter a balance, amortization and rate.')); return; }
    const comp = c.kind === 'variable' ? 'monthly' : 'semiannual';
    const base = A.payment(c.amount, rate, c.years, comp);
    const rows = [-0.5, -0.25, 0, 0.25, 0.5, 1].map((dx) => {
      const r = rate + dx;
      if (r < 0) return null;
      const p = A.payment(c.amount, r, c.years, comp);
      return h('tr', { class: dx === 0 ? 'sum' : '' }, h('td', null, `${num(r)}%` + (dx === 0 ? ' (now)' : '')), h('td', null, money(p)), h('td', null, dx === 0 ? '—' : signedMoney(p - base)), h('td', null, dx === 0 ? '—' : signedMoney((p - base) * 12)));
    }).filter(Boolean);
    const sr = A.stressRate(rate);
    const bump = A.payment(c.amount, rate + 0.25, c.years, comp) - base;
    out.replaceChildren(
      h('p', null, h('b', null, `A 0.25-pt rise adds about ${money(bump)} a month`), ` on ${money(c.amount)} at ${num(rate)}% over ${c.years} years.`),
      h('table', { class: 'data-table' }, h('thead', null, h('tr', null, ['Rate', 'Payment / mo', 'Δ / month', 'Δ / year'].map((x) => h('th', null, x)))), h('tbody', null, rows)),
      h('p', { class: 'small' }, `Typical qualifying (stress-test) rate: ${num(sr)}% (contract + 2 pts, floor 5.25%) → ${money(A.payment(c.amount, sr, c.years, 'semiannual'))} a month. Lender rules vary.`));
  };
  const on = (el, fn) => el.addEventListener('input', () => { fn(); save(); draw(); });
  on(inputs.amount, () => { c.amount = Number(inputs.amount.value); });
  on(inputs.years, () => { c.years = Number(inputs.years.value); });
  on(inputs.kind, () => { c.kind = inputs.kind.value; });
  on(inputs.rate, () => { c.rate = inputs.rate.value === '' ? null : Number(inputs.rate.value); });
  on(inputs.spread, () => { c.spread = Number(inputs.spread.value) || 0; buildSeries(); });
  draw();
  const lab = (t, el) => h('label', null, t, el);
  return h('section', { class: 'card' }, h('h3', null, 'Payment calculator'),
    h('p', { class: 'sub' }, 'What higher rates do to a monthly payment. Leave the rate blank to use the market estimate (GoC 5-yr yield + spread). Fixed uses semi-annual compounding, variable monthly.'),
    h('div', { class: 'form' }, lab('Mortgage balance ($)', inputs.amount), lab('Amortization (years)', inputs.years), lab('Rate type', inputs.kind),
      lab('Your rate (%)', inputs.rate), lab('Lender spread over 5-yr GoC (pts)', inputs.spread)),
    out);
}

function backtestCards() {
  const pol = get('ca_policy'), nh = get('ca_nhpi'), y5 = get('ca_y5');
  if (!pol.length || !nh.length) return [missingCard('Rate-hike backtest', ['ca_policy', 'ca_nhpi'])];
  const bt = A.backtest({ policy: pol, nhpi: nh, y5 }, [6, 12, 24]);
  const H = st.btH;
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Months after first hike' }, [6, 12, 24].map((m) => h('button', { type: 'button', 'aria-pressed': String(m === H), onclick: () => { st.btH = m; store.set('btH', m); render(); } }, `${m} months after`)));
  const fm = (v, d = 2, unit = '') => (v == null ? h('span', { class: 'muted' }, '—') : signed(v, d) + unit);
  const rows = bt.rows.map((r) => {
    const c = r.horizons[H];
    return h('tr', null, h('td', null, monthYear(r.date), h('br'), h('span', { class: 'muted' }, `${num(r.from)}→${num(r.to)}%`)), h('td', null, fm(c.policy)), h('td', null, fm(c.y5)), h('td', null, fm(c.price, 1, '%')), h('td', null, fm(c.excess, 1, ' pts')));
  });
  const sm = bt.summary[H];
  rows.push(h('tr', { class: 'sum' }, h('td', null, `Median (${sm.n} completed)`), h('td', null, fm(sm.policy)), h('td', null, fm(sm.y5)), h('td', null, fm(sm.price, 1, '%')), h('td', null, fm(sm.excess, 1, ' pts'))));
  const table = h('section', { class: 'card wide' }, h('h3', null, 'Backtest: what followed past rate hikes'),
    h('p', { class: 'sub' }, 'A cycle starts with a hike after 12+ months without one. Changes are measured from that first hike: policy and yield in percentage points, prices (new-home index) in %. "—" means the horizon has not happened yet or the data does not reach back.'),
    seg,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
      h('thead', null, h('tr', null, ['First hike', 'Policy Δ', '5-yr yld Δ', 'Prices', 'vs typical'].map((x) => h('th', null, x)))), h('tbody', null, rows))),
    h('div', { class: 'foot' }, '"vs typical" compares with the average change over any ', String(H), '-month window since the series began. Prices use the new housing price index: it excludes resale homes and moves slowly, so treat it as a rough guide. Few cycles means wide uncertainty; this is history, not a forecast.'));
  const starts = bt.rows.map((r) => r.date);
  return [table,
    lineCard({ title: 'Policy rate since 1990s', sub: 'Dotted lines mark the first hike of each cycle.', base: 'ca_policy', step: true, yFormat: fmtPct, markers: starts, fixedRange: 'Max', series: [{ label: 'Policy rate', points: pol }] }),
    lineCard({ title: 'New-home prices, y/y', base: 'ca_nhpi', yFormat: fmtPct, refLines: [{ y: 0, label: '0%' }], markers: starts, fixedRange: 'Max', series: [{ label: 'New housing price index', points: get('ca_nhpi_yoy') }] })];
}

function scenariosCard() {
  return h('section', { class: 'card scen' }, h('h3', null, 'Three ways the next year could go'),
    h('p', { class: 'small' }, 'A framework for reading the data above. No probabilities are assigned.'),
    h('div', null, h('h3', null, 'Pause and absorb'), h('p', null, 'Energy-driven inflation fades and the Bank stops at or near 2.50–2.75%. Fixed rates drift sideways, resale activity stays subdued but orderly. ', h('b', null, 'Watch: '), 'CPI-trim and CPI-median back under 3%, oil retreating, 5-yr yield flat.')),
    h('div', null, h('h3', null, 'Further tightening'), h('p', null, 'Inflation broadens, as the Bank warned. The 5-yr yield and fixed rates climb, variable payments rise again, and renewals reset at higher rates. ', h('b', null, 'Watch: '), '2-yr yield pushing above the policy rate, core inflation above 3%, US 10-yr yield rising.')),
    h('div', null, h('h3', null, 'Growth scare'), h('p', null, 'Weak jobs or an energy shock cuts demand. Yields fall and the Bank reverses, lowering fixed rates, but income risk offsets cheaper borrowing. ', h('b', null, 'Watch: '), 'unemployment up 0.3+ pts, growth undershooting the Bank\'s 1.0% 2026 outlook, curve inverting.')));
}

function viewHousing() {
  return [...banners(), signalsCard(), calcCard(), ...backtestCards(), scenariosCard(),
    h('p', { class: 'small' }, 'No free API provides resale prices (CREA) or Teranet indexes, so the price backtest uses Statistics Canada\'s new housing price index. Informational only; not financial advice.')];
}

// ---- data/status ----
let installEvt = null;
function viewData() {
  const doc = st.doc;
  const rows = doc ? Object.entries(doc.series).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, s]) => {
    const e = (doc.errors || []).find((x) => x.key === k);
    const stale = isStale(k);
    return h('tr', null, h('td', null, k), h('td', null, s.sourceLabel || s.label), h('td', null, s.asOf), h('td', null, s.verified === true ? 'label ✓' : s.verified === false ? 'range only' : 'range'),
      h('td', { class: e || stale ? 'status-stale' : 'status-ok' }, e ? '⚠ kept old' : stale ? '⚠ stale' : '✓ ok'));
  }) : [];
  const failed = doc ? (doc.errors || []).filter((e) => !(doc.series[e.key])) : [];
  return [
    ...banners(),
    h('section', { class: 'card' }, h('h3', null, 'Data status'),
      h('p', { class: 'sub' }, doc ? `Generated ${new Date(doc.meta.generatedAt).toLocaleString()} · ${Object.keys(doc.series).length} series · ${(doc.errors || []).length} errors` : 'No dashboard.json found.'),
      installEvt ? h('div', { class: 'foot' }, h('button', { class: 'chip', type: 'button', onclick: async () => { installEvt.prompt(); installEvt = null; render(); } }, '＋ Install as an app')) : null,
      h('div', { class: 'foot' }, 'On iPhone: Share → Add to Home Screen. On Android/Chrome: menu → Install app. Both need the site served over HTTPS.')),
    h('section', { class: 'card' }, h('h3', null, 'Sources and API keys'),
      h('div', { class: 'who' },
        h('div', null, h('b', null, 'Bank of Canada Valet API'), h('span', null, 'Policy rate, prime, benchmark yields, core inflation. Free, no key.')),
        h('div', null, h('b', null, 'Statistics Canada Web Data Service'), h('span', null, 'CPI, unemployment, new housing price index, housing starts. Free, no key.')),
        h('div', null, h('b', null, 'FRED (St. Louis Fed)'), h('span', null, 'Fed funds, Treasuries, US inflation and jobs, bank data, who holds Treasuries. Free; works without a key. A free FRED_API_KEY is optional and switches to the official API.')),
        h('div', null, h('b', null, 'Not available free'), h('span', null, 'CREA/MLS resale prices and Teranet need paid licences; the housing view uses StatCan\'s new housing price index.')))),
    failed.length ? h('section', { class: 'card' }, h('h3', null, 'Series that failed to load'),
      h('div', { class: 'who' }, failed.map((e) => h('div', null, h('b', null, e.key + (e.optional ? ' (optional)' : '')), h('span', { class: 'small' }, e.message))))) : null,
    rows.length ? h('section', { class: 'card' }, h('h3', null, 'Loaded series'), h('p', { class: 'sub' }, '"label ✓" means the source returned a title matching what we asked for. "range only" means the latest value was checked to be plausible.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' }, h('thead', null, h('tr', null, ['Key', 'Source label', 'As of', 'Check', 'Status'].map((x) => h('th', null, x)))), h('tbody', null, rows)))) : null,
  ];
}

// ---------- router ----------
const VIEWS = { overview: viewOverview, canada: viewCanada, us: viewUS, bonds: viewBonds, housing: viewHousing, data: viewData };

function render() {
  const tab = TABS.find((t) => t.id === st.tab) || TABS[0];
  const view = $('#view');
  view.replaceChildren(...[].concat(VIEWS[tab.id]()).filter(Boolean).map((n) => n));
  // group consecutive cards on wide screens
  const kids = [...view.children];
  const out = [];
  let run = [];
  const flush = () => { if (run.length) { out.push(h('div', { class: 'grid' }, run)); run = []; } };
  for (const n of kids) { if (n.matches('section.card:not(.scen)') && tab.ranged) run.push(n); else { flush(); out.push(n); } }
  flush();
  if (tab.ranged) view.replaceChildren(...out);
  const rb = $('#rangebar');
  rb.hidden = !tab.ranged;
  for (const el of document.querySelectorAll('[data-tab]')) el.setAttribute('aria-current', el.dataset.tab === tab.id ? 'page' : 'false');
  const group = $('.rangebar-in', rb);
  group.replaceChildren(...Object.keys(RANGES).map((r) => h('button', { type: 'button', 'aria-pressed': String(r === st.range), onclick: () => { st.range = r; store.set('range', r); render(); } }, r)));
}

function route() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  st.tab = TABS.some((t) => t.id === id) ? id : 'overview';
  render();
  window.scrollTo(0, 0);
}

function buildNav() {
  const mk = (cls, withIcon) => TABS.map((t) => h('a', { class: 'tab', href: `#/${t.id}`, 'data-tab': t.id }, withIcon ? h('i', { 'aria-hidden': 'true' }, t.icon) : null, t.label));
  $('#tabs').replaceChildren(...mk('tab', false));
  $('#bottom').replaceChildren(...mk('tab', true));
}

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
  const btn = $('#theme');
  btn.textContent = mode === 'dark' ? '☾' : mode === 'light' ? '☀' : 'A';
  btn.setAttribute('aria-label', `Theme: ${mode}. Switch theme`);
}

async function refresh(manual) {
  const btn = $('#refresh');
  btn.classList.add('spin');
  try { await load(); } catch (e) { st.loadError = e; }
  btn.classList.remove('spin');
  render();
  if (manual && 'serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then((r) => r && r.update());
}

async function main() {
  buildNav();
  let mode = store.get('theme', 'auto');
  applyTheme(mode);
  $('#theme').addEventListener('click', () => { mode = mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto'; store.set('theme', mode); applyTheme(mode); render(); });
  $('#refresh').addEventListener('click', () => refresh(true));
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (st.tab === 'data') render(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - st.loadedAt > 30 * 60 * 1000) refresh(false); });
  try { await load(); } catch (e) { st.loadError = e; }
  route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  }
}

main();
window.__rw = { st, A };
