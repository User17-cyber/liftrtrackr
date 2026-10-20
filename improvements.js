// "Since last time": what improved in a workout compared with the previous time each exercise was
// done. Every improvement counts, however small: a new all-time estimated 1RM, a heavier top set,
// even one more rep at a weight lifted both times, a higher estimated 1RM, or more volume
// (weight × reps; for bodyweight exercises, more reps). The strongest leads. The card covers today's session as it's logged, or else the most
// recent workout, and compares total volume with the previous session of the same split day.
import { e1rm } from './lifting.js';
import { normalizePlan, sessionDay } from './split.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyOf = name => String(name || '').trim().toLowerCase();
const dateOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dateShort = s => dateOf(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const pct = (a, b) => Math.round(((a - b) / b) * 100);
const up = (a, b) => (pct(a, b) >= 1 ? `+${pct(a, b)}%` : '+<1%');
const reps = n => `${n} rep${n === 1 ? '' : 's'}`;
// Total reps done at each weight.
const repsByWeight = st => st.sets.reduce((m, x) => m.set(Math.round(x.kg * 100) / 100, (m.get(Math.round(x.kg * 100) / 100) || 0) + x.reps), new Map());

// Figures for one exercise's logged sets (null if none). The top set is the heaviest, most reps on ties.
export function stats(sets) {
  const s = (sets || []).filter(x => x.reps > 0);
  if (!s.length) return null;
  let top = s[0], best = null, volume = 0, total = 0, maxReps = 0;
  for (const x of s) {
    if (x.kg > top.kg || (x.kg === top.kg && x.reps > top.reps)) top = x;
    const e = e1rm(x.kg, x.reps);
    if (e != null && (best == null || e > best)) best = e;
    volume += x.kg * x.reps; total += x.reps; maxReps = Math.max(maxReps, x.reps);
  }
  return { top, best, volume, reps: total, maxReps, sets: s };
}

// Improvements of `cur` over `prev` (both from stats()), strongest first. `record` is the best
// estimated 1RM from all earlier sessions; `w` formats a weight in kg for display.
export function wins(cur, prev, record, w) {
  if (!cur || !prev) return [];
  const out = [], weighted = cur.top.kg > 0 || prev.top.kg > 0;
  if (cur.best != null && record != null && cur.best > record + 0.01) out.push({ kind: 'record', badge: 'Record', short: 'New est. 1RM record', delta: `+${w(cur.best - record)}`, detail: `Est. 1RM ${w(record)} → ${w(cur.best)}` });
  if (weighted) {
    if (cur.top.kg > prev.top.kg + 0.01) out.push({ kind: 'weight', badge: 'Heavier', short: `+${w(cur.top.kg - prev.top.kg)} on your top set`, delta: `+${w(cur.top.kg - prev.top.kg)}`, detail: `${w(prev.top.kg)} × ${prev.top.reps} → ${w(cur.top.kg)} × ${cur.top.reps}` });
    else if (Math.abs(cur.top.kg - prev.top.kg) < 0.01 && cur.top.reps > prev.top.reps) out.push({ kind: 'reps', badge: 'More reps', short: `+${reps(cur.top.reps - prev.top.reps)} at ${w(cur.top.kg)}`, delta: `+${reps(cur.top.reps - prev.top.reps)}`, detail: `${w(prev.top.kg)} × ${prev.top.reps} → ${w(cur.top.kg)} × ${cur.top.reps}` });
    // More reps at any weight lifted both times: an extra rep on a back-off set counts too.
    if (!out.some(x => x.kind === 'reps')) {
      const was = repsByWeight(prev);
      let gain = null;
      for (const [kg, r] of repsByWeight(cur)) {
        const before = was.get(kg), n = r - (before ?? r);
        if (n > 0 && (!gain || n > gain.n || (n === gain.n && kg > gain.kg))) gain = { kg, n, before, r };
      }
      if (gain) out.push({ kind: 'reps', badge: 'More reps', short: `+${reps(gain.n)} at ${w(gain.kg)}`, delta: `+${reps(gain.n)}`, detail: `${gain.before} → ${gain.r} reps at ${w(gain.kg)} in all` });
    }
    if (cur.best != null && prev.best != null && cur.best > prev.best + 0.01 && !out.length) out.push({ kind: 'strength', badge: 'Stronger', short: `Est. 1RM +${w(cur.best - prev.best)}`, delta: `+${w(cur.best - prev.best)}`, detail: `Est. 1RM ${w(prev.best)} → ${w(cur.best)}` });
    if (prev.volume > 0 && cur.volume > prev.volume + 0.01) out.push({ kind: 'volume', badge: 'More volume', short: `Volume ${up(cur.volume, prev.volume)}`, delta: up(cur.volume, prev.volume), detail: `${w(prev.volume)} → ${w(cur.volume)} lifted` });
  } else {
    if (cur.maxReps > prev.maxReps) out.push({ kind: 'reps', badge: 'More reps', short: `+${reps(cur.maxReps - prev.maxReps)} in your best set`, delta: `+${reps(cur.maxReps - prev.maxReps)}`, detail: `Best set ${prev.maxReps} → ${cur.maxReps} reps` });
    if (cur.reps > prev.reps) out.push({ kind: out.length ? 'volume' : 'reps', badge: 'More reps', short: `+${reps(cur.reps - prev.reps)} in all`, delta: `+${reps(cur.reps - prev.reps)}`, detail: `${prev.reps} → ${cur.reps} reps in all` });
  }
  return out;
}

/* ---------- the card ---------- */

let ctx;
export function initWins(c) { ctx = c; return { render }; }

// A set logged with reps but a blank weight was shown last time's weight (or the weight of the set
// above) as a hint, and that is what was lifted, so compare with that weight. This mirrors the hint
// rule in lifting.js: last time's set at the same position, else its last set, else the set above.
export function withHints(sets, lastSets) {
  const last = (lastSets || []).filter(s => s.reps > 0), out = [];
  (sets || []).forEach((s, j) => {
    const hint = last[j] || last[last.length - 1] || out[j - 1];
    out.push(s.reps > 0 && !(s.kg > 0) && hint?.kg > 0 ? { ...s, kg: hint.kg } : s);
  });
  return out;
}

// The exercise's figures in the latest earlier session that has it, and its best est. 1RM before `date`.
export function history(list, key, date) {
  let prev = null, record = null;
  for (const s of list) {
    if (s.date >= date) continue;
    const st = stats(withHints(s.exercises.filter(x => keyOf(x.name) === key).flatMap(x => x.sets), prev?.st.sets));
    if (!st) continue;
    prev = { date: s.date, st };
    if (st.best != null && (record == null || st.best > record)) record = st.best;
  }
  return { prev, record };
}

const sessionVolume = s => s.exercises.reduce((a, x) => a + x.sets.reduce((b, st) => b + (st.reps > 0 ? st.kg * st.reps : 0), 0), 0);
const hasSets = s => s.exercises.some(x => x.sets.some(st => st.reps > 0));

export function render() {
  const card = $('lift-wins');
  if (!ctx || !card) return;
  const list = ctx.sessions().filter(hasSets);
  const today = ctx.today(), cur = list.filter(s => s.date <= today).at(-1);
  if (!cur || !list.some(s => s.date < cur.date)) { card.hidden = true; return; }
  const plan = normalizePlan(ctx.store()?.plan), day = sessionDay(plan, cur);
  const rows = [], level = [];
  for (const x of cur.exercises) {
    const { prev, record } = history(list, keyOf(x.name), cur.date);
    const st = stats(withHints(x.sets, prev?.st.sets));
    if (!st) continue;
    if (!prev) { rows.push({ name: x.name, win: { kind: 'new', badge: 'New', short: 'First time logged', delta: '', detail: '' } }); continue; }
    const ws = wins(st, prev.st, record, ctx.wfmt);
    if (ws.length) rows.push({ name: x.name, win: ws[0], more: ws.slice(1), since: prev.date }); else level.push(x.name);
  }
  // Total volume against the previous session of the same split day (or the previous workout).
  const earlier = list.filter(s => s.date < cur.date);
  const same = day ? earlier.filter(s => sessionDay(plan, s)?.id === day.id).at(-1) : null;
  const base = same || earlier.at(-1), v0 = base ? sessionVolume(base) : 0, v1 = sessionVolume(cur);
  const improved = rows.filter(r => r.win.kind !== 'new').length, counted = improved + level.length;
  const parts = [];
  if (counted) parts.push(`${improved} of ${counted} exercise${counted === 1 ? '' : 's'} improved`);
  // Only a rise is shown (any rise): mid-workout the total is naturally lower than a finished session's.
  if (v0 > 0 && v1 > v0 + 0.01) parts.push(`total volume ${up(v1, v0)} vs ${same ? `your last ${esc(day.name)} day` : 'your last workout'} (${esc(dateShort(base.date))})`);
  card.hidden = false;
  $('lift-wins-when').textContent = cur.date === today ? `Today${day ? ` · ${day.name}` : ''}` : `${dateShort(cur.date)}${day ? ` · ${day.name}` : ''}`;
  $('lift-wins-body').innerHTML = `${parts.length ? `<p class="wins-sum">${parts.join(' · ')}</p>` : ''}
    ${rows.length ? `<ul class="wins">${rows.map(r => `<li class="win win-${r.win.kind}">
      <span class="win-main"><span class="win-top"><span class="win-badge">${esc(r.win.badge)}</span><b>${esc(r.name)}</b></span><span>${esc(r.win.detail || r.win.short)}${r.more?.length ? ` · ${esc(r.more.map(m => m.short).join(' · '))}` : ''}</span></span>
      ${r.win.delta ? `<span class="win-delta">${esc(r.win.delta)}</span>` : ''}
    </li>`).join('')}</ul>` : `<p class="fine">${cur.date === today ? 'Log sets and your wins against last time show here as you go.' : 'No changes from the time before.'}</p>`}
    ${level.length ? `<p class="fine">Level with or below last time: ${esc(level.join(', '))}.</p>` : ''}`;
}
