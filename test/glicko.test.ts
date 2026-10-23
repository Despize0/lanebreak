import { test } from "node:test";
import assert from "node:assert/strict";
import { decay, rate, expected } from "../src/server/glicko";
import { tierFor } from "../src/net/tiers";

const fresh = { rating: 1500, rd: 350, vol: 0.06 };
const settled = { rating: 1500, rd: 60, vol: 0.06 };

test("winning raises rating, losing lowers it, by the same amount for equal players", () => {
  const w = rate(fresh, fresh, 1);
  const l = rate(fresh, fresh, 0);
  assert.ok(w.rating > 1500 && l.rating < 1500);
  assert.ok(Math.abs(w.rating - 1500 - (1500 - l.rating)) < 1e-6);
  assert.ok(w.rd < 350, "playing reduces uncertainty");
});

test("new players move fast, established players move slowly", () => {
  const newWin = rate(fresh, settled, 1).rating - 1500;
  const oldWin = rate(settled, settled, 1).rating - 1500;
  assert.ok(newWin > 150, `new player gain ${newWin}`);
  assert.ok(oldWin > 3 && oldWin < 25, `settled player gain ${oldWin}`);
});

test("upsets pay more than expected wins", () => {
  const strong = { rating: 1900, rd: 60, vol: 0.06 };
  const weak = { rating: 1400, rd: 60, vol: 0.06 };
  const upset = rate(weak, strong, 1).rating - weak.rating;
  const expectedWin = rate(strong, weak, 1).rating - strong.rating;
  assert.ok(upset > expectedWin * 3);
  assert.ok(expected(strong, weak) > 0.9);
});

test("draw against a stronger player still gains rating", () => {
  const r = rate({ rating: 1500, rd: 80, vol: 0.06 }, { rating: 1700, rd: 80, vol: 0.06 }, 0.5);
  assert.ok(r.rating > 1500);
});

test("inactivity raises uncertainty, capped at the starting value", () => {
  assert.ok(decay(settled, 60).rd > settled.rd);
  assert.equal(decay(settled, 100000).rd, 350);
  assert.equal(decay(settled, 0).rd, settled.rd);
});

test("tiers", () => {
  assert.equal(tierFor(1000).name, "Breeze");
  assert.equal(tierFor(1500).name, "Storm");
  assert.equal(tierFor(2200).name, "Skyborn");
});
