// Table screen controller: renders game state, routes events to effects.
import * as socket from '../socket.js';
import { $, store, fmt, toast, modal, closeModal, showScreen } from '../app.js';
import { sfx } from '../sound.js';
import { FX, rectOf } from '../effects/fx.js';
import { celebrate, powerUpFx, playTheme } from '../effects/celebrations.js';
import { initActions, renderActions, clearPick } from './actions.js';
import { initChat, resetChat } from './chat.js';
import { esc } from '../screens/lobby.js';

let state = null;
let prevCommunity = 0;
let prevHandNumber = 0;
let peeked = new Map();   // userId -> cards revealed to me this hand
let timerTick = null;

export function getState() { return state; }
export function seatEl(userId) { return document.querySelector(`.seat[data-uid="${CSS.escape(userId)}"]`); }

export function initTable() {
  initActions();
  initChat();

  $('#btn-leave-table').addEventListener('click', () => {
    if (state && state.tournament) {
      const m = modal(`<h3>Leave tournament?</h3><p class="row-sub">Your chips will blind out — no refund.</p>
        <div class="modal-row"><button class="btn btn-ghost" id="lv-no">Stay</button><button class="btn btn-danger" id="lv-yes">Leave</button></div>`);
      m.querySelector('#lv-no').addEventListener('click', closeModal);
      m.querySelector('#lv-yes').addEventListener('click', () => { closeModal(); socket.send('table:leave'); });
    } else {
      socket.send('table:leave');
    }
  });

  socket.on('table:state', (st) => {
    if (store.screen !== 'table') return;
    applyState(st);
  });

  $('#btn-invite').addEventListener('click', async () => {
    if (!state) return;
    let url = `${location.origin}/?join=${encodeURIComponent(state.tableId)}`;
    if (state.isPrivate && state.code) url += `&code=${encodeURIComponent(state.code)}`;
    const text = `Join my poker table "${state.name}" on Hold'em Blitz!`;
    if (navigator.share) {
      navigator.share({ title: 'Hold\'em Blitz', text, url }).catch(() => {});
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast('📣 Invite link copied!', 'gold');
      } catch {
        toast(url); // last resort: show it
      }
    }
  });

  $('#btn-sitout').addEventListener('click', () => {
    if (!state) return;
    const me = findPlayer(myId());
    if (!me) return;
    socket.send('table:sitOut', { sitOut: !me.sittingOut });
  });

  socket.on('table:sitOut', ({ sittingOut, auto }) => {
    if (auto) toast('⏸️ Sitting out after 2 missed turns — tap ▶️ when you\'re back', 'error');
    else toast(sittingOut ? '⏸️ Sitting out — the table plays on without you' : '▶️ Back in the game!');
  });

  socket.on('game:handStarted', () => {
    peeked.clear();
    clearXray();
    sfx.deal();
  });

  socket.on('game:action', ({ userId, action }) => {
    if (!state) return;
    ({ fold: sfx.fold, check: sfx.check, call: sfx.chip, raise: sfx.raise, allin: sfx.allin }[action] || sfx.chip)();
    const p = findPlayer(userId);
    if (p && action === 'allin') bannerFlash(`${esc(p.name)} is ALL IN! 🔥`);
  });

  socket.on('game:turn', ({ userId, frozen }) => {
    if (!state) return;
    if (frozen) {
      const p = findPlayer(userId);
      if (p) bannerFlash(`❄️ ${esc(p.name)} is frozen — turn skipped!`);
      return;
    }
    if (userId === myId()) sfx.yourTurn();
  });

  socket.on('game:powerUpUsed', (event) => {
    if (!state) return;
    const user = findPlayer(event.userId);
    const target = event.targetUserId ? findPlayer(event.targetUserId) : null;
    const def = store.catalog?.powerups?.[event.type];
    const name = def ? `${def.emoji} ${def.name}` : 'a power-up';
    let text = `${user ? esc(user.name) : '?'} used ${name}`;
    if (target) text += ` on ${esc(target.name)}`;
    if (event.blocked) text += ' — BLOCKED 🛡️';
    if (event.type === 'pu_steal' && !event.blocked) text = `${esc(user.name)} 🪤 stole ${fmt(event.amount)} from the pot!`;
    bannerFlash(text);
    powerUpFx(event, seatEl);
  });

  socket.on('game:powerUpResult', (payload) => {
    if (payload.type === 'pu_peek') {
      peeked.set(payload.targetUserId, payload.cards);
      render();
    } else if (payload.type === 'pu_xray') {
      showXray(payload.card);
    } else if (payload.type === 'pu_swap') {
      toast(`🔄 Swapped ${cardText(payload.swappedOut)} for ${cardText(payload.swappedIn)}`);
    }
  });

  socket.on('game:handEnded', ({ result, celebrations }) => {
    if (!state || !result) return;
    const winners = result.winningHand ? result.winningHand.userIds : Object.keys(result.totalWonBy || {});
    const total = Object.values(result.totalWonBy || {}).reduce((s, x) => s + x, 0);
    setTimeout(() => {
      const winnerEls = winners.map(seatEl).filter(Boolean);
      celebrate(result.winningHand ? result.winningHand.rank : 0, {
        winnerEls,
        potEl: $('#pot-display'),
        amount: total,
      });
      // Equipped celebration themes layer on top for each human winner.
      for (const [userId, theme] of Object.entries(celebrations || {})) {
        setTimeout(() => playTheme(theme, $('#pot-display'), seatEl(userId)), 600);
      }
      const names = winners.map(id => findPlayer(id)?.name).filter(Boolean).map(esc).join(', ');
      if (result.byFold) bannerBig(`${names} takes it! 🏆`);
      else bannerBig(`${names} wins ${fmt(total)} — ${esc(result.winningHand?.name || '')}!`);
      if (result.houseBonuses && result.houseBonuses[myId()]) {
        toast(`💥 Double Down! House pays +${fmt(result.houseBonuses[myId()])}`, 'gold');
      }
    }, 250);
  });

  socket.on('throw:item', ({ fromUserId, targetUserId, itemId }) => {
    const item = store.catalog?.throwables?.[itemId];
    const fromEl = seatEl(fromUserId);
    const toEl = seatEl(targetUserId);
    if (!item || !fromEl || !toEl) return;
    sfx.whoosh();
    FX.play('throwArc', {
      from: rectOf(fromEl), to: rectOf(toEl), emoji: item.emoji, kind: item.kind,
      onImpact: () => {
        (item.kind === 'splat' ? sfx.splat : item.kind === 'burst' ? sfx.bigWin : sfx.gift)();
        if (item.kind === 'splat') {
          const splat = document.createElement('div');
          splat.className = 'splat';
          splat.textContent = itemId === 'throw_cake' ? '🎂' : '🍅';
          toEl.appendChild(splat);
          setTimeout(() => splat.remove(), 4000);
        }
        const from = findPlayer(fromUserId);
        const to = findPlayer(targetUserId);
        if (from && to) {
          const verb = item.kind === 'gift' ? 'gave' : 'threw';
          bannerFlash(`${esc(from.name)} ${verb} ${item.emoji} ${item.kind === 'gift' ? 'to' : 'at'} ${esc(to.name)}`);
        }
      },
    });
  });

  socket.on('tournament:blindsUp', ({ level, blinds }) => {
    sfx.allin();
    bannerBig(`📈 Level ${level} — blinds ${blinds[0]}/${blinds[1]}`);
  });
  socket.on('tournament:eliminated', ({ username, place }) => {
    bannerFlash(`☠️ ${esc(username)} out in ${ordinal(place)}`);
  });
  socket.on('tournament:yourPlace', ({ place }) => {
    toast(`You finished ${ordinal(place)}`, place <= 3 ? 'gold' : '');
    // Eliminated → back to the lobby (the results modal still pops globally).
    setTimeout(() => {
      if (store.screen === 'table') {
        leaveTableView();
        showScreen('tournaments');
      }
    }, 2500);
  });
  socket.on('tournament:finished', ({ placements, payouts }) => {
    const rows = placements.slice(0, Math.max(3, payouts.length)).map(p => {
      const pay = payouts.find(x => x.userId === p.userId);
      return `<div class="row-card"><div class="row-main"><div class="row-title">${medal(p.place)} ${esc(p.username)}</div></div>${pay ? `<span class="badge gold">🪙 ${fmt(pay.amount)}</span>` : ''}</div>`;
    }).join('');
    modal(`<h3>🏆 Tournament over!</h3>${rows}<button class="btn btn-primary" id="tf-ok">Nice</button>`)
      .querySelector('#tf-ok').addEventListener('click', () => { closeModal(); });
    sfx.bigWin();
    FX.play('confettiCannons');
  });
}

export function enterTable(st) {
  resetChat();
  peeked.clear();
  clearXray();
  prevCommunity = 0;
  prevHandNumber = 0;
  applyState(st);
  startTimerLoop();
}

export function leaveTableView() {
  state = null;
  stopTimerLoop();
  clearPick();
  document.querySelectorAll('.seat, .seat-bet').forEach(el => el.remove());
}

function myId() { return store.profile?.userId; }
function findPlayer(userId) { return state?.players?.find(p => String(p.userId) === String(userId)); }

function applyState(st) {
  const newHand = st.handNumber !== prevHandNumber;
  const newStreet = st.communityCards.length !== prevCommunity;

  // Street advanced: sweep the bet chips into the pot first (visual only).
  if (state && newStreet && st.communityCards.length > prevCommunity && !newHand) {
    const potR = rectOf($('#pot-display'));
    document.querySelectorAll('.seat-bet').forEach(el => {
      FX.play('chipsFly', { from: rectOf(el), to: potR, amount: 60 });
    });
    sfx.chip();
  }
  if (newHand) { peeked.clear(); clearXray(); }
  prevCommunity = st.communityCards.length;
  prevHandNumber = st.handNumber;
  state = st;
  render();
}

// ---------------- rendering ----------------

// Portrait seat layouts (percent of felt) — hero is always slot 0.
// Hero sits bottom-left so the big hole cards (bottom-center) never cover them.
const LAYOUTS = {
  1: [[22, 87]],
  2: [[22, 87], [50, 13]],
  3: [[22, 87], [13, 30], [87, 30]],
  4: [[22, 87], [9, 52], [50, 11], [91, 52]],
  5: [[22, 87], [8, 62], [18, 17], [82, 17], [92, 62]],
  6: [[22, 87], [7, 63], [10, 23], [50, 9], [90, 23], [93, 63]],
  7: [[22, 87], [7, 66], [7, 29], [29, 10], [71, 10], [93, 29], [93, 66]],
  8: [[22, 87], [6, 67], [6, 32], [24, 11], [50, 8], [76, 11], [94, 32], [94, 67]],
};

function render() {
  if (!state) return;
  $('#table-name').textContent = state.name;
  const t = state.tournament;
  $('#table-blinds').textContent = t
    ? `Lv ${t.level} · ${t.blinds[0]}/${t.blinds[1]} · pool ${fmt(t.prizePool)}`
    : `${state.smallBlind}/${state.bigBlind}`;
  const phaseNames = { waiting: 'waiting', preflop: 'pre-flop', flop: 'flop', turn: 'turn', river: 'river', handEnded: 'showdown' };
  $('#table-phase').textContent = phaseNames[state.phase] || state.phase;

  renderPot();
  renderCommunity();
  renderSeats();
  renderHeroCards();
  renderActions(state);

  const me = findPlayer(myId());
  const sitBtn = $('#btn-sitout');
  sitBtn.style.display = me && !state.tournament ? '' : 'none';
  sitBtn.textContent = me && me.sittingOut ? '▶️' : '⏸️';

  if (state.phase !== 'handEnded' && state.phase !== 'waiting') $('#table-banner').innerHTML = '';
  if (state.phase === 'waiting') {
    $('#table-banner').innerHTML = '<span style="font-size:14px;opacity:0.8">Waiting for players…</span>';
  }
  if (state.blindfolded && state.phase !== 'handEnded') {
    $('#table-banner').innerHTML = '<span style="font-size:14px">🙈 You are blindfolded!</span>';
  }
}

function renderPot() {
  $('#pot-amount').textContent = fmt(state.pot);
  $('#pot-display').classList.toggle('empty', !state.pot);
}

function cardText(card) { return card ? `${card.rank}${card.suit}` : '?'; }
function isRed(card) { return card && (card.suit === '♥' || card.suit === '♦'); }

function cardHtml(card, cls = '') {
  if (!card) return '';
  if (card.hidden) return `<div class="pcard back ${cls}"></div>`;
  return `<div class="pcard ${isRed(card) ? 'red' : ''} ${cls}" data-face="${cardText(card)}">
    <div>${card.rank}</div><div class="suit">${card.suit}</div></div>`;
}

// Only append/replace cards that actually changed so the deal animation
// plays once per card, not on every state refresh.
function reconcileCards(wrap, cards, { silent = false } = {}) {
  const want = cards.map(c => (c && c.hidden ? 'back' : cardText(c)));
  const have = [...wrap.children].map(el => el.classList.contains('back') ? 'back' : el.dataset.face);
  if (want.length === have.length && want.every((w, i) => w === have[i])) return;

  let keep = 0;
  while (keep < Math.min(want.length, have.length) && want[keep] === have[keep]) keep++;
  while (wrap.children.length > keep) wrap.lastChild.remove();
  for (let i = keep; i < cards.length; i++) {
    wrap.insertAdjacentHTML('beforeend', cardHtml(cards[i]));
    wrap.lastElementChild.style.animationDelay = `${(i - keep) * 0.12}s`;
    if (i >= have.length && !silent) sfx.deal();
  }
}

function renderCommunity() {
  reconcileCards($('#community'), state.communityCards);
}

function renderHeroCards() {
  const me = findPlayer(myId());
  const wrap = $('#hero-cards');
  const cards = me && me.cards && !me.cards[0]?.hidden ? me.cards : [];
  reconcileCards(wrap, cards);
  wrap.style.opacity = me && me.folded ? '0.35' : '1';
}

function renderSeats() {
  const felt = $('#felt');
  const players = state.players || [];
  const meIdx = players.findIndex(p => p.userId === myId());
  const rotated = meIdx >= 0
    ? [...players.slice(meIdx), ...players.slice(0, meIdx)]
    : players;
  const layout = LAYOUTS[Math.min(8, Math.max(1, rotated.length))];

  // Chip leader wears the crown (only when someone is ahead).
  const maxChips = Math.max(...players.map(p => p.chips));
  const leaders = players.filter(p => p.chips === maxChips && maxChips > 0);
  const crownId = leaders.length === 1 ? String(leaders[0].userId) : null;

  const seen = new Set();
  rotated.forEach((p, i) => {
    seen.add(String(p.userId)); // dataset values are strings; human ids are numbers
    let el = seatEl(p.userId);
    if (!el) {
      el = document.createElement('div');
      el.className = 'seat';
      el.dataset.uid = p.userId;
      el.innerHTML = `
        <div class="seat-avatar"><span class="av"></span>
          <div class="timer-ring hidden"></div>
          <span class="seat-pet hidden"></span>
          <span class="seat-shield hidden">🛡️</span>
          <span class="seat-dealer hidden">D</span>
          <span class="seat-crown hidden">👑</span>
          <span class="seat-fire hidden">🔥</span>
          <span class="seat-status"></span>
        </div>
        <div class="peeked-cards hidden"></div>
        <div class="seat-name"></div>
        <div class="seat-chips"></div>
        <div class="seat-cards"></div>`;
      felt.appendChild(el);
    }
    const [x, y] = layout[i] || [50, 50];
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;

    const origIndex = players.indexOf(p);
    el.classList.toggle('hero', p.userId === myId());
    el.classList.toggle('active', origIndex === state.currentPlayerIndex && state.phase !== 'handEnded' && state.phase !== 'waiting');
    el.classList.toggle('folded', p.folded && state.phase !== 'waiting');
    el.querySelector('.av').textContent = p.avatar || '🙂';
    el.querySelector('.seat-name').textContent = (p.isBot ? '🤖' : '') + p.name + (p.badge ? ` ${p.badge}` : '');
    el.querySelector('.seat-chips').textContent = `🪙${fmt(p.chips)}`;
    el.querySelector('.seat-dealer').classList.toggle('hidden', origIndex !== state.dealerIndex);
    el.querySelector('.seat-shield').classList.toggle('hidden', !p.shield);
    el.querySelector('.seat-crown').classList.toggle('hidden', String(p.userId) !== crownId);
    const fire = el.querySelector('.seat-fire');
    fire.classList.toggle('hidden', (p.streak || 0) < 3);
    if (p.streak >= 3) fire.textContent = p.streak >= 5 ? '🔥🔥' : '🔥';
    el.querySelector('.seat-status').textContent = p.sittingOut ? 'SITTING OUT'
      : p.allIn ? 'ALL IN'
      : (p.folded && state.phase !== 'waiting' && state.phase !== 'handEnded' ? 'FOLD' : '');
    el.querySelector('.timer-ring').classList.toggle('hidden', origIndex !== state.currentPlayerIndex || !isPlayingPhase());

    const petSpan = el.querySelector('.seat-pet');
    const petDef = p.pet && store.catalog?.pets?.[p.pet];
    petSpan.classList.toggle('hidden', !petDef);
    if (petDef) petSpan.textContent = petDef.emoji;

    // small cards (hidden backs or showdown reveals) — hero's shown big below
    const cardsEl = el.querySelector('.seat-cards');
    reconcileCards(cardsEl, p.userId === myId() ? [] : (p.cards || []), { silent: true });

    // peeked cards overlay
    const peekEl = el.querySelector('.peeked-cards');
    const pk = peeked.get(p.userId);
    if (pk && state.phase !== 'handEnded') {
      peekEl.classList.remove('hidden');
      peekEl.innerHTML = pk.map(c => cardHtml(c)).join('');
    } else {
      peekEl.classList.add('hidden');
    }

    renderBet(felt, p, x, y);
  });

  // remove departed seats + their bets
  document.querySelectorAll('.seat').forEach(el => {
    if (!seen.has(el.dataset.uid)) el.remove();
  });
  document.querySelectorAll('.seat-bet').forEach(el => {
    if (!seen.has(el.dataset.uid)) el.remove();
  });
}

function renderBet(felt, p, x, y) {
  let bet = felt.querySelector(`.seat-bet[data-uid="${CSS.escape(p.userId)}"]`);
  if (!p.bet) {
    if (bet) bet.remove();
    return;
  }
  if (!bet) {
    bet = document.createElement('div');
    bet.className = 'seat-bet';
    bet.dataset.uid = p.userId;
    bet.innerHTML = '<span class="chip-ico">🔴</span><span class="amt"></span>';
    felt.appendChild(bet);
  }
  // between the seat and the table center
  bet.style.left = `${x + (50 - x) * 0.42}%`;
  bet.style.top = `${y + (44 - y) * 0.4}%`;
  bet.querySelector('.amt').textContent = fmt(p.bet);
}

function isPlayingPhase() {
  return ['preflop', 'flop', 'turn', 'river'].includes(state?.phase);
}

// ---------------- turn timer ring ----------------

function startTimerLoop() {
  stopTimerLoop();
  timerTick = setInterval(() => {
    if (!state || !state.turnDeadline || !isPlayingPhase()) return;
    const ring = document.querySelector('.seat .timer-ring:not(.hidden)');
    if (!ring) return;
    const left = Math.max(0, state.turnDeadline - Date.now());
    ring.style.setProperty('--pct', `${Math.min(100, (left / 30000) * 100)}%`);
  }, 200);
}

function stopTimerLoop() {
  if (timerTick) clearInterval(timerTick);
  timerTick = null;
}

// ---------------- banners / xray ----------------

let bannerTimer = null;
function bannerFlash(html) {
  const b = $('#table-banner');
  b.innerHTML = `<span>${html}</span>`;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { if (state?.phase !== 'handEnded') b.innerHTML = ''; }, 3200);
}
function bannerBig(html) {
  $('#table-banner').innerHTML = `<span class="banner-big">${html}</span>`;
}

let xrayEl = null;
function showXray(card) {
  clearXray();
  sfx.powerup();
  xrayEl = document.createElement('div');
  xrayEl.style.cssText = 'position:absolute;left:50%;top:24%;transform:translateX(-50%);z-index:8;display:flex;flex-direction:column;align-items:center;gap:3px;filter:drop-shadow(0 0 10px #c084fc);';
  xrayEl.innerHTML = `<span style="font-size:11px;font-weight:900;color:#e9d5ff">🔮 NEXT CARD</span>${cardHtml(card)}`;
  $('#felt').appendChild(xrayEl);
  setTimeout(clearXray, 6000);
}
function clearXray() {
  if (xrayEl) xrayEl.remove();
  xrayEl = null;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function medal(place) {
  return place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : `${place}.`;
}
