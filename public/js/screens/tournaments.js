// Sit & Go tournaments: list, host, register.
import * as socket from '../socket.js';
import { $, store, fmt, onShow, modal, closeModal, toast } from '../app.js';
import { getLobbyData, esc } from './lobby.js';

export function initTournaments() {
  onShow('tournaments', () => {
    socket.send('lobby:subscribe');
    render();
  });
  window.addEventListener('tournaments:render', render);
  $('#btn-create-tourney').addEventListener('click', openCreateModal);

  socket.on('tournament:registered', () => toast('Registered! Waiting for players…', 'gold'));
  socket.on('tournament:unregistered', () => toast('Entry refunded'));
}

function render() {
  const list = $('#tourney-list');
  const tourneys = (getLobbyData().tournaments || []).filter(t => t.state !== 'finished');
  if (tourneys.length === 0) {
    list.innerHTML = '<div class="empty-note">No tournaments running.<br>Host a Sit &amp; Go! 🏆</div>';
    return;
  }
  const myId = store.profile?.userId;
  list.innerHTML = tourneys.map(t => {
    const mine = t.entrants.some(e => !e.isBot && e.username === store.profile?.username);
    const full = t.entrants.length >= t.maxPlayers;
    const chips = t.entrants.map(e => `<span title="${esc(e.username)}">${e.avatar}</span>`).join(' ');
    let btns = '';
    if (t.state === 'registering') {
      if (mine) {
        btns = `<button class="btn btn-ghost btn-sm" data-tleave="${t.tournamentId}">Leave</button>`;
        if (t.creatorId === myId) btns += ` <button class="btn btn-success btn-sm" data-tstart="${t.tournamentId}">Start</button>`;
      } else {
        btns = `<button class="btn btn-primary btn-sm" data-tjoin="${t.tournamentId}" ${full ? 'disabled' : ''}>Enter</button>`;
      }
    } else {
      btns = '<span class="badge green">Running</span>';
    }
    return `
      <div class="row-card">
        <div class="row-main">
          <div class="row-title">🏆 ${esc(t.name)} <span class="badge gold">🪙${fmt(t.prizePool)} pool</span></div>
          <div class="row-sub">Entry 🪙${fmt(t.entryFee)} · ${t.entrants.length}/${t.maxPlayers} ${t.fillBots ? '· bots fill' : ''}</div>
          <div class="row-sub">${chips}</div>
        </div>
        ${btns}
      </div>`;
  }).join('');

  list.querySelectorAll('[data-tjoin]').forEach(b => b.addEventListener('click', () => socket.send('tournament:join', { tournamentId: b.dataset.tjoin })));
  list.querySelectorAll('[data-tleave]').forEach(b => b.addEventListener('click', () => socket.send('tournament:leave', { tournamentId: b.dataset.tleave })));
  list.querySelectorAll('[data-tstart]').forEach(b => b.addEventListener('click', () => socket.send('tournament:start', { tournamentId: b.dataset.tstart })));
}

function openCreateModal() {
  const fees = store.catalog?.economy?.tournamentFees || [500, 2500, 10000];
  const m = modal(`
    <h3>🏆 Host a Sit &amp; Go</h3>
    <div><label>Name</label><input type="text" id="tc-name" maxlength="30" placeholder="${esc(store.profile.username)}'s showdown"></div>
    <div class="modal-row">
      <div><label>Entry fee</label><select id="tc-fee">${fees.map(f => `<option value="${f}">🪙${fmt(f)}</option>`).join('')}</select></div>
      <div><label>Players</label><select id="tc-max">${[2,3,4,5,6,7,8].map(n => `<option ${n === 6 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </div>
    <div><label>Fill empty seats with bots?</label><select id="tc-bots"><option value="1">Yes — start anytime</option><option value="">No — humans only</option></select></div>
    <p class="row-sub">Everyone starts with 1,500 chips. Blinds go up every 8 hands. Top finishers split the pool.</p>
    <div class="modal-row">
      <button class="btn btn-ghost" id="tc-cancel">Cancel</button>
      <button class="btn btn-primary" id="tc-go">Create</button>
    </div>`);
  m.querySelector('#tc-cancel').addEventListener('click', closeModal);
  m.querySelector('#tc-go').addEventListener('click', () => {
    socket.send('tournament:create', {
      name: m.querySelector('#tc-name').value.trim() || `${store.profile.username}'s showdown`,
      entryFee: Number(m.querySelector('#tc-fee').value),
      maxPlayers: Number(m.querySelector('#tc-max').value),
      fillBots: !!m.querySelector('#tc-bots').value,
    });
    closeModal();
  });
}
