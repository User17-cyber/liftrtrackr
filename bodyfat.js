// Body fat, under the bodyweight chart. With tape measurements it uses the US Navy circumference
// equations (Hodgdon & Beckett, Naval Health Research Center 1984; typically within 3–4 points of
// underwater weighing) and, as a cross-check, relative fat mass (Woolcott & Bergman, Sci Rep 2018,
// validated against DXA). Without them it falls back to the Deurenberg BMI equation (Br J Nutr 1991),
// which reads high for people carrying a lot of muscle. Measurements are saved with the weigh-ins.
import { CM_PER_IN, LB_PER_KG } from './metabolism.js';
import { normalizeWeights, withTrend } from './weight.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const dateShort = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const LIMITS = { waist: [40, 200], neck: [20, 70], hip: [50, 200] };

// American Council on Exercise ranges, % body fat: [upper bound, name].
const ACE = {
  male: [[6, 'Essential fat', '2–5%'], [14, 'Athletes', '6–13%'], [18, 'Fitness', '14–17%'], [25, 'Average', '18–24%'], [Infinity, 'Obese', '25% and up']],
  female: [[14, 'Essential fat', '10–13%'], [21, 'Athletes', '14–20%'], [25, 'Fitness', '21–24%'], [32, 'Average', '25–31%'], [Infinity, 'Obese', '32% and up']],
};

let ctx;

/* ---------- math ---------- */

const plausible = v => (Number.isFinite(v) && v >= 2 && v <= 70 ? v : null);

// Circumferences and height in cm.
export function navy(sex, heightCm, t) {
  if (!t || !heightCm) return null;
  if (sex === 'male') {
    if (!(t.waist > t.neck)) return null;
    return plausible(495 / (1.0324 - 0.19077 * Math.log10(t.waist - t.neck) + 0.15456 * Math.log10(heightCm)) - 450);
  }
  if (!t.hip || !(t.waist + t.hip > t.neck)) return null;
  return plausible(495 / (1.29579 - 0.35004 * Math.log10(t.waist + t.hip - t.neck) + 0.22100 * Math.log10(heightCm)) - 450);
}

export const relativeFatMass = (sex, heightCm, t) => (t && heightCm ? plausible(64 - 20 * heightCm / t.waist + (sex === 'female' ? 12 : 0)) : null);

export const fromBmi = (sex, age, heightCm, kg) => {
  if (!heightCm || !kg || !age) return null;
  const bmi = kg / (heightCm / 100) ** 2;
  return plausible(1.2 * bmi + 0.23 * age - 10.8 * (sex === 'male' ? 1 : 0) - 5.4);
};

const aceRange = (sex, bf) => (ACE[sex] || []).find(([max]) => bf < max);

/* ---------- units ---------- */

const us = () => ctx.units() === 'us';
const lenU = () => (us() ? 'in' : 'cm');
const toLen = cm => (us() ? cm / CM_PER_IN : cm);
const fromLen = v => (us() ? v * CM_PER_IN : v);
const massFmt = kg => (us() ? `${fmt(kg * LB_PER_KG, 1)} lb` : `${fmt(kg, 1)} kg`);

/* ---------- setup ---------- */

export function initBodyFat(c) {
  ctx = c;
  $('bf-form').addEventListener('submit', onSave);
  $('bf-form').addEventListener('input', () => { $('bf-error').hidden = true; });
  return { render };
}

export function render() {
  if (!ctx) return;
  const store = ctx.store(), p = store?.profile;
  const sex = p?.sex === 'male' || p?.sex === 'female' ? p.sex : null;
  const { entries, tape } = normalizeWeights(store?.weights);
  const kg = entries.length ? withTrend(entries).at(-1).trend : p?.weightKg;
  const last = tape.at(-1), prev = tape.at(-2);

  document.querySelectorAll('.bf-u').forEach(el => { el.textContent = lenU(); });
  for (const k of ['waist', 'neck', 'hip']) {
    const el = $(`bf-${k}`);
    el.step = us() ? '0.25' : '0.5';
    el.placeholder = last?.[k] ? String(Math.round(toLen(last[k]) * 4) / 4) : '';
  }
  $('bf-hip-field').hidden = sex !== 'female';
  $('bf-how').textContent = sex === 'female'
    ? 'Measure relaxed, tape snug but not pressing: waist at its narrowest, hips at their widest, neck just below the voice box.'
    : 'Measure relaxed, tape snug but not pressing: waist around your navel without sucking in, neck just below your Adam’s apple.';

  const hero = $('bf-hero'), rows = $('bf-rows');
  if (!sex || !p?.heightCm || !p?.age) {
    hero.innerHTML = `<p class="empty">Your estimate needs your sex, age and height.</p>
      <button type="button" class="btn btn-tinted btn-sm" data-goto="settings">Add your details</button>`;
    rows.innerHTML = '';
    return;
  }
  const h = p.heightCm;
  const nv = navy(sex, h, last), rfm = relativeFatMass(sex, h, last), bmi = fromBmi(sex, p.age, h, kg);
  const main = nv ?? rfm ?? bmi;
  if (main == null) {
    hero.innerHTML = '<p class="empty">These measurements are outside what the equations cover. Check them and save again.</p>';
    rows.innerHTML = '';
    return;
  }

  const lines = [];
  if (last) {
    // Compared by the same method only (an older set may lack the hip measurement the Navy method needs).
    const was = nv != null ? navy(sex, h, prev) : rfm != null ? relativeFatMass(sex, h, prev) : null, diff = was != null ? main - was : null;
    lines.push(`Measured ${dateShort(last.d)}`);
    if (diff != null) lines.push(`${diff < -0.05 ? '−' : diff > 0.05 ? '+' : '±'}${fmt(Math.abs(diff), 1)} points since ${dateShort(prev.d)}`);
  }
  const how = nv != null ? 'US Navy tape method' : rfm != null ? 'relative fat mass' : 'from your BMI';
  const note = last ? 'Usually within 3–4 points of a lab test.'
    : 'Reads high if you carry a lot of muscle. Add your tape measurements below for a better estimate.';
  hero.innerHTML = `<span class="muted">${last ? 'Estimated body fat' : 'Rough estimate'}</span>
    <div class="big-figure"><b>${fmt(main, 1)}</b><span class="muted">% · ${esc(how)}</span></div>
    ${lines.length ? `<span class="muted">${esc(lines.join(' · '))}</span>` : ''}
    <span class="fine">${esc(note)}</span>`;

  const out = [];
  if (kg) out.push(['Fat mass', massFmt(kg * main / 100), `Lean mass ${massFmt(kg * (1 - main / 100))}`]);
  const ace = aceRange(sex, main);
  if (ace) out.push(['ACE range', ace[1], `${ace[2]} for ${sex === 'male' ? 'men' : 'women'}`]);
  if (nv != null && rfm != null) out.push(['Relative fat mass', `${fmt(rfm, 1)}%`, 'From waist and height']);
  if (last && bmi != null) out.push(['From BMI', `${fmt(bmi, 1)}%`, 'Reads high if you’re muscular']);
  rows.innerHTML = `<dl class="stats">${out.map(([k, v, s]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}${s ? `<small>${esc(s)}</small>` : ''}</dd></div>`).join('')}</dl>`;
}

/* ---------- saving ---------- */

function fail(msg, id) {
  $('bf-error').textContent = msg;
  $('bf-error').hidden = false;
  if (id) $(id).focus();
}

async function onSave(e) {
  e.preventDefault();
  const store = ctx.store();
  if (!store) return ctx.toast(ctx.saveError({ code: 'not_ready' }));
  const female = store.profile?.sex === 'female';
  const t = { d: ctx.today() };
  for (const k of female ? ['waist', 'neck', 'hip'] : ['waist', 'neck']) {
    const raw = $(`bf-${k}`).value.trim(), cm = fromLen(Number(raw));
    const [lo, hi] = LIMITS[k];
    if (raw === '' || !(cm >= lo && cm <= hi)) {
      return fail(`Enter a ${k} measurement between ${fmt(Math.ceil(toLen(lo)))} and ${fmt(Math.floor(toLen(hi)))} ${lenU()}.`, `bf-${k}`);
    }
    t[k] = Math.round(cm * 10) / 10;
  }
  if (t.waist <= t.neck) return fail('Your waist should measure more than your neck. Check both numbers.', 'bf-waist');
  const cur = normalizeWeights(store.weights);
  const tape = cur.tape.filter(x => x.d !== t.d).concat(t).sort((a, b) => a.d.localeCompare(b.d));
  $('bf-save').disabled = true;
  try {
    await store.saveWeights({ ...cur, tape });
    for (const k of ['waist', 'neck', 'hip']) $(`bf-${k}`).value = '';
    document.activeElement?.blur?.();
    render();
    ctx.toast('Measurements saved. Your body fat estimate is updated.');
  } catch (er) { ctx.toast(ctx.saveError(er)); }
  $('bf-save').disabled = false;
}
