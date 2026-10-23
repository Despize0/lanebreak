// Rigged attack/idle motion for painted units: parts cut from the views (scripts/rigparts.py)
// are drawn as separate layers and moved around pivots. Coordinates are view-image pixels.
import skywing_back_body from "../../assets/rig/skywing_back_body.webp";
import skywing_back_wingL from "../../assets/rig/skywing_back_wingL.webp";
import skywing_back_wingR from "../../assets/rig/skywing_back_wingR.webp";
import skywing_front_body from "../../assets/rig/skywing_front_body.webp";
import skywing_front_wingL from "../../assets/rig/skywing_front_wingL.webp";
import skywing_front_wingR from "../../assets/rig/skywing_front_wingR.webp";
import skywing_side_body from "../../assets/rig/skywing_side_body.webp";
import skywing_side_wingL from "../../assets/rig/skywing_side_wingL.webp";
import skywing_side_wingR from "../../assets/rig/skywing_side_wingR.webp";
import warden_back_blade from "../../assets/rig/warden_back_blade.webp";
import warden_back_body from "../../assets/rig/warden_back_body.webp";
import warden_front_blade from "../../assets/rig/warden_front_blade.webp";
import warden_front_body from "../../assets/rig/warden_front_body.webp";
import warden_side_blade from "../../assets/rig/warden_side_blade.webp";
import warden_side_body from "../../assets/rig/warden_side_body.webp";
import type { View } from "./unitSprites";

const RIG_URLS: Record<string, string> = {
  skywing_back_body,
  skywing_back_wingL,
  skywing_back_wingR,
  skywing_front_body,
  skywing_front_wingL,
  skywing_front_wingR,
  skywing_side_body,
  skywing_side_wingL,
  skywing_side_wingR,
  warden_back_blade,
  warden_back_body,
  warden_front_blade,
  warden_front_body,
  warden_side_blade,
  warden_side_body,
};

const imgs = new Map<string, HTMLImageElement>();
for (const [k, url] of Object.entries(RIG_URLS)) {
  if (typeof Image === "undefined") break;
  const im = new Image();
  im.src = url;
  imgs.set(k, im);
}
/** A rig layer image, or null until it has loaded. */
export function rigImage(unit: string, view: View, part: string): HTMLImageElement | null {
  const im = imgs.get(`${unit}_${view}_${part}`);
  return im && im.complete && im.naturalWidth > 0 ? im : null;
}

type P = readonly [number, number];
/** Warden: the blade swings around the grip. */
export const SWORD: Record<string, Partial<Record<View, { grip: P; tip: P }>>> = {
  warden: {
    front: { grip: [101, 97], tip: [115, 47] },
    back: { grip: [92, 85], tip: [101, 20] },
    side: { grip: [77, 78], tip: [95, 17] },
  },
};
/** Skywing: wings flap around the shoulders; fire comes out of the mouth. */
export const WINGS: Record<string, Partial<Record<View, { wingL: P; wingR: P; mouth: P }>>> = {
  skywing: {
    front: { wingL: [82, 52], wingR: [112, 46], mouth: [125, 96] },
    side: { wingL: [82, 52], wingR: [112, 46], mouth: [125, 96] },
    back: { wingL: [46, 45], wingR: [82, 30], mouth: [96, 96] },
  },
};
/** Archers: bow tips, the drawing hand, and where the arrow points. */
export interface BowRig { top: P; bot: P; hand: P; aim: P }
export const BOWS: Record<string, Partial<Record<View, BowRig>>> = {
  ranger: {
    front: { top: [88, 22], bot: [82, 110], hand: [47, 72], aim: [108, 62] },
    back: { top: [88, 18], bot: [82, 108], hand: [52, 66], aim: [105, 56] },
    side: { top: [92, 19], bot: [84, 106], hand: [55, 72], aim: [106, 54] },
  },
  twinrangers: {
    front: { top: [95, 30], bot: [86, 103], hand: [48, 66], aim: [112, 58] },
    back: { top: [95, 30], bot: [86, 103], hand: [48, 66], aim: [112, 58] },
    side: { top: [96, 30], bot: [88, 74], hand: [55, 64], aim: [92, 58] },
  },
  twinrangersp: {
    front: { top: [104, 32], bot: [93, 108], hand: [50, 68], aim: [118, 58] },
  },
};
/** Heavy hitters that wind up and slam (body motion + ground shockwave). */
export const SLAMMERS = new Set(["ironhide", "colossus", "brute"]);
/** Heavy walkers that kick up dust on every step. */
export const HEAVY = new Set(["ironhide", "colossus"]);
