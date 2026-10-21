// How a meal being reviewed is drawn: each food with its source, weight, calories and any warnings,
// the meal total with its likely range, and Claude's "did you add…?" suggestions.
import { getFood, getPortions, nutrientsFor, sumNutrients } from './usda.js';
import { customNutrients, sourceInfo } from './food-ai.js';
import { itemWarnings } from './accuracy.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

export function itemNutrients(it) { return it.custom ? customNutrients(it.custom, it.grams) : nutrientsFor(getFood(it.fdcId), it.grams); }
export const itemPortions = it => (it.custom ? [it.custom.serving] : getPortions(it.fdcId));
export const macroLine = n => `Protein ${fmt(n.protein)} g · Carbs ${fmt(n.carb)} g · Fat ${fmt(n.fat)} g`;
export const warningsHtml = it => itemWarnings(it).map(w => `<span class="item-warn">${esc(w)}</span>`).join('');

export function itemHtml(it, i) {
  const n = itemNutrients(it), src = sourceInfo(it);
  const portions = itemPortions(it);
  const conf = it.confidence ? `<span class="conf conf-${it.confidence}">${{ high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence, check the grams' }[it.confidence]}</span>` : '';
  const range = it.range ? `<span class="item-range">Likely ${fmt(it.grams * it.range[0])}–${fmt(it.grams * it.range[1])} g</span>` : '';
  return `<div class="item" data-i="${i}">
    <div class="item-top">
      <input type="text" class="item-name" value="${esc(it.label)}" maxlength="80" aria-label="Food name">
      <button type="button" class="remove-btn" aria-label="Remove ${esc(it.label)}">${ICON_X}</button>
    </div>
    <div class="item-match"><span class="src">${esc(src.chip)}</span>${src.href ? `<a href="${esc(src.href)}" target="_blank" rel="noopener">${esc(src.text)}</a>` : esc(src.text)} · <button type="button" class="link-btn change">${it.custom ? 'Use a database match' : 'Change'}</button></div>
    <div class="item-controls">
      <div class="stepper">
        <button type="button" class="step" data-dir="-1" aria-label="Less ${esc(it.label)}">−</button>
        <input type="number" class="grams" inputmode="numeric" min="1" max="3000" step="1" value="${it.grams}" aria-label="Grams of ${esc(it.label)}">
        <span class="u" aria-hidden="true">g</span>
        <button type="button" class="step" data-dir="1" aria-label="More ${esc(it.label)}">+</button>
      </div>
      ${portions.length ? `<select class="portion" aria-label="Set the weight from a portion"><option value="">${it.custom ? 'Servings…' : 'Portions…'}</option>${portions.map(p => `<option value="${p.g}">${esc(p.label)} · ${fmt(p.g, p.g < 10 ? 1 : 0)} g</option>`).join('')}</select>` : ''}
    </div>
    ${it.ask ? `<div class="size-ask" role="group" aria-label="${esc(`How much ${it.label}?`)}"><span>How much?</span>${it.ask.map(o => `<button type="button" class="size-opt" data-size="${o.grams}" data-label="${esc(o.label)}" aria-pressed="${it.grams === o.grams}">${esc(o.label)}<small>${fmt(o.grams)} g</small></button>`).join('')}</div>` : ''}
    <div class="item-meta"><label class="item-kcal"><input type="number" class="kcal-in" inputmode="numeric" min="0" step="1" value="${Math.round(n.kcal)}" aria-label="Calories for ${esc(it.label)}">kcal</label>${conf}${range}<span class="macros-line">${macroLine(n)}</span>${it.basis ? `<span>${esc(it.basis)}</span>` : ''}<span class="item-warns">${warningsHtml(it)}</span></div>
  </div>`;
}

// The meal's calories if each estimated weight were at the low or high end of Claude's range.
function kcalRange(items) {
  let lo = 0, hi = 0, any = false;
  for (const it of items) {
    const k = itemNutrients(it).kcal;
    if (it.range) { lo += k * it.range[0]; hi += k * it.range[1]; any = true; } else { lo += k; hi += k; }
  }
  return any ? [lo, hi] : null;
}

// Meal totals: calories (with the likely range), the energy split between macronutrients, and the minor nutrients.
export function totalsHtml(result) {
  const t = sumNutrients(result.items.map(itemNutrients));
  const grams = result.items.reduce((a, i) => a + i.grams, 0);
  const energy = { protein: t.protein * 4, carb: t.carb * 4, fat: t.fat * 9 };
  const eSum = energy.protein + energy.carb + energy.fat;
  const pct = k => (eSum ? Math.round((energy[k] / eSum) * 100) : 0);
  const g = v => (v > 0 && v < 1 ? '<1 g' : `${fmt(v)} g`);
  const n = result.items.length;
  const r = kcalRange(result.items);
  const r10 = v => Math.round(v / 10) * 10;
  const macros = [['protein', 'P', 'Protein'], ['carb', 'C', 'Carbohydrate'], ['fat', 'F', 'Fat']];
  return `<section class="totals" aria-label="Meal total">
    <div class="tot-head"><span>Meal total</span><span class="muted">${n} food${n === 1 ? '' : 's'} · ${fmt(grams)} g</span></div>
    <div class="tot-kcal"><b>${fmt(t.kcal)}</b> kcal</div>
    ${r && r[1] - r[0] >= t.kcal * 0.08 ? `<p class="tot-range">Likely between ${fmt(r10(r[0]))} and ${fmt(r10(r[1]))} kcal, from Claude’s portion estimates. Weigh or adjust the foods to narrow it.</p>` : ''}
    <div class="split" role="img" aria-label="Calories from protein ${pct('protein')}%, carbohydrate ${pct('carb')}%, fat ${pct('fat')}%">${macros.filter(([k]) => energy[k] > 0).map(([k]) => `<i style="flex-grow:${energy[k].toFixed(1)};background:var(--${k})"></i>`).join('')}</div>
    <ul class="tot-macros">${macros.map(([k, key, label]) => `<li><span class="mkey" style="background:var(--${k})" aria-hidden="true">${key}</span><span>${label}</span><b>${g(t[k])}</b><span class="pct">${pct(k)}%</span></li>`).join('')}</ul>
    <dl class="tot-more">
      <div><dt>Fiber</dt><dd>${g(t.fiber)}</dd></div>
      <div><dt>Sugars</dt><dd>${g(t.sugar)}</dd></div>
      <div><dt>Saturated fat</dt><dd>${g(t.satfat)}</dd></div>
      <div><dt>Sodium</dt><dd>${fmt(t.sodium)} mg</dd></div>
    </dl>
  </section>`;
}

// Things Claude thinks are likely but can't see (cooking oil, dressing, sugar in a drink).
export function addonsHtml(result) {
  const list = result.addons || [];
  if (!list.length) return '';
  return `<div class="addons" role="group" aria-label="Things Claude couldn't see">
    <span class="field-label">Did you add…?</span>
    ${list.map((a, i) => `<button type="button" class="addon" data-addon="${i}"><span class="addon-q">${esc(a.question)}</span><span class="addon-a">+ ${esc(a.label)}, ${fmt(a.grams)} g · ${fmt(a.kcal)} kcal</span></button>`).join('')}
  </div>`;
}
