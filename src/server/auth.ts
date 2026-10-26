// Passwords and sessions. Passwords are hashed with scrypt; session tokens are random and only
// their SHA-256 is stored, so a leaked database can't be used to log in as anyone.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
export const SESSION_DAYS = 30;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(pw, Buffer.from(saltB64, "base64"), expected.length, { N: +n, r: +r, p: +p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Runs a dummy hash so "no such user" takes as long as "wrong password". */
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
export async function burnTime(pw: string) {
  await verifyPassword(pw, DUMMY);
}

export const newSessionToken = () => randomBytes(32).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

const RESERVED = new Set(["admin", "administrator", "mod", "moderator", "system", "server", "bot", "guest", "rival", "lanebreak", "warwagers", "support", "you", "null", "undefined"]);

export function checkUsername(name: unknown): string | null {
  if (typeof name !== "string") return "Pick a username";
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return "Usernames are 3–16 letters, numbers or _";
  if (RESERVED.has(name.toLowerCase()) || /^guest/i.test(name)) return "That username isn't available";
  return null;
}

export function checkPassword(pw: unknown): string | null {
  if (typeof pw !== "string") return "Enter a password";
  if (pw.length < 8) return "Passwords need at least 8 characters";
  if (pw.length > 72) return "Passwords can be at most 72 characters";
  return null;
}

/** Simple sliding-window limiter keyed by IP (auth endpoints). */
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  allow(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 50_000) this.hits.clear(); // memory guard
    return true;
  }
}
