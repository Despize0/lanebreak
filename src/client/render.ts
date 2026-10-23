// The sky-islands renderer: cached scenery, animated clouds, sprites, projectiles, particles,
// damage numbers and screen shake. Reads the sim state; never changes it.

import { CARDS } from "../sim/cards";
import { Rng } from "../sim/rng";
import {
  ARENA_H, ARENA_W, BRIDGES, BRIDGE_HALF, DEPLOY_TICKS, RIVER_BOTTOM, RIVER_TOP, SPELL_DELAY, canDeployAt, createGame,
  type Entity, type GameState, type PlayerId,
} from "../sim/sim";
import { sfx } from "./audio";
import { animFrame, spriteFor } from "./spriteCache";
import { ANIM_BASE_HEIGHT, animKey } from "./unitAnim";
import { kingImage, towerImage } from "./towerSkins";
import { SPRITE_HEIGHT, spriteKey, type View } from "./unitSprites";
import { BOWS, HEAVY, SLAMMERS, SWORD, WINGS, rigImage } from "./rig";
import { RIG2_HEIGHT, RigDraw, rigFor } from "./rig2";
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
  skins?: [string, string]; // side-tower skin per player seat
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

  // fine grass texture: thousands of short blades in slightly different greens
  const blades = new Rng(83);
  c.lineCap = "round";
  for (let i = 0; i < 9000; i++) {
    const x = blades.int(ARENA_W);
    const y = blades.int(ARENA_H);
    if (y > RIVER_TOP - 250 && y < RIVER_BOTTOM + 250) continue;
    const tone = blades.int(4);
    c.strokeStyle = ["rgba(40,95,30,.22)", "rgba(150,215,95,.2)", "rgba(70,130,45,.2)", "rgba(200,235,140,.14)"][tone];
    c.lineWidth = Math.max(0.6, L(28));
    const len = 90 + blades.int(120);
    const lean = blades.int(60) - 30;
    c.beginPath();
    c.moveTo(SX(x), Y(y));
    c.lineTo(SX(x + lean), Y(y - len));
    c.stroke();
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
        ctx2.lineWidth = L(1900 + grow);
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
    for (const bx of BRIDGES) if (Math.abs(x - bx) < BRIDGE_HALF + 100) return false;
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
    b.fillRect(SX(bx - BRIDGE_HALF + 100), Y(y0 + 200), L(BRIDGE_HALF * 2 - 100), L(y1 - y0));
    for (let y = y0, i = 0; y < y1; y += 290, i++) {
      b.fillStyle = i % 2 ? "#b77d45" : "#c98f55";
      b.fillRect(SX(bx - BRIDGE_HALF + 50), Y(y), L(BRIDGE_HALF * 2 - 100), L(220));
      b.fillStyle = "rgba(60,35,15,.35)";
      b.fillRect(SX(bx - BRIDGE_HALF + 50), Y(y + 180), L(BRIDGE_HALF * 2 - 100), L(40));
    }
    b.strokeStyle = "#6b4523";
    b.lineWidth = Math.max(1.5, L(80));
    for (const side of [-1, 1]) {
      b.beginPath();
      b.moveTo(SX(bx + side * (BRIDGE_HALF - 40)), Y(y0));
      b.quadraticCurveTo(SX(bx + side * (BRIDGE_HALF + 80)), Y((y0 + y1) / 2), SX(bx + side * (BRIDGE_HALF - 40)), Y(y1));
      b.stroke();
      for (const py of [y0, y1]) {
        b.fillStyle = "#7a4f28";
        b.beginPath();
        b.arc(SX(bx + side * BRIDGE_HALF), Y(py), Math.max(2, L(150)), 0, Math.PI * 2);
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
/** Smoothed on-screen velocity and pending view/facing changes, so bumps don't make units flicker. */
const motion = new Map<number, { vx: number; vy: number; faceAt: number; pend: View | null; pendAt: number }>();
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
  motion.clear();
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
  const air = e.flying ? 0.55 : 1;
  const k = (1 - lift * 0.6) * air;
  const cx = SX(x) + r * 0.12; // light comes from the upper left
  const cy = SY(y) + r * 0.05;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(10,25,10,${0.45 * k})`);
  g.addColorStop(0.55, `rgba(10,25,10,${0.22 * k})`);
  g.addColorStop(1, "rgba(10,25,10,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * (e.flying ? 0.8 : 1.0), r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawEntity(e: Entity, x: number, y: number, ui: UiState, now: number, t: number) {
  const team = teamOf(e.owner);
  const px = SX(x);
  let py = SY(y);
  if (e.kind === "tower") {
    const r = L(e.radius);
    // soft ground shadow so the tower sits in the scene (light from the upper left)
    {
      const sx0 = px + r * 0.35;
      const sy0 = py + r * 0.5;
      const g = ctx.createRadialGradient(sx0, sy0, 0, sx0, sy0, r * 1.5);
      g.addColorStop(0, "rgba(10,25,10,.4)");
      g.addColorStop(1, "rgba(10,25,10,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(sx0, sy0, r * 1.5, r * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const skinImg = e.card === "king" ? null : towerImage(ui.skins?.[e.owner] ?? "classic");
    const kImg = e.card === "king" ? kingImage(team === BLUE) : null;
    if (kImg) {
      // floating-island keep: hovers gently; dozes (zZ) until it wakes up
      const hh = r * 2.5;
      const ww = (kImg.naturalWidth / kImg.naturalHeight) * hh;
      const bobY = Math.sin(t * 1.3 + (team === BLUE ? 0 : 1.7)) * r * 0.03;
      ctx.drawImage(kImg, px - ww / 2, py + r * 0.75 - hh + bobY, ww, hh);
      if (!e.active) {
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,.85)";
        ctx.font = `700 ${Math.round(r * 0.3)}px system-ui, sans-serif`;
        const zt = (t * 0.6) % 1;
        ctx.globalAlpha = 1 - zt;
        ctx.fillText("z", px + r * 0.55, py - r * 1.2 - zt * r * 0.4);
        ctx.globalAlpha = 0.6 * (1 - zt);
        ctx.fillText("Z", px + r * 0.75, py - r * 1.45 - zt * r * 0.4);
        ctx.restore();
      }
    } else if (e.card === "king") drawKeep(ctx, px, py, r, team, e.active, t);
    else if (skinImg) {
      // painted tower skin on a team-colored plinth
      ctx.save();
      ctx.fillStyle = team.dark;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.ellipse(px, py + r * 0.42, r * 1.02, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = team.main;
      ctx.lineWidth = Math.max(2, 3 * dpr);
      ctx.stroke();
      const hh = r * 2.55;
      const ww = (skinImg.naturalWidth / skinImg.naturalHeight) * hh;
      ctx.drawImage(skinImg, px - ww / 2, py + r * 0.55 - hh, ww, hh);
      ctx.restore();
    } else drawLighthouse(ctx, px, py, r, team, e.active, t);
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
  let mo = motion.get(e.id);
  if (!mo) motion.set(e.id, (mo = { vx: 0, vy: 0, faceAt: 0, pend: null, pendAt: 0 }));
  // smooth the per-frame movement: collisions nudge units sideways for a frame or two
  mo.vx += ((p ? dx : 0) - mo.vx) * 0.12;
  mo.vy += ((p ? e.y - p.y : 0) - mo.vy) * 0.12;
  let face = facing.get(e.id) ?? (e.x < 9000 ? 1 : -1);
  const la = lastAttack.get(e.id);
  const atk = la ? Math.min(1, (now - la.t) / 450) : 1;
  let want = face;
  if (la && atk < 1 && Math.abs(la.x - e.x) > 200) want = la.x > e.x ? 1 : -1;
  else if (Math.abs(mo.vx) > 4 && Math.abs(mo.vx) > Math.abs(mo.vy) * 0.35) want = mo.vx > 0 ? 1 : -1;
  // only turn around when it has been a moment since the last turn
  if (want !== face && now - mo.faceAt > 300) { face = want; mo.faceAt = now; }
  void dx;
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
  const prevDir = dir;
  if (la && atk < 1 && Math.hypot(la.x - e.x, la.y - e.y) > 150) pick(la.x - e.x, (la.y - e.y) * flipSign);
  else if (moving && Math.hypot(mo.vx, mo.vy) > 3) pick(mo.vx, mo.vy * flipSign);
  if (dir !== prevDir && !(la && atk < 1)) {
    // a new view has to hold for a moment before we switch pictures
    if (mo.pend !== dir) { mo.pend = dir; mo.pendAt = now; }
    if (now - mo.pendAt < 220) dir = prevDir;
  } else mo.pend = null;
  viewDir.set(e.id, dir);
  const groundY = py;
  py -= lift;
  const h = r * (SPRITE_HEIGHT[e.card] ?? 2.6);
  // pick the picture: attack frames while striking, the walk cycle while moving (or flying),
  // the painted back view when heading away from the viewer, walk frame 0 when standing
  const key = animKey(e.card, e.id);
  const attacking = !!la && atk < 0.75;
  const useAnim = FRAME_ANIM.has(e.card);
  let cv: HTMLCanvasElement | null = null;
  let pad = 0;
  let anchor = 0; // feet x inside cv
  let k = 1;
  let mirror = false;
  let animated = false;
  let view: View = dir;
  let blendCv: HTMLCanvasElement | null = null; // next frame, faded in for smoother motion
  let blendAnchor = 0;
  let blend = 0;
  if (useAnim) {
    // walk cycle speed follows the unit's real speed; attack frames span the strike
    const rate = 7 * Math.max(0.6, (e.speed || 50) / 50);
    const ph = attacking ? (atk / 0.75) * 2.999 : moving || e.flying ? t * rate + e.id * 0.37 : 0;
    const n = Math.floor(ph);
    const kind = attacking ? "attack" : "walk";
    const af = animFrame(key, kind, n, team) ?? (attacking ? animFrame(key, "walk", 0, team) : null);
    if (af) {
      cv = af.canvas;
      pad = af.pad;
      anchor = af.pad + af.ax;
      k = h / ANIM_BASE_HEIGHT;
      mirror = face < 0;
      animated = true;
      const nf = (moving || e.flying || attacking) ? animFrame(key, kind, attacking ? Math.min(2, n + 1) : n + 1, team) : null;
      if (nf && nf.canvas !== af.canvas) {
        blendCv = nf.canvas;
        blendAnchor = nf.pad + nf.ax;
        blend = ph - n;
      }
    }
  }
  if (!cv) {
    const frame = spriteFor(spriteKey(e.card, e.id), dir, face as 1 | -1, team);
    if (frame) {
      cv = frame.canvas;
      pad = frame.pad;
      anchor = frame.canvas.width / 2;
      k = h / (frame.canvas.height - frame.pad * 2);
      mirror = frame.flip;
      view = frame.view;
    }
  }
  if (!cv) {
    // no painted art for this unit: fall back to the code-drawn character
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
  // soft team-colored glow on the ground under the unit
  {
    const gr = ctx.createRadialGradient(px, groundY, 0, px, groundY, r * 0.95);
    gr.addColorStop(0, team === BLUE ? "rgba(70,150,255,.55)" : "rgba(255,80,70,.55)");
    gr.addColorStop(0.6, team === BLUE ? "rgba(70,150,255,.22)" : "rgba(255,80,70,.22)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.ellipse(px, groundY, r * 0.95, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const w = cv.width * k;
  const fullH = cv.height * k;
  const walk = moving && !e.flying ? p_walk(t * Math.max(0.6, (e.speed || 50) / 50), e.id) : 0;
  // a stride: up on each step, a little settle when the foot lands; no side-to-side rocking
  const stride = Math.abs(walk);
  const bob = -stride * r * (animated ? 0.04 : 0.07);
  const land = !animated && moving && !e.flying ? Math.max(0, 1 - stride * 4) : 0;
  const tilt = e.flying && !animated ? Math.sin(t * 1.6 + e.id) * 0.018 : 0;
  const breathe = !moving && !e.flying && !animated ? Math.sin(t * 2.2 + e.id) * 0.012 : 0;
  // attack rhythm: wind up during the second half of each attack cycle, strike when the hit lands
  const sk = spriteKey(e.card, e.id);
  const period = Math.max(1, e.hitTicks) * 50;
  const since = la ? now - la.t : 1e9;
  const cyc = since / period;
  const windup = la && !animated ? smoothstep(0.45, 1, cyc) * Math.min(1, Math.max(0, (1.7 - cyc) / 0.4)) : 0;
  const slam = SLAMMERS.has(e.card);
  const sT = since / (slam ? 240 : 170);
  const squash = !animated && sT < 1 ? Math.sin(sT * Math.PI) : 0;
  const lean = windup * (slam ? 0.1 : 0.04);
  const sxk = 1 + squash * (slam ? 0.14 : 0.07) + land * 0.025;
  const syk = 1 - squash * (slam ? 0.14 : 0.06) - land * 0.035 + breathe + windup * (slam ? 0.06 : 0.02);
  const fdir = mirror ? -1 : 1;
  const rot = tilt - lean * fdir;
  const tx = px + lx;
  const ty = py + ly + bob + pad * k;
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(rot);
  ctx.scale(mirror ? -sxk : sxk, syk);
  ctx.globalAlpha = e.deployTicks > 0 ? 0.92 : 1;
  const left = -anchor * k;
  const loc = (q: readonly [number, number]): [number, number] => [left + (q[0] + pad) * k, -fullH + (q[1] + pad) * k];
  const layer = (im: HTMLImageElement) => ctx.drawImage(im, left + pad * k, -fullH + pad * k, im.width * k, im.height * k);
  ctx.imageSmoothingQuality = "high";
  let flashImg: CanvasImageSource = cv;
  let mouthW: [number, number] | null = null;
  const sword = animated ? undefined : SWORD[sk]?.[view];
  const wings = animated ? undefined : WINGS[sk]?.[view];
  const bow = animated ? undefined : BOWS[sk]?.[view];
  const rBody = sword || wings ? rigImage(sk, view, "body") : null;
  const blade = sword ? rigImage(sk, view, "blade") : null;
  const wingL = wings ? rigImage(sk, view, "wingL") : null;
  const wingR = wings ? rigImage(sk, view, "wingR") : null;
  const rig2 = animated ? null : rigFor(sk);
  let rigFlash: (() => void) | null = null;
  if (rig2) {
    // multi-part rig: limbs, weapons and wings move on their own joints
    const k2 = (h * (RIG2_HEIGHT[sk] ?? 1)) / rig2.h;
    const R = new RigDraw(ctx, sk, rig2, k2);
    const part = (n: string) => rig2.parts.find((q) => q.name === n)!;
    const sw = walk;
    rigFlash = () => R.drawBody();
    if (sk === "warden") {
      const arm = part("arm");
      const shield = part("shield");
      let a = -1.0 * windup + sw * 0.12;
      if (cyc < 0.1) a = -1.0 + 2.3 * easeOut(cyc / 0.1);
      else if (cyc < 0.35) a = 1.3 * (1 - easeInOut((cyc - 0.1) / 0.25));
      R.drawBody();
      if (cyc < 0.25 && a > -0.9) {
        // slash trail around the shoulder
        const [sx0, sy0] = R.body(arm.at);
        const tip = R.partPt(arm, arm.pts.tip, 0);
        const rad = Math.hypot(tip[0] - sx0, tip[1] - sy0);
        const base = Math.atan2(tip[1] - sy0, tip[0] - sx0);
        ctx.save();
        ctx.globalAlpha *= 0.5 * (1 - cyc / 0.25);
        ctx.strokeStyle = "#f4fbff";
        ctx.lineWidth = rad * 0.28;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(sx0, sy0, rad * 0.8, base - 1.0, base + a, false);
        ctx.stroke();
        ctx.restore();
      }
      R.drawPart(arm, a);
      R.drawPart(shield, -0.12 * squash + sw * 0.03);
    } else if (sk === "ranger") {
      const bowP = part("bow");
      const pull = part("pull");
      const shoulder = R.body(bowP.at);
      let aim = 0;
      if (la && cyc < 1.6) {
        // turn the bow arm toward the target
        const lxT = ((SX(la.x) - tx) * fdir) / sxk;
        const lyT = (SY(la.y) - ty) / syk;
        aim = Math.max(-1.0, Math.min(0.9, Math.atan2(lyT - shoulder[1], lxT - shoulder[0]) - 0.3));
      }
      R.drawBody();
      R.drawPart(bowP, aim);
      const top = R.partPt(bowP, bowP.pts.tipTop, aim);
      const bot = R.partPt(bowP, bowP.pts.tipBot, aim);
      const nk = R.partPt(bowP, bowP.pts.nock, aim);
      const dir = [Math.cos(bowP.rot + aim), Math.sin(bowP.rot + aim)];
      const reach = Math.hypot(nk[0] - shoulder[0], nk[1] - shoulder[1]);
      const pullD = easeInOut(windup) * reach * 0.8;
      const N: [number, number] = [nk[0] - dir[0] * pullD, nk[1] - dir[1] * pullD];
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(240,232,205,.95)";
      ctx.lineWidth = Math.max(1, 1.4 * k2);
      ctx.beginPath();
      ctx.moveTo(top[0], top[1]);
      if (windup > 0.02) ctx.lineTo(N[0], N[1]);
      else {
        const amp = since < 260 ? Math.sin(since * 0.12) * (1 - since / 260) * 7 * k2 : 0;
        ctx.quadraticCurveTo((top[0] + bot[0]) / 2 - dir[0] * amp, (top[1] + bot[1]) / 2 - dir[1] * amp, bot[0], bot[1]);
      }
      ctx.lineTo(bot[0], bot[1]);
      ctx.stroke();
      if (windup > 0.05) {
        // nocked arrow
        const L2 = reach * 1.25 + pullD;
        const ex = N[0] + dir[0] * L2;
        const ey = N[1] + dir[1] * L2;
        ctx.strokeStyle = "#6e4320";
        ctx.lineWidth = Math.max(1.2, 2.6 * k2);
        ctx.beginPath();
        ctx.moveTo(N[0], N[1]);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        const nx = -dir[1];
        const ny = dir[0];
        ctx.fillStyle = "#dfe6ee";
        ctx.beginPath();
        ctx.moveTo(ex + dir[0] * 9 * k2, ey + dir[1] * 9 * k2);
        ctx.lineTo(ex + nx * 4 * k2, ey + ny * 4 * k2);
        ctx.lineTo(ex - nx * 4 * k2, ey - ny * 4 * k2);
        ctx.fill();
        ctx.fillStyle = "#e8453c";
        ctx.beginPath();
        ctx.moveTo(N[0] + dir[0] * 10 * k2, N[1] + dir[1] * 10 * k2);
        ctx.lineTo(N[0] + nx * 4 * k2, N[1] + ny * 4 * k2);
        ctx.lineTo(N[0] - nx * 4 * k2, N[1] - ny * 4 * k2);
        ctx.fill();
      }
      // the drawing hand holds the string
      const hold: [number, number] = windup > 0.02 ? N : [nk[0] - dir[0] * reach * 0.15, nk[1] - dir[1] * reach * 0.15];
      R.drawPart(pull, aim, hold);
    } else if (sk === "colossus") {
      const armL = part("armL");
      const armR = part("armR");
      let aL = sw * 0.22 - 1.8 * windup;
      let aR = -sw * 0.22 + 1.8 * windup;
      if (cyc < 0.15) {
        const q = easeOut(cyc / 0.15);
        aL = -1.8 + 2.2 * q;
        aR = 1.8 - 2.2 * q;
      } else if (cyc < 0.4) {
        const q = (cyc - 0.15) / 0.25;
        aL = 0.4 * (1 - q);
        aR = -0.4 * (1 - q);
      }
      R.drawPart(armR, aR);
      R.drawBody();
      R.drawPart(armL, aL);
    } else {
      // skywing: wings beat around the shoulders (faster while breathing fire)
      const beat = Math.sin(t * (windup > 0 || cyc < 0.4 ? 13 : 8) + e.id);
      R.drawPart(part("wingR"), -beat * 0.35);
      R.drawPart(part("wingL"), beat * 0.45);
      R.drawBody();
      if (rig2.pts.mouth) {
        const [mx, my] = R.body(rig2.pts.mouth);
        const sx = (mirror ? -sxk : sxk) * mx;
        const sy = syk * my;
        mouthW = [tx + sx * Math.cos(rot) - sy * Math.sin(rot), ty + sx * Math.sin(rot) + sy * Math.cos(rot)];
      }
    }
  } else if (sword && rBody && blade) {
    // sword: raise it back during the wind-up, whip it through on the hit, settle back
    let a = -1.1 * windup;
    if (cyc < 0.1) a = -1.1 + 2.9 * easeOut(cyc / 0.1);
    else if (cyc < 0.35) a = 1.8 * (1 - easeInOut((cyc - 0.1) / 0.25));
    layer(rBody);
    const [gx, gy] = loc(sword.grip);
    if (cyc < 0.25 && a > -1.0) {
      // slash trail
      const tip = loc(sword.tip);
      const R = Math.hypot(tip[0] - gx, tip[1] - gy);
      const base = Math.atan2(tip[1] - gy, tip[0] - gx);
      ctx.save();
      ctx.globalAlpha *= 0.55 * (1 - cyc / 0.25);
      ctx.strokeStyle = "#f4fbff";
      ctx.lineWidth = R * 0.32;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(gx, gy, R * 0.78, base - 1.1, base + a, false);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(a);
    ctx.translate(-gx, -gy);
    layer(blade);
    ctx.restore();
    flashImg = rBody;
  } else if (wings && rBody && wingL && wingR) {
    // dragon: wings beat around the shoulders (faster while breathing fire)
    const beat = Math.sin(t * (windup > 0 || cyc < 0.4 ? 13 : 8) + e.id);
    const [lx0, ly0] = loc(wings.wingL);
    const [rx0, ry0] = loc(wings.wingR);
    ctx.save();
    ctx.translate(rx0, ry0);
    ctx.rotate(-beat * 0.12);
    ctx.scale(1, 0.72 + 0.28 * beat);
    ctx.translate(-rx0, -ry0);
    layer(wingR);
    ctx.restore();
    ctx.save();
    ctx.translate(lx0, ly0);
    ctx.rotate(beat * 0.3);
    ctx.scale(1, 0.85 + 0.15 * beat);
    ctx.translate(-lx0, -ly0);
    layer(wingL);
    ctx.restore();
    layer(rBody);
    flashImg = rBody;
    const [mx, my] = loc(wings.mouth);
    const sx = (mirror ? -sxk : sxk) * mx;
    const sy = syk * my;
    mouthW = [tx + sx * Math.cos(rot) - sy * Math.sin(rot), ty + sx * Math.sin(rot) + sy * Math.cos(rot)];
  } else {
    ctx.drawImage(cv, left, -fullH, w, fullH);
  }
  if (bow && !animated && !rig2) {
    // archer: nock an arrow and pull the string back during the wind-up; the string twangs after the shot
    const T = loc(bow.top);
    const B = loc(bow.bot);
    const H = loc(bow.hand);
    const A = loc(bow.aim);
    const bx = B[0] - T[0];
    const by = B[1] - T[1];
    const u = ((H[0] - T[0]) * bx + (H[1] - T[1]) * by) / (bx * bx + by * by);
    const R0: [number, number] = [T[0] + bx * u, T[1] + by * u];
    ctx.lineCap = "round";
    if (windup > 0.05) {
      const d = easeInOut(windup);
      const N: [number, number] = [R0[0] + (H[0] - R0[0]) * d, R0[1] + (H[1] - R0[1]) * d];
      ctx.strokeStyle = "rgba(245,236,210,.95)";
      ctx.lineWidth = Math.max(1, 0.9 * k);
      ctx.beginPath();
      ctx.moveTo(T[0], T[1]);
      ctx.lineTo(N[0], N[1]);
      ctx.lineTo(B[0], B[1]);
      ctx.stroke();
      const ax = A[0] - H[0];
      const ay = A[1] - H[1];
      const al = Math.hypot(ax, ay) || 1;
      const L2 = al * 1.05;
      const ex = N[0] + (ax / al) * L2;
      const ey = N[1] + (ay / al) * L2;
      ctx.strokeStyle = "#7a4a22";
      ctx.lineWidth = Math.max(1.2, 1.7 * k);
      ctx.beginPath();
      ctx.moveTo(N[0], N[1]);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = "#dfe6ee";
      ctx.beginPath();
      const nx = -ay / al;
      const ny = ax / al;
      ctx.moveTo(ex + (ax / al) * 5 * k, ey + (ay / al) * 5 * k);
      ctx.lineTo(ex + nx * 2.4 * k, ey + ny * 2.4 * k);
      ctx.lineTo(ex - nx * 2.4 * k, ey - ny * 2.4 * k);
      ctx.fill();
      ctx.fillStyle = "#e8453c";
      ctx.fillRect(N[0] - 2 * k, N[1] - 1.5 * k, 4 * k, 3 * k);
    } else if (since < 260) {
      const amp = Math.sin(since * 0.12) * (1 - since / 260) * 4 * k;
      const nx = -by / Math.hypot(bx, by);
      const ny = bx / Math.hypot(bx, by);
      ctx.strokeStyle = "rgba(245,236,210,.95)";
      ctx.lineWidth = Math.max(1, 0.9 * k);
      ctx.beginPath();
      ctx.moveTo(T[0], T[1]);
      ctx.quadraticCurveTo((T[0] + B[0]) / 2 + nx * amp, (T[1] + B[1]) / 2 + ny * amp, B[0], B[1]);
      ctx.stroke();
    }
  }
  if (blendCv && blend > 0.05) {
    // cross-fade into the next frame: reads as more in-between frames
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * blend;
    ctx.drawImage(blendCv, -blendAnchor * k, -blendCv.height * k, blendCv.width * k, blendCv.height * k);
    ctx.globalAlpha = base;
  }
  const hit = hitAt.get(e.id);
  if (hit !== undefined && now - hit < 90) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.45 * (1 - (now - hit) / 90);
    if (rigFlash) rigFlash();
    else if (flashImg === cv) ctx.drawImage(cv, left, -fullH, w, fullH);
    else layer(flashImg as HTMLImageElement);
  }
  ctx.restore();
  // dragon fire: the mouth glows during the wind-up, then a stream of flame on the hit
  if (mouthW && la) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (windup > 0.2) {
      const g = ctx.createRadialGradient(mouthW[0], mouthW[1], 0, mouthW[0], mouthW[1], r * 0.6 * windup);
      g.addColorStop(0, `rgba(255,220,120,${0.8 * windup})`);
      g.addColorStop(1, "rgba(255,90,20,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mouthW[0], mouthW[1], r * 0.6 * windup, 0, Math.PI * 2);
      ctx.fill();
    }
    if (since < 480) {
      const p = since / 480;
      const reach = Math.min(1, since / 140);
      const txw = SX(la.x);
      const tyw = SY(la.y);
      for (let i = 0; i <= 10; i++) {
        const f = (i / 10) * reach;
        const fx = mouthW[0] + (txw - mouthW[0]) * f + Math.sin(t * 40 + i * 2.1) * r * 0.06;
        const fy = mouthW[1] + (tyw - mouthW[1]) * f + Math.cos(t * 37 + i * 1.7) * r * 0.06;
        const rr = r * (0.22 + 0.5 * f) * (1 - p * 0.45);
        const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, rr);
        g.addColorStop(0, `rgba(255,240,170,${0.85 * (1 - p)})`);
        g.addColorStop(0.5, `rgba(255,140,40,${0.6 * (1 - p)})`);
        g.addColorStop(1, "rgba(200,40,10,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(fx, fy, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  // heavy hitters: ground shockwave where the fists land
  if (slam && la && since < 420 && !animated) {
    const p = since / 420;
    const cx = px + lx + fdir * r * 0.55;
    ctx.save();
    ctx.strokeStyle = `rgba(120,95,60,${0.55 * (1 - p)})`;
    ctx.lineWidth = Math.max(1.5, r * 0.12 * (1 - p));
    ctx.beginPath();
    ctx.ellipse(cx, groundY, r * (0.35 + 1.1 * p), r * (0.15 + 0.45 * p), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(150,125,90,${0.5 * (1 - p)})`;
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + e.id;
      const d = r * (0.3 + 0.9 * p);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * d, groundY + Math.sin(ang) * d * 0.4 - Math.sin(p * Math.PI) * r * 0.35, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  // big golems kick up dust on every step
  if (HEAVY.has(e.card) && land > 0.6 && !animated) {
    ctx.save();
    ctx.fillStyle = `rgba(150,130,100,${0.28 * land})`;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(px + sgn * r * 0.45, groundY, r * 0.22, r * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  if (e.deployTicks === 0 && e.hp < e.maxHp) {
    unitBar(px, py + ly + bob - h - 6 * dpr, Math.max(r * 1.5, 20 * dpr), e.hp / e.maxHp, team);
  }
}

/** Units still drawn from walk/attack frames; everyone else uses the sharper painted views + procedural motion. */
const FRAME_ANIM = new Set(["swarmlings"]);

const p_walk = (t: number, id: number) => Math.sin(t * 10 + id * 1.7);
const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

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
