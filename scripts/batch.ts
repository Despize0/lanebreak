// Balance / sanity sweep: npm run sim -- 200
import { playBotMatch } from "../src/sim/match";
import { replay, TICK_RATE } from "../src/sim/sim";

const n = Number(process.argv[2] ?? 100);
const wins = { 0: 0, 1: 0, draw: 0 };
const plays: Record<string, number> = {};
let totalTicks = 0;
let overtime = 0;
let crowns3 = 0;
let mismatches = 0;
const t0 = performance.now();
for (let i = 0; i < n; i++) {
  const seed = 1000 + i * 7919;
  const m = playBotMatch(seed);
  const w = m.state.winner;
  if (w === -1) wins.draw++;
  else wins[w as 0 | 1]++;
  totalTicks += m.state.tick;
  if (m.state.tick > 180 * TICK_RATE) overtime++;
  if (m.state.players.some((p) => p.crowns === 3)) crowns3++;
  for (const inp of m.inputs) plays[inp.card] = (plays[inp.card] ?? 0) + 1;
  const r = replay(seed, m.inputs);
  if (r.hashes[r.hashes.length - 1] !== m.hashes[m.hashes.length - 1]) mismatches++;
}
const ms = performance.now() - t0;
console.log(`matches: ${n}`);
console.log(`wins p0/p1/draw: ${wins[0]}/${wins[1]}/${wins.draw}`);
console.log(`avg length: ${(totalTicks / n / TICK_RATE).toFixed(1)}s, overtime: ${overtime}, 3-crown: ${crowns3}`);
console.log(`card plays:`, plays);
console.log(`replay mismatches: ${mismatches}`);
console.log(`sim speed: ${((totalTicks * 2) / (ms / 1000)).toFixed(0)} ticks/s (incl. replays)`);
