// Installed-app settings: the Anthropic API key and model (kept in this device's localStorage and sent
// only to api.anthropic.com), backups, and the "Add to Home Screen" hint for Safari.
import { MODELS, DEFAULT_MODEL, checkKey } from './ai.js';
import { validateBackup } from './store.js';

const $ = id => document.getElementById(id);
const KEY = 'plate-ledger-settings';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let ctx, pendingImport = null;

function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; } }
export const getApiKey = () => read().apiKey || '';
export const getModel = () => (MODELS.some(m => m.id === read().model) ? read().model : DEFAULT_MODEL);
export const getWebLookup = () => read().web !== false;
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
      <label class="switch-row" for="web-lookup"><span><b>Look up brand-name foods on the web</b><span class="hint">When a brand is named or USDA has no match, Claude finds the official nutrition facts and cites the page. About 1¢ per search.</span></span><input type="checkbox" id="web-lookup" role="switch"></label>
    </form>`;
  $('backup-card').hidden = false;
  $('backup-card').innerHTML = `<div class="card-head"><h2>Backup</h2></div>
    <p class="fine" style="margin-bottom:12px">Your meals, weigh-ins, lifting and details live on this phone. Export a backup to Files now and then; import it to restore or move to a new phone.</p>
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
  $('key-forget').addEventListener('click', () => { const s = read(); delete s.apiKey; write(s); renderKey(); ctx.toast('API key removed from this device'); });
  $('export-btn').addEventListener('click', onExport);
  $('import-file').addEventListener('change', onImportFile);
  $('import-confirm').addEventListener('click', onImportConfirm);
  renderKey();
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
  showImport(`Backup from ${new Date(data.exportedAt).toLocaleDateString()}: ${days} days of meals, ${w} weigh-ins and ${l} lifting sessions. Restoring replaces everything on this device.`, true);
}

function showImport(msg, confirm = false) {
  $('import-confirm').innerHTML = `<p class="fine">${esc(msg)}</p>${confirm
    ? '<div class="backup-actions"><button type="button" class="btn btn-primary btn-sm" data-act="restore">Replace with this backup</button><button type="button" class="btn btn-plain btn-sm" data-act="cancel">Cancel</button></div>' : ''}`;
}

async function onImportConfirm(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'restore' && pendingImport) {
    try { await ctx.store().importData(pendingImport); ctx.toast('Backup restored'); ctx.onRestore(); }
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
