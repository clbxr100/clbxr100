// Battle pass: season progress bar, Gold Pass upsell, 20-tier reward track.
import { api } from '../api.js';
import * as socket from '../socket.js';
import { $, store, fmt, onShow, toast, setProfile, showScreen } from '../app.js';
import { sfx } from '../sound.js';
import { FX } from '../effects/fx.js';
import { esc } from './lobby.js';

export function initBattlepass() {
  $('#nav-battlepass').addEventListener('click', () => showScreen('battlepass'));
  onShow('battlepass', render);
}

async function render() {
  const body = $('#bp-body');
  body.innerHTML = '<div class="empty-note"><span class="spin">🂠</span></div>';
  let bp;
  try {
    bp = await api.get('/api/battlepass');
  } catch (err) {
    body.innerHTML = `<div class="empty-note">${esc(err.message)}</div>`;
    return;
  }

  const daysLeft = Math.max(0, Math.ceil((bp.endsAt - Date.now()) / 86400000));
  const maxXp = bp.tiers[bp.tiers.length - 1].needXp;
  const pct = Math.min(100, Math.round((bp.xp / maxXp) * 100));
  const currentTier = bp.tiers.filter(t => t.unlocked).length;
  const claimable = bp.tiers.filter(t =>
    t.unlocked && (!t.freeClaimed || (bp.gold && !t.goldClaimed))).length;

  body.innerHTML = `
    <div class="bp-head">
      <div class="bp-head-top">
        <b>Season ${esc(bp.season)}</b>
        <span class="row-sub">${daysLeft}d left</span>
      </div>
      <div class="quest-bar bp-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
      <div class="row-sub">Tier ${currentTier}/${bp.tiers.length} · ${fmt(bp.xp)} season XP${claimable ? ` · <b class="live-text">${claimable} to claim!</b>` : ''}</div>
      ${bp.gold
        ? '<span class="badge gold">✨ GOLD PASS ACTIVE</span>'
        : `<button class="btn btn-gold" id="bp-buy">✨ Get Gold Pass — 🪙 ${fmt(bp.goldPrice)}</button>`}
    </div>
    <div class="bp-track">
      ${bp.tiers.map(t => tierRow(t, bp.gold)).join('')}
    </div>`;

  const buyBtn = $('#bp-buy');
  if (buyBtn) buyBtn.addEventListener('click', async () => {
    buyBtn.disabled = true;
    try {
      const res = await api.post('/api/battlepass/buy');
      setProfile(res.profile);
      sfx.bigWin();
      FX.play('coinRain', { duration: 2000 });
      toast('✨ Gold Pass unlocked — enjoy the good stuff!', 'gold');
      render();
    } catch (err) {
      toast(err.message, 'error');
      buyBtn.disabled = false;
    }
  });

  body.querySelectorAll('[data-claim-tier]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const res = await api.post('/api/battlepass/claim', {
        tier: Number(btn.dataset.claimTier),
        track: btn.dataset.claimTrack,
      });
      setProfile(res.profile);
      sfx.coin();
      toast(`🎫 Claimed ${res.reward.emoji} ${res.reward.name}!`, 'gold');
      render();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  }));
}

function tierRow(t, hasGold) {
  return `<div class="bp-tier ${t.unlocked ? 'unlocked' : ''}">
    <div class="bp-tier-num"><b>${t.tier}</b><small>${fmt(t.needXp)}</small></div>
    ${rewardCell(t, 'free', t.free, t.freeClaimed, t.unlocked, true)}
    ${rewardCell(t, 'gold', t.gold, t.goldClaimed, t.unlocked, hasGold)}
  </div>`;
}

function rewardCell(t, track, reward, claimed, unlocked, eligible) {
  const canClaim = unlocked && eligible && !claimed;
  return `<div class="bp-cell ${track} ${claimed ? 'claimed' : ''} ${canClaim ? 'ready' : ''}">
    <span class="bp-emoji">${reward.emoji}</span>
    <span class="bp-name">${esc(reward.name)}${reward.exclusive ? ' <span class="badge gold">EXCLUSIVE</span>' : ''}</span>
    ${claimed ? '<span class="quest-done">✓</span>'
      : canClaim ? `<button class="btn btn-gold btn-sm" data-claim-tier="${t.tier}" data-claim-track="${track}">Claim</button>`
      : `<span class="bp-lock">${track === 'gold' && !eligible ? '✨' : '🔒'}</span>`}
  </div>`;
}
