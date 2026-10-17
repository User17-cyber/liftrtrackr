// USDA Branded Foods, looked up live in the installed app: manufacturer-submitted labels for US packaged
// products, from the FoodData Central API. Uses the person's free api.data.gov key when one is saved in
// Settings, else the shared DEMO_KEY (a few lookups an hour). Results join the food registry, so Claude's
// pick is weighed and logged from the database's own numbers, never from numbers Claude copied.
import { addFoods, DATASETS } from './usda.js';

const SRC = DATASETS.findIndex(d => d.region === 'branded');
const NUMBERS = { '208': 'kcal', '203': 'protein', '204': 'fat', '205': 'carb', '291': 'fiber', '269': 'sugar', '307': 'sodium', '606': 'satfat' };
const r2 = n => Math.round(n * 100) / 100;
const title = s => String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

function toFood(f) {
  const per100 = {};
  for (const n of f.foodNutrients || []) {
    const k = NUMBERS[String(n.nutrientNumber)];
    if (k && Number.isFinite(n.value) && (k !== 'kcal' || String(n.unitName).toUpperCase() === 'KCAL')) per100[k] = n.value;
  }
  if ([per100.kcal, per100.protein, per100.fat, per100.carb].some(v => v == null) || per100.kcal > 950) return null;
  const brand = title(f.brandName || f.brandOwner), name = title(f.description);
  const unit = String(f.servingSizeUnit || '').toLowerCase();
  // Branded values are per 100 g, or per 100 ml for drinks; a millilitre of most drinks weighs about a gram.
  const g = Number(f.servingSize) > 0 && ['g', 'grm', 'ml', 'mlt'].includes(unit) ? Number(f.servingSize) : null;
  return {
    id: f.fdcId, src: SRC, desc: `${brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ` : ''}${name}`.slice(0, 120),
    per100: Object.fromEntries(Object.entries(per100).map(([k, v]) => [k, r2(v)])),
    portions: g ? [[`1 serving${f.householdServingFullText ? ` (${f.householdServingFullText.toLowerCase()})` : ''}`, Math.round(g * 10) / 10]] : [],
  };
}

export function brandedTool({ apiKey, onStep }) {
  return {
    name: 'search_branded',
    description: 'Search USDA Branded Foods: nutrition labels submitted by manufacturers for US packaged products. Use for a named brand or packaged product. Returns up to 6 matches with id, description, kcal and grams of protein, total carbohydrate and fat per 100 g, and the label serving size in grams.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Product name and flavor, e.g. "clif bar chocolate chip"' },
        brand: { type: 'string', description: 'Optional brand owner, e.g. "Clif Bar and Company"' },
      },
      required: ['query'],
    },
    async execute(input) {
      const q = String(input?.query ?? '').trim().slice(0, 100);
      if (!q) throw new Error('query is required');
      const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
      url.search = new URLSearchParams({ api_key: apiKey || 'DEMO_KEY', query: q, dataType: 'Branded', pageSize: '6', ...(input?.brand ? { brandOwner: String(input.brand).slice(0, 80) } : {}) });
      let res;
      try { res = await fetch(url); } catch { return { results: [], error: 'Could not reach USDA. Use the label or another source.' }; }
      if (res.status === 429) {
        onStep?.('USDA branded lookups hit the hourly limit');
        return { results: [], error: 'Hourly lookup limit reached. Use the label in the photo or another source.' };
      }
      if (!res.ok) return { results: [], error: `USDA returned an error (HTTP ${res.status}). Use another source.` };
      const foods = ((await res.json()).foods || []).map(toFood).filter(Boolean);
      addFoods(foods);
      onStep?.(`Checked USDA branded labels for “${q}”: ${foods.length ? `${foods.length} match${foods.length === 1 ? '' : 'es'}` : 'no matches'}`);
      if (!foods.length) return { results: [], hint: 'No matching product. Try the product name without the brand, or another source.' };
      return {
        results: foods.map(f => ({
          id: String(f.id), description: f.desc,
          per100g: { kcal: f.per100.kcal, protein_g: f.per100.protein, carbs_g: f.per100.carb, fat_g: f.per100.fat },
          serving: f.portions[0] ? `${f.portions[0][0]} = ${f.portions[0][1]} g` : null,
        })),
      };
    },
  };
}
