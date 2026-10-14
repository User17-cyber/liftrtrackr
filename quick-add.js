// Logs a meal from numbers typed in by hand: calories plus, optionally, protein, carbs and fat, times
// a number of servings. Favorites live here too: a row of saved foods above the form fills it with a
// tap, typing a saved name fills the numbers, and the form can save or update a favorite.
// Nothing here calls Claude or looks anything up.
import { listFavorites, findFavorite, saveFavorite, removeFavorite, touchFavorite } from './favorites.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString();
const fmtS = n => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const r1 = n => Math.round(n * 10) / 10;
const FIELDS = [['kcal', 'q-kcal', 'Calories', 20000], ['protein', 'q-protein', 'Protein', 2000], ['carb', 'q-carb', 'Carbs', 2000], ['fat', 'q-fat', 'Fat', 2000], ['servings', 'q-servings', 'Servings', 50]];
const NUMS = ['q-kcal', 'q-protein', 'q-carb', 'q-fat'];

let o, stripKey = '';

export function initQuickAdd(options) {
  o = options;
  const form = $('quick');
  $('numbers-btn').addEventListener('click', () => open());
  $('q-cancel').addEventListener('click', close);
  $('fav-chips').addEventListener('click', e => {
    const f = listFavorites(o.store()).find(x => x.id === e.target.closest('[data-fav]')?.dataset.fav);
    if (f) open(f);
  });
  $('q-title').addEventListener('input', () => {
    // Typing (or picking) a saved name fills in its numbers, unless some are already typed.
    const f = findFavorite(o.store(), $('q-title').value);
    if (f && NUMS.every(id => $(id).value === '')) fill(f);
  });
  $('q-fav-remove').addEventListener('click', onRemove);
  form.addEventListener('input', update);
  form.addEventListener('submit', e => { e.preventDefault(); save(); });
  return { refresh() { renderStrip(); update(); } };
}

function renderStrip() {
  const favs = listFavorites(o.store());
  const key = JSON.stringify(favs.map(f => [f.id, f.label, f.n?.kcal]));
  if (key === stripKey) return;
  stripKey = key;
  $('fav-strip').hidden = !favs.length;
  $('fav-chips').innerHTML = favs.map(f => `<button type="button" class="fav-chip" data-fav="${esc(f.id)}" aria-label="${esc(`${f.label}, ${fmt(f.n?.kcal || 0)} kcal`)}"><span class="fav-name">${esc(f.label)}</span><span class="fav-kcal">${fmt(f.n?.kcal || 0)}</span></button>`).join('');
  $('fav-names').innerHTML = favs.map(f => `<option value="${esc(f.label)}"></option>`).join('');
}

function fill(f) {
  $('q-title').value = f.label;
  $('q-kcal').value = f.n.kcal;
  const macros = f.n.protein || f.n.carb || f.n.fat;
  $('q-protein').value = macros ? f.n.protein : '';
  $('q-carb').value = macros ? f.n.carb : '';
  $('q-fat').value = macros ? f.n.fat : '';
  update();
}

function open(fav = null) {
  const form = $('quick');
  form.reset();
  const meal = o.defaultMeal();
  $('q-meal').innerHTML = Object.entries(o.meals).map(([k, v]) => `<option value="${k}" ${k === meal ? 'selected' : ''}>${v}</option>`).join('');
  $('q-error').hidden = true;
  $('capture').hidden = true;
  form.hidden = false;
  document.body.dataset.quick = '';
  if (fav) fill(fav); else update();
  // From a favorite the numbers are ready, so the keyboard stays down; otherwise start at the name.
  if (!fav) $('q-title').focus({ preventScroll: true });
  form.scrollIntoView({ block: 'nearest' });
}

function close() {
  // Let go of the field first: the app holds back re-renders while a text field has focus.
  if ($('quick').contains(document.activeElement)) document.activeElement.blur();
  $('quick').hidden = true;
  $('capture').hidden = false;
  delete document.body.dataset.quick;
}

// Blank fields are null; anything that isn't a number in range is reported by name.
function read() {
  const v = {};
  for (const [k, id, label, max] of FIELDS) {
    const s = $(id).value.trim(), n = Number(s);
    if ($(id).validity.badInput) return { bad: label, max };
    if (s === '') v[k] = null;
    else if (!Number.isFinite(n) || n < 0 || n > max) return { bad: label, max };
    else v[k] = n;
  }
  if (v.servings === 0) return { bad: 'Servings', max: 50 };
  v.servings ??= 1;
  const hasMacros = v.protein != null || v.carb != null || v.fat != null;
  v.fromMacros = hasMacros ? 4 * (v.protein || 0) + 4 * (v.carb || 0) + 9 * (v.fat || 0) : null;
  return v;
}

function update() {
  if ($('quick').hidden) return;
  const v = read(), hint = $('q-hint');
  const each = v.bad ? null : v.kcal ?? v.fromMacros;
  hint.textContent = v.bad || v.fromMacros == null ? ''
    : v.kcal == null ? `Leave blank to use ${fmt(v.fromMacros)} kcal, counted from your macros.`
    : `Your macros add up to ${fmt(v.fromMacros)} kcal.`;
  hint.hidden = !hint.textContent;
  $('q-kcal').placeholder = v.fromMacros == null ? '' : fmt(v.fromMacros);
  $('q-log').textContent = `Add to ${o.dateLabel()}${each == null ? '' : ` · ${fmt(each * v.servings)} kcal`}`;
  const match = findFavorite(o.store(), $('q-title').value);
  $('q-fav-label').textContent = match ? 'Update this favorite' : 'Save to favorites';
  $('q-fav-hint').textContent = match ? `Replaces the saved numbers for “${match.label}” with these.` : 'Keeps these numbers as one serving, to log again with a tap.';
  $('q-fav-remove').hidden = !match;
}

function fail(msg, focusId) {
  $('q-error').textContent = msg;
  $('q-error').hidden = false;
  if (focusId) $(focusId).focus({ preventScroll: true });
}

async function onRemove() {
  const f = findFavorite(o.store(), $('q-title').value);
  if (!f) return;
  try { await removeFavorite(o.store(), f.id); o.toast(`Removed “${f.label}” from favorites`); }
  catch (e) { o.toast(o.saveError(e)); }
  update();
}

async function save() {
  const v = read();
  if (v.bad) return fail(`${v.bad} needs a number from ${v.bad === 'Servings' ? 'above 0' : '0'} to ${v.max.toLocaleString()}.`);
  const kcal = v.kcal ?? v.fromMacros;
  if (kcal == null) return fail('Enter the calories, or the protein, carbs and fat.', 'q-kcal');
  const name = $('q-title').value.trim().slice(0, 80), keep = $('q-fav').checked;
  if (keep && !name) return fail('Give it a name to save it as a favorite.', 'q-title');
  $('q-error').hidden = true;
  const title = name || 'Quick add', s = v.servings;
  const per = { kcal: Math.round(kcal), protein: r1(v.protein || 0), carb: r1(v.carb || 0), fat: r1(v.fat || 0) };
  const n = { kcal: Math.round(per.kcal * s), protein: r1(per.protein * s), carb: r1(per.carb * s), fat: r1(per.fat * s) };
  const fav = findFavorite(o.store(), name);
  const same = fav && ['kcal', 'protein', 'carb', 'fat'].every(k => Number(fav.n?.[k] || 0) === per[k]);
  const meal = o.meals[$('q-meal').value] ? $('q-meal').value : o.defaultMeal();
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    meal, at: new Date().toISOString(), title: s === 1 ? title : `${title} × ${fmtS(s)}`, thumb: o.thumb(), source: 'typed',
    items: [{ label: title, servings: s, fdcId: null, origin: same ? 'favorite' : 'typed', url: null, desc: title, grams: fav?.grams ? Math.round(fav.grams * s) : null, n }],
    totals: { ...n },
  };
  const btn = $('q-log');
  btn.disabled = true;
  try {
    await o.onLog(entry);
    o.toast(`Logged ${o.meals[meal].toLowerCase()}: ${fmt(n.kcal)} kcal${keep ? ` · ${fav ? 'favorite updated' : 'saved to favorites'}` : ''}`);
    close();
    o.done();
  } catch (e) {
    o.toast(o.saveError(e));
    return;
  } finally {
    btn.disabled = false;
  }
  try {
    if (keep) await saveFavorite(o.store(), { label: name, n: per, grams: fav?.grams });
    else if (fav) await touchFavorite(o.store(), fav.id);
  } catch (e) { o.toast(o.saveError(e)); }
}
