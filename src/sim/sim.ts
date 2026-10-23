// Deterministic authoritative simulation. Shared by server and client.
//
// Determinism rules (keep these when editing):
//  - Integer math only for anything that affects state (Math.trunc on divisions).
//  - No Math.random, Date, or iteration over unordered collections.
//  - Entities are processed in ascending id order.
//  - Math.sqrt is allowed: IEEE-754 sqrt is exactly rounded, so it is identical everywhere.

import { CARDS, DEFAULT_DECK, type CardDef, type TargetMode } from "./cards";
import { Rng } from "./rng";

// ---------------------------------------------------------------- constants
export const TICK_RATE = 20;
export const REGULATION_TICKS = 180 * TICK_RATE; // 3:00
export const OVERTIME_TICKS = 60 * TICK_RATE; // 1:00 sudden death
export const DOUBLE_ELIXIR_AT = 120 * TICK_RATE; // last minute of regulation
export const ELIXIR_UNIT = 56; // 1 elixir = 56 points; +1 point/tick = 2.8s per elixir
export const MAX_ELIXIR = 10 * ELIXIR_UNIT;
export const START_ELIXIR = 5 * ELIXIR_UNIT;
export const DEPLOY_TICKS = 20; // 1s deploy time
export const SPELL_DELAY = 12;

export const ARENA_W = 18000;
export const ARENA_H = 32000;
export const MID_Y = 16000;
export const RIVER_TOP = 15000;
export const RIVER_BOTTOM = 17000;
export const BRIDGES = [3500, 14500];
export const BRIDGE_HALF = 1600; // wide enough for two tanks to pass each other
export const LANE_SPLIT_X = 9000;

const PRINCESS = { hp: 1400, damage: 50, hitTicks: 16, range: 7500, radius: 1300 };
const KING = { hp: 2400, damage: 60, hitTicks: 20, range: 7000, radius: 1700 };

// ---------------------------------------------------------------- types
export type PlayerId = 0 | 1;
export type EntityKind = "troop" | "building" | "tower" | "spell";

export interface Entity {
  id: number;
  owner: PlayerId;
  card: string; // card id, or "princess" / "king"
  kind: EntityKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  hitTicks: number;
  range: number;
  sight: number;
  speed: number;
  radius: number;
  flying: boolean;
  targets: TargetMode;
  splash: number;
  cooldown: number;
  deployTicks: number;
  targetId: number;
  lifetime: number; // -1 = permanent
  decayPerTick: number;
  active: boolean; // king tower wakes up when hit or a princess tower falls
  lane: number; // towers: 0 left, 1 right, -1 king
  // spells
  spellRadius: number;
  towerPct: number;
}

export interface PlayerState {
  elixir: number; // in ELIXIR_UNIT points
  hand: string[]; // 4 cards
  queue: string[]; // next cards, queue[0] is "next"
  crowns: number;
}

export interface Input {
  tick: number;
  player: PlayerId;
  card: string;
  x: number;
  y: number;
}

export type SimEvent =
  | { type: "deploy"; owner: PlayerId; card: string; x: number; y: number }
  | { type: "attack"; from: number; to: number; x1: number; y1: number; x2: number; y2: number; splash: number; owner: PlayerId }
  | { type: "spell"; owner: PlayerId; card: string; x: number; y: number; r: number }
  | { type: "death"; owner: PlayerId; kind: EntityKind; x: number; y: number }
  | { type: "crown"; owner: PlayerId }
  | { type: "reject"; player: PlayerId; reason: string };

export type Phase = "regulation" | "overtime" | "over";

export interface GameState {
  seed: number;
  tick: number;
  phase: Phase;
  winner: PlayerId | -1 | null; // -1 draw, null = not finished
  players: [PlayerState, PlayerState];
  entities: Entity[];
  nextId: number;
  events: SimEvent[]; // events from the most recent step (not part of hash)
}

// ---------------------------------------------------------------- helpers
const isqrt = (n: number): number => Math.floor(Math.sqrt(n));
const distSq = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};
/** Mirror a y coordinate for player 1 (top side). */
export const mirrorY = (y: number) => ARENA_H - y;

function baseEntity(id: number, owner: PlayerId, card: string, kind: EntityKind, x: number, y: number): Entity {
  return {
    id, owner, card, kind, x, y,
    hp: 1, maxHp: 1, damage: 0, hitTicks: 1, range: 0, sight: 0, speed: 0, radius: 500,
    flying: false, targets: "any", splash: 0, cooldown: 0, deployTicks: 0, targetId: -1,
    lifetime: -1, decayPerTick: 0, active: true, lane: -1, spellRadius: 0, towerPct: 100,
  };
}

function makeTower(id: number, owner: PlayerId, king: boolean, lane: number): Entity {
  const t = king ? KING : PRINCESS;
  const x = king ? 9000 : BRIDGES[lane];
  const yBottom = king ? 29500 : 25500;
  const y = owner === 0 ? yBottom : mirrorY(yBottom);
  const e = baseEntity(id, owner, king ? "king" : "princess", "tower", x, y);
  e.hp = e.maxHp = t.hp;
  e.damage = t.damage;
  e.hitTicks = t.hitTicks;
  e.range = t.range;
  e.sight = t.range;
  e.radius = t.radius;
  e.lane = lane;
  e.active = !king;
  return e;
}

// ---------------------------------------------------------------- setup
export function createGame(seed: number, decks: [string[], string[]] = [DEFAULT_DECK, DEFAULT_DECK]): GameState {
  // Both players' card order comes from the same seed: identical draw luck in a mirror match.
  const players = [0, 1].map((p) => {
    const order = new Rng(seed).shuffle([...decks[p]]);
    return { elixir: START_ELIXIR, hand: order.slice(0, 4), queue: order.slice(4), crowns: 0 };
  }) as [PlayerState, PlayerState];

  const entities: Entity[] = [];
  let id = 1;
  for (const owner of [0, 1] as PlayerId[]) {
    entities.push(makeTower(id++, owner, false, 0));
    entities.push(makeTower(id++, owner, false, 1));
    entities.push(makeTower(id++, owner, true, -1));
  }
  return { seed: seed >>> 0, tick: 0, phase: "regulation", winner: null, players, entities, nextId: id, events: [] };
}

// ---------------------------------------------------------------- deploy rules
function princessAlive(s: GameState, owner: PlayerId, lane: number): boolean {
  return s.entities.some((e) => e.kind === "tower" && e.owner === owner && e.lane === lane && e.hp > 0);
}

/** Can `player` place a troop/building at (x,y)? Spells may go anywhere in the arena. */
export function canDeployAt(s: GameState, player: PlayerId, kind: string, x: number, y: number): boolean {
  if (x < 500 || x > ARENA_W - 500 || y < 500 || y > ARENA_H - 500) return false;
  if (kind === "spell") return true;
  const ownSide = player === 0 ? y >= RIVER_BOTTOM + 500 : y <= RIVER_TOP - 500;
  if (ownSide) return !overlapsTower(s, x, y);
  // Pocket: once an enemy princess tower falls, you may deploy in that lane on the enemy side.
  const enemy: PlayerId = player === 0 ? 1 : 0;
  const lane = x < LANE_SPLIT_X ? 0 : 1;
  if (princessAlive(s, enemy, lane)) return false;
  const pocketOk = player === 0 ? y >= 10500 && y <= RIVER_TOP - 500 : y <= ARENA_H - 10500 && y >= RIVER_BOTTOM + 500;
  return pocketOk && !overlapsTower(s, x, y);
}

/** Only the tile a tower stands on is blocked. Troops placed right next to or behind a tower
 *  are allowed; they get nudged clear of its walls while they drop in. */
function overlapsTower(s: GameState, x: number, y: number): boolean {
  for (const e of s.entities) {
    const block = Math.trunc((e.radius * 55) / 100);
    if (e.kind === "tower" && e.hp > 0 && distSq(x, y, e.x, e.y) < block * block) return true;
  }
  return false;
}

// Fixed spawn formations for multi-unit cards (no trig at runtime = deterministic), at spread 900.
const FORMATIONS: Record<number, number[][]> = {
  2: [[-650, 0], [650, 0]],
  3: [[0, -600], [-560, 380], [560, 380]],
  6: [[0, -900], [780, -450], [780, 450], [0, 900], [-780, 450], [-780, -450]],
};

function applyInput(s: GameState, inp: Input): void {
  const reject = (reason: string): void => {
    s.events.push({ type: "reject", player: inp.player, reason });
  };
  if (inp.player !== 0 && inp.player !== 1) return;
  const p = s.players[inp.player];
  const def = CARDS[inp.card];
  if (!def) return reject("unknown card");
  const slot = p.hand.indexOf(inp.card);
  if (slot < 0) return reject("card not in hand");
  if (!Number.isInteger(inp.x) || !Number.isInteger(inp.y)) return reject("bad position");
  if (p.elixir < def.cost * ELIXIR_UNIT) return reject("not enough elixir");
  if (!canDeployAt(s, inp.player, def.kind, inp.x, inp.y)) return reject("invalid placement");

  p.elixir -= def.cost * ELIXIR_UNIT;
  p.hand[slot] = p.queue.shift()!;
  p.queue.push(inp.card);
  s.events.push({ type: "deploy", owner: inp.player, card: inp.card, x: inp.x, y: inp.y });

  if (def.kind === "spell") {
    const e = baseEntity(s.nextId++, inp.player, def.id, "spell", inp.x, inp.y);
    e.damage = def.damage!;
    e.spellRadius = def.spellRadius!;
    e.towerPct = def.towerPct ?? 100;
    e.deployTicks = def.delay ?? SPELL_DELAY;
    s.entities.push(e);
    return;
  }
  const count = def.count ?? 1;
  for (let i = 0; i < count; i++) {
    let x = inp.x;
    let y = inp.y;
    if (count > 1) {
      const sp = def.spread ?? 900;
      const f = FORMATIONS[count] ?? FORMATIONS[6];
      x += Math.trunc((f[i % f.length][0] * sp) / 900);
      y += Math.trunc((f[i % f.length][1] * sp) / 900);
      x = Math.max(300, Math.min(ARENA_W - 300, x));
    }
    s.entities.push(spawnUnit(s.nextId++, inp.player, def, x, y));
  }
}

function spawnUnit(id: number, owner: PlayerId, def: CardDef, x: number, y: number): Entity {
  const e = baseEntity(id, owner, def.id, def.kind === "building" ? "building" : "troop", x, y);
  e.hp = e.maxHp = def.hp!;
  e.damage = def.damage!;
  e.hitTicks = def.hitTicks!;
  e.range = def.range!;
  e.sight = def.sight ?? def.range!;
  e.speed = def.speed ?? 0;
  e.radius = def.radius ?? 500;
  e.flying = !!def.flying;
  e.targets = def.targets ?? "any";
  e.splash = def.splash ?? 0;
  e.deployTicks = DEPLOY_TICKS;
  if (def.lifetime) {
    e.lifetime = def.lifetime;
    e.decayPerTick = Math.ceil(e.maxHp / def.lifetime);
  }
  return e;
}

// ---------------------------------------------------------------- targeting
function canTarget(a: Entity, b: Entity): boolean {
  if (b.owner === a.owner || b.hp <= 0 || b.kind === "spell") return false;
  if (a.targets === "buildings") return b.kind === "building" || b.kind === "tower";
  if (a.targets === "ground") return !b.flying;
  return true;
}

function edgeDistSq(a: Entity, b: Entity): number {
  // distance from a's center to b's edge, squared (clamped at 0)
  const d = isqrt(distSq(a.x, a.y, b.x, b.y)) - b.radius;
  return d <= 0 ? 0 : d * d;
}

function nearestTarget(s: GameState, a: Entity, maxDist: number): Entity | null {
  let best: Entity | null = null;
  let bestD = maxDist * maxDist;
  for (const b of s.entities) {
    if (!canTarget(a, b)) continue;
    const d = edgeDistSq(a, b);
    if (d <= bestD) {
      if (d === bestD && best && b.id > best.id) continue; // tie-break: lowest id
      best = b;
      bestD = d;
    }
  }
  return best;
}

/** Where a troop walks when nothing is in sight: enemy princess tower on its lane, else king. */
function defaultTarget(s: GameState, a: Entity): Entity | null {
  const enemy: PlayerId = a.owner === 0 ? 1 : 0;
  const lane = a.x < LANE_SPLIT_X ? 0 : 1;
  let king: Entity | null = null;
  let other: Entity | null = null;
  for (const e of s.entities) {
    if (e.kind !== "tower" || e.owner !== enemy || e.hp <= 0) continue;
    if (e.lane === lane) return e;
    if (e.lane === -1) king = e;
    else other = e;
  }
  return king ?? other;
}

function byId(s: GameState, id: number): Entity | undefined {
  // entities are kept sorted by id; binary search
  let lo = 0;
  let hi = s.entities.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = s.entities[mid];
    if (e.id === id) return e;
    if (e.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

// ---------------------------------------------------------------- movement
const side = (y: number) => (y < MID_Y ? 1 : 0);

function waypoint(a: Entity, tx: number, ty: number): [number, number] {
  if (a.flying) return [tx, ty];
  const inRiver = a.y > RIVER_TOP && a.y < RIVER_BOTTOM;
  if (!inRiver && side(a.y) === side(ty)) return [tx, ty];
  // must cross (or is on) the river: use the nearest bridge
  const bx = Math.abs(a.x - BRIDGES[0]) <= Math.abs(a.x - BRIDGES[1]) ? BRIDGES[0] : BRIDGES[1];
  const goingUp = ty < a.y;
  const nearEdge = goingUp ? RIVER_BOTTOM + 100 : RIVER_TOP - 100;
  const farEdge = goingUp ? RIVER_TOP - 100 : RIVER_BOTTOM + 100;
  // Units cross in parallel lanes across the bridge's width (not a single point), so
  // troops arriving from both sides don't converge and deadlock.
  const half = Math.max(0, BRIDGE_HALF - a.radius);
  const laneX = Math.max(bx - half, Math.min(bx + half, a.x));
  const atEntry = Math.abs(a.x - laneX) <= 60 && (goingUp ? a.y <= nearEdge + 200 : a.y >= nearEdge - 200);
  if (inRiver || atEntry) {
    if (goingUp ? a.y <= farEdge : a.y >= farEdge) return [tx, ty];
    // on the bridge, walk straight across in whatever lane we're in, so units going opposite
    // ways (e.g. two tanks) slide past each other instead of both crowding the center line
    const keepX = inRiver ? Math.max(bx - BRIDGE_HALF + 150, Math.min(bx + BRIDGE_HALF - 150, a.x)) : laneX;
    return [keepX, farEdge];
  }
  return [laneX, nearEdge];
}

/**
 * Steer ground troops around towers and buildings that sit between them and where they're going,
 * instead of walking into the wall and getting pushed back (e.g. a troop placed right behind a tower).
 * Picks the nearest blocking obstacle ahead and heads for a point just beside it; integer math only.
 */
function avoidObstacles(s: GameState, a: Entity, target: Entity, wx: number, wy: number): [number, number] {
  if (a.flying) return [wx, wy];
  const dx = wx - a.x;
  const dy = wy - a.y;
  const D = isqrt(dx * dx + dy * dy);
  if (D === 0) return [wx, wy];
  let best: Entity | null = null;
  let bestAlong = 0;
  let bestSide = 0;
  for (const b of s.entities) {
    if (b === target || b.hp <= 0 || (b.kind !== "tower" && b.kind !== "building")) continue;
    const ox = b.x - a.x;
    const oy = b.y - a.y;
    const along = Math.trunc((ox * dx + oy * dy) / D); // distance ahead along the path
    const clear = b.radius + a.radius + 120;
    if (along <= -a.radius || along > Math.min(D, 4500) + b.radius) continue;
    const side = Math.trunc((ox * -dy + oy * dx) / D); // signed distance of the obstacle from the path
    if (Math.abs(side) >= clear) continue;
    if (best === null || along < bestAlong || (along === bestAlong && b.id < best.id)) {
      best = b;
      bestAlong = along;
      bestSide = side;
    }
  }
  if (!best) return [wx, wy];
  // pass on the side the obstacle isn't on; dead-center goes toward the middle of the arena
  let dir = bestSide > 0 ? -1 : bestSide < 0 ? 1 : 0;
  if (dir === 0) {
    const toCenter = (LANE_SPLIT_X - a.x) * -dy; // which normal points toward the arena center
    dir = toCenter > 0 ? 1 : toCenter < 0 ? -1 : a.id % 2 ? 1 : -1;
  }
  const clear = best.radius + a.radius + 240;
  const nx = Math.trunc((-dy * clear) / D) * dir;
  const ny = Math.trunc((dx * clear) / D) * dir;
  // aim beside the obstacle and a little past it, so the unit keeps moving forward
  const fx = Math.trunc((dx * 300) / D);
  const fy = Math.trunc((dy * 300) / D);
  let tx = best.x + nx + fx;
  const ty = best.y + ny + fy;
  tx = Math.max(a.radius, Math.min(ARENA_W - a.radius, tx));
  return [tx, ty];
}

function moveToward(a: Entity, tx: number, ty: number): void {
  const dx = tx - a.x;
  const dy = ty - a.y;
  const d = isqrt(dx * dx + dy * dy);
  if (d <= a.speed) {
    a.x = tx;
    a.y = ty;
    return;
  }
  a.x += Math.trunc((dx * a.speed) / d);
  a.y += Math.trunc((dy * a.speed) / d);
}

function separate(s: GameState): void {
  const ents = s.entities;
  for (let i = 0; i < ents.length; i++) {
    const a = ents[i];
    if (a.kind !== "troop" || a.hp <= 0) continue;
    for (let j = 0; j < ents.length; j++) {
      if (i === j) continue;
      const b = ents[j];
      if (b.hp <= 0 || b.kind === "spell") continue;
      if (a.flying !== b.flying && b.kind === "troop") continue;
      if (a.flying && b.kind !== "troop") continue; // flyers pass over buildings
      const isStatic = b.kind !== "troop";
      if (!isStatic && j < i) continue; // each troop pair handled once
      const minD = a.radius + b.radius;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      const dsq = dx * dx + dy * dy;
      if (dsq >= minD * minD) continue;
      let d = isqrt(dsq);
      if (Math.abs(dx) < 60) {
        // head-on / stacked: add a deterministic sideways component so bodies slide past
        // each other instead of deadlocking (e.g. two tanks meeting on a bridge)
        if (isStatic) dx = a.x < LANE_SPLIT_X ? 100 : -100;
        else dx = a.id < b.id ? -100 : 100;
        if (d === 0) dy = 0;
        d = isqrt(dx * dx + dy * dy);
      }
      const overlap = minD - isqrt(dsq);
      if (isStatic) {
        a.x += Math.trunc((dx * overlap) / d);
        a.y += Math.trunc((dy * overlap) / d);
      } else {
        const push = Math.max(1, overlap >> 1);
        const px = Math.trunc((dx * push) / d);
        const py = Math.trunc((dy * push) / d);
        a.x += px; a.y += py;
        b.x -= px; b.y -= py;
        clamp(b);
      }
      clamp(a);
    }
  }
}

function clamp(e: Entity): void {
  e.x = Math.max(e.radius, Math.min(ARENA_W - e.radius, e.x));
  e.y = Math.max(e.radius, Math.min(ARENA_H - e.radius, e.y));
  if (!e.flying && e.y > RIVER_TOP && e.y < RIVER_BOTTOM) {
    const bx = Math.abs(e.x - BRIDGES[0]) <= Math.abs(e.x - BRIDGES[1]) ? BRIDGES[0] : BRIDGES[1];
    if (Math.abs(e.x - bx) > BRIDGE_HALF) {
      // keep ground units out of the water: snap onto the bridge edge
      e.x = e.x < bx ? bx - BRIDGE_HALF : bx + BRIDGE_HALF;
    }
  }
}

// ---------------------------------------------------------------- combat
function dealDamage(s: GameState, src: Entity, target: Entity, amount: number): void {
  target.hp -= amount;
  if (target.card === "king" && !target.active) target.active = true;
}

function attack(s: GameState, a: Entity, t: Entity): void {
  s.events.push({ type: "attack", from: a.id, to: t.id, x1: a.x, y1: a.y, x2: t.x, y2: t.y, splash: a.splash, owner: a.owner });
  if (a.splash > 0) {
    const r2 = a.splash * a.splash;
    for (const b of s.entities) {
      if (b === t || !canTarget(a, b) || b.flying !== t.flying) continue;
      if (distSq(b.x, b.y, t.x, t.y) <= r2) dealDamage(s, a, b, a.damage);
    }
  }
  dealDamage(s, a, t, a.damage);
}

function explodeSpell(s: GameState, sp: Entity): void {
  const r2 = sp.spellRadius * sp.spellRadius;
  s.events.push({ type: "spell", owner: sp.owner, card: sp.card, x: sp.x, y: sp.y, r: sp.spellRadius });
  for (const b of s.entities) {
    if (b.owner === sp.owner || b.hp <= 0 || b.kind === "spell") continue;
    // count the target's body: hit if the blast circle touches it
    const reach = sp.spellRadius + b.radius;
    if (distSq(b.x, b.y, sp.x, sp.y) > reach * reach) continue;
    const dmg = b.kind === "tower" ? Math.trunc((sp.damage * sp.towerPct) / 100) : sp.damage;
    dealDamage(s, sp, b, dmg);
  }
  sp.hp = 0;
}

function updateEntity(s: GameState, a: Entity): void {
  if (a.hp <= 0) return;
  if (a.cooldown > 0) a.cooldown--;
  if (a.deployTicks > 0) {
    a.deployTicks--;
    if (a.kind === "spell" && a.deployTicks === 0) explodeSpell(s, a);
    return;
  }
  if (a.kind === "spell") return;
  if (a.kind === "tower" && !a.active) return;

  // --- choose target
  let t = a.targetId >= 0 ? byId(s, a.targetId) : undefined;
  if (t && !canTarget(a, t)) t = undefined;
  const mobile = a.kind === "troop";
  if (t) {
    const inRange = edgeDistSq(a, t) <= a.range * a.range;
    if (!inRange) {
      // static shooters drop targets that leave range; troops chasing a troop stay locked,
      // but troops walking toward a building re-check for anything closer (this is the "pull")
      if (!mobile) t = undefined;
      else if (t.kind !== "troop") t = nearestTarget(s, a, a.sight) ?? t;
    }
  }
  if (!t) {
    t = nearestTarget(s, a, mobile ? a.sight : a.range) ?? undefined;
    if (!t && mobile) t = defaultTarget(s, a) ?? undefined;
  }
  const newId = t ? t.id : -1;
  if (newId !== a.targetId) {
    a.targetId = newId;
    a.cooldown = Math.max(a.cooldown, a.hitTicks >> 1); // first-hit windup
  }
  if (!t) return;

  // --- attack or move
  if (edgeDistSq(a, t) <= a.range * a.range) {
    if (a.cooldown === 0) {
      attack(s, a, t);
      a.cooldown = a.hitTicks;
    }
  } else if (mobile) {
    const [px, py] = waypoint(a, t.x, t.y);
    const [wx, wy] = avoidObstacles(s, a, t, px, py);
    moveToward(a, wx, wy);
    clamp(a);
  }
}

// ---------------------------------------------------------------- step
/**
 * Advance one tick. `inputs` = inputs stamped for this tick (any order; sorted here).
 * Returns the same state object (mutated).
 */
export function step(s: GameState, inputs: Input[] = []): GameState {
  s.events = [];
  if (s.phase === "over") return s;

  const due = inputs
    .filter((i) => i.tick === s.tick)
    .map((inp, idx) => ({ inp, idx }))
    .sort((a, b) => a.inp.player - b.inp.player || a.idx - b.idx);
  for (const { inp } of due) applyInput(s, inp);

  // elixir
  const rate = s.tick >= DOUBLE_ELIXIR_AT ? 2 : 1;
  for (const p of s.players) p.elixir = Math.min(MAX_ELIXIR, p.elixir + rate);

  // buildings decay
  for (const e of s.entities) {
    if (e.kind === "building" && e.deployTicks === 0 && e.hp > 0) {
      e.hp -= e.decayPerTick;
      if (e.lifetime > 0) e.lifetime--;
      if (e.lifetime === 0) e.hp = 0;
    }
  }

  for (let i = 0; i < s.entities.length; i++) updateEntity(s, s.entities[i]);
  separate(s);

  // deaths, crowns, king activation
  const survivors: Entity[] = [];
  for (const e of s.entities) {
    if (e.hp > 0) {
      survivors.push(e);
      continue;
    }
    if (e.kind !== "spell") s.events.push({ type: "death", owner: e.owner, kind: e.kind, x: e.x, y: e.y });
    if (e.kind === "tower") {
      const scorer: PlayerId = e.owner === 0 ? 1 : 0;
      if (e.card === "king") {
        s.players[scorer].crowns = 3;
      } else {
        s.players[scorer].crowns = Math.min(3, s.players[scorer].crowns + 1);
        for (const k of s.entities) if (k.card === "king" && k.owner === e.owner) k.active = true;
      }
      s.events.push({ type: "crown", owner: scorer });
    }
  }
  s.entities = survivors;

  s.tick++;
  resolvePhase(s);
  return s;
}

function resolvePhase(s: GameState): void {
  const [a, b] = [s.players[0].crowns, s.players[1].crowns];
  const end = (w: PlayerId | -1) => {
    s.phase = "over";
    s.winner = w;
  };
  if (a === 3 || b === 3) return end(a === 3 ? (b === 3 ? -1 : 0) : 1);
  if (s.phase === "regulation" && s.tick >= REGULATION_TICKS) {
    if (a !== b) return end(a > b ? 0 : 1);
    s.phase = "overtime";
    return;
  }
  if (s.phase === "overtime") {
    if (a !== b) return end(a > b ? 0 : 1);
    if (s.tick >= REGULATION_TICKS + OVERTIME_TICKS) {
      // tiebreaker: the player whose weakest tower has more HP left wins
      const minHp = (o: PlayerId) =>
        Math.min(...s.entities.filter((e) => e.kind === "tower" && e.owner === o).map((e) => e.hp));
      const m0 = minHp(0);
      const m1 = minHp(1);
      end(m0 === m1 ? -1 : m0 > m1 ? 0 : 1);
    }
  }
}

// ---------------------------------------------------------------- hashing
const CARD_CODES: Record<string, number> = { princess: 1, king: 2 };
Object.keys(CARDS).forEach((k, i) => (CARD_CODES[k] = 10 + i));
const KIND_CODES: Record<EntityKind, number> = { troop: 1, building: 2, tower: 3, spell: 4 };
const PHASE_CODES: Record<Phase, number> = { regulation: 1, overtime: 2, over: 3 };

/** FNV-1a over every gameplay-relevant field. Used for replay checks and desync detection. */
export function hashState(s: GameState): number {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    let v = n | 0;
    for (let i = 0; i < 4; i++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      v >>>= 8;
    }
  };
  mix(s.tick); mix(PHASE_CODES[s.phase]); mix(s.winner === null ? 9 : s.winner); mix(s.nextId);
  for (const p of s.players) {
    mix(p.elixir); mix(p.crowns);
    for (const c of p.hand) mix(CARD_CODES[c]);
    for (const c of p.queue) mix(CARD_CODES[c]);
  }
  mix(s.entities.length);
  for (const e of s.entities) {
    mix(e.id); mix(e.owner); mix(CARD_CODES[e.card]); mix(KIND_CODES[e.kind]);
    mix(e.x); mix(e.y); mix(e.hp); mix(e.cooldown); mix(e.deployTicks); mix(e.targetId);
    mix(e.lifetime); mix(e.active ? 1 : 0);
  }
  return h >>> 0;
}

/** Run a full match from a seed and an input log. Used by replays and the server. */
export function replay(
  seed: number, inputs: Input[], decks: [string[], string[]] = [DEFAULT_DECK, DEFAULT_DECK],
  maxTicks = REGULATION_TICKS + OVERTIME_TICKS + 1,
) {
  const s = createGame(seed, decks);
  const byTick = new Map<number, Input[]>();
  for (const i of inputs) {
    const arr = byTick.get(i.tick) ?? [];
    arr.push(i);
    byTick.set(i.tick, arr);
  }
  const hashes: number[] = [];
  while (s.phase !== "over" && s.tick < maxTicks) {
    step(s, byTick.get(s.tick) ?? []);
    hashes.push(hashState(s));
  }
  return { state: s, hashes };
}
