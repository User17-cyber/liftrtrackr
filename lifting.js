// Strength-training log. Each day's session holds exercises and their sets (weight stored in kg,
// reps), and the split day it was started from. Estimated one-rep max uses the Epley formula,
// 1RM = weight × (1 + reps / 30), which is reasonable up to about 12 reps; higher-rep sets are left
// out of the estimate. The split planner, calendar and rest timer live in their own modules.
import { LB_PER_KG } from './metabolism.js';
import { timeChart, dayAtPointer, hoverAt, nearest, dayNum } from './charts.js';
import { bodyweightSeries } from './weight.js';
import { initSplit, startEditing, normalizePlan, plannedFor, dayById, suggestion } from './split.js';
import { initCalendar } from './lift-calendar.js';
import { initRestTimer, startRest, restLabel } from './rest-timer.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const RANGES = [['3M', 91], ['6M', 182], ['1Y', 365], ['All', 0]];
const dateOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dateShort = s => dateOf(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(dateOf(s).getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
const keyOf = name => String(name || '').trim().toLowerCase();

export const EXERCISES = [
  'Back squat', 'Bench press', 'Deadlift', 'Overhead press', 'Barbell row', 'Pull-up', 'Chin-up',
  'Romanian deadlift', 'Front squat', 'Incline bench press', 'Dumbbell bench press', 'Dumbbell row',
  'Lat pulldown', 'Seated cable row', 'Leg press', 'Hip thrust', 'Walking lunge', 'Bulgarian split squat',
  'Leg curl', 'Leg extension', 'Calf raise', 'Dip', 'Biceps curl', 'Triceps pushdown', 'Lateral raise', 'Face pull',
];

export function e1rm(kg, reps) {
  if (!(kg > 0) || !(reps > 0) || reps > 12) return null;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}

/* ---------- data ---------- */

// Untrusted input (the store, a backup) becomes {date, exercises:[{name, sets:[{kg, reps}]}], day?:{id, name}}.
export function normalizeSession(date, raw) {
  const day = raw?.day?.id ? { id: String(raw.day.id).slice(0, 24), name: String(raw.day.name || '').slice(0, 30) } : null;
  const exercises = (Array.isArray(raw?.exercises) ? raw.exercises : []).slice(0, 40).map(x => ({
    name: String(x?.name || '').trim().slice(0, 60),
    sets: (Array.isArray(x?.sets) ? x.sets : []).slice(0, 50).map(s => ({
      kg: Number.isFinite(s?.kg) && s.kg >= 0 && s.kg <= 1000 ? Math.round(s.kg * 100) / 100 : 0,
      reps: Number.isInteger(s?.reps) && s.reps >= 0 && s.reps <= 500 ? s.reps : 0,
    })),
  })).filter(x => x.name);
  return day ? { date, exercises, day } : { date, exercises };
}

let ctx, draft = null, loadedJSON = '', dirty = false, saveTimer = null, pick = null, range = 91, charts = null, split = null, calendar = null;

function sessions() {
  const all = ctx.store()?.lifts || {};
  const out = Object.entries(all).filter(([d]) => ISO_RE.test(d)).map(([d, s]) => normalizeSession(d, s));
  if (draft && !out.some(s => s.date === draft.date)) out.push(clean(draft));
  return out.map(s => (draft && s.date === draft.date ? clean(draft) : s)).sort((a, b) => a.date.localeCompare(b.date));
}

// Per-session figures for one exercise, oldest first. The top set is the heaviest (most reps on ties).
function seriesFor(key) {
  const out = [];
  for (const s of sessions()) {
    const sets = s.exercises.filter(x => keyOf(x.name) === key).flatMap(x => x.sets).filter(st => st.reps > 0);
    if (!sets.length) continue;
    let best = null, bestSet = null, top = sets[0], volume = 0, maxReps = 0;
    for (const st of sets) {
      const e = e1rm(st.kg, st.reps);
      if (e != null && (best == null || e > best)) { best = e; bestSet = st; }
      if (st.kg > top.kg || (st.kg === top.kg && st.reps > top.reps)) top = st;
      volume += st.kg * st.reps;
      maxReps = Math.max(maxReps, st.reps);
    }
    out.push({ date: s.date, day: dayNum(s.date), best, bestSet, top, volume, maxReps, sets: sets.length });
  }
  return out;
}

function lastSessionWith(key, before) {
  const list = sessions().filter(s => s.date < before);
  for (let i = list.length - 1; i >= 0; i--) {
    const ex = list[i].exercises.find(x => keyOf(x.name) === key && x.sets.some(st => st.reps > 0));
    if (ex) return { date: list[i].date, ex };
  }
  return null;
}

/* ---------- units ---------- */

const unit = () => (ctx.units() === 'us' ? 'lb' : 'kg');
const toU = kg => (unit() === 'lb' ? kg * LB_PER_KG : kg);
const fromU = v => (unit() === 'lb' ? v / LB_PER_KG : v);
const wNum = kg => Math.round(toU(kg) * 10) / 10;
const wfmt = kg => `${fmt(toU(kg), 1)} ${unit()}`;

function setsSummary(sets) {
  const groups = [];
  for (const s of sets.filter(x => x.reps > 0)) {
    const g = groups[groups.length - 1];
    if (g && g.kg === s.kg && g.reps === s.reps) g.n++; else groups.push({ ...s, n: 1 });
  }
  return groups.map(g => (g.kg > 0 ? `${g.n} × ${g.reps} at ${wfmt(g.kg)}` : `${g.n} × ${g.reps} reps`)).join(', ');
}

/* ---------- editing state ---------- */

function clean(d) {
  const out = {
    date: d.date,
    exercises: d.exercises.filter(x => x.name.trim()).map(x => ({ name: x.name.trim().slice(0, 60), sets: x.sets.filter(s => s.reps > 0).map(s => ({ kg: s.kg, reps: s.reps })) })),
  };
  return d.day ? { ...out, day: d.day } : out;
}

function loadDraft(date) {
  const doc = normalizeSession(date, ctx.store()?.lifts?.[date]);
  // Edit copy: blank set rows are allowed here and dropped on save.
  // An exercise started from the split but not yet done gets one blank row per planned set.
  const planned = doc.day ? dayById(normalizePlan(ctx.store()?.plan), doc.day.id) : null;
  const blanks = name => Array.from({ length: planned?.exercises.find(x => keyOf(x.name) === keyOf(name))?.sets || 1 }, () => ({ kg: 0, reps: 0 }));
  draft = { date, day: doc.day || null, exercises: doc.exercises.map(x => ({ name: x.name, sets: x.sets.length ? x.sets.map(s => ({ ...s })) : blanks(x.name) })) };
  loadedJSON = JSON.stringify(doc);
}

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 700);
}

async function flush() {
  clearTimeout(saveTimer);
  if (!dirty || !draft || !ctx.store()) return;
  dirty = false;
  const doc = clean(draft);
  loadedJSON = JSON.stringify(doc);
  try { await ctx.store().saveLift(draft.date, doc); }
  catch (e) { ctx.toast(ctx.saveError(e)); }
}

/* ---------- setup ---------- */

export function initLifting(c) {
  ctx = c;
  const sess = $('lift-session');
  sess.addEventListener('input', onInput);
  sess.addEventListener('change', e => { if (e.target.classList.contains('lx-name')) { renderSession(); renderNames(); } });
  sess.addEventListener('click', onClick);
  $('lift-add').addEventListener('click', addExercise);
  $('lift-new').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addExercise(); } });
  $('lift-progress').addEventListener('change', e => { if (e.target.id === 'lift-pick') { pick = e.target.value; renderProgress(); } });
  $('lift-ranges').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (b) { range = Number(b.dataset.range); renderProgress(); }
  });
  const wrap = $('lift-charts');
  const onPointer = e => {
    const el = e.target.closest('.chart');
    if (!el || !charts) return;
    const v = charts.views[el.id];
    const d = dayAtPointer(el, v, e);
    drawHover(d == null ? null : nearest(charts.sessions, d));
  };
  wrap.addEventListener('pointermove', onPointer);
  wrap.addEventListener('pointerdown', onPointer);
  wrap.addEventListener('pointerleave', () => drawHover(null));
  let lastW = 0;
  new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w && w !== lastW) { lastW = w; drawCharts(); } }).observe(wrap);
  // A workout is often closed mid-set: save what's typed when the app is hidden.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
  addEventListener('pagehide', flushAll);
  const sub = { ...c, sessions, onPlanChange: () => render() };
  split = initSplit(sub);
  calendar = initCalendar(sub);
  initRestTimer(c);
  $('split-edit').addEventListener('click', () => startEditing());
  return { render, flush: flushAll };
}

function flushAll() { flush(); split?.flush(); }

export function render() {
  if (!ctx) return;
  const date = ctx.date();
  if (!draft || draft.date !== date) { flush(); loadDraft(date); renderSession(); }
  else if (!dirty && JSON.stringify(normalizeSession(date, ctx.store()?.lifts?.[date])) !== loadedJSON) {
    // Changed elsewhere (another device or a restored backup): reload unless the person is mid-edit.
    if (!$('lift-session').contains(document.activeElement)) { loadDraft(date); renderSession(); }
  } else if (!$('lift-session').contains(document.activeElement)) renderSession();
  renderWeek();
  renderNames();
  renderProgress();
  split.render();
  calendar.render();
}

/* ---------- session ---------- */

function setHtml(s, j, ph) {
  const u = unit();
  return `<div class="set" data-s="${j}">
    <span class="set-n">${j + 1}</span>
    <span class="set-f"><input type="number" class="set-w" inputmode="decimal" step="any" min="0" value="${s.kg > 0 ? wNum(s.kg) : ''}" placeholder="${ph?.kg > 0 ? wNum(ph.kg) : '0'}" aria-label="Set ${j + 1} weight in ${u}"><span class="u">${u}</span></span>
    <span class="set-x" aria-hidden="true">×</span>
    <span class="set-f"><input type="number" class="set-r" inputmode="numeric" step="1" min="0" value="${s.reps > 0 ? s.reps : ''}" placeholder="${ph?.reps || ''}" aria-label="Set ${j + 1} reps"><span class="u">reps</span></span>
    <button type="button" class="remove-btn" data-act="rm-set" aria-label="Remove set ${j + 1}">${ICON_X}</button>
  </div>`;
}

function exBest(ex) {
  let best = null;
  for (const s of ex.sets) { const e = e1rm(s.kg, s.reps); if (e != null && (best == null || e > best)) best = e; }
  return best;
}

// Best estimated 1RM for an exercise in sessions before a date (null if none).
function priorBest(key, before) {
  let best = null;
  for (const p of seriesFor(key)) if (p.date < before && p.best != null && (best == null || p.best > best)) best = p.best;
  return best;
}

function bestText(ex) {
  const best = exBest(ex);
  if (!best) return '';
  const prior = priorBest(keyOf(ex.name), draft.date);
  return prior != null && best > prior + 0.01 ? `New est. 1RM record: ${wfmt(best)}` : `Est. 1RM ${wfmt(best)}`;
}

// The plan's sets and reps for this exercise on this session's split day, if any.
function planFor(ex) {
  const plan = normalizePlan(ctx.store()?.plan), d = draft.day ? dayById(plan, draft.day.id) : plannedFor(plan, draft.date);
  return d?.exercises.find(x => keyOf(x.name) === keyOf(ex.name)) || null;
}

function exHtml(ex, i) {
  const last = lastSessionWith(keyOf(ex.name), draft.date);
  const lastSets = last?.ex.sets.filter(s => s.reps > 0) || [];
  const best = bestText(ex);
  const pe = planFor(ex), next = pe ? suggestion(pe, lastSets, ctx.units()) : null;
  return `<div class="lx" data-x="${i}">
    <div class="lx-head">
      <input type="text" class="lx-name" list="lift-names" value="${esc(ex.name)}" maxlength="60" aria-label="Exercise name">
      <button type="button" class="remove-btn" data-act="rm-ex" aria-label="Remove ${esc(ex.name)}">${ICON_X}</button>
    </div>
    ${pe ? `<p class="lx-plan">Plan: ${pe.sets} × ${esc(pe.reps)}${next ? ` · Next: ${next.kg ? `${esc(wfmt(next.kg))}, ` : ''}${esc(next.text)}` : ''}</p>` : ''}
    ${last ? `<p class="lx-last">Last time, ${esc(dateShort(last.date))}: ${esc(setsSummary(last.ex.sets))}</p>` : ''}
    <div class="sets">${ex.sets.map((s, j) => setHtml(s, j, lastSets[j] || lastSets[lastSets.length - 1] || ex.sets[j - 1])).join('')}</div>
    <div class="lx-foot">
      <button type="button" class="btn btn-plain btn-sm" data-act="add-set">+ Add set</button>
      <button type="button" class="btn btn-plain btn-sm" data-act="rest">${restLabel()}</button>
      <span class="lx-best${best.startsWith('New') ? ' pr' : ''}">${esc(best)}</span>
    </div>
  </div>`;
}

function renderSession() {
  const el = $('lift-session');
  const today = draft.date === ctx.today();
  const dayName = draft.day ? dayById(normalizePlan(ctx.store()?.plan), draft.day.id)?.name || draft.day.name : '';
  $('lift-session-h').textContent = `${today ? 'Today’s session' : `Session, ${dateShort(draft.date)}`}${dayName ? ` · ${dayName}` : ''}`;
  if (!ctx.store()) { el.innerHTML = '<p class="fine">Opening your training log…</p>'; return; }
  if (!draft.exercises.length) {
    // With a split, the day's planned workout (or any other split day) starts with one tap.
    const plan = normalizePlan(ctx.store()?.plan), planned = plannedFor(plan, draft.date);
    const others = plan ? plan.days.filter(d => d !== planned && d.exercises.length) : [];
    el.innerHTML = `<div class="empty"><strong>Nothing logged ${today ? 'yet today' : 'on this day'}.</strong>${plan ? (planned ? `${today ? 'Today' : 'This day'} is ${esc(planned.name)} in your split.` : 'A rest day in your split.') : 'Add an exercise below, or plan a split further down to start workouts with one tap.'} Sets save as you type, and last session's numbers show as hints.</div>
      ${plan ? `<div class="start-days">${planned?.exercises.length ? `<button type="button" class="btn btn-primary" data-act="start-day" data-day="${esc(planned.id)}">Start ${esc(planned.name)}</button>` : ''}${others.map(d => `<button type="button" class="btn btn-plain btn-sm" data-act="start-day" data-day="${esc(d.id)}">${esc(d.name)}</button>`).join('')}</div>` : ''}`;
    return;
  }
  el.innerHTML = draft.exercises.map(exHtml).join('') + `<p class="lift-total">${totalLine()}</p>`;
}

function totalLine() {
  const c = clean(draft);
  const sets = c.exercises.reduce((a, x) => a + x.sets.length, 0);
  const vol = c.exercises.reduce((a, x) => a + x.sets.reduce((b, s) => b + s.kg * s.reps, 0), 0);
  return `${c.exercises.length} exercise${c.exercises.length === 1 ? '' : 's'} · ${sets} set${sets === 1 ? '' : 's'}${vol ? ` · ${fmt(toU(vol))} ${unit()} lifted` : ''}`;
}

function onInput(e) {
  const t = e.target, xEl = t.closest('.lx');
  if (!xEl || !draft) return;
  const ex = draft.exercises[Number(xEl.dataset.x)];
  if (t.classList.contains('lx-name')) ex.name = t.value;
  else {
    const set = ex.sets[Number(t.closest('.set').dataset.s)];
    const v = Number(t.value);
    if (t.classList.contains('set-w')) set.kg = v > 0 ? Math.round(fromU(v) * 100) / 100 : 0;
    if (t.classList.contains('set-r')) set.reps = v > 0 ? Math.min(500, Math.round(v)) : 0;
    const best = bestText(ex), bestEl = xEl.querySelector('.lx-best');
    bestEl.textContent = best;
    bestEl.classList.toggle('pr', best.startsWith('New'));
  }
  const total = $('lift-session').querySelector('.lift-total');
  if (total) total.textContent = totalLine();
  scheduleSave();
}

function onClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  if (b.dataset.act === 'start-day') return startDay(b.dataset.day);
  if (b.dataset.act === 'rest') { startRest(); return; }
  const xEl = b.closest('.lx'), i = Number(xEl.dataset.x), ex = draft.exercises[i];
  if (b.dataset.act === 'add-set') {
    const prev = ex.sets[ex.sets.length - 1];
    ex.sets.push(prev && prev.reps > 0 ? { ...prev } : { kg: 0, reps: 0 });
  } else if (b.dataset.act === 'rm-set') {
    ex.sets.splice(Number(b.closest('.set').dataset.s), 1);
    if (!ex.sets.length) ex.sets.push({ kg: 0, reps: 0 });
  } else if (b.dataset.act === 'rm-ex') {
    draft.exercises.splice(i, 1);
  }
  scheduleSave();
  renderSession();
  if (b.dataset.act === 'add-set') $('lift-session').querySelector(`.lx[data-x="${i}"] .set:last-child .set-w`)?.focus({ preventScroll: true });
}

// Fills an empty session with a split day's exercises, one blank row per planned set; last
// session's weights and reps show in each row as placeholders.
function startDay(id) {
  const d = dayById(normalizePlan(ctx.store()?.plan), id);
  if (!d || !draft) return;
  draft.day = { id: d.id, name: d.name };
  draft.exercises = d.exercises.map(x => ({ name: x.name, sets: Array.from({ length: x.sets }, () => ({ kg: 0, reps: 0 })) }));
  scheduleSave();
  renderSession();
  $('lift-session').querySelector('.set-w')?.focus({ preventScroll: true });
}

function addExercise() {
  const name = $('lift-new').value.trim().slice(0, 60);
  if (!name || !draft) { $('lift-new').focus(); return; }
  draft.exercises.push({ name, sets: [{ kg: 0, reps: 0 }] });
  $('lift-new').value = '';
  scheduleSave();
  renderSession();
  $('lift-session').querySelector('.lx:last-of-type .set-w')?.focus({ preventScroll: true });
}

function renderNames() {
  const seen = new Map();
  for (const s of sessions()) for (const x of s.exercises) seen.set(keyOf(x.name), x.name);
  for (const n of EXERCISES) if (!seen.has(keyOf(n))) seen.set(keyOf(n), n);
  $('lift-names').innerHTML = [...seen.values()].map(n => `<option value="${esc(n)}"></option>`).join('');
}

function renderWeek() {
  const t = dateOf(ctx.today()), monday = new Date(t);
  monday.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const from = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  const week = sessions().filter(s => s.date >= from && s.date <= ctx.today() && s.exercises.some(x => x.sets.length));
  const sets = week.reduce((a, s) => a + s.exercises.reduce((b, x) => b + x.sets.length, 0), 0);
  const vol = week.reduce((a, s) => a + s.exercises.reduce((b, x) => b + x.sets.reduce((c, st) => c + st.kg * st.reps, 0), 0), 0);
  $('lift-week').textContent = week.length
    ? `This week: ${week.length} workout${week.length === 1 ? '' : 's'} · ${sets} set${sets === 1 ? '' : 's'}${vol ? ` · ${fmt(toU(vol))} ${unit()}` : ''}`
    : 'No workouts yet this week';
}

/* ---------- progress ---------- */

function renderProgress() {
  const counts = new Map();
  for (const s of sessions()) for (const x of s.exercises) if (x.sets.length) {
    const k = keyOf(x.name), c = counts.get(k) || { name: x.name, n: 0, last: '' };
    c.n++; c.last = s.date; c.name = x.name; counts.set(k, c);
  }
  const list = [...counts.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last));
  const box = $('lift-progress');
  if (!list.length) {
    box.innerHTML = '<p class="empty">Charts of your weight, reps and bodyweight for each exercise appear here once you log sets.</p>';
    $('lift-tools').hidden = true; charts = null;
    return;
  }
  if (!pick || !counts.has(pick)) pick = list[0][0];
  $('lift-tools').hidden = false;
  const s = seriesFor(pick);
  const weighted = s.some(p => p.top.kg > 0);
  const bw = bodyweightSeries(ctx.store());
  const rows = [];
  const bestP = s.reduce((a, p) => (p.best != null && (!a || p.best > a.best) ? p : a), null);
  if (bestP) {
    const bwAt = nearest(bw, bestP.day);
    rows.push(['Best estimated 1RM', wfmt(bestP.best), `${wfmt(bestP.bestSet.kg)} × ${bestP.bestSet.reps}, ${dateShort(bestP.date)}${bwAt ? ` · ${(bestP.best / bwAt.trend).toFixed(2)}× bodyweight` : ''}`]);
  }
  const heavy = s.reduce((a, p) => (p.top.kg > a.top.kg ? p : a), s[0]);
  const reps = s.reduce((a, p) => (p.maxReps > a.maxReps ? p : a), s[0]);
  if (weighted) rows.push(['Heaviest set', `${wfmt(heavy.top.kg)} × ${heavy.top.reps}`, dateShort(heavy.date)]);
  else rows.push(['Most reps in a set', `${reps.maxReps} reps`, dateShort(reps.date)]);
  rows.push(['Sessions', String(s.length), `last ${dateShort(s[s.length - 1].date)}`]);
  box.innerHTML = `<div class="field" style="margin-bottom:10px"><label for="lift-pick" class="visually-hidden">Exercise</label><select id="lift-pick">${list.map(([k, c]) => `<option value="${esc(k)}" ${k === pick ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <dl class="stats">${rows.map(([k, v, sub]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}${sub ? `<small>${esc(sub)}</small>` : ''}</dd></div>`).join('')}</dl>`;
  $('lift-ranges').innerHTML = RANGES.map(([l, d]) => `<button type="button" data-range="${d}" aria-pressed="${d === range}">${l}</button>`).join('');
  $('lift-charts').innerHTML = `${weighted ? '<div class="chart-label">Weight<span>heaviest set each session</span></div><div class="chart" id="lc-w"></div>' : ''}
    <div class="chart-label">Reps<span>${weighted ? 'reps in that set' : 'most reps in a set'}</span></div><div class="chart" id="lc-r"></div>
    <div class="chart-label">Bodyweight<span>trend from your weigh-ins</span></div><div class="chart" id="lc-bw"></div>`;
  charts = { weighted, series: s, bw, views: {}, sessions: [] };
  drawCharts();
}

function drawCharts() {
  if (!charts || $('lift-tools').hidden || $('lift-charts').closest('[hidden]')) return;
  const s = charts.series, end = Math.max(dayNum(ctx.today()), s.at(-1)?.day ?? 0);
  const start = range ? end - range : Math.min(s[0].day, charts.bw[0]?.day ?? s[0].day, end - 14);
  let record = 0;
  const pts = s.map(p => { const hl = p.top.kg > record; if (hl) record = p.top.kg; return { ...p, hl }; });
  charts.sessions = pts.filter(p => p.day >= start);
  const v = charts.views;
  if (charts.weighted) {
    v['lc-w'] = timeChart($('lc-w'), { start, end, height: 150, minSpread: unit() === 'lb' ? 20 : 10, label: 'Top-set weight per session',
      empty: 'No sessions in this range.', series: [{ type: 'line', markers: true, pts: charts.sessions.filter(p => p.top.kg > 0).map(p => ({ day: p.day, v: toU(p.top.kg), hl: p.hl })) }] });
  }
  v['lc-r'] = timeChart($('lc-r'), { start, end, height: 120, zero: true, minSpread: 4, decimals: 0, label: 'Reps per session',
    empty: 'No sessions in this range.', series: [{ type: 'bars', pts: charts.sessions.map(p => ({ day: p.day, v: charts.weighted ? p.top.reps : p.maxReps })) }] });
  const bwPts = charts.bw.filter(p => p.day >= start);
  v['lc-bw'] = timeChart($('lc-bw'), { start, end, height: 120, minSpread: unit() === 'lb' ? 4 : 2, label: 'Bodyweight trend',
    empty: 'Log weigh-ins in the Weight tab to compare your bodyweight here.',
    series: [{ type: 'dots', pts: bwPts.map(p => ({ day: p.day, v: toU(p.kg) })) }, { type: 'line', pts: bwPts.map(p => ({ day: p.day, v: toU(p.trend) })) }] });
  drawHover(null);
}

function drawHover(p) {
  if (!charts) return;
  const v = charts.views, bwP = p ? nearest(charts.bw, p.day) : null;
  if (charts.weighted) hoverAt($('lc-w'), v['lc-w'], p?.day ?? null, p && p.top.kg > 0 ? toU(p.top.kg) : null);
  hoverAt($('lc-r'), v['lc-r'], p?.day ?? null, p ? (charts.weighted ? p.top.reps : p.maxReps) : null);
  hoverAt($('lc-bw'), v['lc-bw'], bwP && p ? bwP.day : null, bwP && p ? toU(bwP.trend) : null);
  const q = p || charts.sessions.at(-1);
  if (!q) { $('lift-readout').textContent = ''; return; }
  const b = nearest(charts.bw, q.day);
  const set = charts.weighted ? `${wfmt(q.top.kg)} × ${q.top.reps}` : `${q.maxReps} reps`;
  $('lift-readout').textContent = `${p ? '' : 'Latest · '}${dateShort(q.date)}: ${set}${q.best ? `, est. 1RM ${wfmt(q.best)}` : ''}${b ? ` · bodyweight ${wfmt(b.trend)}` : ''}${q.hl ? ' · record' : ''}`;
}
