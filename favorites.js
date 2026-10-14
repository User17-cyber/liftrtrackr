// Favorite foods: a name with its calories and macros for one serving, kept per person in one
// document beside the log (so they sync on claude.ai and travel in backups). A name identifies a
// favorite, ignoring case; the most recently used come first.
const MAX = 200;
const r1 = n => Math.round(Number(n || 0) * 10) / 10;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const favKey = s => String(s || '').trim().toLowerCase();

export function listFavorites(store) {
  const items = Array.isArray(store?.favorites?.items) ? store.favorites.items : [];
  return [...items].sort((a, b) => String(b.used || '').localeCompare(String(a.used || '')));
}

export const findFavorite = (store, label) => (favKey(label) ? listFavorites(store).find(f => favKey(f.label) === favKey(label)) || null : null);

// Adds a favorite, or replaces the one with the same name. `n` is for one serving.
export function saveFavorite(store, { label, n, grams = null }) {
  const name = String(label || '').trim().slice(0, 80);
  const prev = findFavorite(store, name);
  const fav = {
    id: prev?.id || uid(), label: name, used: new Date().toISOString(),
    n: { kcal: Math.round(Number(n?.kcal) || 0), protein: r1(n?.protein), carb: r1(n?.carb), fat: r1(n?.fat) },
    grams: grams > 0 ? Math.round(grams) : null,
  };
  const rest = listFavorites(store).filter(f => f.id !== fav.id && favKey(f.label) !== favKey(name));
  return store.saveFavorites({ items: [fav, ...rest].slice(0, MAX) });
}

export const removeFavorite = (store, id) => store.saveFavorites({ items: listFavorites(store).filter(f => f.id !== id) });

// Moves a favorite to the front after it is logged.
export function touchFavorite(store, id) {
  const items = listFavorites(store);
  const f = items.find(x => x.id === id);
  if (!f) return Promise.resolve();
  return store.saveFavorites({ items: [{ ...f, used: new Date().toISOString() }, ...items.filter(x => x.id !== id)] });
}
