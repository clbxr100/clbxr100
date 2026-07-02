// Leaderboard: top 20 across four categories, with your own rank pinned.
import { api } from '../api.js';
import { $, store, fmt, onShow } from '../app.js';
import { esc } from './lobby.js';

let by = 'coins';

const LABELS = { coins: '🪙', hands_won: '🏆', biggest_pot: '💰', tournaments_won: '🎖️' };

export function initLeaderboard() {
  onShow('leaderboard', render);
  document.querySelectorAll('#lb-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#lb-tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
      by = tab.dataset.by;
      render();
    });
  });
}

async function render() {
  const list = $('#lb-list');
  list.innerHTML = '<div class="empty-note"><span class="spin">🂠</span></div>';
  try {
    const { rows, me } = await api.get(`/api/leaderboard?by=${by}`);
    if (!rows.length) {
      list.innerHTML = '<div class="empty-note">Nobody on the board yet.<br>Go win some hands! 🃏</div>';
      return;
    }
    const myId = store.profile?.userId;
    list.innerHTML = rows.map((r, i) => `
      <div class="row-card lb-row ${r.userId === myId ? 'lb-me' : ''}">
        <span class="lb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)}</span>
        <span class="lb-avatar">${r.avatar}</span>
        <div class="row-main">
          <div class="row-title">${esc(r.username)}${r.isGuest ? ' <span class="badge">guest</span>' : ''}${r.userId === myId ? ' <span class="badge green">you</span>' : ''}</div>
        </div>
        <span class="lb-value">${LABELS[by]} ${fmt(r.value)}</span>
      </div>`).join('')
      + (me && me.rank && !rows.some(r => r.userId === myId)
        ? `<div class="row-card lb-row lb-me"><span class="lb-rank">#${me.rank}</span><span class="lb-avatar">${store.profile.avatar}</span>
           <div class="row-main"><div class="row-title">${esc(store.profile.username)} <span class="badge green">you</span></div></div>
           <span class="lb-value">${LABELS[by]} ${fmt(me.value)}</span></div>`
        : '');
  } catch (err) {
    list.innerHTML = `<div class="empty-note">Couldn't load the board (${esc(err.message)})</div>`;
  }
}
