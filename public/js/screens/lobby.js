// Lobby: live table list + host-a-table modal.
import * as socket from '../socket.js';
import { $, store, fmt, onShow, modal, closeModal } from '../app.js';

let lobbyData = { tables: [], tournaments: [] };

export function initLobby() {
  socket.on('lobby:state', (data) => {
    lobbyData = data;
    if (store.screen === 'lobby') renderTables();
    if (store.screen === 'tournaments') window.dispatchEvent(new CustomEvent('tournaments:render'));
  });

  onShow('lobby', () => {
    socket.send('lobby:subscribe');
    renderTables();
  });

  $('#btn-create-table').addEventListener('click', openCreateModal);
}

export function getLobbyData() { return lobbyData; }

function renderTables() {
  const list = $('#table-list');
  const tables = lobbyData.tables || [];
  if (tables.length === 0) {
    list.innerHTML = `<div class="empty-note">
      <div class="empty-felt">🃏</div>
      No tables running.<br>Host one and invite your friends!
      <div class="empty-sub">Tip: add bots so the action never stops 🤖</div>
    </div>`;
    return;
  }
  list.innerHTML = tables.map(t => {
    const seatsHtml = Array.from({ length: Math.min(t.maxPlayers, 8) }, (_, i) => {
      const p = (t.players || [])[i];
      return p
        ? `<span class="mini-seat" title="${esc(p.name)}">${p.avatar}</span>`
        : '<span class="mini-seat empty"></span>';
    }).join('');
    return `
    <div class="row-card table-card stake-${t.stakes}">
      <div class="mini-felt">
        <span class="mini-stake">${cap(t.stakes)}</span>
        <div class="mini-seats">${seatsHtml}</div>
        ${t.inHand ? '<span class="live-dot"></span>' : ''}
      </div>
      <div class="row-main">
        <div class="row-title">${esc(t.name)} ${t.isPrivate ? '🔒' : ''}</div>
        <div class="row-sub">🪙 ${fmt(t.buyIn)} buy-in · blinds ${t.blinds[0]}/${t.blinds[1]}</div>
        <div class="row-sub">${t.seated}/${t.maxPlayers} seats${t.bots ? ` · 🤖 ${t.bots} bot${t.bots > 1 ? 's' : ''}` : ''}${t.inHand ? ` · <b class="live-text">hand #${t.handNumber} live</b>` : ' · waiting'}</div>
      </div>
      <button class="btn btn-primary btn-sm" data-join="${t.tableId}" data-private="${t.isPrivate ? 1 : ''}"
        ${t.seated >= t.maxPlayers ? 'disabled' : ''}>${t.seated >= t.maxPlayers ? 'Full' : 'Join'}</button>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-join]').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.private) {
      const m = modal(`
        <h3>🔒 Private table</h3>
        <input type="text" id="join-code" placeholder="Table code">
        <div class="modal-row">
          <button class="btn btn-ghost" id="jc-cancel">Cancel</button>
          <button class="btn btn-primary" id="jc-go">Join</button>
        </div>`);
      m.querySelector('#jc-cancel').addEventListener('click', closeModal);
      m.querySelector('#jc-go').addEventListener('click', () => {
        socket.send('lobby:joinTable', { tableId: btn.dataset.join, code: m.querySelector('#join-code').value.trim() });
        closeModal();
      });
    } else {
      socket.send('lobby:joinTable', { tableId: btn.dataset.join });
    }
  }));
}

function openCreateModal() {
  const stakes = store.catalog?.stakes || {};
  const stakeOpts = Object.values(stakes).map(s =>
    `<option value="${s.id}">${s.name} — ${s.smallBlind}/${s.bigBlind} (buy-in ${fmt(s.buyIn)})</option>`).join('');
  const m = modal(`
    <h3>🎰 Host a table</h3>
    <div><label>Table name</label><input type="text" id="ct-name" maxlength="30" placeholder="${esc(store.profile.username)}'s table"></div>
    <div><label>Stakes</label><select id="ct-stakes">${stakeOpts}</select></div>
    <div class="modal-row">
      <div><label>Seats</label><select id="ct-max">${[2,3,4,5,6,7,8].map(n => `<option ${n === 6 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div><label>Bots</label><select id="ct-bots">${[0,1,2,3,4,5,6,7].map(n => `<option>${n}</option>`).join('')}</select></div>
    </div>
    <div class="modal-row">
      <div><label>Private?</label><select id="ct-private"><option value="">Public</option><option value="1">Private</option></select></div>
      <div id="ct-code-wrap" class="hidden"><label>Code</label><input type="text" id="ct-code" maxlength="12" placeholder="secret"></div>
    </div>
    <div class="modal-row">
      <button class="btn btn-ghost" id="ct-cancel">Cancel</button>
      <button class="btn btn-primary" id="ct-go">Deal me in</button>
    </div>`);

  m.querySelector('#ct-private').addEventListener('change', (e) => {
    m.querySelector('#ct-code-wrap').classList.toggle('hidden', !e.target.value);
  });
  m.querySelector('#ct-cancel').addEventListener('click', closeModal);
  m.querySelector('#ct-go').addEventListener('click', () => {
    socket.send('lobby:createTable', {
      name: m.querySelector('#ct-name').value.trim() || `${store.profile.username}'s table`,
      stakes: m.querySelector('#ct-stakes').value,
      maxPlayers: Number(m.querySelector('#ct-max').value),
      botCount: Number(m.querySelector('#ct-bots').value),
      isPrivate: !!m.querySelector('#ct-private').value,
      code: m.querySelector('#ct-code').value.trim(),
    });
    closeModal();
  });
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
