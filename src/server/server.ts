// Authoritative match server: accounts, ranked + casual matchmaking, private rooms,
// the real game loop, reconnects. One process, one port: serves the page over HTTP,
// the API under /api, and the game over WebSocket at /ws.
//
//   PORT=8080 DATABASE_URL=postgres://... node dist/server.js

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { randomBytes, randomInt } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  ARENA_H, ARENA_W, TICK_RATE, createGame, hashState, step,
  type GameState, type Input, type PlayerId,
} from "../sim/sim";
import { CARDS, DEFAULT_DECK, isValidDeck } from "../sim/cards";
import { MAX_MSG_BYTES, type ClientMsg, type LogEntry, type ServerMsg, type WireInput } from "../net/protocol";
import { PLACEMENT_GAMES, isTowerSkin, tierFor, type PlayerInfo, type PublicUser, type TowerSkin } from "../net/tiers";
import { makeStore, type MatchRow, type RatingUpdate, type User } from "./store";
import { decay, rate, type Rating } from "./glicko";
import {
  Limiter, SESSION_DAYS, burnTime, checkPassword, checkUsername, hashPassword, hashToken, newSessionToken, verifyPassword,
} from "./auth";

const PORT = Number(process.env.PORT ?? 8080);
// LB_TEST_SPEED speeds up game time for automated tests only. Never set it in production.
const SPEED = Math.max(1, Number(process.env.LB_TEST_SPEED ?? 1));
const TESTING = SPEED > 1;
const TICK_MS = 1000 / TICK_RATE / SPEED;
const COUNTDOWN_MS = 2500 / SPEED; // "match found" → first tick
const RECONNECT_GRACE_MS = 20_000 / SPEED; // disconnected longer than this = forfeit
const WAITING_ROOM_TTL_MS = 10 * 60_000;
const MAX_STEPS_PER_LOOP = 5 * SPEED; // catch-up limit if the event loop stalls
const RATE_CAPACITY = 20 * SPEED; // messages burst
const RATE_REFILL_PER_S = 10 * SPEED;
const MAX_INPUTS_PER_TICK = 2; // per player

const store = makeStore();

// ------------------------------------------------------------------ types
interface Conn {
  id: number;
  ws: WebSocket;
  room: Room | null;
  player: PlayerId | null;
  tokens: number;
  lastRefill: number;
  queued: "casual" | "ranked" | null;
  queuedAt: number;
  user: User | null;
  guestName: string;
  deck: string[];
  skin: TowerSkin;
  chain: Promise<void>; // messages from one socket are handled strictly in order
}

interface Seat {
  token: string;
  conn: Conn | null;
  leftAt: number; // 0 = connected
  desyncs: number;
  userId: number | null;
  info: PlayerInfo;
  rating: Rating | null; // at match start (ranked)
  lastMatchAt: Date | null;
  deck: string[];
}

interface Room {
  code: string;
  seed: number;
  game: GameState;
  ranked: boolean;
  seats: [Seat, Seat | null];
  log: LogEntry[];
  pending: Input[];
  startAt: number; // 0 = waiting for second player
  ended: boolean;
  createdAt: number;
  checkpoints: Map<number, number>; // tick -> server hash, every 100 ticks
}

type EndMsg = Extract<ServerMsg, { t: "end" }>;

// ------------------------------------------------------------------ state
const rooms = new Map<string, Room>();
const casualQueue: Conn[] = [];
const rankedQueue: Conn[] = [];
const recentEnds = new Map<string, EndMsg>(); // so a player reconnecting after the end sees the result
const usersInMatch = new Map<number, Room>(); // one live match per account
let nextConnId = 1;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
function newCode(): string {
  for (;;) {
    let c = "";
    for (let i = 0; i < 5; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c) && !recentEnds.has(c)) return c;
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

// ------------------------------------------------------------------ users
const gamesOf = (u: User) => u.wins + u.losses + u.draws;

function toPublic(u: User, rank: number | null = null, self = false): PublicUser {
  const games = gamesOf(u);
  const placed = games >= PLACEMENT_GAMES;
  return {
    id: u.id, name: u.username, rating: Math.round(u.rating), games, wins: u.wins, losses: u.losses, draws: u.draws,
    placed, tier: placed ? tierFor(u.rating).name : "Unranked", rank,
    ...(self ? { deck: isValidDeck(u.deck) ? u.deck : null } : {}),
  };
}

function infoFor(conn: Conn): PlayerInfo {
  if (!conn.user) return { name: conn.guestName, rating: null, tier: null, placed: false, skin: conn.skin };
  const p = toPublic(conn.user);
  return { name: p.name, rating: p.rating, tier: p.tier, placed: p.placed, skin: conn.skin };
}

async function sendMe(conn: Conn) {
  if (!conn.user) return send(conn, { t: "me", user: null });
  const rank = await store.rankOf(conn.user.id, PLACEMENT_GAMES).catch(() => null);
  send(conn, { t: "me", user: toPublic(conn.user, rank, true) });
}

// ------------------------------------------------------------------ rooms
function newSeat(conn: Conn): Seat {
  return {
    token: newToken(), conn, leftAt: 0, desyncs: 0,
    userId: conn.user?.id ?? null,
    info: infoFor(conn),
    rating: conn.user ? { rating: conn.user.rating, rd: conn.user.rd, vol: conn.user.vol } : null,
    lastMatchAt: conn.user?.lastMatchAt ?? null,
    deck: [...conn.deck],
  };
}

function makeRoom(first: Conn, ranked: boolean): Room {
  const seed = newSeed();
  const room: Room = {
    code: newCode(), seed, game: createGame(seed), ranked,
    seats: [newSeat(first), null],
    log: [], pending: [], startAt: 0, ended: false, createdAt: Date.now(), checkpoints: new Map(),
  };
  rooms.set(room.code, room);
  first.room = room;
  first.player = 0;
  return room;
}

function seatSecond(room: Room, conn: Conn): void {
  room.seats[1] = newSeat(conn);
  conn.room = room;
  conn.player = 1;
  room.game = createGame(room.seed, decksOf(room));
  room.startAt = Date.now() + COUNTDOWN_MS;
  for (const s of room.seats) if (s?.userId) usersInMatch.set(s.userId, room);
  for (const p of [0, 1] as PlayerId[]) sendStart(room, p);
  log(`match ${room.code} starting${room.ranked ? " (ranked)" : ""}: ${room.seats[0].info.name} vs ${room.seats[1]!.info.name}`);
}

const decksOf = (room: Room): [string[], string[]] => [room.seats[0].deck, room.seats[1]?.deck ?? DEFAULT_DECK];

function sendStart(room: Room, p: PlayerId): void {
  const seat = room.seats[p]!;
  send(seat.conn, {
    t: "start", code: room.code, token: seat.token, you: p, seed: room.seed, tick: room.game.tick, log: room.log,
    ranked: room.ranked, players: [room.seats[0].info, room.seats[1]!.info], decks: decksOf(room),
  });
}

function startMatch(a: Conn, b: Conn, ranked: boolean): void {
  // random seat order so neither queue position is always "player 1"
  const [first, second] = randomInt(2) === 0 ? [a, b] : [b, a];
  const room = makeRoom(first, ranked);
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
  if (g.phase === "over") void endRoom(room, g.winner as PlayerId | -1, "towers");
}

async function endRoom(room: Room, winner: PlayerId | -1, reason: "towers" | "forfeit", abandoned = false) {
  if (room.ended) return;
  room.ended = true;
  const g = room.game;
  const crowns: [number, number] = [g.players[0].crowns, g.players[1].crowns];
  const hash = hashState(g);
  const [s0, s1] = [room.seats[0], room.seats[1]!];
  const endedAt = new Date();

  // ratings: only for ranked matches between two accounts that someone actually played out
  let ratings: [[number, number], [number, number]] | undefined;
  const updates: RatingUpdate[] = [];
  if (room.ranked && !abandoned && s0.userId && s1.userId && s0.rating && s1.rating) {
    const days = (d: Date | null) => (d ? Math.max(0, (endedAt.getTime() - d.getTime()) / 86_400_000) : 0);
    const r0 = decay(s0.rating, days(s0.lastMatchAt));
    const r1 = decay(s1.rating, days(s1.lastMatchAt));
    const score0 = winner === 0 ? 1 : winner === -1 ? 0.5 : 0;
    const n0 = rate(r0, r1, score0);
    const n1 = rate(r1, r0, 1 - score0);
    const res = (s: number) => (s === 1 ? "win" : s === 0 ? "loss" : "draw") as RatingUpdate["result"];
    updates.push({ userId: s0.userId, ...n0, result: res(score0) }, { userId: s1.userId, ...n1, result: res(1 - score0) });
    ratings = [[Math.round(s0.rating.rating), Math.round(n0.rating)], [Math.round(s1.rating.rating), Math.round(n1.rating)]];
  }

  const row: MatchRow = {
    code: room.code, ranked: room.ranked, p0: s0.userId, p1: s1.userId, p0Name: s0.info.name, p1Name: s1.info.name,
    winner, crowns, reason: abandoned ? "abandoned" : reason, ticks: g.tick, hash, seed: room.seed, log: room.log,
    decks: decksOf(room), endedAt, ratings: ratings ?? null,
  };
  try {
    await store.saveMatch(row, updates);
  } catch (e) {
    log(`match ${room.code}: FAILED to save`, e);
    ratings = undefined; // don't show rating changes that weren't stored
    updates.length = 0;
  }

  const end: EndMsg = { t: "end", winner, crowns, hash, reason, ...(ratings ? { ratings } : {}) };
  recentEnds.set(room.code, end);
  if (recentEnds.size > 2000) recentEnds.delete(recentEnds.keys().next().value!);
  sendRoom(room, end);
  log(`match ${room.code} over: winner ${winner} (${row.reason}) ${crowns.join("-")} at tick ${g.tick}` +
    (ratings ? ` ratings ${ratings[0].join("→")} / ${ratings[1].join("→")}` : ""));

  for (const seat of room.seats) {
    if (!seat) continue;
    if (seat.userId && usersInMatch.get(seat.userId) === room) usersInMatch.delete(seat.userId);
    const c = seat.conn;
    if (!c) continue;
    c.room = null;
    c.player = null;
    const up = updates.find((u) => u.userId === c.user?.id);
    if (c.user && up) {
      Object.assign(c.user, { rating: up.rating, rd: up.rd, vol: up.vol, lastMatchAt: endedAt });
      if (up.result === "win") c.user.wins++;
      else if (up.result === "loss") c.user.losses++;
      else c.user.draws++;
      void sendMe(c);
    }
  }
  setTimeout(() => rooms.delete(room.code), 30_000);
}

function leaveQueues(conn: Conn): void {
  for (const q of [casualQueue, rankedQueue]) {
    const i = q.indexOf(conn);
    if (i >= 0) q.splice(i, 1);
  }
  conn.queued = null;
}

const isOpen = (c: Conn) => c.ws.readyState === WebSocket.OPEN;

/** Ranked pairing: closest ratings first; the allowed gap widens the longer people wait. */
function pairRanked(now: number) {
  for (let i = rankedQueue.length - 1; i >= 0; i--) if (!isOpen(rankedQueue[i])) rankedQueue.splice(i, 1);
  const window = (c: Conn) => Math.min(800, 100 + ((now - c.queuedAt) / 1000) * 25 * SPEED);
  const sorted = [...rankedQueue].sort((a, b) => a.user!.rating - b.user!.rating);
  const used = new Set<Conn>();
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (used.has(a) || used.has(b) || a.user!.id === b.user!.id) continue;
    const gap = Math.abs(a.user!.rating - b.user!.rating);
    if (gap <= (window(a) + window(b)) / 2) {
      used.add(a);
      used.add(b);
    }
  }
  const list = [...used];
  for (let i = 0; i < list.length; i += 2) {
    leaveQueues(list[i]);
    leaveQueues(list[i + 1]);
    startMatch(list[i], list[i + 1], true);
  }
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
    const gone = room.seats.map((s) => !!s && s.leftAt > 0 && now - s.leftAt > RECONNECT_GRACE_MS);
    if (gone[0] && gone[1]) {
      void endRoom(room, -1, "forfeit", true);
      continue;
    }
    if (gone[0] || gone[1]) {
      void endRoom(room, gone[0] ? 1 : 0, "forfeit");
      continue;
    }
    if (now < room.startAt) continue;
    const due = Math.floor((now - room.startAt) / TICK_MS);
    let steps = 0;
    while (room.game.tick < due && steps < MAX_STEPS_PER_LOOP && !room.ended) {
      tickRoom(room);
      steps++;
    }
    if (room.game.tick < due - 20) room.startAt += (due - room.game.tick) * TICK_MS;
  }
}, 10);
setInterval(() => pairRanked(Date.now()), 500 / SPEED);

// ------------------------------------------------------------------ socket messages
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
    case "leave":
      return { t: "leave" };
    case "create":
      return { t: "create", deck: isValidDeck(m.deck) ? m.deck : undefined, skin: isTowerSkin(m.skin) ? m.skin : undefined };
    case "queue":
      return {
        t: "queue", ranked: m.ranked === true, deck: isValidDeck(m.deck) ? m.deck : undefined,
        skin: isTowerSkin(m.skin) ? m.skin : undefined,
      };
    case "auth":
      return typeof m.token === "string" && m.token.length > 10 && m.token.length < 100 ? { t: "auth", token: m.token } : null;
    case "join":
      return typeof m.code === "string" && CODE_RE.test(m.code.toUpperCase())
        ? {
          t: "join", code: m.code.toUpperCase(), deck: isValidDeck(m.deck) ? m.deck : undefined,
          skin: isTowerSkin(m.skin) ? m.skin : undefined,
        } : null;
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

/** Deck sent with the request, else the account's saved deck, else the starter deck. */
function pickDeck(conn: Conn, sent?: string[]): string[] {
  if (sent && isValidDeck(sent)) return [...sent];
  if (conn.user && isValidDeck(conn.user.deck)) return [...conn.user.deck];
  return [...DEFAULT_DECK];
}

function busy(conn: Conn): string | null {
  if (conn.room) return "You're already in a match";
  if (conn.user && usersInMatch.has(conn.user.id)) return "Your account is already in a match";
  return null;
}

async function handle(conn: Conn, msg: ClientMsg): Promise<void> {
  const room = conn.room;
  switch (msg.t) {
    case "ping":
      return send(conn, { t: "pong", n: msg.n });

    case "auth": {
      const u = await store.getSessionUser(hashToken(msg.token)).catch(() => null);
      if (conn.queued || conn.room) return; // identity can't change mid-queue/match
      conn.user = u;
      return sendMe(conn);
    }

    case "queue": {
      conn.deck = pickDeck(conn, msg.deck);
      if (isTowerSkin(msg.skin) && !conn.room && !conn.queued) conn.skin = msg.skin;
      const b = busy(conn);
      if (b) return send(conn, { t: "err", msg: b });
      if (conn.queued) return;
      if (msg.ranked) {
        if (!conn.user) return send(conn, { t: "err", msg: "Sign in to play ranked" });
        if (rankedQueue.some((c) => c.user?.id === conn.user!.id)) {
          return send(conn, { t: "err", msg: "You're already searching in another tab" });
        }
        const fresh = await store.getUser(conn.user.id).catch(() => null);
        if (fresh) conn.user = fresh;
        if (conn.queued || conn.room) return;
        conn.queued = "ranked";
        conn.queuedAt = Date.now();
        rankedQueue.push(conn);
        send(conn, { t: "queued", ranked: true });
        pairRanked(Date.now());
        return;
      }
      for (let i = casualQueue.length - 1; i >= 0; i--) if (!isOpen(casualQueue[i])) casualQueue.splice(i, 1);
      const idx = casualQueue.findIndex((c) => !(conn.user && c.user?.id === conn.user.id));
      if (idx >= 0) {
        const other = casualQueue.splice(idx, 1)[0];
        other.queued = null;
        startMatch(other, conn, false);
      } else {
        casualQueue.push(conn);
        conn.queued = "casual";
        conn.queuedAt = Date.now();
        send(conn, { t: "queued", ranked: false });
      }
      return;
    }

    case "create": {
      conn.deck = pickDeck(conn, msg.deck);
      if (isTowerSkin(msg.skin) && !conn.room && !conn.queued) conn.skin = msg.skin;
      const b = busy(conn);
      if (b) return send(conn, { t: "err", msg: b });
      leaveQueues(conn);
      const r = makeRoom(conn, false);
      return send(conn, { t: "room", code: r.code });
    }

    case "join": {
      conn.deck = pickDeck(conn, msg.deck);
      if (isTowerSkin(msg.skin) && !conn.room && !conn.queued) conn.skin = msg.skin;
      const b = busy(conn);
      if (b) return send(conn, { t: "err", msg: b });
      const r = rooms.get(msg.code);
      if (!r || r.ended) return send(conn, { t: "err", msg: "That match code doesn't exist" });
      if (r.seats[1]) return send(conn, { t: "err", msg: "That match is already full" });
      if (r.seats[0].conn === conn || (conn.user && r.seats[0].userId === conn.user.id)) {
        return send(conn, { t: "err", msg: "You can't join your own room" });
      }
      leaveQueues(conn);
      return seatSecond(r, conn);
    }

    case "rejoin": {
      const r = rooms.get(msg.code);
      const p = r ? r.seats.findIndex((s) => s?.token === msg.token) : -1;
      if (!r || p < 0) {
        const end = recentEnds.get(msg.code);
        return end ? send(conn, end) : send(conn, { t: "err", msg: "Match not found" });
      }
      const seat = r.seats[p]!;
      if (r.ended) {
        const end = recentEnds.get(r.code);
        if (end) send(conn, end);
        return;
      }
      if (seat.conn && seat.conn !== conn) {
        seat.conn.room = null;
        seat.conn.ws.close(4000, "replaced by a newer connection");
      }
      leaveQueues(conn);
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
      send(conn, { t: "sync", seed: room.seed, tick: room.game.tick, log: room.log, decks: decksOf(room) });
      return;
    }

    case "leave": {
      leaveQueues(conn);
      if (!room) return;
      if (room.startAt === 0) {
        rooms.delete(room.code);
      } else if (!room.ended && conn.player !== null) {
        void endRoom(room, conn.player === 0 ? 1 : 0, "forfeit"); // resigning
      }
      conn.room = null;
      conn.player = null;
      return;
    }
  }
}

function onClose(conn: Conn): void {
  leaveQueues(conn);
  const room = conn.room;
  if (!room || conn.player === null) return;
  if (room.startAt === 0) {
    rooms.delete(room.code);
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

// ------------------------------------------------------------------ http
const PAGE_PATH = "dist/index.html";
let page: string | null = existsSync(PAGE_PATH) ? readFileSync(PAGE_PATH, "utf8") : null;

const registerLimit = new Limiter(TESTING ? 10_000 : 5, 60 * 60_000); // per IP per hour
const loginLimitIp = new Limiter(TESTING ? 10_000 : 30, 10 * 60_000);
const loginLimitName = new Limiter(TESTING ? 10_000 : 10, 10 * 60_000);

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
const clientIp = (req: IncomingMessage) =>
  (String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "?");

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 4096) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

async function userFromRequest(req: IncomingMessage): Promise<User | null> {
  const h = String(req.headers.authorization ?? "");
  if (!h.startsWith("Bearer ")) return null;
  return store.getSessionUser(hashToken(h.slice(7))).catch(() => null);
}

async function issueSession(user: User) {
  const token = newSessionToken();
  await store.createSession(hashToken(token), user.id, new Date(Date.now() + SESSION_DAYS * 86_400_000));
  return token;
}

async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const method = req.method ?? "GET";

  if (path === "/api/register" && method === "POST") {
    if (!registerLimit.allow(clientIp(req))) return json(res, 429, { error: "Too many new accounts from your network. Try later." });
    const body = await readBody(req);
    const err = checkUsername(body.username) ?? checkPassword(body.password);
    if (err) return json(res, 400, { error: err });
    const user = await store.createUser(body.username, await hashPassword(body.password));
    if (!user) return json(res, 409, { error: "That username is taken" });
    log(`new account: ${user.username}`);
    return json(res, 200, { token: await issueSession(user), user: toPublic(user, null, true) });
  }

  if (path === "/api/login" && method === "POST") {
    const body = await readBody(req);
    const name = typeof body.username === "string" ? body.username.slice(0, 32) : "";
    const pw = typeof body.password === "string" ? body.password.slice(0, 200) : "";
    if (!loginLimitIp.allow(clientIp(req)) || !loginLimitName.allow(name.toLowerCase())) {
      return json(res, 429, { error: "Too many attempts. Wait a few minutes." });
    }
    const user = name ? await store.findUserByName(name) : null;
    if (!user) {
      await burnTime(pw);
      return json(res, 401, { error: "Wrong username or password" });
    }
    if (!(await verifyPassword(pw, user.passwordHash))) return json(res, 401, { error: "Wrong username or password" });
    const { passwordHash: _h, ...safe } = user;
    const rank = await store.rankOf(user.id, PLACEMENT_GAMES);
    return json(res, 200, { token: await issueSession(safe), user: toPublic(safe, rank, true) });
  }

  if (path === "/api/logout" && method === "POST") {
    const h = String(req.headers.authorization ?? "");
    if (h.startsWith("Bearer ")) await store.deleteSession(hashToken(h.slice(7)));
    return json(res, 200, { ok: true });
  }

  if (path === "/api/deck" && (method === "PUT" || method === "POST")) {
    const u = await userFromRequest(req);
    if (!u) return json(res, 401, { error: "Not signed in" });
    const body = await readBody(req);
    if (!isValidDeck(body.deck)) return json(res, 400, { error: "A deck needs 8 different cards" });
    await store.saveDeck(u.id, body.deck);
    return json(res, 200, { ok: true, deck: body.deck });
  }

  if (method !== "GET") return json(res, 405, { error: "method not allowed" });

  if (path === "/api/me") {
    const u = await userFromRequest(req);
    if (!u) return json(res, 401, { error: "Not signed in" });
    return json(res, 200, { user: toPublic(u, await store.rankOf(u.id, PLACEMENT_GAMES), true) });
  }

  if (path === "/api/leaderboard") {
    const top = await store.leaderboard(100, PLACEMENT_GAMES);
    const players = top.map((u, i) => toPublic(u, i + 1));
    const me = await userFromRequest(req);
    const you = me ? toPublic(me, await store.rankOf(me.id, PLACEMENT_GAMES)) : null;
    return json(res, 200, { players, you, placementGames: PLACEMENT_GAMES });
  }

  let m = path.match(/^\/api\/players\/([A-Za-z0-9_]{1,16})$/);
  if (m) {
    const found = await store.findUserByName(m[1]);
    if (!found) return json(res, 404, { error: "No player with that name" });
    const { passwordHash: _h, ...u } = found;
    const recent = await store.recentMatches(u.id, 20);
    return json(res, 200, {
      user: toPublic(u, await store.rankOf(u.id, PLACEMENT_GAMES)),
      recent: recent.map((r) => {
        const seat = r.p0 === u.id ? 0 : 1;
        return {
          code: r.code, ranked: r.ranked, endedAt: r.endedAt, opponent: seat === 0 ? r.p1Name : r.p0Name,
          result: r.winner === -1 ? "draw" : r.winner === seat ? "win" : "loss",
          crowns: seat === 0 ? r.crowns : [r.crowns[1], r.crowns[0]], reason: r.reason,
          rating: r.ratings ? r.ratings[seat] : null,
        };
      }),
    });
  }

  m = path.match(/^\/api\/matches\/([A-Za-z0-9]{5})$/);
  if (m) {
    const rec = await store.getMatch(m[1].toUpperCase());
    return rec ? json(res, 200, rec) : json(res, 404, { error: "No finished match with that code" });
  }

  if (path === "/api/stats") {
    let live = 0;
    for (const r of rooms.values()) if (r.startAt && !r.ended) live++;
    return json(res, 200, {
      liveMatches: live, waitingRooms: rooms.size - live, casualQueue: casualQueue.length,
      rankedQueue: rankedQueue.length, players: wss.clients.size,
    });
  }
  return json(res, 404, { error: "not found" });
}

const http = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");
  if (path === "/health") return json(res, 200, { ok: true, database: store.kind });
  if (path.startsWith("/api/")) {
    api(req, res, path).catch((e) => {
      if (!res.headersSent) json(res, e?.message === "bad json" || e?.message === "too large" ? 400 : 500, { error: "Request failed" });
      if (!(e?.message === "bad json" || e?.message === "too large")) log("api error", path, e);
    });
    return;
  }
  if (req.method === "GET" && (path === "/" || path === "/index.html")) {
    if (!page && existsSync(PAGE_PATH)) page = readFileSync(PAGE_PATH, "utf8");
    if (!page) return json(res, 500, { error: "client not built: run npm run build" });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    return res.end(page);
  }
  json(res, 404, { error: "not found" });
});

// ------------------------------------------------------------------ websocket
const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: MAX_MSG_BYTES });

wss.on("connection", (ws) => {
  const conn: Conn = {
    id: nextConnId++, ws, room: null, player: null, tokens: RATE_CAPACITY, lastRefill: Date.now(),
    queued: null, queuedAt: 0, user: null, guestName: `Guest${randomInt(1000, 10000)}`, deck: [...DEFAULT_DECK], skin: "classic",
    chain: Promise.resolve(),
  };
  const live = ws as WebSocket & { _lbAlive?: boolean };
  live._lbAlive = true;
  ws.on("pong", () => (live._lbAlive = true));
  ws.on("message", (data, isBinary) => {
    if (isBinary || !rateOk(conn)) return;
    const msg = parse(data.toString());
    if (!msg) return send(conn, { t: "err", msg: "Bad message" });
    conn.chain = conn.chain.then(() => handle(conn, msg)).catch((e) => log("handler error", e));
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

// ------------------------------------------------------------------ boot
store
  .init()
  .then(() => {
    http.listen(PORT, () => log(`Lanebreak server on :${PORT} (database: ${store.kind})`));
    if (store.kind === "memory" && process.env.RAILWAY_ENVIRONMENT) {
      log("WARNING: no DATABASE_URL set. Accounts and ratings will be lost on every restart.");
    }
  })
  .catch((e) => {
    log("could not connect to the database", e);
    process.exit(1);
  });

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    log(`${sig}: shutting down`);
    for (const r of rooms.values()) sendRoom(r, { t: "err", msg: "Server restarting. Your match will be lost." });
    http.close();
    store.close().finally(() => process.exit(0));
  });
}
