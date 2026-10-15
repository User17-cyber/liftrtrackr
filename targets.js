// Daily targets: the calorie target and macro goals the Calories tab measures against. By default the
// calorie target comes from the energy equations (Settings → Your details) and each macro shows its
// recommended range; anything set in Settings → Daily targets replaces that. Saved on the profile as
// `targets` ({kcal, protein, carb, fat}, each a number or null).
import { validateProfile, estimate, macroRanges } from './metabolism.js';

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString();
const KEYS = ['kcal', 'protein', 'carb', 'fat'];
const FIELD = { kcal: 'tg-kcal', protein: 'tg-protein', carb: 'tg-carb', fat: 'tg-fat' };
const LIMIT = { kcal: ['Calories', 500, 10000], protein: ['Protein', 0, 1000], carb: ['Carbs', 0, 1500], fat: ['Fat', 0, 600] };
const macroKcal = m => 4 * (m.protein || 0) + 4 * (m.carb || 0) + 9 * (m.fat || 0);
let ctx, shownKey = null;

export function estimateFor(store, units) {
  const p = store?.profile;
  if (!p) return null;
  const v = validateProfile({ ...p, units });
  return v.ok ? estimate(v.profile) : null;
}

function saved(store) {
  const t = store?.profile?.targets || {};
  return Object.fromEntries(KEYS.map(k => [k, Number.isFinite(t[k]) ? t[k] : null]));
}

// What a day is measured against. kcal: your own target, else the sum of your three macro goals,
// else the estimate (null without details). macros: grams you set, or null for the recommended range.
export function targetsFor(store, units) {
  const est = estimateFor(store, units), t = saved(store);
  const macros = { protein: t.protein, carb: t.carb, fat: t.fat };
  const fromMacros = macros.protein != null && macros.carb != null && macros.fat != null ? Math.round(macroKcal(macros)) : null;
  const kcal = t.kcal ?? fromMacros ?? (est ? Math.round(est.target / 10) * 10 : null);
  const source = t.kcal != null ? 'custom' : fromMacros != null ? 'macros' : est ? 'estimate' : null;
  return { kcal, source, macros, est };
}

export function initTargets(c) {
  ctx = c;
  const form = $('targets-form');
  form.addEventListener('input', () => { $('tg-error').hidden = true; hints(); });
  form.addEventListener('submit', onSubmit);
  $('tg-clear').addEventListener('click', onClear);
  return { render };
}

// Fills the form from what's saved (when it changes, never while the person is editing it).
export function render() {
  const t = saved(ctx.store()), key = JSON.stringify(t);
  if (key !== shownKey && !$('targets-form').contains(document.activeElement)) {
    for (const k of KEYS) $(FIELD[k]).value = t[k] ?? '';
    shownKey = key;
  }
  $('tg-clear').hidden = KEYS.every(k => t[k] == null);
  hints();
}

function read() {
  const v = {};
  for (const k of KEYS) {
    const el = $(FIELD[k]), s = el.value.trim(), n = Number(s), [label, min, max] = LIMIT[k];
    if (el.validity.badInput || (s !== '' && !(Number.isFinite(n) && n >= min && n <= max))) return { bad: `${label} needs a number from ${min.toLocaleString()} to ${max.toLocaleString()}, or leave it blank.`, field: FIELD[k] };
    v[k] = s === '' ? null : Math.round(n * 10) / 10;
  }
  return v;
}

// Placeholders show what a blank box falls back to; the hint checks the macros against the calories.
function hints() {
  const v = read(), est = estimateFor(ctx.store(), ctx.units());
  const all = !v.bad && v.protein != null && v.carb != null && v.fat != null;
  const fromMacros = all ? Math.round(macroKcal(v)) : null;
  const kcal = v.bad ? null : v.kcal ?? fromMacros ?? (est ? Math.round(est.target / 10) * 10 : null);
  $('tg-kcal').placeholder = fromMacros != null ? fmt(fromMacros) : est ? fmt(Math.round(est.target / 10) * 10) : '';
  $('tg-kcal-hint').textContent = v.kcal == null && fromMacros != null ? `Blank uses ${fmt(fromMacros)} kcal, counted from your macros.`
    : est ? `Estimated from your details: ${fmt(Math.round(est.target / 10) * 10)} kcal.` : 'Add your details to get an estimate, or set your own.';
  const ranges = macroRanges(kcal || 2000);
  for (const k of ['protein', 'carb', 'fat']) $(FIELD[k]).placeholder = `${fmt(ranges[k].min)}–${fmt(ranges[k].max)}`;
  const lines = [];
  if (all) {
    const sum = fromMacros, diff = kcal ? sum - kcal : 0;
    lines.push(`Your macros add up to ${fmt(sum)} kcal${kcal && Math.abs(diff) >= 25 ? `, ${fmt(Math.abs(diff))} ${diff > 0 ? 'above' : 'below'} your calorie target` : ''}.`);
  }
  const floor = ctx.store()?.profile?.sex === 'male' ? 1500 : 1200;
  if (kcal && kcal < floor) lines.push(`Below ${fmt(floor)} kcal a day is generally not advised without medical supervision.`);
  $('tg-hint').textContent = lines.join(' ');
  $('tg-hint').hidden = !lines.length;
}

async function save(targets, msg) {
  const store = ctx.store();
  if (!store) return ctx.toast(ctx.saveError({ code: 'not_ready' }));
  const { targets: _old, ...rest } = store.profile || {};
  try {
    await store.saveProfile(targets ? { ...rest, targets } : rest);
    document.activeElement?.blur?.();
    shownKey = null;
    render();
    ctx.toast(msg);
  } catch (err) { ctx.toast(ctx.saveError(err)); }
}

function onSubmit(e) {
  e.preventDefault();
  const v = read();
  if (v.bad) { $('tg-error').textContent = v.bad; $('tg-error').hidden = false; $(v.field).focus(); return; }
  const any = KEYS.some(k => v[k] != null);
  save(any ? v : null, any ? 'Targets saved' : 'Using the estimates');
}

function onClear() {
  for (const k of KEYS) $(FIELD[k]).value = '';
  save(null, 'Using the estimates');
}
