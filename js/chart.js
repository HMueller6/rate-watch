// Dependency-free SVG line chart: time or category x-axis, step lines, reference lines, event markers,
// crosshair tooltip (mouse + touch), dash patterns as a second encoding next to colour, and a table view.

const NS = 'http://www.w3.org/2000/svg';
export const DASHES = ['', '7 4', '2 4', '9 4 2 4'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function svg(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}

export function niceDomain(min, max, count = 4) {
  if (!(max > min)) { const c = Math.abs(min) || 1; min -= c * 0.05; max += c * 0.05; }
  const rough = (max - min) / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / pow;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks, step };
}

export function timeTicks(t0, t1) {
  const years = (t1 - t0) / (365.25 * 864e5);
  const d0 = new Date(t0);
  const out = [];
  if (years > 3.5) {
    const step = years > 25 ? 10 : years > 12 ? 5 : years > 6 ? 2 : 1;
    for (let y = Math.ceil(d0.getUTCFullYear() / step) * step; ; y += step) {
      const t = Date.UTC(y, 0, 1);
      if (t > t1) break;
      if (t >= t0) out.push({ t, label: String(y) });
    }
  } else {
    const step = years > 1.6 ? 6 : years > 0.8 ? 3 : 1;
    let y = d0.getUTCFullYear();
    let m = Math.ceil(d0.getUTCMonth() / step) * step;
    for (;;) {
      if (m > 11) { y += Math.floor(m / 12); m %= 12; }
      const t = Date.UTC(y, m, 1);
      if (t > t1) break;
      if (t >= t0) out.push({ t, label: m === 0 || step === 6 ? `${MONTHS[m]} '${String(y).slice(2)}` : MONTHS[m] });
      m += step;
    }
  }
  return out;
}

// Last index with xs[i] <= x, or -1.
function floorIndex(pts, x) {
  let lo = 0, hi = pts.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const fmtDate = (t) => {
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

// cfg: { series:[{label, color(1-4), points:[[x,y]], step?}], xType:'time'|'category', categories?, yFormat(v),
//        refLines?:[{y,label}], markers?:[{x,label}], height?, ariaLabel }
// For xType 'time', point x values are epoch ms.
export function drawLineChart(host, cfg) {
  let w = 0;
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;

  function render() {
    host.replaceChildren();
    host.append(tip);
    w = Math.max(240, Math.floor(host.clientWidth));
    const h = cfg.height ?? (w < 520 ? 210 : 250);
    const series = cfg.series.filter((s) => s.points.length);
    const isTime = cfg.xType !== 'category';
    if (!series.length) {
      host.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'No data for this range.' }));
      return;
    }
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const s of series) for (const [x, y] of s.points) {
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
    for (const r of cfg.refLines ?? []) { ymin = Math.min(ymin, r.y); ymax = Math.max(ymax, r.y); }
    if (!isTime) { xmin = 0; xmax = cfg.categories.length - 1; }
    const yd = niceDomain(ymin, ymax, h < 230 ? 3 : 4);
    const yLabels = yd.ticks.map((t) => cfg.yFormat(t))  // not .map(cfg.yFormat): the index would be read as `full`;
    const left = Math.max(34, Math.max(...yLabels.map((s) => s.length)) * 6.6 + 10);
    const m = { l: left, r: isTime ? 10 : 16, t: 10, b: 24 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    const padX = isTime ? 0 : 8;
    const X = (x) => m.l + padX + ((x - xmin) / (xmax - xmin || 1)) * (pw - 2 * padX);
    const Y = (y) => m.t + ph - ((y - yd.lo) / (yd.hi - yd.lo)) * ph;

    const root = svg('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img', 'aria-label': cfg.ariaLabel ?? 'Chart' });
    const clipId = 'c' + Math.random().toString(36).slice(2, 8);
    root.append(svg('clipPath', { id: clipId }, null));
    root.firstChild.append(svg('rect', { x: m.l, y: m.t - 2, width: pw, height: ph + 4 }));

    for (let i = 0; i < yd.ticks.length; i++) {
      const y = Y(yd.ticks[i]);
      root.append(svg('line', { x1: m.l, x2: w - m.r, y1: y, y2: y, class: 'grid' }));
      root.append(svg('text', { x: m.l - 6, y: y + 4, 'text-anchor': 'end', class: 'tick' }, yLabels[i]));
    }
    if (yd.lo < 0 && yd.hi > 0) root.append(svg('line', { x1: m.l, x2: w - m.r, y1: Y(0), y2: Y(0), class: 'axis' }));

    if (isTime) {
      for (const t of timeTicks(xmin, xmax)) {
        const x = X(t.t);
        root.append(svg('line', { x1: x, x2: x, y1: m.t + ph, y2: m.t + ph + 4, class: 'axis' }));
        root.append(svg('text', { x, y: h - 6, 'text-anchor': 'middle', class: 'tick' }, t.label));
      }
    } else {
      cfg.categories.forEach((c, i) => root.append(svg('text', { x: X(i), y: h - 6, 'text-anchor': 'middle', class: 'tick' }, c)));
    }

    for (const r of cfg.refLines ?? []) {
      root.append(svg('line', { x1: m.l, x2: w - m.r, y1: Y(r.y), y2: Y(r.y), class: 'ref' }));
      root.append(svg('text', { x: w - m.r - 2, y: Y(r.y) - 4, 'text-anchor': 'end', class: 'tick ref-label' }, r.label));
    }
    for (const mk of cfg.markers ?? []) {
      if (mk.x < xmin || mk.x > xmax) continue;
      root.append(svg('line', { x1: X(mk.x), x2: X(mk.x), y1: m.t, y2: m.t + ph, class: 'marker' }));
    }

    const g = svg('g', { 'clip-path': `url(#${clipId})` });
    series.forEach((s, i) => {
      let d = '';
      s.points.forEach(([x, y], j) => {
        if (j === 0) d += `M${X(x).toFixed(1)},${Y(y).toFixed(1)}`;
        else if (s.step) d += `H${X(x).toFixed(1)}V${Y(y).toFixed(1)}`;
        else d += `L${X(x).toFixed(1)},${Y(y).toFixed(1)}`;
      });
      g.append(svg('path', { d, class: `line s${s.color}`, 'stroke-dasharray': DASHES[i % DASHES.length] || null }));
      if (!isTime || s.points.length <= 12) {
        for (const [x, y] of s.points) g.append(svg('circle', { cx: X(x), cy: Y(y), r: 4, class: `dot s${s.color}` }));
      } else {
        const [lx, ly] = s.points[s.points.length - 1];
        g.append(svg('circle', { cx: X(lx), cy: Y(ly), r: 4, class: `dot s${s.color}` }));
      }
    });
    root.append(g);

    // crosshair
    const cross = svg('line', { y1: m.t, y2: m.t + ph, class: 'cross', visibility: 'hidden' });
    const hoverDots = series.map((s) => svg('circle', { r: 4.5, class: `dot s${s.color}`, visibility: 'hidden' }));
    root.append(cross, ...hoverDots);
    const hit = svg('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent' });
    root.append(hit);

    const densest = series.reduce((a, b) => (b.points.length > a.points.length ? b : a));
    const rowHtml = (s, i, p) => {
      const row = document.createElement('div');
      row.className = 'tip-row';
      const sw = document.createElement('span');
      sw.className = `swatch s${s.color} d${i % DASHES.length}`;
      const name = document.createElement('span');
      name.textContent = s.label;
      const val = document.createElement('b');
      val.textContent = p ? cfg.yFormat(p[1], true) : '—';
      row.append(sw, name, val);
      return row;
    };
    function show(evt) {
      const r = root.getBoundingClientRect();
      const px = (evt.clientX - r.left) * (w / r.width);
      const target = xmin + ((px - m.l - padX) / (pw - 2 * padX)) * (xmax - xmin);
      // snap to the nearest x of the densest series
      const di = Math.max(0, Math.min(densest.points.length - 1, floorIndex(densest.points, target)));
      const next = densest.points[Math.min(di + 1, densest.points.length - 1)];
      const cur = densest.points[di];
      const sx = Math.abs(next[0] - target) < Math.abs(cur[0] - target) ? next[0] : cur[0];
      cross.setAttribute('x1', X(sx)); cross.setAttribute('x2', X(sx)); cross.setAttribute('visibility', 'visible');
      tip.replaceChildren();
      const head = document.createElement('div');
      head.className = 'tip-head';
      head.textContent = isTime ? fmtDate(sx) : cfg.categories[Math.round(sx)];
      tip.append(head);
      series.forEach((s, i) => {
        const idx = isTime ? floorIndex(s.points, sx) : s.points.findIndex((p) => p[0] === sx);
        const p = idx >= 0 ? s.points[idx] : null;
        tip.append(rowHtml(s, i, p));
        if (p) {
          hoverDots[i].setAttribute('cx', X(p[0])); hoverDots[i].setAttribute('cy', Y(p[1]));
          hoverDots[i].setAttribute('visibility', 'visible');
        } else hoverDots[i].setAttribute('visibility', 'hidden');
      });
      tip.hidden = false;
      const tw = tip.offsetWidth;
      const hx = X(sx);
      tip.style.left = Math.max(0, Math.min(w - tw, hx > w / 2 ? hx - tw - 12 : hx + 12)) + 'px';
      tip.style.top = '8px';
    }
    function hide() {
      cross.setAttribute('visibility', 'hidden');
      hoverDots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      tip.hidden = true;
    }
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('pointercancel', hide);
    host.append(root);
  }

  render();
  const ro = new ResizeObserver(() => { if (Math.floor(host.clientWidth) !== w) render(); });
  ro.observe(host);
  return { destroy: () => ro.disconnect() };
}

// Table twin of a chart (accessibility + exact values). Time charts list the most recent rows first.
export function chartTable(cfg, maxRows = 36) {
  const t = document.createElement('table');
  t.className = 'data-table';
  const series = cfg.series.filter((s) => s.points.length);
  const head = t.createTHead().insertRow();
  head.append(Object.assign(document.createElement('th'), { textContent: cfg.xType === 'category' ? 'Term' : 'Date' }));
  for (const s of series) head.append(Object.assign(document.createElement('th'), { textContent: s.label }));
  const body = t.createTBody();
  if (cfg.xType === 'category') {
    cfg.categories.forEach((c, i) => {
      const r = body.insertRow();
      r.insertCell().textContent = c;
      for (const s of series) {
        const p = s.points.find((q) => q[0] === i);
        r.insertCell().textContent = p ? cfg.yFormat(p[1], true) : '—';
      }
    });
    return t;
  }
  const dense = series.reduce((a, b) => (b.points.length > a.points.length ? b : a));
  const step = Math.max(1, Math.ceil(dense.points.length / maxRows));
  const rows = [];
  for (let i = dense.points.length - 1; i >= 0 && rows.length < maxRows; i -= step) rows.push(dense.points[i][0]);
  for (const x of rows) {
    const r = body.insertRow();
    r.insertCell().textContent = new Date(x).toISOString().slice(0, 10);
    for (const s of series) {
      const idx = floorIndex(s.points, x);
      r.insertCell().textContent = idx >= 0 ? cfg.yFormat(s.points[idx][1], true) : '—';
    }
  }
  return t;
}

export function sparkline(points, color = 1, w = 84, h = 28) {
  const s = svg('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'spark', 'aria-hidden': 'true' });
  if (points.length < 2) return s;
  const ys = points.map((p) => p[1]);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((p[1] - lo) / (hi - lo || 1)) * (h - 6)).toFixed(1)}`).join('');
  s.append(svg('path', { d, class: `line s${color}` }));
  return s;
}
