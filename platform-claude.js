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
  if (useTools) options.tools = [{ name: 'search_usda', description: search.description, inputSchema: search.inputSchema, execute: search.execute }];
  const reply = await sample.json(buildPrompt({ tools: useTools, web: false, submit: false }), options);
  return { reply };
}

export function initPlatformSettings() {
  document.getElementById('ai-settings').innerHTML = `<div class="card-head"><h2>Photo analysis</h2></div>
    <p class="fine">Runs on the Claude plan of whoever is using this page, never the page owner's. The first analysis asks you to allow it. Your meals, weigh-ins, lifting and settings are private to you and follow you to any device where you're signed in.</p>
    <p class="fine" style="margin-top:10px">Brand-name foods: pages on claude.ai can't search the web, so Claude reads the Nutrition Facts label when it's visible in your photo, and otherwise uses what it knows of the published label, marked as unverified. The installed app can search the web.</p>`;
}
