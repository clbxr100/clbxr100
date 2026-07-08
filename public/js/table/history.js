// Hand history: client-side log of the last hands at this table.
// Built purely from existing socket events — no server changes.
import * as socket from '../socket.js';
import { $, store, fmt } from '../app.js';
import { esc } from '../screens/lobby.js';

const MAX_HANDS = 20;

let hands = [];          // newest first, capped at MAX_HANDS
let latestState = null;  // most recent table:state (board, players, my cards)
let currentHandNumber = 0;

export function initHistory() {
  const sheet = $('#history-sheet');

  $('#btn-history').addEventListener('click', () => {
    render();
    sheet.classList.remove('hidden');
  });
  // actions.js only wires the sheets it knows about, so close is handled here.
  sheet.querySelector('.sheet-close').addEventListener('click', () => sheet.classList.add('hidden'));
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.classList.add('hidden');
  });

  socket.on('table:joined', () => {
    hands = [];
    latestState = null;
    currentHandNumber = 0;
    render();
  });

  socket.on('game:handStarted', ({ handNumber }) => {
    currentHandNumber = handNumber || currentHandNumber + 1;
  });

  socket.on('table:state', (st) => {
    latestState = st;
    if (st.handNumber) currentHandNumber = st.handNumber;
  });

  socket.on('game:handEnded', ({ result }) => {
    if (!result) return;
    hands.unshift(buildEntry(result));
    if (hands.length > MAX_HANDS) hands.length = MAX_HANDS;
    if (!sheet.classList.contains('hidden')) render();
  });
}

// ---------------- entry building ----------------

function playerName(userId) {
  const p = latestState?.players?.find(pl => String(pl.userId) === String(userId));
  return p ? p.name : '?';
}

function buildEntry(result) {
  const board = (latestState?.communityCards || []).slice();
  const me = latestState?.players?.find(pl => String(pl.userId) === String(store.profile?.userId));
  const myCards = me && me.cards && !me.cards[0]?.hidden ? me.cards.slice() : [];
  const winners = Object.entries(result.totalWonBy || {}).map(([userId, amount]) => ({
    name: playerName(userId),
    amount,
  }));
  return {
    handNumber: currentHandNumber,
    board,
    myCards,
    winners,
    handName: result.byFold ? 'won by folds' : (result.winningHand?.name || ''),
  };
}

// ---------------- rendering ----------------

function isRed(card) { return card && (card.suit === '♥' || card.suit === '♦'); }

function cardHtml(card) {
  if (!card) return '';
  if (card.hidden) return '<div class="pcard back hist-card"></div>';
  return `<div class="pcard hist-card ${isRed(card) ? 'red' : ''}"><div>${card.rank}</div><div class="suit">${card.suit}</div></div>`;
}

function entryHtml(entry) {
  const wins = entry.winners.length
    ? entry.winners.map(w => `${esc(w.name)} wins ${fmt(w.amount)}`).join(', ')
    : '—';
  const title = `#${entry.handNumber} · ${wins}${entry.handName ? ` · ${esc(entry.handName)}` : ''}`;
  const boardRow = entry.board.length
    ? `<div class="hist-cards">${entry.board.map(cardHtml).join('')}</div>`
    : '<div class="hist-noboard">no flop</div>';
  const heroRow = entry.myCards.length
    ? `<div class="hist-hero"><span class="hist-label">you had</span><div class="hist-cards">${entry.myCards.map(cardHtml).join('')}</div></div>`
    : '';
  return `<div class="hist-entry"><div class="hist-title">${title}</div>${boardRow}${heroRow}</div>`;
}

function render() {
  const list = $('#history-list');
  if (!hands.length) {
    list.innerHTML = '<div class="hist-empty">No hands yet this session.</div>';
    return;
  }
  list.innerHTML = hands.map(entryHtml).join('');
}
