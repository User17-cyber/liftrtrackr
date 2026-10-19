// Ways the photo estimate is made more accurate beyond the database match. Settings and what the app
// learns are kept on the profile (`accuracy`, `calibration`), so they follow the person and their backups.
//  - Portion references: the person's own plate, bowl and glass sizes go into the prompt as scale cues.
//  - Thorough mode: Claude reasons longer (and on claude.ai the most capable model answers).
//  - Personal calibration: how the person corrects Claude's gram estimates for a kind of food is
//    remembered, and later estimates of that food are adjusted by it.
//  - Checks on each item: calories that don't match the macros, a dry or raw entry matched to a
//    cooked portion, an unusually large amount.
import { getFood, getPortions, search, tokens } from './usda.js';

const $ = id => document.getElementById(id);
const CM_PER_IN = 2.54, ML_PER_FLOZ = 29.5735;
const STARCH = /\b(rice|pasta|spaghetti|macaroni|noodles?|oats?|oatmeal|quinoa|couscous|lentils?|beans?|barley|bulgur|polenta|grits|farro)\b/i;
const DRY = /\b(dry|dried|uncooked|raw)\b/i;
let ctx;

export const accuracyPrefs = store => store?.profile?.accuracy || {};

// Scale references from Settings, as prompt text (empty when none are set).
export function promptContext(store) {
  const a = accuracyPrefs(store), parts = [];
  if (a.plateCm > 0) parts.push(`dinner plates about ${Math.round(a.plateCm)} cm (${(a.plateCm / CM_PER_IN).toFixed(1)} in) across`);
  if (a.bowlMl > 0) parts.push(`bowls that hold about ${Math.round(a.bowlMl)} ml`);
  if (a.glassMl > 0) parts.push(`drinking glasses of about ${Math.round(a.glassMl)} ml`);
  return parts.length ? `This person's own dishes: ${parts.join(', ')}. When these appear in the photo, use them as the scale reference.` : '';
}

/* ---------- personal calibration ---------- */

// The kind of food a correction applies to: the first word of the database entry ("rice", "pasta").
// Packaged and label items are weighed by servings, so they aren't calibrated.
export function calibrationKey(item) {
  if (item.custom) return null;
  const f = getFood(item.fdcId);
  return f ? tokens(f.desc)[0] || null : null;
}

function factorFor(store, key) {
  const c = store?.profile?.calibration?.[key];
  if (!c || c.n < 2 || !(c.r > 0)) return 1;
  // Shrink toward 1 until there are several corrections, and never more than ±60%.
  const f = c.r ** (c.n / (c.n + 2));
  return Math.abs(f - 1) < 0.08 ? 1 : Math.min(1.6, Math.max(0.6, f));
}

// Adjusts fresh estimates by the person's past corrections. The unadjusted estimate stays on the item
// (aiGrams) so later corrections are measured against Claude, not against the adjustment; shownGrams
// is what the person was shown, so accepting it unchanged doesn't count as a correction.
export function applyCalibration(store, items) {
  return items.map(it => {
    const key = calibrationKey(it), f = key ? factorFor(store, key) : 1;
    const base = { ...it, aiGrams: it.grams, aiFdcId: it.fdcId, shownGrams: it.grams };
    if (f === 1) return base;
    const grams = Math.min(3000, Math.max(1, Math.round(it.grams * f)));
    const pct = Math.round((f - 1) * 100);
    return { ...base, grams, shownGrams: grams, basis: `${it.basis ? `${it.basis}. ` : ''}Adjusted ${pct > 0 ? '+' : ''}${pct}% from your past corrections for ${key}.`.slice(0, 200) };
  });
}

// When a meal is logged, remember how the person corrected its weights: only foods whose weight they
// changed by more than 5% from what was shown, still matched to the same database entry.
export async function recordCorrections(store, items) {
  if (!store) return;
  const cal = { ...(store.profile?.calibration || {}) };
  let changed = false;
  for (const it of items) {
    if (!(it.aiGrams > 0) || it.fdcId == null || String(it.fdcId) !== String(it.aiFdcId)) continue;
    if (Math.abs(it.grams / (it.shownGrams || it.aiGrams) - 1) < 0.05) continue;
    const key = calibrationKey(it), ratio = it.grams / it.aiGrams;
    if (!key || Math.abs(ratio - 1) < 0.05 || ratio < 0.2 || ratio > 5) continue;
    const prev = cal[key] || { r: 1, n: 0 }, m = Math.min(prev.n, 9);
    cal[key] = { r: Math.round(Math.exp((Math.log(prev.r) * m + Math.log(ratio)) / (m + 1)) * 1000) / 1000, n: prev.n + 1 };
    changed = true;
  }
  if (changed) await store.saveProfile({ ...(store.profile || {}), calibration: cal }).catch(() => {});
}

/* ---------- checks ---------- */

// Plain warnings for one result item; the editor shows them under the food.
export function itemWarnings(item) {
  const out = [];
  const c = item.custom;
  if (c && c.origin !== 'stated') {
    const p = c.per100, atwater = 4 * p.protein + 4 * p.carb + 9 * p.fat;
    if (p.kcal > 40 && Math.abs(p.kcal - atwater) / p.kcal > 0.3) out.push('The calories don’t match the protein, carbs and fat. Check the source’s numbers.');
  }
  const f = c ? null : getFood(item.fdcId);
  if (f && STARCH.test(f.desc) && DRY.test(f.desc) && !/\bcooked\b/i.test(f.desc)) out.push('This is the dry or uncooked entry. Use the dry weight, or change it to the cooked entry.');
  const biggest = Math.max(0, ...(c ? [c.serving?.g || 0] : getPortions(item.fdcId).map(x => x.g)));
  if (item.grams > Math.max(biggest * 3, 700)) out.push(`${Math.round(item.grams)} g is a lot of this. Check the amount.`);
  return out;
}

// "Did you add…?" suggestions from Claude, resolved to database foods with their calories.
export function resolveAddons(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 3).map(a => {
    if (!a || typeof a !== 'object') return null;
    const food = getFood(a.food_id) || search(String(a.query || a.label || ''), 1)[0];
    const grams = Math.min(500, Math.max(1, Math.round(Number(a.grams) || 0)));
    if (!food || !(Number(a.grams) > 0)) return null;
    return {
      question: String(a.question || '').trim().slice(0, 80) || `Add ${food.desc}?`,
      label: String(a.label || food.desc).trim().slice(0, 60), fdcId: food.id, grams,
      kcal: Math.round((food.per100.kcal || 0) * grams / 100),
    };
  }).filter(Boolean);
}

/* ---------- Settings → Photo estimates ---------- */

export function initAccuracySettings(c) {
  ctx = c;
  $('acc-form').addEventListener('submit', onSave);
  $('acc-reset').addEventListener('click', onReset);
  $('acc-form').addEventListener('input', () => { $('acc-error').hidden = true; });
  return { render };
}

const us = () => ctx.units() === 'us';

export function render() {
  const a = accuracyPrefs(ctx.store());
  $('acc-plate-u').textContent = us() ? 'in' : 'cm';
  $('acc-bowl-u').textContent = $('acc-glass-u').textContent = us() ? 'fl oz' : 'ml';
  if (!$('acc-form').contains(document.activeElement)) {
    const show = (v, k) => (v > 0 ? String(Math.round((us() ? v / k : v) * 10) / 10) : '');
    $('acc-plate').value = show(a.plateCm, CM_PER_IN);
    $('acc-bowl').value = show(a.bowlMl, ML_PER_FLOZ);
    $('acc-glass').value = show(a.glassMl, ML_PER_FLOZ);
    $('acc-thorough').checked = !!a.thorough;
  }
  const cal = Object.entries(ctx.store()?.profile?.calibration || {}).filter(([, v]) => v.n >= 2).sort((x, y) => y[1].n - x[1].n);
  $('acc-learned').textContent = cal.length
    ? `Learned from your corrections: ${cal.slice(0, 6).map(([k, v]) => `${k} ${v.r >= 1 ? '+' : '−'}${Math.round(Math.abs(v.r - 1) * 100)}%`).join(', ')}.`
    : 'As you correct Claude’s gram estimates, LiftrTrackr learns your usual portions and adjusts future estimates.';
  $('acc-reset').hidden = !Object.keys(ctx.store()?.profile?.calibration || {}).length;
}

async function save(next, msg) {
  const store = ctx.store();
  if (!store) return ctx.toast(ctx.saveError({ code: 'not_ready' }));
  try { await store.saveProfile({ ...(store.profile || {}), ...next }); document.activeElement?.blur?.(); render(); ctx.toast(msg); }
  catch (e) { ctx.toast(ctx.saveError(e)); }
}

function onSave(e) {
  e.preventDefault();
  const read = (id, k, min, max, label) => {
    const s = $(id).value.trim();
    if (s === '') return null;
    const v = Number(s) * (us() ? k : 1);
    if (!(v >= min && v <= max)) throw `${label} looks off. Leave it blank if you’re not sure.`;
    return Math.round(v);
  };
  try {
    const accuracy = {
      plateCm: read('acc-plate', CM_PER_IN, 12, 45, 'Plate size'),
      bowlMl: read('acc-bowl', ML_PER_FLOZ, 100, 2000, 'Bowl size'),
      glassMl: read('acc-glass', ML_PER_FLOZ, 100, 1500, 'Glass size'),
      thorough: $('acc-thorough').checked,
    };
    save({ accuracy }, 'Photo estimate settings saved');
  } catch (msg) { $('acc-error').textContent = msg; $('acc-error').hidden = false; }
}

function onReset() { save({ calibration: {} }, 'Learned portions cleared'); }
