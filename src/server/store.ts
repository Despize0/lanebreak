// Persistence. Postgres in production (DATABASE_URL), in-memory for local dev and tests.

import pg from "pg";
import { DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL } from "./glicko";
import { DEFAULT_DECK } from "../sim/cards";
import type { LogEntry } from "../net/protocol";

export interface User {
  id: number;
  username: string;
  rating: number;
  rd: number;
  vol: number;
  wins: number;
  losses: number;
  draws: number;
  createdAt: Date;
  lastMatchAt: Date | null;
  deck: string[] | null;
}
export interface UserWithHash extends User {
  passwordHash: string;
}

export interface MatchRow {
  code: string;
  ranked: boolean;
  p0: number | null;
  p1: number | null;
  p0Name: string;
  p1Name: string;
  winner: number; // 0, 1, or -1 for a draw
  crowns: [number, number];
  reason: string;
  ticks: number;
  hash: number;
  seed: number;
  log: LogEntry[];
  decks: [string[], string[]];
  endedAt: Date;
  ratings: [[number, number], [number, number]] | null; // per seat: [before, after]
}

export interface RatingUpdate {
  userId: number;
  rating: number;
  rd: number;
  vol: number;
  result: "win" | "loss" | "draw";
}

export interface Store {
  kind: "postgres" | "memory";
  init(): Promise<void>;
  createUser(username: string, passwordHash: string): Promise<User | null>; // null = name taken
  findUserByName(username: string): Promise<UserWithHash | null>;
  getUser(id: number): Promise<User | null>;
  saveDeck(userId: number, deck: string[]): Promise<void>;
  createSession(tokenHash: string, userId: number, expiresAt: Date): Promise<void>;
  getSessionUser(tokenHash: string): Promise<User | null>;
  deleteSession(tokenHash: string): Promise<void>;
  saveMatch(m: MatchRow, updates: RatingUpdate[]): Promise<void>;
  getMatch(code: string): Promise<MatchRow | null>;
  leaderboard(limit: number, minGames: number): Promise<User[]>;
  rankOf(userId: number, minGames: number): Promise<number | null>;
  recentMatches(userId: number, limit: number): Promise<Omit<MatchRow, "log" | "decks">[]>;
  close(): Promise<void>;
}

const games = (u: User) => u.wins + u.losses + u.draws;

// ------------------------------------------------------------------ memory
export class MemoryStore implements Store {
  kind = "memory" as const;
  private users = new Map<number, UserWithHash>();
  private byName = new Map<string, number>();
  private sessions = new Map<string, { userId: number; expiresAt: Date }>();
  private matches = new Map<string, MatchRow>();
  private nextId = 1;

  async init() {}
  async close() {}

  async createUser(username: string, passwordHash: string) {
    const key = username.toLowerCase();
    if (this.byName.has(key)) return null;
    const u: UserWithHash = {
      id: this.nextId++, username, passwordHash, rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL,
      wins: 0, losses: 0, draws: 0, createdAt: new Date(), lastMatchAt: null, deck: null,
    };
    this.users.set(u.id, u);
    this.byName.set(key, u.id);
    return strip(u);
  }
  async findUserByName(username: string) {
    const id = this.byName.get(username.toLowerCase());
    return id ? { ...this.users.get(id)! } : null;
  }
  async getUser(id: number) {
    const u = this.users.get(id);
    return u ? strip(u) : null;
  }
  async saveDeck(userId: number, deck: string[]) {
    const u = this.users.get(userId);
    if (u) u.deck = [...deck];
  }
  async createSession(tokenHash: string, userId: number, expiresAt: Date) {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }
  async getSessionUser(tokenHash: string) {
    const s = this.sessions.get(tokenHash);
    if (!s || s.expiresAt < new Date()) return null;
    return this.getUser(s.userId);
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
  async saveMatch(m: MatchRow, updates: RatingUpdate[]) {
    this.matches.set(m.code, m);
    if (this.matches.size > 2000) this.matches.delete(this.matches.keys().next().value!);
    for (const up of updates) {
      const u = this.users.get(up.userId);
      if (!u) continue;
      u.rating = up.rating;
      u.rd = up.rd;
      u.vol = up.vol;
      if (up.result === "win") u.wins++;
      else if (up.result === "loss") u.losses++;
      else u.draws++;
      u.lastMatchAt = m.endedAt;
    }
  }
  async getMatch(code: string) {
    return this.matches.get(code) ?? null;
  }
  async leaderboard(limit: number, minGames: number) {
    return [...this.users.values()]
      .filter((u) => games(u) >= minGames)
      .sort((a, b) => b.rating - a.rating || a.id - b.id)
      .slice(0, limit)
      .map(strip);
  }
  async rankOf(userId: number, minGames: number) {
    const u = this.users.get(userId);
    if (!u || games(u) < minGames) return null;
    let rank = 1;
    for (const o of this.users.values()) if (games(o) >= minGames && o.rating > u.rating) rank++;
    return rank;
  }
  async recentMatches(userId: number, limit: number) {
    return [...this.matches.values()]
      .filter((m) => m.p0 === userId || m.p1 === userId)
      .sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime())
      .slice(0, limit)
      .map(({ log: _log, decks: _d, ...rest }) => rest);
  }
}
const strip = (u: UserWithHash): User => {
  const { passwordHash: _h, ...rest } = u;
  return rest;
};

// ------------------------------------------------------------------ postgres
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  username       TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  rating         DOUBLE PRECISION NOT NULL DEFAULT ${DEFAULT_RATING},
  rd             DOUBLE PRECISION NOT NULL DEFAULT ${DEFAULT_RD},
  vol            DOUBLE PRECISION NOT NULL DEFAULT ${DEFAULT_VOL},
  wins           INTEGER NOT NULL DEFAULT 0,
  losses         INTEGER NOT NULL DEFAULT 0,
  draws          INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_match_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS users_rating_idx ON users (rating DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS matches (
  code       TEXT PRIMARY KEY,
  ranked     BOOLEAN NOT NULL,
  p0         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  p1         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  p0_name    TEXT NOT NULL,
  p1_name    TEXT NOT NULL,
  winner     SMALLINT NOT NULL,
  crowns0    SMALLINT NOT NULL,
  crowns1    SMALLINT NOT NULL,
  reason     TEXT NOT NULL,
  ticks      INTEGER NOT NULL,
  hash       BIGINT NOT NULL,
  seed       BIGINT NOT NULL,
  log        JSONB NOT NULL,
  ended_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  p0_before  DOUBLE PRECISION, p0_after DOUBLE PRECISION,
  p1_before  DOUBLE PRECISION, p1_after DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS matches_p0_idx ON matches (p0, ended_at DESC);
ALTER TABLE users ADD COLUMN IF NOT EXISTS deck JSONB;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS decks JSONB;
CREATE INDEX IF NOT EXISTS matches_p1_idx ON matches (p1, ended_at DESC);
`;

function rowToUser(r: any): User {
  return {
    id: Number(r.id), username: r.username, rating: Number(r.rating), rd: Number(r.rd), vol: Number(r.vol),
    wins: r.wins, losses: r.losses, draws: r.draws, createdAt: r.created_at, lastMatchAt: r.last_match_at,
    deck: Array.isArray(r.deck) ? r.deck : null,
  };
}
function rowToMatch(r: any): MatchRow {
  return {
    code: r.code, ranked: r.ranked, p0: r.p0 === null ? null : Number(r.p0), p1: r.p1 === null ? null : Number(r.p1),
    p0Name: r.p0_name, p1Name: r.p1_name, winner: r.winner, crowns: [r.crowns0, r.crowns1], reason: r.reason,
    ticks: r.ticks, hash: Number(r.hash), seed: Number(r.seed), log: r.log ?? [], endedAt: r.ended_at,
    decks: r.decks ?? [DEFAULT_DECK, DEFAULT_DECK],
    ratings: r.p0_before === null ? null : [[Number(r.p0_before), Number(r.p0_after)], [Number(r.p1_before), Number(r.p1_after)]],
  };
}
const USER_COLS = "id, username, rating, rd, vol, wins, losses, draws, created_at, last_match_at, deck";

export class PgStore implements Store {
  kind = "postgres" as const;
  private pool: pg.Pool;
  constructor(url: string) {
    const local = /localhost|127\.0\.0\.1|\.railway\.internal/.test(url);
    this.pool = new pg.Pool({
      connectionString: url,
      max: 10,
      ssl: local || /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: false },
    });
  }
  async init() {
    await this.pool.query(SCHEMA);
    await this.pool.query("DELETE FROM sessions WHERE expires_at < now()");
  }
  async close() {
    await this.pool.end();
  }
  async createUser(username: string, passwordHash: string) {
    const r = await this.pool.query(
      `INSERT INTO users (username, username_lower, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (username_lower) DO NOTHING RETURNING ${USER_COLS}`,
      [username, username.toLowerCase(), passwordHash],
    );
    return r.rows[0] ? rowToUser(r.rows[0]) : null;
  }
  async findUserByName(username: string) {
    const r = await this.pool.query(`SELECT ${USER_COLS}, password_hash FROM users WHERE username_lower = $1`, [username.toLowerCase()]);
    return r.rows[0] ? { ...rowToUser(r.rows[0]), passwordHash: r.rows[0].password_hash } : null;
  }
  async getUser(id: number) {
    const r = await this.pool.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
    return r.rows[0] ? rowToUser(r.rows[0]) : null;
  }
  async saveDeck(userId: number, deck: string[]) {
    await this.pool.query("UPDATE users SET deck = $2 WHERE id = $1", [userId, JSON.stringify(deck)]);
  }
  async createSession(tokenHash: string, userId: number, expiresAt: Date) {
    await this.pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [tokenHash, userId, expiresAt]);
  }
  async getSessionUser(tokenHash: string) {
    const r = await this.pool.query(
      `SELECT ${USER_COLS.split(", ").map((c) => "u." + c).join(", ")} FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    );
    return r.rows[0] ? rowToUser(r.rows[0]) : null;
  }
  async deleteSession(tokenHash: string) {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }
  async saveMatch(m: MatchRow, updates: RatingUpdate[]) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `INSERT INTO matches (code, ranked, p0, p1, p0_name, p1_name, winner, crowns0, crowns1, reason, ticks, hash, seed, log,
           ended_at, p0_before, p0_after, p1_before, p1_after, decks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (code) DO NOTHING`,
        [
          m.code, m.ranked, m.p0, m.p1, m.p0Name, m.p1Name, m.winner, m.crowns[0], m.crowns[1], m.reason, m.ticks,
          m.hash, m.seed, JSON.stringify(m.log), m.endedAt,
          m.ratings?.[0][0] ?? null, m.ratings?.[0][1] ?? null, m.ratings?.[1][0] ?? null, m.ratings?.[1][1] ?? null,
          JSON.stringify(m.decks),
        ],
      );
      for (const up of updates) {
        await c.query(
          `UPDATE users SET rating = $2, rd = $3, vol = $4, last_match_at = $5,
             wins = wins + $6, losses = losses + $7, draws = draws + $8 WHERE id = $1`,
          [up.userId, up.rating, up.rd, up.vol, m.endedAt, +(up.result === "win"), +(up.result === "loss"), +(up.result === "draw")],
        );
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async getMatch(code: string) {
    const r = await this.pool.query("SELECT * FROM matches WHERE code = $1", [code]);
    return r.rows[0] ? rowToMatch(r.rows[0]) : null;
  }
  async leaderboard(limit: number, minGames: number) {
    const r = await this.pool.query(
      `SELECT ${USER_COLS} FROM users WHERE wins + losses + draws >= $2 ORDER BY rating DESC, id ASC LIMIT $1`,
      [limit, minGames],
    );
    return r.rows.map(rowToUser);
  }
  async rankOf(userId: number, minGames: number) {
    const r = await this.pool.query(
      `SELECT CASE WHEN u.wins + u.losses + u.draws < $2 THEN NULL ELSE
         (SELECT count(*) + 1 FROM users o WHERE o.wins + o.losses + o.draws >= $2 AND o.rating > u.rating) END AS rank
       FROM users u WHERE u.id = $1`,
      [userId, minGames],
    );
    const v = r.rows[0]?.rank;
    return v === null || v === undefined ? null : Number(v);
  }
  async recentMatches(userId: number, limit: number) {
    const r = await this.pool.query(
      `SELECT code, ranked, p0, p1, p0_name, p1_name, winner, crowns0, crowns1, reason, ticks, hash, seed, ended_at,
              p0_before, p0_after, p1_before, p1_after
       FROM matches WHERE p0 = $1 OR p1 = $1 ORDER BY ended_at DESC LIMIT $2`,
      [userId, limit],
    );
    return r.rows.map((row: any) => {
      const { log: _l, decks: _d, ...rest } = rowToMatch({ ...row, log: [] });
      return rest;
    });
  }
}

export function makeStore(): Store {
  const url = process.env.DATABASE_URL;
  return url ? new PgStore(url) : new MemoryStore();
}
