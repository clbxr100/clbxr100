// Canvas-2D effects engine: particles, sprites, tweens. Zero dependencies.
// The canvas sits above the DOM (pointer-events none); DOM coordinates map
// 1:1 to canvas coordinates.

const canvas = document.getElementById('fx-canvas');
const ctx = canvas.getContext('2d');
let dpr = 1;

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
}
resize();
addEventListener('resize', resize);

const actors = new Set();
let running = false;
let lastT = 0;

function loop(t) {
  if (actors.size === 0) {
    running = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const dt = Math.min(0.05, (t - lastT) / 1000) || 0.016;
  lastT = t;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);
  for (const a of actors) {
    a.update(dt);
    if (a.dead) actors.delete(a);
    else a.draw(ctx);
  }
  ctx.restore();
  requestAnimationFrame(loop);
}

function add(actor) {
  actors.add(actor);
  if (!running) {
    running = true;
    lastT = performance.now();
    requestAnimationFrame(loop);
  }
}

export function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

export function centerOfScreen() {
  return { cx: innerWidth / 2, cy: innerHeight / 2 };
}

const EASE = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

// ---------------- primitives ----------------

class Particle {
  constructor(o) { Object.assign(this, { life: 1, age: 0, vx: 0, vy: 0, g: 0, drag: 0, size: 6, rot: 0, vr: 0, fade: true }, o); }
  update(dt) {
    this.age += dt;
    if (this.age >= this.life) { this.dead = true; return; }
    this.vy += this.g * dt;
    this.vx *= 1 - this.drag * dt;
    this.vy *= 1 - this.drag * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += this.vr * dt;
  }
  draw(c) {
    const k = 1 - this.age / this.life;
    c.save();
    c.globalAlpha = this.fade ? k : 1;
    c.translate(this.x, this.y);
    c.rotate(this.rot);
    if (this.emoji) {
      c.font = `${this.size}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(this.emoji, 0, 0);
    } else if (this.shape === 'rect') {
      c.fillStyle = this.color;
      c.fillRect(-this.size / 2, -this.size / 4, this.size, this.size / 2);
    } else {
      c.fillStyle = this.color;
      c.beginPath();
      c.arc(0, 0, this.size / 2, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }
}

class Chip {
  constructor({ from, to, delay = 0, dur = 0.6, color = '#fbbf24', onArrive }) {
    this.from = from; this.to = to; this.delay = delay; this.dur = dur;
    this.age = 0; this.color = color; this.onArrive = onArrive;
    // control point for a nice arc
    this.cpx = (from.cx + to.cx) / 2 + (Math.random() - 0.5) * 120;
    this.cpy = Math.min(from.cy, to.cy) - 40 - Math.random() * 60;
  }
  update(dt) {
    this.age += dt;
    if (this.age >= this.delay + this.dur) {
      this.dead = true;
      if (this.onArrive) this.onArrive();
    }
  }
  draw(c) {
    if (this.age < this.delay) return;
    const t = EASE.inOutQuad(Math.min(1, (this.age - this.delay) / this.dur));
    const mt = 1 - t;
    const x = mt * mt * this.from.cx + 2 * mt * t * this.cpx + t * t * this.to.cx;
    const y = mt * mt * this.from.cy + 2 * mt * t * this.cpy + t * t * this.to.cy;
    c.save();
    c.translate(x, y);
    c.fillStyle = this.color;
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, 0, 9, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.setLineDash([3, 3]);
    c.beginPath();
    c.arc(0, 0, 5.5, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }
}

class CardSprite {
  // A playing card that can be flung / spiraled.
  constructor({ x, y, w = 46, h = 64, text = '', red = false, back = false }) {
    Object.assign(this, { x, y, w, h, text, red, back, rot: 0, alpha: 1 });
  }
  drawCard(c) {
    c.save();
    c.globalAlpha = this.alpha;
    c.translate(this.x, this.y);
    c.rotate(this.rot);
    c.fillStyle = this.back ? '#1e3a8a' : '#fdfdf8';
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.roundRect(-this.w / 2, -this.h / 2, this.w, this.h, 6);
    c.fill();
    c.stroke();
    if (!this.back && this.text) {
      c.fillStyle = this.red ? '#dc2626' : '#111';
      c.font = `900 ${Math.floor(this.h * 0.32)}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(this.text, 0, 0);
    }
    c.restore();
  }
}

function spawnParticles(opts) {
  const { x, y, count = 20, speed = 200, spread = Math.PI * 2, baseAngle = -Math.PI / 2,
    g = 500, life = [0.5, 1.2], size = [4, 9], colors, emoji, emojis, drag = 0, shape } = opts;
  for (let i = 0; i < count; i++) {
    const ang = baseAngle + (Math.random() - 0.5) * spread;
    const v = speed * (0.4 + Math.random() * 0.9);
    add(new Particle({
      x, y,
      vx: Math.cos(ang) * v,
      vy: Math.sin(ang) * v,
      g, drag, shape,
      vr: (Math.random() - 0.5) * 10,
      life: life[0] + Math.random() * (life[1] - life[0]),
      size: size[0] + Math.random() * (size[1] - size[0]),
      color: colors ? colors[Math.floor(Math.random() * colors.length)] : '#fbbf24',
      emoji: emojis ? emojis[Math.floor(Math.random() * emojis.length)] : emoji,
    }));
  }
}

const CONFETTI = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#c084fc', '#f472b6', '#fde047'];

function screenShake() {
  const app = document.getElementById('app');
  app.classList.remove('shake');
  void app.offsetWidth;
  app.classList.add('shake');
}

function whiteFlash() {
  const el = document.createElement('div');
  el.className = 'flash-overlay';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 450);
}

// ---------------- effects ----------------

const effects = {
  chipsFly({ from, to, amount = 100, color, onDone }) {
    const n = Math.max(3, Math.min(16, Math.round(Math.log2((amount || 100) + 2) * 2)));
    for (let i = 0; i < n; i++) {
      add(new Chip({
        from, to, delay: i * 0.05, dur: 0.55 + Math.random() * 0.2, color: color || '#fbbf24',
        onArrive: i === n - 1 ? onDone : null,
      }));
    }
    // sparkle trail is implied by staggered chips; add a small pop at the end
    setTimeout(() => spawnParticles({ x: to.cx, y: to.cy, count: 8, speed: 90, g: 220, size: [3, 6], colors: ['#fde047', '#fff'] }), (n * 50 + 550));
  },

  confettiBurst({ x, y, count = 50 }) {
    spawnParticles({ x, y, count, speed: 320, g: 420, life: [0.7, 1.6], colors: CONFETTI, shape: 'rect', size: [6, 12] });
  },

  confettiCannons() {
    spawnParticles({ x: 0, y: innerHeight * 0.75, count: 60, speed: 620, spread: 0.7, baseAngle: -Math.PI / 3.2, g: 480, life: [1, 2], colors: CONFETTI, shape: 'rect', size: [7, 13] });
    spawnParticles({ x: innerWidth, y: innerHeight * 0.75, count: 60, speed: 620, spread: 0.7, baseAngle: -Math.PI + Math.PI / 3.2, g: 480, life: [1, 2], colors: CONFETTI, shape: 'rect', size: [7, 13] });
    screenShake();
  },

  fireworks({ bursts = 5 } = {}) {
    for (let i = 0; i < bursts; i++) {
      setTimeout(() => {
        const x = innerWidth * (0.2 + Math.random() * 0.6);
        const y = innerHeight * (0.15 + Math.random() * 0.35);
        spawnParticles({ x, y, count: 60, speed: 260, g: 150, drag: 1.2, life: [0.6, 1.4], size: [3, 6], colors: [CONFETTI[i % CONFETTI.length], '#fff', CONFETTI[(i + 2) % CONFETTI.length]] });
      }, i * 320);
    }
  },

  lightning({ x, y }) {
    whiteFlash();
    screenShake();
    const bolt = {
      age: 0,
      pts: (() => {
        const pts = [{ x: x + (Math.random() - 0.5) * 60, y: 0 }];
        let cy = 0;
        while (cy < y) {
          cy += 30 + Math.random() * 45;
          pts.push({ x: x + (Math.random() - 0.5) * 70, y: Math.min(cy, y) });
        }
        pts[pts.length - 1] = { x, y };
        return pts;
      })(),
      update(dt) { this.age += dt; if (this.age > 0.35) this.dead = true; },
      draw(c) {
        c.save();
        c.globalAlpha = 1 - this.age / 0.35;
        c.strokeStyle = '#fef9c3';
        c.lineWidth = 4;
        c.shadowColor = '#facc15';
        c.shadowBlur = 18;
        c.beginPath();
        this.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        c.stroke();
        c.restore();
      },
    };
    add(bolt);
    spawnParticles({ x, y, count: 30, speed: 300, g: 400, size: [3, 7], colors: ['#fde047', '#fff', '#fbbf24'] });
  },

  shockwave({ x, y }) {
    screenShake();
    add({
      age: 0,
      update(dt) { this.age += dt; if (this.age > 0.7) this.dead = true; },
      draw(c) {
        const t = this.age / 0.7;
        c.save();
        c.globalAlpha = 1 - t;
        c.strokeStyle = '#fbbf24';
        c.lineWidth = 8 * (1 - t) + 2;
        c.beginPath();
        c.arc(x, y, 20 + t * Math.max(innerWidth, innerHeight) * 0.6, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      },
    });
    spawnParticles({ x, y, count: 50, speed: 500, g: 300, life: [0.5, 1.1], size: [4, 9], colors: ['#fbbf24', '#f87171', '#fff', '#fb923c'] });
  },

  // Cards blast outward from their positions (explosion finish).
  cardBlast({ cards, onDone }) {
    let remaining = cards.length;
    for (const cd of cards) {
      const spr = new CardSprite(cd);
      const ang = Math.atan2(cd.y - innerHeight * 0.45, cd.x - innerWidth / 2) + (Math.random() - 0.5) * 0.6;
      const v = 700 + Math.random() * 500;
      Object.assign(spr, {
        vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 200, vr: (Math.random() - 0.5) * 20, age: 0,
        update(dt) {
          this.age += dt;
          this.vy += 900 * dt;
          this.x += this.vx * dt;
          this.y += this.vy * dt;
          this.rot += this.vr * dt;
          if (this.age > 1.4) { this.dead = true; if (--remaining === 0 && onDone) onDone(); }
        },
        draw(c) { this.drawCard(c); },
      });
      add(spr);
    }
  },

  // The signature Royal Flush hurricane: cards spiral into a tornado and fly off.
  hurricane({ cards, onDone }) {
    const cx = innerWidth / 2;
    const cy = innerHeight * 0.42;
    let remaining = cards.length;
    cards.forEach((cd, i) => {
      const spr = new CardSprite(cd);
      const r0 = Math.hypot(cd.x - cx, cd.y - cy);
      Object.assign(spr, {
        age: 0, delay: i * 0.07,
        theta: Math.atan2(cd.y - cy, cd.x - cx),
        radius: Math.max(40, r0),
        update(dt) {
          this.age += dt;
          if (this.age < this.delay) return;
          const t = this.age - this.delay;
          this.theta += dt * (6 + t * 3);           // spin faster and faster
          this.radius += dt * (30 + t * 40);        // widen
          const lift = t * t * 260;                  // accelerate upward
          this.x = cx + Math.cos(this.theta) * this.radius;
          this.y = cy + Math.sin(this.theta) * this.radius * 0.45 - lift;
          this.rot += dt * 12;
          if (t > 0.5) this.alpha = Math.max(0, 1 - (t - 0.5) / 1.6);
          if (this.y < -120 || this.alpha <= 0) {
            this.dead = true;
            if (--remaining === 0 && onDone) onDone();
          }
        },
        draw(c) { this.drawCard(c); },
      });
      add(spr);
    });
    // swirling debris
    for (let i = 0; i < 5; i++) {
      setTimeout(() => spawnParticles({
        x: cx, y: cy, count: 16, speed: 240, g: -140, drag: 0.4,
        life: [0.8, 1.6], size: [3, 7], colors: ['#d1fae5', '#fff', '#a7f3d0'],
      }), i * 200);
    }
  },

  coinRain({ duration = 2500 } = {}) {
    const end = performance.now() + duration;
    const timer = setInterval(() => {
      if (performance.now() > end) { clearInterval(timer); return; }
      spawnParticles({
        x: Math.random() * innerWidth, y: -30, count: 3, speed: 60,
        baseAngle: Math.PI / 2, spread: 0.4, g: 500, life: [1.6, 2.4],
        emojis: ['🪙', '💰'], size: [18, 30],
      });
    }, 90);
  },

  // Item flies from thrower to target; impact behavior depends on kind.
  throwArc({ from, to, emoji, kind = 'splat', onImpact }) {
    add(new (class {
      constructor() { this.age = 0; this.dur = 0.7; }
      update(dt) {
        this.age += dt;
        if (this.age >= this.dur) {
          this.dead = true;
          if (kind === 'splat') {
            spawnParticles({ x: to.cx, y: to.cy, count: 26, speed: 240, g: 500, size: [4, 10], colors: emoji === '🎂' ? ['#fbcfe8', '#fde68a', '#fff'] : ['#ef4444', '#b91c1c', '#fca5a5'] });
            screenShake();
          } else if (kind === 'burst') {
            spawnParticles({ x: to.cx, y: to.cy, count: 45, speed: 300, g: 380, life: [0.7, 1.5], colors: CONFETTI, shape: 'rect', size: [6, 11] });
          } else {
            spawnParticles({ x: to.cx, y: to.cy - 14, count: 8, speed: 80, g: -60, life: [0.7, 1.3], emojis: ['💛', '✨'], size: [12, 18] });
          }
          if (onImpact) onImpact();
        }
      }
      draw(c) {
        const t = EASE.linear(this.age / this.dur);
        const x = from.cx + (to.cx - from.cx) * t;
        const arc = Math.sin(t * Math.PI) * -Math.min(160, Math.abs(to.cx - from.cx) * 0.4 + 60);
        const y = from.cy + (to.cy - from.cy) * t + arc;
        c.save();
        c.translate(x, y);
        c.rotate(t * 9);
        c.font = '30px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(emoji, 0, 0);
        c.restore();
      }
    })());
  },

  skullSlam({ x, y }) {
    add({
      age: 0,
      update(dt) { this.age += dt; if (this.age > 0.8) this.dead = true; },
      draw(c) {
        const t = Math.min(1, this.age / 0.3);
        c.save();
        c.globalAlpha = this.age > 0.55 ? 1 - (this.age - 0.55) / 0.25 : 1;
        c.font = `${20 + EASE.outCubic(t) * 40}px sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('💀', x, y - 20 + EASE.inCubic(t) * 20);
        c.restore();
      },
    });
    setTimeout(screenShake, 250);
  },

  bubblePop({ x, y }) {
    spawnParticles({ x, y, count: 14, speed: 140, g: 60, life: [0.4, 0.8], size: [4, 8], colors: ['#93c5fd', '#dbeafe', '#60a5fa'] });
    add({
      age: 0,
      update(dt) { this.age += dt; if (this.age > 0.4) this.dead = true; },
      draw(c) {
        c.save();
        c.globalAlpha = 1 - this.age / 0.4;
        c.font = `${34 + this.age * 60}px sans-serif`;
        c.textAlign = 'center';
        c.fillText('🛡️', x, y);
        c.restore();
      },
    });
  },

  purseSnatch({ from, to, amount }) {
    effects.chipsFly({ from, to, amount, color: '#c084fc' });
    add({
      age: 0,
      update(dt) { this.age += dt; if (this.age > 0.9) this.dead = true; },
      draw(c) {
        const t = this.age / 0.9;
        c.save();
        c.globalAlpha = 1 - t;
        c.font = '32px sans-serif';
        c.textAlign = 'center';
        c.fillText('🪤', from.cx + (to.cx - from.cx) * t, from.cy + (to.cy - from.cy) * t - 20);
        c.restore();
      },
    });
  },

  emojiPop({ x, y, emoji, size = 34 }) {
    spawnParticles({ x, y, count: 1, speed: 30, g: -80, life: [1, 1.4], emoji, size: [size, size] });
  },

  // Generic particle burst for themed celebrations.
  burst(opts) {
    spawnParticles(opts);
  },

  emojiRain({ emojis = ['🪙'], duration = 2500, size = [18, 30] } = {}) {
    const end = performance.now() + duration;
    const timer = setInterval(() => {
      if (performance.now() > end) { clearInterval(timer); return; }
      spawnParticles({
        x: Math.random() * innerWidth, y: -30, count: 3, speed: 60,
        baseAngle: Math.PI / 2, spread: 0.4, g: 500, life: [1.6, 2.4],
        emojis, size,
      });
    }, 90);
  },
};

export const FX = {
  play(name, opts = {}) {
    const fn = effects[name];
    if (fn) fn(opts);
  },
  screenShake,
  whiteFlash,
};
