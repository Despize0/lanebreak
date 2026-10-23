// End-to-end tests: real server process, real WebSocket clients, bots playing each other online.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { Bot } from "../src/ai/bot";
import { createGame, hashState, replay, step, type GameState, type Input, type PlayerId } from "../src/sim/sim";
import type { ClientMsg, LogEntry, ServerMsg } from "../src/net/protocol";

const PORT = 18000 + Math.floor(Math.random() * 1000);
const URL_ = `ws://127.0.0.1:${PORT}/ws`;
let server: ChildProcess;

before(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "src/server/server.ts"], {
    env: { ...process.env, PORT: String(PORT), LB_TEST_SPEED: "20" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 15000);
    server.stdout!.on("data", (d) => {
      if (String(d).includes("server on")) {
        clearTimeout(t);
        resolve();
      }
    });
  });
});
after(() => {
  server.kill();
});

/** Headless client: same lockstep logic as the browser, optional bot brain. */
class Client {
  ws!: WebSocket;
  game: GameState | null = null;
  seed = 0;
  me: PlayerId = 0;
  code = "";
  token = "";
  syncs = 0;
  rejects: string[] = [];
  errors: string[] = [];
  end: Extract<ServerMsg, { t: "end" }> | null = null;
  bot: Bot | null = null;
  onTick: ((c: Client) => void) | null = null;
  constructor(public useBot = true) {}

  connect(): Promise<void> {
    this.ws = new WebSocket(URL_);
    this.ws.on("message", (d) => this.onMsg(JSON.parse(String(d))));
    return new Promise((r) => this.ws.once("open", () => r()));
  }
  send(m: ClientMsg | Record<string, unknown>) {
    this.ws.send(JSON.stringify(m));
  }
  rebuild(seed: number, log: LogEntry[], tick: number) {
    this.seed = seed;
    const g = createGame(seed);
    while (g.tick < tick) {
      step(g, log.filter((l) => l[0] === g.tick).map(([t, player, card, x, y]) => ({ tick: t, player, card, x, y })));
    }
    this.game = g;
  }
  onMsg(m: ServerMsg) {
    switch (m.t) {
      case "start":
        this.me = m.you;
        this.code = m.code;
        this.token = m.token;
        this.rebuild(m.seed, m.log, m.tick);
        if (this.useBot) this.bot = new Bot(m.you, { seed: m.seed + m.you, thinkEvery: 10 });
        break;
      case "f": {
        const g = this.game!;
        assert.equal(m.k, g.tick, "frames must arrive in order without gaps");
        const inputs: Input[] = (m.i ?? []).map(([player, card, x, y]) => ({ tick: m.k, player, card, x, y }));
        step(g, inputs);
        if (g.tick % 100 === 0) this.send({ t: "hash", tick: g.tick, h: hashState(g) });
        this.onTick?.(this);
        if (this.bot && g.phase !== "over") {
          const i = this.bot.decide(g);
          if (i) this.send({ t: "play", card: i.card, x: i.x, y: i.y });
        }
        break;
      }
      case "sync":
        this.syncs++;
        this.rebuild(m.seed, m.log, m.tick);
        break;
      case "rej":
        this.rejects.push(m.reason);
        break;
      case "err":
        this.errors.push(m.msg);
        break;
      case "end":
        this.end = m;
        break;
    }
  }
  waitFor(cond: () => boolean, ms = 60000): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const iv = setInterval(() => {
        if (cond()) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - start > ms) {
          clearInterval(iv);
          reject(new Error("timed out"));
        }
      }, 20);
    });
  }
}

test("two clients queue, play a full match, and agree with the server bit-for-bit", async () => {
  const a = new Client();
  const b = new Client();
  await a.connect();
  await b.connect();
  a.send({ t: "queue" });
  b.send({ t: "queue" });
  await a.waitFor(() => !!a.end && !!b.end);
  assert.ok(a.game!.tick > 100);
  assert.notEqual(a.me, b.me, "players get different seats");
  // both local sims ended in exactly the server's state
  assert.equal(hashState(a.game!), a.end!.hash);
  assert.equal(hashState(b.game!), b.end!.hash);
  assert.equal(a.syncs + b.syncs, 0, "no desyncs");
  assert.equal(a.end!.reason, "towers");
  // the stored match record replays to the same result
  const rec = await (await fetch(`http://127.0.0.1:${PORT}/api/matches/${a.code}`)).json();
  const inputs = (rec.log as LogEntry[]).map(([tick, player, card, x, y]) => ({ tick, player, card, x, y }));
  assert.equal(hashState(replay(rec.seed, inputs).state), rec.hash);
  a.ws.close();
  b.ws.close();
});

test("private room: create, join by code, server rejects cheating inputs", async () => {
  const host = new Client(false);
  const guest = new Client(false);
  await host.connect();
  await guest.connect();
  host.send({ t: "create" });
  const code = await new Promise<string>((r) => host.ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.t === "room") r(m.code);
  }));
  guest.send({ t: "join", code });
  await host.waitFor(() => !!host.game && host.game.tick > 5 && !!guest.game);

  const g = host.game!;
  const notInHand = g.players[host.me].queue[0];
  const enemyY = host.me === 0 ? 8000 : 24000;
  const ownY = host.me === 0 ? 24000 : 8000;
  host.send({ t: "play", card: notInHand, x: 9000, y: ownY }); // card not in hand
  host.send({ t: "play", card: g.players[host.me].hand.find((c) => c !== "ember")!, x: 9000, y: enemyY }); // enemy side
  host.send({ t: "play", card: "ironhide", x: 9000.5, y: ownY }); // fractional (dropped by parser)
  host.send({ t: "play", card: "megaknight", x: 9000, y: ownY }); // not a card
  host.send({ t: "play", card: "ranger", x: 1e9, y: ownY }); // out of bounds
  host.send({ hello: "world" } as any);
  host.ws.send("not json");
  await host.waitFor(() => host.rejects.length >= 2 && host.errors.length >= 4, 5000);

  // nothing spawned for the cheater, and their state still matches the server
  await host.waitFor(() => host.game!.tick >= 200, 20000);
  assert.equal(host.game!.entities.filter((e) => e.owner === host.me && e.kind !== "tower").length, 0);
  assert.equal(host.syncs, 0);
  host.send({ t: "leave" }); // resign
  await guest.waitFor(() => !!guest.end);
  assert.equal(guest.end!.reason, "forfeit");
  assert.equal(guest.end!.winner, guest.me);
  host.ws.close();
  guest.ws.close();
});

test("a dropped player can rejoin mid-match and finish in sync", async () => {
  const a = new Client();
  const b = new Client();
  await a.connect();
  await b.connect();
  a.send({ t: "queue" });
  b.send({ t: "queue" });
  await a.waitFor(() => !!a.game && a.game.tick > 600);
  const { code, token } = a;
  a.ws.terminate(); // network drop
  await new Promise((r) => setTimeout(r, 300)); // match keeps running without them
  const a2 = new Client();
  await a2.connect();
  a2.send({ t: "rejoin", code, token });
  await a2.waitFor(() => !!a2.end && !!b.end);
  assert.equal(hashState(a2.game!), a2.end!.hash);
  assert.equal(hashState(b.game!), b.end!.hash);
  assert.equal(a2.syncs, 0);
  a2.ws.close();
  b.ws.close();
});

test("a player who never comes back forfeits", async () => {
  const a = new Client(false);
  const b = new Client(false);
  await a.connect();
  await b.connect();
  a.send({ t: "queue" });
  b.send({ t: "queue" });
  await a.waitFor(() => !!a.game && a.game.tick > 50);
  a.ws.terminate();
  await b.waitFor(() => !!b.end, 10000); // grace is 20s / 20x test speed = 1s
  assert.equal(b.end!.reason, "forfeit");
  assert.equal(b.end!.winner, b.me);
  b.ws.close();
});

test("a tampered client state gets corrected by the server", async () => {
  const a = new Client(false);
  const b = new Client(false);
  await a.connect();
  await b.connect();
  a.send({ t: "queue" });
  b.send({ t: "queue" });
  await a.waitFor(() => !!a.game && a.game.tick > 20);
  a.game!.players[a.me].elixir = 99999; // "hack" local elixir
  await a.waitFor(() => a.syncs > 0, 10000);
  assert.ok(a.game!.players[a.me].elixir <= 560, "server restored the real elixir");
  a.send({ t: "leave" });
  a.ws.close();
  b.ws.close();
});
