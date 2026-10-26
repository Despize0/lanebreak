// Ranked tiers (shared by server and client).

export const PLACEMENT_GAMES = 5;

export interface Tier {
  name: string;
  min: number;
  color: string;
}

export const TIERS: Tier[] = [
  { name: "Breeze", min: 0, color: "#9fd8c9" },
  { name: "Gale", min: 1300, color: "#7cc4f2" },
  { name: "Storm", min: 1500, color: "#8d8cf0" },
  { name: "Thunder", min: 1700, color: "#f2c14e" },
  { name: "Tempest", min: 1900, color: "#f2814e" },
  { name: "Skyborn", min: 2100, color: "#f0f4ff" },
];

export function tierFor(rating: number): Tier {
  let t = TIERS[0];
  for (const x of TIERS) if (rating >= x.min) t = x;
  return t;
}

/** What players see about each other. Never includes password hashes or sessions. */
export interface PublicUser {
  id: number;
  name: string;
  rating: number; // rounded
  games: number;
  wins: number;
  losses: number;
  draws: number;
  placed: boolean;
  tier: string;
  rank?: number | null;
  deck?: string[] | null; // only included for your own account
}

export interface PlayerInfo {
  name: string;
  rating: number | null; // null for guests
  tier: string | null;
  placed: boolean;
  skin?: TowerSkin; // side-tower look this player picked
}

export const TOWER_SKINS = ["warden", "ironhide", "colossus", "ranger"] as const;
/** Tower style for anyone who hasn't picked one (or sent an unknown one). */
export const DEFAULT_SKIN = "warden";
export type TowerSkin = (typeof TOWER_SKINS)[number];
export const isTowerSkin = (v: unknown): v is TowerSkin => typeof v === "string" && (TOWER_SKINS as readonly string[]).includes(v);
