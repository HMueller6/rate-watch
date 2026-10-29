// Bank of Canada Valet API (https://www.bankofcanada.ca/valet/docs) - free, no API key.
import { httpJson, isFiniteNum } from './util.mjs';

const BASE = 'https://www.bankofcanada.ca/valet';

// Valet observations look like: { d: '2026-10-28', V39079: { v: '2.5' } }
export function parseValet(json, id) {
  const label = json?.seriesDetail?.[id]?.label ?? '';
  const points = [];
  for (const o of json?.observations ?? []) {
    const v = o?.[id]?.v;
    const n = v === '' || v == null ? NaN : Number(v);
    if (typeof o.d === 'string' && isFiniteNum(n)) points.push([o.d, n]);
  }
  points.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { label, points };
}

async function observations(id, startDate) {
  const q = startDate ? `?start_date=${startDate}` : '';
  return parseValet(await httpJson(`${BASE}/observations/${encodeURIComponent(id)}/json${q}`), id);
}

// Find series ids in a group whose label matches `expect` (fallback when a hard-coded id has moved).
export async function discoverInGroup(group, expect) {
  const j = await httpJson(`${BASE}/observations/group/${encodeURIComponent(group)}/json?recent=1`);
  return Object.entries(j?.seriesDetail ?? {})
    .filter(([, d]) => expect.test(d?.label ?? ''))
    .map(([id, d]) => ({ id, label: d.label }));
}

// spec: { ids: [candidate ids], expect: RegExp checked against the label Valet returns, group?: fallback group }
// A series is accepted only if its label matches `expect` - a wrong id becomes an error, never a mislabelled chart.
export async function fetchValet(spec, startDate) {
  const tried = [];
  const queue = [...spec.ids];
  const seen = new Set(queue);
  let discovered = false;
  for (;;) {
    const id = queue.shift();
    if (id === undefined) {
      if (!spec.group || discovered) break;
      discovered = true; // one discovery pass over the group, then give up
      try {
        for (const hit of await discoverInGroup(spec.group, spec.expect)) {
          if (!seen.has(hit.id)) { seen.add(hit.id); queue.push(hit.id); }
        }
      } catch (e) {
        tried.push(`group ${spec.group}: ${e.message}`);
      }
      continue;
    }
    try {
      const { label, points } = await observations(id, startDate);
      if (!spec.expect.test(label)) tried.push(`${id}: label "${label}" does not match ${spec.expect}`);
      else if (!points.length) tried.push(`${id}: no observations`);
      else return { id, label, points };
    } catch (e) {
      tried.push(`${id}: ${e.message}`);
    }
  }
  throw new Error(`no matching Valet series (${tried.join('; ')})`);
}

export async function listGroups() {
  const j = await httpJson(`${BASE}/lists/groups/json`);
  return Object.entries(j?.groups ?? {}).map(([name, g]) => ({ name, label: g.label }));
}

export async function listGroupSeries(group) {
  const j = await httpJson(`${BASE}/observations/group/${encodeURIComponent(group)}/json?recent=1`);
  return Object.entries(j?.seriesDetail ?? {}).map(([id, d]) => ({ id, label: d.label }));
}
