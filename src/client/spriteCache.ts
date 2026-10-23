// Loads the painted unit sprites and prepares team-outlined copies for fast drawing.

import { UNIT_SPRITES, SIDE_FACES, type View } from "./unitSprites";
import { UNIT_ANIM } from "./unitAnim";
import type { Team } from "./paint";

const images = new Map<string, HTMLImageElement>();
const outlined = new Map<string, HTMLCanvasElement>();
const PAD = 1; // transparent margin in source pixels

for (const [unit, views] of Object.entries(UNIT_SPRITES)) {
  for (const [view, url] of Object.entries(views)) {
    if (!url) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    images.set(`${unit}:${view}`, img);
  }
}

const animImages = new Map<string, HTMLImageElement>();
for (const [key, anim] of Object.entries(UNIT_ANIM)) {
  for (const kind of ["walk", "attack"] as const) {
    anim[kind].forEach((f, i) => {
      const img = new Image();
      img.decoding = "async";
      img.src = f.url;
      animImages.set(`${key}:${kind}:${i}`, img);
    });
  }
}

function ready(img: HTMLImageElement | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}

/** Sprite copied onto a canvas once (no outline: team is shown by the glow under the unit). */
function outline(key: string, img: HTMLImageElement, _team: Team): HTMLCanvasElement {
  const hit = outlined.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth + PAD * 2;
  cv.height = img.naturalHeight + PAD * 2;
  cv.getContext("2d")!.drawImage(img, PAD, PAD);
  outlined.set(key, cv);
  return cv;
}

export interface SpriteFrame {
  canvas: HTMLCanvasElement;
  flip: boolean; // mirror horizontally
  pad: number; // outline padding (source px) on every side
  view: View; // which painted view this is (may differ from the one asked for)
}

/**
 * The best available frame for a unit looking in a direction.
 * dir: "front" (toward the viewer), "back" (away), "side"; face: 1 right / -1 left (side only).
 * Returns null if this unit has no painted sprite (or it hasn't loaded yet).
 */
export function spriteFor(card: string, dir: View, face: 1 | -1, team: Team): SpriteFrame | null {
  const order: View[] = dir === "side" ? ["side", "front", "back"] : dir === "back" ? ["back", "front", "side"] : ["front", "back", "side"];
  for (const v of order) {
    const key = `${card}:${v}`;
    const img = images.get(key);
    if (!ready(img)) continue;
    // the painted views all face right (side views per SIDE_FACES); mirror to face the other way
    const srcFace = v === "side" ? SIDE_FACES[card] ?? 1 : 1;
    return { canvas: outline(key, img, team), flip: srcFace !== face, pad: PAD, view: v };
  }
  return null;
}

export const hasSprites = (card: string) => !!UNIT_SPRITES[card];

export interface AnimFrame {
  canvas: HTMLCanvasElement;
  pad: number;
  ax: number; // feet x inside the original frame
}

/** One walk/attack frame with the team outline baked in (frames face right). */
export function animFrame(key: string, kind: "walk" | "attack", i: number, team: Team): AnimFrame | null {
  const anim = UNIT_ANIM[key];
  if (!anim || !anim[kind].length) return null;
  const idx = ((i % anim[kind].length) + anim[kind].length) % anim[kind].length;
  const id = `${key}:${kind}:${idx}`;
  const img = animImages.get(id);
  if (!ready(img)) return null;
  return { canvas: outline(id, img, team), pad: PAD, ax: anim[kind][idx].ax };
}
