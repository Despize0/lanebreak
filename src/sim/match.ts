// Helpers to run headless bot-vs-bot matches (tests, balance sweeps, server smoke tests).
import { Bot } from "../ai/bot";
import { createGame, hashState, step, type GameState, type Input } from "./sim";

export interface MatchResult {
  state: GameState;
  inputs: Input[];
  hashes: number[];
}

export function playBotMatch(seed: number, botSeeds: [number, number] = [seed + 1, seed + 2]): MatchResult {
  const s = createGame(seed);
  const bots = [new Bot(0, { seed: botSeeds[0] }), new Bot(1, { seed: botSeeds[1] })];
  const inputs: Input[] = [];
  const hashes: number[] = [];
  while (s.phase !== "over") {
    const tickInputs: Input[] = [];
    for (const b of bots) {
      const i = b.decide(s);
      if (i) tickInputs.push(i);
    }
    inputs.push(...tickInputs);
    step(s, tickInputs);
    hashes.push(hashState(s));
  }
  return { state: s, inputs, hashes };
}
