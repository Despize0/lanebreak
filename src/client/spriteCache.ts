// Loads the painted unit sprites and prepares team-outlined copies for fast drawing.

import { UNIT_SPRITES, SIDE_FACES, type View } from "./unitSprites";
import type { Team } from "./paint";

const images = new Map<string, HTMLImageElement>();
const outlined = new Map<string, HTMLCanvasElement>();
const PAD = 4; // outline thickness in source pixels (sprites are ~120px tall)

for (const [unit, views] of Object.entries(UNIT_SPRITES)) {
  for (const [view, url] of Object.entries(views)) {
    if (!url) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    images.set(`${unit}:${view}`, img);
  }
}

function ready(img: HTMLImageElement | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}

/** Sprite with a soft team-colored outline baked in, built once per sprite and team. */
function outline(key: string, img: HTMLImageElement, team: Team): HTMLCanvasElement {
  const k = `${key}:${team.main}`;
  const hit = outlined.get(k);
  if (hit) return hit;
  const w = img.naturalWidth + PAD * 2;
  const h = img.naturalHeight + PAD * 2;
  const silhouette = document.createElement("canvas");
  silhouette.width = w;
  silhouette.height = h;
  const s = silhouette.getContext("2d")!;
  s.drawImage(img, PAD, PAD);
  s.globalCompositeOperation = "source-in";
  s.fillStyle = team.main;
  s.fillRect(0, 0, w, h);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d")!;
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2;
    c.drawImage(silhouette, Math.round(Math.cos(ang) * (PAD - 1)), Math.round(Math.sin(ang) * (PAD - 1)));
  }
  c.globalAlpha = 0.9;
  c.drawImage(silhouette, 0, 0); // fill the center so the outline reads as solid
  c.globalAlpha = 1;
  c.drawImage(img, PAD, PAD);
  outlined.set(k, cv);
  return cv;
}

export interface SpriteFrame {
  canvas: HTMLCanvasElement;
  flip: boolean; // mirror horizontally
  pad: number; // outline padding (source px) on every side
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
    const srcFace = v === "side" ? SIDE_FACES[card] ?? 1 : 1;
    return { canvas: outline(key, img, team), flip: v === "side" && srcFace !== face, pad: PAD };
  }
  return null;
}

export const hasSprites = (card: string) => !!UNIT_SPRITES[card];
