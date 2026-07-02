// App shell: store, screen router, toasts, modals, global socket wiring.
import { api, getToken, setToken } from './api.js';
import * as socket from './socket.js';
import { sfx, isMuted, toggleMute } from './sound.js';
import { initAuth } from './screens/auth.js';
import { initDashboard, renderDashboard } from './screens/dashboard.js';
import { initLobby } from './screens/lobby.js';
import { initShop } from './screens/shop.js';
import { initTournaments } from './screens/tournaments.js';
import { initLeaderboard } from './screens/leaderboard.js';
import { initFriends } from './screens/friends.js';
import { initTable, enterTable, leaveTableView } from './table/table.js';
import { FX } from './effects/fx.js';

export const store = {
  profile: null,
  catalog: null,
  tableState: null,
  screen: 'auth',
};

const $ = (sel) => document.querySelector(sel);
export { $ };

let pendingJoin = null; // invite link waiting for auth + socket

export function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

// ---------- router ----------
const screens = ['auth', 'dashboard', 'lobby', 'shop', 'tournaments', 'leaderboard', 'friends', 'table'];
const showHandlers = {};

export function onShow(name, fn) { showHandlers[name] = fn; }

export function showScreen(name) {
  store.screen = name;
  for (const s of screens) {
    $(`#screen-${s}`).classList.toggle('hidden', s !== name);
  }
  if (showHandlers[name]) showHandlers[name]();
}

// ---------- toast / modal ----------
export function toast(msg, cls = '') {
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 2400);
  setTimeout(() => el.remove(), 2800);
}

export function modal(html) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal">${html}</div>`;
  root.onclick = (e) => { if (e.target === root) closeModal(); };
  return root.firstElementChild;
}

export function closeModal() {
  $('#modal-root').innerHTML = '';
}

// ---------- profile ----------
export function setProfile(profile) {
  store.profile = profile;
  renderDashboard();
  const shopCoins = $('#shop-coins');
  if (shopCoins && profile) shopCoins.textContent = fmt(profile.coins);
}

export async function refreshProfile() {
  try {
    const { profile } = await api.get('/api/me');
    setProfile(profile);
  } catch { /* token likely expired; auth flow handles it */ }
}

export function logout() {
  setToken(null);
  socket.disconnect();
  store.profile = null;
  showScreen('auth');
}

// The catalog must survive a failed first fetch (e.g. host cold-start):
// anything that needs it calls ensureCatalog and we retry until it loads.
export async function ensureCatalog() {
  if (store.catalog) return store.catalog;
  try {
    store.catalog = await api.get('/api/shop/catalog');
  } catch {
    /* still down — caller may retry */
  }
  return store.catalog;
}

// ---------- boot ----------
async function boot() {
  await ensureCatalog();
  if (!store.catalog) {
    // keep retrying in the background so screens heal once the host wakes
    const retry = setInterval(async () => {
      if (await ensureCatalog()) clearInterval(retry);
    }, 3000);
  }

  initAuth();
  initDashboard();
  initLobby();
  initShop();
  initTournaments();
  initLeaderboard();
  initFriends();
  initTable();

  socket.on('achievement:unlocked', ({ name, badge, desc }) => {
    toast(`🏅 Achievement unlocked: ${badge} ${name} — ${desc}`, 'gold');
    sfx.bigWin();
    FX.play('confettiBurst', { x: innerWidth / 2, y: innerHeight * 0.25, count: 40 });
  });

  // Invite links: ?join=<tableId>&code=<code> auto-joins after sign-in.
  const params = new URLSearchParams(location.search);
  if (params.get('join')) {
    pendingJoin = { tableId: params.get('join'), code: params.get('code') || undefined };
    history.replaceState(null, '', location.pathname);
    toast('🎟️ Invite accepted — sign in to join the table!');
  }

  // nav buttons with data-nav
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.nav));
  });

  $('#btn-sound').textContent = isMuted() ? '🔇' : '🔊';
  $('#btn-sound').addEventListener('click', () => {
    $('#btn-sound').textContent = toggleMute() ? '🔇' : '🔊';
  });
  $('#btn-logout').addEventListener('click', logout);

  // global socket events
  socket.on('hello', ({ profile }) => {
    setProfile(profile);
    if (pendingJoin) {
      const join = pendingJoin;
      pendingJoin = null;
      socket.send('lobby:joinTable', { tableId: join.tableId, code: join.code });
    }
  });
  socket.on('error', ({ message, code }) => {
    toast(message, 'error');
    sfx.error();
    if (code === 'auth') logout();
  });
  socket.on('session:replaced', () => {
    toast('Signed in from another window', 'error');
    socket.disconnect();
    showScreen('auth');
  });
  socket.on('table:joined', ({ state }) => {
    enterTable(state);
    showScreen('table');
  });
  socket.on('table:left', () => {
    leaveTableView();
    refreshProfile();
    showScreen('lobby');
  });
  socket.on('table:closed', () => {
    leaveTableView();
    refreshProfile();
    if (store.screen === 'table') { toast('Table closed'); showScreen('lobby'); }
  });
  socket.on('table:busted', () => {
    leaveTableView();
    refreshProfile();
    if (store.screen === 'table') { toast('Out of chips! Back to the lobby.', 'error'); showScreen('lobby'); }
  });
  socket.on('profile:update', () => refreshProfile());
  socket.on('tournament:started', () => { /* table:joined state arrives via reconnect-style flow */ });
  socket.on('_open', () => { /* reconnected */ });

  const token = getToken();
  if (token) {
    try {
      const { profile } = await api.get('/api/me');
      setProfile(profile);
      socket.connect();
      showScreen('dashboard');
      return;
    } catch {
      setToken(null);
    }
  }
  showScreen('auth');
}

export function signedIn(token, profile) {
  setToken(token);
  setProfile(profile);
  socket.connect();
  showScreen('dashboard');
}

boot();
