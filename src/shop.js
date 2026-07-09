// REST endpoints for profile, shop, daily bonus. Mounted by server.js.
const { db, transaction } = require('./db');
const { verifyToken, signup, login, guest, tokenFor, getUser, getOrRestoreUser, publicProfile, isAdmin } = require('./auth');
const presence = require('./presence');
const economy = require('./economy');
const catalog = require('./catalog');

function authed(handler) {
  return (req, res, { sendJson }) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = verifyToken(token);
    if (!payload) return sendJson(401, { error: 'Not signed in' });
    const user = getOrRestoreUser(payload); // survives ephemeral-disk wipes
    if (!user) return sendJson(401, { error: 'Account not found' });
    req.user = user;
    return handler(req, res, { sendJson });
  };
}

const buyItem = transaction((user, itemId, qty) => {
  const item = catalog.findItem(itemId);
  if (!item) throw Object.assign(new Error('No such item'), { status: 400 });
  if (item.buyable === false) throw Object.assign(new Error('That item cannot be bought'), { status: 400 });
  // Daily deals discount applies automatically.
  item.price = catalog.dealPrice(itemId, new Date().toISOString().slice(0, 10));
  const count = Math.max(1, Math.min(10, Math.floor(qty || 1)));

  let units, cost;
  const ownOnce = ['avatar', 'pet', 'celebration', 'theme', 'cardback', 'soundpack', 'frame'];
  if (ownOnce.includes(item.category)) {
    if (economy.getQty(user.id, itemId) > 0) throw Object.assign(new Error('Already owned'), { status: 400 });
    units = 1;
    cost = item.price;
  } else if (item.category === 'throwable') {
    units = item.pack * count;
    cost = item.price * count;
  } else { // powerup
    units = count;
    cost = item.price * count;
    const held = economy.getQty(user.id, itemId);
    if (held + units > item.maxHeld) {
      throw Object.assign(new Error(`You can hold at most ${item.maxHeld}`), { status: 400 });
    }
  }

  economy.adjustCoins(user.id, -cost, 'shop_buy', itemId);
  economy.addItem(user.id, itemId, units);
  return { itemId, units, cost };
});

const doSpin = transaction((user) => {
  const now = Date.now();
  const last = user.last_spin_at || 0;
  if (now - last < catalog.SPIN.cooldownMs) {
    const err = new Error('Spin not ready yet');
    err.status = 400;
    throw Object.assign(err, { nextSpinAt: last + catalog.SPIN.cooldownMs });
  }
  const index = catalog.rollSpin();
  const seg = catalog.SPIN.segments[index];
  db.prepare('UPDATE users SET last_spin_at = ? WHERE id = ?').run(now, user.id);
  let coins = 0;
  let item = null;
  if (seg.coins) {
    coins = seg.coins;
    economy.adjustCoins(user.id, seg.coins, 'daily_spin', seg.id);
  }
  if (seg.item) {
    // Own-once cosmetics (the jackpot frame) convert to coins if already owned.
    const cat = catalog.findItem(seg.item);
    const ownOnce = cat && ['frame', 'avatar', 'pet', 'celebration', 'theme', 'cardback', 'soundpack'].includes(cat.category);
    if (ownOnce && economy.getQty(user.id, seg.item) > 0) {
      coins += 1500;
      economy.adjustCoins(user.id, 1500, 'daily_spin', `${seg.id}_dup`);
    } else {
      economy.addItem(user.id, seg.item, seg.qty || 1);
      item = { itemId: seg.item, qty: seg.qty || 1 };
    }
  }
  return { index, segment: seg, coins, item, nextSpinAt: now + catalog.SPIN.cooldownMs };
});

function mount(route) {
  route('POST', '/api/auth/signup', (req, res, { sendJson }) => {
    const { username, password } = req.body;
    const result = signup(username, password);
    if (result.error) return sendJson(400, { error: result.error });
    sendJson(200, { token: tokenFor(result.user), profile: publicProfile(result.user) });
  });

  route('POST', '/api/auth/login', (req, res, { sendJson }) => {
    const { username, password } = req.body;
    const result = login(username, password);
    if (result.error) return sendJson(401, { error: result.error });
    sendJson(200, { token: tokenFor(result.user), profile: publicProfile(result.user) });
  });

  route('POST', '/api/auth/guest', (req, res, { sendJson }) => {
    const result = guest(req.body.name);
    sendJson(200, { token: tokenFor(result.user), profile: publicProfile(result.user) });
  });

  route('GET', '/api/me', authed((req, res, { sendJson }) => {
    sendJson(200, { profile: publicProfile(req.user) });
  }));

  route('GET', '/api/shop/catalog', (req, res, { sendJson }) => {
    sendJson(200, {
      avatars: catalog.AVATARS,
      pets: catalog.PETS,
      throwables: catalog.THROWABLES,
      powerups: catalog.POWERUPS,
      celebrations: catalog.CELEBRATIONS,
      themes: catalog.THEMES,
      cardbacks: catalog.CARDBACKS,
      soundpacks: catalog.SOUNDPACKS,
      frames: catalog.FRAMES,
      spin: catalog.SPIN,
      xp: catalog.XP,
      stakes: catalog.STAKES,
      economy: catalog.ECONOMY,
      deals: catalog.dealsForDay(new Date().toISOString().slice(0, 10)),
    });
  });

  route('POST', '/api/shop/buy', authed((req, res, { sendJson }) => {
    try {
      const result = buyItem(req.user, req.body.itemId, req.body.qty);
      sendJson(200, { ...result, profile: publicProfile(getUser(req.user.id)) });
    } catch (err) {
      sendJson(err.status || 500, { error: err.message });
    }
  }));

  // Admin: gift chips to any player by username.
  route('POST', '/api/admin/gift', authed((req, res, { sendJson }) => {
    if (!isAdmin(req.user)) return sendJson(403, { error: 'Admins only' });
    const amount = Math.floor(Number(req.body.amount));
    if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) {
      return sendJson(400, { error: 'Amount must be 1 – 1,000,000' });
    }
    const target = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.body.username || '').trim());
    if (!target) return sendJson(404, { error: 'No player with that username' });
    const coins = economy.adjustCoins(target.id, amount, 'admin_gift', req.user.username);
    presence.sendTo(target.id, 'gift:received', { from: req.user.username, amount, coins });
    presence.sendTo(target.id, 'profile:update', { coinsDelta: amount });
    sendJson(200, { ok: true, username: target.username, amount, theirCoins: coins });
  }));

  route('GET', '/api/quests', authed((req, res, { sendJson }) => {
    sendJson(200, { quests: economy.getQuests(req.user.id) });
  }));

  route('POST', '/api/quests/claim', authed((req, res, { sendJson }) => {
    const result = economy.claimQuest(req.user.id, String(req.body.questId || ''));
    if (result.error) return sendJson(400, result);
    sendJson(200, { ...result, quests: economy.getQuests(req.user.id), profile: publicProfile(getUser(req.user.id)) });
  }));

  route('GET', '/api/leaderboard', authed((req, res, { sendJson }) => {
    const by = String(req.query.get('by') || 'coins');
    sendJson(200, economy.leaderboard(by, req.user.id));
  }));

  // Daily Spin: server rolls the weighted segment, applies the prize, and
  // returns the segment index so the client wheel can land on it.
  route('POST', '/api/spin', authed((req, res, { sendJson }) => {
    try {
      const result = doSpin(req.user);
      sendJson(200, { ...result, profile: publicProfile(getUser(req.user.id)) });
    } catch (err) {
      sendJson(err.status || 500, { error: err.message, nextSpinAt: err.nextSpinAt });
    }
  }));

  route('POST', '/api/daily-bonus', authed((req, res, { sendJson }) => {
    const result = economy.claimDailyBonus(req.user.id);
    if (result.error) return sendJson(400, result);
    sendJson(200, { ...result, profile: publicProfile(getUser(req.user.id)) });
  }));

  route('POST', '/api/bailout', authed((req, res, { sendJson }) => {
    const result = economy.claimBailout(req.user.id);
    if (result.error) return sendJson(400, result);
    sendJson(200, { ...result, profile: publicProfile(getUser(req.user.id)) });
  }));

  route('POST', '/api/profile/equip', authed((req, res, { sendJson }) => {
    const { avatar, pet, celebration, badge, tableTheme, cardBack, soundPack, frame } = req.body;
    if (frame !== undefined) {
      if (frame !== null && (!catalog.FRAMES[frame] || economy.getQty(req.user.id, frame) < 1)) {
        return sendJson(400, { error: 'You do not own that frame' });
      }
      db.prepare('UPDATE users SET frame = ? WHERE id = ?').run(frame, req.user.id);
    }
    if (soundPack !== undefined) {
      if (soundPack !== null && (!catalog.SOUNDPACKS[soundPack] || economy.getQty(req.user.id, soundPack) < 1)) {
        return sendJson(400, { error: 'You do not own that sound pack' });
      }
      db.prepare('UPDATE users SET sound_pack = ? WHERE id = ?').run(soundPack, req.user.id);
    }
    if (tableTheme !== undefined) {
      if (tableTheme !== null && (!catalog.THEMES[tableTheme] || economy.getQty(req.user.id, tableTheme) < 1)) {
        return sendJson(400, { error: 'You do not own that theme' });
      }
      db.prepare('UPDATE users SET table_theme = ? WHERE id = ?').run(tableTheme, req.user.id);
    }
    if (cardBack !== undefined) {
      if (cardBack !== null && (!catalog.CARDBACKS[cardBack] || economy.getQty(req.user.id, cardBack) < 1)) {
        return sendJson(400, { error: 'You do not own that card back' });
      }
      db.prepare('UPDATE users SET card_back = ? WHERE id = ?').run(cardBack, req.user.id);
    }
    if (badge !== undefined) {
      if (badge !== null) {
        const owned = db.prepare('SELECT 1 FROM achievements WHERE user_id = ? AND achievement_id = ?').get(req.user.id, badge);
        if (!catalog.ACHIEVEMENTS[badge] || !owned) {
          return sendJson(400, { error: 'You have not unlocked that badge' });
        }
      }
      db.prepare('UPDATE users SET badge = ? WHERE id = ?').run(badge, req.user.id);
    }
    if (celebration !== undefined) {
      if (celebration !== null) {
        if (!catalog.CELEBRATIONS[celebration] || economy.getQty(req.user.id, celebration) < 1) {
          return sendJson(400, { error: 'You do not own that celebration' });
        }
      }
      db.prepare('UPDATE users SET celebration = ? WHERE id = ?').run(celebration, req.user.id);
    }
    if (avatar !== undefined) {
      const premium = Object.values(catalog.AVATARS.premium).find(a => a.emoji === avatar);
      const isFree = catalog.AVATARS.free.includes(avatar);
      if (!isFree && (!premium || economy.getQty(req.user.id, premium.id) < 1)) {
        return sendJson(400, { error: 'You do not own that avatar' });
      }
      db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, req.user.id);
    }
    if (pet !== undefined) {
      if (pet !== null) {
        if (!catalog.PETS[pet] || economy.getQty(req.user.id, pet) < 1) {
          return sendJson(400, { error: 'You do not own that pet' });
        }
      }
      db.prepare('UPDATE users SET pet = ? WHERE id = ?').run(pet, req.user.id);
    }
    sendJson(200, { profile: publicProfile(getUser(req.user.id)) });
  }));
}

module.exports = { mount, authed };
