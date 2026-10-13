// USDA FoodData Central lookup. The bundled table (usda-foods.json) holds every
// SR Legacy and FNDDS 2021–2023 food that reports energy, with values per 100 g.

export const DATASETS = ['SR Legacy', 'FNDDS'];
export const NUTRIENTS = ['kcal', 'protein', 'fat', 'carb', 'fiber', 'sugar', 'sodium', 'satfat'];

const STOP = new Set(['and', 'or', 'with', 'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'ns', 'as', 'nfs', 'from', 'made']);
let foods = [];
const byId = new Map();
let portionTable = {};

function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokens(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim().split(' ')
    .filter(w => w && !STOP.has(w)).map(stem);
}

export async function loadUsda(url = 'usda-foods.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The USDA food table did not load (HTTP ${res.status}).`);
  const data = await res.json();
  portionTable = data.portions || {};
  foods = data.foods.map(r => ({
    id: r[0], src: r[1], desc: r[2],
    per100: { kcal: r[3], protein: r[4], fat: r[5], carb: r[6], fiber: r[7], sugar: r[8], sodium: r[9], satfat: r[10] },
    toks: tokens(r[2]),
  }));
  foods.forEach(f => byId.set(f.id, f));
  return foods.length;
}

export const foodCount = () => foods.length;
export const getFood = id => byId.get(Number(id)) || null;
export const datasetName = food => DATASETS[food.src];
export const fdcUrl = id => `https://fdc.nal.usda.gov/food-details/${Number(id)}/nutrients`;

export function getPortions(id) {
  return (portionTable[Number(id)] || []).map(([label, g]) => ({ label, g }));
}

// Nutrients for a weight of food, scaled from the per-100 g values.
export function nutrientsFor(food, grams) {
  const out = {};
  for (const k of NUTRIENTS) out[k] = (food.per100[k] || 0) * grams / 100;
  return out;
}

export function sumNutrients(list) {
  const out = Object.fromEntries(NUTRIENTS.map(k => [k, 0]));
  for (const n of list) for (const k of NUTRIENTS) out[k] += n?.[k] || 0;
  return out;
}

// Ranked keyword search. Each query word must match a description word exactly or by
// prefix; matches near the start of the description (where USDA names the food) score higher.
export function search(query, limit = 8) {
  const q = tokens(query).slice(0, 8);
  if (!q.length) return [];
  const need = q.length <= 2 ? 1 : Math.ceil(q.length * 0.6);
  const scored = [];
  for (const f of foods) {
    let score = 0, matched = 0;
    for (const qt of q) {
      let best = 0;
      for (let i = 0; i < f.toks.length; i++) {
        const dt = f.toks[i];
        let s;
        if (dt === qt) s = 3;
        else if (qt.length >= 3 && dt.startsWith(qt)) s = 2;
        else if (dt.length >= 4 && qt.startsWith(dt)) s = 1.5;
        else continue;
        s += i === 0 ? 1 : i < 3 ? 0.4 : 0;
        if (s > best) best = s;
      }
      if (best) { matched++; score += best; }
    }
    if (matched < need) continue;
    if (matched === q.length) score += 2;
    score -= f.toks.length * 0.08;
    scored.push([score, f]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].toks.length - b[1].toks.length);
  return scored.slice(0, limit).map(s => s[1]);
}
