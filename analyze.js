// Photo → foods. Claude identifies each food and searches the bundled food tables with a page tool;
// the page computes every nutrient value. platform.js decides how Claude is reached: the viewer's own
// Claude plan on claude.ai, or the API key saved on this device in the installed app.
import { getFood, search, getPortions, nutrientsFor, sumNutrients, datasetName } from './usda.js';
import { analyzeMeal, canSearchWeb, kind } from './platform.js';
import { buildPrompt, buildLookupPrompt, searchTool, normalize, customNutrients, sourceInfo, applyStated, statedCalories } from './food-ai.js';
import { initQuickAdd } from './quick-add.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const clampG = g => Math.min(3000, Math.max(1, Math.round(g)));
const stepFor = g => (g < 30 ? 5 : g < 200 ? 10 : 25);
export const MEALS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ICON_CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.5"/></svg>';

const ERRORS = {
  no_key: 'Add your Anthropic API key in Settings to analyze photos. Searching foods works without one.',
  unavailable: 'Photo analysis works when this page is open on claude.ai and you are signed in. You can still search foods.',
  not_granted: 'Claude access was declined for this page, so photo analysis is off. You can still search foods.',
  sampling_disabled: 'Claude is not available on this account, so photo analysis is off. You can still search foods.',
  session_expired: 'Your claude.ai session expired. Sign in again, then retry.',
  image_rejected: 'Claude could not use that image. Try a JPEG or PNG under 20 MB.',
  images_unavailable: 'This view cannot send photos to Claude. Describe the meal instead, or search foods.',
  empty_completion: 'Claude returned nothing. Try again, perhaps with a short description.',
  prompt_too_large: 'That description is too long. Shorten it and try again.',
  bad_key: 'Anthropic rejected your API key. Check it in Settings.',
  no_access: 'Your API key can’t use this model. Check its permissions in the Anthropic Console, or pick another model in Settings.',
  no_model: 'Your Anthropic account doesn’t have access to this model. Pick another one in Settings.',
  rate_limited: kind === 'claude'
    ? 'You’ve reached your Claude usage limit for now, or sent several requests in a row. Limits reset within a few hours; meanwhile you can enter calories and macros yourself or search foods.'
    : 'Anthropic is rate-limiting your key, or its spend limit was reached. Wait a minute, then try again.',
  offline: 'Couldn’t reach Anthropic. Check your connection; you can still search foods.',
  refused: 'Claude declined to analyze this. Try a different photo or description.',
  truncated: 'Claude’s answer was cut off. Try again, or describe fewer foods at once.',
  incomplete: 'Claude didn’t finish matching foods. Try again, or add details in the text box.',
  invalid_json: 'Claude’s answer couldn’t be read. Analyze again to retry.',
  bad_request: 'The request was rejected. Try a different photo, or a JPEG or PNG under 20 MB.',
};
const SETTINGS_CODES = new Set(['no_key', 'bad_key', 'no_access', 'no_model']);

let opts, photo = null, result = null, ctl = null, timer = null, t0 = 0, running = false, mealChoice = 'lunch';

export function defaultMeal(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  return h < 10.5 ? 'breakfast' : h < 15 ? 'lunch' : h < 17 ? 'snack' : h < 22 ? 'dinner' : 'snack';
}

export function initAnalyzer(options) {
  opts = options;
  const input = $('photo-input'), zone = $('dropzone');
  input.addEventListener('change', () => { if (input.files[0]) takePhoto(input.files[0]); input.value = ''; });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag');
    const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/') || /\.(heic|heif)$/i.test(x.name));
    if (f) takePhoto(f); else showError('That file is not an image. Drop a JPEG, PNG or WebP photo.');
  });
  document.addEventListener('paste', e => {
    if (!$('capture').hidden && !e.target.closest?.('input, textarea')) {
      const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); takePhoto(f); }
    }
  });
  $('photo-preview').addEventListener('click', e => { if (e.target.closest('[data-act="clear-photo"]')) clearPhoto(); });
  $('meal-note').addEventListener('input', renderCapture);
  $('describe-btn').addEventListener('click', () => { $('note-wrap').hidden = false; $('meal-note').focus({ preventScroll: true }); renderCapture(); });
  $('analyze-btn').addEventListener('click', analyze);
  $('stop-btn').addEventListener('click', () => ctl?.abort());
  $('manual-btn').addEventListener('click', startManual);
  $('actionbar').addEventListener('click', onBarClick);
  $('actionbar').addEventListener('change', e => { if (e.target.id === 'ab-meal') setMeal(e.target.value); });
  wireResult();
  const quick = initQuickAdd({ ...options, meals: MEALS, defaultMeal, thumb: () => photo?.thumb || null, done: resetIdle });
  $('capture').inert = false;
  renderCapture();
  return {
    refresh() { renderBar(); quick.refresh(); const b = $('r-log'); if (b) b.textContent = `Add to ${opts.dateLabel()}`; },
  };
}

/* ---------- photo intake ---------- */

async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
}

async function takePhoto(file) {
  hideError();
  let src;
  try { src = await decode(file); } catch {
    return showError("This photo couldn't be opened here. iPhone HEIC photos may need converting: share it as a JPEG, or screenshot it and upload that.");
  }
  const w = src.width, h = src.height, scale = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
  const t = document.createElement('canvas'), s = Math.min(w, h);
  t.width = t.height = 112;
  t.getContext('2d').drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 112, 112);
  src.close?.();
  if (!blob) return showError("This photo couldn't be prepared. Try a different file.");
  if (photo?.url) URL.revokeObjectURL(photo.url);
  photo = { blob, url: URL.createObjectURL(blob), thumb: t.toDataURL('image/jpeg', 0.62) };
  if (result?.source === 'manual') { result.thumb = photo.thumb; result.photoUrl = photo.url; renderResult(); }
  renderCapture();
}

function clearPhoto() {
  if (photo?.url) URL.revokeObjectURL(photo.url);
  photo = null;
  renderCapture();
}

function renderCapture() {
  $('dropzone').hidden = !!photo;
  if (photo) $('note-wrap').hidden = false;
  const prev = $('photo-preview');
  prev.hidden = !photo;
  prev.innerHTML = photo ? `<img src="${photo.url}" alt="The meal photo you selected"><button type="button" class="btn btn-plain btn-sm" data-act="clear-photo">${ICON_X}Remove photo</button>` : '';
  const hasNote = $('meal-note').value.trim().length > 0;
  const btn = $('analyze-btn');
  btn.disabled = !photo && !hasNote;
  btn.textContent = photo || !hasNote ? 'Analyze photo' : 'Analyze description';
  renderBar();
}

/* ---------- action bar (phones and tablets) ---------- */

function renderBar() {
  const bar = $('actionbar');
  let html;
  const hasNote = $('meal-note').value.trim().length > 0;
  if (running) {
    html = `<span class="ab-status"><span class="spinner" aria-hidden="true"></span><span>Analyzing <span id="ab-time" class="num muted">${$('progress-time').textContent}</span></span></span><button type="button" class="btn btn-plain btn-sm" data-ab="stop">Stop</button>`;
  } else if (result) {
    const kcal = sumNutrients(result.items.map(itemNutrients)).kcal;
    html = `<label class="visually-hidden" for="ab-meal">Meal</label><select id="ab-meal">${mealOptions()}</select>
      <button type="button" class="btn btn-primary ab-main" data-ab="log" ${result.items.length ? '' : 'disabled'}>Add to ${esc(opts.dateLabel(true))} · ${fmt(kcal)} kcal</button>`;
  } else if (photo || hasNote) {
    html = `<button type="button" class="btn btn-primary ab-main" data-ab="analyze">${ICON_CAMERA}${photo ? 'Analyze photo' : 'Analyze description'}</button>`;
  } else {
    html = '';
  }
  bar.hidden = !html;
  const key = running ? 'run' : html.replace(/ id="ab-time"[^<]*<\/span>/, '');
  if (bar.dataset.key === key) return;
  bar.dataset.key = key;
  bar.innerHTML = html ? `<div class="ab-inner">${html}</div>` : '';
}

async function onBarClick(e) {
  const b = e.target.closest('[data-ab]');
  if (!b) return;
  if (b.dataset.ab === 'analyze') analyze();
  else if (b.dataset.ab === 'stop') ctl?.abort();
  else if (b.dataset.ab === 'log') await logResult(b);
}

const mealOptions = () => Object.entries(MEALS).map(([k, v]) => `<option value="${k}" ${k === mealChoice ? 'selected' : ''}>${v}</option>`).join('');
function setMeal(v) {
  mealChoice = MEALS[v] ? v : mealChoice;
  for (const id of ['r-meal', 'ab-meal']) { const s = $(id); if (s) s.value = mealChoice; }
}

/* ---------- Claude ---------- */

async function analyze() {
  const note = $('meal-note').value.trim().slice(0, 600);
  if ((!photo && !note) || running) return;
  hideError();
  ctl = new AbortController();
  startProgress(photo ? 'Claude is looking at your plate' : 'Claude is reading your description');
  try {
    const { reply, usd, webUnavailable } = await analyzeMeal({
      buildPrompt: caps => buildPrompt(note, !!photo, caps), imageBlob: photo?.blob || null,
      search: searchTool(addStep), signal: ctl.signal, onStep: addStep,
    });
    const r = normalize(reply);
    // Safety net: one calorie figure in the description and one food means that food has those calories.
    const fromNote = statedCalories(note);
    if (fromNote != null && r.items.length === 1 && r.items[0].custom?.origin !== 'stated') r.items[0] = applyStated(r.items[0], { kcal: fromNote });
    if (!r.items.length) {
      showError(`Claude didn't find food or drink to log.${r.notes ? ' ' + r.notes : ''} Try another photo, or add details in the text box.`);
      return;
    }
    mealChoice = defaultMeal();
    result = { ...r, usd, webUnavailable, source: photo ? 'photo' : 'text', thumb: photo?.thumb || null, photoUrl: photo?.url || null };
    renderResult(true);
  } catch (e) {
    if (e?.code !== 'cancelled') showError(ERRORS[e?.code] || `Something went wrong reaching Claude${e?.message ? ` (${e.message})` : ''}. Try again in a moment.`, SETTINGS_CODES.has(e?.code));
  } finally {
    stopProgress();
  }
}

function startProgress(title) {
  running = true;
  $('progress').hidden = false;
  $('progress-steps').innerHTML = '';
  $('capture').inert = true;
  setTitle(title);
  addStep(photo ? 'Sent the photo to Claude' : 'Sent the description to Claude');
  t0 = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - t0) / 1000), txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    $('progress-time').textContent = txt;
    const ab = $('ab-time'); if (ab) ab.textContent = txt;
  };
  tick();
  timer = setInterval(tick, 1000);
  renderBar();
}
function stopProgress() { running = false; clearInterval(timer); $('progress').hidden = true; $('capture').inert = false; renderBar(); }
function setTitle(t) { $('progress-title').textContent = t; }
function addStep(t) { const li = document.createElement('li'); li.textContent = t; $('progress-steps').append(li); }
function showError(msg, settingsLink = false) {
  $('analyze-error-text').textContent = msg;
  $('analyze-error-link').hidden = !settingsLink;
  $('analyze-error').hidden = false;
}
function hideError() { $('analyze-error').hidden = true; }

/* ---------- result editor ---------- */

function startManual() {
  hideError();
  mealChoice = defaultMeal();
  result = { title: '', items: [], notes: '', source: 'manual', thumb: photo?.thumb || null, photoUrl: photo?.url || null };
  renderResult(true);
  openFinder($('r-add-finder'), '');
}

// Back to the empty capture state after logging or discarding.
function resetIdle() {
  result = null;
  clearPhoto();
  $('meal-note').value = '';
  $('note-wrap').hidden = true;
  renderCapture();
  renderResult();
}

function itemNutrients(it) { return it.custom ? customNutrients(it.custom, it.grams) : nutrientsFor(getFood(it.fdcId), it.grams); }
const itemPortions = it => (it.custom ? [it.custom.serving] : getPortions(it.fdcId));

function itemHtml(it, i) {
  const n = itemNutrients(it), src = sourceInfo(it);
  const portions = itemPortions(it);
  const conf = it.confidence ? `<span class="conf conf-${it.confidence}">${{ high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence, check the grams' }[it.confidence]}</span>` : '';
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
    <div class="item-meta"><label class="item-kcal"><input type="number" class="kcal-in" inputmode="numeric" min="0" step="1" value="${Math.round(n.kcal)}" aria-label="Calories for ${esc(it.label)}">kcal</label>${conf}<span class="macros-line">${macroLine(n)}</span>${it.basis ? `<span>${esc(it.basis)}</span>` : ''}</div>
  </div>`;
}
const macroLine = n => `Protein ${fmt(n.protein)} g · Carbs ${fmt(n.carb)} g · Fat ${fmt(n.fat)} g`;

// Meal totals: calories, the energy split between macronutrients, and the minor nutrients.
function totalsHtml() {
  const t = sumNutrients(result.items.map(itemNutrients));
  const grams = result.items.reduce((a, i) => a + i.grams, 0);
  const energy = { protein: t.protein * 4, carb: t.carb * 4, fat: t.fat * 9 };
  const eSum = energy.protein + energy.carb + energy.fat;
  const pct = k => (eSum ? Math.round((energy[k] / eSum) * 100) : 0);
  const g = v => (v > 0 && v < 1 ? '<1 g' : `${fmt(v)} g`);
  const n = result.items.length;
  const macros = [['protein', 'P', 'Protein'], ['carb', 'C', 'Carbohydrate'], ['fat', 'F', 'Fat']];
  return `<section class="totals" aria-label="Meal total">
    <div class="tot-head"><span>Meal total</span><span class="muted">${n} food${n === 1 ? '' : 's'} · ${fmt(grams)} g</span></div>
    <div class="tot-kcal"><b>${fmt(t.kcal)}</b> kcal</div>
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

function renderResult(reveal = false) {
  const el = $('result');
  $('capture').hidden = !!result;
  el.className = `result${reveal ? ' reveal' : ''}`;
  if (!result) { el.innerHTML = ''; renderBar(); return; }
  el.innerHTML = `<div class="result-grid">
      <div class="result-main">
        ${result.photoUrl ? `<img class="result-photo" src="${result.photoUrl}" alt="Your meal photo">` : ''}
        <div><label class="field-label" for="r-title">Meal name</label>
          <input type="text" id="r-title" class="title-input" value="${esc(result.title)}" maxlength="80" placeholder="Salmon, rice and greens"></div>
        <div class="items" id="r-items">${renderItems()}</div>
        <button type="button" class="btn btn-tinted btn-sm add-food" id="r-add">+ Add a food</button>
        <div id="r-add-finder"></div>
        ${result.notes || result.usd ? `<p class="ai-notes">${esc(result.notes)}${result.webUnavailable ? ' Web search is turned off for your Anthropic organization, so brand-name foods came from labels or the food databases.' : ''}${result.usd ? ` Analysis cost about ${result.usd < 0.01 ? 'under 1¢' : `${Math.round(result.usd * 100)}¢`} on your Anthropic account.` : ''}</p>` : ''}
      </div>
      <div id="r-totals">${totalsHtml()}</div>
      <div class="result-actions">
        <label class="visually-hidden" for="r-meal">Meal</label>
        <select id="r-meal" class="flow-primary">${mealOptions()}</select>
        <button type="button" class="btn btn-primary flow-primary" id="r-log">Add to ${esc(opts.dateLabel())}</button>
        <button type="button" class="btn btn-plain" id="r-discard">Discard</button>
      </div>
    </div>`;
  renderBar();
  if (reveal) el.scrollIntoView({ block: 'nearest' });
}

function renderItems() {
  return result.items.length
    ? result.items.map(itemHtml).join('')
    : '<p class="empty">No foods yet. Search below to add one.</p>';
}

function refreshItems() {
  $('r-items').innerHTML = renderItems();
  $('r-totals').innerHTML = totalsHtml();
  renderBar();
}

function refreshRow(row) {
  const it = result.items[Number(row.dataset.i)], n = itemNutrients(it);
  row.querySelector('.grams').value = it.grams;
  const kIn = row.querySelector('.kcal-in');
  if (document.activeElement !== kIn) kIn.value = Math.round(n.kcal);
  row.querySelector('.macros-line').textContent = macroLine(n);
  $('r-totals').innerHTML = totalsHtml();
  renderBar();
}

function finderList(q) {
  if (!q.trim()) return '<li><span class="muted">Type a food or a brand, such as “grilled salmon” or “Chobani vanilla yogurt”.</span></li>';
  const hits = search(q, 12);
  // Brand names and restaurant items are rarely in the food tables: offer a lookup either way.
  const lookup = `<li><button type="button" class="lookup-btn" data-lookup="1"><span>${canSearchWeb() ? 'Look up' : 'Ask Claude for'} “${esc(q.trim().slice(0, 60))}”${canSearchWeb() ? ' online' : ''}</span><span class="k">${canSearchWeb() ? 'web' : kind === 'claude' ? 'unverified' : 'no web'}</span></button></li>`;
  const rows = hits.map(f => `<li><button type="button" data-fdc="${esc(f.id)}"><span>${esc(f.desc)} <span class="src">${esc(datasetName(f))}</span></span><span class="k">${fmt(f.per100.kcal)} kcal/100 g</span></button></li>`).join('');
  return hits.length ? rows + lookup : `<li><span class="muted">No matches in the food databases.</span></li>${lookup}`;
}

// A food the person typed that the tables may not carry: ask Claude (with USDA Branded Foods and web
// search in the installed app).
async function lookupFood(btn, row) {
  const q = btn.closest('.finder').querySelector('.finder-q').value.trim().slice(0, 120);
  const li = btn.closest('li');
  if (!q || !li) return;
  li.innerHTML = `<span class="lookup-wait"><span class="spinner" aria-hidden="true"></span>${canSearchWeb() ? 'Searching the web…' : 'Asking Claude…'}</span>`;
  try {
    const { reply } = await analyzeMeal({ buildPrompt: caps => buildLookupPrompt(q, caps), imageBlob: null, search: searchTool(), signal: new AbortController().signal });
    let item = normalize({ title: q, items: Array.isArray(reply?.items) ? reply.items.slice(0, 1) : [] }).items[0];
    const fromQuery = statedCalories(q);
    if (item && fromQuery != null && item.custom?.origin !== 'stated') item = applyStated(item, { kcal: fromQuery });
    if (!item) throw { code: 'not_found' };
    if (row) {
      const cur = result.items[row.dataset.i];
      result.items[row.dataset.i] = { ...item, label: cur.label || item.label, grams: cur.grams };
    } else {
      result.items.push(item);
      $('r-add-finder').innerHTML = '';
    }
    refreshItems();
  } catch (e) {
    if (!li.isConnected) return;
    li.innerHTML = `<span class="muted">${esc(e?.code === 'not_found' ? 'Couldn’t find reliable nutrition facts for that. Try the exact product name, or pick a database match.' : ERRORS[e?.code] || 'The lookup failed. Try again.')}</span>`;
  }
}

function openFinder(slot, q) {
  if (!slot) return;
  slot.innerHTML = `<div class="finder"><input type="search" class="finder-q" value="${esc(q)}" placeholder="Search foods" aria-label="Search foods" enterkeyhint="search"><ul class="finder-list">${finderList(q)}</ul></div>`;
  slot.querySelector('.finder-q').focus({ preventScroll: true });
}

function wireResult() {
  const el = $('result');
  el.addEventListener('input', e => {
    const t = e.target, row = t.closest('.item');
    if (t.id === 'r-title') result.title = t.value;
    else if (t.classList.contains('item-name')) result.items[row.dataset.i].label = t.value;
    else if (t.classList.contains('grams')) {
      const g = Number(t.value);
      if (g > 0) {
        result.items[row.dataset.i].grams = clampG(g);
        const n = itemNutrients(result.items[row.dataset.i]);
        row.querySelector('.kcal-in').value = Math.round(n.kcal);
        row.querySelector('.macros-line').textContent = macroLine(n);
        $('r-totals').innerHTML = totalsHtml();
        renderBar();
      }
    } else if (t.classList.contains('finder-q')) t.closest('.finder').querySelector('.finder-list').innerHTML = finderList(t.value);
  });
  el.addEventListener('change', e => {
    const t = e.target, row = t.closest('.item');
    if (t.id === 'r-meal') setMeal(t.value);
    else if (t.classList.contains('kcal-in')) {
      // Typed calories win: the food keeps its proportions, scaled to the stated number.
      const v = Number(t.value);
      if (t.value !== '' && v >= 0 && v <= 20000) { result.items[row.dataset.i] = applyStated(result.items[row.dataset.i], { kcal: v }); refreshItems(); }
      else t.value = Math.round(itemNutrients(result.items[row.dataset.i]).kcal);
    }
    else if (t.classList.contains('portion') && t.value) {
      result.items[row.dataset.i].grams = clampG(Number(t.value));
      t.value = '';
      refreshRow(row);
    } else if (t.classList.contains('grams')) t.value = result.items[row.dataset.i].grams;
  });
  el.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    const row = t.closest('.item');
    if (t.classList.contains('step')) {
      const it = result.items[row.dataset.i], d = Number(t.dataset.dir);
      const s = stepFor(d > 0 ? it.grams : it.grams - 1);
      it.grams = clampG(d > 0 ? Math.floor(it.grams / s) * s + s : Math.ceil(it.grams / s) * s - s);
      refreshRow(row);
    } else if (t.classList.contains('remove-btn')) { result.items.splice(Number(row.dataset.i), 1); refreshItems(); }
    else if (t.classList.contains('change')) {
      const open = row.querySelector('.finder-slot');
      if (open) open.remove(); else { row.insertAdjacentHTML('beforeend', '<div class="finder-slot"></div>'); openFinder(row.lastElementChild, result.items[row.dataset.i].label); }
    } else if (t.id === 'r-add') {
      const slot = $('r-add-finder');
      if (slot.firstChild) slot.innerHTML = ''; else openFinder(slot, '');
    } else if (t.dataset.lookup) {
      await lookupFood(t, row);
    } else if (t.dataset.fdc) {
      const food = getFood(t.dataset.fdc);
      if (row) {
        result.items[row.dataset.i] = { ...result.items[row.dataset.i], fdcId: food.id, custom: null, confidence: null, basis: '' };
      } else {
        const p = getPortions(food.id).find(x => x.label.startsWith('typical')) || getPortions(food.id)[0];
        result.items.push({ label: food.desc.slice(0, 80), fdcId: food.id, grams: clampG(p?.g || 100), basis: p ? `Started at ${p.label.startsWith('typical') ? 'the typical serving' : `the portion ${p.label}`}` : 'Started at 100 g', confidence: null });
        $('r-add-finder').innerHTML = '';
      }
      refreshItems();
    } else if (t.id === 'r-discard') {
      resetIdle();
    } else if (t.id === 'r-log') {
      await logResult(t);
    }
  });
}

const roundN = n => Object.fromEntries(Object.entries(n).map(([k, v]) => [k, k === 'kcal' || k === 'sodium' ? Math.round(v) : Math.round(v * 10) / 10]));

async function logResult(btn) {
  if (!result?.items.length) return opts.toast('Add at least one food before logging.');
  const items = result.items.map(it => {
    if (it.custom) {
      const c = it.custom, desc = `${c.brand ? `${c.brand} ` : ''}${it.label}`.trim().slice(0, 120);
      return { label: (it.label || desc).trim().slice(0, 80), fdcId: null, origin: c.origin, url: c.url, desc, grams: it.grams, n: roundN(customNutrients(c, it.grams)) };
    }
    const f = getFood(it.fdcId);
    return { label: (it.label || f.desc).trim().slice(0, 80), fdcId: f.id, origin: 'database', desc: f.desc, src: f.src, grams: it.grams, n: roundN(nutrientsFor(f, it.grams)) };
  });
  const totals = roundN(sumNutrients(items.map(i => i.n)));
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    meal: mealChoice, at: new Date().toISOString(),
    title: (result.title || items.slice(0, 3).map(i => i.label).join(', ')).trim().slice(0, 80),
    thumb: result.thumb || null, source: result.source, items, totals,
  };
  btn.disabled = true;
  try {
    await opts.onLog(entry);
    opts.toast(`Logged ${MEALS[entry.meal].toLowerCase()}: ${fmt(totals.kcal)} kcal`);
    resetIdle();
  } catch (e) {
    opts.toast(opts.saveError(e));
    btn.disabled = false;
  }
}
