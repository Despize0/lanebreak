// Balance / sanity sweep: npm run sim -- 300 [random]
//   default: mirror matches with the default deck
//   random:  each side gets a random 8-card deck; prints per-card win rates
import { playBotMatch } from "../src/sim/match";
import { CARD_LIST, DEFAULT_DECK } from "../src/sim/cards";
import { Rng } from "../src/sim/rng";
import { replay, TICK_RATE } from "../src/sim/sim";

const n = Number(process.argv[2] ?? 100);
const random = process.argv[3] === "random";
const wins = { 0: 0, 1: 0, draw: 0 };
const plays: Record<string, number> = {};
const inDeck: Record<string, { games: number; wins: number }> = {};
let totalTicks = 0;
let overtime = 0;
let crowns3 = 0;
let mismatches = 0;
const deckRng = new Rng(2024);
const randomDeck = () => deckRng.shuffle([...CARD_LIST]).slice(0, 8);
const t0 = performance.now();
for (let i = 0; i < n; i++) {
  const seed = 1000 + i * 7919;
  const decks: [string[], string[]] = random ? [randomDeck(), randomDeck()] : [DEFAULT_DECK, DEFAULT_DECK];
  const m = playBotMatch(seed, [seed + 1, seed + 2], decks);
  const w = m.state.winner;
  if (w === -1) wins.draw++;
  else wins[w as 0 | 1]++;
  totalTicks += m.state.tick;
  if (m.state.tick > 180 * TICK_RATE) overtime++;
  if (m.state.players.some((p) => p.crowns === 3)) crowns3++;
  for (const inp of m.inputs) plays[inp.card] = (plays[inp.card] ?? 0) + 1;
  if (random && w !== -1) {
    for (const p of [0, 1]) {
      for (const c of decks[p]) {
        inDeck[c] ??= { games: 0, wins: 0 };
        inDeck[c].games++;
        if (w === p) inDeck[c].wins++;
      }
    }
  }
  const r = replay(seed, m.inputs, decks);
  if (r.hashes[r.hashes.length - 1] !== m.hashes[m.hashes.length - 1]) mismatches++;
}
const ms = performance.now() - t0;
console.log(`matches: ${n}${random ? " (random decks)" : ""}`);
console.log(`wins p0/p1/draw: ${wins[0]}/${wins[1]}/${wins.draw}`);
console.log(`avg length: ${(totalTicks / n / TICK_RATE).toFixed(1)}s, overtime: ${overtime}, 3-crown: ${crowns3}`);
console.log(`card plays:`, plays);
if (random) {
  console.log("win rate when in deck:");
  for (const [c, v] of Object.entries(inDeck).sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games)) {
    console.log(`  ${c.padEnd(12)} ${((100 * v.wins) / v.games).toFixed(1)}%  (${v.games} games)`);
  }
}
console.log(`replay mismatches: ${mismatches}`);
console.log(`sim speed: ${((totalTicks * 2) / (ms / 1000)).toFixed(0)} ticks/s (incl. replays)`);
