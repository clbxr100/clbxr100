// Engine verification: scripted scenarios with rigged decks + a random fuzz.
// Run: node tests/engine-sim.js

const PokerGame = require('../poker-game');
const { scoreHand, compareHands } = require('../poker-game');

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ FAIL:', label); }
}
function section(name) { console.log('•', name); }

function c(str) {
  const rank = str.slice(0, -1);
  const suit = str.slice(-1);
  return { rank, suit };
}

// Build a deck given the exact sequence of cards that will be POPPED
// (hole cards in seat order p0c1 p0c2 p1c1 p1c2 ..., then flop x3, turn, river).
// Filler cards go to the FRONT of the array (only card-swap shifts from there).
function riggedDeck(popSequence) {
  const used = new Set(popSequence.map(x => x.rank + x.suit));
  const filler = [];
  for (const suit of ['♠', '♥', '♦', '♣']) {
    for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']) {
      if (!used.has(rank + suit)) filler.push({ rank, suit });
    }
  }
  return [...filler, ...popSequence.slice().reverse()];
}

function newGame(stacks, opts = {}) {
  const g = new PokerGame({ smallBlind: 10, bigBlind: 20, ...opts });
  stacks.forEach((chips, i) => g.addPlayer({ userId: 'p' + i, name: 'P' + i, avatar: '🤖', chips }));
  g.dealerIndex = -1; // first hand: dealer becomes seat 0
  return g;
}

function totalChips(g) {
  return g.players.reduce((s, p) => s + p.chips, 0) + g.pot;
}

// ---------------------------------------------------------------- scoreHand
section('scoreHand rankings & tiebreakers');
{
  const twoPairA = scoreHand([c('K♠'), c('K♥'), c('3♦'), c('3♣'), c('A♠')]); // KK33 A
  const twoPairB = scoreHand([c('K♦'), c('K♣'), c('9♦'), c('9♣'), c('2♠')]); // KK99 2
  assert(twoPairA.rank === 3 && twoPairB.rank === 3, 'two pair detected');
  assert(compareHands(twoPairB, twoPairA) > 0, 'KK99 beats KK33 (second pair outranks kicker)');

  const pairKickA = scoreHand([c('Q♠'), c('Q♥'), c('A♦'), c('7♣'), c('2♠')]);
  const pairKickB = scoreHand([c('Q♦'), c('Q♣'), c('K♦'), c('J♣'), c('10♠')]);
  assert(compareHands(pairKickA, pairKickB) > 0, 'QQ with A kicker beats QQ with K kicker');

  const wheel = scoreHand([c('A♠'), c('2♥'), c('3♦'), c('4♣'), c('5♠')]);
  assert(wheel.rank === 5 && wheel.tiebreaker[0] === 5, 'wheel straight, high card 5');
  const sixHigh = scoreHand([c('2♠'), c('3♥'), c('4♦'), c('5♣'), c('6♠')]);
  assert(compareHands(sixHigh, wheel) > 0, '6-high straight beats wheel');

  const royal = scoreHand([c('A♠'), c('K♠'), c('Q♠'), c('J♠'), c('10♠')]);
  assert(royal.rank === 10, 'royal flush');
  const quadsLowKick = scoreHand([c('8♠'), c('8♥'), c('8♦'), c('8♣'), c('2♠')]);
  const quadsHighKick = scoreHand([c('8♠'), c('8♥'), c('8♦'), c('8♣'), c('A♠')]);
  assert(compareHands(quadsHighKick, quadsLowKick) > 0, 'quads kicker compares');
  const boat1 = scoreHand([c('3♠'), c('3♥'), c('3♦'), c('A♣'), c('A♠')]); // 3s full of As
  const boat2 = scoreHand([c('2♠'), c('2♥'), c('A♦'), c('A♣'), c('A♥')]); // As full of 2s
  assert(compareHands(boat2, boat1) > 0, 'trips rank dominates full house');
}

// ------------------------------------------------------- basic hand + BB option
section('betting round: BB gets preflop option');
{
  const g = newGame([1000, 1000, 1000]);
  // dealer=p0, sb=p1(10), bb=p2(20); first to act preflop = p0
  g.startHand({ noPowerUps: true });
  assert(g.currentPlayer().userId === 'p0', 'UTG acts first');
  assert(g.playerAction('p0', 'call').success, 'p0 calls');
  assert(g.playerAction('p1', 'call').success, 'p1 completes SB');
  // All bets equal 20 now, but BB has not acted: round must NOT be over.
  assert(g.phase === 'preflop', 'still preflop before BB option');
  assert(g.currentPlayer().userId === 'p2', 'action on BB');
  const r = g.playerAction('p2', 'raise', 60);
  assert(r.success, 'BB can raise their option');
  assert(g.currentBet === 60, 'current bet is 60');
  assert(g.playerAction('p0', 'call').success && g.playerAction('p1', 'call').success, 'others call the raise');
  assert(g.phase === 'flop', 'advanced to flop');
  assert(g.pot === 180, 'pot = 3 x 60');
  assert(totalChips(g) === 3000, 'chips conserved');
}

// ---------------------------------------------------------------- side pots
section('side pots with two all-ins');
{
  // p0 stack 100, p1 stack 300, p2 stack 1000. Rig hands: p0 best, p1 second, p2 worst.
  const pop = [
    c('A♠'), c('A♥'),   // p0: AA (wins everything it is eligible for)
    c('K♠'), c('K♥'),   // p1: KK
    c('2♠'), c('7♦'),   // p2: junk
    c('A♦'), c('K♦'), c('4♣'), c('9♠'), c('10♦'), // board: A K 4 9 10
  ];
  const g = newGame([100, 300, 1000]);
  g.startHand({ deck: riggedDeck(pop), noPowerUps: true });
  // dealer p0, sb p1 10, bb p2 20, action p0
  assert(g.playerAction('p0', 'allin').success, 'p0 all-in 100');
  assert(g.playerAction('p1', 'allin').success, 'p1 all-in 300');
  assert(g.playerAction('p2', 'call').success, 'p2 calls 300');
  assert(g.phase === 'handEnded', 'board ran out to showdown');
  const res = g.lastHandResult;
  // Main pot: 3 x 100 = 300 → p0 (AAA... top set). Side pot: 2 x 200 = 400 → p1 (KK).
  assert(res.pots.length === 2, 'two pots built');
  assert(res.pots[0].amount === 300 && res.pots[0].winners[0].userId === 'p0', 'main pot 300 to p0');
  assert(res.pots[1].amount === 400 && res.pots[1].winners[0].userId === 'p1', 'side pot 400 to p1');
  assert(g.getPlayer('p0').chips === 300, 'p0 ends with 300');
  assert(g.getPlayer('p1').chips === 400, 'p1 ends with 400');
  assert(g.getPlayer('p2').chips === 700, 'p2 ends with 700');
  assert(totalChips(g) === 1400, 'chips conserved');
}

// ------------------------------------------------------------ uncalled refund
section('uncalled bet refunded');
{
  const g = newGame([1000, 1000]);
  g.startHand({ noPowerUps: true });
  // Heads-up: dealer p0 is SB and acts first.
  assert(g.currentPlayer().userId === 'p0', 'heads-up dealer acts first preflop');
  assert(g.playerAction('p0', 'raise', 500).success, 'p0 raises to 500');
  assert(g.playerAction('p1', 'fold').success, 'p1 folds');
  assert(g.phase === 'handEnded', 'hand over');
  assert(g.getPlayer('p0').chips === 1020, 'p0 wins only the blinds (excess refunded)');
  assert(g.getPlayer('p1').chips === 980, 'p1 lost only the BB');
  assert(totalChips(g) === 2000, 'chips conserved');
}

// ---------------------------------------------------- heads-up postflop order
section('heads-up postflop order');
{
  const g = newGame([1000, 1000]);
  g.startHand({ noPowerUps: true });
  g.playerAction('p0', 'call');
  g.playerAction('p1', 'check');
  assert(g.phase === 'flop', 'on flop');
  assert(g.currentPlayer().userId === 'p1', 'BB acts first postflop heads-up');
}

// -------------------------------------------------------------- power-ups
section('power-up: card swap draws from deck front');
{
  const pop = [c('2♠'), c('7♦'), c('A♠'), c('A♥'), c('K♦'), c('K♣'), c('4♣'), c('9♠'), c('10♦')];
  const g = newGame([1000, 1000]);
  g.startHand({ deck: riggedDeck(pop), noPowerUps: true });
  g.powerUps.p0 = { free: 'pu_swap', usedThisHand: false, shield: false, doubleDown: false };
  const frontCard = g.deck[0];
  const res = g.usePowerUp('p0', 'pu_swap', { cardIndex: 0, source: 'free' });
  assert(res.success, 'swap succeeds');
  assert(g.getPlayer('p0').cards[0] === frontCard, 'new card came from deck front');
  assert(res.privateResults.length === 1 && res.privateResults[0].userId === 'p0', 'swap result is private');
  const r2 = g.usePowerUp('p0', 'pu_swap', { cardIndex: 1, source: 'free' });
  assert(!r2.success, 'only one power-up per hand');
}

section('power-up: peek is private, shield blocks');
{
  const g = newGame([1000, 1000, 1000]);
  g.startHand({ noPowerUps: true });
  g.powerUps.p0 = { free: 'pu_peek', usedThisHand: false, shield: false, doubleDown: false };
  g.powerUps.p1 = { free: 'pu_shield', usedThisHand: false, shield: false, doubleDown: false };
  g.powerUps.p2 = { free: 'pu_peek', usedThisHand: false, shield: false, doubleDown: false };

  // p0 peeks p1 (no shield yet) — gets cards privately.
  const peek = g.usePowerUp('p0', 'pu_peek', { targetUserId: 'p1', source: 'free' });
  assert(peek.success && !peek.blocked, 'peek lands');
  assert(peek.privateResults[0].payload.cards.length === 2, 'peeker sees 2 cards');

  g.playerAction('p0', 'call');
  // p1 shields on their turn.
  const sh = g.usePowerUp('p1', 'pu_shield', { source: 'free' });
  assert(sh.success, 'shield up');
  g.playerAction('p1', 'call');
  // p2 tries to peek shielded p1 → blocked, no private data.
  const peek2 = g.usePowerUp('p2', 'pu_peek', { targetUserId: 'p1', source: 'free' });
  assert(peek2.success && peek2.blocked, 'peek blocked by shield');
  assert(peek2.privateResults.length === 0, 'no cards leak when blocked');
  assert(g.powerUps.p1.shield === false, 'shield consumed');
}

section('power-up: pot steal math');
{
  const g = newGame([1000, 1000, 1000]);
  g.startHand({ noPowerUps: true });
  g.powerUps.p0 = { free: 'pu_steal', usedThisHand: false, shield: false, doubleDown: false };
  const before = g.pot; // 30 from blinds
  const res = g.usePowerUp('p0', 'pu_steal', { source: 'free' });
  assert(res.success, 'steal succeeds');
  const stolen = Math.floor(before * 0.25);
  assert(res.publicEvent.amount === stolen, 'stole 25%');
  assert(g.pot === before - stolen, 'pot reduced');
  const contribSum = g.players.reduce((s, p) => s + p.totalContributed, 0);
  assert(contribSum === g.pot, 'contributions match pot after steal');
  assert(totalChips(g) === 3000, 'chips conserved (moved, not created)');
}

section('power-up: force fold can end the hand');
{
  const g = newGame([1000, 1000]);
  g.startHand({ noPowerUps: true });
  g.powerUps.p0 = { free: 'pu_forcefold', usedThisHand: false, shield: false, doubleDown: false };
  const res = g.usePowerUp('p0', 'pu_forcefold', { targetUserId: 'p1', source: 'free' });
  assert(res.success && res.publicEvent.folded, 'force fold lands');
  assert(res.handEnded && g.phase === 'handEnded', 'hand ended by forced fold');
  assert(g.getPlayer('p0').chips === 1020, 'p0 collected blinds');
  assert(totalChips(g) === 2000, 'chips conserved');
}

section('power-up: blind skip covered by house');
{
  const g = newGame([1000, 1000, 1000]);
  g.startHand({ noPowerUps: true });
  g.powerUps.p0 = { free: 'pu_blindskip', usedThisHand: false, shield: false, doubleDown: false };
  g.usePowerUp('p0', 'pu_blindskip', { source: 'free' });
  // finish hand quickly: everyone folds to BB
  g.playerAction('p0', 'fold');
  g.playerAction('p1', 'fold');
  assert(g.phase === 'handEnded', 'hand 1 done');
  const chipsBefore = g.getPlayer('p0').chips;
  g.startHand({ noPowerUps: true });
  // hand 2: dealer p1, sb p2, bb p0 → p0's blind should be covered
  const p0 = g.getPlayer('p0');
  assert(p0.bet === 20, 'p0 posted BB on paper');
  assert(p0.chips === chipsBefore, 'p0 stack untouched (house covered)');
  assert(g.pendingBlindSkips.size === 0, 'skip consumed');
}

section('power-up: future sight & double down');
{
  const g = newGame([1000, 1000]);
  g.startHand({ noPowerUps: true });
  g.powerUps.p0 = { free: 'pu_xray', usedThisHand: false, shield: false, doubleDown: false };
  g.powerUps.p1 = { free: 'pu_double', usedThisHand: false, shield: false, doubleDown: false };
  const nextCard = g.deck[g.deck.length - 1];
  const res = g.usePowerUp('p0', 'pu_xray', { source: 'free' });
  assert(res.success && res.privateResults[0].payload.card === nextCard, 'xray previews next card');
  g.playerAction('p0', 'call');
  const dd = g.usePowerUp('p1', 'pu_double', { source: 'free' });
  assert(dd.success && g.powerUps.p1.doubleDown, 'double down armed');
  g.playerAction('p1', 'check');
  // play to showdown with checks
  while (g.inHand()) {
    const cur = g.currentPlayer();
    g.playerAction(cur.userId, 'check');
  }
  const resHand = g.lastHandResult;
  const total = totalChips(g);
  const bonus = Object.values(resHand.houseBonuses).reduce((s, x) => s + x, 0);
  if (resHand.totalWonBy.p1) {
    assert(bonus === Math.floor(resHand.totalWonBy.p1 * 0.5), 'house paid 50% bonus to p1');
    assert(total === 2000 + bonus, 'chips = base + house bonus');
  } else {
    assert(bonus === 0, 'no bonus when double-down player loses');
    assert(total === 2000, 'chips conserved');
  }
}

section('power-up: freeze, insurance, blindfold');
{
  // Freeze marks target; Table auto-skips their turn.
  const g = newGame([1000, 1000, 1000]);
  g.startHand({ noPowerUps: true });
  g.powerUps.p0 = { free: 'pu_freeze', usedThisHand: false, shield: false, doubleDown: false, frozen: false, insurance: false, blindfoldedFrom: null };
  g.powerUps.p1 = { free: null, usedThisHand: false, shield: false, doubleDown: false, frozen: false, insurance: false, blindfoldedFrom: null };
  const fr = g.usePowerUp('p0', 'pu_freeze', { targetUserId: 'p1', source: 'free' });
  assert(fr.success && g.powerUps.p1.frozen, 'freeze marks target');

  // Insurance refunds half of a loser's contribution from the house.
  const g2 = newGame([1000, 1000]);
  g2.startHand({ noPowerUps: true });
  g2.powerUps.p0 = { free: 'pu_insurance', usedThisHand: false, shield: false, doubleDown: false, frozen: false, insurance: false, blindfoldedFrom: null };
  g2.usePowerUp('p0', 'pu_insurance', { source: 'free' });
  g2.playerAction('p0', 'raise', 400);
  g2.playerAction('p1', 'call');
  while (g2.inHand()) g2.playerAction(g2.currentPlayer().userId, 'check');
  const r2 = g2.lastHandResult;
  if (r2.totalWonBy.p0) {
    assert(!r2.houseBonuses.p0, 'no insurance payout for the winner');
  } else {
    const contributed = 400;
    assert(r2.houseBonuses.p0 === Math.floor(contributed * 0.5), `insurance refunds half of contribution (got ${r2.houseBonuses.p0})`);
  }

  // Insurance also pays when the insured player folds out.
  const g3 = newGame([1000, 1000, 1000]);
  g3.startHand({ noPowerUps: true });
  g3.powerUps.p2 = { free: 'pu_insurance', usedThisHand: false, shield: false, doubleDown: false, frozen: false, insurance: false, blindfoldedFrom: null };
  g3.playerAction('p0', 'call');
  g3.playerAction('p1', 'call');
  g3.usePowerUp('p2', 'pu_insurance', { source: 'free' });
  g3.playerAction('p2', 'check');
  // flop: p1 first to act, p1 bets big, p2 (BB) folds, p0 folds → p1 wins by fold
  g3.playerAction('p1', 'raise', 100);
  g3.playerAction('p2', 'fold');
  g3.playerAction('p0', 'fold');
  assert(g3.phase === 'handEnded', 'fold-out hand ended');
  assert(g3.lastHandResult.houseBonuses.p2 === 10, `insured BB got half of 20 back (got ${g3.lastHandResult.houseBonuses.p2})`);

  // Blindfold records the community index it starts at.
  const g4 = newGame([1000, 1000]);
  g4.startHand({ noPowerUps: true });
  g4.powerUps.p0 = { free: 'pu_blindfold', usedThisHand: false, shield: false, doubleDown: false, frozen: false, insurance: false, blindfoldedFrom: null };
  g4.powerUps.p1 = { free: null, usedThisHand: false, shield: false, doubleDown: false, frozen: false, insurance: false, blindfoldedFrom: null };
  const bf = g4.usePowerUp('p0', 'pu_blindfold', { targetUserId: 'p1', source: 'free' });
  assert(bf.success && g4.powerUps.p1.blindfoldedFrom === 0, 'blindfold marks target from current street');
}

section('regression: steal reduces what the winner collects');
{
  const g = newGame([5000, 5000]);
  g.startHand({ noPowerUps: true });
  g.playerAction('p0', 'raise', 2000);
  g.playerAction('p1', 'call');
  assert(g.pot === 4000, 'pot is 4000');
  g.powerUps.p0 = { free: 'pu_steal', usedThisHand: false, shield: false, doubleDown: false, frozen: false, insurance: false, blindfoldedFrom: null };
  g.powerUps.p1 = { free: null, usedThisHand: false, shield: false, doubleDown: false, frozen: false, insurance: false, blindfoldedFrom: null };
  // flop: p1 (BB) acts first heads-up
  g.playerAction('p1', 'check');
  const st = g.usePowerUp('p0', 'pu_steal', { source: 'free' });
  assert(st.publicEvent.amount === 1000, 'stole exactly 25%');
  g.playerAction('p0', 'check');
  while (g.inHand()) g.playerAction(g.currentPlayer().userId, 'check');
  const won = Object.values(g.lastHandResult.totalWonBy).reduce((s, x) => s + x, 0);
  assert(won === 3000, `winner collects the reduced pot (got ${won})`);
  assert(totalChips(g) === 10000, 'chips conserved');
}

// -------------------------------------------------------------------- fuzz
section('fuzz: 400 random hands, invariants hold');
{
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let violations = 0;
  for (let iter = 0; iter < 400; iter++) {
    const n = 2 + Math.floor(rand() * 6);
    const g = newGame(Array.from({ length: n }, () => 200 + Math.floor(rand() * 2000)), { rand });
    const startTotal = totalChips(g);
    const started = g.startHand();
    if (!started.success) continue;
    let houseCreated = 0;
    let steps = 0;
    while (g.inHand() && steps++ < 500) {
      const cur = g.currentPlayer();
      if (!cur) break;
      // Occasionally use the free power-up.
      const pu = g.powerUps[cur.userId];
      if (pu && pu.free && !pu.usedThisHand && rand() < 0.3) {
        const type = pu.free;
        const others = g.livePlayers().filter(p => p !== cur && !p.allIn);
        const target = others[Math.floor(rand() * others.length)];
        const before = totalChips(g);
        const res = g.usePowerUp(cur.userId, type, {
          targetUserId: target && target.userId,
          cardIndex: Math.floor(rand() * 2),
          source: 'free',
        });
        if (res.success) {
          if (totalChips(g) !== before) violations++;
          if (res.handEnded) break;
        }
      }
      if (!g.inHand()) break;
      const c2 = g.currentPlayer();
      if (!c2) break;
      const toCall = g.currentBet - c2.bet;
      const roll = rand();
      let r;
      if (toCall <= 0) {
        if (roll < 0.65) r = g.playerAction(c2.userId, 'check');
        else if (roll < 0.9) r = g.playerAction(c2.userId, 'raise', g.currentBet + g.minRaise + Math.floor(rand() * 100));
        else r = g.playerAction(c2.userId, 'allin');
      } else {
        if (roll < 0.35) r = g.playerAction(c2.userId, 'fold');
        else if (roll < 0.8) r = g.playerAction(c2.userId, 'call');
        else if (roll < 0.95) r = g.playerAction(c2.userId, 'raise', g.currentBet + g.minRaise + Math.floor(rand() * 100));
        else r = g.playerAction(c2.userId, 'allin');
      }
      if (!r.success) { violations++; break; }
    }
    if (g.inHand()) { violations++; continue; }
    if (g.lastHandResult) {
      houseCreated = Object.values(g.lastHandResult.houseBonuses || {}).reduce((s, x) => s + x, 0);
    }
    // Blind skip may create house chips at NEXT hand start; within one hand
    // total chips must equal start + double-down house bonus.
    if (totalChips(g) !== startTotal + houseCreated) {
      violations++;
      if (violations < 4) console.error(`  fuzz iter ${iter}: total ${totalChips(g)} != ${startTotal}+${houseCreated}`);
    }
    // Pot must be fully distributed.
    if (g.pot !== 0) violations++;
  }
  assert(violations === 0, `fuzz clean (${violations} violations)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
