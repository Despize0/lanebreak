// Tiny synthesized sound effects (WebAudio). No audio files.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem("lb:muted") === "1";
} catch {}

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem("lb:muted", m ? "1" : "0");
  } catch {}
  if (master) master.gain.value = m ? 0 : 0.5;
}

/** Call from a user gesture (browsers only allow audio after one). */
export function unlockAudio() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
}

const last = new Map<string, number>();
function throttle(name: string, ms: number) {
  const now = performance.now();
  if (now - (last.get(name) ?? 0) < ms) return false;
  last.set(name, now);
  return true;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(dur: number, vol: number, from: number, to: number, delay = 0) {
  if (!ctx || !master) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

export const sfx = {
  select() { tone(660, 0.06, "triangle", 0.12); },
  deploy() { noise(0.35, 0.18, 3000, 300); },
  land() { if (throttle("land", 60)) tone(140, 0.12, "sine", 0.25, 70); },
  hit() { if (throttle("hit", 70)) noise(0.06, 0.12, 2500, 800); },
  shoot() { if (throttle("shoot", 90)) tone(900, 0.07, "triangle", 0.06, 500); },
  zap() { if (throttle("zap", 120)) noise(0.12, 0.12, 8000, 2000); },
  boom() { noise(0.7, 0.45, 1200, 60); tone(90, 0.5, "sine", 0.4, 40); },
  towerDown() { noise(1.1, 0.5, 900, 50); tone(70, 0.9, "sine", 0.45, 35); tone(523, 0.25, "triangle", 0.15, undefined, 0.35); tone(784, 0.4, "triangle", 0.15, undefined, 0.5); },
  error() { tone(200, 0.12, "square", 0.05, 150); },
  start() { tone(523, 0.12, "triangle", 0.15); tone(659, 0.12, "triangle", 0.15, undefined, 0.12); tone(784, 0.25, "triangle", 0.18, undefined, 0.24); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, "triangle", 0.18, undefined, i * 0.13)); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.35, "triangle", 0.15, undefined, i * 0.18)); },
};
