// Refine: the person tells Claude what it got wrong ("brown rice, and less of it") and gets the meal
// back with only that changed. A food Claude carries over keeps its exact data (database match, label
// numbers or the person's own numbers) with the new amount, and keeps the record of Claude's first
// estimate, so a refined portion still teaches the learned portions (see accuracy.js).
import { getFood, tokens } from './usda.js';
import { normalize } from './food-ai.js';
import { applyCalibration } from './accuracy.js';

const fmt = n => Math.round(n).toLocaleString();

// The meal as numbered lines for the prompt: what each food is matched to, how much, and its calories.
export function describeMeal(items, nutrientsOf) {
  return items.map((it, i) => {
    const c = it.custom, f = c ? null : getFood(it.fdcId);
    const src = !c ? `database entry "${f?.desc || 'unknown'}" (food_id ${it.fdcId})`
      : c.origin === 'stated' ? 'the person\'s own numbers'
      : c.origin === 'label' ? `numbers read from the package label${c.brand ? ` (${c.brand})` : ''}`
      : c.origin === 'web' ? `numbers from ${c.urlTitle || 'a web page'}`
      : 'Claude\'s knowledge of the label (unverified)';
    return `${i + 1}. "${it.label}": ${src}, ${it.grams} g, about ${fmt(nutrientsOf(it).kcal)} kcal`;
  }).join('\n');
}

// Whether a refined item is still the same food as the one it continues.
function sameFood(cur, it) {
  if (it.custom?.origin === 'stated') return false;          // new numbers from the person win
  if (!cur.custom) return !it.custom && String(it.fdcId) === String(cur.fdcId);
  return it.custom?.origin === cur.custom.origin || tokens(it.label)[0] === tokens(cur.label)[0];
}

// Folds Claude's refined answer into the current items: {title, items, addons, notes}. An amount the
// person set by hand stays as they set it unless their correction names that food.
export function mergeRefined(currentItems, reply, store, correction = '') {
  const fresh = normalize(reply), said = new Set(tokens(correction));
  const named = cur => tokens(cur.label).some(t => t.length > 2 && said.has(t));
  const items = fresh.items.map(it => {
    const cur = it.from ? currentItems[it.from - 1] : null;
    // A food that's new to the meal is treated like a first estimate.
    if (!cur) return applyCalibration(store, [it])[0];
    const first = { aiGrams: cur.aiGrams, aiFdcId: cur.aiFdcId, shownGrams: cur.shownGrams ?? cur.grams };
    if (!sameFood(cur, it)) return { ...it, ...first };
    if (cur.manual && !named(cur)) return { ...cur, ...first };
    return { ...cur, ...first, label: it.label || cur.label, grams: it.grams, basis: it.basis || cur.basis, confidence: it.confidence, range: it.range, ask: it.ask };
  });
  return { title: fresh.title, items, addons: fresh.addons, notes: fresh.notes };
}
