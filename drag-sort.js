// Reorder a list by dragging. Press an item's handle and drag, or press and hold anywhere on the item
// that isn't a field or a button (with a mouse, just drag it). The other items slide aside to show
// where it will land, and the page scrolls when it's dragged near the top or bottom of the screen.
// The handle is a button: with the keyboard, the up and down arrow keys move the item one place.
// Built on pointer events because touch drag-and-drop isn't dependable in mobile Safari.
const HOLD_MS = 280, SLOP = 8;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// onMove(itemEl, from, to) changes the data and redraws, returning the moved item's new element;
// positions count items in the same parent.
export function sortable(container, { item, handle, onMove }) {
  let press = null, drag = null;
  const peers = el => [...el.parentElement.children].filter(c => c.matches(item));

  container.addEventListener('pointerdown', e => {
    if (e.button > 0 || drag) return;
    const el = e.target.closest(item);
    if (!el || !container.contains(el)) return;
    const onHandle = !!e.target.closest(handle);
    if (!onHandle && e.target.closest('input, textarea, select, button, a, label')) return;
    press = { el, id: e.pointerId, x: e.clientX, y: e.clientY, onHandle, mouse: e.pointerType === 'mouse', timer: null };
    if (onHandle) start(e);
    else if (!press.mouse) press.timer = setTimeout(() => press && start(e), HOLD_MS);
  });

  container.addEventListener('pointermove', e => {
    if (drag && e.pointerId === drag.id) { drag.y = e.clientY; place(); return; }
    if (!press || e.pointerId !== press.id) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    // A finger that moves before the hold completes is scrolling the page, not dragging.
    if (!press.mouse && moved > SLOP) { cancelPress(); return; }
    if (press.mouse && moved > 4) start(e);
  });

  const finish = e => {
    if (press && e.pointerId === press.id) cancelPress();
    if (drag && e.pointerId === drag.id) end(e.type !== 'pointercancel');
  };
  container.addEventListener('pointerup', finish);
  container.addEventListener('pointercancel', finish);
  // Once a hold has turned into a drag, stop the page scrolling under the finger (iOS needs this).
  container.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
  container.addEventListener('contextmenu', e => { if (drag || press) e.preventDefault(); });
  // Swallow the click that ends a drag, so nothing behind it is pressed.
  container.addEventListener('click', e => { if (container.dataset.justDragged) { e.preventDefault(); e.stopPropagation(); delete container.dataset.justDragged; } }, true);

  container.addEventListener('keydown', e => {
    const h = e.target.closest(handle);
    if (!h || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const el = h.closest(item), list = peers(el), from = list.indexOf(el), to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= list.length) return;
    // The caller redraws: put focus back on the moved item's handle.
    onMove(el, from, to)?.querySelector(handle)?.focus();
  });

  function cancelPress() { clearTimeout(press?.timer); press = null; }

  function start(e) {
    const el = press.el;
    clearTimeout(press.timer);
    const list = peers(el), rects = list.map(x => x.getBoundingClientRect());
    const from = list.indexOf(el), gap = list.length > 1 ? rects[Math.min(1, list.length - 1)].top - rects[0].bottom : 0;
    drag = { el, id: press.id, list, rects, from, to: from, startY: press.y, y: e.clientY, scroll0: scrollY, step: rects[from].height + Math.max(0, gap), frame: 0 };
    press = null;
    try { el.setPointerCapture(drag.id); } catch { /* the pointer may already be gone */ }
    el.classList.add('dragging');
    container.classList.add('sorting');
    navigator.vibrate?.(10);
    place();
    autoScroll();
  }

  // Moves the dragged item with the pointer and slides the others to open a gap where it would land.
  function place() {
    const d = drag, dy = d.y - d.startY + (scrollY - d.scroll0);
    d.el.style.transform = `translateY(${dy}px)`;
    const mid = d.rects[d.from].top + d.rects[d.from].height / 2 + dy;
    let to = d.from;
    d.list.forEach((x, i) => {
      if (x === d.el) return;
      const r = d.rects[i], c = r.top + r.height / 2;
      let shift = 0;
      if (i > d.from && mid > c) { shift = -d.step; to = Math.max(to, i); }
      if (i < d.from && mid < c) { shift = d.step; to = Math.min(to, i); }
      x.style.transform = shift ? `translateY(${shift}px)` : '';
    });
    d.to = to;
  }

  function autoScroll() {
    if (!drag) return;
    const edge = 72, y = drag.y;
    const v = y < edge ? -Math.ceil((edge - y) / 6) : y > innerHeight - edge ? Math.ceil((y - (innerHeight - edge)) / 6) : 0;
    if (v) { scrollBy(0, v); place(); }
    drag.frame = requestAnimationFrame(autoScroll);
  }

  function end(commit) {
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.frame);
    container.dataset.justDragged = '1';
    setTimeout(() => delete container.dataset.justDragged, 0);
    const settle = () => {
      d.el.classList.remove('dragging');
      container.classList.remove('sorting');
      d.list.forEach(x => { x.style.transform = ''; });
      if (commit && d.to !== d.from) onMove(d.el, d.from, d.to);
    };
    if (!commit || reduceMotion()) return settle();
    // Glide into the opened gap before the list is redrawn in its new order.
    const r = d.rects, top = d.to > d.from ? r[d.to].bottom - r[d.from].height : r[d.to].top;
    d.el.style.transition = 'transform .16s cubic-bezier(0.25, 1, 0.5, 1)';
    d.el.style.transform = `translateY(${top - r[d.from].top}px)`;
    setTimeout(() => { d.el.style.transition = ''; settle(); }, 170);
  }
}
