// Time-series charts as inline SVG on a day axis: lines, dots and bars, a dashed reference line, and a
// hover guide that several charts can share (the lifting tab scrubs three charts at once).

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d });
export const DAY = 864e5;
export const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
const niceStep = raw => [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 250, 500, 1000].find(s => s >= raw) || 2000;

function xLabel(day, span) {
  const d = new Date(day * DAY + new Date().getTimezoneOffset() * 6e4);
  if (span <= 120) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short', ...(span > 400 && { year: '2-digit' }) });
}

/**
 * Draws into `el`. cfg: { start, end (day numbers), height, empty (message),
 *   series: [{ type: 'line' | 'dots' | 'bars', pts: [{ day, v, hl }] }],
 *   minSpread, zero (y axis starts at 0), ref: { v, label } (dashed line), decimals }.
 * Returns a view for hoverAt(), or null when there is nothing to draw.
 */
export function timeChart(el, cfg) {
  const all = cfg.series.flatMap(s => s.pts.filter(p => p.day >= cfg.start && p.day <= cfg.end));
  if (!all.length) { el.innerHTML = `<p class="chart-empty">${esc(cfg.empty || 'Nothing to show yet.')}</p>`; return null; }
  const W = Math.max(280, Math.round(el.clientWidth || 600)), H = cfg.height || 170;
  const pad = { l: 40, r: 10, t: 12, b: 26 };
  let lo = Math.min(...all.map(p => p.v)), hi = Math.max(...all.map(p => p.v));
  if (cfg.ref && cfg.ref.v >= lo - (hi - lo) && cfg.ref.v <= hi + (hi - lo)) { lo = Math.min(lo, cfg.ref.v); hi = Math.max(hi, cfg.ref.v); }
  const spread = Math.max(hi - lo, cfg.minSpread || 1), mid = (hi + lo) / 2;
  const step = niceStep((spread * 1.25) / 4);
  lo = cfg.zero ? 0 : Math.floor((mid - spread * 0.62) / step) * step;
  hi = Math.ceil((cfg.zero ? hi * 1.12 : mid + spread * 0.62) / step) * step || step;
  const span = Math.max(1, cfg.end - cfg.start);
  const x = d => pad.l + (W - pad.l - pad.r) * ((d - cfg.start) / span);
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / Math.max(1e-9, hi - lo));
  const dec = cfg.decimals ?? (step < 1 ? 1 : 0);
  let svg = '';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    svg += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v, dec)}</text>`;
  }
  const nT = W < 420 ? 3 : 5;
  for (let i = 0; i < nT; i++) {
    const d = Math.round(cfg.start + (span * i) / (nT - 1));
    svg += `<text x="${x(d)}" y="${H - 7}" text-anchor="${i === 0 ? 'start' : i === nT - 1 ? 'end' : 'middle'}">${esc(xLabel(d, span))}</text>`;
  }
  if (cfg.ref && cfg.ref.v >= lo && cfg.ref.v <= hi) {
    svg += `<line class="goal" x1="${pad.l}" x2="${W - pad.r}" y1="${y(cfg.ref.v)}" y2="${y(cfg.ref.v)}"/><text x="${pad.l + 4}" y="${y(cfg.ref.v) - 5}">${esc(cfg.ref.label)}</text>`;
  }
  const bw = Math.max(3, Math.min(14, ((W - pad.l - pad.r) / (span + 1)) * 0.7));
  for (const s of cfg.series) {
    const pts = s.pts.filter(p => p.day >= cfg.start && p.day <= cfg.end);
    if (s.type === 'bars') {
      svg += pts.map(p => `<rect class="bar${p.hl ? ' sel' : ''}" x="${(x(p.day) - bw / 2).toFixed(1)}" y="${y(p.v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, y(lo) - y(p.v)).toFixed(1)}" rx="2"/>`).join('');
    } else if (s.type === 'line' && pts.length > 1) {
      svg += `<path class="line" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.v).toFixed(1)}`).join('')}"/>`;
    }
    if (s.type === 'dots' || (s.type === 'line' && s.markers)) {
      svg += pts.length > 600 ? '' : pts.map(p => `<circle class="${p.hl ? 'pt-hl' : s.type === 'dots' ? 'pt' : 'pt-main'}" cx="${x(p.day).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${p.hl ? 4.5 : 3}"/>`).join('');
    }
  }
  svg += '<g class="hover" visibility="hidden"><line class="guide"/><circle class="pt-hover" r="5"/></g>';
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.label || 'Chart')}">${svg}</svg>`;
  return { x, y, W, H, pad, start: cfg.start, end: cfg.end };
}

// The day under a pointer event, or null when the pointer is outside the plot.
export function dayAtPointer(el, view, e) {
  const svg = el.querySelector('svg');
  if (!svg || !view) return null;
  const r = svg.getBoundingClientRect();
  const px = (e.clientX - r.left) * (view.W / r.width);
  const t = (px - view.pad.l) / (view.W - view.pad.l - view.pad.r);
  return view.start + Math.max(0, Math.min(1, t)) * (view.end - view.start);
}

// Places (or hides, when day is null) the hover guide and marker.
export function hoverAt(el, view, day, v) {
  const g = el.querySelector('g.hover');
  if (!g || !view) return;
  if (day == null || v == null) { g.setAttribute('visibility', 'hidden'); return; }
  const cx = view.x(day);
  const line = g.querySelector('line');
  line.setAttribute('x1', cx); line.setAttribute('x2', cx);
  line.setAttribute('y1', view.pad.t); line.setAttribute('y2', view.H - view.pad.b);
  const c = g.querySelector('circle');
  c.setAttribute('cx', cx); c.setAttribute('cy', view.y(v));
  g.setAttribute('visibility', 'visible');
}

export function nearest(pts, day) {
  let best = null, bd = Infinity;
  for (const p of pts) { const d = Math.abs(p.day - day); if (d < bd) { bd = d; best = p; } }
  return best;
}
