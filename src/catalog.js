// Single source of truth for every purchasable / dealable item in the game.
// Shared by the shop (REST), the engine (power-up rolls) and the client
// (served as JSON via /api/shop/catalog).

const POWERUPS = {
  pu_swap: {
    id: 'pu_swap', name: 'Card Swap', emoji: '🔄', rarity: 'common',
    desc: 'Replace one of your hole cards with a fresh card from the deck.',
    freeWeight: 25, price: 200, buyable: true, maxHeld: 10,
    needsTarget: false, needsCardIndex: true,
  },
  pu_shield: {
    id: 'pu_shield', name: 'Shield', emoji: '🛡️', rarity: 'common',
    desc: 'Blocks the next offensive power-up aimed at you this hand.',
    freeWeight: 25, price: 150, buyable: true, maxHeld: 10,
    needsTarget: false, needsCardIndex: false,
  },
  pu_blindskip: {
    id: 'pu_blindskip', name: 'Blind Skip', emoji: '🕶️', rarity: 'common',
    desc: 'The house covers your blinds next hand.',
    freeWeight: 10, price: 150, buyable: true, maxHeld: 10,
    needsTarget: false, needsCardIndex: false,
  },
  pu_peek: {
    id: 'pu_peek', name: 'Peek', emoji: '👁️', rarity: 'rare',
    desc: 'Secretly look at one opponent\'s hole cards.',
    freeWeight: 15, price: 400, buyable: true, maxHeld: 5,
    needsTarget: true, needsCardIndex: false,
  },
  pu_xray: {
    id: 'pu_xray', name: 'Future Sight', emoji: '🔮', rarity: 'rare',
    desc: 'Secretly preview the next community card.',
    freeWeight: 12, price: 350, buyable: true, maxHeld: 5,
    needsTarget: false, needsCardIndex: false,
  },
  pu_double: {
    id: 'pu_double', name: 'Double Down', emoji: '💥', rarity: 'epic',
    desc: 'Win this hand at showdown and the house pays you a 50% pot bonus.',
    freeWeight: 6, price: 800, buyable: true, maxHeld: 3,
    needsTarget: false, needsCardIndex: false,
  },
  pu_steal: {
    id: 'pu_steal', name: 'Pot Steal', emoji: '🪤', rarity: 'epic',
    desc: 'Snatch 25% of the current pot. Blocked if anyone holds a Shield.',
    freeWeight: 5, price: 2000, buyable: true, maxHeld: 2,
    needsTarget: false, needsCardIndex: false,
  },
  pu_forcefold: {
    id: 'pu_forcefold', name: 'Force Fold', emoji: '💀', rarity: 'legendary',
    desc: 'Force one opponent to fold on the spot. Cannot target all-in players.',
    freeWeight: 2, price: 0, buyable: false, maxHeld: 1,
    needsTarget: true, needsCardIndex: false,
  },
  pu_freeze: {
    id: 'pu_freeze', name: 'Time Freeze', emoji: '❄️', rarity: 'epic',
    desc: 'Freeze an opponent — their next turn is skipped (auto check/fold).',
    freeWeight: 4, price: 1200, buyable: true, maxHeld: 2,
    needsTarget: true, needsCardIndex: false,
  },
  pu_insurance: {
    id: 'pu_insurance', name: 'Insurance', emoji: '🛟', rarity: 'rare',
    desc: 'Lose this hand and the house refunds half of what you put in.',
    freeWeight: 8, price: 500, buyable: true, maxHeld: 5,
    needsTarget: false, needsCardIndex: false,
  },
  pu_blindfold: {
    id: 'pu_blindfold', name: 'Blindfold', emoji: '🙈', rarity: 'rare',
    desc: 'An opponent sees the remaining community cards face-down until showdown.',
    freeWeight: 8, price: 450, buyable: true, maxHeld: 5,
    needsTarget: true, needsCardIndex: false,
  },
  pu_mulligan: {
    id: 'pu_mulligan', name: 'Mulligan', emoji: '♻️', rarity: 'rare',
    desc: 'Throw away BOTH hole cards and draw a fresh pair.',
    freeWeight: 9, price: 500, buyable: true, maxHeld: 5,
    needsTarget: false, needsCardIndex: false,
  },
  pu_taxman: {
    id: 'pu_taxman', name: 'Tax Collector', emoji: '💼', rarity: 'rare',
    desc: 'Every live opponent pays you one big blind from their stack.',
    freeWeight: 7, price: 600, buyable: true, maxHeld: 3,
    needsTarget: false, needsCardIndex: false,
  },
  pu_lucky: {
    id: 'pu_lucky', name: 'Lucky Charm', emoji: '🍀', rarity: 'epic',
    desc: 'Next hand your free power-up is guaranteed rare or better.',
    freeWeight: 5, price: 700, buyable: true, maxHeld: 3,
    needsTarget: false, needsCardIndex: false,
  },
};

// Equippable win-celebration themes: played on top of the standard
// hand-rank spectacle when YOU drag the pot.
const CELEBRATIONS = {
  celebration_fireworks: { id: 'celebration_fireworks', emoji: '🎆', name: 'Grand Fireworks', price: 3000, desc: 'Every win ends in a fireworks show' },
  celebration_money: { id: 'celebration_money', emoji: '💸', name: 'Money Storm', price: 4000, desc: 'It rains cash when you win' },
  celebration_storm: { id: 'celebration_storm', emoji: '⛈️', name: 'Thunderstorm', price: 5000, desc: 'Lightning strikes your defeated foes' },
  celebration_hearts: { id: 'celebration_hearts', emoji: '💖', name: 'Love Bomb', price: 2500, desc: 'Win them over with hearts' },
  celebration_dragon: { id: 'celebration_dragon', emoji: '🐉', name: 'Dragon Fire', price: 8000, desc: 'A dragon torches the table in your honor' },
  celebration_frost: { id: 'celebration_frost', emoji: '❄️', name: 'Ice Age', price: 4500, desc: 'A blizzard freezes the losers out' },
  celebration_royalty: { id: 'celebration_royalty', emoji: '👑', name: 'Coronation', price: 6000, desc: 'Crowns rain down on your victory' },
};

const AVATARS = {
  // Free starter avatars (everyone owns these implicitly)
  free: ['🤠', '😎', '🤖', '👑', '🦊', '🐼', '🦁', '🐯', '🎃', '👻'],
  premium: {
    avatar_moneybag: { id: 'avatar_moneybag', emoji: '💰', name: 'Money Bag', price: 2000 },
    avatar_rich: { id: 'avatar_rich', emoji: '🤑', name: 'High Roller', price: 3000 },
    avatar_gem: { id: 'avatar_gem', emoji: '💎', name: 'Diamond', price: 5000 },
    avatar_alien: { id: 'avatar_alien', emoji: '👽', name: 'Alien', price: 4000 },
    avatar_devil: { id: 'avatar_devil', emoji: '😈', name: 'Devil', price: 6000 },
    avatar_dragonface: { id: 'avatar_dragonface', emoji: '🐲', name: 'Dragon Lord', price: 10000 },
    avatar_ninja: { id: 'avatar_ninja', emoji: '🥷', name: 'Ninja', price: 3500 },
    avatar_vampire: { id: 'avatar_vampire', emoji: '🧛', name: 'Vampire', price: 4500 },
    avatar_wolf: { id: 'avatar_wolf', emoji: '🐺', name: 'Lone Wolf', price: 5000 },
    avatar_gorilla: { id: 'avatar_gorilla', emoji: '🦍', name: 'Silverback', price: 6500 },
    avatar_clown: { id: 'avatar_clown', emoji: '🤡', name: 'Wildcard', price: 7000 },
    avatar_royalty: { id: 'avatar_royalty', emoji: '🤴', name: 'The Prince', price: 8000 },
  },
};

const PETS = {
  pet_dog: { id: 'pet_dog', emoji: '🐕', name: 'Pup', price: 2500 },
  pet_cat: { id: 'pet_cat', emoji: '🐈', name: 'Kitty', price: 2500 },
  pet_turtle: { id: 'pet_turtle', emoji: '🐢', name: 'Lucky Turtle', price: 4000 },
  pet_parrot: { id: 'pet_parrot', emoji: '🦜', name: 'Card Shark Parrot', price: 5000 },
  pet_unicorn: { id: 'pet_unicorn', emoji: '🦄', name: 'Unicorn', price: 12000 },
  pet_dragon: { id: 'pet_dragon', emoji: '🐉', name: 'Dragon', price: 15000 },
  pet_frog: { id: 'pet_frog', emoji: '🐸', name: 'Pond Boss', price: 3000 },
  pet_owl: { id: 'pet_owl', emoji: '🦉', name: 'Night Owl', price: 4500 },
  pet_octopus: { id: 'pet_octopus', emoji: '🐙', name: 'Card Counter', price: 6000 },
  pet_sloth: { id: 'pet_sloth', emoji: '🦥', name: 'Slowroll', price: 5500 },
  pet_phoenix: { id: 'pet_phoenix', emoji: '🐦‍🔥', name: 'Phoenix', price: 20000 },
};

const THROWABLES = {
  throw_tomato: { id: 'throw_tomato', emoji: '🍅', name: 'Tomato', price: 100, pack: 5, kind: 'splat' },
  throw_cookie: { id: 'throw_cookie', emoji: '🍪', name: 'Cookie', price: 100, pack: 5, kind: 'gift' },
  throw_confetti: { id: 'throw_confetti', emoji: '🎊', name: 'Confetti Bomb', price: 150, pack: 5, kind: 'burst' },
  throw_drink: { id: 'throw_drink', emoji: '🍹', name: 'Drink', price: 150, pack: 5, kind: 'gift' },
  throw_rose: { id: 'throw_rose', emoji: '🌹', name: 'Rose', price: 200, pack: 5, kind: 'gift' },
  throw_cake: { id: 'throw_cake', emoji: '🎂', name: 'Cake', price: 250, pack: 5, kind: 'splat' },
  throw_egg: { id: 'throw_egg', emoji: '🥚', name: 'Egg', price: 150, pack: 5, kind: 'splat' },
  throw_snowball: { id: 'throw_snowball', emoji: '❄️', name: 'Snowball', price: 200, pack: 5, kind: 'splat' },
  throw_pizza: { id: 'throw_pizza', emoji: '🍕', name: 'Pizza Slice', price: 200, pack: 5, kind: 'gift' },
  throw_diamond: { id: 'throw_diamond', emoji: '💎', name: 'Diamond', price: 500, pack: 3, kind: 'gift' },
};

const STAKES = {
  micro: { id: 'micro', name: 'Micro', smallBlind: 5, bigBlind: 10, buyIn: 500 },
  low: { id: 'low', name: 'Low', smallBlind: 10, bigBlind: 20, buyIn: 1000 },
  mid: { id: 'mid', name: 'Mid', smallBlind: 50, bigBlind: 100, buyIn: 5000 },
  high: { id: 'high', name: 'High', smallBlind: 250, bigBlind: 500, buyIn: 25000 },
  whale: { id: 'whale', name: 'Whale', smallBlind: 1000, bigBlind: 2000, buyIn: 100000 },
};

const ECONOMY = {
  startCoins: 5000,
  guestStartCoins: 2000,
  dailyBase: 500,
  dailyPerStreak: 100,
  dailyCap: 1000,
  bailoutAmount: 500,
  bailoutBelow: 1000,
  bailoutCooldownMs: 4 * 60 * 60 * 1000,
  handWinBonus: 10,
  // House bonuses keyed by hand rank (see PokerGame.scoreHand ranks)
  bigHandBonus: { 8: 200, 9: 1000, 10: 5000 },
  tournamentFees: [500, 2500, 10000],
};

const TOURNAMENT = {
  // POKER_FAST_TOURNEY shrinks stacks/levels so tests finish in seconds.
  startingChips: process.env.POKER_FAST_TOURNEY ? 150 : 1500,
  handsPerLevel: process.env.POKER_FAST_TOURNEY ? 2 : 8,
  blindLevels: [
    [10, 20], [15, 30], [25, 50], [50, 100],
    [100, 200], [200, 400], [400, 800], [800, 1600],
  ],
};

// Achievements: unlocked from lifetime stats, each grants an equippable
// badge shown next to your name at the table.
const ACHIEVEMENTS = {
  ach_first_blood: { id: 'ach_first_blood', name: 'First Blood', desc: 'Win your first hand', badge: '🩸', stat: 'hands_won', gte: 1 },
  ach_shark: { id: 'ach_shark', name: 'Card Shark', desc: 'Win 100 hands', badge: '🦈', stat: 'hands_won', gte: 100 },
  ach_grinder: { id: 'ach_grinder', name: 'The Grinder', desc: 'Play 500 hands', badge: '⚙️', stat: 'hands_played', gte: 500 },
  ach_bigpot: { id: 'ach_bigpot', name: 'Whale Hunter', desc: 'Drag a 10,000+ pot', badge: '🐋', stat: 'biggest_pot', gte: 10000 },
  ach_royal: { id: 'ach_royal', name: 'Royalty', desc: 'Hit a Royal Flush', badge: '👑', stat: 'best_hand_rank', gte: 10 },
  ach_champion: { id: 'ach_champion', name: 'Champion', desc: 'Win a tournament', badge: '🏆', stat: 'tournaments_won', gte: 1 },
  ach_heater: { id: 'ach_heater', name: 'Heater', desc: 'Win 5 hands in a row', badge: '🔥', stat: 'best_streak', gte: 5 },
  ach_prankster: { id: 'ach_prankster', name: 'Prankster', desc: 'Throw 25 items', badge: '🤡', stat: 'items_thrown', gte: 25 },
  ach_wizard: { id: 'ach_wizard', name: 'Power Wizard', desc: 'Use 50 power-ups', badge: '🧙', stat: 'powerups_used', gte: 50 },
  ach_millionaire: { id: 'ach_millionaire', name: 'High Society', desc: 'Hold 100,000 coins', badge: '🎩', stat: 'coins', gte: 100000 },
};

const SEASON = {
  prizes: [2000, 1000, 500], // weekly top 3 by hands won
};

// Table felt themes (personal — changes how YOU see every table).
const THEMES = {
  theme_midnight: { id: 'theme_midnight', name: 'Midnight', emoji: '🌃', price: 2000, felt: '#14418c', feltDark: '#0c2b61', trim: '#1e2a4a' },
  theme_crimson: { id: 'theme_crimson', name: 'Crimson', emoji: '🩸', price: 2000, felt: '#8c1f2f', feltDark: '#5e1520', trim: '#3a1016' },
  theme_royal: { id: 'theme_royal', name: 'Royal Purple', emoji: '🔮', price: 3000, felt: '#5b21b6', feltDark: '#3b1678', trim: '#2a1152' },
  theme_sunset: { id: 'theme_sunset', name: 'Sunset', emoji: '🌅', price: 3000, felt: '#b45309', feltDark: '#7c3a06', trim: '#4a2404' },
  theme_cyber: { id: 'theme_cyber', name: 'Cyber', emoji: '🤖', price: 5000, felt: '#10252b', feltDark: '#0a1518', trim: '#22d3ee' },
  theme_ocean: { id: 'theme_ocean', name: 'Deep Ocean', emoji: '🌊', price: 2500, felt: '#0e7490', feltDark: '#155e75', trim: '#082f3a' },
  theme_rose: { id: 'theme_rose', name: 'Neon Rose', emoji: '🌸', price: 3500, felt: '#9d174d', feltDark: '#6b1138', trim: '#f472b6' },
  theme_carbon: { id: 'theme_carbon', name: 'Carbon', emoji: '🖤', price: 4000, felt: '#27272a', feltDark: '#18181b', trim: '#52525b' },
  theme_ice: { id: 'theme_ice', name: 'Glacier', emoji: '🧊', price: 4500, felt: '#3b82a6', feltDark: '#1e5a7a', trim: '#bfe8f7' },
  theme_lava: { id: 'theme_lava', name: 'Volcano', emoji: '🌋', price: 5500, felt: '#3f1d1d', feltDark: '#291111', trim: '#f97316' },
  theme_goldrush: { id: 'theme_goldrush', name: 'Gold Rush', emoji: '🪙', price: 7500, felt: '#8a6d1a', feltDark: '#5c4a12', trim: '#fde68a' },
  theme_void: { id: 'theme_void', name: 'The Void', emoji: '🌌', price: 9000, felt: '#1e1b3a', feltDark: '#12102a', trim: '#8b5cf6' },
};

// Sound packs re-voice every game sound (personal).
const SOUNDPACKS = {
  sp_chiptune: { id: 'sp_chiptune', name: 'Chiptune', emoji: '🎮', price: 1000, type: 'triangle', pitch: 1.5 },
  sp_arcade: { id: 'sp_arcade', name: 'Arcade', emoji: '🕹️', price: 1200, type: 'square', pitch: 1.25 },
  sp_vegas: { id: 'sp_vegas', name: 'Deep Vegas', emoji: '🎷', price: 1500, type: 'sawtooth', pitch: 0.75 },
};

// Card back designs (personal view of every face-down card).
const CARDBACKS = {
  cb_red: { id: 'cb_red', name: 'Red Classic', emoji: '🟥', price: 800 },
  cb_gold: { id: 'cb_gold', name: 'Gold Spade', emoji: '🟨', price: 1500 },
  cb_galaxy: { id: 'cb_galaxy', name: 'Galaxy', emoji: '🌌', price: 2000 },
  cb_dragon: { id: 'cb_dragon', name: 'Dragon Scale', emoji: '🐲', price: 2500 },
  cb_ice: { id: 'cb_ice', name: 'Frostbite', emoji: '❄️', price: 1800 },
  cb_royal: { id: 'cb_royal', name: 'Royal Crown', emoji: '👑', price: 2800 },
  cb_skull: { id: 'cb_skull', name: 'Dead Man\'s Hand', emoji: '💀', price: 3200 },
};

// XP: cumulative threshold for level L is 60*(L-1)^2.
const XP = {
  perLevel: 60,
  rewards: {
    handPlayed: 8, handWon: 20, bigHand: 60,
    tournamentPlayed: 40, tournamentWon: 150,
    questClaim: 25, achievement: 60,
  },
  titles: [
    [1, 'Fish', '🐟'], [3, 'Caller', '📞'], [5, 'Grinder', '⚙️'], [8, 'Bluffer', '🎭'],
    [12, 'Shark', '🦈'], [16, 'High Roller', '🎩'], [20, 'Card Wizard', '🧙'],
    [25, 'Poker Boss', '👔'], [30, 'Legend', '🐐'],
  ],
};

function levelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / XP.perLevel)) + 1;
}

function xpForLevel(level) {
  return XP.perLevel * Math.pow(level - 1, 2);
}

function titleForLevel(level) {
  let current = XP.titles[0];
  for (const t of XP.titles) if (level >= t[0]) current = t;
  return { title: current[1], emoji: current[2] };
}

// Daily quests: 3 of these rotate in each day, tracked per user.
const QUESTS = {
  q_play10: { id: 'q_play10', name: 'Grinder', desc: 'Play 10 hands', emoji: '🃏', target: 10, reward: 200 },
  q_win3: { id: 'q_win3', name: 'On a Heater', desc: 'Win 3 hands', emoji: '🏆', target: 3, reward: 300 },
  q_power2: { id: 'q_power2', name: 'Loose Cannon', desc: 'Use 2 power-ups', emoji: '⚡', target: 2, reward: 150 },
  q_throw1: { id: 'q_throw1', name: 'Food Fight', desc: 'Throw or gift an item', emoji: '🎂', target: 1, reward: 100 },
  q_tourney1: { id: 'q_tourney1', name: 'Contender', desc: 'Enter a tournament', emoji: '🎖️', target: 1, reward: 250 },
  q_hands25: { id: 'q_hands25', name: 'Marathon', desc: 'Play 25 hands', emoji: '🏃', target: 25, reward: 400 },
  q_win5: { id: 'q_win5', name: 'Dominator', desc: 'Win 5 hands', emoji: '💪', target: 5, reward: 500 },
  q_bigpot1k: { id: 'q_bigpot1k', name: 'Pot Hunter', desc: 'Win a pot of 1,000+', emoji: '💰', target: 1, reward: 350 },
  q_allin1: { id: 'q_allin1', name: 'Daredevil', desc: 'Go all-in', emoji: '🎢', target: 1, reward: 150 },
  q_gift1: { id: 'q_gift1', name: 'Sweetheart', desc: 'Send someone a gift', emoji: '💝', target: 1, reward: 100 },
};

// Deterministic daily rotation: pick 3 quests for a given yyyy-mm-dd.
function questsForDay(day) {
  const ids = Object.keys(QUESTS).sort();
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const picked = [];
  const pool = [...ids];
  for (let i = 0; i < 3 && pool.length; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    picked.push(pool.splice(h % pool.length, 1)[0]);
  }
  return picked.map(id => QUESTS[id]);
}

// lucky=true (Lucky Charm) restricts the roll to rare-or-better.
function rollFreePowerUp(rand = Math.random, lucky = false) {
  let entries = Object.values(POWERUPS);
  if (lucky) entries = entries.filter(p => p.rarity !== 'common');
  const total = entries.reduce((s, p) => s + p.freeWeight, 0);
  let r = rand() * total;
  for (const p of entries) {
    r -= p.freeWeight;
    if (r <= 0) return p.id;
  }
  return entries[0].id;
}

// Store refresh: two items rotate in at 30% off each day.
function dealsForDay(day) {
  const pool = [
    ...Object.values(AVATARS.premium), ...Object.values(PETS),
    ...Object.values(CELEBRATIONS), ...Object.values(THEMES),
    ...Object.values(CARDBACKS), ...Object.values(SOUNDPACKS),
  ].map(i => i.id);
  let h = 7;
  for (const ch of day) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  const picked = [];
  const copy = [...pool];
  for (let i = 0; i < 2 && copy.length; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    picked.push(copy.splice(h % copy.length, 1)[0]);
  }
  return { items: picked, discount: 0.3 };
}

function dealPrice(itemId, day) {
  const deals = dealsForDay(day);
  const item = findItem(itemId);
  if (!item) return null;
  return deals.items.includes(itemId) ? Math.floor(item.price * (1 - deals.discount)) : item.price;
}

// Flat item lookup across every purchasable thing.
function findItem(itemId) {
  if (POWERUPS[itemId]) return { ...POWERUPS[itemId], category: 'powerup' };
  if (AVATARS.premium[itemId]) return { ...AVATARS.premium[itemId], category: 'avatar' };
  if (PETS[itemId]) return { ...PETS[itemId], category: 'pet' };
  if (THROWABLES[itemId]) return { ...THROWABLES[itemId], category: 'throwable' };
  if (CELEBRATIONS[itemId]) return { ...CELEBRATIONS[itemId], category: 'celebration' };
  if (THEMES[itemId]) return { ...THEMES[itemId], category: 'theme' };
  if (CARDBACKS[itemId]) return { ...CARDBACKS[itemId], category: 'cardback' };
  if (SOUNDPACKS[itemId]) return { ...SOUNDPACKS[itemId], category: 'soundpack' };
  return null;
}

module.exports = {
  POWERUPS, AVATARS, PETS, THROWABLES, CELEBRATIONS, STAKES, ECONOMY, TOURNAMENT,
  QUESTS, ACHIEVEMENTS, SEASON, THEMES, CARDBACKS, SOUNDPACKS, XP,
  questsForDay, rollFreePowerUp, findItem, levelFromXp, xpForLevel, titleForLevel,
  dealsForDay, dealPrice,
};
