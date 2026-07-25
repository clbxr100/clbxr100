// All coin movement goes through here so every change leaves a transaction row.
const { db, transaction } = require('./db');
const { ECONOMY } = require('./catalog');

const adjustCoins = transaction((userId, amount, reason, ref = null) => {
  const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('No such user');
  const next = user.coins + amount;
  if (next < 0) {
    const err = new Error('Not enough coins');
    err.status = 400;
    throw err;
  }
  db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(next, userId);
  db.prepare('INSERT INTO transactions (user_id, amount, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, amount, reason, ref, Date.now());
  return next;
});

function getCoins(userId) {
  const row = db.prepare('SELECT coins FROM users WHERE id = ?').get(userId);
  return row ? row.coins : 0;
}

function claimDailyBonus(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { error: 'No such user' };
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const last = user.last_daily_bonus_at || 0;
  if (now - last < DAY) {
    return { error: 'Already claimed', nextAt: last + DAY };
  }
  const streak = now - last < 2 * DAY ? user.daily_streak + 1 : 1;
  const amount = Math.min(ECONOMY.dailyBase + ECONOMY.dailyPerStreak * (streak - 1), ECONOMY.dailyCap);
  const coins = adjustCoins(userId, amount, 'daily_bonus');
  db.prepare('UPDATE users SET daily_streak = ?, last_daily_bonus_at = ? WHERE id = ?').run(streak, now, userId);
  return { amount, streak, coins, nextAt: now + DAY };
}

function claimBailout(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { error: 'No such user' };
  if (user.coins >= ECONOMY.bailoutBelow) {
    return { error: `Bailout only available under ${ECONOMY.bailoutBelow} coins` };
  }
  const now = Date.now();
  const last = user.last_bailout_at || 0;
  if (now - last < ECONOMY.bailoutCooldownMs) {
    return { error: 'Bailout on cooldown', nextAt: last + ECONOMY.bailoutCooldownMs };
  }
  const coins = adjustCoins(userId, ECONOMY.bailoutAmount, 'bailout');
  db.prepare('UPDATE users SET last_bailout_at = ? WHERE id = ?').run(now, userId);
  return { amount: ECONOMY.bailoutAmount, coins };
}

function addStats(userId, deltas) {
  const cols = Object.keys(deltas);
  if (cols.length === 0) return;
  const sets = cols.map(c => `${c} = ${c} + ?`).join(', ');
  db.prepare(`UPDATE stats SET ${sets} WHERE user_id = ?`).run(...cols.map(c => deltas[c]), userId);
}

function maxStat(userId, col, value) {
  db.prepare(`UPDATE stats SET ${col} = MAX(${col}, ?) WHERE user_id = ?`).run(value, userId);
}

// Inventory helpers -------------------------------------------------------

function getQty(userId, itemId) {
  const row = db.prepare('SELECT qty FROM inventory WHERE user_id = ? AND item_id = ?').get(userId, itemId);
  return row ? row.qty : 0;
}

function addItem(userId, itemId, qty) {
  db.prepare(`
    INSERT INTO inventory (user_id, item_id, qty) VALUES (?, ?, ?)
    ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + excluded.qty
  `).run(userId, itemId, qty);
}

// Returns false if the user doesn't have one to consume.
const consumeItem = transaction((userId, itemId) => {
  const qty = getQty(userId, itemId);
  if (qty < 1) return false;
  db.prepare('UPDATE inventory SET qty = qty - 1 WHERE user_id = ? AND item_id = ?').run(userId, itemId);
  return true;
});

// ---- XP / levels ----------------------------------------------------------

const { questsForDay, levelFromXp, XP, bpSeason } = require('./catalog');
const presence = require('./presence');

function addXp(userId, amount) {
  const row = db.prepare('SELECT xp FROM users WHERE id = ?').get(userId);
  if (!row) return;
  const before = levelFromXp(row.xp);
  const xp = row.xp + amount;
  db.prepare('UPDATE users SET xp = ? WHERE id = ?').run(xp, userId);
  // XP also advances the current battle pass season.
  db.prepare(`
    INSERT INTO season_xp (user_id, season, xp) VALUES (?, ?, ?)
    ON CONFLICT(user_id, season) DO UPDATE SET xp = xp + excluded.xp
  `).run(userId, bpSeason(), amount);
  const after = levelFromXp(xp);
  if (after > before) {
    presence.sendTo(userId, 'xp:levelUp', { level: after });
  }
}

// ---- daily quests ---------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Increment progress on a quest if it's in today's rotation.
function bumpQuest(userId, questId, inc = 1) {
  const day = today();
  if (!questsForDay(day).some(q => q.id === questId)) return;
  db.prepare(`
    INSERT INTO quest_progress (user_id, day, quest_id, progress) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, day, quest_id) DO UPDATE SET progress = progress + excluded.progress
  `).run(userId, day, questId, inc);
}

function getQuests(userId) {
  const day = today();
  return questsForDay(day).map(q => {
    const row = db.prepare('SELECT progress, claimed FROM quest_progress WHERE user_id = ? AND day = ? AND quest_id = ?')
      .get(userId, day, q.id);
    return {
      ...q,
      progress: Math.min(q.target, row ? row.progress : 0),
      claimed: !!(row && row.claimed),
    };
  });
}

const claimQuest = transaction((userId, questId) => {
  const day = today();
  const quest = questsForDay(day).find(q => q.id === questId);
  if (!quest) return { error: 'That quest is not active today' };
  const row = db.prepare('SELECT progress, claimed FROM quest_progress WHERE user_id = ? AND day = ? AND quest_id = ?')
    .get(userId, day, questId);
  if (!row || row.progress < quest.target) return { error: 'Quest not complete yet' };
  if (row.claimed) return { error: 'Already claimed' };
  db.prepare('UPDATE quest_progress SET claimed = 1 WHERE user_id = ? AND day = ? AND quest_id = ?').run(userId, day, questId);
  const coins = adjustCoins(userId, quest.reward, 'quest_reward', questId);
  addXp(userId, XP.rewards.questClaim);
  return { reward: quest.reward, coins };
});

// ---- leaderboard ----------------------------------------------------------

const LEADERBOARD_COLS = {
  coins: 'u.coins',
  hands_won: 's.hands_won',
  biggest_pot: 's.biggest_pot',
  tournaments_won: 's.tournaments_won',
};

function leaderboard(by, meId) {
  const col = LEADERBOARD_COLS[by] || LEADERBOARD_COLS.coins;
  const rows = db.prepare(`
    SELECT u.id AS userId, u.username, u.avatar, u.is_guest AS isGuest, ${col} AS value
    FROM users u JOIN stats s ON s.user_id = u.id
    WHERE ${col} > 0
    ORDER BY value DESC, u.created_at ASC
    LIMIT 20
  `).all();
  let me = null;
  if (meId) {
    const mine = db.prepare(`
      SELECT COUNT(*) + 1 AS rank FROM users u JOIN stats s ON s.user_id = u.id
      WHERE ${col} > (SELECT ${col} FROM users u JOIN stats s ON s.user_id = u.id WHERE u.id = ?)
    `).get(meId);
    const myVal = db.prepare(`SELECT ${col} AS value FROM users u JOIN stats s ON s.user_id = u.id WHERE u.id = ?`).get(meId);
    me = { rank: mine ? mine.rank : null, value: myVal ? myVal.value : 0 };
  }
  return { rows, me };
}

function getEquippedCelebration(userId) {
  const row = db.prepare('SELECT celebration FROM users WHERE id = ?').get(userId);
  return row ? row.celebration : null;
}

module.exports = {
  adjustCoins, getCoins, claimDailyBonus, claimBailout, addStats, maxStat,
  getQty, addItem, consumeItem, getEquippedCelebration,
  bumpQuest, getQuests, claimQuest, leaderboard, addXp,
};
