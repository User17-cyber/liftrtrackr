// Where the log lives. Signed in on claude.ai, each person's profile, settings, meals, weigh-ins and lifting go to their own
// private subtree of the artifact's database (data/users/<id>/...), which nobody else can read.
// Anywhere else the page falls back to this browser's localStorage.

const LS_KEY = 'plate-ledger-v1';
const WINDOW_DAYS = 60;

export async function openStore(onChange) {
  let db = null, uid = null;
  try {
    if (window.claude?.use) {
      const [d, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      uid = user ? await user.id() : null;
      db = d;
    }
  } catch { db = null; }
  return db && uid ? cloudStore(db, uid, onChange) : localStore(onChange);
}

function cloudStore(db, uid, onChange) {
  const base = `data/users/${uid}`;
  const profileRef = db.doc(`${base}/profile`);
  const daysCol = db.doc(`${base}/journal`).collection('days');
  // All weigh-ins live in one document: ~30 bytes each, so decades of daily entries fit.
  const weightsRef = db.doc(`${base}/weights`);
  const prefsRef = db.doc(`${base}/prefs`);
  const liftsCol = db.doc(`${base}/training`).collection('sessions');
  const state = { profile: null, days: {}, weights: null, prefs: null, lifts: {}, profileLoaded: false };
  const queues = new Map();
  // One write at a time per document.
  const enqueue = (key, fn) => {
    const p = (queues.get(key) || Promise.resolve()).catch(() => {}).then(fn);
    queues.set(key, p);
    return p;
  };
  const fail = error => onChange({ error });

  profileRef.onSnapshot(s => {
    state.profile = s.exists ? s.data() : null;
    state.profileLoaded = true;
    onChange({});
  }, fail);

  prefsRef.onSnapshot(s => { state.prefs = s.exists ? s.data() : null; onChange({}); }, fail);

  weightsRef.onSnapshot(s => {
    state.weights = s.exists ? s.data() : null;
    onChange({});
  }, fail);

  // Newest 1,000 sessions (about six years of training) feed the progress charts.
  liftsCol.orderBy('date', 'desc').limit(1000).onSnapshot(q => {
    for (const ch of q.docChanges()) {
      if (ch.type === 'removed') delete state.lifts[ch.doc.id];
      else state.lifts[ch.doc.id] = ch.doc.data();
    }
    onChange({});
  }, fail);

  daysCol.orderBy('date', 'desc').limit(WINDOW_DAYS).onSnapshot(q => {
    for (const ch of q.docChanges()) {
      if (ch.type === 'removed') delete state.days[ch.doc.id];
      else state.days[ch.doc.id] = ch.doc.data();
    }
    onChange({});
  }, fail);

  return {
    kind: 'cloud',
    get profile() { return state.profile; },
    get profileLoaded() { return state.profileLoaded; },
    get days() { return state.days; },
    get weights() { return state.weights; },
    get lifts() { return state.lifts; },
    get prefs() { return state.prefs; },
    async ensureDay(date) {
      if (state.days[date]) return;
      const s = await daysCol.doc(date).get();
      if (s.exists) { state.days[date] = s.data(); onChange({}); }
    },
    saveDay(date, doc) {
      const prev = state.days[date];
      state.days[date] = doc;
      onChange({});
      return enqueue(date, () => (doc.entries.length ? daysCol.doc(date).set(doc) : daysCol.doc(date).delete()))
        .catch(e => { if (prev) state.days[date] = prev; else delete state.days[date]; onChange({}); throw e; });
    },
    saveProfile(p) {
      const prev = state.profile;
      state.profile = p;
      onChange({});
      return enqueue('profile', () => profileRef.set(p))
        .catch(e => { state.profile = prev; onChange({}); throw e; });
    },
    saveLift(date, doc) {
      const prev = state.lifts[date];
      if (doc.exercises.length) state.lifts[date] = { ...doc, date }; else delete state.lifts[date];
      onChange({});
      return enqueue(`lift:${date}`, () => (doc.exercises.length ? liftsCol.doc(date).set({ ...doc, date }) : liftsCol.doc(date).delete()))
        .catch(e => { if (prev) state.lifts[date] = prev; else delete state.lifts[date]; onChange({}); throw e; });
    },
    savePrefs(p) {
      const prev = state.prefs;
      state.prefs = p;
      onChange({});
      return enqueue('prefs', () => prefsRef.set(p)).catch(e => { state.prefs = prev; onChange({}); throw e; });
    },
    saveWeights(doc) {
      const prev = state.weights;
      state.weights = doc;
      onChange({});
      return enqueue('weights', () => weightsRef.set(doc))
        .catch(e => { state.weights = prev; onChange({}); throw e; });
    },
  };
}

function localStore(onChange) {
  let saved = { profile: null, days: {}, weights: null, prefs: null, lifts: {} };
  try { saved = JSON.parse(localStorage.getItem(LS_KEY)) || saved; } catch { /* storage blocked */ }
  const persist = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(saved)); return true; } catch { return false; }
  };
  queueMicrotask(() => onChange({}));
  return {
    kind: 'local',
    get profile() { return saved.profile; },
    get profileLoaded() { return true; },
    get days() { return saved.days; },
    get weights() { return saved.weights; },
    get lifts() { return (saved.lifts ||= {}); },
    get prefs() { return saved.prefs; },
    async ensureDay() {},
    async saveDay(date, doc) {
      if (doc.entries.length) saved.days[date] = doc; else delete saved.days[date];
      onChange({});
      if (!persist()) throw { code: 'local_full', message: 'This browser refused to save.' };
    },
    async saveProfile(p) {
      saved.profile = p;
      onChange({});
      if (!persist()) throw { code: 'local_full', message: 'This browser refused to save.' };
    },
    async saveLift(date, doc) {
      saved.lifts ||= {};
      if (doc.exercises.length) saved.lifts[date] = doc; else delete saved.lifts[date];
      onChange({});
      if (!persist()) throw { code: 'local_full', message: 'This browser refused to save.' };
    },
    async savePrefs(p) {
      saved.prefs = p;
      onChange({});
      if (!persist()) throw { code: 'local_full', message: 'This browser refused to save.' };
    },
    async saveWeights(doc) {
      saved.weights = doc;
      onChange({});
      if (!persist()) throw { code: 'local_full', message: 'This browser refused to save.' };
    },
  };
}
