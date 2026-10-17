// What Claude is asked, and how its answer becomes loggable items. Foods resolve to an entry in one of
// the food composition databases (food_id): the bundled USDA, Canadian, UK, French and Australian tables,
// or, in the installed app, USDA Branded Foods looked up live. Foods none of them carry, such as most
// restaurant items, carry their own per-100 g values plus where they came from: a web page (cited), the
// package label in the photo, or Claude's knowledge of the published label (marked unverified).
import { getFood, search, getPortions, datasetName, foodUrl, REGIONS } from './usda.js';

const clampG = g => Math.min(3000, Math.max(1, Math.round(g)));
const ORIGIN_CHIP = { web: 'Web', label: 'Label', knowledge: 'Claude', stated: 'You' };
const numOrNull = v => (v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

/* ---------- prompts ---------- */

const ITEM_SHAPE = `{"label": string, "source": "database" | "web" | "label" | "knowledge", "food_id": string or null, "query": string, "brand": string or null,
  "per_serving": null or {"serving_label": string, "serving_g": number, "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number or null, "sugar_g": number or null, "sodium_mg": number or null, "satfat_g": number or null},
  "source_url": string or null, "source_title": string or null,
  "stated": null or {"kcal": number or null, "protein_g": number or null, "carbs_g": number or null, "fat_g": number or null},
  "grams": number, "basis": string, "confidence": "high" | "medium" | "low"}`;

// The person's own words come first: stated numbers, amounts, brands and preparation override
// the photo and every database.
const READ_FIRST = [
  'Read the person\'s description first, closely and word by word. It overrides the photo and every database:',
  '- Calories, protein, carbs or fat stated for a food go in that item\'s "stated" field exactly as given, for the amount they ate (for example "190 cal" gives stated.kcal 190). Never replace a stated number with a database value. Still find the closest source for the food, which supplies anything they didn\'t state.',
  '- If they give one total for several foods, split it across the items in proportion to your estimates and say so in notes.',
  '- Amounts ("half", "2 slices", "150 g", "16 oz", "a large") set the grams.',
  '- Brand, flavor, size and preparation ("fried", "no cheese", "with oat milk") decide which entry you choose.',
  '- Use their wording for each label.',
  'Set "stated" to null for items where they gave no numbers.',
].join('\n');

function sourceRules({ tools, web, branded }) {
  return [
    tools
      ? '- Generic foods and dishes: call search_foods with a short plain query such as "chicken thigh roasted" or "rice white cooked" (several at once is fine; retry other wording once if results are poor). It searches USDA FoodData Central (FNDDS entries describe foods as eaten; SR Legacy and Foundation entries are single ingredients) plus the Canadian, UK, French and Australian national food tables, which carry regional foods and dishes USDA lacks (pass database "uk", "canada", "france" or "australia" to search one). Match form and cooking method. Use source "database" with that result\'s id as food_id.'
      : '- Generic foods and dishes: use source "database", food_id null, and a short plain query such as "chicken thigh roasted".',
    '- Branded, packaged or restaurant foods (a brand is visible or named), and foods no database search matches reasonably:',
    '  * If the package\'s Nutrition Facts label is readable in the photo, read the values from it (source "label").',
    branded ? '  * Otherwise, for US packaged products, call search_branded with the brand and product name: it returns manufacturer-submitted labels from USDA Branded Foods. Use source "database" with that result\'s id as food_id when one matches the product.' : '',
    web
      ? '  * Otherwise use web_search to find the official nutrition facts: the brand\'s or restaurant\'s own site first, then reputable nutrition databases. Use web_fetch to read a page when snippets lack the numbers. Use source "web" and give source_url and source_title for the page the numbers came from.'
      : '  * Otherwise, if you reliably know the product\'s published label, use it (source "knowledge"; confidence "low" unless certain). If you don\'t, use the closest database entry instead.',
    '  For label, web and knowledge items, set brand, leave food_id null, and fill per_serving exactly as published, in kcal and grams (convert kJ at 4.184 kJ per kcal): serving_label (such as "1 bar (60 g)"), serving_g (grams per serving; estimate it if only a count or volume is given, and say so in basis), kcal, protein_g, carbs_g (total carbohydrate), fat_g, and fiber_g, sugar_g, sodium_mg, satfat_g when listed (null otherwise).',
    '- For database items set per_serving, source_url and source_title to null.',
  ].filter(Boolean).join('\n');
}

function outputRules(submit) {
  return submit
    ? 'When finished, call submit_meal once with the result instead of replying in text.'
    : `Reply with only JSON: {"title": "short meal name, 2 to 6 words", "items": [ ${ITEM_SHAPE} ], "notes": "one or two sentences on what is uncertain"}. If there is no food or drink, reply {"title": "", "items": [], "notes": "what you saw instead"}.`;
}

export function buildPrompt(note, hasPhoto, caps) {
  return [
    'You are helping a person log a meal in a calorie tracker. Every nutrient number must come from a stated source (a national food composition database, a nutrition label, or a cited web page), so identify the foods and their sources and estimate the grams eaten. Never make up nutrient values.',
    hasPhoto ? 'The attached photo shows the meal.' : 'There is no photo. Work from the description below.',
    note ? `The person's description of what they ate:\n"""${note}"""\n\n${READ_FIRST}` : '',
    '1. List each distinct food or drink. Split plates into components you can weigh, but keep a composite dish whole when it is likely listed as one (pizza slice, burrito, sandwich, a restaurant menu item). Include visible added fats, sauces and drinks. Note any brand names on packaging or in the note.',
    `2. Find each food's nutrition source:\n${sourceRules(caps)}`,
    '3. Estimate the edible grams eaten. Use scale cues (a dinner plate is about 26 cm across, a fork about 19 cm, a standard can 355 ml), the portion weights from searches, and for packaged foods the serving weight times the servings eaten. Leave out bones, peels and packaging.',
    `4. ${outputRules(caps.submit)}`,
  ].filter(Boolean).join('\n\n');
}

// One food the person typed into search, usually a brand USDA doesn't carry.
export function buildLookupPrompt(query, caps) {
  return [
    `Find the nutrition facts for this food so the person can log it:\n"""${query}"""`,
    READ_FIRST,
    'Never make up nutrient values. Use these sources:',
    sourceRules(caps),
    'Return exactly one item. Set grams to the amount described, or one typical serving if none is given.',
    outputRules(caps.submit),
  ].join('\n\n');
}

const REGION_NAMES = { usda: 'USDA', canada: 'Canadian', uk: 'UK', france: 'French', australia: 'Australian' };

export function searchTool(onStep) {
  return {
    name: 'search_foods',
    description: 'Search the national food composition databases bundled with this app: USDA FoodData Central (SR Legacy, FNDDS 2021-2023, Foundation Foods 2026), Canadian Nutrient File 2026, UK CoFID 2021, French Ciqual 2025 and Australian AFCD Release 3. Names are in English. Returns up to 8 matches with id, description, database, kcal and grams of protein, total carbohydrate and fat per 100 g, and common portion weights in grams.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Short food description, e.g. "salmon baked" or "crumpets toasted"' },
        database: { type: 'string', enum: REGIONS, description: 'Optional: search only one country\'s tables (usda, canada, uk, france or australia)' },
      },
      required: ['query'],
    },
    execute(input) {
      const q = String(input?.query ?? '').trim().slice(0, 80);
      if (!q) throw new Error('query is required');
      const region = REGIONS.includes(input?.database) ? input.database : null;
      const hits = search(q, 8, region);
      onStep?.(`Searched ${region ? `${REGION_NAMES[region]} food data` : 'food databases'} for “${q}”: ${hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'no matches'}`);
      if (!hits.length) return { results: [], hint: 'No matches. Try fewer or more generic words, another database, or another source if this is a branded food.' };
      return {
        results: hits.map(f => ({
          id: String(f.id), description: f.desc, database: datasetName(f),
          per100g: { kcal: f.per100.kcal, protein_g: f.per100.protein, carbs_g: f.per100.carb, fat_g: f.per100.fat },
          portions: getPortions(f.id).slice(0, 4).map(p => `${p.label} = ${p.g} g`),
        })),
      };
    },
  };
}

/* ---------- answers to items ---------- */

function toCustom(it) {
  let origin = ['web', 'label', 'knowledge'].includes(it.source) ? it.source : null;
  const ps = it.per_serving;
  if (!origin || !ps || typeof ps !== 'object') return null;
  const sg = Number(ps.serving_g);
  if (!(sg > 0 && sg <= 3000)) return null;
  const n = k => { const v = Number(ps[k]); return ps[k] != null && Number.isFinite(v) && v >= 0 ? v : null; };
  const kcal = n('kcal'), protein = n('protein_g'), carb = n('carbs_g'), fat = n('fat_g');
  if ([kcal, protein, carb, fat].some(v => v == null)) return null;
  const per = v => ((v ?? 0) / sg) * 100;
  const per100 = { kcal: per(kcal), protein: per(protein), carb: per(carb), fat: per(fat), fiber: per(n('fiber_g')), sugar: per(n('sugar_g')), sodium: per(n('sodium_mg')), satfat: per(n('satfat_g')) };
  // Nothing edible has more than ~900 kcal or 100 g of one macronutrient per 100 g.
  if (per100.kcal > 950 || per100.protein > 100 || per100.carb > 100 || per100.fat > 100) return null;
  let url = null;
  try { const u = new URL(String(it.source_url || '')); if (u.protocol === 'https:' || u.protocol === 'http:') url = u.href; } catch { /* no link */ }
  if (origin === 'web' && !url) origin = 'knowledge';
  return {
    origin, url,
    brand: it.brand ? String(it.brand).trim().slice(0, 60) : '',
    urlTitle: String(it.source_title || '').trim().slice(0, 120) || (url ? new URL(url).hostname : ''),
    per100,
    serving: { label: String(ps.serving_label || '1 serving').slice(0, 60), g: Math.round(sg * 10) / 10 },
  };
}

export function normalize(reply) {
  const raw = reply && typeof reply === 'object' && !Array.isArray(reply) ? reply : {};
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 20).map(it => {
    if (!it || typeof it !== 'object') return null;
    const label = String(it.label || '').trim().slice(0, 80);
    const g = Number(it.grams);
    const base = {
      grams: clampG(g > 0 ? g : 100), basis: String(it.basis || '').slice(0, 140),
      confidence: ['high', 'medium', 'low'].includes(it.confidence) ? it.confidence : 'medium',
    };
    const stated = it.stated && typeof it.stated === 'object' ? it.stated : null;
    const custom = toCustom(it);
    if (custom) return applyStated({ ...base, label: label || custom.brand || 'Food', fdcId: null, custom }, stated);
    const food = getFood(it.food_id ?? it.fdcId) || search(String(it.query || label), 1)[0];
    if (!food) return stated && numOrNull(stated.kcal) != null ? applyStated({ ...base, label: label || 'Food', fdcId: null, custom: null }, stated) : null;
    // Label or web numbers that failed the checks: keep the food, but as an uncertain database stand-in.
    if (it.source && !['database', 'usda', 'branded'].includes(it.source) && !stated) return { ...base, label: label || food.desc, fdcId: food.id, confidence: 'low', basis: 'Source values looked wrong, so this uses the closest database entry. Check it.' };
    return applyStated({ ...base, label: label || food.desc, fdcId: food.id }, stated);
  }).filter(Boolean);
  const title = String(raw.title || '').trim().slice(0, 80) || items.slice(0, 3).map(i => i.label).join(', ');
  return { title, items, notes: String(raw.notes || '').slice(0, 400) };
}

// Numbers the person gave (in their description, or typed into the editor) for the amount eaten.
// Stated calories and macros are used exactly; anything not stated is scaled from the matched food
// so its proportions carry over. The item keeps a link to that food as its reference.
export function applyStated(item, stated) {
  const g = item.grams;
  // Editing an item that already uses stated numbers: keep its reference food and earlier stated
  // macros (rescaled to the current amount) unless new values replace them.
  const prev = item.custom?.origin === 'stated' ? item.custom : null;
  const carried = k => (prev?.stated?.[k] != null ? prev.stated[k] * (g / (prev.statedGrams || g)) : null);
  const kcal = numOrNull(stated?.kcal) ?? (prev && stated?.kcal == null ? carried('kcal') : null);
  const protein = numOrNull(stated?.protein_g) ?? carried('protein');
  const carb = numOrNull(stated?.carbs_g) ?? carried('carb');
  const fat = numOrNull(stated?.fat_g) ?? carried('fat');
  if (kcal == null && protein == null && carb == null && fat == null) return item;
  const food = item.fdcId ? getFood(item.fdcId) : null;
  const zero = { kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0, satfat: 0 };
  const base = prev ? { ...prev.base100 } : item.custom ? { ...item.custom.per100 } : food ? { ...food.per100 } : zero;
  const per100 = { ...base };
  const toPer100 = v => (v / g) * 100;
  // Calories implied by stated macros alone (Atwater 4/4/9) when no calorie figure is given.
  const kcalTarget = kcal ?? (protein != null && carb != null && fat != null ? 4 * protein + 4 * carb + 9 * fat : null);
  if (kcalTarget != null) {
    const factor = base.kcal > 0 ? toPer100(kcalTarget) / base.kcal : 0;
    for (const k of Object.keys(per100)) per100[k] = base[k] * factor;
    per100.kcal = toPer100(kcalTarget);
  }
  if (protein != null) per100.protein = toPer100(protein);
  if (carb != null) per100.carb = toPer100(carb);
  if (fat != null) per100.fat = toPer100(fat);
  const ref = prev ? { text: prev.urlTitle, href: prev.url } : item.custom ? sourceInfo(item) : food ? { text: food.desc, href: foodUrl(food) } : null;
  return {
    ...item,
    fdcId: null,
    confidence: 'high',
    custom: {
      origin: 'stated', brand: item.custom?.brand || '', url: ref?.href || null, urlTitle: ref?.text || '',
      per100, base100: base, statedGrams: g,
      serving: item.custom?.serving || { label: `as described (${g} g)`, g },
      stated: { kcal, protein, carb, fat },
    },
  };
}

// The one calorie figure in a description, if there is exactly one ("protein bar, 190 cal").
export function statedCalories(text) {
  const found = [...String(text || '').matchAll(/(\d{2,5}(?:[.,]\d+)?)\s*(?:kcals?|k?cals?|calories)\b/gi)].map(m => Number(m[1].replace(',', '.')));
  return found.length === 1 && found[0] > 0 && found[0] < 20000 ? found[0] : null;
}

export function customNutrients(custom, grams) {
  const out = {};
  for (const [k, v] of Object.entries(custom.per100)) out[k] = (v * grams) / 100;
  return out;
}

// What to show (and link) as the source of an item's numbers.
export function sourceInfo(it) {
  if (it.custom) {
    const c = it.custom;
    if (c.origin === 'stated') {
      const which = ['kcal', 'protein', 'carb', 'fat'].filter(k => c.stated?.[k] != null).map(k => ({ kcal: 'calories', protein: 'protein', carb: 'carbs', fat: 'fat' })[k]);
      const text = `Your ${which.join(', ') || 'numbers'}${c.urlTitle ? ` · rest scaled from ${c.urlTitle}` : ''}`;
      return { chip: ORIGIN_CHIP.stated, text, href: c.url };
    }
    const text = c.origin === 'web' ? c.urlTitle || 'Web source'
      : c.origin === 'label' ? 'Read from the package label in your photo'
      : 'From Claude’s knowledge of the label, unverified: check the package';
    return { chip: ORIGIN_CHIP[c.origin], text: `${c.brand ? `${c.brand} · ` : ''}${text}`, href: c.origin === 'web' ? c.url : null };
  }
  const f = getFood(it.fdcId);
  return { chip: datasetName(f), text: f.desc, href: foodUrl(f) };
}
