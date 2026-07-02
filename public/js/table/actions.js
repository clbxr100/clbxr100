// Action bar, raise sheet, power-up tray, throw sheet, target/card picking.
import * as socket from '../socket.js';
import { $, store, fmt, toast } from '../app.js';
import { sfx } from '../sound.js';
import { esc } from '../screens/lobby.js';

let state = null;
let pick = null; // { kind: 'powerup'|'throw', type/itemId, source, needsCardIndex }

export function initActions() {
  document.querySelectorAll('#action-buttons .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (!state || !state.you?.canAct) return;
      if (act === 'raise') { openRaiseSheet(); return; }
      if (act === 'call' && state.you.toCall >= myChips()) {
        socket.send('game:action', { action: 'allin' });
        return;
      }
      socket.send('game:action', { action: act });
    });
  });

  // raise sheet
  const slider = $('#raise-slider');
  slider.addEventListener('input', () => { $('#raise-amount').textContent = fmt(slider.value); });
  $('#raise-cancel').addEventListener('click', () => hideSheet('raise-sheet'));
  $('#raise-confirm').addEventListener('click', () => {
    const amount = Number(slider.value);
    hideSheet('raise-sheet');
    if (amount >= myBet() + myChips()) socket.send('game:action', { action: 'allin' });
    else socket.send('game:action', { action: 'raise', amount });
  });
  document.querySelectorAll('.raise-presets .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const min = minRaiseTo();
      const max = myBet() + myChips();
      const pot = state?.pot || 0;
      let val = min;
      if (btn.dataset.preset === 'half') val = Math.max(min, state.currentBet + Math.floor(pot / 2));
      if (btn.dataset.preset === 'pot') val = Math.max(min, state.currentBet + pot);
      if (btn.dataset.preset === 'allin') val = max;
      slider.value = Math.min(max, val);
      $('#raise-amount').textContent = fmt(slider.value);
    });
  });

  // power-up tray
  $('#btn-powerups').addEventListener('click', openPowerUpSheet);
  $('#btn-throw').addEventListener('click', openThrowSheet);
  $('#target-cancel').addEventListener('click', clearPick);

  document.querySelectorAll('.sheet-close').forEach(btn => {
    btn.addEventListener('click', () => hideSheet(btn.dataset.close));
  });

  // seat taps (event delegation for target picking)
  $('#felt').addEventListener('click', (e) => {
    const seat = e.target.closest('.seat.targetable');
    if (!seat || !pick) return;
    // resolve back to the typed id (numbers for humans, strings for bots)
    const target = state?.players?.find(x => String(x.userId) === seat.dataset.uid);
    if (!target) return;
    if (pick.kind === 'throw') {
      socket.send('throw:item', { itemId: pick.itemId, targetUserId: target.userId });
    } else {
      socket.send('game:usePowerUp', { type: pick.type, source: pick.source, targetUserId: target.userId });
    }
    clearPick();
  });

  // hero card taps for Card Swap
  $('#hero-cards').addEventListener('click', (e) => {
    const card = e.target.closest('.pcard.selectable');
    if (!card || !pick || !pick.needsCardIndex) return;
    const idx = [...$('#hero-cards').children].indexOf(card);
    socket.send('game:usePowerUp', { type: pick.type, source: pick.source, cardIndex: idx });
    clearPick();
  });
}

function myPlayer() { return state?.players?.find(p => p.userId === store.profile?.userId); }
function myChips() { return myPlayer()?.chips || 0; }
function myBet() { return myPlayer()?.bet || 0; }
function minRaiseTo() { return (state?.currentBet || 0) + (state?.minRaise || 0); }

export function renderActions(st) {
  state = st;
  const you = st.you;
  const canAct = !!(you && you.canAct);
  $('#action-buttons').style.display = canAct ? 'flex' : 'none';
  $('#wait-note').style.display = canAct ? 'none' : 'block';

  const me = myPlayer();
  if (!me) $('#wait-note').textContent = 'Spectating…';
  else if (st.phase === 'waiting') $('#wait-note').textContent = 'Waiting for players…';
  else if (st.phase === 'handEnded') $('#wait-note').textContent = 'Next hand soon…';
  else if (me.folded) $('#wait-note').textContent = 'Folded — hang tight';
  else $('#wait-note').textContent = 'Waiting for your turn…';

  if (canAct) {
    const toCall = you.toCall;
    const checkBtn = document.querySelector('[data-act="check"]');
    const callBtn = document.querySelector('[data-act="call"]');
    checkBtn.style.display = toCall > 0 ? 'none' : '';
    callBtn.style.display = toCall > 0 ? '' : 'none';
    callBtn.textContent = toCall >= myChips() ? `All-in ${fmt(myChips())}` : `Call ${fmt(toCall)}`;
    const raiseBtn = document.querySelector('[data-act="raise"]');
    raiseBtn.disabled = myChips() <= toCall;
    raiseBtn.textContent = state.currentBet > 0 ? 'Raise' : 'Bet';
  }

  // power-up tray
  const tray = $('#btn-powerups');
  const trayEmoji = $('#pu-tray-emoji');
  const freeDef = you?.freePowerUp && store.catalog?.powerups?.[you.freePowerUp];
  const ownedCount = countOwnedPowerups();
  trayEmoji.textContent = you?.usedPowerUp ? '✅' : (freeDef ? freeDef.emoji : (ownedCount ? '⚡' : '⚡'));
  tray.classList.toggle('glow', canAct && !you?.usedPowerUp && !!(freeDef || ownedCount));
  tray.style.display = me ? '' : 'none';
  $('#btn-throw').style.display = me ? '' : 'none';
}

function countOwnedPowerups() {
  const inv = store.profile?.inventory || {};
  return Object.entries(inv).filter(([id, q]) => id.startsWith('pu_') && q > 0).length;
}

// ---------------- sheets ----------------

function showSheet(id) { $(`#${id}`).classList.remove('hidden'); }
function hideSheet(id) { $(`#${id}`).classList.add('hidden'); }

function openRaiseSheet() {
  const slider = $('#raise-slider');
  const min = Math.min(minRaiseTo(), myBet() + myChips());
  const max = myBet() + myChips();
  slider.min = min;
  slider.max = max;
  slider.step = Math.max(1, state.smallBlind);
  slider.value = min;
  $('#raise-amount').textContent = fmt(min);
  showSheet('raise-sheet');
}

function openPowerUpSheet() {
  const you = state?.you;
  if (!you || !myPlayer()) return;
  const cat = store.catalog?.powerups || {};
  const inv = store.profile?.inventory || {};
  const rows = [];

  const usable = you.canAct && !you.usedPowerUp;
  if (you.usedPowerUp) rows.push('<p class="row-sub">You already used a power-up this hand ✅</p>');
  else if (!you.canAct) rows.push('<p class="row-sub">You can use one on your turn ⏳</p>');

  if (you.freePowerUp && cat[you.freePowerUp]) {
    const d = cat[you.freePowerUp];
    rows.push(puButton(d, 'free', usable, '<span class="pu-free-badge">FREE THIS HAND</span>'));
  }
  for (const [id, qty] of Object.entries(inv)) {
    if (!id.startsWith('pu_') || qty < 1 || !cat[id]) continue;
    rows.push(puButton(cat[id], 'owned', usable, `<span class="pu-count">×${qty}</span>`));
  }
  if (rows.length === 0) rows.push('<p class="row-sub">No power-ups. A free one is dealt every hand, or stock up in the shop!</p>');
  $('#pu-list').innerHTML = rows.join('');

  $('#pu-list').querySelectorAll('.pu-item').forEach(btn => btn.addEventListener('click', () => {
    const type = btn.dataset.pu;
    const source = btn.dataset.source;
    const def = store.catalog.powerups[type];
    hideSheet('pu-sheet');
    if (def.id === 'pu_xray' && state.phase === 'river') { toast('No more cards coming', 'error'); return; }
    if (def.needsTarget) startPick({ kind: 'powerup', type, source }, `${def.emoji} Tap a player…`);
    else if (def.needsCardIndex) startCardPick({ kind: 'powerup', type, source, needsCardIndex: true });
    else socket.send('game:usePowerUp', { type, source });
  }));
  showSheet('pu-sheet');
}

function puButton(d, source, usable, extra) {
  return `<button class="pu-item" data-pu="${d.id}" data-source="${source}" ${usable ? '' : 'disabled'}>
    <span class="pu-emoji">${d.emoji}</span>
    <span class="pu-info">
      <span class="pu-name">${esc(d.name)} <span class="rarity ${d.rarity}">${d.rarity}</span> ${extra || ''}</span>
      <span class="pu-desc">${esc(d.desc)}</span>
    </span></button>`;
}

function openThrowSheet() {
  if (!myPlayer()) return;
  const cat = store.catalog?.throwables || {};
  const inv = store.profile?.inventory || {};
  const rows = [];
  for (const item of Object.values(cat)) {
    const qty = inv[item.id] || 0;
    rows.push(`<button class="pu-item" data-throw="${item.id}" ${qty ? '' : 'disabled'}>
      <span class="pu-emoji">${item.emoji}</span>
      <span class="pu-info">
        <span class="pu-name">${esc(item.name)} <span class="pu-count">×${qty}</span></span>
        <span class="pu-desc">${item.kind === 'gift' ? 'Friendly gift' : item.kind === 'burst' ? 'Confetti explosion' : 'Splats on them'}</span>
      </span></button>`);
  }
  rows.push('<p class="row-sub">Restock in the shop 🛍️</p>');
  $('#throw-list').innerHTML = rows.join('');
  $('#throw-list').querySelectorAll('[data-throw]').forEach(btn => btn.addEventListener('click', () => {
    const itemId = btn.dataset.throw;
    const item = cat[itemId];
    hideSheet('throw-sheet');
    startPick({ kind: 'throw', itemId }, `${item.emoji} Tap a player…`);
  }));
  showSheet('throw-sheet');
}

// ---------------- picking ----------------

function startPick(p, hint) {
  pick = p;
  $('#target-hint').classList.remove('hidden');
  $('#target-hint').firstChild.textContent = hint;
  const myId = String(store.profile?.userId);
  document.querySelectorAll('.seat').forEach(el => {
    const isMe = el.dataset.uid === myId;
    const player = state.players.find(x => String(x.userId) === el.dataset.uid);
    let ok = !isMe && player;
    if (ok && p.kind === 'powerup') {
      ok = !player.folded;
      if (p.type === 'pu_forcefold' && player.allIn) ok = false;
    }
    el.classList.toggle('targetable', !!ok);
  });
  sfx.powerup();
}

function startCardPick(p) {
  pick = p;
  $('#target-hint').classList.remove('hidden');
  $('#target-hint').firstChild.textContent = '🔄 Tap the card to replace…';
  document.querySelectorAll('#hero-cards .pcard').forEach(el => el.classList.add('selectable'));
}

export function clearPick() {
  pick = null;
  $('#target-hint').classList.add('hidden');
  document.querySelectorAll('.seat.targetable').forEach(el => el.classList.remove('targetable'));
  document.querySelectorAll('#hero-cards .selectable').forEach(el => el.classList.remove('selectable'));
}
