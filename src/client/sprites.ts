// Procedural cartoon sprites. Everything is drawn with canvas paths: no image files.
// Coordinates are screen pixels. (x, y) is the point where the unit touches the ground;
// r is the unit's body radius in pixels.

import { BLUE, RED, type Pose, type Team } from "./paint";
import { drawUnit } from "./characters";
export { BLUE, RED, drawUnit, type Pose, type Team };

const INK = "#1d1733";
const SKIN = "#f3c9a1";

function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, stroke = true) {
  c.beginPath();
  c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  if (stroke) c.stroke();
}
function poly(c: CanvasRenderingContext2D, pts: number[], fill: string, stroke = true) {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (stroke) c.stroke();
}
function eyes(c: CanvasRenderingContext2D, x: number, y: number, s: number, face: number, gap = 1) {
  for (const side of [-1, 1]) {
    const ex = x + side * s * 0.9 * gap + face * s * 0.35;
    ellipse(c, ex, y, s * 0.62, s * 0.75, "#fff", false);
    ellipse(c, ex + face * s * 0.22, y + s * 0.08, s * 0.32, s * 0.4, INK, false);
  }
}
const ink = (c: CanvasRenderingContext2D, r: number) => {
  c.strokeStyle = INK;
  c.lineWidth = Math.max(1, r * 0.09);
  c.lineJoin = "round";
  c.lineCap = "round";
};

// ------------------------------------------------------------------ spells
export function drawFireball(c: CanvasRenderingContext2D, x: number, y: number, r: number, dx: number, dy: number, t: number) {
  // trail opposite to the direction of travel
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  for (let i = 5; i >= 1; i--) {
    const k = i / 5;
    c.beginPath();
    c.arc(x - ux * r * 1.4 * i, y - uy * r * 1.4 * i, r * (1 - k * 0.55), 0, Math.PI * 2);
    c.fillStyle = `rgba(255,${Math.round(120 + 60 * (1 - k))},40,${0.5 * (1 - k * 0.7)})`;
    c.fill();
  }
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, "#fffbe0");
  g.addColorStop(0.45, "#ffd23f");
  g.addColorStop(1, "#ff5a1f");
  c.save();
  c.shadowColor = "#ff8a1f";
  c.shadowBlur = r * 1.4;
  c.beginPath();
  c.arc(x, y, r * (1 + Math.sin(t * 30) * 0.05), 0, Math.PI * 2);
  c.fillStyle = g;
  c.fill();
  c.restore();
}

// ------------------------------------------------------------------ towers
export function drawLighthouse(c: CanvasRenderingContext2D, x: number, y: number, r: number, team: Team, active: boolean, t: number) {
  c.save();
  ink(c, r * 0.6);
  const baseY = y + r * 0.42;
  ellipse(c, x, baseY, r * 0.98, r * 0.42, "#7e7768");
  ellipse(c, x, baseY - r * 0.1, r * 0.9, r * 0.36, "#9d9687");
  // tapered body
  const bw = r * 0.62;
  const tw = r * 0.42;
  const topY = y - r * 1.05;
  c.beginPath();
  c.moveTo(x - bw, baseY - r * 0.1);
  c.lineTo(x - tw, topY);
  c.lineTo(x + tw, topY);
  c.lineTo(x + bw, baseY - r * 0.1);
  c.closePath();
  c.fillStyle = "#efe9dc";
  c.fill();
  c.stroke();
  // stripes
  c.save();
  c.clip();
  c.fillStyle = team.main;
  for (let i = 0; i < 2; i++) {
    const sy = baseY - r * 0.45 - i * r * 0.62;
    c.fillRect(x - r, sy, r * 2, r * 0.26);
  }
  c.restore();
  // door
  c.beginPath();
  c.arc(x, baseY - r * 0.2, r * 0.17, Math.PI, 0);
  c.lineTo(x + r * 0.17, baseY - r * 0.06);
  c.lineTo(x - r * 0.17, baseY - r * 0.06);
  c.closePath();
  c.fillStyle = "#4a3426";
  c.fill();
  // gallery
  c.fillStyle = "#3b3552";
  c.fillRect(x - r * 0.62, topY - r * 0.1, r * 1.24, r * 0.16);
  c.strokeRect(x - r * 0.62, topY - r * 0.1, r * 1.24, r * 0.16);
  // lamp room
  const ly = topY - r * 0.48;
  c.fillStyle = active ? "#fff3b0" : "#5d6178";
  if (active) {
    c.save();
    c.shadowColor = "#ffe27a";
    c.shadowBlur = r * 0.9;
    c.fillRect(x - r * 0.32, ly, r * 0.64, r * 0.38);
    c.restore();
  } else c.fillRect(x - r * 0.32, ly, r * 0.64, r * 0.38);
  c.strokeRect(x - r * 0.32, ly, r * 0.64, r * 0.38);
  c.beginPath();
  c.moveTo(x, ly);
  c.lineTo(x, ly + r * 0.38);
  c.stroke();
  // roof + finial
  poly(c, [x - r * 0.46, ly, x + r * 0.46, ly, x, ly - r * 0.5], team.main);
  ellipse(c, x, ly - r * 0.55, r * 0.08, r * 0.08, "#ffc94a");
  // sweeping light beam
  if (active) {
    const a = t * 0.9 + x * 0.01;
    c.save();
    c.globalCompositeOperation = "lighter";
    c.fillStyle = "rgba(255,240,170,.10)";
    c.beginPath();
    c.moveTo(x, ly + r * 0.19);
    c.arc(x, ly + r * 0.19, r * 3.2, a - 0.18, a + 0.18);
    c.closePath();
    c.fill();
    c.restore();
  }
  c.restore();
}

export function drawKeep(c: CanvasRenderingContext2D, x: number, y: number, r: number, team: Team, active: boolean, t: number) {
  c.save();
  ink(c, r * 0.55);
  const baseY = y + r * 0.42;
  ellipse(c, x, baseY, r * 1.0, r * 0.4, "#7e7768");
  // main block
  const w = r * 0.82;
  const top = y - r * 0.85;
  c.fillStyle = "#e3dccd";
  c.fillRect(x - w, top, w * 2, baseY - top - r * 0.08);
  c.strokeRect(x - w, top, w * 2, baseY - top - r * 0.08);
  // crenellations
  for (let i = 0; i < 5; i++) {
    const cx = x - w + (i * (w * 2 - r * 0.24)) / 4;
    c.fillStyle = "#e3dccd";
    c.fillRect(cx, top - r * 0.2, r * 0.24, r * 0.2);
    c.strokeRect(cx, top - r * 0.2, r * 0.24, r * 0.2);
  }
  // brick lines
  c.save();
  c.strokeStyle = "rgba(29,23,51,.22)";
  c.lineWidth = Math.max(1, r * 0.025);
  for (let i = 1; i < 4; i++) {
    const yy = top + i * r * 0.32;
    c.beginPath();
    c.moveTo(x - w, yy);
    c.lineTo(x + w, yy);
    c.stroke();
  }
  c.restore();
  // banners
  for (const s of [-1, 1]) {
    const bx = x + s * w * 0.62;
    poly(c, [bx - r * 0.16, top + r * 0.05, bx + r * 0.16, top + r * 0.05, bx + r * 0.16, top + r * 0.75, bx, top + r * 0.62, bx - r * 0.16, top + r * 0.75], team.main);
  }
  // gate
  c.beginPath();
  c.arc(x, baseY - r * 0.42, r * 0.26, Math.PI, 0);
  c.lineTo(x + r * 0.26, baseY - r * 0.08);
  c.lineTo(x - r * 0.26, baseY - r * 0.08);
  c.closePath();
  c.fillStyle = "#4a3426";
  c.fill();
  c.stroke();
  // crown turret
  const ty = top - r * 0.62;
  c.fillStyle = "#d4ccbc";
  c.fillRect(x - r * 0.34, ty, r * 0.68, r * 0.45);
  c.strokeRect(x - r * 0.34, ty, r * 0.68, r * 0.45);
  poly(c, [x - r * 0.44, ty, x + r * 0.44, ty, x, ty - r * 0.5], team.main);
  // crown emblem
  const cy = ty + r * 0.22;
  const cw = r * 0.22;
  c.save();
  if (active) {
    c.shadowColor = "#ffd34a";
    c.shadowBlur = r * 0.5;
  }
  poly(c, [x - cw, cy + cw * 0.5, x - cw, cy - cw * 0.4, x - cw * 0.5, cy, x, cy - cw * 0.7, x + cw * 0.5, cy, x + cw, cy - cw * 0.4, x + cw, cy + cw * 0.5],
    active ? "#ffc94a" : "#9aa0ad");
  c.restore();
  if (!active) {
    // sleeping: floating z's
    c.fillStyle = "rgba(255,255,255,.85)";
    c.font = `800 ${Math.max(9, r * 0.32)}px system-ui, sans-serif`;
    for (let i = 0; i < 2; i++) {
      const k = (t * 0.6 + i * 0.5) % 1;
      c.globalAlpha = 1 - k;
      c.fillText("z", x + r * 0.5 + k * r * 0.3, ty - k * r * 0.8);
    }
    c.globalAlpha = 1;
  }
  c.restore();
}

export function drawRubble(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.save();
  ink(c, r * 0.4);
  ellipse(c, x, y + r * 0.35, r * 0.95, r * 0.38, "#6f6858", false);
  const stones = [[-0.5, 0.15, 0.3], [0.1, 0.0, 0.36], [0.55, 0.2, 0.26], [-0.15, 0.35, 0.24], [0.35, 0.42, 0.2]];
  for (const [dx, dy, s] of stones) ellipse(c, x + dx * r, y + dy * r, s * r, s * r * 0.75, "#b9b2a3");
  c.fillStyle = "#7a4a22";
  c.save();
  c.translate(x - r * 0.1, y - r * 0.05);
  c.rotate(-0.5);
  c.fillRect(-r * 0.4, -r * 0.06, r * 0.8, r * 0.12);
  c.restore();
  c.restore();
}

// ------------------------------------------------------------------ card art
const artCache = new Map<string, HTMLCanvasElement>();
const ART_R: Record<string, number> = {
  ironhide: 40, ranger: 38, swarmlings: 14, bulwark: 36, skywing: 26, brute: 30, sparkcaster: 33,
  cannon: 42, warden: 37, colossus: 40, skyrider: 31, bombardier: 37,
};
export function cardArt(card: string, team: Team = BLUE): HTMLCanvasElement {
  const key = card + team.main;
  const hit = artCache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 112;
  const c = cv.getContext("2d")!;
  const pose: Pose = { t: 0.3, id: 1, moving: false, face: 1, atk: 1, hp: 1, team };
  if (card === "ember") {
    drawFireball(c, 64, 52, 22, 1, 1.4, 0);
  } else if (card === "zap") {
    drawZapIcon(c, 56, 56);
  } else if (card === "wisps") {
    drawUnit(c, card, 30, 70, 13, { ...pose, id: 2 });
    drawUnit(c, card, 80, 74, 13, { ...pose, id: 5 });
    drawUnit(c, card, 55, 52, 15, pose);
  } else if (card === "twinrangers") {
    drawUnit(c, card, 36, 104, 30, { ...pose, id: 3 });
    drawUnit(c, card, 74, 110, 30, pose);
  } else if (card === "swarmlings") {
    drawUnit(c, card, 36, 98, 14, { ...pose, id: 2 });
    drawUnit(c, card, 78, 98, 14, { ...pose, id: 3, face: -1 });
    drawUnit(c, card, 57, 80, 15, pose);
  } else if (card === "skywing") {
    drawUnit(c, card, 52, 80, 28, { ...pose, t: 0.1 });
  } else {
    drawUnit(c, card, card === "cannon" ? 50 : 54, 108, ART_R[card] ?? 26, pose);
  }
  artCache.set(key, cv);
  return cv;
}

function drawZapIcon(c: CanvasRenderingContext2D, x: number, y: number) {
  c.save();
  c.shadowColor = "#7fe7ff";
  c.shadowBlur = 18;
  c.fillStyle = "#e9fbff";
  c.strokeStyle = "#3aa8d8";
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(x + 6, y - 40);
  c.lineTo(x - 16, y + 4);
  c.lineTo(x - 2, y + 4);
  c.lineTo(x - 10, y + 40);
  c.lineTo(x + 18, y - 8);
  c.lineTo(x + 4, y - 8);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
}
