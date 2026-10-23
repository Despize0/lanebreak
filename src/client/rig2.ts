// Multi-part rigs built from separately painted body parts (scripts/rigcompose.py).
// Each unit is a body plus limbs/wings/weapons that rotate around their joints, so attacks can
// aim at the target and swing instead of the whole picture squashing.
import { RIG2, RIG2_URLS, type Rig2, type Rig2Part } from "./rig2data";

const imgs = new Map<string, HTMLImageElement>();
function img(key: string): HTMLImageElement | null {
  let im = imgs.get(key);
  if (!im) {
    const url = RIG2_URLS[key];
    if (!url || typeof Image === "undefined") return null;
    im = new Image();
    im.src = url;
    imgs.set(key, im);
  }
  return im.complete && im.naturalWidth > 0 ? im : null;
}
// start loading right away
for (const k of Object.keys(RIG2_URLS)) img(k);

/** Rig for a unit if all its layers have loaded. */
export function rigFor(unit: string): Rig2 | null {
  const r = RIG2[unit];
  if (!r || !img(`${unit}_body`)) return null;
  for (const p of r.parts) if (!img(`${unit}_${p.name}`)) return null;
  return r;
}

/** Body height relative to the unit's normal sprite height (wings/weapons stick out beyond it). */
export const RIG2_HEIGHT: Record<string, number> = { warden: 0.92, ranger: 0.95, colossus: 1.0, skywing: 0.62 };

export interface RigPose {
  angles: Record<string, number>; // extra rotation per part (radians, clockwise)
}

type V = [number, number];

/** Draws a rig in the current (feet-anchored, mirrored) transform. k = screen px per rig px. */
export class RigDraw {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private unit: string,
    private rig: Rig2,
    private k: number,
  ) {}
  get x0() { return -this.rig.ax * this.k; }
  get y0() { return -this.rig.h * this.k; }
  /** body-space point -> local transform space */
  body(p: V): V { return [this.x0 + p[0] * this.k, this.y0 + p[1] * this.k]; }
  /** part-space point -> local, for a part rotated by `ang` (plus its rest rotation) */
  partPt(part: Rig2Part, p: V, ang: number): V {
    const [ax, ay] = this.body(part.at);
    const a = part.rot + ang;
    const dx = (p[0] - part.pivot[0]) * this.k;
    const dy = (p[1] - part.pivot[1]) * this.k;
    return [ax + dx * Math.cos(a) - dy * Math.sin(a), ay + dx * Math.sin(a) + dy * Math.cos(a)];
  }
  drawBody() {
    const b = img(`${this.unit}_body`)!;
    this.ctx.drawImage(b, this.x0, this.y0, this.rig.w * this.k, this.rig.h * this.k);
  }
  /** draw a part with its pivot at `at` (or an override point in local space) */
  drawPart(part: Rig2Part, ang: number, atLocal?: V) {
    const im = img(`${this.unit}_${part.name}`)!;
    const [ax, ay] = atLocal ?? this.body(part.at);
    const c = this.ctx;
    c.save();
    c.translate(ax, ay);
    c.rotate(part.rot + ang);
    c.drawImage(im, -part.pivot[0] * this.k, -part.pivot[1] * this.k, part.w * this.k, part.h * this.k);
    c.restore();
  }
  bodyImage(): HTMLImageElement { return img(`${this.unit}_body`)!; }
}
