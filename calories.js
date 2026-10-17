// Calories tab: the day's ring and macros, the meal list, the 14-day chart and the maintenance card.
import { foodUrl, foodRef } from './usda.js';
import { AMDR, macroRanges } from './metabolism.js';
import { targetsFor } from './targets.js';
import { MEALS } from './analyze.js';
import { findFavorite, saveFavorite, removeFavorite } from './favorites.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r10 = n => Math.round(n / 10) * 10;
const MEAL_ORDER = { breakfast: 0, lunch: 1, snack: 2, dinner: 3 };
const MACROS = [['protein', 'P', 'Protein'], ['carb', 'C', 'Carbs'], ['fat', 'F', 'Fat']];
const STAR = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
const CHEVRON = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const dateLong = s => parseISO(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

let ctx, openMeal = null, confirmDelete = null;

export function dayDoc(store, date) {
  const d = store?.days?.[date];
  return d && Array.isArray(d.entries) ? d : { date, entries: [] };
}
export function dayTotals(day) {
  const t = { kcal: 0, protein: 0, carb: 0, fat: 0 };
  for (const e of day.entries) for (const k in t) t[k] += num(e.totals?.[k]);
  return t;
}

export function initCalories(c) {
  ctx = c;
  $('meal-list').addEventListener('click', onMealClick);
  const chart = $('history-chart');
  const act = e => {
    const r = e.target.closest?.('[data-date]');
    if (!r || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    ctx.setDate(r.dataset.date);
  };
  chart.addEventListener('click', act);
  chart.addEventListener('keydown', act);
  let lastW = 0;
  new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w && w !== lastW) { lastW = w; renderHistory(); } }).observe(chart);
  return { render };
}

export function render() {
  renderSummary();
  renderMeals();
  renderHistory();
  renderTdee();
}

/* ---------- today ---------- */

function renderSummary() {
  const date = ctx.date(), today = date === ctx.today();
  const t = dayTotals(dayDoc(ctx.store(), date));
  const tg = targetsFor(ctx.store(), ctx.units()), est = tg.est;
  const target = tg.kcal, maint = est ? r10(est.maintenance) : null;
  const R = 56, C = 2 * Math.PI * R;
  const frac = target ? Math.min(1, t.kcal / target) : t.kcal > 0 ? 1 : 0;
  const left = target ? target - t.kcal : null;
  const center = target
    ? `<b>${fmt(Math.abs(left))}</b><span>${left >= 0 ? 'kcal left' : 'kcal over'}</span>`
    : `<b>${fmt(t.kcal)}</b><span>kcal eaten</span>`;
  const kv = [['Eaten', `${fmt(t.kcal)}`]];
  if (target) kv.push([tg.source === 'estimate' ? 'Target' : 'Your target', fmt(target)]);
  if (maint && maint !== target) kv.push(['Maintenance', fmt(maint)]);
  const ref = target || 2000, ranges = macroRanges(ref);
  const macros = MACROS.map(([k, key, label]) => {
    const g = t[k], r = ranges[k], a = AMDR[k], goal = tg.macros[k];
    const share = t.kcal ? Math.round((g * a.kcalPerG / t.kcal) * 100) : 0;
    // Your own goal shows as a mark on the bar; otherwise the recommended range is shaded.
    const scale = goal != null ? Math.max(goal * 1.15, g * 1.05, 1) : Math.max(r.max * 1.1, g * 1.05);
    const mark = goal != null
      ? `<div class="goal" style="left:${(goal / scale) * 100}%"></div>`
      : `<div class="band" style="left:${(r.min / scale) * 100}%;width:${((r.max - r.min) / scale) * 100}%;background:var(--${k})"></div>`;
    const note = goal != null
      ? `Goal ${fmt(goal)} g${g < goal ? ` · ${fmt(goal - g)} g to go` : g > goal ? ` · ${fmt(g - goal)} g over` : ' · reached'}`
      : `Recommended ${fmt(r.min)}–${fmt(r.max)} g${k === 'protein' && est ? `, at least ${fmt(est.proteinRda)} g` : ''}`;
    return `<div class="macro">
      <span class="mkey" style="background:var(--${k})" aria-hidden="true">${key}</span>
      <span class="mname">${label}</span>
      <span class="mval">${fmt(g)} g <small>${share}%</small></span>
      <div class="mbar" role="img" aria-label="${label}: ${fmt(g)} g eaten, ${goal != null ? `goal ${fmt(goal)} g` : `recommended ${fmt(r.min)} to ${fmt(r.max)} g`}">
        ${mark}
        <div class="fill" style="transform:scaleX(${Math.min(1, g / scale)});background:var(--${k})"></div>
      </div>
      <span class="mrange">${note}</span>
    </div>`;
  }).join('');
  $('summary').innerHTML = `<h2 class="visually-hidden">${today ? 'Today' : esc(dateLong(date))}</h2>
    <div class="ring-row">
      <div class="ring" role="img" aria-label="${fmt(t.kcal)} kcal eaten${target ? ` of ${fmt(target)}` : ''}">
        <svg viewBox="0 0 132 132" aria-hidden="true"><circle class="track" cx="66" cy="66" r="${R}"/><circle class="prog" cx="66" cy="66" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>
        <div class="ring-center">${center}</div>
      </div>
      <dl class="kv">${kv.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
        ${target ? '' : '<div><dt><button type="button" class="link-btn" data-goto="settings" data-anchor="targets">Set a target</button></dt><dd></dd></div>'}</dl>
    </div>
    <div class="macros">${macros}</div>`;
}

/* ---------- meals ---------- */

// Where a logged food's numbers came from: a USDA entry, a cited web page, a package label or Claude.
function sourceLink(it) {
  // Logged before more databases were added, entries carry a USDA id and src 0 or 1.
  if (it.fdcId) { const f = { id: it.fdcId, src: it.src ?? 0 }; return `<a href="${esc(foodUrl(f))}" target="_blank" rel="noopener" title="${esc(it.desc)}">${esc(foodRef(f))}</a>`; }
  let url = null;
  try { const u = new URL(String(it.url || '')); if (u.protocol === 'https:' || u.protocol === 'http:') url = u; } catch { /* no link */ }
  if (it.origin === 'typed') return 'entered by you';
  if (it.origin === 'favorite') return 'saved favorite';
  if (it.origin === 'stated') return `your numbers${url ? ` · <a href="${esc(url.href)}" target="_blank" rel="noopener">reference</a>` : ''}`;
  if (url) return `<a href="${esc(url.href)}" target="_blank" rel="noopener" title="${esc(it.desc)}">${esc(url.hostname.replace(/^www\./, ''))}</a>`;
  return it.origin === 'label' ? 'package label' : 'Claude, unverified';
}

function mealHtml(e) {
  const thumb = typeof e.thumb === 'string' && e.thumb.startsWith('data:image/jpeg;base64,')
    ? `<img class="meal-thumb" src="${e.thumb}" alt="">`
    : `<span class="meal-thumb" aria-hidden="true">${esc((MEALS[e.meal] || 'M')[0])}</span>`;
  const time = e.at ? new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  const items = Array.isArray(e.items) ? e.items : [];
  const open = openMeal === e.id, confirming = confirmDelete === e.id;
  const id = `md-${esc(e.id)}`;
  return `<article class="meal" data-id="${esc(e.id)}">
    <button type="button" class="meal-row" data-act="toggle" aria-expanded="${open}" aria-controls="${id}">
      ${thumb}
      <span><span class="meal-title">${esc(e.title)}</span><span class="meal-sub">${esc(MEALS[e.meal] || 'Meal')}${time ? ` · ${esc(time)}` : ''}</span></span>
      <span class="meal-kcal"><b>${fmt(e.totals?.kcal)}</b>kcal</span>
      ${CHEVRON}
    </button>
    <div class="meal-detail" id="${id}" ${open ? '' : 'hidden'}>
      ${items.map((it, i) => {
        const fav = !!findFavorite(ctx.store(), it.label);
        return `<div class="md-row"><span>${esc(it.label)}${it.servings > 0 && it.servings !== 1 ? ` × ${Number(it.servings).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''} <span class="muted">· ${it.grams > 0 ? `${fmt(it.grams)}&nbsp;g · ` : ''}${sourceLink(it)}</span></span>
          <span class="md-end"><span class="num nowrap">${fmt(it.n?.kcal)} kcal</span><button type="button" class="fav-btn" data-act="fav" data-i="${i}" aria-pressed="${fav}" aria-label="${esc(`${fav ? 'Remove' : 'Save'} ${it.label} ${fav ? 'from' : 'to'} favorites`)}">${STAR}</button></span></div>`;
      }).join('')}
      <div class="md-macros">Protein ${fmt(e.totals?.protein)} g · Carbs ${fmt(e.totals?.carb)} g · Fat ${fmt(e.totals?.fat)} g</div>
      <div class="meal-tools">${confirming
        ? '<span>Delete this meal?</span><button type="button" class="link-btn danger" data-act="delete-yes">Delete</button><button type="button" class="link-btn" data-act="delete-no">Keep it</button>'
        : '<button type="button" class="link-btn danger" data-act="delete">Delete meal</button>'}</div>
    </div>
  </article>`;
}

function renderMeals() {
  const date = ctx.date(), today = date === ctx.today();
  const entries = [...dayDoc(ctx.store(), date).entries].sort((a, b) => (MEAL_ORDER[a.meal] ?? 9) - (MEAL_ORDER[b.meal] ?? 9) || String(a.at).localeCompare(String(b.at)));
  $('meals-h').textContent = today ? 'Today’s meals' : `Meals, ${dateLong(date)}`;
  $('meals-count').textContent = entries.length ? `${entries.length} logged` : '';
  // A redraw (say, after a star syncs) keeps focus on the same control.
  const a = document.activeElement, mealId = a?.closest?.('#meal-list .meal')?.dataset.id;
  const again = mealId && a.dataset.act ? `.meal[data-id="${CSS.escape(mealId)}"] [data-act="${a.dataset.act}"]${a.dataset.i ? `[data-i="${a.dataset.i}"]` : ''}` : null;
  $('meal-list').innerHTML = !ctx.store() ? '<p class="fine">Opening your log…</p>'
    : entries.length ? entries.map(mealHtml).join('')
    : `<p class="empty">Nothing logged ${today ? 'yet today' : 'on this day'}. Meals you add appear here; tap one to see its foods.</p>`;
  if (again) document.querySelector(again)?.focus({ preventScroll: true });
}

async function onMealClick(ev) {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.meal').dataset.id, act = btn.dataset.act, date = ctx.date();
  if (act === 'toggle') { openMeal = openMeal === id ? null : id; confirmDelete = null; }
  if (act === 'delete') confirmDelete = id;
  if (act === 'delete-no') confirmDelete = null;
  if (act === 'fav') await toggleFavorite(dayDoc(ctx.store(), date).entries.find(e => e.id === id)?.items?.[Number(btn.dataset.i)]);
  if (act === 'delete-yes') {
    confirmDelete = null; openMeal = null;
    const day = dayDoc(ctx.store(), date);
    try {
      await ctx.store().saveDay(date, { date, entries: day.entries.filter(e => e.id !== id) });
      ctx.toast('Meal deleted');
    } catch (e) { ctx.toast(ctx.saveError(e)); }
  }
  renderMeals();
  renderSummary();
  const again = act === 'fav' ? `fav"][data-i="${btn.dataset.i}` : act === 'delete' ? 'delete-no' : act === 'toggle' ? 'toggle' : 'delete';
  if (act !== 'delete-yes') document.querySelector(`.meal[data-id="${CSS.escape(id)}"] [data-act="${again}"]`)?.focus({ preventScroll: true });
}

// A star on a logged food saves what was eaten (one serving's worth) as a favorite, or removes it.
async function toggleFavorite(it) {
  if (!it?.label) return;
  const store = ctx.store(), fav = findFavorite(store, it.label), s = it.servings > 0 ? it.servings : 1;
  try {
    if (fav) { await removeFavorite(store, fav.id); ctx.toast(`Removed “${fav.label}” from favorites`); }
    else {
      const n = it.n || {};
      await saveFavorite(store, { label: it.label, n: { kcal: num(n.kcal) / s, protein: num(n.protein) / s, carb: num(n.carb) / s, fat: num(n.fat) / s }, grams: num(it.grams) / s });
      ctx.toast(`Saved “${it.label}” to favorites`);
    }
  } catch (e) { ctx.toast(ctx.saveError(e)); }
}

/* ---------- 14 days ---------- */

function renderHistory() {
  const el = $('history-chart');
  if (!el || el.closest('[hidden]')) return;
  const W = Math.max(280, Math.round(el.clientWidth || 600)), H = 170;
  const pad = { l: 34, r: 4, t: 14, b: 36 };
  const days = Array.from({ length: 14 }, (_, i) => addDays(ctx.today(), i - 13));
  const vals = days.map(d => dayTotals(dayDoc(ctx.store(), d)).kcal);
  const target = targetsFor(ctx.store(), ctx.units()).kcal;
  const top = Math.max(target || 0, ...vals, 1000);
  const step = top > 4000 ? 1000 : 500;
  const max = Math.ceil((top * 1.08) / step) * step;
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const slot = (W - pad.l - pad.r) / 14, bw = Math.min(22, slot * 0.58);
  let svg = '';
  for (let v = 0; v <= max; v += step) svg += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? `${v / 1000}k` : v}</text>`;
  days.forEach((d, i) => {
    const x = pad.l + slot * i + (slot - bw) / 2, v = vals[i], dt = parseISO(d), sel = d === ctx.date();
    const label = `${dateLong(d)}: ${v ? `${fmt(v)} kcal` : 'nothing logged'}`;
    svg += `<rect class="hit" x="${pad.l + slot * i}" y="${pad.t}" width="${slot}" height="${H - pad.t}" data-date="${d}" tabindex="0" role="button" aria-label="${esc(label)}"><title>${esc(label)}</title></rect>`;
    svg += v ? `<rect class="bar${sel ? ' sel' : ''}" x="${x}" y="${y(v)}" width="${bw}" height="${y(0) - y(v)}" rx="4" pointer-events="none"/>`
      : `<rect class="bar empty" x="${x}" y="${y(0) - 3}" width="${bw}" height="3" rx="1.5" pointer-events="none"/>`;
    const tc = sel ? ' class="sel"' : '';
    svg += `<text${tc} x="${x + bw / 2}" y="${H - pad.b + 16}" text-anchor="middle" pointer-events="none">${dt.toLocaleDateString(undefined, { weekday: 'narrow' })}</text><text${tc} x="${x + bw / 2}" y="${H - pad.b + 31}" text-anchor="middle" pointer-events="none">${dt.getDate()}</text>`;
  });
  if (target) svg += `<line class="target" x1="${pad.l}" x2="${W - pad.r}" y1="${y(target)}" y2="${y(target)}" pointer-events="none"/><text x="${W - pad.r}" y="${y(target) - 6}" text-anchor="end" pointer-events="none">target ${fmt(target)}</text>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="Calories per day for the last 14 days">${svg}</svg>`;
}

/* ---------- maintenance ---------- */

function renderTdee() {
  const out = $('tdee-out');
  const tg = targetsFor(ctx.store(), ctx.units()), est = tg.est;
  if (!est) {
    out.innerHTML = `<p class="empty">Add your age, height, weight and activity in Settings to estimate the calories you burn.</p>
      <button type="button" class="btn btn-tinted btn-sm" style="margin-top:12px" data-goto="settings">Add your details</button>`;
    return;
  }
  const m = ctx.measured();
  const rows = est.equations.map(e => `<tr class="${e.primary ? 'primary' : ''}"><td>${e.name}${e.primary ? ' (used)' : ''}</td><td>${fmt(r10(e.bmr))}</td><td>${fmt(r10(e.tdee))}</td></tr>`).join('');
  const target = r10(est.target), maint = r10(est.maintenance);
  const goal = est.goal.label.charAt(0).toLowerCase() + est.goal.label.slice(1);
  out.innerHTML = `<div class="tdee">
    <div class="big-figure"><b>${fmt(maint)}</b><span class="muted">kcal a day, estimated</span></div>
    <p class="fine">The equations range from ${fmt(r10(est.low))} to ${fmt(r10(est.high))} kcal. Any one person can differ by about 10%.</p>
    ${m?.status === 'ok' ? `<div class="pill-box">Measured from your meals and weigh-ins: <b>${fmt(r10(m.kcal))} kcal</b> over ${m.span} days.</div>` : ''}
    <div class="pill-box">${tg.source !== 'estimate' ? `Your own target: <b>${fmt(tg.kcal)} kcal</b>, ${fmt(Math.abs(tg.kcal - maint))} ${tg.kcal >= maint ? 'above' : 'below'} estimated maintenance. <button type="button" class="link-btn" data-goto="settings" data-anchor="targets">Change</button>`
      : est.goal.delta === 0 ? `Daily target: <b>${fmt(target)} kcal</b>, the same as maintenance.`
      : `Target to ${esc(goal)}: <b>${fmt(target)} kcal</b>.${est.floored ? ' Held at the usual minimum for unsupervised dieting.' : ''}`}</div>
    <details class="disclose">
      <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>How this is calculated</summary>
      <table class="eq-table"><thead><tr><th>Equation</th><th>Resting</th><th>× ${est.factor}</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="fine">Resting energy times your activity factor (${esc(est.activity.label.toLowerCase())}). Log meals and weigh-ins for two weeks and the Weight tab measures your real maintenance.</p>
    </details>
  </div>`;
}
