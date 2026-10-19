// Installed app (GitHub Pages): data in this device's IndexedDB, photo analysis through the
// Anthropic API with the key saved in Settings, plus Anthropic's web search for foods USDA lacks.
// The claude.ai build swaps in platform-claude.js.
import { analyzeMeal as callApi, blobToBase64 } from './ai.js';
import { getApiKey, getModel, getWebLookup, getFdcKey, initDeviceSettings } from './device-settings.js';
import { brandedTool } from './branded.js';

export const kind = 'device';
export { openStore } from './store.js';
export const canSearchWeb = () => getWebLookup();

// buildPrompt({tools, web, submit, branded}) returns the instruction text for these capabilities.
export async function analyzeMeal({ buildPrompt, imageBlob, search, signal, onStep, thorough = false }) {
  const apiKey = getApiKey();
  if (!apiKey) throw { code: 'no_key' };
  if (navigator.onLine === false) throw { code: 'offline' };
  const imageBase64 = imageBlob ? await blobToBase64(imageBlob) : null;
  return callApi({
    apiKey, model: getModel(), imageBase64, signal, onStep, web: getWebLookup(), effort: thorough ? 'high' : 'medium',
    tools: [search, brandedTool({ apiKey: getFdcKey(), onStep })],
    prompt: web => buildPrompt({ tools: true, web, submit: true, branded: true }),
  });
}

export function initPlatformSettings(ctx) {
  initDeviceSettings(ctx);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
