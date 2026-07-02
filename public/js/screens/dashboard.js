// Dashboard: coins, daily bonus, bailout, stats, navigation.
import { api } from '../api.js';
import { $, store, fmt, toast, setProfile, showScreen, onShow } from '../app.js';
import { sfx } from '../sound.js';

export function initDashboard() {
  $('#nav-play').addEventListener('click', () => showScreen('lobby'));
  $('#nav-tournaments').addEventListener('click', () => showScreen('tournaments'));
  $('#nav-shop').addEventListener('click', () => showScreen('shop'));
  $('#nav-leaderboard').addEventListener('click', () => showScreen('leaderboard'));
  onShow('dashboard', loadQuests);

  $('#btn-daily').addEventListener('click', async () => {
    try {
      const res = await api.post('/api/daily-bonus');
      setProfile(res.profile);
      sfx.coin();
      toast(`🎁 +${fmt(res.amount)} coins! Streak: ${res.streak} day${res.streak > 1 ? 's' : ''}`, 'gold');
    } catch (err) {
      toast(err.message, 'error');
    }
    renderDashboard();
  });

  $('#btn-bailout').addEventListener('click', async () => {
    try {
      const res = await api.post('/api/bailout');
      setProfile(res.profile);
      sfx.coin();
      toast(`🆘 +${fmt(res.amount)} coins bailout`, 'gold');
    } catch (err) {
      toast(err.message, 'error');
    }
    renderDashboard();
  });
}

export function renderDashboard() {
  const p = store.profile;
  if (!p) return;
  $('#dash-avatar').innerHTML = p.avatar + (p.pet && store.catalog?.pets[p.pet] ? `<span class="seat-pet">${store.catalog.pets[p.pet].emoji}</span>` : '');
  $('#dash-name').textContent = p.username + (p.isGuest ? ' (guest)' : '');
  $('#dash-coins').textContent = fmt(p.coins);

  const dailyReady = !p.lastDailyBonusAt || Date.now() - p.lastDailyBonusAt >= 24 * 60 * 60 * 1000;
  const daily = $('#btn-daily');
  daily.disabled = !dailyReady;
  daily.textContent = dailyReady ? '🎁 Daily Bonus' : `🎁 Next bonus in ${hoursLeft(p.lastDailyBonusAt + 24 * 3600 * 1000)}`;

  $('#btn-bailout').classList.toggle('hidden', p.coins >= 1000);

  const s = p.stats || {};
  $('#stats-grid').innerHTML = [
    [s.hands_played, 'Hands'],
    [s.hands_won, 'Won'],
    [fmt(s.biggest_pot), 'Best Pot'],
    [s.powerups_used, 'Power-ups'],
    [s.items_thrown, 'Thrown'],
    [`${s.tournaments_won || 0}/${s.tournaments_played || 0}`, 'Tourneys W/P'],
  ].map(([v, l]) => `<div class="stat"><b>${v || 0}</b><span>${l}</span></div>`).join('');
}

async function loadQuests() {
  try {
    const { quests } = await api.get('/api/quests');
    renderQuests(quests);
  } catch { /* not signed in yet */ }
}

function renderQuests(quests) {
  const list = $('#quests-list');
  if (!quests || !quests.length) { list.innerHTML = ''; return; }
  list.innerHTML = quests.map(q => {
    const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
    const done = q.progress >= q.target;
    return `<div class="quest-row">
      <span class="quest-emoji">${q.emoji}</span>
      <div class="quest-info">
        <div class="quest-name">${q.name} <small>${q.desc}</small></div>
        <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
      </div>
      ${q.claimed
        ? '<span class="quest-done">✓</span>'
        : done
          ? `<button class="btn btn-gold btn-sm" data-claim="${q.id}">+${fmt(q.reward)}</button>`
          : `<span class="quest-progress">${q.progress}/${q.target}</span>`}
    </div>`;
  }).join('');

  list.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const res = await api.post('/api/quests/claim', { questId: b.dataset.claim });
      setProfile(res.profile);
      sfx.coin();
      toast(`📋 Quest complete! +${fmt(res.reward)} coins`, 'gold');
      renderQuests(res.quests);
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}

function hoursLeft(ts) {
  const ms = Math.max(0, ts - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.ceil((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
