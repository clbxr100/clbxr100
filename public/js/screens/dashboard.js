// Dashboard: coins, daily bonus, daily spin, bailout, stats, navigation.
import { api } from '../api.js';
import { $, store, fmt, toast, setProfile, showScreen, onShow, ensureCatalog } from '../app.js';
import { sfx } from '../sound.js';

export function initDashboard() {
  $('#nav-play').addEventListener('click', () => showScreen('lobby'));
  $('#nav-tournaments').addEventListener('click', () => showScreen('tournaments'));
  $('#nav-shop').addEventListener('click', () => showScreen('shop'));
  $('#nav-leaderboard').addEventListener('click', () => showScreen('leaderboard'));
  onShow('dashboard', () => { loadQuests(); loadAchievements(); });

  $('#gift-send').addEventListener('click', async () => {
    const username = $('#gift-name').value.trim();
    const amount = Number($('#gift-amount').value);
    if (!username || !amount) return;
    $('#gift-send').disabled = true;
    try {
      const res = await api.post('/api/admin/gift', { username, amount });
      toast(`👑 Gifted ${fmt(res.amount)} chips to ${res.username}!`, 'gold');
      sfx.coin();
      $('#gift-name').value = '';
      $('#gift-amount').value = '';
    } catch (err) {
      toast(err.message, 'error');
    }
    $('#gift-send').disabled = false;
  });

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

  $('#btn-spin').addEventListener('click', openSpinWheel);

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
  const avEl = $('#dash-avatar');
  avEl.innerHTML = p.avatar + (p.pet && store.catalog?.pets[p.pet] ? `<span class="seat-pet">${store.catalog.pets[p.pet].emoji}</span>` : '');
  avEl.className = 'me-avatar' + (p.frame ? ` avframe ${p.frame}` : '');
  $('#dash-name').textContent = p.username + (p.isGuest ? ' (guest)' : '');
  $('#dash-coins').textContent = fmt(p.coins);

  $('#admin-card').classList.toggle('hidden', !p.isAdmin);

  // XP / rank card
  if (p.rank) {
    $('#xp-rank').textContent = `${p.rank.emoji} ${p.rank.title}`;
    $('#xp-level').textContent = `Lv ${p.level}`;
    const span = Math.max(1, p.nextLevelXp - p.levelStartXp);
    const into = Math.max(0, p.xp - p.levelStartXp);
    $('#xp-fill').style.width = `${Math.min(100, Math.round((into / span) * 100))}%`;
    $('#xp-sub').textContent = `${fmt(into)} / ${fmt(span)} XP to level ${p.level + 1}`;
  }

  const dailyReady = !p.lastDailyBonusAt || Date.now() - p.lastDailyBonusAt >= 24 * 60 * 60 * 1000;
  const daily = $('#btn-daily');
  daily.disabled = !dailyReady;
  daily.textContent = dailyReady ? '🎁 Daily Bonus' : `🎁 Next bonus in ${hoursLeft(p.lastDailyBonusAt + 24 * 3600 * 1000)}`;

  $('#btn-bailout').classList.toggle('hidden', p.coins >= 1000);

  const spinCooldown = store.catalog?.spin?.cooldownMs || 20 * 3600 * 1000;
  const spinReady = !p.lastSpinAt || Date.now() - p.lastSpinAt >= spinCooldown;
  const spinBtn = $('#btn-spin');
  spinBtn.disabled = !spinReady;
  spinBtn.textContent = spinReady ? '🎡 Daily Spin' : `🎡 Spin in ${hoursLeft(p.lastSpinAt + spinCooldown)}`;

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

async function loadAchievements() {
  try {
    const { achievements } = await api.get('/api/achievements');
    const unlocked = achievements.filter(a => a.unlocked).length;
    $('#ach-count').textContent = `${unlocked}/${achievements.length}`;
    $('#ach-grid').innerHTML = achievements.map(a => `
      <button class="ach ${a.unlocked ? 'unlocked' : ''} ${store.profile?.badge === a.id ? 'equipped' : ''}"
        ${a.unlocked ? `data-badge="${a.id}"` : 'disabled'}
        title="${a.name}: ${a.desc}">
        <span class="ach-badge">${a.unlocked ? a.badge : '🔒'}</span>
        <span class="ach-name">${a.name}</span>
      </button>`).join('');
    $('#ach-grid').querySelectorAll('[data-badge]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.badge;
      const next = store.profile?.badge === id ? null : id; // tap again to unequip
      try {
        const res = await api.post('/api/profile/equip', { badge: next });
        setProfile(res.profile);
        sfx.gift();
        toast(next ? 'Badge equipped — it shows at the table!' : 'Badge removed');
        loadAchievements();
      } catch (err) {
        toast(err.message, 'error');
      }
    }));
  } catch { /* signed out */ }
}

function hoursLeft(ts) {
  const ms = Math.max(0, ts - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.ceil((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ---------- Daily Spin prize wheel ----------

const SEG_COLORS = ['#1e3a8a', '#0e7490', '#5b21b6', '#9d174d', '#166534', '#92400e', '#334155'];

async function openSpinWheel() {
  await ensureCatalog();
  const spin = store.catalog?.spin;
  if (!spin) { toast('Shop is still loading — try again', 'error'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'spin-overlay';
  overlay.innerHTML = `
    <div class="spin-modal">
      <h2>🎡 Daily Spin</h2>
      <div class="spin-wheel-wrap">
        <div class="spin-pointer">▼</div>
        <canvas class="spin-canvas" width="600" height="600"></canvas>
      </div>
      <div class="spin-prize hidden"></div>
      <div class="spin-actions">
        <button class="btn btn-gold spin-go">SPIN!</button>
        <button class="btn btn-ghost spin-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector('.spin-canvas');
  const segs = spin.segments;
  drawWheel(canvas, segs, 0);

  let spinning = false;
  const close = () => { if (!spinning) overlay.remove(); };
  overlay.querySelector('.spin-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('.spin-go').addEventListener('click', async (e) => {
    const goBtn = e.currentTarget;
    goBtn.disabled = true;
    spinning = true;
    let res;
    try {
      res = await api.post('/api/spin');
    } catch (err) {
      spinning = false;
      goBtn.disabled = false;
      toast(err.message, 'error');
      if (err.message && err.message.includes('not ready')) overlay.remove();
      renderDashboard();
      return;
    }
    // Land the winning segment's center under the top pointer, +4 laps.
    const segAngle = (Math.PI * 2) / segs.length;
    const target = Math.PI * 2 * 4 + (Math.PI * 2 - (res.index + 0.5) * segAngle) - Math.PI / 2;
    const start = performance.now();
    const DURATION = 3800;
    let lastTick = -1;
    const frame = (now) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3.2); // long decelerating tail
      const angle = target * eased;
      drawWheel(canvas, segs, angle);
      // click as each segment edge passes the pointer
      const tick = Math.floor(angle / segAngle);
      if (tick !== lastTick && t < 0.97) { lastTick = tick; sfx.chip(); }
      if (t < 1) { requestAnimationFrame(frame); return; }
      spinning = false;
      showPrize(overlay, res);
    };
    requestAnimationFrame(frame);
  });
}

function showPrize(overlay, res) {
  setProfile(res.profile);
  const seg = res.segment;
  const bits = [];
  if (res.coins) bits.push(`🪙 ${fmt(res.coins)} coins`);
  if (res.item) {
    const item = findAnyItem(res.item.itemId);
    bits.push(`${item?.emoji || '🎁'} ${item?.name || res.item.itemId}${res.item.qty > 1 ? ` ×${res.item.qty}` : ''}`);
  }
  const prizeEl = overlay.querySelector('.spin-prize');
  prizeEl.innerHTML = `<span class="spin-prize-emoji">${seg.emoji}</span> You won <b>${bits.join(' + ') || seg.label}</b>!`;
  prizeEl.classList.remove('hidden');
  if (seg.id === 'jackpot') { sfx.bigWin(); prizeEl.classList.add('jackpot'); }
  else sfx.coin();
  const go = overlay.querySelector('.spin-go');
  go.textContent = 'See you tomorrow!';
  renderDashboard();
}

function findAnyItem(id) {
  const c = store.catalog;
  if (!c) return null;
  return c.frames?.[id] || c.powerups?.[id] || c.throwables?.[id] || c.pets?.[id]
    || c.avatars?.premium?.[id] || c.celebrations?.[id] || null;
}

function drawWheel(canvas, segs, rotation) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, cx = W / 2, cy = W / 2, r = W / 2 - 10;
  ctx.clearRect(0, 0, W, W);
  const segAngle = (Math.PI * 2) / segs.length;
  for (let i = 0; i < segs.length; i++) {
    const a0 = rotation + i * segAngle;
    const jackpot = segs[i].id === 'jackpot';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a0 + segAngle);
    ctx.closePath();
    ctx.fillStyle = jackpot ? '#b8860b' : SEG_COLORS[i % SEG_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,130,0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // label along the segment's bisector
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a0 + segAngle / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '44px system-ui';
    ctx.fillText(segs[i].emoji, r * 0.62, 16);
    ctx.font = `bold ${jackpot ? 26 : 24}px system-ui`;
    ctx.fillStyle = jackpot ? '#ffe9a8' : 'rgba(255,255,255,0.92)';
    ctx.fillText(segs[i].label, r * 0.62, 52);
    ctx.restore();
  }
  // hub
  ctx.beginPath();
  ctx.arc(cx, cy, 46, 0, Math.PI * 2);
  ctx.fillStyle = '#101a30';
  ctx.fill();
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.font = '40px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('🎰', cx, cy + 14);
  // outer rim
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 6;
  ctx.stroke();
}
