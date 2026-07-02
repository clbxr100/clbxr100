// Win celebrations tiered by hand rank — Rocket League goal energy.
// rank: 0 fold-win, 1 high card … 10 royal flush.
import { FX, rectOf } from './fx.js';
import { sfx } from '../sound.js';

// Collect the on-screen cards (community + hero) as sprite specs, then hide
// the DOM originals so the canvas copies can be flung around.
function captureCards() {
  const els = [
    ...document.querySelectorAll('#community .pcard'),
    ...document.querySelectorAll('#hero-cards .pcard'),
  ];
  const cards = els.map(el => {
    const r = rectOf(el);
    return {
      x: r.cx, y: r.cy, w: r.w, h: r.h,
      text: el.dataset.face || '',
      red: el.classList.contains('red'),
      back: el.classList.contains('back'),
      el,
    };
  });
  return {
    cards,
    hide: () => els.forEach(el => (el.style.visibility = 'hidden')),
    restore: () => els.forEach(el => (el.style.visibility = '')),
  };
}

export function celebrate(rank, { winnerEls = [], potEl, amount = 0 }) {
  const pot = potEl ? rectOf(potEl) : { cx: innerWidth / 2, cy: innerHeight * 0.4 };

  // Chips always slide to the winners.
  for (const el of winnerEls) {
    FX.play('chipsFly', { from: pot, to: rectOf(el), amount });
  }

  if (rank <= 0) { sfx.chip(); return; }

  if (rank <= 2) {
    sfx.win();
    return;
  }

  if (rank <= 4) {
    sfx.win();
    FX.play('confettiBurst', { x: pot.cx, y: pot.cy, count: 55 });
    return;
  }

  if (rank <= 6) {
    sfx.bigWin();
    FX.play('confettiCannons');
    return;
  }

  if (rank === 7) {
    sfx.bigWin();
    FX.play('confettiCannons');
    FX.play('fireworks', { bursts: 5 });
    return;
  }

  if (rank === 8) {
    sfx.explosion();
    FX.play('lightning', { x: pot.cx, y: pot.cy });
    setTimeout(() => { sfx.bigWin(); FX.play('fireworks', { bursts: 4 }); }, 350);
    return;
  }

  if (rank === 9) {
    sfx.explosion();
    const cap = captureCards();
    cap.hide();
    FX.play('shockwave', { x: pot.cx, y: pot.cy });
    FX.play('cardBlast', { cards: cap.cards, onDone: cap.restore });
    setTimeout(() => { sfx.bigWin(); FX.play('confettiCannons'); }, 400);
    setTimeout(cap.restore, 2600); // safety net
    return;
  }

  // rank 10 — ROYAL FLUSH: the full hurricane show.
  sfx.explosion();
  FX.whiteFlash();
  const cap = captureCards();
  cap.hide();
  sfx.whoosh();
  FX.play('hurricane', { cards: cap.cards, onDone: cap.restore });
  setTimeout(() => sfx.bigWin(), 500);
  setTimeout(() => FX.play('coinRain', { duration: 3200 }), 600);
  setTimeout(() => FX.play('fireworks', { bursts: 7 }), 900);
  setTimeout(() => FX.play('confettiCannons'), 1600);
  setTimeout(cap.restore, 4200); // safety net
}

// Power-up moments.
export function powerUpFx(event, seatEls) {
  const seat = (userId) => {
    const el = seatEls(userId);
    return el ? rectOf(el) : { cx: innerWidth / 2, cy: innerHeight / 2 };
  };
  switch (event.type) {
    case 'pu_forcefold':
      if (event.blocked) FX.play('bubblePop', seat(event.blockedBy));
      else { sfx.explosion(); FX.play('skullSlam', { x: seat(event.targetUserId).cx, y: seat(event.targetUserId).cy }); }
      break;
    case 'pu_steal': {
      if (event.blocked) { FX.play('bubblePop', seat(event.blockedBy)); break; }
      sfx.powerup();
      const potEl = document.getElementById('pot-display');
      FX.play('purseSnatch', { from: potEl ? rectOf(potEl) : seat(null), to: seat(event.userId), amount: event.amount });
      break;
    }
    case 'pu_peek':
      if (event.blocked) FX.play('bubblePop', seat(event.blockedBy));
      else { sfx.powerup(); FX.play('emojiPop', { ...xy(seat(event.targetUserId)), emoji: '👁️' }); }
      break;
    case 'pu_shield':
      sfx.powerup();
      FX.play('emojiPop', { ...xy(seat(event.userId)), emoji: '🛡️' });
      break;
    default:
      sfx.powerup();
      FX.play('emojiPop', { ...xy(seat(event.userId)), emoji: '⚡' });
  }
}

function xy(r) { return { x: r.cx, y: r.cy }; }
