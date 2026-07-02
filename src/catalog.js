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
};

// Equippable win-celebration themes: played on top of the standard
// hand-rank spectacle when YOU drag the pot.
const CELEBRATIONS = {
  celebration_fireworks: { id: 'celebration_fireworks', emoji: '🎆', name: 'Grand Fireworks', price: 3000, desc: 'Every win ends in a fireworks show' },
  celebration_money: { id: 'celebration_money', emoji: '💸', name: 'Money Storm', price: 4000, desc: 'It rains cash when you win' },
  celebration_storm: { id: 'celebration_storm', emoji: '⛈️', name: 'Thunderstorm', price: 5000, desc: 'Lightning strikes your defeated foes' },
  celebration_hearts: { id: 'celebration_hearts', emoji: '💖', name: 'Love Bomb', price: 2500, desc: 'Win them over with hearts' },
  celebration_dragon: { id: 'celebration_dragon', emoji: '🐉', name: 'Dragon Fire', price: 8000, desc: 'A dragon torches the table in your honor' },
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
  },
};

const PETS = {
  pet_dog: { id: 'pet_dog', emoji: '🐕', name: 'Pup', price: 2500 },
  pet_cat: { id: 'pet_cat', emoji: '🐈', name: 'Kitty', price: 2500 },
  pet_turtle: { id: 'pet_turtle', emoji: '🐢', name: 'Lucky Turtle', price: 4000 },
  pet_parrot: { id: 'pet_parrot', emoji: '🦜', name: 'Card Shark Parrot', price: 5000 },
  pet_unicorn: { id: 'pet_unicorn', emoji: '🦄', name: 'Unicorn', price: 12000 },
  pet_dragon: { id: 'pet_dragon', emoji: '🐉', name: 'Dragon', price: 15000 },
};

const THROWABLES = {
  throw_tomato: { id: 'throw_tomato', emoji: '🍅', name: 'Tomato', price: 100, pack: 5, kind: 'splat' },
  throw_cookie: { id: 'throw_cookie', emoji: '🍪', name: 'Cookie', price: 100, pack: 5, kind: 'gift' },
  throw_confetti: { id: 'throw_confetti', emoji: '🎊', name: 'Confetti Bomb', price: 150, pack: 5, kind: 'burst' },
  throw_drink: { id: 'throw_drink', emoji: '🍹', name: 'Drink', price: 150, pack: 5, kind: 'gift' },
  throw_rose: { id: 'throw_rose', emoji: '🌹', name: 'Rose', price: 200, pack: 5, kind: 'gift' },
  throw_cake: { id: 'throw_cake', emoji: '🎂', name: 'Cake', price: 250, pack: 5, kind: 'splat' },
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

// Daily quests: 3 of these rotate in each day, tracked per user.
const QUESTS = {
  q_play10: { id: 'q_play10', name: 'Grinder', desc: 'Play 10 hands', emoji: '🃏', target: 10, reward: 200 },
  q_win3: { id: 'q_win3', name: 'On a Heater', desc: 'Win 3 hands', emoji: '🏆', target: 3, reward: 300 },
  q_power2: { id: 'q_power2', name: 'Loose Cannon', desc: 'Use 2 power-ups', emoji: '⚡', target: 2, reward: 150 },
  q_throw1: { id: 'q_throw1', name: 'Food Fight', desc: 'Throw or gift an item', emoji: '🎂', target: 1, reward: 100 },
  q_tourney1: { id: 'q_tourney1', name: 'Contender', desc: 'Enter a tournament', emoji: '🎖️', target: 1, reward: 250 },
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

function rollFreePowerUp(rand = Math.random) {
  const entries = Object.values(POWERUPS);
  const total = entries.reduce((s, p) => s + p.freeWeight, 0);
  let r = rand() * total;
  for (const p of entries) {
    r -= p.freeWeight;
    if (r <= 0) return p.id;
  }
  return entries[0].id;
}

// Flat item lookup across every purchasable thing.
function findItem(itemId) {
  if (POWERUPS[itemId]) return { ...POWERUPS[itemId], category: 'powerup' };
  if (AVATARS.premium[itemId]) return { ...AVATARS.premium[itemId], category: 'avatar' };
  if (PETS[itemId]) return { ...PETS[itemId], category: 'pet' };
  if (THROWABLES[itemId]) return { ...THROWABLES[itemId], category: 'throwable' };
  if (CELEBRATIONS[itemId]) return { ...CELEBRATIONS[itemId], category: 'celebration' };
  return null;
}

module.exports = { POWERUPS, AVATARS, PETS, THROWABLES, CELEBRATIONS, STAKES, ECONOMY, TOURNAMENT, QUESTS, questsForDay, rollFreePowerUp, findItem };
