// Logs a meal from numbers typed in by hand: calories plus, optionally, protein, carbs and fat.
// Nothing here calls Claude or looks anything up.
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString();
const r1 = n => Math.round(n * 10) / 10;
const FIELDS = [['kcal', 'q-kcal', 'Calories', 20000], ['protein', 'q-protein', 'Protein', 2000], ['carb', 'q-carb', 'Carbs', 2000], ['fat', 'q-fat', 'Fat', 2000]];

let o;

export function initQuickAdd(options) {
  o = options;
  const form = $('quick');
  $('numbers-btn').addEventListener('click', open);
  $('q-cancel').addEventListener('click', close);
  form.addEventListener('input', update);
  form.addEventListener('submit', e => { e.preventDefault(); save(); });
  return { refresh: update };
}

function open() {
  const form = $('quick');
  form.reset();
  const meal = o.defaultMeal();
  $('q-meal').innerHTML = Object.entries(o.meals).map(([k, v]) => `<option value="${k}" ${k === meal ? 'selected' : ''}>${v}</option>`).join('');
  $('q-error').hidden = true;
  $('capture').hidden = true;
  form.hidden = false;
  document.body.dataset.quick = '';
  update();
  $('q-title').focus({ preventScroll: true });
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
  const hasMacros = v.protein != null || v.carb != null || v.fat != null;
  v.fromMacros = hasMacros ? 4 * (v.protein || 0) + 4 * (v.carb || 0) + 9 * (v.fat || 0) : null;
  return v;
}

function update() {
  if ($('quick').hidden) return;
  const v = read(), hint = $('q-hint');
  const kcal = v.bad ? null : v.kcal ?? v.fromMacros;
  hint.textContent = v.bad || v.fromMacros == null ? ''
    : v.kcal == null ? `Leave blank to use ${fmt(v.fromMacros)} kcal, counted from your macros.`
    : `Your macros add up to ${fmt(v.fromMacros)} kcal.`;
  hint.hidden = !hint.textContent;
  $('q-kcal').placeholder = v.fromMacros == null ? '' : fmt(v.fromMacros);
  $('q-log').textContent = `Add to ${o.dateLabel()}${kcal == null ? '' : ` · ${fmt(kcal)} kcal`}`;
}

function fail(msg, focusId) {
  $('q-error').textContent = msg;
  $('q-error').hidden = false;
  if (focusId) $(focusId).focus({ preventScroll: true });
}

async function save() {
  const v = read();
  if (v.bad) return fail(`${v.bad} needs a number from 0 to ${v.max.toLocaleString()}.`);
  const kcal = v.kcal ?? v.fromMacros;
  if (kcal == null) return fail('Enter the calories, or the protein, carbs and fat.', 'q-kcal');
  $('q-error').hidden = true;
  const title = $('q-title').value.trim().slice(0, 80) || 'Quick add';
  const meal = o.meals[$('q-meal').value] ? $('q-meal').value : o.defaultMeal();
  const n = { kcal: Math.round(kcal), protein: r1(v.protein || 0), carb: r1(v.carb || 0), fat: r1(v.fat || 0) };
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    meal, at: new Date().toISOString(), title, thumb: o.thumb(), source: 'typed',
    items: [{ label: title, fdcId: null, origin: 'typed', url: null, desc: title, grams: null, n }],
    totals: { ...n },
  };
  const btn = $('q-log');
  btn.disabled = true;
  try {
    await o.onLog(entry);
    o.toast(`Logged ${o.meals[meal].toLowerCase()}: ${fmt(n.kcal)} kcal`);
    close();
    o.done();
  } catch (e) {
    o.toast(o.saveError(e));
  } finally {
    btn.disabled = false;
  }
}
