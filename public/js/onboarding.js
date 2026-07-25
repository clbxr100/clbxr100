// First-run onboarding tour (coach marks) + mobile haptics.
// Self-contained: watches #screen-dashboard visibility itself (no onShow slot used).
import { store } from './app.js';
import * as socket from './socket.js';

const TOUR_FLAG = 'hb_tour_done';

const STEPS = [
  {
    target: null,
    title: "Welcome to Hold'em Blitz! 🃏",
    text: 'Regular Texas Hold’em plus power-ups, pets & mayhem.',
  },
  {
    target: '#btn-daily',
    title: '🎁 Daily Bonus',
    text: 'Grab free coins every day — streaks pay more.',
  },
  {
    target: '#quests-card',
    fallback: '#quests-list',
    title: '📋 Daily Quests',
    text: 'Daily quests pay coins. Three new ones every day.',
  },
  {
    target: '#nav-play',
    title: '🎰 Play',
    text: 'Host a table with bots or join friends. Every hand you get one free power-up — use it on your turn!',
  },
  {
    target: '#nav-battlepass',
    title: '🎫 Level up',
    text: 'Playing earns XP: levels, ranks and Battle Pass tiers. Have fun!',
  },
];

// ---------- storage guards (private mode etc. must never crash the app) ----------
function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch { /* ignore */ } }

// ================================================================
// Tour
// ================================================================
let tourActive = false;
let stepIdx = 0;
let steps = [];
let root = null; // overlay root element
let repositionBound = null;

function tourDone() { return lsGet(TOUR_FLAG) === '1'; }

function dashboardVisible() {
  const el = document.querySelector('#screen-dashboard');
  return !!el && !el.classList.contains('hidden');
}

function watchDashboard() {
  const el = document.querySelector('#screen-dashboard');
  if (!el) return;
  const maybeStart = () => {
    if (tourActive || tourDone()) return;
    if (!dashboardVisible()) return;
    // small delay so the dashboard finishes rendering before we measure
    setTimeout(() => {
      if (!tourActive && !tourDone() && dashboardVisible()) startTour();
    }, 450);
  };
  new MutationObserver(maybeStart).observe(el, { attributes: true, attributeFilter: ['class'] });
  maybeStart(); // already signed in on load
}

function resolveTarget(step) {
  if (!step.target) return null;
  let el = document.querySelector(step.target);
  if (!el && step.fallback) el = document.querySelector(step.fallback);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null; // hidden / display:none
  return el;
}

function buildOverlay() {
  root = document.createElement('div');
  root.className = 'hbtour';
  root.innerHTML = `
    <div class="hbtour-dim"></div>
    <div class="hbtour-ring"></div>
    <div class="hbtour-card" role="dialog" aria-live="polite">
      <div class="hbtour-title"></div>
      <div class="hbtour-text"></div>
      <div class="hbtour-dots"></div>
      <div class="hbtour-actions">
        <button type="button" class="hbtour-skip">Skip</button>
        <button type="button" class="hbtour-next">Next</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  root.querySelector('.hbtour-skip').addEventListener('click', endTour);
  root.querySelector('.hbtour-next').addEventListener('click', () => {
    stepIdx += 1;
    if (stepIdx >= steps.length) endTour();
    else showStep();
  });
  repositionBound = () => { if (tourActive) positionStep(); };
  window.addEventListener('resize', repositionBound);
  window.addEventListener('scroll', repositionBound, true);
}

function startTour() {
  // keep steps whose target exists right now (welcome card always stays)
  steps = STEPS.filter(s => !s.target || resolveTarget(s));
  if (!steps.length) { lsSet(TOUR_FLAG, '1'); return; }
  tourActive = true;
  stepIdx = 0;
  buildOverlay();
  showStep();
}

function endTour() {
  lsSet(TOUR_FLAG, '1');
  tourActive = false;
  if (repositionBound) {
    window.removeEventListener('resize', repositionBound);
    window.removeEventListener('scroll', repositionBound, true);
    repositionBound = null;
  }
  if (root) { root.remove(); root = null; }
}

function showStep() {
  const step = steps[stepIdx];
  if (!step) { endTour(); return; }
  // target may have vanished since the tour started — skip it gracefully
  if (step.target && !resolveTarget(step)) {
    stepIdx += 1;
    if (stepIdx >= steps.length) endTour(); else showStep();
    return;
  }
  const card = root.querySelector('.hbtour-card');
  root.querySelector('.hbtour-title').textContent = step.title;
  root.querySelector('.hbtour-text').textContent = step.text;
  root.querySelector('.hbtour-next').textContent = stepIdx === steps.length - 1 ? 'Finish' : 'Next';
  root.querySelector('.hbtour-dots').innerHTML = steps
    .map((_, i) => `<span class="hbtour-dot${i === stepIdx ? ' on' : ''}"></span>`)
    .join('');
  // retrigger springy entrance
  card.classList.remove('hbtour-pop');
  void card.offsetWidth;
  card.classList.add('hbtour-pop');

  const el = resolveTarget(step);
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'center', behavior: 'auto' });
  }
  positionStep();
}

function positionStep() {
  const step = steps[stepIdx];
  if (!step || !root) return;
  const ring = root.querySelector('.hbtour-ring');
  const card = root.querySelector('.hbtour-card');
  const dim = root.querySelector('.hbtour-dim');
  const el = resolveTarget(step);

  if (!el) {
    // centered welcome card: soft blurred overlay, no spotlight ring
    ring.style.display = 'none';
    dim.classList.add('on');
    card.style.left = '50%';
    card.style.top = '50%';
    card.style.transform = 'translate(-50%, -50%)';
    return;
  }

  dim.classList.remove('on');
  const pad = 8;
  const r = el.getBoundingClientRect();
  ring.style.display = 'block';
  ring.style.left = `${r.left - pad}px`;
  ring.style.top = `${r.top - pad}px`;
  ring.style.width = `${r.width + pad * 2}px`;
  ring.style.height = `${r.height + pad * 2}px`;

  // tooltip below the target if there is room, otherwise above
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cw = Math.min(320, vw - 24);
  card.style.width = `${cw}px`;
  card.style.transform = 'none';
  const ch = card.offsetHeight || 170;
  let top = r.bottom + pad + 14;
  if (top + ch > vh - 12) top = Math.max(12, r.top - pad - 14 - ch);
  let left = r.left + r.width / 2 - cw / 2;
  left = Math.max(12, Math.min(left, vw - cw - 12));
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

// ================================================================
// Haptics
// ================================================================
function buzz(pattern) {
  try {
    if (!('vibrate' in navigator)) return;
    if (lsGet('hb_muted') === '1') return; // global kill switch
    navigator.vibrate(pattern);
  } catch { /* never throw */ }
}

function myId() { return store.profile?.userId; }

function initHaptics() {
  try {
    socket.on('game:turn', (data) => {
      if (data && String(data.userId) === String(myId())) buzz(30);
    });
    socket.on('gift:received', () => buzz(60));
    socket.on('achievement:unlocked', () => buzz([40, 60, 40]));
    socket.on('xp:levelUp', () => buzz([40, 60, 40]));
    socket.on('game:handEnded', (data) => {
      const winners = Object.keys(data?.result?.totalWonBy || {});
      if (winners.includes(String(myId()))) buzz(50);
    });
  } catch { /* never throw */ }
}

// ================================================================
export function initOnboarding() {
  try {
    initHaptics();
    watchDashboard();
  } catch { /* onboarding must never break the app */ }
}
