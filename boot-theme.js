// Applies the saved theme and color scheme before the first paint, so the page never flashes the default.
try {
  const p = JSON.parse(localStorage.getItem('liftrtrackr-appearance') || '{}');
  if (p.scheme === 'light' || p.scheme === 'dark') document.documentElement.dataset.scheme = p.scheme;
  if (p.accent && p.accent !== 'spinach') document.documentElement.dataset.accent = p.accent;
} catch { /* storage blocked: defaults apply */ }
