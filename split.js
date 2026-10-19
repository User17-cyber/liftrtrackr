// Training split: named workout days (Push, Pull, Legs…) with their planned exercises, sets and rep
// ranges, and which day falls on each weekday. Saved as one `plan` document per person:
// {template, days: [{id, name, exercises: [{name, sets, reps}]}], week: [day id or null, Monday first]}.
// Also suggests the next session's target for each exercise (double progression: add reps until the
// top of the range is reached on every set, then add weight).
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const keyOf = name => String(name || '').trim().toLowerCase();

const T = (name, sets, reps) => ({ name, sets, reps });
const day = (id, name, exercises) => ({ id, name, exercises });
export const TEMPLATES = [
  { id: 'ppl', name: 'Push / Pull / Legs', blurb: '6 days a week, each muscle twice', week: ['push', 'pull', 'legs', 'push', 'pull', 'legs', null], days: [
    day('push', 'Push', [T('Bench press', 3, '5–8'), T('Overhead press', 3, '6–10'), T('Incline dumbbell press', 3, '8–12'), T('Lateral raise', 3, '12–15'), T('Triceps pushdown', 3, '10–15')]),
    day('pull', 'Pull', [T('Deadlift', 2, '3–5'), T('Pull-up', 3, '6–10'), T('Barbell row', 3, '6–10'), T('Face pull', 3, '12–15'), T('Biceps curl', 3, '8–12')]),
    day('legs', 'Legs', [T('Back squat', 3, '5–8'), T('Romanian deadlift', 3, '8–10'), T('Leg press', 3, '10–12'), T('Leg curl', 3, '10–15'), T('Calf raise', 4, '10–15')]),
  ] },
  { id: 'ul', name: 'Upper / Lower', blurb: '4 days a week', week: ['upper', 'lower', null, 'upper', 'lower', null, null], days: [
    day('upper', 'Upper', [T('Bench press', 3, '5–8'), T('Barbell row', 3, '6–10'), T('Overhead press', 3, '6–10'), T('Lat pulldown', 3, '8–12'), T('Biceps curl', 2, '10–12'), T('Triceps pushdown', 2, '10–12')]),
    day('lower', 'Lower', [T('Back squat', 3, '5–8'), T('Romanian deadlift', 3, '8–10'), T('Bulgarian split squat', 3, '8–12'), T('Leg curl', 3, '10–12'), T('Calf raise', 3, '10–15')]),
  ] },
  { id: 'full', name: 'Full body', blurb: '3 days a week', week: ['full-a', null, 'full-b', null, 'full-a', null, null], days: [
    day('full-a', 'Full body A', [T('Back squat', 3, '5'), T('Bench press', 3, '5'), T('Barbell row', 3, '6–10'), T('Biceps curl', 2, '10–12')]),
    day('full-b', 'Full body B', [T('Deadlift', 2, '5'), T('Overhead press', 3, '6–8'), T('Pull-up', 3, '6–10'), T('Leg press', 3, '10–12')]),
  ] },
  { id: 'bro', name: 'Body-part split', blurb: '5 days a week, one area a day', week: ['chest', 'back', 'shoulders', 'legs', 'arms', null, null], days: [
    day('chest', 'Chest', [T('Bench press', 4, '6–10'), T('Incline dumbbell press', 3, '8–12'), T('Dip', 3, '8–12'), T('Cable fly', 3, '12–15')]),
    day('back', 'Back', [T('Deadlift', 2, '3–5'), T('Pull-up', 3, '6–10'), T('Barbell row', 3, '8–10'), T('Seated cable row', 3, '10–12')]),
    day('shoulders', 'Shoulders', [T('Overhead press', 4, '6–10'), T('Lateral raise', 4, '12–15'), T('Face pull', 3, '12–15')]),
    day('legs', 'Legs', [T('Back squat', 4, '5–8'), T('Romanian deadlift', 3, '8–10'), T('Leg press', 3, '10–12'), T('Leg curl', 3, '10–15'), T('Calf raise', 4, '10–15')]),
    day('arms', 'Arms', [T('Biceps curl', 3, '8–12'), T('Triceps pushdown', 3, '10–15'), T('Hammer curl', 3, '10–12'), T('Overhead triceps extension', 3, '10–12')]),
  ] },
];

/* ---------- data ---------- */

// Untrusted input (the store, a backup) becomes a well-formed plan, or null.
export function normalizePlan(raw) {
  if (!raw || !Array.isArray(raw.days)) return null;
  const days = raw.days.slice(0, 7).map((d, i) => ({
    id: String(d?.id || `day-${i + 1}`).slice(0, 24),
    name: String(d?.name || `Day ${i + 1}`).trim().slice(0, 30) || `Day ${i + 1}`,
    exercises: (Array.isArray(d?.exercises) ? d.exercises : []).slice(0, 15).map(x => ({
      name: String(x?.name || '').trim().slice(0, 60),
      sets: Math.min(10, Math.max(1, Math.round(Number(x?.sets) || 3))),
      reps: String(x?.reps ?? '8–12').trim().slice(0, 12),
    })),
  }));
  const ids = new Set(days.map(d => d.id));
  const week = Array.from({ length: 7 }, (_, i) => (ids.has(raw.week?.[i]) ? raw.week[i] : null));
  return { template: String(raw.template || 'custom').slice(0, 12), days, week };
}

const weekdayOf = iso => { const [y, m, d] = iso.split('-').map(Number); return (new Date(y, m - 1, d).getDay() + 6) % 7; };
export const dayById = (plan, id) => plan?.days.find(d => d.id === id) || null;
export const plannedFor = (plan, iso) => dayById(plan, plan?.week[weekdayOf(iso)]);

// Which split day a logged session was: as recorded when it was started from the plan, else the day
// it shares the most exercises with (the weekday's planned day wins ties).
export function sessionDay(plan, session) {
  if (!plan || !session?.exercises?.length) return null;
  if (session.day?.id) return dayById(plan, session.day.id) || { id: session.day.id, name: session.day.name || 'Workout', exercises: [] };
  const done = new Set(session.exercises.filter(x => x.sets.length).map(x => keyOf(x.name)));
  const planned = plannedFor(plan, session.date);
  let best = null, bestN = 0;
  for (const d of plan.days) {
    const n = d.exercises.filter(x => done.has(keyOf(x.name))).length + (d === planned ? 0.5 : 0);
    if (n > bestN) { best = d; bestN = n; }
  }
  return bestN >= 1 ? best : null;
}

// Lowest and highest reps in a range such as "6–8", "8-12" or "5".
export function repRange(text) {
  const n = String(text || '').match(/\d+/g)?.map(Number) || [];
  return n.length ? [Math.min(...n), Math.max(...n)] : null;
}

// What to aim for next time, from the last session's working sets.
export function suggestion(planEx, lastSets, units) {
  const r = repRange(planEx?.reps), sets = (lastSets || []).filter(s => s.reps > 0);
  if (!r || !sets.length) return null;
  const top = Math.max(...sets.map(s => s.kg));
  const work = sets.filter(s => s.kg === top);
  if (!(top > 0)) return work.every(s => s.reps >= r[1]) ? { kg: null, text: `you hit ${r[1]} reps on every set, so add weight or a harder variation` } : { kg: null, text: `aim for one more rep than last time (up to ${r[1]})` };
  const step = units === 'us' ? 5 / 2.20462 : 2.5;
  if (work.length >= Math.min(planEx.sets, sets.length) && work.every(s => s.reps >= r[1])) return { kg: top + step, text: `add weight, aim for ${r[0]}+ reps` };
  return { kg: top, text: `same weight, aim for one more rep than last time (up to ${r[1]})` };
}

/* ---------- editor card ---------- */

let ctx, editing = false, draft = null, saveTimer = null;
const plan = () => normalizePlan(ctx.store()?.plan);

export function initSplit(c) {
  ctx = c;
  const el = $('split-body');
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onInput);
  return { render, flush };
}

export function render() {
  const el = $('split-body');
  if (!ctx.store()) { el.innerHTML = '<p class="fine">Opening your training log…</p>'; return; }
  if (editing) { if (!el.contains(document.activeElement)) el.innerHTML = editorHtml(); return; }
  const p = plan();
  $('split-edit').hidden = !p;
  if (!p) {
    el.innerHTML = `<p class="fine" style="margin-bottom:10px">Pick a split to plan which workout falls on each day. You can change every exercise, set and day afterwards.</p>
      <div class="tpl-list">${TEMPLATES.map(t => `<button type="button" class="tpl" data-tpl="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.blurb)}</span></button>`).join('')}
      <button type="button" class="tpl" data-tpl="custom"><b>Build my own</b><span>Start with one empty day</span></button></div>`;
    return;
  }
  const today = ctx.today(), wd = weekdayOf(today);
  el.innerHTML = `<div class="split-week" role="list">${p.week.map((id, i) => {
      const d = dayById(p, id);
      return `<div class="split-wd${i === wd ? ' today' : ''}" role="listitem"><span>${WEEKDAYS[i]}</span><b>${esc(d ? d.name : 'Rest')}</b></div>`;
    }).join('')}</div>
    <div class="split-days">${p.days.map(d => `<details class="disclose split-day"><summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>${esc(d.name)} <span class="muted">· ${d.exercises.length} exercise${d.exercises.length === 1 ? '' : 's'}</span></summary>
      <ul>${d.exercises.map(x => `<li>${esc(x.name)} <span class="muted">${x.sets} × ${esc(x.reps)}</span></li>`).join('') || '<li class="muted">No exercises yet</li>'}</ul></details>`).join('')}</div>`;
}

function editorHtml() {
  const p = draft;
  const opts = sel => `<option value="">Rest</option>${p.days.map(d => `<option value="${esc(d.id)}" ${d.id === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}`;
  return `<div class="split-edit">
    <fieldset class="split-assign"><legend>Each weekday</legend>
      ${p.week.map((id, i) => `<label class="split-wd-row"><span>${WEEKDAYS[i]}</span><select data-wd="${i}" aria-label="${WEEKDAYS[i]}">${opts(id)}</select></label>`).join('')}
    </fieldset>
    ${p.days.map((d, di) => `<section class="split-ed-day" data-d="${di}">
      <div class="split-ed-head"><input type="text" class="sd-name" value="${esc(d.name)}" maxlength="30" aria-label="Workout day name"><button type="button" class="link-btn danger" data-act="rm-day">Remove day</button></div>
      ${d.exercises.map((x, xi) => `<div class="sd-ex" data-x="${xi}">
        <input type="text" class="sd-x-name" list="lift-names" value="${esc(x.name)}" maxlength="60" placeholder="Exercise" aria-label="Exercise">
        <input type="number" class="sd-x-sets" inputmode="numeric" min="1" max="10" value="${x.sets}" aria-label="Sets"><span class="u">×</span>
        <input type="text" class="sd-x-reps" value="${esc(x.reps)}" maxlength="12" inputmode="text" aria-label="Rep range, such as 8–12">
        <button type="button" class="remove-btn" data-act="rm-ex" aria-label="Remove ${esc(x.name || 'exercise')}">${ICON_X}</button>
      </div>`).join('')}
      <button type="button" class="btn btn-plain btn-sm" data-act="add-ex">+ Exercise</button>
    </section>`).join('')}
    <div class="backup-actions">
      ${p.days.length < 7 ? '<button type="button" class="btn btn-tinted btn-sm" data-act="add-day">+ Add a day</button>' : ''}
      <button type="button" class="btn btn-primary btn-sm" data-act="done">Done</button>
      <button type="button" class="link-btn danger" data-act="delete-plan">Delete split</button>
    </div>
  </div>`;
}

function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 600); }

export async function flush() {
  clearTimeout(saveTimer);
  if (!draft || !ctx.store()) return;
  const doc = normalizePlan({ ...draft, days: draft.days.map(d => ({ ...d, exercises: d.exercises.filter(x => x.name.trim()) })) });
  try { await ctx.store().savePlan(doc); } catch (e) { ctx.toast(ctx.saveError(e)); }
}

export function startEditing() {
  draft = structuredClone(plan() || { template: 'custom', days: [day('day-1', 'Day 1', [])], week: Array(7).fill(null) });
  editing = true;
  $('split-edit').hidden = true;
  $('split-body').innerHTML = editorHtml();
}

async function onClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tpl) {
    const t = TEMPLATES.find(x => x.id === b.dataset.tpl);
    draft = t ? structuredClone({ template: t.id, days: t.days, week: t.week }) : { template: 'custom', days: [day('day-1', 'Day 1', [])], week: Array(7).fill(null) };
    await flush();
    if (!t) startEditing(); else { draft = null; ctx.toast(`${t.name} planned. Tap Edit split to change it.`); render(); ctx.onPlanChange?.(); }
    return;
  }
  const act = b.dataset.act, dEl = b.closest('.split-ed-day'), d = dEl ? draft.days[Number(dEl.dataset.d)] : null;
  if (act === 'done') { await flush(); editing = false; draft = null; render(); ctx.onPlanChange?.(); return; }
  if (act === 'delete-plan') {
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to delete'; return; }
    try { await ctx.store().savePlan(null); } catch (err) { ctx.toast(ctx.saveError(err)); }
    editing = false; draft = null; render(); ctx.onPlanChange?.(); return;
  }
  if (act === 'add-day') {
    const n = draft.days.length + 1;
    draft.days.push(day(`day-${Date.now().toString(36)}`, `Day ${n}`, []));
  } else if (act === 'rm-day') {
    draft.week = draft.week.map(id => (id === d.id ? null : id));
    draft.days.splice(Number(dEl.dataset.d), 1);
  } else if (act === 'add-ex') d.exercises.push(T('', 3, '8–12'));
  else if (act === 'rm-ex') d.exercises.splice(Number(b.closest('.sd-ex').dataset.x), 1);
  else return;
  $('split-body').innerHTML = editorHtml();
  if (act === 'add-ex') $('split-body').querySelector(`.split-ed-day[data-d="${dEl.dataset.d}"] .sd-ex:last-of-type .sd-x-name`)?.focus({ preventScroll: true });
  scheduleSave();
}

function onInput(e) {
  if (!editing || !draft) return;
  const t = e.target, dEl = t.closest('.split-ed-day'), d = dEl ? draft.days[Number(dEl.dataset.d)] : null;
  const x = t.closest('.sd-ex') ? d.exercises[Number(t.closest('.sd-ex').dataset.x)] : null;
  if (t.dataset.wd != null) draft.week[Number(t.dataset.wd)] = t.value || null;
  else if (t.classList.contains('sd-name')) {
    d.name = t.value;
    // Keep the weekday choices' names current without redrawing the field being typed in.
    $('split-body').querySelectorAll(`option[value="${CSS.escape(d.id)}"]`).forEach(o => { o.textContent = t.value || 'Unnamed day'; });
  } else if (t.classList.contains('sd-x-name')) x.name = t.value;
  else if (t.classList.contains('sd-x-sets')) x.sets = Math.min(10, Math.max(1, Math.round(Number(t.value) || 1)));
  else if (t.classList.contains('sd-x-reps')) x.reps = t.value;
  else return;
  scheduleSave();
}
