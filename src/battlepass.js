// Monthly battle pass: season XP unlocks 20 tiers across a free track and
// a Gold track (bought with play-money coins). Rewards are coins or items.

const { db, transaction } = require('./db');
const { authed } = require('./shop');
const { getUser, publicProfile } = require('./auth');
const { BATTLEPASS, bpSeason, bpSeasonEndsAt, bpTierXp, findItem } = require('./catalog');
const economy = require('./economy');

function seasonXp(userId, season) {
  const row = db.prepare('SELECT xp FROM season_xp WHERE user_id = ? AND season = ?').get(userId, season);
  return row ? row.xp : 0;
}

function hasGold(userId, season) {
  return !!db.prepare('SELECT 1 FROM bp_premium WHERE user_id = ? AND season = ?').get(userId, season);
}

function getState(userId) {
  const season = bpSeason();
  const xp = seasonXp(userId, season);
  const gold = hasGold(userId, season);
  const claimed = new Set(
    db.prepare('SELECT tier, track FROM bp_claims WHERE user_id = ? AND season = ?')
      .all(userId, season).map(r => `${r.tier}:${r.track}`)
  );
  const tiers = [];
  for (let n = 1; n <= BATTLEPASS.tiers; n++) {
    const def = BATTLEPASS.rewards[n];
    tiers.push({
      tier: n,
      needXp: bpTierXp(n),
      unlocked: xp >= bpTierXp(n),
      free: describeReward(def.free),
      gold: describeReward(def.gold),
      freeClaimed: claimed.has(`${n}:free`),
      goldClaimed: claimed.has(`${n}:gold`),
    });
  }
  return { season, endsAt: bpSeasonEndsAt(), xp, gold, goldPrice: BATTLEPASS.goldPrice, tiers };
}

function describeReward(r) {
  if (r.coins) return { kind: 'coins', coins: r.coins, emoji: '🪙', name: `${r.coins} coins` };
  const item = findItem(r.item);
  return {
    kind: 'item', item: r.item, qty: r.qty,
    emoji: item ? item.emoji : '🎁',
    name: item ? `${item.name}${r.qty > 1 ? ` ×${r.qty}` : ''}` : r.item,
    exclusive: item ? item.exclusive || null : null,
  };
}

const claim = transaction((userId, tier, track) => {
  const season = bpSeason();
  if (!Number.isInteger(tier) || tier < 1 || tier > BATTLEPASS.tiers) return { error: 'Bad tier' };
  if (track !== 'free' && track !== 'gold') return { error: 'Bad track' };
  if (track === 'gold' && !hasGold(userId, season)) return { error: 'You need the Gold Pass for that reward' };
  if (seasonXp(userId, season) < bpTierXp(tier)) return { error: 'Tier not unlocked yet' };
  const dupe = db.prepare('SELECT 1 FROM bp_claims WHERE user_id = ? AND season = ? AND tier = ? AND track = ?')
    .get(userId, season, tier, track);
  if (dupe) return { error: 'Already claimed' };
  db.prepare('INSERT INTO bp_claims (user_id, season, tier, track) VALUES (?, ?, ?, ?)').run(userId, season, tier, track);
  const reward = BATTLEPASS.rewards[tier][track];
  if (reward.coins) {
    economy.adjustCoins(userId, reward.coins, 'bp_reward', `${season}:${tier}:${track}`);
  } else {
    economy.addItem(userId, reward.item, reward.qty || 1);
  }
  return { ok: true, reward: describeReward(reward) };
});

const buyGold = transaction((userId) => {
  const season = bpSeason();
  if (hasGold(userId, season)) return { error: 'You already own the Gold Pass' };
  economy.adjustCoins(userId, -BATTLEPASS.goldPrice, 'bp_gold', season);
  db.prepare('INSERT INTO bp_premium (user_id, season) VALUES (?, ?)').run(userId, season);
  return { ok: true };
});

function mount(route) {
  route('GET', '/api/battlepass', authed((req, res, { sendJson }) => {
    sendJson(200, getState(req.user.id));
  }));

  route('POST', '/api/battlepass/buy', authed((req, res, { sendJson }) => {
    try {
      const result = buyGold(req.user.id);
      if (result.error) return sendJson(400, result);
      sendJson(200, { ...getState(req.user.id), profile: publicProfile(getUser(req.user.id)) });
    } catch (err) {
      sendJson(err.status || 500, { error: err.message });
    }
  }));

  route('POST', '/api/battlepass/claim', authed((req, res, { sendJson }) => {
    const result = claim(req.user.id, Number(req.body.tier), String(req.body.track || ''));
    if (result.error) return sendJson(400, result);
    sendJson(200, { ...result, state: getState(req.user.id), profile: publicProfile(getUser(req.user.id)) });
  }));
}

module.exports = { mount, getState };
