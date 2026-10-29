// Pure analytics: no DOM, no network. Shared by the browser app and the node tests.
// A "points" array is [[ 'YYYY-MM-DD', number ], ...] sorted ascending.

const pad = (n) => String(n).padStart(2, '0');

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function toMs(iso) {
  return Date.parse(iso + 'T00:00:00Z');
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Shift an ISO date by whole months, clamping the day to the target month's length.
export function shiftMonths(iso, months) {
  const { y, m, d } = parseISO(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

export function shiftDays(iso, days) {
  return new Date(toMs(iso) + days * 864e5).toISOString().slice(0, 10);
}

export const last = (pts) => (pts && pts.length ? pts[pts.length - 1] : null);

// Value of the last observation dated on or before `iso`; null if none.
export function valueAt(pts, iso) {
  if (!pts || !pts.length || pts[0][0] > iso) return null;
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= iso) lo = mid; else hi = mid - 1;
  }
  return pts[lo][1];
}

// Change in level over `months`, measured from the last observation.
export function change(pts, months) {
  const l = last(pts);
  if (!l) return null;
  const base = valueAt(pts, shiftMonths(l[0], -months));
  return base == null ? null : l[1] - base;
}

export function pctChange(pts, months) {
  const l = last(pts);
  if (!l) return null;
  const base = valueAt(pts, shiftMonths(l[0], -months));
  return base ? (l[1] / base - 1) * 100 : null;
}

// Year-over-year % change of a monthly index. Matches by calendar month, so gaps are not misread.
export function yoy(pts) {
  const byMonth = new Map(pts.map(([d, v]) => [d.slice(0, 7), v]));
  const out = [];
  for (const [d, v] of pts) {
    const base = byMonth.get(shiftMonths(d, -12).slice(0, 7));
    if (base) out.push([d, (v / base - 1) * 100]);
  }
  return out;
}

// The most recent change in a step series: { date, from, to } or null if it never changed.
export function lastMove(pts) {
  for (let i = pts.length - 1; i > 0; i--) {
    if (pts[i][1] !== pts[i - 1][1]) return { date: pts[i][0], from: pts[i - 1][1], to: pts[i][1] };
  }
  return null;
}

// a - b on a's dates, using b's value in force on that date (skips dates before b starts).
export function spread(a, b) {
  const out = [];
  for (const [d, v] of a) {
    const bv = valueAt(b, d);
    if (bv != null) out.push([d, v - bv]);
  }
  return out;
}

export function addConst(pts, k) {
  return pts.map(([d, v]) => [d, v + k]);
}

// Month-over-month absolute change (for levels such as payrolls).
export function diff(pts) {
  return pts.slice(1).map(([d, v], i) => [d, v - pts[i][1]]);
}

// ---- Policy-rate reconciliation ------------------------------------------------------------

// Compare the data feed's latest policy rate with the announcement we were told about.
// 'pending' = feed hasn't caught up yet (feed older than announcement) - we then overlay the announcement.
export function reconcilePolicy(policyPts, ann) {
  const l = last(policyPts);
  if (!ann) return { status: 'none', feed: l };
  if (!l) return { status: 'nodata', feed: null };
  if (l[0] < ann.date) return { status: l[1] === ann.newRate ? 'match' : 'pending', feed: l };
  return { status: l[1] === ann.newRate ? 'match' : 'mismatch', feed: l };
}

export function effectivePolicy(policyPts, ann) {
  const rec = reconcilePolicy(policyPts, ann);
  if (rec.status === 'pending') return [...policyPts, [ann.date, ann.newRate]];
  return policyPts;
}

// ---- Hike cycles & backtest ----------------------------------------------------------------

// A cycle starts at a hike that follows at least `gapMonths` without any hike.
// `policyPts` holds the dates the target rate changed (or any denser series: unchanged points are ignored).
export function hikeCycles(policyPts, gapMonths = 12) {
  const cycles = [];
  let lastHike = null;
  for (let i = 1; i < policyPts.length; i++) {
    const [d, v] = policyPts[i];
    const prev = policyPts[i - 1][1];
    if (v > prev) {
      if (lastHike == null || shiftMonths(lastHike, gapMonths) < d) {
        cycles.push({ date: d, from: prev, to: v });
      }
      lastHike = d;
    }
  }
  return cycles;
}

function rollingAverageChange(pts, months) {
  const vals = [];
  for (let i = 0; i < pts.length; i++) {
    const target = shiftMonths(pts[i][0], months);
    if (target > pts[pts.length - 1][0].slice(0, 7) + '-31') break;
    const end = valueAt(pts, target);
    if (end != null && pts[i][1]) vals.push((end / pts[i][1] - 1) * 100);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function median(xs) {
  const a = xs.filter((x) => x != null).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// What happened to housing prices, 5y yields and the policy rate after past first-hikes?
// `nhpi` is a monthly price index, `y5` the 5y GoC yield, `policy` the overnight-target change points.
export function backtest({ policy, nhpi, y5 }, horizons = [6, 12, 24], gapMonths = 12) {
  const cycles = hikeCycles(policy, gapMonths);
  const nhpiEnd = last(nhpi) ? last(nhpi)[0] : null;
  const policyEnd = last(policy) ? last(policy)[0] : null;
  const y5End = last(y5) ? last(y5)[0] : null;
  const baseline = {};
  for (const h of horizons) baseline[h] = nhpi.length ? rollingAverageChange(nhpi, h) : null;

  const rows = cycles.map((c) => {
    const res = { ...c, horizons: {} };
    for (const h of horizons) {
      const end = shiftMonths(c.date, h);
      const cell = { policy: null, y5: null, price: null, excess: null };
      if (policyEnd && end <= policyEnd) cell.policy = valueAt(policy, end) - c.from;
      const y5Base = valueAt(y5, shiftDays(c.date, -1));
      if (y5End && end <= y5End && y5Base != null) cell.y5 = valueAt(y5, end) - y5Base;
      const pBase = valueAt(nhpi, c.date);
      if (nhpiEnd && end <= shiftMonths(nhpiEnd, 1) && pBase) {
        cell.price = (valueAt(nhpi, end) / pBase - 1) * 100;
        if (baseline[h] != null) cell.excess = cell.price - baseline[h];
      }
      res.horizons[h] = cell;
    }
    return res;
  });

  const summary = {};
  for (const h of horizons) {
    // exclude the in-progress cycle (any cell with a missing price) from the medians automatically
    summary[h] = {
      policy: median(rows.map((r) => r.horizons[h].policy)),
      y5: median(rows.map((r) => r.horizons[h].y5)),
      price: median(rows.map((r) => r.horizons[h].price)),
      excess: median(rows.map((r) => r.horizons[h].excess)),
      n: rows.filter((r) => r.horizons[h].price != null).length,
    };
  }
  return { rows, summary, baseline, horizons };
}

// ---- Mortgage maths ------------------------------------------------------------------------

// Canadian fixed rates compound semi-annually; variable rates are normally quoted with monthly compounding.
export function monthlyRate(annualPct, compounding = 'semiannual') {
  const r = annualPct / 100;
  return compounding === 'monthly' ? r / 12 : Math.pow(1 + r / 2, 1 / 6) - 1;
}

export function payment(principal, annualPct, years, compounding = 'semiannual') {
  const i = monthlyRate(annualPct, compounding);
  const n = years * 12;
  return i === 0 ? principal / n : (principal * i) / (1 - Math.pow(1 + i, -n));
}

// Typical minimum qualifying ("stress-test") rate: contract rate + 2 points, never below 5.25%.
export const stressRate = (ratePct) => Math.max(ratePct + 2, 5.25);

// ---- Housing signals -----------------------------------------------------------------------

const fmt = (x, d = 2) => (x == null ? '—' : x.toFixed(d));
const sign = (x, d = 2) => (x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d));

// Rules-based read of the macro backdrop for Canadian housing. Each signal is -1 (headwind), 0, or +1 (supportive).
// Missing inputs are skipped, never guessed. `S` maps series key -> points.
export function housingSignals(S) {
  const out = [];
  const add = (id, label, value, tilt, rule) => out.push({ id, label, value, tilt, rule });

  const pol = S.ca_policy;
  if (pol && pol.length) {
    const c = change(pol, 6); // step series: valueAt() carries each rate forward
    if (c != null) {
      add('policy', 'Policy rate, 6-month move', sign(c) + ' pts', c >= 0.25 ? -1 : c <= -0.25 ? 1 : 0,
        'Hike of 0.25+ = headwind (variable costs rise); cut of 0.25+ = supportive');
    }
  }
  const y5c = change(S.ca_y5, 3);
  if (y5c != null) {
    add('y5', '5-yr GoC yield, 3-month move', sign(y5c) + ' pts', y5c >= 0.25 ? -1 : y5c <= -0.25 ? 1 : 0,
      'Fixed mortgage rates follow this yield: +0.25 or more = headwind');
  }
  if (S.ca_y2 && S.ca_y2.length && pol && pol.length) {
    const gap = last(S.ca_y2)[1] - last(pol)[1];
    add('implied', '2-yr yield minus policy rate', sign(gap) + ' pts', gap >= 0.25 ? -1 : gap <= -0.25 ? 1 : 0,
      'Above +0.25: markets price further hikes (headwind). Below -0.25: pricing cuts (supportive)');
  }
  const core = ['ca_cpi_trim', 'ca_cpi_median']
    .map((k) => (S[k] && S[k].length ? last(S[k])[1] : null)).filter((x) => x != null);
  const coreAvg = core.length ? core.reduce((a, b) => a + b, 0) / core.length : null;
  const yoyHead = S.ca_cpi_index && S.ca_cpi_index.length ? last(yoy(S.ca_cpi_index)) : null;
  const headline = yoyHead ? yoyHead[1] : null;
  const shown = [headline, coreAvg].filter((x) => x != null);
  if (shown.length) {
    const hi = Math.max(...shown);
    const txt = [headline != null ? `${fmt(headline, 1)}% headline` : null, coreAvg != null ? `${fmt(coreAvg, 1)}% core` : null].filter(Boolean).join(' · ');
    add('inflation', 'Inflation (headline y/y; core = avg of trim & median)', txt, hi > 3 ? -1 : hi < 2 ? 1 : 0,
      'Either measure above the 3% ceiling of the target band = headwind (more hikes); both below 2% = supportive');
  }
  const uc = change(S.ca_unemp, 6);
  if (uc != null) {
    add('labour', 'Unemployment rate, 6-month move', sign(uc) + ' pts', uc >= 0.3 ? -1 : uc <= -0.3 ? 1 : 0,
      'Rising joblessness weakens housing demand (headwind) even as it argues for lower rates');
  }
  if (S.ca_nhpi && S.ca_nhpi.length) {
    const p = last(yoy(S.ca_nhpi));
    if (p) {
      add('momentum', 'New housing price index, year over year', sign(p[1]) + '%', p[1] < 0 ? -1 : p[1] >= 3 ? 1 : 0,
        'Falling prices = headwind; 3%+ growth = supportive. New-home index only; it lags resale prices');
    }
  }
  const usc = change(S.us_y10, 3);
  if (usc != null) {
    add('us10', 'US 10-yr yield, 3-month move', sign(usc) + ' pts', usc >= 0.25 ? -1 : usc <= -0.25 ? 1 : 0,
      'Canadian yields track US Treasuries: a +0.25 rise tends to lift Canadian fixed rates');
  }
  return out;
}

export function composite(signals) {
  const score = signals.reduce((a, s) => a + s.tilt, 0);
  const n = signals.length;
  const label = !n ? 'No data' : score >= 2 ? 'Supportive' : score <= -2 ? 'Headwinds' : 'Mixed';
  return {
    score, n, label,
    headwinds: signals.filter((s) => s.tilt < 0).length,
    supports: signals.filter((s) => s.tilt > 0).length,
  };
}
