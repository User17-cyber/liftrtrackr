// Training calendar. Week view: each day's planned workout from the split, the exercises actually done
// (✓ planned and done, ○ planned but not done, + done but not planned), and working sets per muscle
// group for the week. Month view: a grid of workout days. Tapping a day opens its session.
import { normalizePlan, plannedFor, sessionDay, WEEKDAYS } from './split.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyOf = name => String(name || '').trim().toLowerCase();
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = dateOf(s); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = s => addDays(s, -((dateOf(s).getDay() + 6) % 7));

// First pattern that matches an exercise name decides its muscle group (order matters: "leg curl"
// before "curl", "romanian deadlift" before "deadlift", "upright row" before "row").
const MUSCLES = [
  ['Calves', /calf/],
  ['Hamstrings & glutes', /romanian|\brdl\b|stiff.?leg|leg curl|hamstring|hip thrust|glute|good morning/],
  ['Quads', /squat|leg press|lunge|leg extension|step.?up|hack/],
  ['Shoulders', /overhead press|shoulder press|military|lateral raise|rear delt|face pull|arnold|upright row/],
  ['Chest', /bench|chest|fly|flye|push.?up|\bpec|\bdips?\b|incline|decline|dumbbell press/],
  ['Back', /row|pull.?up|chin.?up|pulldown|\blat\b|pullover|deadlift|shrug/],
  ['Triceps', /tricep|pushdown|skull|extension|close.?grip|kickback/],
  ['Biceps', /curl/],
  ['Core', /crunch|plank|\babs?\b|sit.?up|leg raise|core|russian twist|ab wheel/],
];
export const muscleOf = name => MUSCLES.find(([, re]) => re.test(keyOf(name)))?.[0] || 'Other';

let ctx, mode = 'week', anchor = null;

export function initCalendar(c) {
  ctx = c;
  $('cal-mode').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (b) { mode = b.dataset.mode; render(); }
  });
  $('cal-prev').addEventListener('click', () => step(-1));
  $('cal-next').addEventListener('click', () => step(1));
  $('cal-body').addEventListener('click', e => {
    const b = e.target.closest('[data-date]');
    if (!b) return;
    anchor = null;
    ctx.setDate(b.dataset.date);
    $('lift-session').closest('.card').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  return { render };
}

function step(dir) {
  const a = anchor || ctx.date();
  if (mode === 'week') anchor = addDays(a, dir * 7);
  else { const d = dateOf(a); anchor = iso(new Date(d.getFullYear(), d.getMonth() + dir, 1)); }
  render();
}

export function render() {
  if (!ctx) return;
  const a = anchor || ctx.date();
  $('cal-mode').innerHTML = [['week', 'Week'], ['month', 'Month']].map(([m, l]) => `<button type="button" data-mode="${m}" aria-pressed="${m === mode}">${l}</button>`).join('');
  if (mode === 'week') renderWeek(mondayOf(a)); else renderMonth(dateOf(a));
}

function sessionsByDate() {
  const m = new Map();
  for (const s of ctx.sessions()) if (s.exercises.some(x => x.sets.length)) m.set(s.date, s);
  return m;
}

function renderWeek(mon) {
  const plan = normalizePlan(ctx.store()?.plan), byDate = sessionsByDate(), today = ctx.today(), sel = ctx.date();
  const sun = addDays(mon, 6);
  const fmtD = s => dateOf(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  $('cal-title').textContent = mon <= today && today <= sun ? `This week · ${fmtD(mon)} – ${fmtD(sun)}` : `${fmtD(mon)} – ${fmtD(sun)}`;
  // Future weeks only show planned workouts, so they're reachable only with a split.
  $('cal-next').disabled = !plan && sun >= addDays(mondayOf(today), 6);
  const rows = [], weekSessions = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i), s = byDate.get(d), planned = plannedFor(plan, d), did = s ? sessionDay(plan, s) || planned : null;
    if (s) weekSessions.push(s);
    const past = d < today, isToday = d === today;
    const done = new Set(s ? s.exercises.filter(x => x.sets.length).map(x => keyOf(x.name)) : []);
    const target = did || planned;
    let chips = '', status = '';
    if (target?.exercises?.length) {
      chips += target.exercises.map(x => {
        const ok = done.has(keyOf(x.name));
        return `<span class="cal-ex ${ok ? 'ok' : past || isToday ? 'miss' : 'plan'}">${ok ? '✓' : '○'} ${esc(x.name)}</span>`;
      }).join('');
    }
    const plannedKeys = new Set((target?.exercises || []).map(x => keyOf(x.name)));
    if (s) chips += s.exercises.filter(x => x.sets.length && !plannedKeys.has(keyOf(x.name))).map(x => `<span class="cal-ex ok">+ ${esc(x.name)}</span>`).join('');
    if (s) {
      const n = target?.exercises?.length ? target.exercises.filter(x => done.has(keyOf(x.name))).length : 0;
      status = target?.exercises?.length ? `${n} of ${target.exercises.length} done` : `${s.exercises.filter(x => x.sets.length).length} exercises`;
    } else if (planned) status = past ? 'Not logged' : isToday ? 'Today' : 'Planned';
    const label = s ? (did?.name || 'Workout') : planned ? planned.name : 'Rest';
    rows.push(`<button type="button" class="cal-day${isToday ? ' today' : ''}${d === sel ? ' sel' : ''}${s ? ' done' : ''}${!s && planned && past ? ' missed' : ''}" data-date="${d}" aria-label="${esc(`${dateOf(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}: ${label}${status ? `, ${status}` : ''}`)}">
      <span class="cal-date"><span>${WEEKDAYS[i]}</span><b>${dateOf(d).getDate()}</b></span>
      <span class="cal-main"><span class="cal-name"><b>${esc(label)}</b>${status ? `<span class="muted"> · ${esc(status)}</span>` : ''}</span>${chips ? `<span class="cal-exs">${chips}</span>` : ''}</span>
    </button>`);
  }
  $('cal-body').innerHTML = `<div class="cal-week">${rows.join('')}</div>`;
  renderMuscles(weekSessions);
}

function renderMuscles(list) {
  const sets = new Map();
  for (const s of list) for (const x of s.exercises) if (x.sets.length) sets.set(muscleOf(x.name), (sets.get(muscleOf(x.name)) || 0) + x.sets.length);
  const el = $('cal-muscles');
  if (!sets.size) { el.innerHTML = ''; return; }
  const rows = [...sets.entries()].sort((a, b) => b[1] - a[1]);
  el.innerHTML = `<div class="chart-label">Working sets per muscle<span>10–20 a week suits most people</span></div>
    <ul class="muscles">${rows.map(([m, n]) => `<li><span>${esc(m)}</span><span class="mbar" role="img" aria-label="${esc(m)}: ${n} sets"><span class="band" style="left:${(10 / 24) * 100}%;width:${(10 / 24) * 100}%;background:var(--accent)"></span><span class="fill" style="transform:scaleX(${Math.min(1, n / 24)});background:var(--accent)"></span></span><b>${n}</b></li>`).join('')}</ul>`;
}

function renderMonth(ref) {
  const plan = normalizePlan(ctx.store()?.plan), byDate = sessionsByDate(), today = ctx.today(), sel = ctx.date();
  const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
  $('cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('cal-next').disabled = false;
  const start = mondayOf(iso(first));
  const cells = [];
  let count = 0;
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i), dt = dateOf(d);
    if (i >= 35 && dt.getMonth() !== first.getMonth()) break;
    const s = byDate.get(d), planned = plannedFor(plan, d), did = s ? sessionDay(plan, s) || planned : null;
    const inMonth = dt.getMonth() === first.getMonth();
    if (s && inMonth) count++;
    const tag = s ? (did?.name || 'Workout') : planned && d >= today ? planned.name : '';
    cells.push(`<button type="button" class="cal-cell${inMonth ? '' : ' out'}${d === today ? ' today' : ''}${d === sel ? ' sel' : ''}${s ? ' done' : planned && d < today ? ' missed' : ''}" data-date="${d}" aria-label="${esc(`${dt.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}${s ? `: ${tag}` : planned ? `: ${planned.name} planned` : ''}`)}">
      <b>${dt.getDate()}</b>${tag ? `<span>${esc(tag.length > 6 ? tag.slice(0, 5) + '…' : tag)}</span>` : ''}</button>`);
  }
  $('cal-body').innerHTML = `<div class="cal-month"><div class="cal-dow">${WEEKDAYS.map(w => `<span>${w.slice(0, 1)}</span>`).join('')}</div><div class="cal-grid">${cells.join('')}</div></div>
    <p class="fine">${count} workout${count === 1 ? '' : 's'} this month.</p>`;
  $('cal-muscles').innerHTML = '';
}
