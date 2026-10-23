// App shell: tabs, the shared date, the bottom dock, and render scheduling. Only the visible tab is
// rendered, and store updates that arrive while a field has focus wait until it loses focus, so the
// page never shifts under the person typing.
import { loadFoods } from './usda.js';
import { initAnalyzer } from './analyze.js';
import { initWeight } from './weight.js';
import { initBodyFat } from './bodyfat.js';
import { initLifting } from './lifting.js';
import { initCalories, dayDoc, dayTotals } from './calories.js';
import { initProfile } from './profile.js';
import { initTargets } from './targets.js';
import { initAccuracySettings } from './accuracy.js';
import { initAppearance, currentPrefs, render as renderAppearance } from './appearance.js';
import { openStore, initPlatformSettings, kind } from './platform.js';

const $ = id => document.getElementById(id);
const TABS = ['calories', 'weight', 'lifting', 'settings'];
const TAB_KEY = 'liftrtrackr-tab';
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const todayISO = () => iso(new Date());

const state = { date: todayISO(), store: null, tab: initialTab() };
let analyzer = null, weight = null, bodyfat = null, lifting = null, calories = null, profile = null, targets = null, accuracy = null, toastTimer = null;
let renderQueued = false, pendingRender = false;

function initialTab() {
  const h = location.hash.slice(1);
  if (TABS.includes(h)) return h;
  try { const t = localStorage.getItem(TAB_KEY); if (TABS.includes(t)) return t; } catch { /* ignore */ }
  return 'calories';
}

/* ---------- helpers ---------- */

function toast(msg) {
  const el = $('toast');
  el.hidden = true;
  el.textContent = msg;
  setTimeout(() => { el.hidden = false; }, 20);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

function saveError(e) {
  if (e?.code === 'not_ready') return 'Still opening your log. Try again in a moment.';
  if (e?.code === 'invalid_argument') return 'This page is view-only for you, so changes can’t be saved. Ask its owner for Contributor access.';
  if (e?.code === 'quota_exceeded') return 'Storage for this page is full. Delete some old entries, then try again.';
  if (e?.code === 'no_storage') return 'This browser isn’t letting LiftrTrackr save (private browsing?), so this change will be lost.';
  if (e?.code === 'local_full') return 'Your device refused to save. Free up some storage, then try again.';
  return 'Couldn’t save. Try again.';
}

const units = () => currentPrefs().units || state.store?.profile?.units || 'metric';
const isToday = () => state.date === todayISO();
const dateLabel = (short = false) => (isToday() ? 'today'
  : parseISO(state.date).toLocaleDateString(undefined, short ? { month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' }));
const isTyping = el => !!el?.matches?.('input:not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="button"]), textarea');

/* ---------- rendering ---------- */

function renderActive() {
  renderDate();
  renderAppearance();
  if (state.tab === 'calories') calories?.render();
  else if (state.tab === 'weight') { weight?.render(); bodyfat?.render(); }
  else if (state.tab === 'lifting') lifting?.render();
  else { profile?.render(); targets?.render(); accuracy?.render(); }
  analyzer?.refresh();
}

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  // A timer, not requestAnimationFrame: rAF pauses in hidden or throttled frames and would strand the queue.
  setTimeout(() => {
    renderQueued = false;
    if (isTyping(document.activeElement)) { pendingRender = true; setTimeout(retryPending, 700); return; }
    renderActive();
  }, 30);
}

// Focus events don't fire in every embedding, so a held render also re-checks on a timer.
function retryPending() {
  if (!pendingRender) return;
  if (isTyping(document.activeElement)) { setTimeout(retryPending, 700); return; }
  pendingRender = false;
  document.body.classList.remove('typing');
  renderActive();
}

let syncTimer = null;
function onStoreChange({ error } = {}) {
  if (error) { toast('Your log stopped syncing. Reload the page to reconnect.'); return; }
  requestRender();
  // Weigh-ins that arrive from another device or a restored backup update the profile too (when on).
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncProfileWeight, 600);
}

/* ---------- tabs and date ---------- */

function setTab(tab, target) {
  if (!TABS.includes(tab)) return;
  if (state.tab === 'lifting' && tab !== 'lifting') lifting?.flush();
  state.tab = tab;
  document.body.dataset.tab = tab;
  for (const t of TABS) $(`view-${t}`).hidden = t !== tab;
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  const slot = $(`view-${tab}`).querySelector('.date-slot');
  if (slot) slot.append($('datebar'));
  $('datebar').hidden = !slot;
  try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
  renderActive();
  const el = target && $(target);
  if (el) el.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
}

function setDate(date) {
  if (state.tab === 'lifting') lifting?.flush();
  state.date = date > todayISO() ? todayISO() : date;
  analyzer?.refresh();
  renderActive();
}

function renderDate() {
  const d = parseISO(state.date);
  $('day-name').textContent = isToday() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long' });
  $('day-date').textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  $('day-next').disabled = isToday();
  $('day-today').setAttribute('aria-label', isToday() ? 'Today' : 'Back to today');
}

/* ---------- cross-module actions ---------- */

async function onLog(entry) {
  if (!state.store) throw { code: 'not_ready' };
  const day = dayDoc(state.store, state.date);
  await state.store.saveDay(state.date, { date: state.date, entries: [...day.entries, entry] });
}

// The most recent weigh-in by date, or null.
function latestWeighIn() {
  const list = (state.store?.weights?.entries || []).filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.d) && x.kg > 0);
  return list.sort((a, b) => a.d.localeCompare(b.d)).at(-1) || null;
}

// With "Update from my weigh-ins" on (Settings → Your details; off by default), the profile weight, and
// so the maintenance estimate and calorie target, follow the most recent weigh-in. Returns that
// weigh-in when it changed the profile, else null.
async function syncProfileWeight() {
  const p = state.store?.profile, latest = latestWeighIn();
  if (!p?.autoWeight || !latest) return null;
  const kg = Math.round(latest.kg * 10) / 10;
  if (Math.abs((p.weightKg || 0) - kg) < 0.05) return null;
  try {
    const next = { ...p, weightKg: kg };
    await state.store.saveProfile(next);
    profile?.fill(next);
    return latest;
  } catch { return null; }
}

/* ---------- boot ---------- */

async function boot() {
  const store = () => state.store;
  const base = { store, toast, saveError, units, today: todayISO };
  initAppearance({ ...base, onUnits: () => { profile?.onUnits(); renderActive(); } });
  profile = initProfile({ ...base, syncWeight: syncProfileWeight });
  targets = initTargets(base);
  accuracy = initAccuracySettings(base);
  weight = initWeight({ ...base, onWeighIn: syncProfileWeight, intakeFor: d => dayTotals(dayDoc(state.store, d)).kcal });
  bodyfat = initBodyFat(base);
  lifting = initLifting({ ...base, date: () => state.date, setDate });
  calories = initCalories({ ...base, date: () => state.date, setDate, measured: () => weight.measured(), goTo: setTab });
  initPlatformSettings({ ...base, onRestore: () => { if (state.store?.profile) profile.fill(state.store.profile); renderActive(); } });

  document.addEventListener('click', e => {
    const tab = e.target.closest('.tabbar [data-tab]');
    if (tab) return setTab(tab.dataset.tab);
    const go = e.target.closest('[data-goto]');
    if (go) setTab(go.dataset.goto, go.dataset.goto === 'settings' ? go.dataset.anchor || 'profile' : null);
  });
  $('day-prev').addEventListener('click', () => setDate(addDays(state.date, -1)));
  $('day-next').addEventListener('click', () => setDate(addDays(state.date, 1)));
  $('day-today').addEventListener('click', () => setDate(todayISO()));

  // Keyboard up: hide the dock so it can't ride above the keyboard, and hold re-renders until done.
  document.addEventListener('focusin', e => { if (isTyping(e.target)) document.body.classList.add('typing'); });
  document.addEventListener('focusout', () => setTimeout(() => {
    if (isTyping(document.activeElement)) return;
    document.body.classList.remove('typing');
    if (pendingRender) { pendingRender = false; renderActive(); }
  }, 60));
  new ResizeObserver(([e]) => document.documentElement.style.setProperty('--dock-h', `${Math.round(e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight)}px`)).observe($('dock'));

  setTab(state.tab);
  const storeP = openStore(onStoreChange);
  try {
    const n = await loadFoods();
    $('food-count').textContent = `${n.toLocaleString()} foods are bundled with this app.`;
    analyzer = initAnalyzer({ onLog, dateLabel, toast, saveError, store: () => state.store });
  } catch (e) {
    $('analyze-error-text').textContent = `${e.message || 'The food tables did not load.'} Reload to try again.`;
    $('analyze-error').hidden = false;
    $('capture').hidden = true;
  }
  state.store = await storeP;
  if (state.store.kind === 'memory' || (kind === 'claude' && state.store.kind === 'local')) {
    $('store-note-text').textContent = state.store.kind === 'memory'
      ? 'This browser isn’t letting LiftrTrackr save (private browsing?). Anything you log now is lost when you close it.'
      : 'Saved in this browser only. Open this page on claude.ai while signed in to keep your log with your account.';
    $('store-note').hidden = false;
  }
  renderActive();
}

boot();
