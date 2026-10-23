// Simple rule-based opponent. It only reads state and emits Inputs, exactly like a human client,
// so the server validates its moves the same way. Deterministic given its own seed.

import { CARDS } from "../sim/cards";
import { Rng } from "../sim/rng";
import {
  BRIDGES, ELIXIR_UNIT, MID_Y, mirrorY, canDeployAt,
  type Entity, type GameState, type Input, type PlayerId,
} from "../sim/sim";

export interface BotOptions {
  seed: number;
  thinkEvery?: number; // ticks between decisions (higher = slower/easier)
  pushAt?: number; // elixir level at which it starts an attack
}

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
    const has = (id: string) => me.hand.includes(id) && CARDS[id].cost <= elixir;
    const play = (card: string, x: number, yBot: number): Input | null => {
      const y = this.wy(yBot);
      if (!has(card) || !canDeployAt(s, this.player, CARDS[card].kind, x, y)) return null;
      return { tick: s.tick, player: this.player, card, x, y };
    };
    const first = (...opts: (Input | null)[]) => opts.find((o) => o) ?? null;

    const enemies = s.entities.filter((e) => e.owner !== this.player && e.hp > 0);
    const threats = enemies.filter((e) => e.kind === "troop" && this.depth(e) > 13500);
    const enemyTowers = enemies.filter((e) => e.kind === "tower");

    // 1) Finish a low tower with a spell
    for (const t of enemyTowers) {
      if (t.hp <= 110) {
        const r = play("ember", t.x, this.player === 0 ? t.y : mirrorY(t.y));
        if (r) return r;
      }
    }

    // 2) Defend
    if (threats.length > 0) {
      threats.sort((a, b) => this.depth(b) - this.depth(a) || a.id - b.id);
      const lead = threats[0];
      const laneX = lead.x < 9000 ? BRIDGES[0] : BRIDGES[1];
      // cluster -> spell
      const cluster = threats.filter((e) => (e.x - lead.x) ** 2 + (e.y - lead.y) ** 2 < 2500 * 2500);
      const clusterValue = cluster.reduce((sum, e) => sum + e.hp, 0);
      if (cluster.length >= 3 && clusterValue >= 300) {
        const r = play("ember", lead.x, this.depth(lead));
        if (r) return r;
      }
      // don't over-commit: only answer if the threat isn't already being handled
      const defenders = s.entities.filter(
        (e) => e.owner === this.player && e.kind !== "tower" && e.hp > 0 && this.mine(e.y),
      );
      const threatHp = threats.reduce((sum, e) => sum + e.hp, 0);
      const defHp = defenders.reduce((sum, e) => sum + e.hp, 0);
      if (defHp < threatHp * 0.8) {
        const defY = Math.min(23000, Math.max(19500, this.depth(lead) + 2500));
        const sideX = laneX + (laneX < 9000 ? 1800 : -1800);
        if (lead.flying) {
          return first(play("sparkcaster", sideX, defY), play("ranger", sideX, defY), play("bulwark", 9000, 21500));
        }
        if (lead.card === "ironhide") {
          return first(
            play("bulwark", 9000, 21500),
            play("swarmlings", lead.x, defY),
            play("brute", lead.x, defY),
            play("ranger", sideX, defY + 1500),
          );
        }
        if (lead.card === "swarmlings") {
          return first(play("sparkcaster", sideX, defY), play("ember", lead.x, this.depth(lead)), play("brute", lead.x, defY));
        }
        return first(
          play("brute", lead.x, defY),
          play("ranger", sideX, defY + 1500),
          play("sparkcaster", sideX, defY + 1500),
          play("swarmlings", lead.x, defY),
          play("bulwark", 9000, 21500),
        );
      }
    }

    // 3) Support an existing push
    const attackers = s.entities.filter(
      (e) => e.owner === this.player && e.kind === "troop" && e.hp > 0 && !this.mine(e.y),
    );
    if (attackers.length > 0 && elixir >= 5) {
      const lead = attackers[0];
      const laneX = lead.x < 9000 ? BRIDGES[0] : BRIDGES[1];
      const r = first(play("sparkcaster", laneX, 18000), play("ranger", laneX, 18000), play("skywing", laneX, 18000));
      if (r && this.rng.int(3) > 0) return r;
    }

    // 4) Start a push when elixir is (nearly) full
    if (elixir >= this.pushAt) {
      const weak = [...enemyTowers].filter((t) => t.lane >= 0).sort((a, b) => a.hp - b.hp || a.id - b.id)[0];
      let laneX = weak ? weak.x : BRIDGES[this.rng.int(2)];
      if (this.rng.int(4) === 0) laneX = BRIDGES[this.rng.int(2)];
      return first(
        play("ironhide", laneX, 30500 - 0) ?? play("ironhide", laneX, 21000),
        play("brute", laneX, 18200),
        play("skywing", laneX, 22000),
        play("swarmlings", laneX, 18200),
        play("ranger", laneX, 21000),
        play("sparkcaster", laneX, 21000),
      );
    }
    return null;
  }
}
