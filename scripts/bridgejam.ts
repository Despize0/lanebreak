// Dev check: how long big units take to get across a bridge when they meet head-on.
// npx tsx scripts/bridgejam.ts
import { createGame, step, ELIXIR_UNIT, type Input } from "../src/sim/sim";

const big = ["colossus", "ironhide", "brute", "warden"];
const deck = (cs: string[]) => [...cs, ...["zap", "wisps", "cannon", "ember", "skywing", "swarmlings", "bulwark", "sparkcaster"].filter((k) => !cs.includes(k))].slice(0, 8);
let worst = 0;
let stuck = 0;
let runs = 0;
const times: number[] = [];
for (const a of big) for (const a2 of big) for (const b of big) for (const b2 of big) {
  if (a === a2 || b === b2) continue;
  for (const lx of [3500, 14500]) {
    const s = createGame(5, [deck([a, a2]), deck([b, b2])]);
    s.players[0].elixir = 20 * ELIXIR_UNIT;
    s.players[1].elixir = 20 * ELIXIR_UNIT;
    s.players[0].hand[0] = a; s.players[0].hand[1] = a2;
    s.players[1].hand[0] = b; s.players[1].hand[1] = b2;
    const inputs: Input[] = [
      { tick: 0, player: 0, card: a, x: lx - 400, y: 19500 },
      { tick: 0, player: 0, card: a2, x: lx + 400, y: 20500 },
      { tick: 0, player: 1, card: b, x: lx + 300, y: 12500 },
      { tick: 0, player: 1, card: b2, x: lx - 300, y: 11500 },
    ];
    step(s, inputs);
    let done = -1;
    const over = new Set<number>();
    for (let t = 0; t < 2000; t++) {
      step(s);
      const mine = s.entities.filter((e) => e.kind === "troop" && big.includes(e.card));
      for (const e of mine) if (e.owner === 0 ? e.y < 15000 : e.y > 17000) over.add(e.id);
      const left = mine.filter((e) => !over.has(e.id));
      if (left.length === 0 || s.winner !== null) { done = t; break; }
    }
    runs++;
    if (done < 0) { stuck++; if (process.env.V) console.log('stuck', a, a2, b, b2, lx); }
    else { worst = Math.max(worst, done); times.push(done); }
  }
}
times.sort((x, y) => x - y);
console.log(`runs ${runs}  stuck ${stuck}  median ${(times[times.length >> 1] / 20).toFixed(1)}s  worst ${(worst / 20).toFixed(1)}s`);
