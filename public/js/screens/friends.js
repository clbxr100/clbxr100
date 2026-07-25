// Friends: add by username, accept/decline, online status, join-their-table,
// and private messages in a bottom sheet.
import { api } from '../api.js';
import * as socket from '../socket.js';
import { $, store, onShow, toast, showScreen } from '../app.js';
import { sfx } from '../sound.js';
import { esc } from './lobby.js';

let dmWith = null; // {userId, username} while the DM sheet is open
let totalUnread = 0;

export function initFriends() {
  $('#nav-friends').addEventListener('click', () => showScreen('friends'));
  onShow('friends', render);

  $('#friend-add').addEventListener('click', addFriend);
  $('#friend-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFriend(); });

  $('#dm-close').addEventListener('click', closeDm);
  $('#dm-sheet').addEventListener('click', (e) => { if (e.target === $('#dm-sheet')) closeDm(); });
  const sendDm = () => {
    const text = $('#dm-input').value.trim();
    if (!text || !dmWith) return;
    socket.send('dm:send', { toUserId: dmWith.userId, text });
    $('#dm-input').value = '';
  };
  $('#dm-send').addEventListener('click', sendDm);
  $('#dm-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendDm(); });

  socket.on('dm:message', (msg) => {
    const mine = msg.fromId === store.profile?.userId;
    if (dmWith && (msg.fromId === dmWith.userId || mine)) {
      appendDm(msg);
    } else if (!mine) {
      totalUnread++;
      renderUnreadBadge();
      toast(`💬 ${msg.fromName}: ${msg.text.slice(0, 40)}`);
      sfx.chip();
      if (store.screen === 'friends') render();
    }
  });

  socket.on('friend:request', ({ username }) => {
    toast(`👥 ${username} wants to be friends!`, 'gold');
    sfx.gift();
    if (store.screen === 'friends') render();
  });
  socket.on('friend:accepted', ({ username }) => {
    toast(`👥 ${username} accepted your request!`, 'gold');
    sfx.gift();
    if (store.screen === 'friends') render();
  });
}

async function addFriend() {
  const name = $('#friend-name').value.trim();
  if (!name) return;
  try {
    const res = await api.post('/api/friends/request', { username: name });
    toast(`Request sent to ${res.username} 👋`);
    $('#friend-name').value = '';
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function render() {
  try {
    const { friends, incoming, sent } = await api.get('/api/friends');
    totalUnread = friends.reduce((s, f) => s + (f.unread || 0), 0);
    renderUnreadBadge();

    $('#friend-requests').innerHTML =
      incoming.map(r => `
        <div class="row-card">
          <span class="lb-avatar">${r.avatar}</span>
          <div class="row-main"><div class="row-title">${esc(r.username)}</div><div class="row-sub">wants to be friends</div></div>
          <button class="btn btn-success btn-sm" data-accept="${r.userId}">✓</button>
          <button class="btn btn-ghost btn-sm" data-decline="${r.userId}">✕</button>
        </div>`).join('')
      + sent.map(r => `
        <div class="row-card" style="opacity:0.65">
          <span class="lb-avatar">${r.avatar}</span>
          <div class="row-main"><div class="row-title">${esc(r.username)}</div><div class="row-sub">request pending…</div></div>
        </div>`).join('');

    $('#friend-list').innerHTML = friends.length
      ? friends.map(f => `
        <div class="row-card">
          <span class="lb-avatar presence ${f.online ? 'online' : ''}">${f.avatar}</span>
          <div class="row-main">
            <div class="row-title">${esc(f.username)} ${f.unread ? `<span class="chat-unread" style="position:static">${f.unread}</span>` : ''}</div>
            <div class="row-sub">${f.online ? (f.table ? `🎰 at ${esc(f.table.name)}` : '🟢 online') : '⚫ offline'}</div>
          </div>
          ${f.online && f.table ? `<button class="btn btn-success btn-sm" data-jointable="${f.table.tableId}">Join</button>` : ''}
          <button class="btn btn-primary btn-sm" data-dm="${f.userId}" data-dmname="${esc(f.username)}">💬</button>
          <button class="btn btn-ghost btn-sm" data-unfriend="${f.userId}">✕</button>
        </div>`).join('')
      : '<div class="empty-note">No friends yet.<br>Add someone by their username! 👆</div>';

    wireButtons();
  } catch (err) {
    $('#friend-list').innerHTML = `<div class="empty-note">${esc(err.message)}</div>`;
  }
}

function wireButtons() {
  const body = $('#friends-body');
  body.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', async () => {
    await api.post('/api/friends/respond', { userId: Number(b.dataset.accept), accept: true }).catch(e => toast(e.message, 'error'));
    render();
  }));
  body.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', async () => {
    await api.post('/api/friends/respond', { userId: Number(b.dataset.decline), accept: false }).catch(e => toast(e.message, 'error'));
    render();
  }));
  body.querySelectorAll('[data-unfriend]').forEach(b => b.addEventListener('click', async () => {
    await api.post('/api/friends/remove', { userId: Number(b.dataset.unfriend) }).catch(e => toast(e.message, 'error'));
    render();
  }));
  body.querySelectorAll('[data-jointable]').forEach(b => b.addEventListener('click', () => {
    socket.send('lobby:joinTable', { tableId: b.dataset.jointable });
  }));
  body.querySelectorAll('[data-dm]').forEach(b => b.addEventListener('click', () => openDm(Number(b.dataset.dm), b.dataset.dmname)));
}

async function openDm(userId, username) {
  dmWith = { userId, username };
  $('#dm-title').textContent = `💬 ${username}`;
  $('#dm-messages').innerHTML = '<span class="spin">🂠</span>';
  $('#dm-sheet').classList.remove('hidden');
  try {
    const { messages } = await api.get(`/api/dm?with=${userId}`);
    $('#dm-messages').innerHTML = '';
    messages.forEach(appendDm);
    render(); // clears the unread count we just consumed
  } catch (err) {
    $('#dm-messages').innerHTML = `<div class="chat-msg system">${esc(err.message)}</div>`;
  }
  setTimeout(() => $('#dm-input').focus(), 80);
}

function closeDm() {
  dmWith = null;
  $('#dm-sheet').classList.add('hidden');
}

function appendDm(msg) {
  const box = $('#dm-messages');
  const mine = (msg.fromId ?? msg.from_id) === store.profile?.userId;
  const div = document.createElement('div');
  div.className = `chat-msg ${mine ? 'mine' : ''}`;
  div.innerHTML = `<b>${mine ? 'you' : esc(dmWith ? dmWith.username : '')}:</b> ${esc(msg.text)}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function renderUnreadBadge() {
  const badge = $('#friends-unread');
  badge.classList.toggle('hidden', totalUnread === 0);
  badge.textContent = totalUnread > 9 ? '9+' : totalUnread;
}
