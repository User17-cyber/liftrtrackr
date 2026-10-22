// Photo → foods. Claude identifies each food and searches the bundled food tables with a page tool;
// the page computes every nutrient value. platform.js decides how Claude is reached: the viewer's own
// Claude plan on claude.ai, or the API key saved on this device in the installed app.
import { getFood, search, getPortions, nutrientsFor, sumNutrients, datasetName } from './usda.js';
import { itemNutrients, itemHtml, macroLine, totalsHtml, addonsHtml, warningsHtml } from './meal-view.js';
import { promptContext, personalContext, accuracyPrefs, applyCalibration, recordCorrections, mergeEstimates } from './accuracy.js';
import { analyzeMeal, canSearchWeb, kind } from './platform.js';
import { buildPrompt, buildLookupPrompt, buildRefinePrompt, searchTool, normalize, customNutrients, applyStated, statedCalories } from './food-ai.js';
import { describeMeal, mergeRefined } from './refine.js';
import { initQuickAdd } from './quick-add.js';
import { initPhotos, getPhotos, clearPhotos, renderPhotos } from './photos.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const clampG = g => Math.min(3000, Math.max(1, Math.round(g)));
const stepFor = g => (g < 30 ? 5 : g < 200 ? 10 : 25);
export const MEALS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
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

let opts, result = null, ctl = null, timer = null, t0 = 0, running = false, mealChoice = 'lunch';

export function defaultMeal(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  return h < 10.5 ? 'breakfast' : h < 15 ? 'lunch' : h < 17 ? 'snack' : h < 22 ? 'dinner' : 'snack';
}

export function initAnalyzer(options) {
  opts = options;
  initPhotos({
    showError, hideError, active: () => !$('capture').hidden || result?.source === 'manual',
    onChange() {
      // A photo added while building a meal by hand becomes that meal's picture.
      if (result?.source === 'manual') { result.thumb = photo()?.thumb || null; result.photoUrl = photo()?.url || null; renderResult(); }
      renderCapture();
    },
  });
  $('meal-note').addEventListener('input', renderCapture);
  $('describe-btn').addEventListener('click', () => { $('note-wrap').hidden = false; $('meal-note').focus({ preventScroll: true }); renderCapture(); });
  $('analyze-btn').addEventListener('click', analyze);
  $('stop-btn').addEventListener('click', () => ctl?.abort());
  $('manual-btn').addEventListener('click', startManual);
  $('actionbar').addEventListener('click', onBarClick);
  $('actionbar').addEventListener('change', e => { if (e.target.id === 'ab-meal') setMeal(e.target.value); });
  wireResult();
  const quick = initQuickAdd({ ...options, meals: MEALS, defaultMeal, thumb: () => photo()?.thumb || null, done: resetIdle });
  $('capture').inert = false;
  renderCapture();
  return {
    refresh() { renderBar(); quick.refresh(); const b = $('r-log'); if (b) b.textContent = `Add to ${opts.dateLabel()}`; },
  };
}

/* ---------- photos and description ---------- */

// The meal photo (the first one); extra photos are another angle or what was left (see photos.js).
const photo = () => getPhotos()[0] || null;

function renderCapture() {
  renderPhotos();
  const n = getPhotos().length;
  if (n) $('note-wrap').hidden = false;
  const hasNote = $('meal-note').value.trim().length > 0;
  const btn = $('analyze-btn');
  btn.disabled = !n && !hasNote;
  btn.textContent = n > 1 ? `Analyze ${n} photos` : n || !hasNote ? 'Analyze photo' : 'Analyze description';
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
  } else if (photo() || hasNote) {
    html = `<button type="button" class="btn btn-primary ab-main" data-ab="analyze">${ICON_CAMERA}${$('analyze-btn').textContent}</button>`;
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
  const shots = getPhotos();
  if ((!shots.length && !note) || running) return;
  hideError();
  ctl = new AbortController();
  startProgress(shots.length ? `Claude is looking at your plate${shots.length > 1 ? ` (${shots.length} photos)` : ''}` : 'Claude is reading your description');
  try {
    const store = opts.store(), thorough = !!accuracyPrefs(store).thorough;
    const roles = shots.map(p => p.role), context = [promptContext(store), personalContext(store)].filter(Boolean).join('\n');
    const pass = (n, onStep) => analyzeMeal({
      buildPrompt: caps => buildPrompt(note, roles, caps, context), imageBlobs: shots.map(p => p.blob),
      search: searchTool(onStep), signal: ctl.signal, onStep, thorough, pass: n,
    });
    // Thorough: two independent estimates, combined (see mergeEstimates).
    const outs = await Promise.all(thorough ? [pass(1, addStep), pass(2, step => addStep(`Second look: ${step}`))] : [pass(1, addStep)]);
    let r = normalize(outs[0].reply);
    if (outs[1]) r = mergeEstimates(r, normalize(outs[1].reply));
    r.items = applyCalibration(store, r.items);
    // Safety net: one calorie figure in the description and one food means that food has those calories.
    const fromNote = statedCalories(note);
    if (fromNote != null && r.items.length === 1 && r.items[0].custom?.origin !== 'stated') r.items[0] = applyStated(r.items[0], { kcal: fromNote });
    if (!r.items.length) {
      showError(`Claude didn't find food or drink to log.${r.notes ? ' ' + r.notes : ''} Try another photo, or add details in the text box.`);
      return;
    }
    mealChoice = defaultMeal();
    const usd = outs.reduce((a, o) => a + (o.usd || 0), 0) || undefined;
    result = { ...r, usd, webUnavailable: outs.some(o => o.webUnavailable), passes: outs.length, note, source: shots.length ? 'photo' : 'text', thumb: photo()?.thumb || null, photoUrl: photo()?.url || null };
    renderResult(true);
  } catch (e) {
    if (e?.code !== 'cancelled') showError(ERRORS[e?.code] || `Something went wrong reaching Claude${e?.message ? ` (${e.message})` : ''}. Try again in a moment.`, SETTINGS_CODES.has(e?.code));
  } finally {
    stopProgress();
  }
}

// Sends the person's correction, with the meal as it stands and the photos, and swaps in Claude's
// updated estimate. Only what the correction concerns should change (see refine.js).
async function refine(correction) {
  if (running || !result) return;
  const store = opts.store(), shots = getPhotos(), before = sumNutrients(result.items.map(itemNutrients)).kcal;
  hideError();
  ctl = new AbortController();
  startProgress('Claude is refining the estimate');
  $('result').inert = true;
  try {
    const context = [promptContext(store), personalContext(store)].filter(Boolean).join('\n');
    const current = describeMeal(result.items, itemNutrients);
    const out = await analyzeMeal({
      buildPrompt: caps => buildRefinePrompt({ correction, note: result.note, roles: shots.map(p => p.role), current, context }, caps),
      imageBlobs: shots.map(p => p.blob), search: searchTool(addStep), signal: ctl.signal, onStep: addStep,
      thorough: !!accuracyPrefs(store).thorough, pass: 2,
    });
    const r = mergeRefined(result.items, out.reply, store, correction);
    if (!r.items.length) { showError('Claude’s refined estimate came back empty, so nothing was changed. Try saying it another way.'); return; }
    result = { ...result, ...r, title: result.title || r.title, usd: (result.usd || 0) + (out.usd || 0) || undefined, refined: (result.refined || 0) + 1 };
    renderResult();
    const after = sumNutrients(result.items.map(itemNutrients)).kcal;
    opts.toast(`Refined: ${fmt(before)} → ${fmt(after)} kcal`);
  } catch (e) {
    if (e?.code !== 'cancelled') showError(ERRORS[e?.code] || `Something went wrong reaching Claude${e?.message ? ` (${e.message})` : ''}. Your estimate is unchanged.`, SETTINGS_CODES.has(e?.code));
  } finally {
    $('result').inert = false;
    stopProgress();
  }
}

function startProgress(title) {
  running = true;
  $('progress').hidden = false;
  $('progress-steps').innerHTML = '';
  $('capture').inert = true;
  setTitle(title);
  const n = getPhotos().length;
  addStep(n ? `Sent ${n > 1 ? `${n} photos` : 'the photo'} to Claude` : 'Sent the description to Claude');
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
  result = { title: '', items: [], notes: '', source: 'manual', thumb: photo()?.thumb || null, photoUrl: photo()?.url || null };
  renderResult(true);
  openFinder($('r-add-finder'), '');
}

// Back to the empty capture state after logging or discarding.
function resetIdle() {
  result = null;
  clearPhotos();
  $('meal-note').value = '';
  $('note-wrap').hidden = true;
  renderCapture();
  renderResult();
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
        <div id="r-addons">${addonsHtml(result)}</div>
        <button type="button" class="btn btn-tinted btn-sm add-food" id="r-add">+ Add a food</button>
        <div id="r-add-finder"></div>
        ${result.source !== 'manual' ? `<form class="refine" id="r-refine" novalidate>
          <label class="field-label" for="r-fix">Something off? Tell Claude</label>
          <div class="refine-row"><input type="text" id="r-fix" maxlength="300" autocomplete="off" placeholder="Brown rice, and less of it · no sauce" enterkeyhint="send"><button type="submit" class="btn btn-tinted btn-sm">Refine</button></div>
        </form>` : ''}
        ${result.notes || result.usd || result.refined || result.passes > 1 ? `<p class="ai-notes">${esc(result.notes)}${result.webUnavailable ? ' Web search is turned off for your Anthropic organization, so brand-name foods came from labels or the food databases.' : ''}${result.passes > 1 ? ' Two independent estimates were combined.' : ''}${result.refined ? ` Refined ${result.refined === 1 ? 'once' : `${result.refined} times`} from your corrections.` : ''}${result.usd ? ` Analysis cost about ${result.usd < 0.01 ? 'under 1¢' : `${Math.round(result.usd * 100)}¢`} on your Anthropic account.` : ''}</p>` : ''}
      </div>
      <div id="r-totals">${totalsHtml(result)}</div>
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
  $('r-addons').innerHTML = addonsHtml(result);
  $('r-totals').innerHTML = totalsHtml(result);
  renderBar();
}

function refreshRow(row) {
  const it = result.items[Number(row.dataset.i)], n = itemNutrients(it);
  row.querySelector('.grams').value = it.grams;
  const kIn = row.querySelector('.kcal-in');
  if (document.activeElement !== kIn) kIn.value = Math.round(n.kcal);
  row.querySelector('.macros-line').textContent = macroLine(n);
  row.querySelector('.item-warns').innerHTML = warningsHtml(it);
  const range = row.querySelector('.item-range');
  if (range) range.textContent = it.range ? `Likely ${fmt(it.grams * it.range[0])}–${fmt(it.grams * it.range[1])} g` : '';
  $('r-totals').innerHTML = totalsHtml(result);
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
    const { reply } = await analyzeMeal({ buildPrompt: caps => buildLookupPrompt(q, caps), imageBlobs: [], search: searchTool(), signal: new AbortController().signal });
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
        // A typed weight is taken as measured: Claude's range no longer applies.
        const it = result.items[row.dataset.i];
        it.grams = clampG(g);
        it.range = null;
        it.manual = true;
        const n = itemNutrients(it);
        row.querySelector('.kcal-in').value = Math.round(n.kcal);
        row.querySelector('.macros-line').textContent = macroLine(n);
        row.querySelector('.item-warns').innerHTML = warningsHtml(it);
        row.querySelector('.item-range')?.remove();
        $('r-totals').innerHTML = totalsHtml(result);
        renderBar();
      }
    } else if (t.classList.contains('finder-q')) t.closest('.finder').querySelector('.finder-list').innerHTML = finderList(t.value);
  });
  el.addEventListener('submit', e => {
    if (e.target.id !== 'r-refine') return;
    e.preventDefault();
    const text = $('r-fix').value.trim().slice(0, 300);
    if (text) { $('r-fix').blur(); refine(text); } else $('r-fix').focus();
  });
  el.addEventListener('change', e => {
    const t = e.target, row = t.closest('.item');
    if (t.id === 'r-meal') setMeal(t.value);
    else if (t.classList.contains('kcal-in')) {
      // Typed calories win: the food keeps its proportions, scaled to the stated number.
      const v = Number(t.value);
      if (t.value !== '' && v >= 0 && v <= 20000) { result.items[row.dataset.i] = { ...applyStated(result.items[row.dataset.i], { kcal: v }), manual: true }; refreshItems(); }
      else t.value = Math.round(itemNutrients(result.items[row.dataset.i]).kcal);
    }
    else if (t.classList.contains('portion') && t.value) {
      result.items[row.dataset.i].grams = clampG(Number(t.value));
      result.items[row.dataset.i].range = null;
      result.items[row.dataset.i].manual = true;
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
      it.manual = true;
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
    } else if (t.dataset.size) {
      // A size question answered: that amount, as stated by the person, replaces the estimate.
      const it = result.items[row.dataset.i];
      it.grams = clampG(Number(t.dataset.size));
      it.range = null;
      it.manual = true;
      it.confidence = 'high';
      it.basis = `You chose ${t.dataset.label} (${it.grams} g).`;
      refreshItems();
    } else if (t.dataset.addon != null) {
      // "Did you add…?" answered yes: the suggested food joins the meal.
      const [a] = result.addons.splice(Number(t.dataset.addon), 1);
      if (a) result.items.push({ label: a.label, fdcId: a.fdcId, grams: a.grams, basis: a.question.replace(/\?$/, ': yes'), confidence: 'medium' });
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
  const reviewed = result.items.slice();
  btn.disabled = true;
  try {
    await opts.onLog(entry);
    opts.toast(`Logged ${MEALS[entry.meal].toLowerCase()}: ${fmt(totals.kcal)} kcal`);
    // How the weights were corrected teaches future estimates (see accuracy.js).
    recordCorrections(opts.store(), reviewed);
    resetIdle();
  } catch (e) {
    opts.toast(opts.saveError(e));
    btn.disabled = false;
  }
}
