// Canvas-2D effects engine: particles, sprites, tweens. Zero dependencies.
// The canvas sits above the DOM (pointer-events none); DOM coordinates map
// 1:1 to canvas coordinates.
//
// Rendering notes:
// - Sparks/fireworks/lightning use globalCompositeOperation 'lighter' so
//   overlapping light adds up and GLOWS (cheap, no shadowBlur per particle).
// - Bright particles are drawn from pre-rendered radial-gradient sprites
//   (white core -> colored falloff) cached on offscreen canvases.
// - Fast sparks also draw a short fading streak along their velocity.
// - A global particle budget (~400) keeps phones smooth.

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

const MAX_PARTICLES = 400;
let liveParticles = 0;

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

// ---------------- color + sprite helpers ----------------

function hexRgb(color) {
  if (typeof color === 'string' && color[0] === '#') {
    let h = color.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return [255, 210, 90]; // warm gold fallback
}

function shade(color, amt) {
  // amt in [-1, 1]: negative darkens, positive lightens toward white.
  const [r, g, b] = hexRgb(color);
  const f = amt < 0
    ? (x) => Math.round(x * (1 + amt))
    : (x) => Math.round(x + (255 - x) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// Radial-gradient glow sprite: hot white core fading through the color.
const glowCache = new Map();
function glowSprite(color, res = 64) {
  const key = color + res;
  let s = glowCache.get(key);
  if (s) return s;
  const [r, g, b] = hexRgb(color);
  s = document.createElement('canvas');
  s.width = s.height = res;
  const q = s.getContext('2d');
  const half = res / 2;
  const grad = q.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.22, `rgba(${r},${g},${b},0.95)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.32)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  q.fillStyle = grad;
  q.fillRect(0, 0, res, res);
  glowCache.set(key, s);
  return s;
}

// Pre-rendered casino chip face: shaded disc, rim stripes, dashed inner ring.
const chipCache = new Map();
function chipSprite(color) {
  let s = chipCache.get(color);
  if (s) return s;
  const S = 64, cx = S / 2, R = 29;
  s = document.createElement('canvas');
  s.width = s.height = S;
  const q = s.getContext('2d');
  // dark edge for depth
  q.fillStyle = shade(color, -0.45);
  q.beginPath(); q.arc(cx, cx, R, 0, Math.PI * 2); q.fill();
  // shaded face (light falls from upper-left)
  const face = q.createRadialGradient(cx - 8, cx - 9, 3, cx, cx, R);
  face.addColorStop(0, shade(color, 0.35));
  face.addColorStop(0.55, color);
  face.addColorStop(1, shade(color, -0.22));
  q.fillStyle = face;
  q.beginPath(); q.arc(cx, cx, R - 2, 0, Math.PI * 2); q.fill();
  // rim stripes (8 white dashes around the edge)
  q.strokeStyle = 'rgba(255,255,255,0.92)';
  q.lineWidth = 8;
  const rr = R - 6;
  const seg = (Math.PI * 2 * rr) / 16;
  q.setLineDash([seg, seg]);
  q.beginPath(); q.arc(cx, cx, rr, 0, Math.PI * 2); q.stroke();
  q.setLineDash([]);
  // dashed inner ring
  q.strokeStyle = 'rgba(255,255,255,0.65)';
  q.lineWidth = 1.6;
  q.setLineDash([3.4, 3.4]);
  q.beginPath(); q.arc(cx, cx, 15, 0, Math.PI * 2); q.stroke();
  q.setLineDash([]);
  // inner disc + soft top highlight
  q.fillStyle = shade(color, 0.12);
  q.beginPath(); q.arc(cx, cx, 12.5, 0, Math.PI * 2); q.fill();
  q.strokeStyle = 'rgba(255,255,255,0.4)';
  q.lineWidth = 2;
  q.beginPath(); q.arc(cx, cx, R - 3.5, -2.6, -0.7); q.stroke();
  chipCache.set(color, s);
  return s;
}

// Quick expanding light pop (used for firework bursts, impacts, lightning hit).
function addFlash(x, y, color, radius = 60, dur = 0.25) {
  add({
    age: 0,
    update(dt) { this.age += dt; if (this.age > dur) this.dead = true; },
    draw(c) {
      const t = this.age / dur;
      const r = radius * (0.4 + EASE.outCubic(t) * 0.6);
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = (1 - t) * 0.9;
      c.drawImage(glowSprite(color, 128), x - r, y - r, r * 2, r * 2);
      c.restore();
    },
  });
}

// ---------------- primitives ----------------

class Particle {
  constructor(o) {
    Object.assign(this, {
      life: 1, age: 0, vx: 0, vy: 0, g: 0, drag: 0, size: 6, rot: 0, vr: 0,
      fade: true, glow: false, twinkle: false, crackle: false, sway: 0,
    }, o);
    this.phase = Math.random() * Math.PI * 2;
    if (this.shape === 'rect') {
      this.flut = 5 + Math.random() * 7;              // flutter frequency
      this.dark = shade(this.color || '#fff', -0.35); // "back side" tint
    }
    liveParticles++;
  }
  update(dt) {
    this.age += dt;
    if (this.age >= this.life) {
      this.dead = true;
      liveParticles--;
      if (this.crackle) crackleAt(this.x, this.y);
      return;
    }
    this.vy += this.g * dt;
    this.vx *= 1 - this.drag * dt;
    this.vy *= 1 - this.drag * dt;
    if (this.shape === 'rect') {
      // fluttering confetti drifts sideways as it tumbles
      this.vx += Math.cos(this.age * this.flut + this.phase) * 60 * dt;
    } else if (this.sway) {
      this.vx += Math.cos(this.age * 2.2 + this.phase) * this.sway * dt;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += this.vr * dt;
  }
  draw(c) {
    const k = 1 - this.age / this.life;
    const alpha = this.fade ? k : 1;
    c.save();
    if (this.emoji) {
      c.globalAlpha = alpha;
      c.translate(this.x, this.y);
      c.rotate(this.rot);
      c.font = `${this.size}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(this.emoji, 0, 0);
    } else if (this.shape === 'rect') {
      // Confetti: tumbles on two axes — spin via rot, "flip" via height squash.
      const flip = Math.sin(this.age * this.flut + this.phase);
      c.globalAlpha = alpha;
      c.translate(this.x, this.y);
      c.rotate(this.rot);
      c.scale(1, Math.max(0.15, Math.abs(flip)));
      c.fillStyle = flip < 0 ? this.dark : this.color;
      c.fillRect(-this.size / 2, -this.size / 4, this.size, this.size / 2);
    } else if (this.glow) {
      // Additive spark: streak along velocity + gradient-sprite head.
      c.globalCompositeOperation = 'lighter';
      const tw = this.twinkle ? 0.55 + 0.45 * Math.sin(this.age * 26 + this.phase * 4) : 1;
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > 70) {
        const tl = Math.min(20, sp * 0.05);
        c.globalAlpha = alpha * tw * 0.55;
        c.strokeStyle = this.color;
        c.lineWidth = Math.max(1, this.size * 0.35);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(this.x - (this.vx / sp) * tl, this.y - (this.vy / sp) * tl);
        c.lineTo(this.x, this.y);
        c.stroke();
      }
      c.globalAlpha = alpha * tw;
      const s = this.size; // sprite drawn at 2x size: soft halo beyond the core
      c.drawImage(glowSprite(this.color), this.x - s, this.y - s, s * 2, s * 2);
    } else {
      c.globalAlpha = alpha;
      c.translate(this.x, this.y);
      c.fillStyle = this.color;
      c.beginPath();
      c.arc(0, 0, this.size / 2, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }
}

function crackleAt(x, y) {
  spawnParticles({
    x, y, count: 4, speed: 100, g: 260, life: [0.2, 0.45],
    size: [2, 3.5], colors: ['#ffe9a3', '#fff'], twinkle: true,
  });
}

class Chip {
  constructor({ from, to, delay = 0, dur = 0.6, color = '#fbbf24', onArrive }) {
    this.from = from; this.to = to; this.delay = delay; this.dur = dur;
    this.age = 0; this.color = color; this.onArrive = onArrive;
    this.seed = Math.random() * Math.PI * 2;
    this.spinV = 7 + Math.random() * 5;
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
    const raw = (this.age - this.delay) / this.dur;
    const t = EASE.inOutQuad(Math.min(1, raw));
    const mt = 1 - t;
    const x = mt * mt * this.from.cx + 2 * mt * t * this.cpx + t * t * this.to.cx;
    const y = mt * mt * this.from.cy + 2 * mt * t * this.cpy + t * t * this.to.cy;
    const spin = raw * this.spinV + this.seed;
    const tilt = 0.4 + 0.6 * Math.abs(Math.cos(spin)); // coin-flip squash
    c.save();
    c.translate(x, y);
    // soft drop shadow under the chip
    c.globalAlpha = 0.26;
    c.fillStyle = '#000';
    c.beginPath();
    c.ellipse(2.5, 12, 10, 4 * tilt + 1.2, 0, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    // tumbling chip face
    c.rotate(Math.sin(spin * 0.6) * 0.4);
    c.scale(1, tilt);
    c.drawImage(chipSprite(this.color), -12, -12, 24, 24);
    // gold glint sweeping around the rim
    const ga = Math.max(0, Math.sin(spin * 1.4 + this.seed));
    if (ga > 0.15) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = ga * 0.85;
      const gx = Math.cos(spin) * 8.5, gy = Math.sin(spin) * 8.5;
      c.drawImage(glowSprite('#fff3c4'), gx - 6, gy - 6, 12, 12);
    }
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
    // soft cast shadow (few cards on screen, shadowBlur is fine here)
    c.shadowColor = 'rgba(0,0,0,0.45)';
    c.shadowBlur = 14;
    c.shadowOffsetY = 10;
    c.fillStyle = this.back ? '#1e3a8a' : '#fdfdf8';
    c.beginPath();
    c.roundRect(-this.w / 2, -this.h / 2, this.w, this.h, 6);
    c.fill();
    c.shadowColor = 'transparent';
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    c.strokeStyle = 'rgba(0,0,0,0.35)';
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

// Firework shell: streak rises from the bottom, then bursts.
class Rocket {
  constructor(tx, ty, colors) {
    this.tx = tx; this.ty = ty; this.colors = colors;
    this.x0 = tx + (Math.random() - 0.5) * 90;
    this.y0 = innerHeight + 16;
    this.x = this.x0; this.y = this.y0;
    this.px = this.x; this.py = this.y;
    this.dur = 0.42 + Math.random() * 0.16;
    this.age = 0;
  }
  update(dt) {
    this.age += dt;
    const t = Math.min(1, this.age / this.dur);
    const e = EASE.outCubic(t);
    this.px = this.x; this.py = this.y;
    this.x = this.x0 + (this.tx - this.x0) * e + Math.sin(this.age * 20) * 2.5 * (1 - t);
    this.y = this.y0 + (this.ty - this.y0) * e;
    // sputtering trail embers falling behind the shell
    if (Math.random() < 0.65) {
      spawnParticles({
        x: this.x + (Math.random() - 0.5) * 3, y: this.y, count: 1,
        speed: 18, g: 220, life: [0.2, 0.45], size: [1.8, 3.4],
        colors: ['#ffd27a', '#ffedbc'],
      });
    }
    if (t >= 1) { this.dead = true; this.burst(); }
  }
  burst() {
    addFlash(this.x, this.y, this.colors[0], 85, 0.28);
    spawnParticles({
      x: this.x, y: this.y, count: 46, speed: 270, g: 140, drag: 1.3,
      life: [0.6, 1.35], size: [2.5, 5.5], colors: this.colors,
      twinkle: true, crackle: 0.18,
    });
  }
  draw(c) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    // rising streak
    const dx = this.x - this.px, dy = this.y - this.py;
    c.strokeStyle = 'rgba(255,222,140,0.9)';
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(this.x - dx * 2.2, this.y - dy * 2.2);
    c.lineTo(this.x, this.y);
    c.stroke();
    c.drawImage(glowSprite('#ffdf8a'), this.x - 8, this.y - 8, 16, 16);
    c.restore();
  }
}

function spawnParticles(opts) {
  const { x, y, count = 20, speed = 200, spread = Math.PI * 2, baseAngle = -Math.PI / 2,
    g = 500, life = [0.5, 1.2], size = [4, 9], colors, emoji, emojis, drag = 0, shape,
    twinkle = false, crackle = 0, sway = 0 } = opts;
  const room = MAX_PARTICLES - liveParticles;
  if (room <= 0) return;
  const n = Math.min(count, room);
  // Plain colored dots become additive glow sparks; rects and emoji keep their look.
  const glow = !emoji && !emojis && !shape;
  for (let i = 0; i < n; i++) {
    const ang = baseAngle + (Math.random() - 0.5) * spread;
    const v = speed * (0.4 + Math.random() * 0.9);
    add(new Particle({
      x, y,
      vx: Math.cos(ang) * v,
      vy: Math.sin(ang) * v,
      g, drag, shape, glow, twinkle, sway,
      crackle: crackle > 0 && Math.random() < crackle,
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
    // sparkle trail is implied by staggered chips; add a glowing pop at the end
    setTimeout(() => {
      addFlash(to.cx, to.cy, '#ffd75e', 34, 0.3);
      spawnParticles({ x: to.cx, y: to.cy, count: 8, speed: 90, g: 220, size: [2.5, 5], colors: ['#fde047', '#fff'], twinkle: true });
    }, (n * 50 + 550));
  },

  confettiBurst({ x, y, count = 50 }) {
    spawnParticles({ x, y, count, speed: 320, g: 380, drag: 0.55, life: [0.7, 1.6], colors: CONFETTI, shape: 'rect', size: [6, 12] });
  },

  confettiCannons() {
    spawnParticles({ x: 0, y: innerHeight * 0.75, count: 60, speed: 620, spread: 0.7, baseAngle: -Math.PI / 3.2, g: 440, drag: 0.5, life: [1, 2], colors: CONFETTI, shape: 'rect', size: [7, 13] });
    spawnParticles({ x: innerWidth, y: innerHeight * 0.75, count: 60, speed: 620, spread: 0.7, baseAngle: -Math.PI + Math.PI / 3.2, g: 440, drag: 0.5, life: [1, 2], colors: CONFETTI, shape: 'rect', size: [7, 13] });
    addFlash(0, innerHeight * 0.75, '#ffe9a3', 70, 0.3);
    addFlash(innerWidth, innerHeight * 0.75, '#ffe9a3', 70, 0.3);
    screenShake();
  },

  fireworks({ bursts = 5 } = {}) {
    for (let i = 0; i < bursts; i++) {
      setTimeout(() => {
        const x = innerWidth * (0.2 + Math.random() * 0.6);
        const y = innerHeight * (0.15 + Math.random() * 0.35);
        add(new Rocket(x, y, [CONFETTI[i % CONFETTI.length], '#fff', CONFETTI[(i + 2) % CONFETTI.length]]));
      }, i * 300);
    }
  },

  lightning({ x, y }) {
    whiteFlash();
    screenShake();
    const pts = (() => {
      const p = [{ x: x + (Math.random() - 0.5) * 60, y: 0 }];
      let cy = 0;
      while (cy < y) {
        cy += 30 + Math.random() * 45;
        p.push({ x: x + (Math.random() - 0.5) * 70, y: Math.min(cy, y) });
      }
      p[p.length - 1] = { x, y };
      return p;
    })();
    // small side forks branching off the main bolt
    const forks = [];
    for (let i = 1; i < pts.length - 1; i++) {
      if (Math.random() < 0.5) continue;
      const dir = Math.random() < 0.5 ? -1 : 1;
      let fx = pts[i].x, fy = pts[i].y;
      const fork = [{ x: fx, y: fy }];
      for (let s = 0; s < 2 + (Math.random() * 2 | 0); s++) {
        fx += dir * (14 + Math.random() * 26);
        fy += 12 + Math.random() * 26;
        fork.push({ x: fx, y: fy });
      }
      forks.push(fork);
    }
    const trace = (c, path) => {
      c.beginPath();
      path.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.stroke();
    };
    add({
      age: 0, dur: 0.5,
      update(dt) { this.age += dt; if (this.age > this.dur) this.dead = true; },
      draw(c) {
        const t = this.age / this.dur;
        // hot flash first, flickering afterimage as it fades
        const a = t < 0.12 ? 1 : (1 - t) * (0.7 + 0.3 * Math.sin(this.age * 90));
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.lineCap = 'round';
        c.lineJoin = 'round';
        // wide dim glow band
        c.globalAlpha = a * 0.4;
        c.strokeStyle = '#facc15';
        c.lineWidth = 14;
        trace(c, pts);
        // mid halo
        c.globalAlpha = a * 0.85;
        c.strokeStyle = '#fde047';
        c.lineWidth = 5;
        trace(c, pts);
        forks.forEach(f => { c.lineWidth = 2.5; trace(c, f); });
        // white-hot core
        c.globalAlpha = a;
        c.strokeStyle = '#fff';
        c.lineWidth = 2;
        trace(c, pts);
        c.restore();
      },
    });
    addFlash(x, y, '#ffe27a', 95, 0.4);
    spawnParticles({ x, y, count: 30, speed: 300, g: 400, size: [2.5, 6], colors: ['#fde047', '#fff', '#fbbf24'], twinkle: true });
  },

  shockwave({ x, y }) {
    screenShake();
    addFlash(x, y, '#ffd75e', 110, 0.3);
    add({
      age: 0,
      update(dt) { this.age += dt; if (this.age > 0.7) this.dead = true; },
      draw(c) {
        const t = this.age / 0.7;
        const r = 20 + EASE.outCubic(t) * Math.max(innerWidth, innerHeight) * 0.6;
        c.save();
        c.globalCompositeOperation = 'lighter';
        // main golden ring
        c.globalAlpha = 1 - t;
        c.strokeStyle = '#fbbf24';
        c.lineWidth = 9 * (1 - t) + 2;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.stroke();
        // bright leading edge
        c.globalAlpha = (1 - t) * 0.85;
        c.strokeStyle = '#fff';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(x, y, r * 1.03, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      },
    });
    spawnParticles({ x, y, count: 50, speed: 500, g: 300, life: [0.5, 1.1], size: [3, 7], colors: ['#fbbf24', '#f87171', '#fff', '#fb923c'], twinkle: true });
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
    // swirling dust/glow vortex beneath the cards (added first = drawn under)
    add({
      age: 0, dur: 2.3,
      streaks: Array.from({ length: 15 }, () => ({
        a: Math.random() * Math.PI * 2,
        r: 26 + Math.random() * 95,
        s: 3.2 + Math.random() * 4.5,
        w: 1 + Math.random() * 2.2,
        lift: 10 + Math.random() * 55,
      })),
      update(dt) {
        this.age += dt;
        if (this.age > this.dur) { this.dead = true; return; }
        for (const s of this.streaks) { s.a += s.s * dt; s.r += 14 * dt; }
      },
      draw(c) {
        const t = this.age / this.dur;
        const a = Math.sin(Math.min(1, t) * Math.PI); // fade in, fade out
        c.save();
        c.globalCompositeOperation = 'lighter';
        // soft glow pool at the vortex base
        c.globalAlpha = a * 0.5;
        c.drawImage(glowSprite('#7dd3c8', 128), cx - 140, cy - 28, 280, 110);
        // orbiting dust streak arcs (squashed ellipses = perspective)
        c.lineCap = 'round';
        c.strokeStyle = 'rgba(196,244,232,0.85)';
        for (const s of this.streaks) {
          c.globalAlpha = a * 0.45;
          c.lineWidth = s.w;
          c.beginPath();
          c.ellipse(cx, cy + 24 - s.lift * t, s.r, s.r * 0.36, 0, s.a, s.a + 1.15);
          c.stroke();
        }
        c.restore();
      },
    });
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
        life: [0.8, 1.6], size: [2.5, 6], colors: ['#d1fae5', '#fff', '#a7f3d0'], twinkle: true,
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
        emojis: ['🪙', '💰'], size: [18, 30], sway: 60,
      });
    }, 90);
  },

  // Item flies from thrower to target; impact behavior depends on kind.
  throwArc({ from, to, emoji, kind = 'splat', onImpact }) {
    add(new (class {
      constructor() { this.age = 0; this.dur = 0.7; }
      update(dt) {
        this.age += dt;
        // faint sparkle wake behind the flying item
        if (Math.random() < 0.35 && this.age < this.dur) {
          const t = this.age / this.dur;
          const x = from.cx + (to.cx - from.cx) * t;
          const arc = Math.sin(t * Math.PI) * -Math.min(160, Math.abs(to.cx - from.cx) * 0.4 + 60);
          spawnParticles({ x, y: from.cy + (to.cy - from.cy) * t + arc, count: 1, speed: 15, g: 60, life: [0.2, 0.4], size: [2, 4], colors: ['#fff'] });
        }
        if (this.age >= this.dur) {
          this.dead = true;
          if (kind === 'splat') {
            addFlash(to.cx, to.cy, '#ffb0a0', 55, 0.25);
            spawnParticles({ x: to.cx, y: to.cy, count: 26, speed: 240, g: 500, size: [4, 10], colors: emoji === '🎂' ? ['#fbcfe8', '#fde68a', '#fff'] : ['#ef4444', '#b91c1c', '#fca5a5'] });
            screenShake();
          } else if (kind === 'burst') {
            addFlash(to.cx, to.cy, '#ffe9a3', 60, 0.25);
            spawnParticles({ x: to.cx, y: to.cy, count: 45, speed: 300, g: 380, drag: 0.5, life: [0.7, 1.5], colors: CONFETTI, shape: 'rect', size: [6, 11] });
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
        // small moving shadow keeps it grounded
        c.globalAlpha = 0.22;
        c.fillStyle = '#000';
        c.beginPath();
        c.ellipse(x, y + 20 - arc * 0.15, 11, 4, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
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
    setTimeout(() => {
      screenShake();
      addFlash(x, y, '#ff7a6b', 60, 0.3);
      spawnParticles({ x, y: y + 6, count: 14, speed: 180, spread: Math.PI, baseAngle: -Math.PI / 2, g: 420, life: [0.35, 0.7], size: [2.5, 5], colors: ['#f87171', '#7f1d1d', '#fca5a5'] });
    }, 250);
  },

  bubblePop({ x, y }) {
    spawnParticles({ x, y, count: 14, speed: 140, g: 60, life: [0.4, 0.8], size: [3.5, 7], colors: ['#93c5fd', '#dbeafe', '#60a5fa'], twinkle: true });
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
        emojis, size, sway: 60,
      });
    }, 90);
  },

  // Subtle radial gold flash behind the pot for big wins.
  goldFlash({ x, y }) {
    add({
      age: 0, dur: 0.9,
      update(dt) { this.age += dt; if (this.age > this.dur) this.dead = true; },
      draw(c) {
        const t = this.age / this.dur;
        const a = Math.sin(Math.min(1, t) * Math.PI); // swell in, melt away
        const r = 85 + EASE.outCubic(t) * 150;
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = a * 0.65;
        c.drawImage(glowSprite('#f4c14f', 256), x - r, y - r, r * 2, r * 2);
        c.globalAlpha = a * 0.5;
        c.drawImage(glowSprite('#fff2c9', 256), x - r * 0.45, y - r * 0.45, r * 0.9, r * 0.9);
        c.restore();
      },
    });
    spawnParticles({
      x, y, count: 10, speed: 70, baseAngle: -Math.PI / 2, spread: 1.7,
      g: -45, life: [0.6, 1.1], size: [2, 4.5],
      colors: ['#ffe9a3', '#fff', '#fbbf24'], twinkle: true,
    });
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
