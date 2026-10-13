// The log lives on this device in IndexedDB: one record each for the profile and the weigh-ins,
// one per day of meals ("day:YYYY-MM-DD") and one per day of lifting ("lift:YYYY-MM-DD").
// Everything is read into memory at start so the UI can render synchronously; each save writes
// one record. Export/import gives a JSON backup.

const DB_NAME = 'plate-ledger';
const STORE = 'kv';
const DAY = 'day:';
const LIFT = 'lift:';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || { code: 'local_full' });
  });
}

export async function openStore(onChange) {
  const state = { profile: null, weights: null, prefs: null, days: {}, lifts: {} };
  let db = null;
  try {
    db = await openDb();
    const [keys, values] = await Promise.all([
      tx(db, 'readonly', s => s.getAllKeys()),
      tx(db, 'readonly', s => s.getAll()),
    ]);
    keys.forEach((k, i) => {
      if (k === 'profile') state.profile = values[i];
      else if (k === 'weights') state.weights = values[i];
      else if (k === 'prefs') state.prefs = values[i];
      else if (String(k).startsWith(DAY)) state.days[k.slice(DAY.length)] = values[i];
      else if (String(k).startsWith(LIFT)) state.lifts[k.slice(LIFT.length)] = values[i];
    });
  } catch { db = null; }
  navigator.storage?.persist?.().catch(() => {});

  const write = (key, value) => {
    if (!db) return Promise.reject({ code: 'no_storage' });
    return tx(db, 'readwrite', s => (value == null ? s.delete(key) : s.put(value, key)));
  };
  const save = async (key, value, apply) => {
    apply(value);
    onChange({});
    try { await write(key, value); } catch (e) { throw e?.code ? e : { code: 'local_full' }; }
  };

  queueMicrotask(() => onChange({}));
  return {
    kind: db ? 'device' : 'memory',
    get profile() { return state.profile; },
    get profileLoaded() { return true; },
    get days() { return state.days; },
    get weights() { return state.weights; },
    get lifts() { return state.lifts; },
    get prefs() { return state.prefs; },
    async ensureDay() {},
    saveDay(date, doc) {
      return save(DAY + date, doc.entries.length ? doc : null, v => { if (v) state.days[date] = v; else delete state.days[date]; });
    },
    saveProfile(p) { return save('profile', p, v => { state.profile = v; }); },
    saveWeights(doc) { return save('weights', doc, v => { state.weights = v; }); },
    savePrefs(p) { return save('prefs', p, v => { state.prefs = v; }); },
    saveLift(date, doc) {
      return save(LIFT + date, doc.exercises.length ? doc : null, v => { if (v) state.lifts[date] = v; else delete state.lifts[date]; });
    },

    exportData() {
      return { app: 'plate-ledger', version: 1, exportedAt: new Date().toISOString(), profile: state.profile, weights: state.weights, prefs: state.prefs, days: state.days, lifts: state.lifts };
    },
    // Replaces everything with a backup made by exportData().
    async importData(data) {
      if (!db) throw { code: 'no_storage' };
      await tx(db, 'readwrite', s => {
        s.clear();
        if (data.profile) s.put(data.profile, 'profile');
        if (data.weights) s.put(data.weights, 'weights');
        if (data.prefs) s.put(data.prefs, 'prefs');
        for (const [d, doc] of Object.entries(data.days || {})) s.put(doc, DAY + d);
        for (const [d, doc] of Object.entries(data.lifts || {})) s.put(doc, LIFT + d);
      });
      state.profile = data.profile || null;
      state.weights = data.weights || null;
      state.prefs = data.prefs || null;
      state.days = { ...(data.days || {}) };
      state.lifts = { ...(data.lifts || {}) };
      onChange({});
    },
  };
}

// Combines a backup with this device's log so nothing on either side is lost: meals match by id,
// weigh-ins and lifting sessions by date (this device's version wins), exercises within a session by name.
export function mergeBackup(cur, data) {
  const days = { ...(data.days || {}) };
  for (const [d, doc] of Object.entries(cur.days || {})) {
    const ids = new Set(doc.entries.map(e => e.id));
    days[d] = { ...doc, entries: [...doc.entries, ...(days[d]?.entries || []).filter(e => !ids.has(e.id))] };
  }
  const lifts = { ...(data.lifts || {}) };
  const key = x => String(x?.name || '').trim().toLowerCase();
  for (const [d, doc] of Object.entries(cur.lifts || {})) {
    const names = new Set(doc.exercises.map(key));
    lifts[d] = { ...doc, exercises: [...doc.exercises, ...(lifts[d]?.exercises || []).filter(x => !names.has(key(x)))] };
  }
  const byDay = new Map((data.weights?.entries || []).map(w => [w.d, w]));
  for (const w of cur.weights?.entries || []) byDay.set(w.d, w);
  const weights = cur.weights || data.weights
    ? { entries: [...byDay.values()].sort((a, b) => String(a.d).localeCompare(String(b.d))), goalKg: cur.weights?.goalKg ?? data.weights?.goalKg ?? null }
    : null;
  return { ...data, profile: cur.profile || data.profile || null, prefs: cur.prefs || data.prefs || null, weights, days, lifts };
}

// Checks a parsed backup file before anything is replaced.
export function validateBackup(data) {
  if (!data || data.app !== 'plate-ledger' || data.version !== 1) return 'This file is not a LiftrTrackr backup.';
  if (data.days && typeof data.days !== 'object') return 'The backup’s meal log is damaged.';
  for (const [d, doc] of Object.entries(data.days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Array.isArray(doc?.entries)) return `The backup’s entry for ${d} is damaged.`;
  }
  if (data.weights && !Array.isArray(data.weights.entries)) return 'The backup’s weigh-ins are damaged.';
  for (const [d, doc] of Object.entries(data.lifts || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Array.isArray(doc?.exercises)) return `The backup’s lifting session for ${d} is damaged.`;
  }
  return null;
}
