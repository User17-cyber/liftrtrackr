// Food composition lookup. Two bundled tables, both per 100 g edible portion (energy in kcal, nutrients
// in g, sodium in mg, carbohydrate as total carbohydrate):
//   usda-foods.json  USDA FoodData Central SR Legacy and FNDDS 2021–2023 (ids are FDC numbers)
//   more-foods.json  USDA Foundation Foods 2026, Canadian Nutrient File 2026, UK CoFID 2021,
//                    French Ciqual 2025 and Australian AFCD Release 3 (built by scripts/build_more_foods.py)
// The installed app can also add USDA Branded Foods it looks up live (see branded.js).

export const DATASETS = [
  { name: 'SR Legacy', region: 'usda' },
  { name: 'FNDDS', region: 'usda' },
  { name: 'USDA Foundation', region: 'usda' },
  { name: 'Canada CNF', region: 'canada', home: 'https://open.canada.ca/data/en/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109' },
  { name: 'UK CoFID', region: 'uk', home: 'https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid' },
  { name: 'France Ciqual', region: 'france' },
  { name: 'Australia AFCD', region: 'australia', home: 'https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/search' },
  { name: 'USDA Branded', region: 'branded' },
];
export const REGIONS = ['usda', 'canada', 'uk', 'france', 'australia'];
export const NUTRIENTS = ['kcal', 'protein', 'fat', 'carb', 'fiber', 'sugar', 'sodium', 'satfat'];

const STOP = new Set(['and', 'or', 'with', 'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'ns', 'as', 'nfs', 'from', 'made']);
let foods = [];
const byId = new Map();
const portionTable = {};

function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokens(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim().split(' ')
    .filter(w => w && !STOP.has(w)).map(stem);
}

const toFood = r => ({
  id: r[0], src: r[1], desc: r[2],
  per100: { kcal: r[3], protein: r[4], fat: r[5], carb: r[6], fiber: r[7], sugar: r[8], sodium: r[9], satfat: r[10] },
  toks: tokens(r[2]),
});

async function table(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The food table did not load (HTTP ${res.status}).`);
  return res.json();
}

// Loads both tables. The USDA one is required; the international one is added when it loads.
export async function loadFoods() {
  const [usda, more] = await Promise.all([table('usda-foods.json'), table('more-foods.json').catch(() => null)]);
  for (const data of [usda, more]) {
    if (!data) continue;
    Object.assign(portionTable, data.portions || {});
    for (const f of data.foods.map(toFood)) { foods.push(f); byId.set(f.id, f); }
  }
  return foods.length;
}

// Foods looked up at run time (USDA Branded), so they can be matched, weighed and logged like the rest.
export function addFoods(list) {
  for (const f of list) {
    const food = { ...f, toks: tokens(f.desc) };
    if (!byId.has(food.id)) foods.push(food);
    byId.set(food.id, food);
    if (f.portions?.length) portionTable[String(f.id)] = f.portions;
  }
}

export const foodCount = () => foods.length;
// USDA ids are numbers (they may arrive as text); the other tables use prefixed text ids such as "uk:11-989".
export const getFood = id => (id == null || id === '' ? null : byId.get(/^\d+$/.test(String(id)) ? Number(id) : String(id)) || null);
export const datasetName = food => DATASETS[food?.src]?.name || 'Food database';
export const fdcUrl = id => `https://fdc.nal.usda.gov/food-details/${Number(id)}/nutrients`;

// Where a person can check a food's numbers: its own page where the database has one.
export function foodUrl(food) {
  const d = DATASETS[food?.src];
  if (!d) return null;
  if (d.region === 'usda' || d.region === 'branded') return fdcUrl(food.id);
  if (d.region === 'france') return `https://ciqual.anses.fr/#/aliments/${String(food.id).replace(/^fr:/, '')}`;
  return d.home;
}

// A short citation such as "USDA 171705" or "UK CoFID 11-989".
export function foodRef(food) {
  const d = DATASETS[food?.src];
  if (!d) return 'Food database';
  return d.region === 'usda' || d.region === 'branded' ? `USDA ${food.id}` : `${d.name} ${String(food.id).replace(/^[a-z]+:/, '')}`;
}

export function getPortions(id) {
  return (portionTable[String(id)] || []).map(([label, g]) => ({ label, g }));
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

// Ranked keyword search. Each query word must match a description word exactly or by prefix; matches
// near the start of the description (where tables name the food) score higher. `region` limits the
// search to one country's tables. On a tie, USDA entries come first.
export function search(query, limit = 8, region = null) {
  const q = tokens(query).slice(0, 8);
  if (!q.length) return [];
  const need = q.length <= 2 ? 1 : Math.ceil(q.length * 0.6);
  const scored = [];
  for (const f of foods) {
    const reg = DATASETS[f.src]?.region;
    if (reg === 'branded' || (region && reg !== region)) continue;
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
    if (reg === 'usda') score += 0.15;
    scored.push([score, f]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].toks.length - b[1].toks.length);
  return scored.slice(0, limit).map(s => s[1]);
}
