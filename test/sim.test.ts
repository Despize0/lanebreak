import { test } from "node:test";
import assert from "node:assert/strict";
import { playBotMatch } from "../src/sim/match";
import {
  createGame, step, replay, hashState, canDeployAt, ELIXIR_UNIT, START_ELIXIR, REGULATION_TICKS,
  type GameState, type Input,
} from "../src/sim/sim";

const run = (s: GameState, ticks: number, inputs: Input[] = []) => {
  for (let i = 0; i < ticks; i++) step(s, inputs);
};

test("replaying the input log reproduces every tick exactly", () => {
  for (const seed of [1, 42, 9001, 123456]) {
    const live = playBotMatch(seed);
    const rep = replay(seed, live.inputs);
    assert.equal(rep.hashes.length, live.hashes.length, `seed ${seed}: match length differs`);
    for (let i = 0; i < live.hashes.length; i++) {
      if (rep.hashes[i] !== live.hashes[i]) assert.fail(`seed ${seed}: desync at tick ${i}`);
    }
    assert.equal(rep.state.winner, live.state.winner);
  }
});

test("matches finish and produce a result", () => {
  const m = playBotMatch(7);
  assert.equal(m.state.phase, "over");
  assert.ok(m.state.winner !== null);
});

test("one changed input changes the outcome hash (hash covers gameplay)", () => {
  const live = playBotMatch(77);
  // nudge the first accepted troop deploy by 1 tile
  const s = createGame(77);
  let target = -1;
  for (let idx = 0; idx < live.inputs.length && target < 0; idx++) {
    while (s.tick < live.inputs[idx].tick) step(s);
    step(s, [live.inputs[idx]]);
    if (s.events.some((e) => e.type === "deploy") && live.inputs[idx].card !== "ember") target = idx;
  }
  assert.ok(target >= 0);
  const tampered = live.inputs.map((inp, idx) => (idx === target ? { ...inp, x: inp.x + 1000 } : inp));
  const rep = replay(77, tampered);
  const t = live.inputs[target].tick;
  assert.notEqual(rep.hashes[t], live.hashes[t], "hash must change on the tick the input lands");
});

test("both players get the same card order from the seed (mirror fairness)", () => {
  const s = createGame(2024);
  assert.deepEqual(s.players[0].hand, s.players[1].hand);
  assert.deepEqual(s.players[0].queue, s.players[1].queue);
});

test("server rejects cheating inputs", () => {
  const s = createGame(5);
  const card = s.players[0].hand[0];
  const before = hashState(s);
  const notInHand = s.players[0].queue[0];

  // card not in hand
  step(s, [{ tick: 0, player: 0, card: notInHand, x: 9000, y: 24000 }]);
  assert.ok(s.events.some((e) => e.type === "reject" && e.reason === "card not in hand"));
  // placing a troop on the enemy side
  step(s, [{ tick: 1, player: 0, card, x: 9000, y: 8000 }]);
  assert.ok(s.events.some((e) => e.type === "reject"));
  // fractional coordinates
  step(s, [{ tick: 2, player: 0, card, x: 9000.5, y: 24000 }]);
  assert.ok(s.events.some((e) => e.type === "reject" && e.reason === "bad position"));
  // made-up card
  step(s, [{ tick: 3, player: 0, card: "megaknight", x: 9000, y: 24000 }]);
  assert.ok(s.events.some((e) => e.type === "reject" && e.reason === "unknown card"));
  // no unit was spawned by any of that
  assert.equal(s.entities.filter((e) => e.kind !== "tower").length, 0);
  assert.notEqual(before, hashState(s)); // time still advanced
});

test("elixir is spent and can't go negative", () => {
  const s = createGame(11);
  const hand = s.players[0].hand;
  assert.equal(s.players[0].elixir, START_ELIXIR);
  // spend everything we can in one tick: second play should be rejected when broke
  const inputs: Input[] = hand.map((card) => ({ tick: 0, player: 0, card, x: 9000, y: 24000 }));
  step(s, inputs);
  assert.ok(s.players[0].elixir >= 0);
  assert.ok(s.events.some((e) => e.type === "reject" && e.reason === "not enough elixir"));
});

test("elixir regenerates at 1 per 2.8s, doubled in the last minute", () => {
  const s = createGame(3);
  s.players[0].elixir = 0;
  run(s, 56);
  assert.equal(s.players[0].elixir, ELIXIR_UNIT);
  const t = createGame(3);
  run(t, REGULATION_TICKS - 20 * 60);
  t.players[0].elixir = 0;
  run(t, 28);
  assert.equal(t.players[0].elixir, ELIXIR_UNIT);
});

test("playing a card cycles it to the back of the queue", () => {
  const s = createGame(8);
  s.players[0].elixir = 10 * ELIXIR_UNIT;
  const played = s.players[0].hand[1];
  const next = s.players[0].queue[0];
  const def = played === "ember" ? { x: 9000, y: 9000 } : { x: 9000, y: 22000 };
  step(s, [{ tick: 0, player: 0, card: played, ...def }]);
  assert.equal(s.players[0].hand[1], next);
  assert.equal(s.players[0].queue[s.players[0].queue.length - 1], played);
});

test("decks: each player draws only from their own deck, same order pattern", () => {
  const d0 = ["colossus", "zap", "wisps", "warden", "twinrangers", "skyrider", "bombardier", "cannon"];
  const d1 = ["ironhide", "ranger", "swarmlings", "bulwark", "ember", "skywing", "brute", "sparkcaster"];
  const s = createGame(99, [d0, d1]);
  assert.deepEqual([...s.players[0].hand, ...s.players[0].queue].sort(), [...d0].sort());
  assert.deepEqual([...s.players[1].hand, ...s.players[1].queue].sort(), [...d1].sort());
  // same shuffle positions for both decks (fair draws)
  const pos = (deck: string[], p: number) => [...s.players[p].hand, ...s.players[p].queue].map((c) => deck.indexOf(c));
  assert.deepEqual(pos(d0, 0), pos(d1, 1));
});

test("troops can be placed right behind and beside a tower, but not on it", () => {
  const s = createGame(1);
  assert.equal(canDeployAt(s, 0, "troop", 3500, 26500), true, "right behind the left side tower");
  assert.equal(canDeployAt(s, 0, "troop", 8500, 30500), true, "behind the king");
  assert.equal(canDeployAt(s, 0, "troop", 3500, 25500), false, "on the tower itself");
  assert.equal(canDeployAt(s, 0, "troop", 4500, 25500), true, "beside the tower");
});

test("troops placed behind towers walk around them and reach the bridge", () => {
  const spots = [[3500, 26500], [3500, 27500], [14500, 26500], [9000, 30500], [8500, 31500], [1500, 25500]];
  for (const card of ["colossus", "ironhide", "warden", "brute", "ranger", "skyrider", "bombardier"]) {
    for (const [x, y] of spots) {
      const deck = [card, ...["zap", "wisps", "cannon", "ember", "skywing", "swarmlings", "bulwark", "sparkcaster"].filter((c) => c !== card)].slice(0, 8);
      const s = createGame(1, [deck, deck]);
      s.players[0].elixir = 10 * ELIXIR_UNIT;
      s.players[0].hand[0] = card;
      step(s, [{ tick: 0, player: 0, card, x, y }]);
      let crossed = false;
      for (let t = 0; t < 1400 && !crossed; t++) {
        step(s);
        crossed = s.entities.some((e) => e.owner === 0 && e.kind === "troop" && e.y < 15000);
      }
      assert.ok(crossed, `${card} placed at ${x},${y} got stuck`);
    }
  }
});

test("two pairs of big units meeting head-on on a bridge don't jam", () => {
  const big = ["colossus", "ironhide", "brute", "warden"];
  const deck = (cs: string[]) => [...cs, ...["zap", "wisps", "cannon", "ember", "skywing", "swarmlings", "bulwark", "sparkcaster"].filter((k) => !cs.includes(k))].slice(0, 8);
  for (const [a, a2] of [["colossus", "ironhide"], ["ironhide", "colossus"]]) {
    for (const b of big) for (const b2 of big) {
      if (b === b2) continue;
      for (const lx of [3500, 14500]) {
        const s = createGame(5, [deck([a, a2]), deck([b, b2])]);
        s.players[0].elixir = 20 * ELIXIR_UNIT;
        s.players[1].elixir = 20 * ELIXIR_UNIT;
        s.players[0].hand[0] = a; s.players[0].hand[1] = a2;
        s.players[1].hand[0] = b; s.players[1].hand[1] = b2;
        step(s, [
          { tick: 0, player: 0, card: a, x: lx - 400, y: 19500 },
          { tick: 0, player: 0, card: a2, x: lx + 400, y: 20500 },
          { tick: 0, player: 1, card: b, x: lx + 300, y: 12500 },
          { tick: 0, player: 1, card: b2, x: lx - 300, y: 11500 },
        ]);
        const over = new Set<number>();
        let done = false;
        for (let t = 0; t < 2000 && !done; t++) {
          step(s);
          const mine = s.entities.filter((e) => e.kind === "troop" && big.includes(e.card));
          for (const e of mine) if (e.owner === 0 ? e.y < 15000 : e.y > 17000) over.add(e.id);
          done = s.winner !== null || mine.every((e) => over.has(e.id));
        }
        assert.ok(done, `${a}+${a2} vs ${b}+${b2} at x ${lx} jammed on the bridge`);
      }
    }
  }
});
