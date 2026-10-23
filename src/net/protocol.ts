// Wire protocol shared by server and client. JSON over one WebSocket.
//
// Model: deterministic lockstep with an authoritative server.
//  - Clients send only intents ("play this card here").
//  - The server stamps each intent with its current tick, runs the real sim, and
//    broadcasts one frame per tick: the tick number plus the inputs applied on it.
//  - Clients run the same sim from the same seed and apply frames in order, so their
//    state is identical to the server's. They report hashes; the server checks them.

import type { PlayerId } from "../sim/sim";

/** [player, card, x, y] — compact input inside a frame */
export type WireInput = [PlayerId, string, number, number];
/** [tick, player, card, x, y] — an accepted-or-not input in the match log */
export type LogEntry = [number, PlayerId, string, number, number];

export type ClientMsg =
  | { t: "queue" }
  | { t: "create" }
  | { t: "join"; code: string }
  | { t: "rejoin"; code: string; token: string }
  | { t: "play"; card: string; x: number; y: number }
  | { t: "hash"; tick: number; h: number }
  | { t: "leave" }
  | { t: "ping"; n: number };

export type ServerMsg =
  | { t: "queued" }
  | { t: "room"; code: string }
  | { t: "start"; code: string; token: string; you: PlayerId; seed: number; tick: number; log: LogEntry[] }
  | { t: "f"; k: number; i?: WireInput[] }
  | { t: "rej"; reason: string }
  | { t: "opp"; status: "disconnected" | "reconnected" }
  | { t: "end"; winner: PlayerId | -1; crowns: [number, number]; hash: number; reason: "towers" | "forfeit" }
  | { t: "sync"; seed: number; tick: number; log: LogEntry[] }
  | { t: "err"; msg: string }
  | { t: "pong"; n: number };

export const MAX_MSG_BYTES = 512;
