// REST endpoints for profile, shop, daily bonus. Mounted by server.js.
const { db, transaction } = require('./db');
const { verifyToken, signup, login, guest, tokenFor, getUser, publicProfile } = require('./auth');
const economy = require('./economy');
const catalog = require('./catalog');

function authed(handler) {
  return (req, res, { sendJson }) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = verifyToken(token);
    if (!payload) return sendJson(401, { error: 'Not signed in' });
    const user = getUser(payload.userId);
    if (!user) return sendJson(401, { error: 'Account not found' });
    req.user = user;
    return handler(req, res, { sendJson });
  };
}

const buyItem = transaction((user, itemId, qty) => {
  const item = catalog.findItem(itemId);
  if (!item) throw Object.assign(new Error('No such item'), { status: 400 });
  if (item.buyable === false) throw Object.assign(new Error('That item cannot be bought'), { status: 400 });
  const count = Math.max(1, Math.min(10, Math.floor(qty || 1)));

  let units, cost;
  if (item.category === 'avatar' || item.category === 'pet' || item.category === 'celebration') {
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
      stakes: catalog.STAKES,
      economy: catalog.ECONOMY,
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
    const { avatar, pet, celebration } = req.body;
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
