// Table screen controller: renders game state, routes events to effects.
import * as socket from '../socket.js';
import { api } from '../api.js';
import { $, store, fmt, toast, modal, closeModal, showScreen } from '../app.js';
import { sfx } from '../sound.js';
import { FX, rectOf } from '../effects/fx.js';
import { celebrate, powerUpFx, playTheme } from '../effects/celebrations.js';
import { initActions, renderActions, clearPick, pickJustConsumed } from './actions.js';
import { initChat, resetChat } from './chat.js';
import { esc } from '../screens/lobby.js';

let state = null;
let prevCommunity = 0;
let prevHandNumber = 0;
let peeked = new Map();   // userId -> cards revealed to me this hand
let timerTick = null;
let spectating = false;

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

  // Tap a seat (outside targeting mode) → player profile card.
  $('#felt').addEventListener('click', (e) => {
    const seat = e.target.closest('.seat');
    if (!seat || seat.classList.contains('targetable') || pickJustConsumed()) return;
    const player = state?.players?.find(p => String(p.userId) === seat.dataset.uid);
    if (player) openProfile(player);
  });

  // Emote wheel: quick reactions that pop over your seat.
  $('#btn-emote').addEventListener('click', () => $('#emote-wheel').classList.toggle('hidden'));
  document.querySelectorAll('#emote-wheel button').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.send('chat:emoji', { emoji: btn.dataset.emote });
      $('#emote-wheel').classList.add('hidden');
    });
  });

  socket.on('game:handStarted', () => {
    peeked.clear();
    clearXray();
    cancelDrama();
    sfx.deal();
  });

  socket.on('game:action', ({ userId, action }) => {
    if (!state) return;
    ({ fold: sfx.fold, check: sfx.check, call: sfx.chip, raise: sfx.raise, allin: sfx.allin }[action] || sfx.chip)();
    const p = findPlayer(userId);
    if (p && action === 'allin') bannerFlash(`${esc(p.name)} is ALL IN! 🔥`);
    if (action === 'fold') petReact(userId, 'pet-sad', 900);
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
    const fire = () => {
      const winnerEls = winners.map(seatEl).filter(Boolean);
      winners.forEach(id => petReact(id, 'pet-celebrate', 1600));
      winnerEls.forEach(el => seatWinnerMoment(el));
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
    };
    // SHOWDOWN DRAMA: this event lands just before the hand-end state, so
    // check after the usual 250ms whether a runout/flip show started — if so,
    // hold the celebration until the drama wraps (capped, see dramaHoldMs).
    setTimeout(() => {
      const hold = dramaHoldMs();
      if (hold > 0) setTimeout(fire, hold);
      else fire();
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
          petReact(targetUserId, 'pet-startle', 700);
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

export function enterTable(st, asSpectator = false) {
  resetChat();
  peeked.clear();
  clearXray();
  cancelDrama();
  chipsShown.clear();
  potShown = 0;
  prevCommunity = 0;
  prevHandNumber = 0;
  spectating = asSpectator;
  applyState(st);
  startTimerLoop();
}

export function leaveTableView() {
  state = null;
  spectating = false;
  stopTimerLoop();
  cancelDrama();
  clearPick();
  $('#emote-wheel').classList.add('hidden');
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
  if (newHand) { peeked.clear(); clearXray(); cancelDrama(); }
  // SHOWDOWN DRAMA: 2+ board cards landing in one state while the hand is
  // already over = all-in runout → stagger the reveal instead.
  if (state && !newHand && st.phase === 'handEnded'
      && st.communityCards.length - prevCommunity >= 2) {
    beginRunoutDrama(prevCommunity, st.communityCards.length);
  }
  dramaFlipSeq = 0; // hole-card flip stagger restarts for each incoming state
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
  $('#btn-emote').style.display = me || spectating ? '' : 'none';
  if (spectating) $('#table-phase').textContent = '👁️ watching';

  if (state.phase !== 'handEnded' && state.phase !== 'waiting') $('#table-banner').innerHTML = '';
  if (state.phase === 'waiting') {
    $('#table-banner').innerHTML = '<span style="font-size:14px;opacity:0.8">Waiting for players…</span>';
  }
  if (state.blindfolded && state.phase !== 'handEnded') {
    $('#table-banner').innerHTML = '<span style="font-size:14px">🙈 You are blindfolded!</span>';
  }
}

function renderPot() {
  animatePot(state.pot);
  $('#pot-display').classList.toggle('empty', !state.pot);
}

function cardText(card) { return card ? `${card.rank}${card.suit}` : '?'; }
function isRed(card) { return card && (card.suit === '♥' || card.suit === '♦'); }

function cardHtml(card, cls = '') {
  if (!card) return '';
  if (card.hidden) {
    const back = store.profile?.cardBack || '';
    return `<div class="pcard back ${back} ${cls}"></div>`;
  }
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
  // During a staggered runout only the already-revealed prefix is rendered;
  // the drama timers push the rest one card at a time.
  reconcileCards($('#community'), dramaBoardSlice(state.communityCards));
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
    el.querySelector('.seat-avatar').className = 'seat-avatar' + (p.frame ? ` avframe ${p.frame}` : '');
    el.querySelector('.seat-name').textContent = (p.isBot ? '🤖' : '') + p.name + (p.badge ? ` ${p.badge}` : '');
    renderChipCount(el.querySelector('.seat-chips'), p);
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
    // persistent pet moods: sleep while sitting out, alert while it's the owner's turn
    petSpan.classList.toggle('pet-sleep', !!petDef && !!p.sittingOut);
    petSpan.classList.toggle('pet-alert', !!petDef && !p.sittingOut && !p.folded
      && origIndex === state.currentPlayerIndex && isPlayingPhase());

    // small cards (hidden backs or showdown reveals) — hero's shown big below
    // (drama-aware: back→face transitions get a staggered 3D flip)
    const cardsEl = el.querySelector('.seat-cards');
    dramaSeatCards(cardsEl, p.userId === myId() ? [] : (p.cards || []));

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
    if (!seen.has(el.dataset.uid)) { el.remove(); chipsShown.delete(el.dataset.uid); }
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

// ---------------- profile popup / seat emotes ----------------

async function openProfile(player) {
  if (player.isBot) {
    modal(`<div class="profile-pop">
      <span class="pp-avatar">${player.avatar}</span>
      <h3>🤖 ${esc(player.name)}</h3>
      <p class="row-sub">House bot · plays for the love of the game</p>
      <div class="stats-grid"><div class="stat"><b>${fmt(player.chips)}</b><span>Stack</span></div></div>
      <button class="btn btn-ghost" id="pp-close">Close</button>
    </div>`).querySelector('#pp-close').addEventListener('click', closeModal);
    return;
  }
  const m = modal(`<div class="profile-pop"><span class="spin">🂠</span></div>`);
  try {
    const p = await api.get(`/api/player?id=${player.userId}`);
    const isMe = String(p.userId) === String(store.profile?.userId);
    m.innerHTML = `<div class="profile-pop">
      <span class="pp-avatar">${p.avatar}</span>
      <h3>${esc(p.username)} ${p.badge || ''} ${p.isGuest ? '<span class="badge">guest</span>' : ''}</h3>
      <p class="row-sub">${p.rank.emoji} ${p.rank.title} · Level ${p.level} · 🏅 ${p.achievements}</p>
      <div class="stats-grid">
        <div class="stat"><b>${fmt(player.chips)}</b><span>Stack</span></div>
        <div class="stat"><b>${p.stats.hands_won}</b><span>Hands won</span></div>
        <div class="stat"><b>${fmt(p.stats.biggest_pot)}</b><span>Best pot</span></div>
        <div class="stat"><b>${p.stats.best_streak}</b><span>Best streak</span></div>
        <div class="stat"><b>${p.stats.tournaments_won}</b><span>Tourneys</span></div>
        <div class="stat"><b>${p.stats.hands_played}</b><span>Played</span></div>
      </div>
      <div class="modal-row">
        ${!isMe && !p.friend && !p.isGuest ? `<button class="btn btn-primary" id="pp-add">👥 Add friend</button>` : ''}
        ${p.friend ? '<span class="badge green" style="align-self:center">👥 Friends</span>' : ''}
        <button class="btn btn-ghost" id="pp-close">Close</button>
      </div>
    </div>`;
    m.querySelector('#pp-close').addEventListener('click', closeModal);
    const addBtn = m.querySelector('#pp-add');
    if (addBtn) addBtn.addEventListener('click', async () => {
      try {
        await api.post('/api/friends/request', { username: p.username });
        toast(`Request sent to ${p.username} 👋`);
        closeModal();
      } catch (err) { toast(err.message, 'error'); }
    });
  } catch (err) {
    m.innerHTML = `<div class="profile-pop"><p>${esc(err.message)}</p><button class="btn btn-ghost" id="pp-close">Close</button></div>`;
    m.querySelector('#pp-close').addEventListener('click', closeModal);
  }
}

// Emoji reaction bubble above the sender's seat (called from chat).
export function showSeatEmote(userId, emoji) {
  const el = seatEl(userId);
  if (!el) return;
  el.querySelector('.emote-bubble')?.remove();
  const bubble = document.createElement('div');
  bubble.className = 'emote-bubble';
  bubble.textContent = emoji;
  el.appendChild(bubble);
  setTimeout(() => bubble.remove(), 2600);
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function medal(place) {
  return place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : `${place}.`;
}

/* ===== PET LIFE + MICRO-INTERACTIONS ===== */
// Helpers only — hooked from the socket handlers / render functions above.
// CSS lives in the matching appended block at the end of table.css.

const PET_ONESHOTS = ['pet-celebrate', 'pet-sad', 'pet-startle'];
const petTimers = new Map(); // userId -> timeout for the active one-shot class

// One-shot pet reaction: swap out competing one-shots, add cls, remove after ms.
function petReact(userId, cls, ms) {
  const pet = seatEl(userId)?.querySelector('.seat-pet');
  if (!pet || pet.classList.contains('hidden')) return;
  clearTimeout(petTimers.get(String(userId)));
  PET_ONESHOTS.forEach(c => pet.classList.remove(c));
  void pet.offsetWidth; // restart the animation even if cls was just removed
  pet.classList.add(cls);
  petTimers.set(String(userId), setTimeout(() => pet.classList.remove(cls), ms));
}

// Golden ring ripple + scale pop on a winning seat (~2s, self-clearing).
function seatWinnerMoment(el) {
  el.classList.remove('seat-winner');
  void el.offsetWidth;
  el.classList.add('seat-winner');
  setTimeout(() => el.classList.remove('seat-winner'), 2000);
}

// rAF number tween (transform-free — just text), ease-out cubic.
function tweenNumber(el, from, to, ms = 400) {
  cancelAnimationFrame(el._tweenRaf || 0);
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(Math.round(from + (to - from) * eased));
    if (t < 1) el._tweenRaf = requestAnimationFrame(step);
  };
  el._tweenRaf = requestAnimationFrame(step);
}

// Tiny scale pulse on a counter element (class removes itself).
function bump(el) {
  el.classList.remove('pot-bump');
  void el.offsetWidth;
  el.classList.add('pot-bump');
  clearTimeout(el._bumpTimer);
  el._bumpTimer = setTimeout(() => el.classList.remove('pot-bump'), 450);
}

// Pot count-up: tween increases, snap decreases/resets (hand start goes straight to 0).
let potShown = 0;
function animatePot(pot) {
  const el = $('#pot-amount');
  if (pot > potShown) {
    tweenNumber(el, potShown, pot, 400);
    bump(el);
  } else if (pot !== potShown) {
    cancelAnimationFrame(el._tweenRaf || 0);
    el.textContent = fmt(pot);
  }
  potShown = pot;
}

// Seat chip counter: tick up only when the stack grows at showdown (a win).
const chipsShown = new Map(); // uid -> last chips value rendered
function renderChipCount(chipsEl, p) {
  const uid = String(p.userId);
  const prev = chipsShown.get(uid);
  chipsShown.set(uid, p.chips);
  const levelHtml = p.level ? ` <span class="seat-level">L${p.level}</span>` : '';
  const grew = typeof prev === 'number' && p.chips > prev && state.phase === 'handEnded';
  if (!grew) {
    chipsEl.innerHTML = `🪙${fmt(p.chips)}${levelHtml}`;
    return;
  }
  chipsEl.innerHTML = `🪙<span class="chips-num">${fmt(prev)}</span>${levelHtml}`;
  tweenNumber(chipsEl.querySelector('.chips-num'), prev, p.chips, 500);
  bump(chipsEl);
}

/* ===== SHOWDOWN DRAMA ===== */
// Staggered all-in board runouts, hole-card flip reveals, and a suspense
// vignette. Hooked from applyState / renderCommunity / renderSeats and the
// game:handStarted + game:handEnded handlers above. CSS lives in the matching
// appended block at the end of table.css. Transforms/opacity only.

const DRAMA_STEP = 450;      // ms between staggered board cards
const DRAMA_FLIP_MS = 350;   // hole-card flip duration
const DRAMA_LEAD_MS = 200;   // beat before the first staggered card
const DRAMA_MAX_HOLD = 2250; // celebration hold cap (250ms base + this = 2.5s)

let dramaTimers = [];  // pending reveal timeouts (cancel on new hand / leave)
let dramaShown = -1;   // community cards allowed on screen (-1 = no drama)
let dramaEndAt = 0;    // timestamp when the whole show wraps
let dramaFlipSeq = 0;  // per-state seat flip stagger counter (reset in applyState)

// While a runout plays, renderCommunity only gets the revealed prefix.
function dramaBoardSlice(cards) {
  return dramaShown >= 0 ? cards.slice(0, dramaShown) : cards;
}

// All-in runout: keep `prefix` cards on the felt, reveal up to `total` one by
// one with a deal sound + flip-in, under a suspense vignette.
function beginRunoutDrama(prefix, total) {
  cancelDrama();
  dramaShown = prefix;
  const steps = total - prefix;
  $('#screen-table').classList.add('drama-suspense');
  for (let k = 0; k < steps; k++) {
    dramaTimers.push(setTimeout(dramaRevealNext, DRAMA_LEAD_MS + k * DRAMA_STEP));
  }
  const lastAt = DRAMA_LEAD_MS + (steps - 1) * DRAMA_STEP;
  dramaEndAt = Date.now() + Math.min(DRAMA_MAX_HOLD, lastAt + DRAMA_FLIP_MS);
  dramaTimers.push(setTimeout(dramaFinish, lastAt + DRAMA_FLIP_MS + 60));
}

function dramaRevealNext() {
  if (!state || dramaShown < 0) return;
  dramaShown = Math.min(dramaShown + 1, state.communityCards.length);
  const wrap = $('#community');
  reconcileCards(wrap, state.communityCards.slice(0, dramaShown)); // plays sfx.deal
  const card = wrap.lastElementChild;
  if (card && !card.classList.contains('card-runout')) {
    card.style.animationDelay = '0s';
    card.classList.add('card-runout');
  }
}

function dramaFinish() {
  dramaShown = -1; // keep dramaEndAt: the celebration hold still reads it
  $('#screen-table').classList.remove('drama-suspense');
  if (state) renderCommunity(); // safety net: board fully caught up
}

function cancelDrama() {
  dramaTimers.forEach(clearTimeout);
  dramaTimers = [];
  dramaShown = -1;
  dramaEndAt = 0;
  document.getElementById('screen-table')?.classList.remove('drama-suspense');
}

// How much longer (past the base 250ms) the win moment should wait so it
// lands after the last card/flip. 0 when there was no drama.
function dramaHoldMs() {
  return Math.max(0, Math.min(DRAMA_MAX_HOLD, dramaEndAt - Date.now()));
}

// Seat cards with showdown flair: when a seat goes from backs to faces
// (showdown reveal), the fresh face cards get a 3D flip, seats staggered.
function dramaSeatCards(wrap, cards) {
  const hadBacks = wrap.children.length > 0
    && [...wrap.children].every(el => el.classList.contains('back'));
  const nowFaces = cards.length > 0 && cards.every(c => c && !c.hidden);
  reconcileCards(wrap, cards, { silent: true });
  if (!hadBacks || !nowFaces) return;
  const base = dramaFlipSeq++ * 120; // stagger seats ~120ms apart
  [...wrap.children].forEach((el, i) => {
    el.style.animationDelay = `${base + i * 60}ms`;
    el.classList.add('card-flip');
  });
  dramaEndAt = Math.max(dramaEndAt, Date.now() + base + DRAMA_FLIP_MS + 150);
}
