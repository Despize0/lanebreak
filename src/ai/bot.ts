// Rule-based opponent. It only reads state and emits Inputs, exactly like a human client,
// so the server validates its moves the same way. Deterministic given its own seed.
// Decisions are made from card *roles* (tank, swarm, splash, anti-air…), so it plays any deck.

import { CARDS, type CardDef } from "../sim/cards";
import { Rng } from "../sim/rng";
import {
  BRIDGES, ELIXIR_UNIT, MID_Y, mirrorY, canDeployAt,
  type Entity, type GameState, type Input, type PlayerId,
} from "../sim/sim";

export interface BotOptions {
  seed: number;
  thinkEvery?: number; // ticks between decisions (higher = slower/easier)
  pushAt?: number; // aether level at which it starts an attack
}

const isTank = (d: CardDef) => d.kind === "troop" && (d.targets === "buildings" || (d.hp ?? 0) >= 2500);
const isSwarm = (d: CardDef) => d.kind === "troop" && (d.count ?? 1) >= 3;
const hitsAir = (d: CardDef) => d.kind !== "spell" && d.targets === "any";
const isRanged = (d: CardDef) => d.kind === "troop" && (d.range ?? 0) >= 3500;
const dps = (d: CardDef) => ((d.damage ?? 0) * (d.count ?? 1) * 20) / (d.hitTicks ?? 20);

export class Bot {
  private rng: Rng;
  private thinkEvery: number;
  private pushAt: number;
  private phase: number;
  constructor(readonly player: PlayerId, opts: BotOptions) {
    this.rng = new Rng(opts.seed ^ (player === 0 ? 0x1234 : 0x9876));
    this.thinkEvery = opts.thinkEvery ?? 10;
    this.pushAt = opts.pushAt ?? 9;
    this.phase = this.rng.int(this.thinkEvery); // random decision phase so neither side always reacts second
  }

  /** Bot-perspective y (bottom = own side) -> world y. */
  private wy(y: number): number {
    return this.player === 0 ? y : mirrorY(y);
  }
  private mine(y: number): boolean {
    return this.player === 0 ? y >= MID_Y : y < MID_Y;
  }
  /** How far an entity has advanced toward MY king, 0..32000 (bot perspective y). */
  private depth(e: Entity): number {
    return this.player === 0 ? e.y : mirrorY(e.y);
  }

  decide(s: GameState): Input | null {
    if (s.phase === "over") return null;
    if ((s.tick + this.phase) % this.thinkEvery !== 0) return null;
    const me = s.players[this.player];
    const elixir = Math.floor(me.elixir / ELIXIR_UNIT);
    const hand = me.hand.map((id) => CARDS[id]).filter((d) => d.cost <= elixir);
    if (!hand.length) return null;
    const play = (d: CardDef | undefined, x: number, yBot: number): Input | null => {
      if (!d) return null;
      const y = this.wy(yBot);
      if (!canDeployAt(s, this.player, d.kind, x, y)) return null;
      return { tick: s.tick, player: this.player, card: d.id, x, y };
    };
    const pick = (f: (d: CardDef) => boolean, by: (d: CardDef) => number = (d) => d.cost) =>
      hand.filter(f).sort((a, b) => by(a) - by(b) || a.id.localeCompare(b.id))[0];
    const first = (...opts: (Input | null)[]) => opts.find((o) => o) ?? null;
    const spells = hand.filter((d) => d.kind === "spell");

    const enemies = s.entities.filter((e) => e.owner !== this.player && e.hp > 0);
    const threats = enemies.filter((e) => e.kind === "troop" && this.depth(e) > 13500);
    const enemyTowers = enemies.filter((e) => e.kind === "tower");

    // 1) Finish a low tower with a spell
    for (const t of enemyTowers) {
      for (const sp of spells) {
        if (t.hp <= Math.trunc(((sp.damage ?? 0) * (sp.towerPct ?? 100)) / 100)) {
          const r = play(sp, t.x, this.depth(t));
          if (r) return r;
        }
      }
    }

    // 2) Defend
    if (threats.length > 0) {
      threats.sort((a, b) => this.depth(b) - this.depth(a) || a.id - b.id);
      const lead = threats[0];
      const laneX = lead.x < 9000 ? BRIDGES[0] : BRIDGES[1];
      // clustered small units -> the cheapest spell that covers them
      for (const sp of [...spells].sort((a, b) => a.cost - b.cost)) {
        const rad = sp.spellRadius ?? 2000;
        const cluster = threats.filter((e) => (e.x - lead.x) ** 2 + (e.y - lead.y) ** 2 < rad * rad);
        const killable = cluster.filter((e) => e.hp <= (sp.damage ?? 0)).length;
        if (killable >= 3 || (cluster.length >= 3 && cluster.reduce((n, e) => n + e.hp, 0) >= 300 + sp.cost * 100)) {
          const r = play(sp, lead.x, this.depth(lead));
          if (r) return r;
        }
      }
      // don't over-commit: only answer if the threat isn't already being handled
      const defenders = s.entities.filter((e) => e.owner === this.player && e.kind !== "tower" && e.hp > 0 && this.mine(e.y));
      const threatHp = threats.reduce((sum, e) => sum + e.hp, 0);
      const defHp = defenders.reduce((sum, e) => sum + e.hp, 0);
      if (defHp < threatHp * 0.8) {
        const defY = Math.min(23000, Math.max(19500, this.depth(lead) + 2500));
        const sideX = laneX + (laneX < 9000 ? 1800 : -1800);
        const leadDef = CARDS[lead.card];
        const troop = (d: CardDef) => d.kind !== "spell";
        if (lead.flying) {
          return first(
            play(pick((d) => troop(d) && hitsAir(d) && isRanged(d)), sideX, defY + 1500),
            play(pick((d) => troop(d) && hitsAir(d)), d2x(lead.x), defY),
          );
        }
        if (leadDef && isTank(leadDef)) {
          return first(
            play(pick((d) => d.kind === "building"), 9000, 21500),
            play(pick((d) => troop(d) && !isTank(d), (d) => -dps(d) / d.cost), lead.x, defY),
          );
        }
        if (leadDef && (leadDef.count ?? 1) >= 3) {
          return first(
            play(pick((d) => troop(d) && (d.splash ?? 0) > 0), sideX, defY + 1500),
            play(pick((d) => troop(d) && !isTank(d) && d.kind === "troop"), lead.x, defY),
          );
        }
        return first(
          play(pick((d) => d.kind === "troop" && !isTank(d) && d.targets !== "buildings"), lead.x, defY),
          play(pick((d) => d.kind === "building"), 9000, 21500),
        );
      }
    }

    // 3) Support an existing push
    const attackers = s.entities.filter((e) => e.owner === this.player && e.kind === "troop" && e.hp > 0 && !this.mine(e.y));
    if (attackers.length > 0 && elixir >= 5) {
      const lead = attackers[0];
      const laneX = lead.x < 9000 ? BRIDGES[0] : BRIDGES[1];
      const r = play(pick((d) => d.kind === "troop" && (isRanged(d) || !!d.flying) && !isTank(d)), laneX, 18000);
      if (r && this.rng.int(3) > 0) return r;
    }

    // 4) Start a push when aether is (nearly) full
    if (elixir >= this.pushAt) {
      const weak = [...enemyTowers].filter((t) => t.lane >= 0).sort((a, b) => a.hp - b.hp || a.id - b.id)[0];
      let laneX = weak ? weak.x : BRIDGES[this.rng.int(2)];
      if (this.rng.int(4) === 0) laneX = BRIDGES[this.rng.int(2)];
      const tank = pick(isTank, (d) => -(d.hp ?? 0));
      return first(
        tank && (tank.speed ?? 50) <= 40 ? play(tank, laneX, 30500) ?? play(tank, laneX, 21000) : play(tank, laneX, 18200),
        play(pick((d) => d.kind === "troop" && !isRanged(d)), laneX, 18200),
        play(pick((d) => d.kind === "troop"), laneX, 21000),
      );
    }
    return null;
  }
}

/** keep defensive placements on the board (tile centers) */
const d2x = (x: number) => Math.max(500, Math.min(17500, Math.floor(x / 1000) * 1000 + 500));
