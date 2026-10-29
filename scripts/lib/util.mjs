// Shared helpers for the data fetchers: HTTP with retry, and compaction of long daily series.

export const UA = 'rate-watch/1.0 (personal dashboard; +https://github.com/HMueller6/rate-watch)';

export async function http(url, { method = 'GET', body, headers = {}, tries = 4, timeoutMs = 30000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { 'user-agent': UA, accept: 'application/json,text/csv,*/*', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const snippet = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
        const err = new Error(`HTTP ${res.status} ${res.statusText} for ${url.replace(/api_key=[^&]+/, 'api_key=***')}${snippet ? ' :: ' + snippet : ''}`);
        err.status = res.status;
        // 4xx other than rate limiting (429, and StatCan's 430) will not get better on retry
        if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 430) throw Object.assign(err, { fatal: true });
        throw err;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (e.cause && !e.fatal) e.message += ` (${e.cause.code || e.cause.message})`; // e.g. ENOTFOUND, ECONNRESET
      if (e.fatal || attempt === tries) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

export const httpJson = async (url, opts) => (await http(url, opts)).json();
export const httpText = async (url, opts) => (await http(url, opts)).text();

const isoDate = (d) => d.toISOString().slice(0, 10);

// Keep a series small enough to ship to a phone:
//  stepOnly  - keep only the dates the value changed (policy rates)
//  dailyYears - keep full resolution for N years, then one point per month (month-end) before that
export function compress(points, { stepOnly = false, dailyYears = 0, today = new Date() } = {}) {
  let pts = points;
  if (stepOnly) {
    pts = points.filter((p, i) => i === 0 || p[1] !== points[i - 1][1]);
    const l = points[points.length - 1];
    if (l && pts[pts.length - 1] !== l) pts = [...pts, l]; // keep the last observation date so freshness is visible
    return pts;
  }
  if (dailyYears > 0) {
    const cut = new Date(today);
    cut.setUTCFullYear(cut.getUTCFullYear() - dailyYears);
    const cutoff = isoDate(cut);
    const old = new Map();
    const recent = [];
    for (const p of points) {
      if (p[0] >= cutoff) recent.push(p);
      else old.set(p[0].slice(0, 7), p); // later obs in the same month overwrite earlier ones
    }
    pts = [...old.values(), ...recent];
  }
  return pts;
}

export function isFiniteNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

// Frequency of a raw series from the median gap between its last few observations: d(aily), w(eekly), m(onthly), q(uarterly).
export function inferFreq(points) {
  const tail = points.slice(-7);
  if (tail.length < 2) return 'm';
  const gaps = [];
  for (let i = 1; i < tail.length; i++) gaps.push((Date.parse(tail[i][0]) - Date.parse(tail[i - 1][0])) / 864e5);
  gaps.sort((a, b) => a - b);
  const g = gaps[gaps.length >> 1];
  return g <= 4 ? 'd' : g <= 10 ? 'w' : g <= 40 ? 'm' : 'q';
}
