// Client-side hand strength label for the hero — display only, the server
// still decides winners. Mirrors the engine's ranking.

const VAL = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
const WORD = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };

function rankWord(v) { return WORD[v] || String(v); }
function plural(v) { return rankWord(v) + 's'; }

// Best 5-card hand out of 2–7 cards → { rank, name, label }.
// label is the flavorful line shown in the pill ("Two Pair, Kings & Nines").
export function bestHand(cards) {
  const clean = (cards || []).filter(c => c && c.rank && !c.hidden);
  if (clean.length < 2) return null;
  if (clean.length <= 5) return score(clean);
  let best = null;
  const combos = choose(clean, 5);
  for (const combo of combos) {
    const s = score(combo);
    if (!best || cmp(s, best) > 0) best = s;
  }
  return best;
}

function choose(arr, k) {
  const out = [];
  const rec = (start, picked) => {
    if (picked.length === k) { out.push([...picked]); return; }
    for (let i = start; i <= arr.length - (k - picked.length); i++) {
      picked.push(arr[i]);
      rec(i + 1, picked);
      picked.pop();
    }
  };
  rec(0, []);
  return out;
}

function cmp(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < a.tie.length; i++) {
    if ((a.tie[i] || 0) !== (b.tie[i] || 0)) return (a.tie[i] || 0) - (b.tie[i] || 0);
  }
  return 0;
}

function score(cards) {
  const vals = cards.map(c => VAL[c.rank]).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  // groups sorted by count desc then value desc — tiebreak order
  const groups = Object.entries(counts)
    .map(([v, n]) => [Number(v), n])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const tie = groups.map(g => g[0]);

  const is5 = cards.length === 5;
  const flush = is5 && suits.every(s => s === suits[0]);
  let straightHigh = 0;
  if (is5 && groups.length === 5) {
    const u = [...vals];
    if (u[0] - u[4] === 4) straightHigh = u[0];
    else if (u[0] === 14 && u[1] === 5 && u[1] - u[4] === 3) straightHigh = 5; // wheel
  }

  if (flush && straightHigh === 14) return { rank: 10, tie: [14], label: 'Royal Flush' };
  if (flush && straightHigh) return { rank: 9, tie: [straightHigh], label: `Straight Flush, ${rankWord(straightHigh)} high` };
  if (groups[0][1] === 4) return { rank: 8, tie, label: `Quad ${plural(groups[0][0])}` };
  if (groups[0][1] === 3 && groups[1] && groups[1][1] >= 2) {
    return { rank: 7, tie, label: `Full House, ${plural(groups[0][0])} over ${plural(groups[1][0])}` };
  }
  if (flush) return { rank: 6, tie: vals, label: `Flush, ${rankWord(vals[0])} high` };
  if (straightHigh) return { rank: 5, tie: [straightHigh], label: `Straight to the ${rankWord(straightHigh)}` };
  if (groups[0][1] === 3) return { rank: 4, tie, label: `Trip ${plural(groups[0][0])}` };
  if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
    return { rank: 3, tie, label: `Two Pair, ${plural(groups[0][0])} & ${plural(groups[1][0])}` };
  }
  if (groups[0][1] === 2) return { rank: 2, tie, label: `Pair of ${plural(groups[0][0])}` };
  return { rank: 1, tie: vals, label: `${rankWord(vals[0])} High` };
}
