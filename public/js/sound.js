// Synth sound effects via WebAudio — no audio files needed.
let ctx = null;
let muted = localStorage.getItem('hb_muted') === '1';

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  localStorage.setItem('hb_muted', muted ? '1' : '0');
  return muted;
}

function tone({ freq = 440, dur = 0.12, type = 'sine', vol = 0.18, slide = 0, delay = 0 }) {
  if (muted) return;
  try {
    const a = ac();
    const t0 = a.currentTime + delay;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch { /* audio not available */ }
}

function noise({ dur = 0.25, vol = 0.2, delay = 0 }) {
  if (muted) return;
  try {
    const a = ac();
    const t0 = a.currentTime + delay;
    const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = a.createBufferSource();
    src.buffer = buf;
    const gain = a.createGain();
    gain.gain.setValueAtTime(vol, t0);
    src.connect(gain).connect(a.destination);
    src.start(t0);
  } catch { /* audio not available */ }
}

export const sfx = {
  deal: () => { tone({ freq: 620, dur: 0.05, type: 'triangle', vol: 0.1 }); },
  chip: () => { tone({ freq: 900, dur: 0.06, type: 'square', vol: 0.06 }); tone({ freq: 1250, dur: 0.05, type: 'square', vol: 0.05, delay: 0.05 }); },
  yourTurn: () => { tone({ freq: 660, dur: 0.11 }); tone({ freq: 880, dur: 0.14, delay: 0.11 }); },
  fold: () => tone({ freq: 220, dur: 0.16, type: 'sawtooth', vol: 0.08, slide: -80 }),
  check: () => tone({ freq: 500, dur: 0.05, type: 'triangle' }),
  raise: () => { tone({ freq: 520, dur: 0.08 }); tone({ freq: 700, dur: 0.1, delay: 0.07 }); },
  allin: () => { [380, 500, 640, 800].forEach((f, i) => tone({ freq: f, dur: 0.11, delay: i * 0.08, type: 'sawtooth', vol: 0.1 })); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.22, delay: i * 0.11, vol: 0.16 })); },
  bigWin: () => {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, dur: 0.2, delay: i * 0.1, vol: 0.18 }));
    noise({ dur: 0.5, vol: 0.06, delay: 0.2 });
  },
  splat: () => { noise({ dur: 0.18, vol: 0.25 }); tone({ freq: 160, dur: 0.2, type: 'sawtooth', vol: 0.12, slide: -100 }); },
  gift: () => { tone({ freq: 784, dur: 0.09 }); tone({ freq: 988, dur: 0.12, delay: 0.08 }); },
  powerup: () => { tone({ freq: 300, dur: 0.14, type: 'sawtooth', slide: 500, vol: 0.12 }); tone({ freq: 900, dur: 0.12, delay: 0.13 }); },
  explosion: () => { noise({ dur: 0.6, vol: 0.3 }); tone({ freq: 90, dur: 0.5, type: 'sawtooth', vol: 0.2, slide: -50 }); },
  whoosh: () => noise({ dur: 0.3, vol: 0.12 }),
  coin: () => { tone({ freq: 1100, dur: 0.07, type: 'square', vol: 0.06 }); tone({ freq: 1500, dur: 0.09, type: 'square', vol: 0.05, delay: 0.06 }); },
  error: () => tone({ freq: 200, dur: 0.18, type: 'square', vol: 0.07 }),
};
