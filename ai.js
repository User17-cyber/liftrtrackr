// Photo analysis through the Claude API, called straight from the phone with the user's own key.
// The SDK's tool runner drives the loop: Claude calls the page's tools (search_foods, run here against
// the bundled food tables, and search_branded, a live USDA Branded Foods lookup), may use Anthropic's
// server-side web search and fetch for other branded or missing foods, and finishes by calling
// submit_meal, whose strict schema guarantees a well-formed result.
import Anthropic, { betaTool } from './vendor/anthropic-sdk.js';

// Prices per million tokens, used only for the "about N¢" note after each analysis.
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most accurate. Roughly 8–15¢ a photo.', fallbacks: true, dynamicWeb: true, price: { in: 4, out: 20, read: 0.2 } },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster. Roughly 4–8¢ a photo.', fallbacks: true, dynamicWeb: true, price: { in: 2, out: 10, read: 0.2 } },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Cheapest, about 1¢ a photo, but less reliable with portions.', fallbacks: false, dynamicWeb: false, price: { in: 0.1, out: 0.5, read: 0.01 } },
];
export const DEFAULT_MODEL = MODELS[0].id;
const WEB_SEARCH_USD = 0.01;
const modelFor = id => MODELS.find(m => m.id === id) || MODELS[0];

const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const PER_SERVING = {
  type: 'object',
  properties: {
    serving_label: { type: 'string' }, serving_g: { type: 'number' },
    kcal: { type: 'number' }, protein_g: { type: 'number' }, carbs_g: { type: 'number' }, fat_g: { type: 'number' },
    fiber_g: nullable({ type: 'number' }), sugar_g: nullable({ type: 'number' }), sodium_mg: nullable({ type: 'number' }), satfat_g: nullable({ type: 'number' }),
  },
  required: ['serving_label', 'serving_g', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg', 'satfat_g'],
  additionalProperties: false,
};
const STATED = {
  type: 'object',
  description: 'Numbers the person stated for this food, for the amount eaten',
  properties: { kcal: nullable({ type: 'number' }), protein_g: nullable({ type: 'number' }), carbs_g: nullable({ type: 'number' }), fat_g: nullable({ type: 'number' }) },
  required: ['kcal', 'protein_g', 'carbs_g', 'fat_g'],
  additionalProperties: false,
};
const SUBMIT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short meal name, 2 to 6 words' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          source: { type: 'string', enum: ['database', 'web', 'label', 'knowledge'] },
          food_id: nullable({ type: 'string' }),
          query: { type: 'string' },
          brand: nullable({ type: 'string' }),
          per_serving: nullable(PER_SERVING),
          source_url: nullable({ type: 'string' }),
          source_title: nullable({ type: 'string' }),
          stated: nullable(STATED),
          grams: { type: 'number' },
          grams_low: { type: 'number', description: 'Low end of the honest range for grams eaten' },
          grams_high: { type: 'number', description: 'High end of the honest range for grams eaten' },
          from: nullable({ type: 'integer', description: 'When refining an estimate: the number of the existing food this item continues; null for a new food or a first estimate' }),
          size_options: nullable({ type: 'array', description: 'For at most two uncertain items: 3 recognisable amounts with grams', items: { type: 'object', properties: { label: { type: 'string' }, grams: { type: 'number' } }, required: ['label', 'grams'], additionalProperties: false } }),
          basis: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['label', 'source', 'food_id', 'query', 'brand', 'per_serving', 'source_url', 'source_title', 'stated', 'grams', 'grams_low', 'grams_high', 'size_options', 'from', 'basis', 'confidence'],
        additionalProperties: false,
      },
    },
    addons: {
      type: 'array',
      description: 'Up to 3 likely but unseen additions, such as cooking oil, each as a yes/no question',
      items: {
        type: 'object',
        properties: { question: { type: 'string' }, label: { type: 'string' }, food_id: nullable({ type: 'string' }), query: { type: 'string' }, grams: { type: 'number' } },
        required: ['question', 'label', 'food_id', 'query', 'grams'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string' },
  },
  required: ['title', 'items', 'addons', 'notes'],
  additionalProperties: false,
};

function client(apiKey) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
}

// One error shape for the UI: {code, message}.
function toAppError(e) {
  if (e instanceof Anthropic.APIUserAbortError) return { code: 'cancelled' };
  if (e instanceof Anthropic.AuthenticationError) return { code: 'bad_key' };
  if (e instanceof Anthropic.PermissionDeniedError) return { code: 'no_access', message: e.message };
  if (e instanceof Anthropic.NotFoundError) return { code: 'no_model', message: e.message };
  if (e instanceof Anthropic.RateLimitError) return { code: 'rate_limited' };
  if (e instanceof Anthropic.BadRequestError) return { code: 'bad_request', message: e.message };
  if (e instanceof Anthropic.APIConnectionError) return { code: 'offline' };
  if (e instanceof Anthropic.APIError) return { code: 'upstream', message: e.message };
  return e?.code ? e : { code: 'upstream', message: String(e?.message || e) };
}

// Checks a key without spending anything: retrieving a model's details is free.
export async function checkKey(apiKey, model) {
  try { await client(apiKey).models.retrieve(modelFor(model).id); return { ok: true }; }
  catch (e) { return { ok: false, ...toAppError(e) }; }
}

function costOf(usages, price) {
  let usd = 0;
  for (const u of usages) {
    usd += ((u.input_tokens || 0) * price.in + (u.cache_creation_input_tokens || 0) * price.in * 1.25
      + (u.cache_read_input_tokens || 0) * price.read + (u.output_tokens || 0) * price.out) / 1e6;
    usd += (u.server_tool_use?.web_search_requests || 0) * WEB_SEARCH_USD;
  }
  return usd;
}

function webTools(m) {
  return m.dynamicWeb
    ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }, { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }]
    : [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3 }];
}

// Progress lines for server-side web activity, read from each assistant turn.
function reportWeb(message, onStep) {
  for (const b of message.content || []) {
    if (b.type !== 'server_tool_use') continue;
    if (b.name === 'web_search' && b.input?.query) onStep?.(`Searched the web for “${String(b.input.query).slice(0, 80)}”`);
    if (b.name === 'web_fetch' && b.input?.url) { try { onStep?.(`Read ${new URL(b.input.url).hostname}`); } catch { /* ignore */ } }
  }
}

async function run(apiKey, params, signal, onStep) {
  const usages = [];
  let final = null, submitted = null;
  const runner = client(apiKey).beta.messages.toolRunner(params, { signal });
  for await (const message of runner) {
    usages.push(message.usage || {});
    final = message;
    reportWeb(message, onStep);
    const sub = message.content.find(b => b.type === 'tool_use' && b.name === 'submit_meal');
    if (sub) { submitted = sub.input; break; }
    // A long server-side search turn can pause; hand it back so it resumes.
    if (message.stop_reason === 'pause_turn') runner.pushMessages({ role: 'assistant', content: message.content });
  }
  return { usages, final, submitted };
}

/**
 * Runs one analysis. `tools` are page tools, each {name, description, inputSchema, execute(input)}.
 * With `web`, Claude may also search the web. Resolves {reply, usd, webUnavailable}; rejects {code, message}.
 */
export async function analyzeMeal({ apiKey, model, prompt, images = [], tools, signal, web = true, onStep, effort = 'medium' }) {
  const m = modelFor(model);
  const pageTools = tools.map(t => betaTool({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    run: async input => JSON.stringify(await t.execute(input)),
  }));
  const submitTool = {
    ...betaTool({
      name: 'submit_meal',
      description: 'Record the finished analysis. Call this exactly once, at the end, instead of replying with text.',
      inputSchema: SUBMIT_SCHEMA,
      run: () => 'Recorded.',
    }),
    strict: true,
  };
  const content = [];
  // Each photo is numbered so the prompt can say what it shows (the meal, another angle, leftovers).
  images.forEach((data, i) => {
    if (images.length > 1) content.push({ type: 'text', text: `Photo ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
  });
  content.push({ type: 'text', text: prompt(web) });
  const params = {
    model: m.id,
    max_tokens: 16000,
    cache_control: { type: 'ephemeral' },
    output_config: { effort },
    tools: [...pageTools, submitTool, ...(web ? webTools(m) : [])],
    max_iterations: 10,
    messages: [{ role: 'user', content }],
  };
  // On a safety-classifier decline, re-run on Anthropic's recommended model instead of failing.
  if (m.fallbacks) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }

  let out, webUnavailable = false;
  try {
    out = await run(apiKey, params, signal, onStep);
  } catch (e) {
    const err = toAppError(e);
    // Web search can be turned off for an Anthropic organization; fall back to USDA and labels only.
    if (!(web && err.code === 'bad_request')) throw err;
    webUnavailable = true;
    content[content.length - 1] = { type: 'text', text: prompt(false) };
    try { out = await run(apiKey, { ...params, tools: [...pageTools, submitTool] }, signal, onStep); }
    catch (e2) { throw toAppError(e2); }
  }

  const usd = costOf(out.usages, m.price);
  if (out.submitted) return { reply: out.submitted, usd, webUnavailable };
  const final = out.final;
  if (!final) throw { code: 'upstream', message: 'No response.' };
  if (final.stop_reason === 'refusal') throw { code: 'refused' };
  if (final.stop_reason === 'max_tokens') throw { code: 'truncated' };
  // No submit_meal call: accept a JSON reply in text as a last resort.
  const text = final.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return { reply: JSON.parse(json), usd, webUnavailable }; }
  catch { throw { code: final.stop_reason === 'tool_use' ? 'incomplete' : 'invalid_json' }; }
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
