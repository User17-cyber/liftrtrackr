// Long-term weight log. Weigh-ins are smoothed with an exponentially weighted moving average
// (10% per day, the method from John Walker's "The Hacker's Diet") so day-to-day water swings
// don't hide real change. Maintenance is measured by energy balance: average logged intake
// minus the weight change × ~7,700 kcal per kg (an approximation; Hall, Int J Obes 2008).
import { LB_PER_KG } from './metabolism.js';
import { timeChart, dayAtPointer, hoverAt, nearest, dayNum, DAY } from './charts.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
export const KCAL_PER_KG = 7700;
const RANGES = [['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['All', 0]];
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoFromDay = n => new Date(n * DAY).toISOString().slice(0, 10);
const dateOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dateShort = s => dateOf(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const dateLong = s => dateOf(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(dateOf(s).getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });

let ctx, range = 91, showAll = false, confirmDel = null, view = null, viewPts = [];

/* ---------- math ---------- */

export function normalizeWeights(raw) {
  const entries = (Array.isArray(raw?.entries) ? raw.entries : [])
    .filter(e => e && ISO_RE.test(e.d) && Number.isFinite(e.kg) && e.kg >= 20 && e.kg <= 400)
    .map(e => ({ d: e.d, kg: Math.round(e.kg * 100) / 100 }))
    .sort((a, b) => a.d.localeCompare(b.d));
  const goalKg = Number.isFinite(raw?.goalKg) && raw.goalKg >= 20 && raw.goalKg <= 400 ? raw.goalKg : null;
  // Tape measurements in cm for the body fat estimate (bodyfat.js), one set per day.
  const cm = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  const tape = (Array.isArray(raw?.tape) ? raw.tape : [])
    .filter(t => t && ISO_RE.test(t.d) && cm(t.waist, 40, 200) && cm(t.neck, 20, 70))
    .map(t => ({ d: t.d, waist: t.waist, neck: t.neck, ...(cm(t.hip, 50, 200) && { hip: t.hip }) }))
    .sort((a, b) => a.d.localeCompare(b.d));
  return { entries, goalKg, tape };
}

export function withTrend(entries) {
  let t = null, prev = null;
  return entries.map(e => {
    const day = dayNum(e.d);
    t = t == null ? e.kg : t + (1 - 0.9 ** Math.max(1, day - prev)) * (e.kg - t);
    prev = day;
    return { ...e, day, trend: t };
  });
}

// Least-squares slope of the raw weigh-ins (kg/day) and its standard error. Unlike the smoothed
// trend it has no lag, so rates and energy balance are not understated.
function fit(pts) {
  const n = pts.length, mx = pts.reduce((a, p) => a + p.day, 0) / n, my = pts.reduce((a, p) => a + p.kg, 0) / n;
  let sxy = 0, sxx = 0, sse = 0;
  for (const p of pts) { sxy += (p.day - mx) * (p.kg - my); sxx += (p.day - mx) ** 2; }
  const b = sxx ? sxy / sxx : 0;
  for (const p of pts) sse += (p.kg - my - b * (p.day - mx)) ** 2;
  return { b, se: n > 2 && sxx ? Math.sqrt(sse / (n - 2) / sxx) : 0 };
}
const lastWindow = series => series.filter(p => p.day >= series[series.length - 1].day - 28);

export function weeklyRate(series) {
  if (series.length < 3) return null;
  const pts = lastWindow(series);
  if (pts.length < 3 || pts[pts.length - 1].day - pts[0].day < 10) return null;
  return fit(pts).b * 7;
}

// Needs 3+ weigh-ins over 14+ days in the last 28, and meals logged on at least 60% of those days.
export function measuredMaintenance(series, intakeFor) {
  if (series.length < 2) return { status: 'weighins' };
  const pts = lastWindow(series);
  const start = pts[0], end = pts[pts.length - 1], span = end.day - start.day;
  if (pts.length < 3 || span < 14) return { status: 'span', span };
  let sum = 0, n = 0;
  for (let d = start.day; d < end.day; d++) { const k = intakeFor(isoFromDay(d)); if (k > 0) { sum += k; n++; } }
  if (n < Math.ceil(span * 0.6)) return { status: 'logs', n, span };
  const { b, se } = fit(pts), kcal = sum / n - b * KCAL_PER_KG, margin = 1.96 * se * KCAL_PER_KG;
  return { status: 'ok', kcal, lo: kcal - margin, hi: kcal + margin, n, span };
}

/* ---------- units ---------- */

const unit = () => (ctx.units() === 'us' ? 'lb' : 'kg');
const toU = kg => (unit() === 'lb' ? kg * LB_PER_KG : kg);
const fromU = v => (unit() === 'lb' ? v / LB_PER_KG : v);
const wfmt = kg => `${fmt(toU(kg), 1)} ${unit()}`;
const dfmt = kg => { const r = Math.round(toU(kg) * 10) / 10; return `${r < 0 ? '−' : r > 0 ? '+' : '±'}${fmt(Math.abs(r), 1)} ${unit()}`; };
const data = () => normalizeWeights(ctx.store()?.weights);
export const bodyweightSeries = store => withTrend(normalizeWeights(store?.weights).entries);

/* ---------- setup ---------- */

export function initWeight(c) {
  ctx = c;
  $('wt-date').value = ctx.today();
  $('wt-date').max = ctx.today();
  $('wt-form').addEventListener('submit', onSave);
  $('wt-goal-form').addEventListener('submit', onGoal);
  $('wt-goal-clear').addEventListener('click', () => saveGoal(null));
  $('wt-ranges').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (b) { range = Number(b.dataset.range); renderRanges(); renderChart(); renderStats(withTrend(data().entries), data().goalKg); }
  });
  $('wt-list').addEventListener('click', onListClick);
  const chart = $('wt-chart');
  const onPointer = e => { const d = dayAtPointer(chart, view, e); const p = d == null ? null : nearest(viewPts, d); drawHover(p); };
  chart.addEventListener('pointermove', onPointer);
  chart.addEventListener('pointerdown', onPointer);
  chart.addEventListener('pointerleave', () => drawHover(null));
  let lastW = 0;
  new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w && w !== lastW) { lastW = w; renderChart(); } }).observe(chart);
  return { render, measured: () => measuredMaintenance(withTrend(data().entries), ctx.intakeFor) };
}

export function render() {
  if (!ctx) return;
  const { entries, goalKg } = data();
  const series = withTrend(entries);
  $('wt-unit').textContent = unit();
  $('wt-goal-unit').textContent = unit();
  $('wt-value').placeholder = series.length ? fmt(toU(series.at(-1).kg), 1) : unit() === 'lb' ? '175.0' : '80.0';
  if (document.activeElement !== $('wt-goal')) $('wt-goal').value = goalKg ? String(Math.round(toU(goalKg) * 10) / 10) : '';
  $('wt-goal-clear').hidden = !goalKg;
  renderHero(series);
  renderRanges();
  renderStats(series, goalKg);
  renderChart();
  renderList(series);
}

function renderHero(series) {
  const el = $('wt-hero');
  if (!series.length) {
    el.innerHTML = '<div class="empty"><strong>No weigh-ins yet.</strong>Weigh in at the same time of day for the cleanest trend.</div>';
    return;
  }
  const last = series.at(-1), rate = weeklyRate(series);
  el.innerHTML = `<span class="muted">Trend weight</span>
    <div class="big-figure"><b>${fmt(toU(last.trend), 1)}</b><span class="muted">${unit()}${rate != null ? ` · ${esc(dfmt(rate))} a week` : ''}</span></div>
    <span class="muted">Last weigh-in ${esc(wfmt(last.kg))}, ${esc(dateShort(last.d))}</span>`;
}

function renderRanges() {
  $('wt-ranges').innerHTML = RANGES.map(([l, d]) => `<button type="button" data-range="${d}" aria-pressed="${d === range}">${l}</button>`).join('');
}

/* ---------- insights ---------- */

function needText(m) {
  if (m.status === 'weighins') return 'Needs weigh-ins at least two weeks apart';
  if (m.status === 'span') return `Needs 3+ weigh-ins spread over 14+ days (${m.span} so far)`;
  return `Needs meals logged on most days (${m.n} of ${m.span})`;
}

function goalText(trend, goal, rate) {
  const diff = goal - trend;
  if (Math.abs(diff) < 0.25) return [`${wfmt(goal)}`, 'Reached'];
  let sub = `${wfmt(Math.abs(diff))} to go`;
  if (rate && Math.sign(rate) === Math.sign(diff) && Math.abs(rate) > 0.02) {
    const weeks = Math.round(diff / rate);
    if (weeks <= 104) sub += `, about ${weeks} week${weeks === 1 ? '' : 's'} at this rate`;
  }
  return [wfmt(goal), sub];
}

function renderStats(series, goalKg) {
  const el = $('wt-stats');
  if (!ctx.store()) { el.innerHTML = '<p class="fine">Opening your weight log…</p>'; return; }
  if (series.length < 2) { el.innerHTML = '<p class="empty">Your rate of change and measured maintenance appear after a few weigh-ins.</p>'; return; }
  const last = series.at(-1), rate = weeklyRate(series), m = measuredMaintenance(series, ctx.intakeFor);
  const from = series.find(p => p.day >= (range ? last.day - range : series[0].day));
  const rows = [];
  if (from && from !== last) rows.push([`Change since ${dateShort(from.d)}`, dfmt(last.trend - from.trend), null]);
  rows.push(['Rate, last 4 weeks', rate == null ? '—' : `${dfmt(rate)} a week`, rate == null ? 'Needs 3+ weigh-ins over 10+ days' : null]);
  rows.push(['Maintenance from your log', m.status === 'ok' ? `${fmt(Math.round(m.kcal / 10) * 10)} kcal` : '—',
    m.status === 'ok' ? `Likely ${fmt(Math.round(m.lo / 10) * 10)}–${fmt(Math.round(m.hi / 10) * 10)}, from ${m.n} days of meals` : needText(m)]);
  if (goalKg) { const [v, sub] = goalText(last.trend, goalKg, rate); rows.push(['Goal', v, sub]); }
  el.innerHTML = `<dl class="stats">${rows.map(([k, v, s]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}${s ? `<small>${esc(s)}</small>` : ''}</dd></div>`).join('')}</dl>`;
}

/* ---------- chart ---------- */

function renderChart() {
  const el = $('wt-chart');
  if (!ctx || !el.isConnected || el.closest('[hidden]')) return;
  const { entries, goalKg } = data();
  const series = withTrend(entries);
  const end = Math.max(dayNum(ctx.today()), series.at(-1)?.day ?? 0);
  const start = range ? end - range : Math.min(series[0]?.day ?? end - 30, end - 14);
  viewPts = series.filter(p => p.day >= start);
  view = timeChart(el, {
    start, end, height: 200, minSpread: unit() === 'lb' ? 4 : 2, label: 'Bodyweight over time',
    empty: series.length ? 'No weigh-ins in this range. Choose a longer one.' : 'Your bodyweight chart appears after your first weigh-in.',
    ref: goalKg ? { v: toU(goalKg), label: `goal ${fmt(toU(goalKg), 1)}` } : null,
    series: [
      { type: 'dots', pts: viewPts.map(p => ({ day: p.day, v: toU(p.kg) })) },
      { type: 'line', pts: viewPts.map(p => ({ day: p.day, v: toU(p.trend) })) },
    ],
  });
  drawHover(null);
}

function drawHover(p) {
  hoverAt($('wt-chart'), view, p ? p.day : null, p ? toU(p.kg) : null);
  const q = p || viewPts.at(-1);
  $('wt-readout').textContent = q ? `${p ? '' : 'Latest · '}${dateLong(q.d)}: weighed ${wfmt(q.kg)}, trend ${wfmt(q.trend)}` : '';
}

/* ---------- list ---------- */

function renderList(series) {
  const el = $('wt-list');
  if (!series.length) { el.innerHTML = '<p class="empty">Your weigh-ins will be listed here.</p>'; return; }
  const rows = [...series].reverse();
  const shown = showAll ? rows : rows.slice(0, 7);
  el.innerHTML = `<ul class="wt-list">${shown.map((p, i) => {
    const prev = rows[i + 1];
    if (confirmDel === p.d) {
      return `<li class="confirming" data-d="${p.d}"><span>Delete ${esc(dateShort(p.d))}?</span><span class="wl-confirm"><button type="button" class="link-btn danger" data-act="del-yes">Delete</button><button type="button" class="link-btn" data-act="del-no">Keep</button></span></li>`;
    }
    return `<li data-d="${p.d}"><span>${esc(dateLong(p.d))}</span><span class="wl-kg">${esc(wfmt(p.kg))}</span><span class="wl-delta">${prev ? esc(dfmt(p.kg - prev.kg)) : ''}</span><button type="button" class="remove-btn" data-act="del" aria-label="Delete the weigh-in from ${esc(dateLong(p.d))}">${ICON_X}</button></li>`;
  }).join('')}</ul>${rows.length > 7 ? `<button type="button" class="link-btn" style="margin-top:12px" data-act="all">${showAll ? 'Show fewer' : `Show all ${rows.length}`}</button>` : ''}`;
}

async function onListClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const d = b.closest('li')?.dataset.d, act = b.dataset.act;
  if (act === 'all') showAll = !showAll;
  if (act === 'del') confirmDel = d;
  if (act === 'del-no') confirmDel = null;
  if (act === 'del-yes') {
    confirmDel = null;
    const cur = data();
    try {
      await ctx.store().saveWeights({ ...cur, entries: cur.entries.filter(x => x.d !== d) });
      const synced = await ctx.onWeighIn();
      ctx.toast(synced ? `Weigh-in deleted. Maintenance now uses ${dateShort(synced.d)}’s, ${wfmt(synced.kg)}.` : 'Weigh-in deleted');
    }
    catch (er) { ctx.toast(ctx.saveError(er)); }
  }
  renderList(withTrend(data().entries));
  if (act === 'del') $('wt-list').querySelector('[data-act="del-no"]')?.focus();
}

/* ---------- saving ---------- */

function formError(id, msg) { $(id).textContent = msg; $(id).hidden = !msg; }

async function onSave(e) {
  e.preventDefault();
  formError('wt-error', '');
  if (!ctx.store()) return ctx.toast(ctx.saveError({ code: 'not_ready' }));
  const d = $('wt-date').value, kg = fromU(Number($('wt-value').value));
  if (!ISO_RE.test(d) || d > ctx.today()) return formError('wt-error', 'Choose a date up to today.');
  if (!(kg >= 25 && kg <= 350)) return formError('wt-error', unit() === 'lb' ? 'Enter a weight between 55 and 770 lb.' : 'Enter a weight between 25 and 350 kg.');
  const cur = data();
  const entries = cur.entries.filter(x => x.d !== d).concat({ d, kg: Math.round(kg * 100) / 100 }).sort((a, b) => a.d.localeCompare(b.d));
  $('wt-save').disabled = true;
  try {
    await ctx.store().saveWeights({ ...cur, entries });
    $('wt-value').value = '';
    $('wt-value').blur();
    const synced = await ctx.onWeighIn();
    ctx.toast(synced ? `Saved. Maintenance now uses this weigh-in, ${wfmt(synced.kg)}.` : 'Weigh-in saved');
  } catch (er) { ctx.toast(ctx.saveError(er)); }
  $('wt-save').disabled = false;
}

async function onGoal(e) {
  e.preventDefault();
  const kg = fromU(Number($('wt-goal').value));
  if (!(kg >= 25 && kg <= 350)) return formError('wt-goal-error', unit() === 'lb' ? 'Enter a goal between 55 and 770 lb.' : 'Enter a goal between 25 and 350 kg.');
  formError('wt-goal-error', '');
  await saveGoal(Math.round(kg * 100) / 100);
}

async function saveGoal(goalKg) {
  if (!ctx.store()) return ctx.toast(ctx.saveError({ code: 'not_ready' }));
  try {
    await ctx.store().saveWeights({ ...data(), goalKg });
    $('wt-goal').blur();
    ctx.toast(goalKg ? `Goal set: ${wfmt(goalKg)}` : 'Goal cleared');
  } catch (er) { ctx.toast(ctx.saveError(er)); }
}
