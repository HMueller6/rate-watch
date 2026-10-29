// FRED (St. Louis Fed). Two routes:
//  - FRED_API_KEY set  -> official JSON API (free key: https://fredaccount.stlouisfed.org/apikeys)
//  - no key            -> the public fredgraph.csv download, which needs no key
import { httpJson, httpText, isFiniteNum } from './util.mjs';

// CSV header is "observation_date,SERIES" (current) or "DATE,SERIES" (older). Missing values are "." or empty.
export function parseFredCsv(text, id) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift()?.split(',') ?? [];
  if (!/^(observation_date|date)$/i.test(header[0]) || header[1]?.trim() !== id) {
    throw new Error(`unexpected FRED CSV header "${header.join(',')}" for ${id}`);
  }
  const points = [];
  for (const line of lines) {
    const [d, v] = line.split(',');
    const n = v === '.' || v === '' || v == null ? NaN : Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && isFiniteNum(n)) points.push([d, n]);
  }
  return points;
}

export function parseFredJson(json) {
  const points = [];
  for (const o of json?.observations ?? []) {
    const n = o.value === '.' || o.value === '' ? NaN : Number(o.value);
    if (typeof o.date === 'string' && isFiniteNum(n)) points.push([o.date, n]);
  }
  return points;
}

export async function fetchFred(spec, start, apiKey) {
  const id = spec.id;
  let points;
  if (apiKey) {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${apiKey}&file_type=json&observation_start=${start}`;
    points = parseFredJson(await httpJson(url));
  } else {
    points = parseFredCsv(await httpText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`), id);
  }
  if (!points.length) throw new Error(`FRED ${id} returned no observations`);
  return { id, label: '', points };
}
