// Authoritative match server: matchmaking, private rooms, the real game loop, reconnects.
// One process, one port: serves the game page over HTTP and the game over WebSocket.
//
//   PORT=8080 node dist/server.js

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { randomBytes, randomInt } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  ARENA_H, ARENA_W, TICK_RATE, createGame, hashState, step,
  type GameState, type Input, type PlayerId,
} from "../sim/sim";
import { CARDS } from "../sim/cards";
import { MAX_MSG_BYTES, type ClientMsg, type LogEntry, type ServerMsg, type WireInput } from "../net/protocol";

const PORT = Number(process.env.PORT ?? 8080);
// LB_TEST_SPEED speeds up game time for automated tests only. Never set it in production.
const SPEED = Math.max(1, Number(process.env.LB_TEST_SPEED ?? 1));
const TICK_MS = 1000 / TICK_RATE / SPEED;
const COUNTDOWN_MS = 2500 / SPEED; // "match found" → first tick
const RECONNECT_GRACE_MS = 20_000 / SPEED; // disconnected longer than this = forfeit
const WAITING_ROOM_TTL_MS = 10 * 60_000;
const MAX_STEPS_PER_LOOP = 5 * SPEED; // catch-up limit if the event loop stalls
const RATE_CAPACITY = 20 * SPEED; // messages burst
const RATE_REFILL_PER_S = 10 * SPEED;
const MAX_INPUTS_PER_TICK = 2; // per player

// ------------------------------------------------------------------ types
interface Conn {
  id: number;
  ws: WebSocket;
  room: Room | null;
  player: PlayerId | null;
  tokens: number;
  lastRefill: number;
  queued: boolean;
}

interface Seat {
  token: string;
  conn: Conn | null;
  leftAt: number; // 0 = connected
  desyncs: number;
}

interface Room {
  code: string;
  seed: number;
  game: GameState;
  seats: [Seat, Seat | null];
  log: LogEntry[];
  pending: Input[];
  startAt: number; // 0 = waiting for second player
  ended: boolean;
  createdAt: number;
  checkpoints: Map<number, number>; // tick -> server hash, every 100 ticks
}

interface MatchRecord {
  code: string;
  seed: number;
  winner: PlayerId | -1;
  crowns: [number, number];
  reason: "towers" | "forfeit";
  ticks: number;
  hash: number;
  endedAt: string;
  log: LogEntry[];
}

// ------------------------------------------------------------------ state
const rooms = new Map<string, Room>();
const queue: Conn[] = [];
const records = new Map<string, MatchRecord>();
let nextConnId = 1;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
function newCode(): string {
  for (;;) {
    let c = "";
    for (let i = 0; i < 5; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c) && !records.has(c)) return c;
  }
}
const newToken = () => randomBytes(16).toString("hex");
const newSeed = () => randomBytes(4).readUInt32LE(0);

function send(conn: Conn | null | undefined, msg: ServerMsg): void {
  if (conn && conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
}
function sendRoom(room: Room, msg: ServerMsg): void {
  const data = JSON.stringify(msg);
  for (const seat of room.seats) {
    if (seat?.conn && seat.conn.ws.readyState === WebSocket.OPEN) seat.conn.ws.send(data);
  }
}
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

// ------------------------------------------------------------------ rooms
function makeRoom(first: Conn): Room {
  const seed = newSeed();
  const room: Room = {
    code: newCode(),
    seed,
    game: createGame(seed),
    seats: [{ token: newToken(), conn: first, leftAt: 0, desyncs: 0 }, null],
    log: [],
    pending: [],
    startAt: 0,
    ended: false,
    createdAt: Date.now(),
    checkpoints: new Map(),
  };
  rooms.set(room.code, room);
  first.room = room;
  first.player = 0;
  return room;
}

function seatSecond(room: Room, conn: Conn): void {
  room.seats[1] = { token: newToken(), conn, leftAt: 0, desyncs: 0 };
  conn.room = room;
  conn.player = 1;
  room.startAt = Date.now() + COUNTDOWN_MS;
  for (const p of [0, 1] as PlayerId[]) sendStart(room, p);
  log(`match ${room.code} starting (seed ${room.seed})`);
}

function sendStart(room: Room, p: PlayerId): void {
  const seat = room.seats[p]!;
  send(seat.conn, {
    t: "start", code: room.code, token: seat.token, you: p, seed: room.seed, tick: room.game.tick, log: room.log,
  });
}

function startMatchmade(a: Conn, b: Conn): void {
  // random seat order so neither queue position is always "player 1"
  const [first, second] = randomInt(2) === 0 ? [a, b] : [b, a];
  const room = makeRoom(first);
  seatSecond(room, second);
}

function tickRoom(room: Room): void {
  const g = room.game;
  const k = g.tick;
  const inputs = room.pending.map((i) => ({ ...i, tick: k }));
  room.pending = [];
  step(g, inputs);
  for (const i of inputs) room.log.push([k, i.player, i.card, i.x, i.y]);
  const frame: ServerMsg = inputs.length
    ? { t: "f", k, i: inputs.map((i): WireInput => [i.player, i.card, i.x, i.y]) }
    : { t: "f", k };
  sendRoom(room, frame);
  for (const ev of g.events) {
    if (ev.type === "reject") send(room.seats[ev.player]?.conn, { t: "rej", reason: ev.reason });
  }
  if (g.tick % 100 === 0) room.checkpoints.set(g.tick, hashState(g));
  if (g.phase === "over") endRoom(room, g.winner as PlayerId | -1, "towers");
}

function endRoom(room: Room, winner: PlayerId | -1, reason: "towers" | "forfeit"): void {
  if (room.ended) return;
  room.ended = true;
  const g = room.game;
  const crowns: [number, number] = [g.players[0].crowns, g.players[1].crowns];
  const hash = hashState(g);
  sendRoom(room, { t: "end", winner, crowns, hash, reason });
  records.set(room.code, {
    code: room.code, seed: room.seed, winner, crowns, reason, ticks: g.tick, hash,
    endedAt: new Date().toISOString(), log: room.log,
  });
  if (records.size > 1000) records.delete(records.keys().next().value!);
  log(`match ${room.code} over: winner ${winner} (${reason}) ${crowns.join("-")} at tick ${g.tick}`);
  for (const seat of room.seats) {
    if (seat?.conn) {
      seat.conn.room = null;
      seat.conn.player = null;
    }
  }
  // keep briefly so a reconnecting player can still be told the result
  setTimeout(() => rooms.delete(room.code), 30_000);
}

function leaveQueue(conn: Conn): void {
  const i = queue.indexOf(conn);
  if (i >= 0) queue.splice(i, 1);
  conn.queued = false;
}

// ------------------------------------------------------------------ game loop
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.ended) continue;
    if (room.startAt === 0) {
      if (now - room.createdAt > WAITING_ROOM_TTL_MS) {
        send(room.seats[0].conn, { t: "err", msg: "Room expired" });
        if (room.seats[0].conn) room.seats[0].conn.room = null;
        rooms.delete(room.code);
      }
      continue;
    }
    // forfeits
    const gone = room.seats.map((s) => !!s && s.leftAt > 0 && now - s.leftAt > RECONNECT_GRACE_MS);
    if (gone[0] && gone[1]) {
      endRoom(room, -1, "forfeit");
      continue;
    }
    if (gone[0] || gone[1]) {
      endRoom(room, gone[0] ? 1 : 0, "forfeit");
      continue;
    }
    if (now < room.startAt) continue;
    const due = Math.floor((now - room.startAt) / TICK_MS);
    let steps = 0;
    while (room.game.tick < due && steps < MAX_STEPS_PER_LOOP && !room.ended) {
      tickRoom(room);
      steps++;
    }
    // if we fell far behind (server stall), shift the clock rather than fast-forwarding
    if (room.game.tick < due - 20) room.startAt += (due - room.game.tick) * TICK_MS;
  }
}, 10);

// ------------------------------------------------------------------ messages
function rateOk(conn: Conn): boolean {
  const now = Date.now();
  conn.tokens = Math.min(RATE_CAPACITY, conn.tokens + ((now - conn.lastRefill) / 1000) * RATE_REFILL_PER_S);
  conn.lastRefill = now;
  conn.tokens -= 1;
  if (conn.tokens < -40) {
    log(`conn ${conn.id} flooding, closing`);
    conn.ws.close(1008, "rate limit");
  }
  return conn.tokens >= 0;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const CODE_RE = /^[A-Z0-9]{5}$/;

function parse(raw: string): ClientMsg | null {
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || typeof m.t !== "string") return null;
  switch (m.t) {
    case "queue": case "create": case "leave":
      return { t: m.t };
    case "join":
      return typeof m.code === "string" && CODE_RE.test(m.code.toUpperCase()) ? { t: "join", code: m.code.toUpperCase() } : null;
    case "rejoin":
      return typeof m.code === "string" && typeof m.token === "string" && m.token.length === 32
        ? { t: "rejoin", code: m.code.toUpperCase(), token: m.token } : null;
    case "play":
      // shape check only; the sim enforces the actual game rules
      return typeof m.card === "string" && m.card in CARDS && isInt(m.x) && isInt(m.y)
        && m.x >= 0 && m.x <= ARENA_W && m.y >= 0 && m.y <= ARENA_H
        ? { t: "play", card: m.card, x: m.x, y: m.y } : null;
    case "hash":
      return isInt(m.tick) && isInt(m.h) ? { t: "hash", tick: m.tick, h: m.h >>> 0 } : null;
    case "ping":
      return isInt(m.n) ? { t: "ping", n: m.n } : null;
  }
  return null;
}

function handle(conn: Conn, msg: ClientMsg): void {
  const room = conn.room;
  switch (msg.t) {
    case "ping":
      return send(conn, { t: "pong", n: msg.n });

    case "queue": {
      if (room) return send(conn, { t: "err", msg: "Already in a match" });
      if (conn.queued) return;
      // drop dead entries, then pair
      while (queue.length && queue[0].ws.readyState !== WebSocket.OPEN) queue.shift()!.queued = false;
      const other = queue.shift();
      if (other) {
        other.queued = false;
        startMatchmade(other, conn);
      } else {
        queue.push(conn);
        conn.queued = true;
        send(conn, { t: "queued" });
      }
      return;
    }

    case "create": {
      if (room) return send(conn, { t: "err", msg: "Already in a match" });
      leaveQueue(conn);
      const r = makeRoom(conn);
      return send(conn, { t: "room", code: r.code });
    }

    case "join": {
      if (room) return send(conn, { t: "err", msg: "Already in a match" });
      const r = rooms.get(msg.code);
      if (!r || r.ended) return send(conn, { t: "err", msg: "That match code doesn't exist" });
      if (r.seats[1]) return send(conn, { t: "err", msg: "That match is already full" });
      if (r.seats[0].conn === conn) return send(conn, { t: "err", msg: "You can't join your own room" });
      leaveQueue(conn);
      return seatSecond(r, conn);
    }

    case "rejoin": {
      const r = rooms.get(msg.code);
      if (!r) return send(conn, { t: "err", msg: "Match not found" });
      const p = r.seats.findIndex((s) => s?.token === msg.token);
      if (p < 0) return send(conn, { t: "err", msg: "Match not found" });
      const seat = r.seats[p]!;
      if (r.ended) {
        const rec = records.get(r.code);
        if (rec) send(conn, { t: "end", winner: rec.winner, crowns: rec.crowns, hash: rec.hash, reason: rec.reason });
        return;
      }
      if (seat.conn && seat.conn !== conn) {
        seat.conn.room = null;
        seat.conn.ws.close(4000, "replaced by a newer connection");
      }
      leaveQueue(conn);
      seat.conn = conn;
      seat.leftAt = 0;
      conn.room = r;
      conn.player = p as PlayerId;
      sendStart(r, p as PlayerId);
      send(r.seats[p === 0 ? 1 : 0]?.conn, { t: "opp", status: "reconnected" });
      log(`match ${r.code}: player ${p} reconnected at tick ${r.game.tick}`);
      return;
    }

    case "play": {
      if (!room || room.ended || conn.player === null || room.startAt === 0) return;
      if (Date.now() < room.startAt) return send(conn, { t: "rej", reason: "match hasn't started" });
      const mine = room.pending.filter((i) => i.player === conn.player).length;
      if (mine >= MAX_INPUTS_PER_TICK) return;
      room.pending.push({ tick: 0, player: conn.player, card: msg.card, x: msg.x, y: msg.y });
      return;
    }

    case "hash": {
      if (!room || conn.player === null) return;
      const expected = room.checkpoints.get(msg.tick);
      if (expected === undefined || expected === msg.h) return;
      const seat = room.seats[conn.player]!;
      seat.desyncs++;
      log(`match ${room.code}: player ${conn.player} desync at tick ${msg.tick} (#${seat.desyncs})`);
      // client state is wrong (bug, or tampering): give it the authoritative log to rebuild from
      send(conn, { t: "sync", seed: room.seed, tick: room.game.tick, log: room.log });
      return;
    }

    case "leave": {
      leaveQueue(conn);
      if (!room) return;
      if (room.startAt === 0) {
        rooms.delete(room.code);
      } else if (!room.ended && conn.player !== null) {
        endRoom(room, conn.player === 0 ? 1 : 0, "forfeit"); // resigning
      }
      conn.room = null;
      conn.player = null;
      return;
    }
  }
}

function onClose(conn: Conn): void {
  leaveQueue(conn);
  const room = conn.room;
  if (!room || conn.player === null) return;
  if (room.startAt === 0) {
    rooms.delete(room.code); // creator left before anyone joined
    return;
  }
  const seat = room.seats[conn.player];
  if (seat && seat.conn === conn && !room.ended) {
    seat.conn = null;
    seat.leftAt = Date.now();
    send(room.seats[conn.player === 0 ? 1 : 0]?.conn, { t: "opp", status: "disconnected" });
    log(`match ${room.code}: player ${conn.player} disconnected at tick ${room.game.tick}`);
  }
}

// ------------------------------------------------------------------ http + ws
const PAGE_PATH = "dist/index.html";
let page: string | null = existsSync(PAGE_PATH) ? readFileSync(PAGE_PATH, "utf8") : null;

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

const http = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  res.setHeader("x-content-type-options", "nosniff");
  if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
  if (path === "/health") return json(res, 200, { ok: true });
  if (path === "/api/stats") {
    let live = 0;
    for (const r of rooms.values()) if (r.startAt && !r.ended) live++;
    return json(res, 200, { liveMatches: live, waitingRooms: rooms.size - live, queued: queue.length, players: wss.clients.size });
  }
  const m = path.match(/^\/api\/matches\/([A-Za-z0-9]{5})$/);
  if (m) {
    const rec = records.get(m[1].toUpperCase());
    return rec ? json(res, 200, rec) : json(res, 404, { error: "no finished match with that code" });
  }
  if (path === "/" || path === "/index.html") {
    if (!page && existsSync(PAGE_PATH)) page = readFileSync(PAGE_PATH, "utf8");
    if (!page) return json(res, 500, { error: "client not built: run npm run build" });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    return res.end(page);
  }
  json(res, 404, { error: "not found" });
});

const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: MAX_MSG_BYTES });

wss.on("connection", (ws) => {
  const conn: Conn = {
    id: nextConnId++, ws, room: null, player: null,
    tokens: RATE_CAPACITY, lastRefill: Date.now(), queued: false,
  };
  ws.on("message", (data, isBinary) => {
    if (isBinary || !rateOk(conn)) return;
    const msg = parse(data.toString());
    if (!msg) return send(conn, { t: "err", msg: "Bad message" });
    handle(conn, msg);
  });
  ws.on("close", () => onClose(conn));
  ws.on("error", () => {});
});

// drop dead sockets (phone went to sleep, network vanished)
setInterval(() => {
  for (const ws of wss.clients) {
    const c = ws as WebSocket & { _lbAlive?: boolean };
    if (c._lbAlive === false) {
      ws.terminate();
      continue;
    }
    c._lbAlive = false;
    ws.ping();
  }
}, 15_000);
wss.on("connection", (ws) => {
  const c = ws as WebSocket & { _lbAlive?: boolean };
  c._lbAlive = true;
  ws.on("pong", () => (c._lbAlive = true));
});

http.listen(PORT, () => log(`Lanebreak server on :${PORT}`));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    log(`${sig}: shutting down`);
    sendRoomAll({ t: "err", msg: "Server restarting. Your match will be lost." });
    http.close();
    process.exit(0);
  });
}
function sendRoomAll(msg: ServerMsg) {
  for (const r of rooms.values()) sendRoom(r, msg);
}
