// claude.ai build (published as platform.js): each viewer's data lives in their own private part of the
// artifact's database, and photo analysis runs on the viewer's own Claude plan through `sample`.
// Pages here can't reach the web, so foods USDA lacks come from a package label in the photo or,
// failing that, Claude's own knowledge of the published label (marked as unverified).

export const kind = 'claude';
export { openStore } from './store-cloud.js';
export const canSearchWeb = () => false;

let sampleP = null;
const getSample = () => (sampleP ||= window.claude?.use ? window.claude.use('sample') : Promise.resolve(null));

export async function analyzeMeal({ buildPrompt, imageBlob, search, signal }) {
  const sample = await getSample();
  if (!sample) throw { code: 'unavailable' };
  const limits = await sample.limits().catch(() => null);
  if (imageBlob && !limits?.images) throw { code: 'images_unavailable' };
  const useTools = !!limits?.tools;
  const options = { signal };
  if (imageBlob) options.images = [imageBlob];
  if (useTools) options.tools = [{ name: search.name, description: search.description, inputSchema: search.inputSchema, execute: search.execute }];
  const reply = await sample.json(buildPrompt({ tools: useTools, web: false, submit: false }), options);
  return { reply };
}

const APP_URL = 'https://user17-cyber.github.io/liftrtrackr/';

export function initPlatformSettings(ctx) {
  document.getElementById('ai-settings').innerHTML = `<div class="card-head"><h2>Photo analysis</h2></div>
    <p class="fine">Runs on the Claude plan of whoever is using this page, never the page owner's. The first analysis asks you to allow it. Your meals, weigh-ins, lifting and settings are private to you and follow you to any device where you're signed in.</p>
    <p class="fine" style="margin-top:10px">Brand-name foods: pages on claude.ai can't reach other sites, so Claude reads the Nutrition Facts label when it's visible in your photo, and otherwise uses what it knows of the published label, marked as unverified. The installed app also checks USDA's Branded Foods labels and can search the web.</p>`;
  const card = document.getElementById('backup-card');
  card.hidden = false;
  card.innerHTML = `<div class="card-head"><h2>Move to the installed app</h2></div>
    <p class="fine" style="margin-bottom:12px">Save everything you've logged here (meals, weigh-ins, lifting, your details and settings) as one backup file. Then in the <a href="${APP_URL}" target="_blank" rel="noopener">installed app</a>, open Settings, tap Import backup and choose the file.</p>
    <div class="backup-actions"><button type="button" class="btn btn-tinted btn-sm" id="export-btn">Export my log</button></div>
    <p id="export-state" class="fine" style="margin-top:10px" aria-live="polite" hidden></p>`;
  document.getElementById('export-btn').addEventListener('click', e => exportLog(e.currentTarget, ctx));
}

async function exportLog(btn, ctx) {
  const say = t => { const p = document.getElementById('export-state'); p.textContent = t; p.hidden = !t; };
  const store = ctx.store();
  if (!store) return say('Your log is still loading. Try again in a moment.');
  btn.disabled = true;
  say('Gathering your log…');
  try {
    const downloads = window.claude?.use ? await window.claude.use('downloads') : null;
    if (!downloads) return say('This view can’t save files. Open this page on claude.ai in a browser and try again.');
    const data = await store.exportData();
    const days = Object.keys(data.days).length, w = data.weights?.entries?.length || 0, l = Object.keys(data.lifts).length;
    await downloads.save({ filename: `liftrtrackr-backup-${new Date().toISOString().slice(0, 10)}.json`, data: new Blob([JSON.stringify(data)]) });
    say(`Saved: ${days} day${days === 1 ? '' : 's'} of meals, ${w} weigh-in${w === 1 ? '' : 's'} and ${l} lifting session${l === 1 ? '' : 's'}.`);
  } catch (e) {
    say(e?.code === 'declined' ? '' : e?.code === 'rate_limited' ? 'A save is already waiting for you to confirm.' : `Couldn’t save the file${e?.message ? `: ${e.message}` : '.'}`);
  } finally {
    btn.disabled = false;
  }
}
