// Shared painting helpers: team colors, color math and shaded shapes (light comes from top-left).

export interface Team {
  main: string;
  dark: string;
  light: string;
}
export const BLUE: Team = { main: "#2f8cf0", dark: "#1a56b0", light: "#a8d4ff" };
export const RED: Team = { main: "#e8483c", dark: "#a82a22", light: "#ffb8b0" };

export interface Pose {
  t: number; // seconds, for idle/walk cycles
  id: number; // de-syncs animation phases between units
  moving: boolean;
  face: 1 | -1; // 1 = facing right
  atk: number; // 0..1 progress of the current attack animation; 1 = idle
  hp: number; // 0..1
  team: Team;
}

export type Ctx = CanvasRenderingContext2D;

const cache = new Map<string, [number, number, number]>();
function rgb(hex: string): [number, number, number] {
  let v = cache.get(hex);
  if (!v) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h, 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    cache.set(hex, v);
  }
  return v;
}
/** amt > 0 lightens toward white, amt < 0 darkens toward black. */
export function shade(hex: string, amt: number, alpha = 1): string {
  const [r, g, b] = rgb(hex);
  const t = amt < 0 ? 0 : 255;
  const k = Math.abs(amt);
  const m = (v: number) => Math.round(v + (t - v) * k);
  return alpha >= 1 ? `rgb(${m(r)},${m(g)},${m(b)})` : `rgba(${m(r)},${m(g)},${m(b)},${alpha})`;
}

/** Radial "volume" gradient for a round shape. */
export function vol(c: Ctx, x: number, y: number, rx: number, ry: number, base: string, hi = 0.38, lo = -0.42) {
  const g = c.createRadialGradient(x - rx * 0.35, y - ry * 0.45, Math.max(0.5, Math.min(rx, ry) * 0.08), x, y, Math.max(rx, ry) * 1.2);
  g.addColorStop(0, shade(base, hi));
  g.addColorStop(0.5, base);
  g.addColorStop(1, shade(base, lo));
  return g;
}

/** Shaded ellipse with a darker outline of its own color. */
export function blob(c: Ctx, x: number, y: number, rx: number, ry: number, base: string, ol: number, rot = 0) {
  if (rx <= 0 || ry <= 0) return;
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  c.fillStyle = vol(c, x, y, rx, ry, base);
  c.fill();
  if (ol > 0) {
    c.lineWidth = ol;
    c.strokeStyle = shade(base, -0.6);
    c.stroke();
  }
}

/** A limb segment: outline, base color, then a thin highlight along the lit side. */
export function limb(c: Ctx, x1: number, y1: number, x2: number, y2: number, w: number, base: string, ol: number) {
  c.lineCap = "round";
  c.strokeStyle = shade(base, -0.6);
  c.lineWidth = w + ol * 2;
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
  c.strokeStyle = base;
  c.lineWidth = w;
  c.stroke();
  c.strokeStyle = shade(base, 0.32);
  c.lineWidth = Math.max(0.6, w * 0.32);
  c.beginPath();
  c.moveTo(x1 - w * 0.18, y1 - w * 0.12);
  c.lineTo(x2 - w * 0.18, y2 - w * 0.12);
  c.stroke();
}

/** Closed polygon with vertical light-to-dark gradient. */
export function slab(c: Ctx, pts: number[], base: string, ol: number, top?: number, bottom?: number) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < pts.length; i += 2) {
    minY = Math.min(minY, pts[i]);
    maxY = Math.max(maxY, pts[i]);
  }
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  const g = c.createLinearGradient(0, top ?? minY, 0, bottom ?? maxY);
  g.addColorStop(0, shade(base, 0.25));
  g.addColorStop(0.55, base);
  g.addColorStop(1, shade(base, -0.35));
  c.fillStyle = g;
  c.fill();
  if (ol > 0) {
    c.lineWidth = ol;
    c.lineJoin = "round";
    c.strokeStyle = shade(base, -0.6);
    c.stroke();
  }
}

export function glow(c: Ctx, x: number, y: number, r: number, color: string, alpha = 0.6) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, shade(color, 0.6, alpha));
  g.addColorStop(0.4, shade(color, 0, alpha * 0.5));
  g.addColorStop(1, shade(color, 0, 0));
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}
