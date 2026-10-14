// Per-person appearance and units: theme (system, light, dark), color scheme and kg/lb. Saved in the
// person's own store (so it follows them across devices on claude.ai) and cached in localStorage so
// boot-theme.js can apply it before the first paint.

const $ = id => document.getElementById(id);
const CACHE = 'liftrtrackr-appearance';
// Ordered around the color wheel (warm, green, blue to purple), then the muted ones.
export const ACCENTS = [
  { id: 'rose', label: 'Rose', sw: 'oklch(0.58 0.15 8)' },
  { id: 'ember', label: 'Ember', sw: 'oklch(0.62 0.14 48)' },
  { id: 'honey', label: 'Honey', sw: 'oklch(0.68 0.13 80)' },
  { id: 'moss', label: 'Moss', sw: 'oklch(0.58 0.13 130)' },
  { id: 'spinach', label: 'Spinach', sw: 'oklch(0.55 0.13 162)' },
  { id: 'lagoon', label: 'Lagoon', sw: 'oklch(0.58 0.1 200)' },
  { id: 'ocean', label: 'Ocean', sw: 'oklch(0.55 0.13 240)' },
  { id: 'iris', label: 'Iris', sw: 'oklch(0.55 0.13 285)' },
  { id: 'grape', label: 'Grape', sw: 'oklch(0.55 0.14 318)' },
  { id: 'cocoa', label: 'Cocoa', sw: 'oklch(0.5 0.06 55)' },
  { id: 'slate', label: 'Slate', sw: 'oklch(0.5 0.05 240)' },
  { id: 'graphite', label: 'Graphite', sw: 'oklch(0.45 0.015 250)' },
];
const DEFAULTS = { scheme: 'system', accent: 'spinach', units: null };
let ctx;

function cached() { try { return JSON.parse(localStorage.getItem(CACHE)) || {}; } catch { return {}; } }

export function currentPrefs() {
  const p = { ...DEFAULTS, ...cached(), ...(ctx?.store()?.prefs || {}) };
  if (!['system', 'light', 'dark'].includes(p.scheme)) p.scheme = 'system';
  if (!ACCENTS.some(a => a.id === p.accent)) p.accent = 'spinach';
  if (p.units !== 'us' && p.units !== 'metric') p.units = null;
  return p;
}

export function applyPrefs(p = currentPrefs()) {
  const r = document.documentElement;
  if (p.scheme === 'system') delete r.dataset.scheme; else r.dataset.scheme = p.scheme;
  if (p.accent === 'spinach') delete r.dataset.accent; else r.dataset.accent = p.accent;
  try { localStorage.setItem(CACHE, JSON.stringify({ scheme: p.scheme, accent: p.accent, units: p.units })); } catch { /* ignore */ }
}

export function initAppearance(c) {
  ctx = c;
  $('swatches').innerHTML = ACCENTS.map(a => `<label class="swatch"><input type="radio" name="accent" value="${a.id}"><i style="--sw:${a.sw}"></i>${a.label}</label>`).join('');
  $('appearance').addEventListener('change', async e => {
    const t = e.target;
    if (!['scheme', 'accent', 'units'].includes(t.name)) return;
    const next = { ...currentPrefs(), [t.name]: t.value };
    applyPrefs(next);
    if (t.name === 'units') ctx.onUnits();
    if (!ctx.store()) return;
    try { await ctx.store().savePrefs({ scheme: next.scheme, accent: next.accent, units: next.units }); }
    catch (err) { ctx.toast(ctx.saveError(err)); }
  });
  render();
}

// Reflects saved prefs in the controls (called when the store loads or changes).
export function render() {
  const p = currentPrefs();
  applyPrefs(p);
  for (const [name, value] of [['scheme', p.scheme], ['accent', p.accent], ['units', ctx.units()]]) {
    const el = document.querySelector(`#appearance input[name="${name}"][value="${value}"]`);
    if (el && !el.checked) el.checked = true;
  }
}
