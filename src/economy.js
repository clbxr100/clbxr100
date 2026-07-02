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

function getEquippedCelebration(userId) {
  const row = db.prepare('SELECT celebration FROM users WHERE id = ?').get(userId);
  return row ? row.celebration : null;
}

module.exports = { adjustCoins, getCoins, claimDailyBonus, claimBailout, addStats, maxStat, getQty, addItem, consumeItem, getEquippedCelebration };
