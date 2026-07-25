// Poker bots: Chen-formula preflop, Monte Carlo hand strength postflop,
// per-bot personality, and opportunistic power-up use.

const PokerGame = require('../poker-game');
const { compareHands } = require('../poker-game');

const RANK_VALUES = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };

const BOT_NAMES = [
  ['Tex', '🤠'], ['Vega', '🦊'], ['Ace', '😎'], ['Rocky', '🦁'], ['Luna', '🐼'],
  ['Doyle', '🐯'], ['Missy', '👻'], ['Chip', '🤖'], ['Sly', '😏'], ['Duke', '👑'],
  ['Pixel', '👾'], ['Blaze', '🔥'],
];

// ---- table talk ------------------------------------------------------------
// Each voice gets a handful of short lines per event. {item}/{amount} are
// substituted from ctx. Keep everything under ~60 chars and family-friendly.

const CHAT_LINES = {
  cocky: {
    win: ['Too easy. Ship it. 💰', 'Read you like a book.', 'Pay the man. 😎', 'Never a doubt.', "That's {amount} for the good guys."],
    lose_big: ['Lucky river. Enjoy it.', "You'll give it back.", 'Card rack over there.', 'I still played it perfect.'],
    allin: ['All the chips. Sweat it. 😎', "Let's gamble.", 'Time to end this.', 'Shipping the stack.'],
    fold_grumble: ['Fine, take this one.', "I'll fold. This time.", 'Saving my bullets.'],
    hit_by_item: ['A {item}? That all you got?', 'You missed. Mostly.', 'Careful, this face is money.'],
    big_hand: ["Cute hand. I've had better.", 'Yawn. Seen bigger.', 'I fold those for fun.'],
    greeting: ['Fresh money! Have a seat.', 'Welcome. Bring chips.', 'New blood. Love it. 😎'],
  },
  grumpy: {
    win: ['About time.', 'Hmph. Took long enough.', 'That barely covers my losses.', 'Finally, the deck woke up.'],
    lose_big: ['Rigged. Absolutely rigged.', 'Of course. The one-outer.', 'That river should be illegal.', 'Unbelievable. Every time.'],
    allin: ['Whatever. All-in.', 'Might as well. All of it.', "In. Don't make it weird."],
    fold_grumble: ["Take it. I don't care.", 'Nice raise. Bully.', 'Ugh. Fold. Happy now?', 'Fold. Rather not donate.'],
    hit_by_item: ['Who threw that {item}?!', 'Hey! Cut it out!', 'Real mature. A {item}. 🙄'],
    big_hand: ['Great. A monster. Rigged.', 'Of course THEY get it.', 'Never me. Not once. Ever.'],
    greeting: ['Great. Another one.', "Hmph. Sit. Don't slowroll.", 'Welcome, I guess.'],
  },
  cheerful: {
    win: ['Yay! Chips! 🎉', 'Aw, thanks for the pot!', 'Lucky me! Good hand, all!', 'Woo! Drinks on me! 🍹'],
    lose_big: ['Aw shucks. Nice hand!', 'Well played! Ouch though 😅', 'You got me! Great river!'],
    allin: ['Weeee, all-in! 🎢', 'All of them! Good luck us!', 'Going for it! Wish me luck!'],
    fold_grumble: ['Too rich for me! 😅', 'You can have that one!', "I'll wait for a better spot!"],
    hit_by_item: ['A {item}! For me? 🥰', 'Hehe, that tickled!', 'Ooh, a {item}! Thanks... I think?'],
    big_hand: ['WOW what a hand! 🤩', 'Amazing! Frame that one!', 'Poker is SO fun!!'],
    greeting: ['Hi hi! Welcome! 👋', 'Yay, a new friend!', 'Welcome! Good luck! 🍀'],
  },
  silent: {
    win: ['...nice.', 'Mm.', '👍'],
    lose_big: ['...', 'Mm.'],
    allin: ['All-in.', '...'],
    fold_grumble: ['Fold.', '...'],
    hit_by_item: ['...why.', 'Hm. {item}.'],
    big_hand: ['...big.', 'Whoa.'],
    greeting: ['Hey.', '*nods*'],
  },
  nerd: {
    win: ['EV positive. As computed. 📈', 'Pot odds said call. Correct.', 'Variance owed me that.', 'Solver approved. 🤓'],
    lose_big: ['A 4% line. Naturally.', 'Variance is undefeated.', 'I had 82% on the turn...', "Small sample. I'm fine."],
    allin: ['Shoving. Math checks out.', 'Fold equity + equity = in.', 'The range says jam. 🤓'],
    fold_grumble: ['Priced out. Easy fold.', 'Insufficient pot odds. Fold.', 'Risk of ruin says no.'],
    hit_by_item: ['A {item}? Statistically rude.', 'Projectile EV: negative.', 'That {item} had a bad angle.'],
    big_hand: ['~0.17% hand. Neat.', "That's a 4-sigma event!", 'Recalculating outs... wow.'],
    greeting: ['Welcome. Mind the variance.', 'Hello! GTO seat is taken.', 'A new data point joins.'],
  },
};

const VOICE_NAMES = Object.keys(CHAT_LINES);

// Per-event multiplier on chattiness: rare/personal events (getting pelted,
// a human sitting down) get more of a reaction than routine folds.
const CHAT_WEIGHTS = {
  win: 1.0, lose_big: 0.9, allin: 1.1, fold_grumble: 0.5,
  hit_by_item: 1.6, big_hand: 0.7, greeting: 1.8,
};

// Returns a chat line for the event, or null to stay quiet. The chattiness
// roll lives here so tables stay quiet by default.
function chatLine(event, ctx = {}, personality = {}) {
  const voice = CHAT_LINES[personality.voice] ? personality.voice : 'cheerful';
  const lines = CHAT_LINES[voice][event];
  if (!lines || lines.length === 0) return null;
  const chattiness = typeof personality.chattiness === 'number' ? personality.chattiness : 0.25;
  const p = Math.min(0.85, chattiness * (CHAT_WEIGHTS[event] || 1));
  if (Math.random() > p) return null;
  const raw = lines[Math.floor(Math.random() * lines.length)];
  return raw
    .replaceAll('{item}', ctx.item != null ? String(ctx.item) : 'that')
    .replaceAll('{amount}', ctx.amount != null ? String(ctx.amount) : 'the pot');
}

let botCounter = 0;

function createBot(usedNames = new Set()) {
  botCounter++;
  const pick = BOT_NAMES.find(([n]) => !usedNames.has(n)) || BOT_NAMES[botCounter % BOT_NAMES.length];
  const name = usedNames.has(pick[0]) ? `${pick[0]}${botCounter}` : pick[0];
  const voice = VOICE_NAMES[Math.floor(Math.random() * VOICE_NAMES.length)];
  return {
    userId: `bot_${botCounter}_${Math.floor(Math.random() * 1e6)}`,
    name,
    avatar: pick[1],
    isBot: true,
    personality: {
      aggression: 0.3 + Math.random() * 0.5,
      bluffRate: 0.05 + Math.random() * 0.06,
      jitter: 0.1,
      // The strong-silent type barely speaks even when they do react.
      chattiness: voice === 'silent' ? 0.15 : 0.15 + Math.random() * 0.35,
      voice,
    },
  };
}

// Chen formula preflop score (roughly 0..20).
function chenScore(cards) {
  const [a, b] = [...cards].sort((x, y) => RANK_VALUES[y.rank] - RANK_VALUES[x.rank]);
  const hv = RANK_VALUES[a.rank];
  let score = hv === 14 ? 10 : hv === 13 ? 8 : hv === 12 ? 7 : hv === 11 ? 6 : hv / 2;
  const pair = a.rank === b.rank;
  if (pair) score = Math.max(5, score * 2);
  if (a.suit === b.suit) score += 2;
  const gap = RANK_VALUES[a.rank] - RANK_VALUES[b.rank] - 1;
  if (!pair) {
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    if (gap <= 1 && RANK_VALUES[a.rank] < 12) score += 1; // connector bonus
  }
  return Math.max(0, score);
}

// Monte Carlo equity vs one random opponent (cheap and good enough).
function winProbability(holeCards, communityCards, rollouts = 160, rand = Math.random) {
  const usedKeys = new Set([...holeCards, ...communityCards].map(c => c.rank + c.suit));
  const deck = [];
  for (const suit of ['♠', '♥', '♦', '♣']) {
    for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']) {
      if (!usedKeys.has(rank + suit)) deck.push({ rank, suit });
    }
  }
  const evaluator = new PokerGame({});
  let wins = 0;
  for (let i = 0; i < rollouts; i++) {
    // partial Fisher-Yates: sample what we need from the deck copy
    const need = 2 + (5 - communityCards.length);
    const copy = deck.slice();
    for (let j = 0; j < need; j++) {
      const k = j + Math.floor(rand() * (copy.length - j));
      [copy[j], copy[k]] = [copy[k], copy[j]];
    }
    const oppCards = [copy[0], copy[1]];
    const board = [...communityCards, ...copy.slice(2, need)];
    const mine = evaluator.evaluateHand(holeCards, board);
    const theirs = evaluator.evaluateHand(oppCards, board);
    const cmp = compareHands(mine, theirs);
    if (cmp > 0) wins += 1;
    else if (cmp === 0) wins += 0.5;
  }
  return wins / rollouts;
}

// view: { holeCards, communityCards, phase, pot, currentBet, minRaise,
//         myBet, myChips, numLive, bigBlind }
function decideAction(view, personality) {
  const { aggression, bluffRate, jitter } = personality;
  const toCall = view.currentBet - view.myBet;
  const noise = 1 + (Math.random() * 2 - 1) * jitter;

  let strength; // 0..1
  if (view.phase === 'preflop') {
    strength = Math.min(1, (chenScore(view.holeCards) / 14)) * noise;
  } else {
    // One-opponent equity, dampened when facing a crowd.
    const equity = winProbability(view.holeCards, view.communityCards);
    strength = Math.pow(equity, Math.max(1, (view.numLive - 1) * 0.6)) * noise;
  }

  const potOdds = toCall > 0 ? toCall / (view.pot + toCall) : 0;
  const bluffing = Math.random() < bluffRate;

  const raiseTo = () => {
    const base = view.currentBet + view.minRaise;
    const sized = Math.max(base, Math.floor(view.pot * (0.4 + aggression * 0.6)));
    return Math.min(view.myBet + view.myChips, sized);
  };

  if (toCall <= 0) {
    if (strength > 0.75 - aggression * 0.15 || bluffing) {
      return view.myChips > view.minRaise ? { action: 'raise', amount: raiseTo() } : { action: 'allin' };
    }
    return { action: 'check' };
  }

  // Facing a bet
  const callCost = toCall / Math.max(1, view.myChips + view.myBet);
  if (strength > 0.85 && aggression > 0.5 && view.myChips > toCall + view.minRaise) {
    return { action: 'raise', amount: raiseTo() };
  }
  if (bluffing && view.myChips > toCall + view.minRaise && callCost < 0.2) {
    return { action: 'raise', amount: raiseTo() };
  }
  if (strength >= potOdds + 0.08 || (strength >= potOdds && callCost < 0.1)) {
    return toCall >= view.myChips ? { action: 'allin' } : { action: 'call' };
  }
  if (toCall <= view.bigBlind && strength > 0.3) {
    return { action: 'call' }; // defend cheap
  }
  return { action: 'fold' };
}

// Decide whether/how to use the free power-up. Returns null or
// { type, targetUserId, cardIndex }.
function maybeUsePowerUp(view, freePowerUp, personality) {
  if (!freePowerUp || Math.random() > 0.3) return null;
  const toCall = view.currentBet - view.myBet;
  const others = view.opponents.filter(o => !o.folded && !o.allIn);
  const target = others.length ? others[Math.floor(Math.random() * others.length)] : null;

  switch (freePowerUp) {
    case 'pu_swap': {
      if (view.phase !== 'preflop') return null;
      const score = chenScore(view.holeCards);
      if (score >= 7) return null;
      const [a, b] = view.holeCards;
      const cardIndex = RANK_VALUES[a.rank] < RANK_VALUES[b.rank] ? 0 : 1;
      return { type: 'pu_swap', cardIndex };
    }
    case 'pu_shield':
      return view.phase === 'preflop' ? { type: 'pu_shield' } : null;
    case 'pu_blindskip':
      return { type: 'pu_blindskip' };
    case 'pu_peek':
      return toCall > view.bigBlind * 3 && target ? { type: 'pu_peek', targetUserId: target.userId } : null;
    case 'pu_xray':
      return view.phase !== 'river' && Math.random() < 0.6 ? { type: 'pu_xray' } : null;
    case 'pu_double':
      return view.phase !== 'preflop' && Math.random() < 0.5 ? { type: 'pu_double' } : null;
    case 'pu_steal':
      return view.pot > view.bigBlind * 8 ? { type: 'pu_steal' } : null;
    case 'pu_forcefold': {
      const rich = others.filter(o => o.bet > view.bigBlind * 2);
      const t = rich.length ? rich[0] : (toCall > view.bigBlind * 4 ? target : null);
      return t ? { type: 'pu_forcefold', targetUserId: t.userId } : null;
    }
    case 'pu_freeze': {
      const aggressor = others.find(o => o.bet >= view.bigBlind * 2);
      return aggressor ? { type: 'pu_freeze', targetUserId: aggressor.userId } : null;
    }
    case 'pu_insurance':
      return view.pot > view.bigBlind * 6 && chenScore(view.holeCards) < 7 ? { type: 'pu_insurance' } : null;
    case 'pu_blindfold':
      return view.phase !== 'river' && target && Math.random() < 0.6
        ? { type: 'pu_blindfold', targetUserId: target.userId } : null;
    case 'pu_mulligan':
      return view.phase === 'preflop' && chenScore(view.holeCards) < 5 ? { type: 'pu_mulligan' } : null;
    case 'pu_taxman':
      return Math.random() < 0.5 ? { type: 'pu_taxman' } : null;
    case 'pu_lucky':
      return Math.random() < 0.6 ? { type: 'pu_lucky' } : null;
    default:
      return null;
  }
}

module.exports = { createBot, decideAction, maybeUsePowerUp, chatLine, chenScore, winProbability };
