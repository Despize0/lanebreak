// Card definitions. All distances in milli-tiles (1000 = 1 tile), time in ticks (20/s).
// These are original placeholder designs, tuned for playtesting, not final balance.

export type CardKind = "troop" | "building" | "spell";
export type TargetMode = "any" | "ground" | "buildings";

export interface CardDef {
  id: string;
  name: string;
  short: string; // 1-2 letter glyph for placeholder art
  cost: number;
  kind: CardKind;
  // troop / building stats
  hp?: number;
  damage?: number;
  hitTicks?: number; // ticks between attacks
  range?: number;
  sight?: number;
  speed?: number; // milli-tiles per tick
  radius?: number; // body radius for collisions/rendering
  flying?: boolean;
  targets?: TargetMode;
  count?: number; // units spawned
  spread?: number; // spawn spread for multi-unit cards
  splash?: number; // splash radius on hit
  lifetime?: number; // buildings: ticks before expiring
  // spells
  delay?: number; // ticks from cast to impact (default SPELL_DELAY)
  spellRadius?: number;
  towerPct?: number; // % damage dealt to towers
  description: string;
}

const SLOW = 38;
const MED = 50;
const FAST = 75;
const VERY_FAST = 85;

export const CARDS: Record<string, CardDef> = {
  ironhide: {
    id: "ironhide", name: "Ironhide", short: "IH", cost: 5, kind: "troop",
    hp: 3500, damage: 140, hitTicks: 30, range: 1100, sight: 7000, speed: SLOW, radius: 750,
    targets: "buildings",
    description: "Slow tank. Ignores troops and walks straight at buildings.",
  },
  ranger: {
    id: "ranger", name: "Ranger", short: "R", cost: 3, kind: "troop",
    hp: 320, damage: 95, hitTicks: 24, range: 5500, sight: 6000, speed: MED, radius: 450,
    targets: "any",
    description: "Fragile ranged unit. Hits ground and air.",
  },
  swarmlings: {
    id: "swarmlings", name: "Swarmlings", short: "S", cost: 3, kind: "troop",
    hp: 90, damage: 45, hitTicks: 20, range: 700, sight: 5500, speed: FAST, radius: 300,
    targets: "ground", count: 6, spread: 900,
    description: "Six fast, weak melee units. Shreds tanks, dies to splash.",
  },
  bulwark: {
    id: "bulwark", name: "Bulwark", short: "B", cost: 4, kind: "building",
    hp: 1150, damage: 75, hitTicks: 16, range: 6000, sight: 6000, radius: 900,
    targets: "any", lifetime: 600,
    description: "Defensive turret. Pulls tanks, decays over 30s.",
  },
  ember: {
    id: "ember", name: "Ember Burst", short: "E", cost: 3, kind: "spell",
    damage: 320, spellRadius: 2500, towerPct: 35,
    description: "Area blast anywhere on the map. Reduced tower damage.",
  },
  skywing: {
    id: "skywing", name: "Skywing", short: "SW", cost: 4, kind: "troop",
    hp: 650, damage: 110, hitTicks: 26, range: 1600, sight: 5500, speed: MED, radius: 550,
    flying: true, targets: "any",
    description: "Flyer. Crosses the river anywhere; only air-targeting units hit it.",
  },
  brute: {
    id: "brute", name: "Brute", short: "BR", cost: 4, kind: "troop",
    hp: 1300, damage: 240, hitTicks: 30, range: 950, sight: 5500, speed: MED, radius: 650,
    targets: "ground",
    description: "Heavy-hitting melee fighter.",
  },
  sparkcaster: {
    id: "sparkcaster", name: "Sparkcaster", short: "SC", cost: 4, kind: "troop",
    hp: 480, damage: 115, hitTicks: 30, range: 5000, sight: 5500, speed: MED, radius: 500,
    targets: "any", splash: 1500,
    description: "Ranged splash damage. Great against swarms.",
  },
  // ---- added in v0.4
  zap: {
    id: "zap", name: "Zap", short: "Z", cost: 2, kind: "spell",
    damage: 170, spellRadius: 1800, towerPct: 35, delay: 3,
    description: "Instant lightning strike. Cheap answer to swarms and fragile units.",
  },
  cannon: {
    id: "cannon", name: "Sky Cannon", short: "CN", cost: 3, kind: "building",
    hp: 820, damage: 125, hitTicks: 18, range: 5500, sight: 5500, radius: 800,
    targets: "ground", lifetime: 600,
    description: "Cheap ground-only turret. Pulls tanks away from your towers.",
  },
  warden: {
    id: "warden", name: "Warden", short: "W", cost: 3, kind: "troop",
    hp: 1150, damage: 120, hitTicks: 22, range: 900, sight: 5500, speed: MED, radius: 550,
    targets: "ground",
    description: "Shield-bearing knight. Solid, cheap, dependable.",
  },
  wisps: {
    id: "wisps", name: "Wisps", short: "WI", cost: 2, kind: "troop",
    hp: 85, damage: 48, hitTicks: 18, range: 1200, sight: 5500, speed: FAST, radius: 320,
    flying: true, targets: "any", count: 3, spread: 700,
    description: "Three fast flying spirits. Hard to hit for ground-only troops.",
  },
  colossus: {
    id: "colossus", name: "Colossus", short: "CO", cost: 7, kind: "troop",
    hp: 5800, damage: 380, hitTicks: 36, range: 1200, sight: 7000, speed: 35, radius: 900,
    targets: "buildings",
    description: "Enormous crystal giant. Very slow, very hard to stop.",
  },
  twinrangers: {
    id: "twinrangers", name: "Twin Rangers", short: "TR", cost: 3, kind: "troop",
    hp: 230, damage: 66, hitTicks: 22, range: 5000, sight: 5500, speed: MED, radius: 420,
    targets: "any", count: 2, spread: 900,
    description: "Two archers. Good all-round support against ground and air.",
  },
  skyrider: {
    id: "skyrider", name: "Sky Rider", short: "SR", cost: 4, kind: "troop",
    hp: 1100, damage: 190, hitTicks: 30, range: 900, sight: 7000, speed: VERY_FAST, radius: 600,
    targets: "buildings",
    description: "Rides a hover-disc straight at the nearest building. Very fast.",
  },
  bombardier: {
    id: "bombardier", name: "Bombardier", short: "BO", cost: 3, kind: "troop",
    hp: 330, damage: 110, hitTicks: 32, range: 4500, sight: 5500, speed: MED, radius: 450,
    targets: "ground", splash: 1300,
    description: "Lobs bombs that hit everything nearby on the ground.",
  },
};

/** Default deck: both players run the same 8 cards in v0.1 (mirror match). */
export const DEFAULT_DECK: string[] = [
  "ironhide", "ranger", "swarmlings", "bulwark", "ember", "skywing", "brute", "sparkcaster",
];

/** Every card in display order (deck builder, etc.). */
export const CARD_LIST: string[] = Object.keys(CARDS);
export const DECK_SIZE = 8;

/** A legal deck: exactly 8 different, existing cards. */
export function isValidDeck(deck: unknown): deck is string[] {
  return Array.isArray(deck) && deck.length === DECK_SIZE && new Set(deck).size === DECK_SIZE
    && deck.every((c) => typeof c === "string" && Object.prototype.hasOwnProperty.call(CARDS, c));
}
