// Rest timer between sets. Counts down from an end time (so it stays right when the phone sleeps or
// the tab is in the background), then vibrates where the phone allows it and shows a message.
// The length last used is remembered on this device.
const $ = id => document.getElementById(id);
const KEY = 'liftrtrackr-rest';
let ctx, end = 0, tick = null, length = 90;

try { length = Math.min(600, Math.max(15, Number(localStorage.getItem(KEY)) || 90)); } catch { /* default */ }
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function initRestTimer(c) {
  ctx = c;
  $('rest-timer').addEventListener('click', e => {
    const b = e.target.closest('[data-rest]');
    if (!b) return;
    if (b.dataset.rest === 'stop') return stop();
    const delta = Number(b.dataset.rest);
    length = Math.min(600, Math.max(15, length + delta));
    end = Math.max(Date.now() + 1000, end + delta * 1000);
    try { localStorage.setItem(KEY, String(length)); } catch { /* ignore */ }
    document.querySelectorAll('[data-act="rest"]').forEach(btn => { btn.textContent = restLabel(); });
    draw();
  });
  document.addEventListener('visibilitychange', () => { if (end) draw(); });
}

export const restLabel = () => `Rest ${mmss(length)}`;

export function startRest() {
  end = Date.now() + length * 1000;
  clearInterval(tick);
  tick = setInterval(draw, 250);
  draw();
}

function stop() {
  end = 0;
  clearInterval(tick);
  $('rest-timer').hidden = true;
}

function draw() {
  const el = $('rest-timer');
  const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  if (!left) {
    stop();
    navigator.vibrate?.([200, 100, 200]);
    ctx.toast('Rest over. Time for your next set.');
    return;
  }
  el.hidden = false;
  if (!el.firstChild) {
    el.innerHTML = `<span class="rest-label">Rest</span><b class="rest-left num" role="timer"></b>
      <button type="button" class="btn btn-plain btn-sm" data-rest="-15" aria-label="15 seconds less">−15s</button>
      <button type="button" class="btn btn-plain btn-sm" data-rest="15" aria-label="15 seconds more">+15s</button>
      <button type="button" class="btn btn-tinted btn-sm" data-rest="stop">Done</button>`;
  }
  el.querySelector('.rest-left').textContent = mmss(left);
}
