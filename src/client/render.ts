// The sky-islands renderer: cached scenery, animated clouds, sprites, projectiles, particles,
// damage numbers and screen shake. Reads the sim state; never changes it.

import { CARDS } from "../sim/cards";
import { Rng } from "../sim/rng";
import {
  ARENA_H, ARENA_W, BRIDGES, DEPLOY_TICKS, RIVER_BOTTOM, RIVER_TOP, SPELL_DELAY, canDeployAt, createGame,
  type Entity, type GameState, type PlayerId,
} from "../sim/sim";
import { sfx } from "./audio";
import { spriteFor } from "./spriteCache";
import { SPRITE_HEIGHT, type View } from "./unitSprites";
import { BLUE, RED, cardArt, drawFireball, drawKeep, drawLighthouse, drawRubble, drawUnit, type Team } from "./sprites";

export interface Mark { card: string; x: number; y: number; t: number }
export interface UiState {
  me: PlayerId;
  alpha: number; // interpolation between previous and current tick
  prevPos: Map<number, { x: number; y: number }>;
  selected: string | null;
  ghost: { x: number; y: number } | null;
  canAfford: boolean;
  marks: Mark[];
}

const canvas = document.getElementById("arena") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
let scale = 1; // device px per world unit
let dpr = 1;
let me: PlayerId = 0;
const VIS = 1.3; // sprite size relative to the unit's collision radius

const flip = () => me === 1;
const SX = (x: number) => x * scale;
const SY = (y: number) => (flip() ? ARENA_H - y : y) * scale;
const L = (l: number) => l * scale;
const teamOf = (owner: number): Team => (owner === me ? BLUE : RED);

export function setPerspective(p: PlayerId) {
  me = p;
}

export function resize(stage: HTMLElement) {
  const r = stage.getBoundingClientRect();
  const s = Math.min(r.width / ARENA_W, r.height / ARENA_H);
  const w = Math.max(1, Math.floor(ARENA_W * s));
  const h = Math.max(1, Math.floor(ARENA_H * s));
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  scale = (w * dpr) / ARENA_W;
  bgKey = "";
}

/** Screen point → snapped world tile center, or null outside the arena. */
export function toWorld(clientX: number, clientY: number) {
  const r = canvas.getBoundingClientRect();
  const x = ((clientX - r.left) / r.width) * ARENA_W;
  let y = ((clientY - r.top) / r.height) * ARENA_H;
  if (x < 0 || y < 0 || x > ARENA_W || y > ARENA_H) return null;
  if (flip()) y = ARENA_H - y;
  return { x: Math.min(17, Math.floor(x / 1000)) * 1000 + 500, y: Math.min(31, Math.floor(y / 1000)) * 1000 + 500 };
}

// ------------------------------------------------------------------ scenery (cached)
let bgKey = "";
const bgBase = document.createElement("canvas");
const bgTop = document.createElement("canvas");
const vignette = document.createElement("canvas");
const GRASS = "#6fbf4e";
const GRASS_DARK = "#5aa63e";
const PATH = "#bdb8ac"; // cobblestone
const PATH_EDGE = "#8f8470";

const edgeTop = (x: number) => RIVER_TOP + 90 * Math.sin(x * 0.0019 + 0.7) + 60 * Math.sin(x * 0.0053 + 2.1);
const edgeBottom = (x: number) => RIVER_BOTTOM + 80 * Math.sin(x * 0.0023 + 1.9) + 50 * Math.sin(x * 0.0061);

function buildScenery() {
  const w = canvas.width;
  const h = canvas.height;
  for (const cv of [bgBase, bgTop]) {
    cv.width = w;
    cv.height = h;
  }
  const c = bgBase.getContext("2d")!;
  const Y = (y: number) => y * scale; // scenery is always drawn from the bottom player's point of view
  // sky
  const sky = c.createLinearGradient(0, Y(RIVER_TOP - 500), 0, Y(RIVER_BOTTOM + 500));
  sky.addColorStop(0, "#7ec6ff");
  sky.addColorStop(0.5, "#cdeaff");
  sky.addColorStop(1, "#8fd0ff");
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);

  // --- top island (always the rival's): grass + hanging cliff underside
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(w, 0);
  for (let x = ARENA_W; x >= 0; x -= 200) c.lineTo(SX(x), Y(edgeTop(x)));
  c.closePath();
  c.fillStyle = GRASS;
  c.fill();
  // cliff face + stalactite rocks beneath the top island
  const rng = new Rng(42);
  c.beginPath();
  for (let x = 0; x <= ARENA_W; x += 200) c.lineTo(SX(x), Y(edgeTop(x)));
  for (let x = ARENA_W; x >= 0; x -= 300) c.lineTo(SX(x), Y(edgeTop(x) + 520 + (rng.int(5) - 2) * 50));
  c.closePath();
  const cliff = c.createLinearGradient(0, Y(RIVER_TOP), 0, Y(RIVER_TOP + 600));
  cliff.addColorStop(0, "#a17d5a");
  cliff.addColorStop(1, "#6b4f3a");
  c.fillStyle = cliff;
  c.fill();
  c.fillStyle = "#5b4232";
  for (let x = 300; x < ARENA_W; x += 900 + rng.int(500)) {
    const len = 350 + rng.int(500);
    const half = 220 + rng.int(160);
    const top = edgeTop(x) + 480;
    c.beginPath();
    c.moveTo(SX(x - half), Y(top));
    c.lineTo(SX(x + half), Y(top));
    c.lineTo(SX(x + 40), Y(top + len));
    c.closePath();
    c.fill();
  }
  // strata + roots
  c.strokeStyle = "rgba(60,40,28,.45)";
  c.lineWidth = Math.max(1, L(35));
  for (const off of [180, 360]) {
    c.beginPath();
    for (let x = 0; x <= ARENA_W; x += 200) c.lineTo(SX(x), Y(edgeTop(x) + off + 30 * Math.sin(x * 0.004)));
    c.stroke();
  }
  c.strokeStyle = "#4f7d36";
  c.lineWidth = Math.max(1, L(40));
  for (let x = 500; x < ARENA_W; x += 700 + rng.int(600)) {
    c.beginPath();
    c.moveTo(SX(x), Y(edgeTop(x)));
    c.quadraticCurveTo(SX(x + 120), Y(edgeTop(x) + 300), SX(x - 40), Y(edgeTop(x) + 450 + rng.int(300)));
    c.stroke();
  }

  // --- bottom island (always yours)
  c.beginPath();
  for (let x = 0; x <= ARENA_W; x += 200) c.lineTo(SX(x), Y(edgeBottom(x)));
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.closePath();
  c.fillStyle = GRASS;
  c.fill();
  // sunny lip along the edge
  c.strokeStyle = "#a6e07e";
  c.lineWidth = Math.max(2, L(110));
  c.beginPath();
  for (let x = 0; x <= ARENA_W; x += 200) c.lineTo(SX(x), Y(edgeBottom(x) + 60));
  c.stroke();

  // painterly grass: soft light and dark patches so the field isn't flat
  const patch = new Rng(31);
  for (let i = 0; i < 70; i++) {
    const x = patch.int(ARENA_W);
    const y = patch.int(ARENA_H);
    if (y > RIVER_TOP - 300 && y < RIVER_BOTTOM + 300) continue;
    const rr = L(900 + patch.int(1800));
    const g = c.createRadialGradient(SX(x), Y(y), 0, SX(x), Y(y), rr);
    const light = patch.int(2) === 0;
    g.addColorStop(0, light ? "rgba(190,240,120,.16)" : "rgba(30,80,30,.14)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(SX(x) - rr, Y(y) - rr, rr * 2, rr * 2);
  }

  // subtle tile checker for placement readability
  c.fillStyle = "rgba(40,90,30,.06)";
  for (let ty = 0; ty < 32; ty++) {
    if (ty === 15 || ty === 16) continue;
    for (let tx = (ty % 2); tx < 18; tx += 2) c.fillRect(SX(tx * 1000), Y(ty * 1000), Math.ceil(L(1000)), Math.ceil(L(1000)));
  }

  // cobblestone paths: bridge → side tower → king, on both islands.
  // Drawn as a mask on a scratch canvas, then stones are painted inside the mask.
  const paths = document.createElement("canvas");
  paths.width = w;
  paths.height = h;
  const pc = paths.getContext("2d")!;
  pc.lineCap = "round";
  pc.lineJoin = "round";
  const shapes = (ctx2: CanvasRenderingContext2D, grow: number, color: string) => {
    ctx2.strokeStyle = color;
    ctx2.fillStyle = color;
    for (const flipY of [false, true]) {
      const m = (y: number) => (flipY ? ARENA_H - y : y);
      for (const bx of BRIDGES) {
        ctx2.lineWidth = L(1300 + grow);
        ctx2.beginPath();
        [[bx, m(RIVER_BOTTOM + 100)], [bx, m(25500)], [9000, m(29500)]].forEach(([x, y], i) =>
          i ? ctx2.lineTo(SX(x), Y(y)) : ctx2.moveTo(SX(x), Y(y)));
        ctx2.stroke();
      }
      for (const [x, y, r] of [[3500, 25500, 1900], [14500, 25500, 1900], [9000, 29500, 2300]]) {
        ctx2.beginPath();
        ctx2.ellipse(SX(x), Y(m(y)), L(r + grow / 2), L(r * 0.8 + grow / 2), 0, 0, Math.PI * 2);
        ctx2.fill();
      }
    }
  };
  c.lineCap = "round";
  c.lineJoin = "round";
  shapes(c, 220, "rgba(60,50,35,.45)"); // soft dark edge
  shapes(pc, 0, PATH);
  pc.globalCompositeOperation = "source-atop";
  const cob = new Rng(57);
  const step = 360;
  for (let y = 0; y < ARENA_H; y += step) {
    for (let x = (y / step) % 2 ? step / 2 : 0; x < ARENA_W; x += step) {
      const jx = x + cob.int(90) - 45;
      const jy = y + cob.int(90) - 45;
      const rx = L(150 + cob.int(40));
      const ry = L(120 + cob.int(30));
      const tone = 0.85 + cob.int(30) / 100;
      pc.beginPath();
      pc.ellipse(SX(jx), Y(jy), rx, ry, 0, 0, Math.PI * 2);
      const g = pc.createLinearGradient(0, Y(jy) - ry, 0, Y(jy) + ry);
      g.addColorStop(0, `rgba(${Math.round(214 * tone)},${Math.round(210 * tone)},${Math.round(200 * tone)},1)`);
      g.addColorStop(1, `rgba(${Math.round(150 * tone)},${Math.round(146 * tone)},${Math.round(138 * tone)},1)`);
      pc.fillStyle = g;
      pc.fill();
      pc.strokeStyle = "rgba(80,68,52,.45)";
      pc.lineWidth = Math.max(0.6, L(25));
      pc.stroke();
    }
  }
  c.drawImage(paths, 0, 0);

  // decorations: grass tufts, flowers, pebbles, bushes (kept off paths and the gap)
  const deco = new Rng(7);
  const clear = (x: number, y: number) => {
    if (y > RIVER_TOP - 700 && y < RIVER_BOTTOM + 500) return false;
    for (const bx of BRIDGES) if (Math.abs(x - bx) < 1100) return false;
    for (const [tx, ty] of [[3500, 25500], [14500, 25500], [9000, 29500], [3500, 6500], [14500, 6500], [9000, 2500]]) {
      if ((x - tx) ** 2 + (y - ty) ** 2 < 2600 ** 2) return false;
    }
    return true;
  };
  for (let i = 0; i < 700; i++) {
    const x = deco.int(ARENA_W);
    const y = deco.int(ARENA_H);
    if (!clear(x, y)) continue;
    c.strokeStyle = deco.int(2) ? GRASS_DARK : "#93d46f";
    c.lineWidth = Math.max(1, L(45));
    c.beginPath();
    c.moveTo(SX(x - 60), Y(y));
    c.lineTo(SX(x - 90), Y(y - 160));
    c.moveTo(SX(x), Y(y));
    c.lineTo(SX(x + 10), Y(y - 210));
    c.moveTo(SX(x + 60), Y(y));
    c.lineTo(SX(x + 100), Y(y - 150));
    c.stroke();
  }
  const petals = ["#fff4f8", "#ffd65c", "#ff9bd2", "#b9a7ff"];
  for (let i = 0; i < 160; i++) {
    const x = deco.int(ARENA_W);
    const y = deco.int(ARENA_H);
    if (!clear(x, y)) continue;
    c.fillStyle = petals[deco.int(petals.length)];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      c.beginPath();
      c.arc(SX(x + Math.cos(a) * 70), Y(y + Math.sin(a) * 70), Math.max(1, L(55)), 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "#ffb43a";
    c.beginPath();
    c.arc(SX(x), Y(y), Math.max(1, L(40)), 0, Math.PI * 2);
    c.fill();
  }
  for (let i = 0; i < 26; i++) {
    const x = deco.int(2) ? deco.int(700) + 150 : ARENA_W - 150 - deco.int(700);
    const y = deco.int(ARENA_H);
    if (y > RIVER_TOP - 900 && y < RIVER_BOTTOM + 700) continue;
    for (const [dx, dy, rr, col] of [[-180, 40, 300, "#4f9a3d"], [160, 60, 260, "#4f9a3d"], [0, -60, 340, "#5fb048"], [-60, -120, 160, "#7ccf5c"]] as const) {
      c.beginPath();
      c.arc(SX(x + dx), Y(y + dy), L(rr), 0, Math.PI * 2);
      c.fillStyle = col;
      c.fill();
    }
  }

  // --- rope bridges (separate layer so clouds drift under them)
  const b = bgTop.getContext("2d")!;
  b.lineCap = "round";
  for (const bx of BRIDGES) {
    const y0 = RIVER_TOP - 250;
    const y1 = RIVER_BOTTOM + 250;
    // shadow on the clouds
    b.fillStyle = "rgba(40,70,110,.18)";
    b.fillRect(SX(bx - 900), Y(y0 + 200), L(1900), L(y1 - y0));
    for (let y = y0, i = 0; y < y1; y += 290, i++) {
      b.fillStyle = i % 2 ? "#b77d45" : "#c98f55";
      b.fillRect(SX(bx - 950), Y(y), L(1900), L(220));
      b.fillStyle = "rgba(60,35,15,.35)";
      b.fillRect(SX(bx - 950), Y(y + 180), L(1900), L(40));
    }
    b.strokeStyle = "#6b4523";
    b.lineWidth = Math.max(1.5, L(80));
    for (const side of [-1, 1]) {
      b.beginPath();
      b.moveTo(SX(bx + side * 960), Y(y0));
      b.quadraticCurveTo(SX(bx + side * 1080), Y((y0 + y1) / 2), SX(bx + side * 960), Y(y1));
      b.stroke();
      for (const py of [y0, y1]) {
        b.fillStyle = "#7a4f28";
        b.beginPath();
        b.arc(SX(bx + side * 1000), Y(py), Math.max(2, L(150)), 0, Math.PI * 2);
        b.fill();
        b.strokeStyle = "#4a2f17";
        b.lineWidth = Math.max(1, L(40));
        b.stroke();
        b.strokeStyle = "#6b4523";
        b.lineWidth = Math.max(1.5, L(80));
      }
    }
  }
  // warm light from the top and soft dark corners, like the painted art
  vignette.width = w;
  vignette.height = h;
  const v = vignette.getContext("2d")!;
  const vg = v.createRadialGradient(w * 0.45, h * 0.42, Math.min(w, h) * 0.35, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(12,18,40,.32)");
  v.fillStyle = vg;
  v.fillRect(0, 0, w, h);
  const warm = v.createLinearGradient(0, 0, w, h);
  warm.addColorStop(0, "rgba(255,230,170,.10)");
  warm.addColorStop(0.5, "rgba(255,230,170,0)");
  v.fillStyle = warm;
  v.fillRect(0, 0, w, h);
  bgKey = `${w}x${h}`;
}

// clouds drifting through the gap
interface Cloud { x: number; y: number; s: number; v: number }
const clouds: Cloud[] = [];
{
  const r = new Rng(99);
  for (let i = 0; i < 9; i++) {
    clouds.push({ x: r.int(ARENA_W + 4000) - 2000, y: RIVER_TOP + 200 + r.int(1700), s: 0.6 + r.int(60) / 100, v: 120 + r.int(260) });
  }
}
function drawClouds(dt: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, (RIVER_TOP - 200) * scale, canvas.width, (RIVER_BOTTOM - RIVER_TOP + 600) * scale);
  ctx.clip();
  for (const cl of clouds) {
    cl.x += cl.v * dt;
    if (cl.x > ARENA_W + 2500) cl.x = -2500;
    const x = cl.x * scale;
    const y = cl.y * scale;
    const s = cl.s * scale;
    ctx.fillStyle = "rgba(255,255,255,.88)";
    for (const [dx, dy, rr] of [[-900, 120, 520], [-300, -120, 700], [400, 40, 600], [950, 160, 420]]) {
      ctx.beginPath();
      ctx.arc(x + dx * s, y + dy * s, rr * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(190,215,240,.55)";
    ctx.fillRect(x - 1100 * s, y + 230 * s, 2300 * s, 160 * s);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ effects
interface Projectile { kind: "arrow" | "orb" | "bolt" | "spit" | "bigorb" | "bomb" | "ball" | "mote"; from: number; to: number; x1: number; y1: number; x2: number; y2: number; t0: number; dur: number; team: Team; splash?: number }
interface Particle { x: number; y: number; vx: number; vy: number; g: number; life: number; max: number; size: number; color: string; shrink: boolean }
interface Floater { id: number; x: number; y: number; amount: number; t0: number; color: string }
interface Decal { x: number; y: number; r: number; t0: number }
interface Bolt { pts: number[]; t0: number; big?: boolean }
interface Ring { x: number; y: number; r: number; t0: number; dur: number; color: string }

let projectiles: Projectile[] = [];
let particles: Particle[] = [];
let floaters: Floater[] = [];
let decals: Decal[] = [];
let bolts: Bolt[] = [];
let rings: Ring[] = [];
let banner: { text: string; color: string; t0: number } | null = null;
let shakeUntil = 0;
let flashUntil = 0;
let shakeAmp = 0;
const lastAttack = new Map<number, { t: number; x: number; y: number }>();
const facing = new Map<number, 1 | -1>();
const viewDir = new Map<number, View>();
const hitAt = new Map<number, number>();
let prevHp = new Map<number, number>();
let deploying = new Set<number>();
const fxRand = new Rng(12345); // visual-only randomness, kept out of the sim

const rnd = () => fxRand.nextU32() / 4294967296;

function burst(x: number, y: number, n: number, colors: string[], speed: number, size: number, life = 0.6, g = 300) {
  for (let i = 0; i < n && particles.length < 600; i++) {
    const a = rnd() * Math.PI * 2;
    const sp = speed * (0.4 + rnd() * 0.8);
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - speed * 0.3, g: g * dpr,
      life: life * (0.6 + rnd() * 0.6), max: life, size: size * (0.6 + rnd() * 0.8), color: colors[i % colors.length], shrink: true,
    });
  }
}
function shake(amp: number, ms: number) {
  shakeAmp = Math.max(shakeAmp, amp * dpr);
  shakeUntil = Math.max(shakeUntil, performance.now() + ms);
}

/** Reset effect baselines (new match, rejoin, resync) without spawning anything. */
export function resetFx(game: GameState) {
  projectiles = [];
  particles = [];
  floaters = [];
  decals = [];
  bolts = [];
  rings = [];
  banner = null;
  lastAttack.clear();
  facing.clear();
  viewDir.clear();
  hitAt.clear();
  prevHp = new Map(game.entities.map((e) => [e.id, e.hp]));
  deploying = new Set(game.entities.filter((e) => e.deployTicks > 0).map((e) => e.id));
}

/** Call after every sim step: turns the step's events into visuals and sounds. */
let silent = false;
const snd = (f: () => void) => {
  if (!silent) f();
};

export function observe(game: GameState, now: number, quiet = false) {
  silent = quiet;
  const byId = new Map(game.entities.map((e) => [e.id, e]));
  for (const ev of game.events) {
    switch (ev.type) {
      case "deploy":
        snd(sfx.deploy);
        break;
      case "attack": {
        const a = byId.get(ev.from);
        const card = a?.card ?? "";
        const team = teamOf(ev.owner);
        lastAttack.set(ev.from, { t: now, x: ev.x2, y: ev.y2 });
        const KINDS: Record<string, Projectile["kind"]> = {
          princess: "orb", king: "bigorb", ranger: "arrow", twinrangers: "arrow", bulwark: "bolt", skywing: "spit",
          bombardier: "bomb", cannon: "ball", wisps: "mote",
        };
        const kind: Projectile["kind"] | null = KINDS[card] ?? null;
        if (card === "sparkcaster") {
          bolts.push({ pts: jag(ev.x1, ev.y1 - 900, ev.x2, ev.y2), t0: now });
          rings.push({ x: ev.x2, y: ev.y2, r: ev.splash, t0: now, dur: 300, color: "rgba(150,235,255," });
          snd(sfx.zap);
        } else if (kind) {
          const dist = Math.hypot(ev.x2 - ev.x1, ev.y2 - ev.y1);
          const dur = kind === "bomb" ? 420 : Math.min(320, 80 + dist / 30);
          projectiles.push({ kind, from: ev.from, to: ev.to, x1: ev.x1, y1: ev.y1, x2: ev.x2, y2: ev.y2, t0: now, dur, team, splash: ev.splash });
          snd(sfx.shoot);
        } else {
          burst(SX(ev.x2), SY(ev.y2) - L(500), 5, ["#fff6d6", "#ffd27a"], 220 * dpr, 3 * dpr, 0.25, 0);
          snd(sfx.hit);
        }
        break;
      }
      case "spell":
        if (ev.card === "zap") {
          bolts.push({ pts: jag(ev.x - 300, ev.y - 9000, ev.x, ev.y), t0: now, big: true });
          bolts.push({ pts: jag(ev.x + 400, ev.y - 7000, ev.x, ev.y), t0: now + 40, big: true });
          rings.push({ x: ev.x, y: ev.y, r: ev.r, t0: now, dur: 380, color: "rgba(170,240,255," });
          burst(SX(ev.x), SY(ev.y), 22, ["#e9fbff", "#9fe8ff", "#ffffff"], 420 * dpr, 4 * dpr, 0.45, 200);
          flashUntil = now + 90;
          shake(4, 160);
          snd(sfx.zap);
          break;
        }
        rings.push({ x: ev.x, y: ev.y, r: ev.r, t0: now, dur: 450, color: "rgba(255,170,60," });
        decals.push({ x: ev.x, y: ev.y, r: ev.r * 0.7, t0: now });
        burst(SX(ev.x), SY(ev.y), 34, ["#ffd23f", "#ff8a1f", "#ff5a1f", "#fff2b0"], 520 * dpr, 6 * dpr, 0.7, 500);
        shake(6, 260);
        snd(sfx.boom);
        break;
      case "death":
        if (ev.kind === "tower") {
          burst(SX(ev.x), SY(ev.y) - L(800), 50, ["#d8d1c2", "#a69f92", "#8b8577", "#fff"], 600 * dpr, 7 * dpr, 1.1, 700);
          shake(12, 520);
          snd(sfx.towerDown);
        } else if (ev.kind !== "spell") {
          burst(SX(ev.x), SY(ev.y) - L(300), 12, ["#ffffff", "#e6ecff", teamOf(ev.owner).light], 260 * dpr, 5 * dpr, 0.55, -80);
        }
        break;
      case "crown":
        banner = ev.owner === me ? { text: "Crown!", color: "#ffc94a", t0: now } : { text: "Tower lost", color: "#ff8f86", t0: now };
        break;
    }
  }
  // damage numbers from HP changes (merged per unit so fights stay readable)
  const nextHp = new Map<number, number>();
  for (const e of game.entities) {
    nextHp.set(e.id, e.hp);
    const before = prevHp.get(e.id);
    if (before === undefined || e.hp >= before) continue;
    const dmg = before - e.hp;
    if (e.kind === "building" && dmg < 5) continue; // ignore decay
    hitAt.set(e.id, now);
    const f = floaters.find((x) => x.id === e.id && now - x.t0 < 260);
    if (f) {
      f.amount += dmg;
      f.t0 = now;
    } else if (floaters.length < 60) {
      floaters.push({ id: e.id, x: e.x, y: e.y, amount: dmg, t0: now, color: e.kind === "tower" ? "#ffe08a" : "#ffffff" });
    }
  }
  prevHp = nextHp;
  // landings
  const nowDeploying = new Set<number>();
  for (const e of game.entities) {
    if (e.kind === "spell") continue;
    if (e.deployTicks > 0) nowDeploying.add(e.id);
    else if (deploying.has(e.id)) {
      burst(SX(e.x), SY(e.y), 8, ["#f1e3c4", "#e2d0a6"], 160 * dpr, 4 * dpr, 0.4, 0);
      rings.push({ x: e.x, y: e.y, r: e.radius * 1.6, t0: now, dur: 300, color: "rgba(255,255,255," });
      snd(sfx.land);
    }
  }
  deploying = nowDeploying;
  if (lastAttack.size > 400) lastAttack.clear();
}

function jag(x1: number, y1: number, x2: number, y2: number): number[] {
  const pts = [x1, y1];
  const n = 6;
  for (let i = 1; i < n; i++) {
    const k = i / n;
    pts.push(x1 + (x2 - x1) * k + (rnd() - 0.5) * 700, y1 + (y2 - y1) * k + (rnd() - 0.5) * 700);
  }
  pts.push(x2, y2);
  return pts;
}

// ------------------------------------------------------------------ frame
let lastFrame = performance.now();
const initialTowers = createGame(0).entities.filter((e) => e.kind === "tower").map((e) => ({ owner: e.owner, lane: e.lane, x: e.x, y: e.y, radius: e.radius }));

export function draw(game: GameState, ui: UiState, now: number) {
  if (bgKey !== `${canvas.width}x${canvas.height}`) buildScenery();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const t = now / 1000;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (now < shakeUntil) {
    const k = (shakeUntil - now) / 500;
    ctx.translate(Math.sin(now * 0.09) * shakeAmp * k, Math.cos(now * 0.11) * shakeAmp * k);
  } else shakeAmp = 0;

  ctx.drawImage(bgBase, 0, 0);
  drawClouds(dt);
  ctx.drawImage(bgTop, 0, 0);

  // scorch marks
  decals = decals.filter((d) => now - d.t0 < 5000);
  for (const d of decals) {
    const a = 0.2 * (1 - (now - d.t0) / 5000);
    ctx.fillStyle = `rgba(40,25,15,${a})`;
    ctx.beginPath();
    ctx.ellipse(SX(d.x), SY(d.y), L(d.r), L(d.r * 0.7), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (ui.selected) drawZones(game, ui.selected);

  // rubble where towers fell
  for (const tw of initialTowers) {
    const alive = game.entities.some((e) => e.kind === "tower" && e.owner === tw.owner && e.lane === tw.lane);
    if (!alive) drawRubble(ctx, SX(tw.x), SY(tw.y), L(tw.radius) * 0.9);
  }

  // painter's order: things lower on screen are drawn later
  const pos = (e: Entity) => {
    const p = ui.prevPos.get(e.id);
    if (!p || e.kind !== "troop") return { x: e.x, y: e.y };
    return { x: p.x + (e.x - p.x) * ui.alpha, y: p.y + (e.y - p.y) * ui.alpha };
  };
  const ground: { sy: number; e: Entity; x: number; y: number }[] = [];
  const air: typeof ground = [];
  for (const e of game.entities) {
    if (e.kind === "spell") continue;
    const p = pos(e);
    (e.flying ? air : ground).push({ sy: SY(p.y), e, x: p.x, y: p.y });
  }
  ground.sort((a, b) => a.sy - b.sy || a.e.id - b.e.id);
  air.sort((a, b) => a.sy - b.sy || a.e.id - b.e.id);
  // shadows first so nothing stands in another's shadow
  for (const d of [...ground, ...air]) drawShadow(d.e, d.x, d.y);
  for (const d of ground) drawEntity(d.e, d.x, d.y, ui, now, t);
  for (const d of air) drawEntity(d.e, d.x, d.y, ui, now, t);
  for (const e of game.entities) if (e.kind === "spell") drawMeteor(e, ui.alpha, t);

  drawProjectiles(game, now);
  drawBolts(now);
  drawRings(now);
  drawParticles(dt);
  ctx.drawImage(vignette, 0, 0);
  drawFloaters(now);
  drawMarks(ui, now);
  if (ui.selected && ui.ghost) drawGhost(game, ui);
  drawBanner(now);
}

function drawShadow(e: Entity, x: number, y: number) {
  if (e.kind === "tower") return;
  const r = L(e.radius) * VIS;
  const lift = e.deployTicks > 0 && e.kind !== "spell" ? (e.deployTicks / DEPLOY_TICKS) : 0;
  const k = 1 - lift * 0.6;
  ctx.fillStyle = `rgba(20,40,20,${0.28 * k})`;
  ctx.beginPath();
  ctx.ellipse(SX(x), SY(y), r * 0.9 * k, r * 0.4 * k, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawEntity(e: Entity, x: number, y: number, ui: UiState, now: number, t: number) {
  const team = teamOf(e.owner);
  const px = SX(x);
  let py = SY(y);
  if (e.kind === "tower") {
    const r = L(e.radius);
    if (e.card === "king") drawKeep(ctx, px, py, r, team, e.active, t);
    else drawLighthouse(ctx, px, py, r, team, e.active, t);
    // keep the bar on screen for the rival's king at the very top edge
    const top = Math.max(py - r * (e.card === "king" ? 2.05 : 2.45), 16 * dpr);
    towerBar(px, top, r * 1.25, e.hp, e.maxHp, team);
    return;
  }
  const r = L(e.radius) * VIS; // sprites are drawn a bit larger than their collision circle
  // facing from movement, otherwise toward the target
  const p = ui.prevPos.get(e.id);
  const dx = p ? e.x - p.x : 0;
  const moving = !!p && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) > 2;
  let face = facing.get(e.id) ?? (e.x < 9000 ? 1 : -1);
  if (Math.abs(dx) > 3) face = dx > 0 ? 1 : -1;
  const la = lastAttack.get(e.id);
  const atk = la ? Math.min(1, (now - la.t) / 450) : 1;
  if (la && atk < 1 && Math.abs(la.x - e.x) > 200) face = la.x > e.x ? 1 : -1;
  facing.set(e.id, face as 1 | -1);
  // melee lunge toward the target
  let lx = 0;
  let ly = 0;
  if (la && atk < 0.35 && (e.range ?? 0) < 1500) {
    const k = Math.sin((atk / 0.35) * Math.PI) * r * 0.3;
    const d = Math.hypot(SX(la.x) - px, SY(la.y) - py) || 1;
    lx = ((SX(la.x) - px) / d) * k;
    ly = ((SY(la.y) - py) / d) * k;
  }
  let lift = 0;
  if (e.flying) lift += r * 1.7 + Math.sin(t * 2 + e.id) * r * 0.12;
  if (e.deployTicks > 0) {
    const k = e.deployTicks / DEPLOY_TICKS;
    lift += k * k * canvas.height * 0.22;
  }
  // which way the painted sprite looks: back when heading up the screen, front when heading down
  const flipSign = flip() ? -1 : 1;
  let dir = viewDir.get(e.id) ?? (e.owner === me ? "back" : "front");
  const pick = (sdx: number, sdy: number) => {
    if (Math.abs(sdy) >= Math.abs(sdx) * 0.7) dir = sdy < 0 ? "back" : "front";
    else dir = "side";
  };
  if (la && atk < 1 && Math.hypot(la.x - e.x, la.y - e.y) > 150) pick(la.x - e.x, (la.y - e.y) * flipSign);
  else if (moving && p) pick(e.x - p.x, (e.y - p.y) * flipSign);
  viewDir.set(e.id, dir);
  const groundY = py;
  py -= lift;
  const frame = spriteFor(e.card, dir, face as 1 | -1, team);
  if (!frame) {
    // no painted sprite for this unit: fall back to the code-drawn character
    ctx.globalAlpha = e.deployTicks > 0 ? 0.9 : 1;
    drawUnit(ctx, e.card, px + lx, py + ly, r, {
      t, id: e.id, moving, face: face as 1 | -1, atk, hp: e.hp / e.maxHp, team,
    });
    ctx.globalAlpha = 1;
    if (e.deployTicks === 0 && e.hp < e.maxHp) {
      const top = py - r * (BAR_AT[e.card] ?? (e.flying ? 1.6 : 2.65));
      unitBar(px, top, Math.max(r * 1.6, 20 * dpr), e.hp / e.maxHp, team);
    }
    return;
  }
  // team ring on the ground
  ctx.strokeStyle = team.main;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = Math.max(1.5, 2 * dpr);
  ctx.beginPath();
  ctx.ellipse(px, groundY, r * 0.8, r * 0.32, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const cv = frame.canvas;
  const h = r * (SPRITE_HEIGHT[e.card] ?? 2.6);
  const k = h / (cv.height - frame.pad * 2);
  const w = cv.width * k;
  const fullH = cv.height * k;
  const walk = moving && !e.flying ? p_walk(t, e.id) : 0;
  const bob = -Math.abs(walk) * r * 0.12;
  const tilt = moving ? walk * 0.06 : e.flying ? Math.sin(t * 2.5 + e.id) * 0.05 : 0;
  const squash = atk < 0.25 ? Math.sin((atk / 0.25) * Math.PI) : 0;
  const sxk = 1 + squash * 0.08;
  const syk = 1 - squash * 0.07;
  ctx.save();
  ctx.translate(px + lx, py + ly + bob + frame.pad * k);
  ctx.rotate(tilt);
  ctx.scale(frame.flip ? -sxk : sxk, syk);
  ctx.globalAlpha = e.deployTicks > 0 ? 0.92 : 1;
  ctx.drawImage(cv, -w / 2, -fullH, w, fullH);
  const hit = hitAt.get(e.id);
  if (hit !== undefined && now - hit < 90) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.45 * (1 - (now - hit) / 90);
    ctx.drawImage(cv, -w / 2, -fullH, w, fullH);
  }
  ctx.restore();
  if (e.deployTicks === 0 && e.hp < e.maxHp) {
    unitBar(px, py + ly + bob - h - 6 * dpr, Math.max(r * 1.5, 20 * dpr), e.hp / e.maxHp, team);
  }
}

const p_walk = (t: number, id: number) => Math.sin(t * 10 + id * 1.7);

/** where the health bar sits above each sprite, in body radii */
const BAR_AT: Record<string, number> = {
  ironhide: 2.15, colossus: 2.3, bulwark: 2.2, cannon: 1.4, swarmlings: 2.2, wisps: 2.2, skywing: 1.6, skyrider: 3.0,
};

function unitBar(cx: number, top: number, w: number, frac: number, team: Team) {
  const h = Math.max(3, 4 * dpr);
  ctx.fillStyle = "rgba(20,26,51,.8)";
  roundRect(cx - w / 2 - 1, top - 1, w + 2, h + 2, h);
  ctx.fillStyle = team.main;
  roundRect(cx - w / 2, top, w * Math.max(0, frac), h, h / 2);
}

function towerBar(cx: number, top: number, w: number, hp: number, max: number, team: Team) {
  const h = Math.max(5, 7 * dpr);
  ctx.fillStyle = "rgba(20,26,51,.85)";
  roundRect(cx - w / 2 - 2, top - 2, w + 4, h + 4, h);
  ctx.fillStyle = team.main;
  roundRect(cx - w / 2, top, w * Math.max(0, hp / max), h, h / 2);
  const fs = Math.max(9, 11 * dpr);
  ctx.font = `800 ${fs}px "Baloo 2", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = Math.max(2, 3 * dpr);
  ctx.strokeStyle = "rgba(20,26,51,.9)";
  ctx.strokeText(String(hp), cx, top - 2);
  ctx.fillStyle = "#fff";
  ctx.fillText(String(hp), cx, top - 2);
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  if (w <= 0) return;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  ctx.fill();
}

function drawMeteor(e: Entity, alpha: number, t: number) {
  if (e.card === "zap") {
    ctx.save();
    ctx.strokeStyle = "rgba(170,240,255,.8)";
    ctx.setLineDash([L(160), L(140)]);
    ctx.lineWidth = Math.max(1.5, L(80));
    ctx.beginPath();
    ctx.ellipse(SX(e.x), SY(e.y), L(e.spellRadius), L(e.spellRadius) * 0.75, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // falls from the sky over the spell delay, lands exactly when it explodes
  const left = Math.max(0, e.deployTicks - alpha);
  const k = left / SPELL_DELAY;
  const tx = SX(e.x);
  const ty = SY(e.y);
  ctx.save();
  ctx.strokeStyle = e.owner === me ? "rgba(255,201,74,.85)" : "rgba(255,91,79,.85)";
  ctx.setLineDash([L(260), L(200)]);
  ctx.lineWidth = Math.max(1.5, L(80));
  ctx.beginPath();
  ctx.ellipse(tx, ty, L(e.spellRadius), L(e.spellRadius) * 0.75, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  const sx = tx - k * canvas.width * 0.25;
  const sy = ty - k * canvas.height * 0.45;
  drawFireball(ctx, sx, sy, L(650), tx - sx + 1, ty - sy + 1, t, true);
}

function drawProjectiles(game: GameState, now: number) {
  const byId = new Map(game.entities.map((e) => [e.id, e]));
  projectiles = projectiles.filter((p) => now - p.t0 < p.dur);
  for (const p of projectiles) {
    const k = (now - p.t0) / p.dur;
    const target = byId.get(p.to);
    const x2 = target ? target.x : p.x2;
    const y2 = target ? target.y : p.y2;
    const startLift = p.kind === "orb" || p.kind === "bigorb" ? 1700 : 600;
    const x = SX(p.x1 + (x2 - p.x1) * k);
    const y = SY(p.y1 + (y2 - p.y1) * k) - L(startLift * (1 - k) + 450 * k) - Math.sin(k * Math.PI) * L(p.kind === "arrow" ? 500 : 250);
    const ang = Math.atan2(SY(y2) - SY(p.y1), SX(x2) - SX(p.x1));
    ctx.save();
    if (p.kind === "arrow") {
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.strokeStyle = "#5a3a1c";
      ctx.lineWidth = Math.max(1.5, L(60));
      ctx.beginPath();
      ctx.moveTo(-L(380), 0);
      ctx.lineTo(L(220), 0);
      ctx.stroke();
      ctx.fillStyle = "#e6e6ee";
      ctx.beginPath();
      ctx.moveTo(L(300), 0);
      ctx.lineTo(L(180), -L(70));
      ctx.lineTo(L(180), L(70));
      ctx.fill();
    } else if (p.kind === "bomb") {
      // lobbed: big arc, lands with a splash
      const arcY = y - Math.sin(k * Math.PI) * L(1600);
      ctx.restore();
      ctx.save();
      bombIcon(x, arcY, L(220), now);
      if (k > 0.9 && !(p as any).boom) {
        (p as any).boom = true;
        rings.push({ x: x2, y: y2, r: p.splash ?? 1300, t0: now, dur: 300, color: "rgba(255,190,90," });
        burst(SX(x2), SY(y2), 14, ["#ffd27a", "#ff8a1f", "#6b6b6b"], 300 * dpr, 4 * dpr, 0.45, 300);
        snd(sfx.hit);
      }
    } else if (p.kind === "ball") {
      ctx.fillStyle = "#2a2d36";
      ctx.beginPath();
      ctx.arc(x, y, L(150), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.5)";
      ctx.beginPath();
      ctx.arc(x - L(50), y - L(50), L(45), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "mote") {
      ctx.shadowColor = p.team.main;
      ctx.shadowBlur = L(300);
      ctx.fillStyle = p.team.light;
      ctx.beginPath();
      ctx.arc(x, y, L(90), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "spit") {
      drawFireball(ctx, x, y, L(170), Math.cos(ang), Math.sin(ang), now / 1000);
    } else {
      const big = p.kind === "bigorb" ? 1.4 : 1;
      const col = p.kind === "bolt" ? p.team.light : "#fff3b0";
      ctx.shadowColor = p.kind === "bolt" ? p.team.main : "#ffd34a";
      ctx.shadowBlur = L(500) * big;
      ctx.fillStyle = col;
      ctx.beginPath();
      if (p.kind === "bolt") {
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.moveTo(L(260), 0);
        ctx.lineTo(0, -L(110));
        ctx.lineTo(-L(220), 0);
        ctx.lineTo(0, L(110));
      } else ctx.arc(x, y, L(170) * big, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (k > 0.85 && !(p as any).hit) {
      (p as any).hit = true;
      burst(SX(x2), SY(y2) - L(400), 4, ["#fff6d6", "#ffe08a"], 180 * dpr, 3 * dpr, 0.25, 0);
    }
  }
}

function drawBolts(now: number) {
  if (now < flashUntil) {
    ctx.fillStyle = `rgba(220,245,255,${0.25 * (flashUntil - now) / 90})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  bolts = bolts.filter((b) => now - b.t0 < (b.big ? 260 : 160));
  for (const b of bolts) {
    if (now < b.t0) continue;
    const a = 1 - (now - b.t0) / (b.big ? 260 : 160);
    ctx.save();
    ctx.strokeStyle = `rgba(200,250,255,${a})`;
    ctx.shadowColor = "#7fe7ff";
    ctx.shadowBlur = L(400);
    ctx.lineWidth = Math.max(1.5, L(b.big ? 160 : 90));
    ctx.beginPath();
    for (let i = 0; i < b.pts.length; i += 2) {
      const x = SX(b.pts[i]);
      const y = SY(b.pts[i + 1]) - (i === 0 ? 0 : L(300));
      if (i === 0) ctx.moveTo(x, y - L(900));
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawRings(now: number) {
  rings = rings.filter((r) => now - r.t0 < r.dur);
  for (const r of rings) {
    const k = (now - r.t0) / r.dur;
    ctx.strokeStyle = `${r.color}${(1 - k) * 0.9})`;
    ctx.lineWidth = Math.max(1.5, L(160) * (1 - k));
    ctx.beginPath();
    ctx.ellipse(SX(r.x), SY(r.y), L(r.r) * (0.4 + k * 0.7), L(r.r) * (0.3 + k * 0.5), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawParticles(dt: number) {
  let n = 0;
  for (const p of particles) {
    p.life -= dt;
    if (p.life <= 0) continue;
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.98;
    const k = p.life / p.max;
    ctx.globalAlpha = Math.min(1, k * 1.5);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.shrink ? p.size * k : p.size), 0, Math.PI * 2);
    ctx.fill();
    particles[n++] = p;
  }
  particles.length = n;
  ctx.globalAlpha = 1;
}

function drawFloaters(now: number) {
  floaters = floaters.filter((f) => now - f.t0 < 750);
  const fs = Math.max(10, 13 * dpr);
  ctx.font = `800 ${fs}px "Lilita One", "Baloo 2", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, 3 * dpr);
  for (const f of floaters) {
    const k = (now - f.t0) / 750;
    const x = SX(f.x);
    const y = SY(f.y) - L(1500) - k * 26 * dpr;
    ctx.globalAlpha = 1 - k * k;
    ctx.strokeStyle = "rgba(29,23,51,.9)";
    ctx.strokeText(`-${f.amount}`, x, y);
    ctx.fillStyle = f.color;
    ctx.fillText(`-${f.amount}`, x, y);
  }
  ctx.globalAlpha = 1;
}

function drawZones(game: GameState, card: string) {
  const def = CARDS[card];
  if (def.kind === "spell") return;
  ctx.fillStyle = "rgba(255,60,60,.15)";
  for (let y = 500; y < ARENA_H; y += 1000) {
    if (y > RIVER_TOP && y < RIVER_BOTTOM) continue;
    for (let x = 500; x < ARENA_W; x += 1000) {
      if (canDeployAt(game, me, def.kind, x, y)) continue;
      const a = SY(y - 500);
      const b = SY(y + 500);
      ctx.fillRect(SX(x - 500), Math.min(a, b), Math.ceil(L(1000)), Math.ceil(Math.abs(b - a)));
    }
  }
}

function drawMarks(ui: UiState, now: number) {
  for (const m of ui.marks) {
    if (now - m.t > 1500) continue;
    const def = CARDS[m.card];
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.5, L(90));
    ctx.setLineDash([L(220), L(180)]);
    const rr = L(def.kind === "spell" ? def.spellRadius! : (def.radius ?? 500) * 1.4);
    ctx.beginPath();
    ctx.ellipse(SX(m.x), SY(m.y), rr, rr * 0.75, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawGhost(game: GameState, ui: UiState) {
  const def = CARDS[ui.selected!];
  const g = ui.ghost!;
  const ok = canDeployAt(game, me, def.kind, g.x, g.y) && ui.canAfford;
  const x = SX(g.x);
  const y = SY(g.y);
  ctx.save();
  if (def.kind === "spell") {
    ctx.fillStyle = ok ? "rgba(255,201,74,.22)" : "rgba(255,60,60,.22)";
    ctx.strokeStyle = ok ? "#ffc94a" : "#ff5b4f";
    ctx.lineWidth = Math.max(1.5, L(90));
    ctx.beginPath();
    ctx.ellipse(x, y, L(def.spellRadius!), L(def.spellRadius!) * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    if (def.kind === "building" || (def.range ?? 0) > 2000) {
      ctx.strokeStyle = "rgba(255,255,255,.7)";
      ctx.setLineDash([L(250), L(250)]);
      ctx.lineWidth = Math.max(1, L(60));
      ctx.beginPath();
      ctx.ellipse(x, y, L(def.range!), L(def.range!) * 0.75, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = ok ? 0.65 : 0.4;
    const fr = spriteFor(def.id, "back", 1, BLUE);
    if (fr) {
      const hh = L((def.radius ?? 500) * VIS) * (SPRITE_HEIGHT[def.id] ?? 2.6);
      const kk = hh / (fr.canvas.height - fr.pad * 2);
      ctx.drawImage(fr.canvas, x - (fr.canvas.width * kk) / 2, y - fr.canvas.height * kk + fr.pad * kk, fr.canvas.width * kk, fr.canvas.height * kk);
    } else {
      const art = cardArt(def.id);
      const s = L((def.radius ?? 500) * 4.2);
      ctx.drawImage(art, x - s / 2, y - s * 0.9, s, s);
    }
    if (!ok) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "#ff5b4f";
      ctx.lineWidth = Math.max(2, 3 * dpr);
      const k = L(450);
      ctx.beginPath();
      ctx.moveTo(x - k, y - k);
      ctx.lineTo(x + k, y + k);
      ctx.moveTo(x + k, y - k);
      ctx.lineTo(x - k, y + k);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBanner(now: number) {
  if (!banner) return;
  const k = (now - banner.t0) / 1300;
  if (k >= 1) {
    banner = null;
    return;
  }
  const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : k < 0.25 ? 1.1 - ((k - 0.15) / 0.1) * 0.1 : 1;
  ctx.save();
  ctx.globalAlpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
  ctx.translate(canvas.width / 2, canvas.height * 0.5 - k * 20 * dpr);
  ctx.scale(pop, pop);
  ctx.font = `400 ${Math.round(40 * dpr)}px "Lilita One", "Arial Black", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 8 * dpr;
  ctx.strokeStyle = "#1d1733";
  ctx.strokeText(banner.text, 0, 0);
  ctx.fillStyle = banner.color;
  ctx.fillText(banner.text, 0, 0);
  ctx.restore();
}

function bombIcon(x: number, y: number, r: number, now: number) {
  ctx.fillStyle = "#2c2f3a";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.35)";
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = Math.sin(now * 0.05) > 0 ? "#ffd23f" : "#ff8a1f";
  ctx.beginPath();
  ctx.arc(x + r * 0.7, y - r * 0.9, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
}
