// Statistics Canada Web Data Service (https://www.statcan.gc.ca/en/developers/wds) - free, no API key.
import { httpJson, isFiniteNum } from './util.mjs';

const BASE = 'https://www150.statcan.gc.ca/t1/wds/rest';
const post = (path, body) =>
  httpJson(`${BASE}/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

// Response: [{ status: 'SUCCESS', object: { vectorId, vectorDataPoint: [{ refPer: '2026-09-01', value: '123.4' }] } }]
export function parseStatcan(json) {
  const first = Array.isArray(json) ? json[0] : null;
  if (!first || first.status !== 'SUCCESS') {
    throw new Error(`StatCan status ${first?.status ?? 'missing'}: ${JSON.stringify(first?.object ?? first ?? '').slice(0, 200)}`);
  }
  const points = [];
  for (const p of first.object?.vectorDataPoint ?? []) {
    const n = p.value === '' || p.value == null ? NaN : Number(p.value);
    if (typeof p.refPer === 'string' && isFiniteNum(n)) points.push([p.refPer.slice(0, 10), n]);
  }
  points.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return points;
}

// The series title is used to verify we fetched what we think we fetched. If StatCan does not return one
// we carry on but flag the series as unverified (the plausible-range check still applies).
async function title(vector) {
  try {
    const j = await post('getSeriesInfoFromVector', [{ vectorId: vector }]);
    const o = j?.[0]?.object;
    return [o?.SeriesTitleEn, o?.cubeTitleEn].filter(Boolean).join(' | ');
  } catch {
    return '';
  }
}

export async function fetchStatcan(spec) {
  const t = await title(spec.vector);
  const json = await post('getDataFromVectorsAndLatestNPeriods', [{ vectorId: spec.vector, latestN: spec.latestN ?? 500 }]);
  const points = parseStatcan(json);
  if (!points.length) throw new Error(`vector ${spec.vector} returned no data`);
  if (t && spec.expect && !spec.expect.test(t)) {
    throw new Error(`vector ${spec.vector} title "${t}" does not match ${spec.expect}`);
  }
  return { id: `v${spec.vector}`, label: t || '', verified: Boolean(t && spec.expect), points };
}
