// Bottom-sheet chat + emoji reactions.
import * as socket from '../socket.js';
import { $, store } from '../app.js';
import { sfx } from '../sound.js';
import { esc } from '../screens/lobby.js';

let unread = 0;
let open = false;

export function initChat() {
  $('#chat-bubble').addEventListener('click', () => {
    open = true;
    $('#chat-sheet').classList.remove('hidden');
    unread = 0;
    renderUnread();
    scrollDown();
    setTimeout(() => $('#chat-input').focus(), 60);
  });
  $('#chat-sheet').querySelector('.sheet-close').addEventListener('click', () => { open = false; });
  $('#chat-sheet').addEventListener('click', (e) => {
    if (e.target === $('#chat-sheet')) { $('#chat-sheet').classList.add('hidden'); open = false; }
  });

  const sendMsg = () => {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.send('chat:message', { text });
    input.value = '';
  };
  $('#chat-send').addEventListener('click', sendMsg);
  $('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });

  document.querySelectorAll('#emoji-row button').forEach(btn => {
    btn.addEventListener('click', () => socket.send('chat:emoji', { emoji: btn.dataset.emoji }));
  });

  socket.on('chat:message', (msg) => {
    addMessage(msg);
    if (!open && !msg.system) {
      unread++;
      renderUnread();
      sfx.chip();
    }
  });

  socket.on('chat:emoji', ({ userId, username, emoji }) => {
    floatEmoji(emoji);
    addMessage({ system: true, text: `${username} sent ${emoji}` });
  });
}

export function resetChat() {
  $('#chat-messages').innerHTML = '';
  unread = 0;
  renderUnread();
}

function addMessage({ system, userId, username, text }) {
  const box = $('#chat-messages');
  const div = document.createElement('div');
  if (system) {
    div.className = 'chat-msg system';
    div.textContent = text;
  } else {
    const mine = userId === store.profile?.userId;
    div.className = `chat-msg ${mine ? 'mine' : ''}`;
    div.innerHTML = `<b>${esc(username)}${mine ? ' (you)' : ''}:</b> ${esc(text)}`;
  }
  box.appendChild(div);
  while (box.children.length > 120) box.firstChild.remove();
  scrollDown();
}

function scrollDown() {
  const box = $('#chat-messages');
  box.scrollTop = box.scrollHeight;
}

function renderUnread() {
  const badge = $('#chat-unread');
  badge.classList.toggle('hidden', unread === 0);
  badge.textContent = unread > 9 ? '9+' : unread;
}

function floatEmoji(emoji) {
  const el = document.createElement('div');
  el.className = 'float-emoji';
  el.textContent = emoji;
  el.style.left = `${15 + Math.random() * 70}vw`;
  el.style.top = '72vh';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2100);
}
