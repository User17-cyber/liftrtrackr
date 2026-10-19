// Settings → Your details: the body measurements and activity the energy equations use.
import { ACTIVITY, GOALS, validateProfile, LB_PER_KG, CM_PER_IN } from './metabolism.js';

const $ = id => document.getElementById(id);
const FIELD_FOR = { sex: 'pf-sex-f', age: 'pf-age', height: 'pf-height-cm', weight: 'pf-weight', bodyFat: 'pf-bodyfat', activity: 'pf-activity' };
let ctx, formUnits = 'metric', filled = false;

export function initProfile(c) {
  ctx = c;
  $('pf-activity').innerHTML = ACTIVITY.map(a => `<option value="${a.id}">${a.label} (× ${a.factor})</option>`).join('');
  $('pf-activity').value = 'light';
  $('pf-goal').innerHTML = GOALS.map(g => `<option value="${g.id}">${g.label}</option>`).join('');
  $('pf-activity-hint').textContent = ACTIVITY[1].hint;
  const form = $('profile-form');
  form.addEventListener('change', e => {
    if (e.target.id === 'pf-activity') $('pf-activity-hint').textContent = ACTIVITY.find(a => a.id === e.target.value)?.hint || '';
  });
  form.addEventListener('input', () => { $('pf-error').hidden = true; });
  form.addEventListener('submit', onSubmit);
  applyUnits(ctx.units());
  return { render, onUnits, fill };
}

function readMeasures(units) {
  const v = id => $(id).value.trim();
  if (units === 'us') {
    return {
      cm: v('pf-height-ft') === '' ? null : (Number(v('pf-height-ft')) * 12 + Number(v('pf-height-in') || 0)) * CM_PER_IN,
      kg: v('pf-weight') === '' ? null : Number(v('pf-weight')) / LB_PER_KG,
    };
  }
  return { cm: v('pf-height-cm') === '' ? null : Number(v('pf-height-cm')), kg: v('pf-weight') === '' ? null : Number(v('pf-weight')) };
}

function writeMeasures(units, cm, kg) {
  if (units === 'us') {
    const inches = cm ? cm / CM_PER_IN : null;
    $('pf-height-ft').value = inches ? Math.floor(inches / 12) : '';
    $('pf-height-in').value = inches ? Math.round((inches % 12) * 2) / 2 : '';
    $('pf-weight').value = kg ? Math.round(kg * LB_PER_KG * 10) / 10 : '';
  } else {
    $('pf-height-cm').value = cm ? Math.round(cm * 2) / 2 : '';
    $('pf-weight').value = kg ? Math.round(kg * 10) / 10 : '';
  }
}

function applyUnits(units) {
  formUnits = units;
  $('height-metric').hidden = units === 'us';
  $('height-us').hidden = units !== 'us';
  $('pf-weight-u').textContent = units === 'us' ? 'lb' : 'kg';
}

// The Appearance setting switched kg/lb: convert whatever is in the form.
export function onUnits() {
  const next = ctx.units();
  if (next === formUnits) return;
  const { cm, kg } = readMeasures(formUnits);
  writeMeasures(next, cm, kg);
  applyUnits(next);
}

export function fill(p) {
  if (p.sex) $(p.sex === 'male' ? 'pf-sex-m' : 'pf-sex-f').checked = true;
  $('pf-age').value = p.age ?? '';
  $('pf-bodyfat').value = p.bodyFat ?? '';
  $('pf-activity').value = p.activity || 'light';
  $('pf-goal').value = p.goal || 'maintain';
  $('pf-activity-hint').textContent = ACTIVITY.find(a => a.id === $('pf-activity').value)?.hint || '';
  applyUnits(ctx.units());
  writeMeasures(formUnits, p.heightCm, p.weightKg);
}

// Fills the form once from the saved profile; never while the person is editing it.
export function render() {
  const p = ctx.store()?.profile;
  if (p && !filled && !$('profile-form').contains(document.activeElement)) { fill(p); filled = true; }
  if (formUnits !== ctx.units()) onUnits();
}

async function onSubmit(e) {
  e.preventDefault();
  const { cm, kg } = readMeasures(formUnits);
  const raw = {
    units: formUnits, sex: document.querySelector('input[name="sex"]:checked')?.value || '',
    age: $('pf-age').value.trim(), heightCm: cm ?? '', weightKg: kg ?? '', bodyFat: $('pf-bodyfat').value.trim(),
    activity: $('pf-activity').value, goal: $('pf-goal').value,
  };
  const v = validateProfile(raw);
  if (!v.ok) {
    const [key, msg] = Object.entries(v.errors)[0];
    $('pf-error').textContent = msg; $('pf-error').hidden = false;
    $(key === 'height' && formUnits === 'us' ? 'pf-height-ft' : FIELD_FOR[key])?.focus();
    return;
  }
  if (!ctx.store()) return ctx.toast(ctx.saveError({ code: 'not_ready' }));
  try {
    // Keep what other settings store on the profile (targets, photo-estimate settings, learned portions).
    await ctx.store().saveProfile({ ...(ctx.store().profile || {}), ...v.profile });
    document.activeElement?.blur?.();
    ctx.toast('Details saved. Your calorie target is updated.');
  } catch (err) { ctx.toast(ctx.saveError(err)); }
}
