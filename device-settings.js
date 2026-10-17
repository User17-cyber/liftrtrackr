// Installed-app settings: the Anthropic API key and model (kept in this device's localStorage and sent
// only to api.anthropic.com), backups, and the "Add to Home Screen" hint for Safari.
import { MODELS, DEFAULT_MODEL, checkKey } from './ai.js';
import { validateBackup, mergeBackup } from './store.js';

const $ = id => document.getElementById(id);
const KEY = 'plate-ledger-settings';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let ctx, pendingImport = null;

function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; } }
export const getApiKey = () => read().apiKey || '';
export const getModel = () => (MODELS.some(m => m.id === read().model) ? read().model : DEFAULT_MODEL);
export const getWebLookup = () => read().web !== false;
export const getFdcKey = () => read().fdcKey || '';
const masked = k => `${k.slice(0, 10)}…${k.slice(-4)}`;

const KEY_ERRORS = {
  bad_key: 'Anthropic rejected this key. Check that it was copied in full and hasn’t been revoked.',
  no_access: 'This key can’t use the chosen model. Check its workspace permissions in the Anthropic Console.',
  no_model: 'This key’s organization doesn’t have access to the chosen model. Try another model.',
  offline: 'Couldn’t reach Anthropic. The key is saved and will be used once you’re online.',
  rate_limited: 'Anthropic is rate-limiting this key right now. The key is saved; try again in a minute.',
};

export function initDeviceSettings(c) {
  ctx = c;
  $('ai-settings').innerHTML = `<div class="card-head"><h2>Photo analysis</h2></div>
    <p class="fine" style="margin-bottom:12px">Uses an Anthropic API key entered on this device, billed to that key's account. Everyone who installs LiftrTrackr adds their own key; no one else's key or Claude plan is ever used. The key stays on this device and is sent only to api.anthropic.com.</p>
    <form id="key-form" class="settings-form" novalidate>
      <div class="field"><label for="api-key">Anthropic API key</label>
        <div class="field-row key-row"><input id="api-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…"><button type="button" class="btn btn-plain btn-sm" id="key-show">Show</button></div>
        <div class="hint">Create one at console.anthropic.com → API keys. A monthly spend limit there is a good idea.</div></div>
      <p id="key-state" class="fine" aria-live="polite"></p>
      <div class="backup-actions"><button type="submit" class="btn btn-primary btn-sm">Save key</button><button type="button" class="link-btn danger" id="key-forget" hidden>Remove key</button></div>
      <div class="field"><label for="model">Model</label><select id="model">${MODELS.map(m => `<option value="${m.id}">${m.label}</option>`).join('')}</select><div class="hint" id="model-hint"></div></div>
      <label class="switch-row" for="web-lookup"><span><b>Look up brand-name foods on the web</b><span class="hint">When a brand is named and no food database has it, Claude finds the official nutrition facts and cites the page. About 1¢ per search.</span></span><input type="checkbox" id="web-lookup" role="switch"></label>
    </form>
    <form id="fdc-form" class="settings-form" novalidate style="margin-top:14px">
      <div class="field"><label for="fdc-key">USDA FoodData Central key <span class="opt">(optional)</span></label>
        <div class="field-row key-row"><input id="fdc-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Free key from api.data.gov"><button type="submit" class="btn btn-plain btn-sm">Save</button></div>
        <div class="hint">Claude checks US packaged foods against the labels manufacturers file with USDA (Branded Foods). Without a key, everyone shares a demo allowance of a few lookups an hour; a free key from api.data.gov/signup allows 1,000 an hour. It's sent only to api.nal.usda.gov.</div></div>
      <p id="fdc-state" class="fine" aria-live="polite"></p>
      <button type="button" class="link-btn danger" id="fdc-forget" hidden>Remove key</button>
    </form>`;
  $('backup-card').hidden = false;
  $('backup-card').innerHTML = `<div class="card-head"><h2>Backup</h2></div>
    <p class="fine" style="margin-bottom:12px">Your meals, weigh-ins, lifting and details live on this phone. Export a backup to Files now and then; import it to restore, move to a new phone, or bring in your log from the claude.ai version.</p>
    <div class="backup-actions"><button type="button" class="btn btn-tinted btn-sm" id="export-btn">Export backup</button>
      <input type="file" id="import-file" accept="application/json,.json" class="visually-hidden"><label for="import-file" class="btn btn-plain btn-sm">Import backup</label></div>
    <div id="import-confirm" aria-live="polite"></div>
    <p id="storage-info" class="fine" style="margin-top:10px"></p>`;
  $('model').value = getModel();
  $('web-lookup').checked = getWebLookup();
  $('web-lookup').addEventListener('change', e => write({ ...read(), web: e.target.checked }));
  $('model-hint').textContent = MODELS.find(m => m.id === getModel()).note;
  $('model').addEventListener('change', e => {
    write({ ...read(), model: e.target.value });
    $('model-hint').textContent = MODELS.find(m => m.id === e.target.value).note;
  });
  $('key-show').addEventListener('click', () => {
    const i = $('api-key'), show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    $('key-show').textContent = show ? 'Hide' : 'Show';
  });
  $('key-form').addEventListener('submit', onSaveKey);
  $('fdc-form').addEventListener('submit', onSaveFdcKey);
  $('fdc-forget').addEventListener('click', () => { const s = read(); delete s.fdcKey; write(s); renderFdcKey(); ctx.toast('USDA key removed'); });
  $('key-forget').addEventListener('click', () => { const s = read(); delete s.apiKey; write(s); renderKey(); ctx.toast('API key removed from this device'); });
  $('export-btn').addEventListener('click', onExport);
  $('import-file').addEventListener('change', onImportFile);
  $('import-confirm').addEventListener('click', onImportConfirm);
  renderKey();
  renderFdcKey();
  renderInstallHint();
  renderStorage();
}

function renderKey(status = '') {
  const k = getApiKey();
  $('key-state').textContent = status || (k ? `Saved on this device: ${masked(k)}` : 'No key saved yet. Searching foods works without one.');
  $('key-forget').hidden = !k;
}

async function onSaveKey(e) {
  e.preventDefault();
  const k = $('api-key').value.trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) return renderKey('That doesn’t look like an Anthropic API key. Keys start with “sk-ant-”.');
  if (!write({ ...read(), apiKey: k })) return renderKey('This browser refused to save the key.');
  $('api-key').value = '';
  $('api-key').type = 'password';
  $('key-show').textContent = 'Show';
  $('api-key').blur();
  renderKey('Saved. Checking it with Anthropic…');
  const r = await checkKey(k, getModel());
  renderKey(r.ok ? `Key works. Saved on this device: ${masked(k)}` : KEY_ERRORS[r.code] || `Saved, but the check failed: ${r.message || r.code}`);
}

function renderFdcKey(status = '') {
  const k = getFdcKey();
  $('fdc-state').textContent = status || (k ? `Saved on this device: ${k.slice(0, 4)}…${k.slice(-4)}` : 'Using the shared demo key.');
  $('fdc-forget').hidden = !k;
}

async function onSaveFdcKey(e) {
  e.preventDefault();
  const k = $('fdc-key').value.trim();
  if (!/^[A-Za-z0-9]{20,64}$/.test(k)) return renderFdcKey('That doesn’t look like an api.data.gov key: 40 letters and numbers.');
  if (!write({ ...read(), fdcKey: k })) return renderFdcKey('This browser refused to save the key.');
  $('fdc-key').value = '';
  $('fdc-key').blur();
  renderFdcKey('Saved. Checking it with USDA…');
  try {
    const res = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(k)}&query=apple&pageSize=1`);
    renderFdcKey(res.ok ? `Key works. Saved on this device: ${k.slice(0, 4)}…${k.slice(-4)}` : res.status === 403 ? 'USDA rejected this key. Check that it was copied in full.' : `Saved, but USDA answered HTTP ${res.status}. It will be tried again on the next lookup.`);
  } catch { renderFdcKey('Saved. Couldn’t reach USDA to check it; it will be used once you’re online.'); }
}

async function onExport() {
  const data = ctx.store()?.exportData();
  if (!data) return ctx.toast('Your log is still loading. Try again in a moment.');
  const name = `liftrtrackr-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'LiftrTrackr backup' }); return; }
    catch (err) { if (err?.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function onImportFile(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch { return showImport('This file isn’t readable. Choose a backup exported from LiftrTrackr.'); }
  const err = validateBackup(data);
  if (err) return showImport(err);
  pendingImport = data;
  const days = Object.keys(data.days || {}).length, w = data.weights?.entries?.length || 0, l = Object.keys(data.lifts || {}).length;
  const from = Number.isNaN(Date.parse(data.exportedAt)) ? 'Backup' : `Backup from ${new Date(data.exportedAt).toLocaleDateString()}`;
  const cur = ctx.store().exportData();
  const hasLog = Object.keys(cur.days).length || cur.weights?.entries?.length || Object.keys(cur.lifts).length;
  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
  showImport(`${from}: ${n(days, 'day')} of meals, ${n(w, 'weigh-in')} and ${n(l, 'lifting session')}.${hasLog ? ' This phone already has a log. Add the backup to it, or replace it entirely.' : ''}`, hasLog ? 'merge' : 'restore');
}

function showImport(msg, mode = null) {
  const actions = mode === 'merge'
    ? '<button type="button" class="btn btn-primary btn-sm" data-act="merge">Add to this phone’s log</button><button type="button" class="btn btn-plain btn-sm" data-act="restore">Replace everything</button><button type="button" class="link-btn" data-act="cancel">Cancel</button>'
    : '<button type="button" class="btn btn-primary btn-sm" data-act="restore">Restore this backup</button><button type="button" class="btn btn-plain btn-sm" data-act="cancel">Cancel</button>';
  $('import-confirm').innerHTML = `<p class="fine">${esc(msg)}</p>${mode ? `<div class="backup-actions">${actions}</div>` : ''}`;
}

async function onImportConfirm(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if ((b.dataset.act === 'restore' || b.dataset.act === 'merge') && pendingImport) {
    const data = b.dataset.act === 'merge' ? mergeBackup(ctx.store().exportData(), pendingImport) : pendingImport;
    try { await ctx.store().importData(data); ctx.toast(b.dataset.act === 'merge' ? 'Backup added to your log' : 'Backup restored'); ctx.onRestore(); }
    catch (err) { ctx.toast(ctx.saveError(err)); }
  }
  pendingImport = null;
  $('import-confirm').innerHTML = '';
  renderStorage();
}

async function renderStorage() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => null);
  const parts = [];
  if (est?.usage != null) parts.push(`Using ${(est.usage / 1e6).toFixed(1)} MB on this device.`);
  if (persisted === true) parts.push('Storage is marked persistent.');
  $('storage-info').textContent = parts.join(' ');
}

function renderInstallHint() {
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let dismissed = false;
  try { dismissed = localStorage.getItem('plate-ledger-install-hint') === 'off'; } catch { /* ignore */ }
  const el = $('install-hint');
  el.hidden = standalone || !ios || dismissed;
  el.querySelector('button')?.addEventListener('click', () => {
    el.hidden = true;
    try { localStorage.setItem('plate-ledger-install-hint', 'off'); } catch { /* ignore */ }
  });
}
