// Maintenance helper for finding series ids. Runs when the RW_PROBE env var is set (see refresh.mjs); prints to stdout.
// Commands are separated by ";;"  (regexes may contain commas):
//   series:<regex>     Bank of Canada Valet series whose id or label matches
//   groups:<regex>     Valet groups whose name or label matches
//   group:<name>[~re]  series in one Valet group, optionally only those whose label matches re
//   last:<id,id>       label and last observations of Valet series
//   vector:<id,id>     StatCan vector title and last observations
import { httpJson } from './lib/util.mjs';

const VALET = 'https://www.bankofcanada.ca/valet';
const WDS = 'https://www150.statcan.gc.ca/t1/wds/rest';
const post = (p, body) => httpJson(`${WDS}/${p}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const cap = (lines, n = 60) => { lines.slice(0, n).forEach((l) => console.log('  ' + l)); if (lines.length > n) console.log(`  ... ${lines.length - n} more`); if (!lines.length) console.log('  (none)'); };

export async function probe(spec) {
  for (const cmd of spec.split(';;').map((c) => c.trim()).filter(Boolean)) {
    const i = cmd.indexOf(':');
    const kind = cmd.slice(0, i), arg = cmd.slice(i + 1);
    console.log(`PROBE ${cmd}`);
    try {
      if (kind === 'series') {
        const re = new RegExp(arg, 'i');
        const j = await httpJson(`${VALET}/lists/series/json`);
        cap(Object.entries(j.series ?? {}).filter(([id, s]) => re.test(id) || re.test(s.label ?? '')).map(([id, s]) => `${id}\t${s.label}`));
      } else if (kind === 'groups') {
        const re = new RegExp(arg, 'i');
        const j = await httpJson(`${VALET}/lists/groups/json`);
        cap(Object.entries(j.groups ?? {}).filter(([n, g]) => re.test(n) || re.test(g.label ?? '')).map(([n, g]) => `${n}\t${g.label}`));
      } else if (kind === 'group') {
        const [name, filter] = arg.split('~');
        const re = new RegExp(filter || '.', 'i');
        const j = await httpJson(`${VALET}/observations/group/${encodeURIComponent(name)}/json?recent=1`);
        cap(Object.entries(j.seriesDetail ?? {}).filter(([id, d]) => re.test(id) || re.test(d.label ?? '')).map(([id, d]) => `${id}\t${d.label}`), 25);
      } else if (kind === 'last') {
        for (const id of arg.split(',')) {
          const j = await httpJson(`${VALET}/observations/${encodeURIComponent(id)}/json?recent=3`);
          console.log(`  ${id}\t${j.seriesDetail?.[id]?.label}\t${(j.observations ?? []).map((o) => `${o.d}=${o[id]?.v}`).join(' ')}`);
        }
      } else if (kind === 'vector') {
        for (const v of arg.split(',')) {
          const info = await post('getSeriesInfoFromVector', [{ vectorId: Number(v) }]);
          const data = await post('getDataFromVectorsAndLatestNPeriods', [{ vectorId: Number(v), latestN: 3 }]);
          const pts = data?.[0]?.object?.vectorDataPoint ?? [];
          console.log(`  v${v}\t${info?.[0]?.object?.SeriesTitleEn}\t${info?.[0]?.object?.productId}\t${pts.map((p) => `${p.refPer}=${p.value}`).join(' ')}`);
        }
      } else console.log('  unknown probe command');
    } catch (e) {
      console.log('  ERROR ' + e.message);
    }
  }
}
