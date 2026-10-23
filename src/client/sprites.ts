// Procedural cartoon sprites. Everything is drawn with canvas paths: no image files.
// Coordinates are screen pixels. (x, y) is the point where the unit touches the ground;
// r is the unit's body radius in pixels.

import { BLUE, RED, type Pose, type Team } from "./paint";
import { drawUnit } from "./characters";
import { shade as shadeHex } from "./paint";
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
export function drawFireball(c: CanvasRenderingContext2D, x: number, y: number, r: number, dx: number, dy: number, t: number, rock = false) {
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
  if (rock) {
    // a burning boulder at the core, like the Ember Burst card
    c.save();
    c.translate(x, y);
    c.rotate(t * 3);
    c.fillStyle = "#4a3428";
    c.strokeStyle = "#ffb04a";
    c.lineWidth = Math.max(1, r * 0.08);
    c.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const rr = r * (0.48 + ((k * 37) % 5) * 0.035);
      if (k) c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }
}

// ------------------------------------------------------------------ towers
// Stone castle towers in the style of the card art: shaded masonry, team-colored roofs and banners.
const STONE = "#c9bfae";
const STONE_DARK = "#8e846f";
const GOLD = "#e7b63c";

function cylinder(c: CanvasRenderingContext2D, x: number, top: number, bottom: number, w: number, base: string) {
  const g = c.createLinearGradient(x - w, 0, x + w, 0);
  g.addColorStop(0, shadeHex(base, 0.18));
  g.addColorStop(0.35, base);
  g.addColorStop(1, shadeHex(base, -0.42));
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x - w, top);
  c.lineTo(x - w, bottom);
  c.ellipse(x, bottom, w, w * 0.3, 0, Math.PI, 0, true);
  c.lineTo(x + w, top);
  c.closePath();
  c.fill();
  c.stroke();
}

function masonry(c: CanvasRenderingContext2D, x: number, top: number, bottom: number, w: number, course: number) {
  c.save();
  c.beginPath();
  c.rect(x - w, top, w * 2, bottom - top);
  c.clip();
  c.strokeStyle = "rgba(60,48,34,.32)";
  c.lineWidth = Math.max(0.6, course * 0.08);
  let row = 0;
  for (let y = bottom - course; y > top; y -= course, row++) {
    c.beginPath();
    c.ellipse(x, y, w, w * 0.3, 0, 0, Math.PI);
    c.stroke();
    for (let k = -2; k <= 2; k++) {
      const jx = x + (k + (row % 2 ? 0.5 : 0)) * w * 0.42;
      if (Math.abs(jx - x) > w * 0.92) continue;
      const curve = Math.sqrt(Math.max(0, 1 - ((jx - x) / w) ** 2)) * w * 0.3;
      c.beginPath();
      c.moveTo(jx, y + curve);
      c.lineTo(jx, y + curve - course);
      c.stroke();
    }
  }
  c.restore();
}

function cone(c: CanvasRenderingContext2D, x: number, base: number, w: number, h: number, team: Team) {
  const g = c.createLinearGradient(x - w, 0, x + w, 0);
  g.addColorStop(0, shadeHex(team.main, 0.3));
  g.addColorStop(0.45, team.main);
  g.addColorStop(1, shadeHex(team.dark, -0.3));
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x - w, base);
  c.quadraticCurveTo(x - w * 0.3, base - h * 0.45, x, base - h);
  c.quadraticCurveTo(x + w * 0.3, base - h * 0.45, x + w, base);
  c.ellipse(x, base, w, w * 0.28, 0, 0, Math.PI);
  c.closePath();
  c.fill();
  c.stroke();
  // roof tile rows
  c.save();
  c.clip();
  c.strokeStyle = "rgba(0,0,0,.22)";
  c.lineWidth = Math.max(0.6, w * 0.04);
  for (let k = 1; k < 4; k++) {
    const yy = base - (h * k) / 4.2;
    const ww = w * (1 - k / 4.4);
    c.beginPath();
    c.ellipse(x, yy, ww, ww * 0.28, 0, 0, Math.PI);
    c.stroke();
  }
  c.restore();
  ellipseFill(c, x, base - h, w * 0.1, w * 0.1, GOLD);
}

function flag(c: CanvasRenderingContext2D, x: number, y: number, len: number, team: Team, t: number) {
  c.strokeStyle = "#4a3a2a";
  c.lineWidth = Math.max(1, len * 0.06);
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x, y - len);
  c.stroke();
  const wave = Math.sin(t * 5 + x * 0.05) * len * 0.08;
  c.fillStyle = team.main;
  c.beginPath();
  c.moveTo(x, y - len);
  c.quadraticCurveTo(x + len * 0.35, y - len - wave, x + len * 0.75, y - len * 0.86 + wave);
  c.lineTo(x, y - len * 0.62);
  c.closePath();
  c.fill();
  c.stroke();
}

function banner(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, team: Team) {
  c.fillStyle = team.main;
  c.beginPath();
  c.moveTo(x - w / 2, y);
  c.lineTo(x + w / 2, y);
  c.lineTo(x + w / 2, y + h);
  c.lineTo(x, y + h * 0.8);
  c.lineTo(x - w / 2, y + h);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = GOLD;
  c.fillRect(x - w / 2, y, w, h * 0.12);
  // little crown emblem
  const cw = w * 0.32;
  const cy = y + h * 0.45;
  c.beginPath();
  c.moveTo(x - cw, cy + cw * 0.45);
  c.lineTo(x - cw, cy - cw * 0.35);
  c.lineTo(x - cw * 0.45, cy);
  c.lineTo(x, cy - cw * 0.6);
  c.lineTo(x + cw * 0.45, cy);
  c.lineTo(x + cw, cy - cw * 0.35);
  c.lineTo(x + cw, cy + cw * 0.45);
  c.closePath();
  c.fill();
}

function ellipseFill(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  c.stroke();
}

function battlements(c: CanvasRenderingContext2D, x: number, y: number, w: number) {
  ellipseFill(c, x, y, w, w * 0.3, shadeHex(STONE, -0.05));
  ellipseFill(c, x, y - w * 0.02, w * 0.78, w * 0.22, shadeHex(STONE_DARK, -0.25));
  // merlons along the front rim
  for (let k = -2; k <= 2; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 6.2;
    const mx = x + Math.cos(a) * w * 0.9;
    const my = y + Math.sin(a) * w * 0.27;
    const mw = w * 0.2;
    const g = c.createLinearGradient(mx - mw, 0, mx + mw, 0);
    g.addColorStop(0, shadeHex(STONE, 0.15));
    g.addColorStop(1, shadeHex(STONE, -0.3));
    c.fillStyle = g;
    c.fillRect(mx - mw / 2, my - w * 0.32, mw, w * 0.32);
    c.strokeRect(mx - mw / 2, my - w * 0.32, mw, w * 0.32);
  }
}

/** Side tower: round stone tower with battlements, a team-colored roof and flag. */
export function drawLighthouse(c: CanvasRenderingContext2D, x: number, y: number, r: number, team: Team, active: boolean, t: number) {
  c.save();
  c.strokeStyle = "#2a2230";
  c.lineWidth = Math.max(1, r * 0.035);
  c.lineJoin = "round";
  const base = y + r * 0.38;
  ellipseFill(c, x, base, r * 0.98, r * 0.36, STONE_DARK); // plinth
  const w = r * 0.68;
  const top = y - r * 0.9;
  cylinder(c, x, top, base - r * 0.08, w, STONE);
  masonry(c, x, top, base - r * 0.08, w, r * 0.24);
  // arched window with a warm light
  c.fillStyle = "#2b2230";
  c.beginPath();
  c.arc(x - w * 0.15, y - r * 0.25, r * 0.13, Math.PI, 0);
  c.lineTo(x - w * 0.15 + r * 0.13, y - r * 0.02);
  c.lineTo(x - w * 0.15 - r * 0.13, y - r * 0.02);
  c.closePath();
  c.fill();
  if (active) {
    c.save();
    c.globalAlpha = 0.75 + Math.sin(t * 3 + x) * 0.1;
    c.fillStyle = "#ffcf6a";
    c.fillRect(x - w * 0.15 - r * 0.08, y - r * 0.28, r * 0.16, r * 0.24);
    c.restore();
  }
  banner(c, x + w * 0.3, y - r * 0.05, r * 0.36, r * 0.55, team);
  battlements(c, x, top, w * 1.12);
  cone(c, x, top - r * 0.22, w * 0.98, r * 1.1, team);
  flag(c, x, top - r * 1.32, r * 0.55, team, t);
  c.restore();
}

/** King's keep: a fortress block with two round turrets and a gold crown that lights up when awake. */
export function drawKeep(c: CanvasRenderingContext2D, x: number, y: number, r: number, team: Team, active: boolean, t: number) {
  c.save();
  c.strokeStyle = "#2a2230";
  c.lineWidth = Math.max(1, r * 0.03);
  c.lineJoin = "round";
  const base = y + r * 0.4;
  ellipseFill(c, x, base, r * 1.05, r * 0.4, STONE_DARK);
  // main block
  const w = r * 0.72;
  const top = y - r * 0.55;
  const g = c.createLinearGradient(x - w, 0, x + w, 0);
  g.addColorStop(0, shadeHex(STONE, 0.12));
  g.addColorStop(0.5, STONE);
  g.addColorStop(1, shadeHex(STONE, -0.35));
  c.fillStyle = g;
  c.fillRect(x - w, top, w * 2, base - top - r * 0.08);
  c.strokeRect(x - w, top, w * 2, base - top - r * 0.08);
  c.save();
  c.beginPath();
  c.rect(x - w, top, w * 2, base - top);
  c.clip();
  c.strokeStyle = "rgba(60,48,34,.3)";
  c.lineWidth = Math.max(0.6, r * 0.02);
  for (let yy = top + r * 0.2, row = 0; yy < base; yy += r * 0.2, row++) {
    c.beginPath();
    c.moveTo(x - w, yy);
    c.lineTo(x + w, yy);
    c.stroke();
    for (let xx = x - w + (row % 2 ? r * 0.15 : 0); xx < x + w; xx += r * 0.3) {
      c.beginPath();
      c.moveTo(xx, yy);
      c.lineTo(xx, yy - r * 0.2);
      c.stroke();
    }
  }
  c.restore();
  // crenellations
  for (let k = 0; k < 5; k++) {
    const cx = x - w + (k * (w * 2 - r * 0.2)) / 4;
    c.fillStyle = shadeHex(STONE, k > 2 ? -0.15 : 0.05);
    c.fillRect(cx, top - r * 0.18, r * 0.2, r * 0.18);
    c.strokeRect(cx, top - r * 0.18, r * 0.2, r * 0.18);
  }
  // gate with portcullis
  c.fillStyle = "#3a2a1c";
  c.beginPath();
  c.arc(x, base - r * 0.42, r * 0.24, Math.PI, 0);
  c.lineTo(x + r * 0.24, base - r * 0.08);
  c.lineTo(x - r * 0.24, base - r * 0.08);
  c.closePath();
  c.fill();
  c.stroke();
  c.strokeStyle = "rgba(200,190,170,.5)";
  c.lineWidth = Math.max(0.6, r * 0.025);
  for (let k = -1; k <= 1; k++) {
    c.beginPath();
    c.moveTo(x + k * r * 0.1, base - r * 0.6);
    c.lineTo(x + k * r * 0.1, base - r * 0.1);
    c.stroke();
  }
  c.strokeStyle = "#2a2230";
  c.lineWidth = Math.max(1, r * 0.03);
  banner(c, x - w * 0.55, top + r * 0.1, r * 0.3, r * 0.5, team);
  banner(c, x + w * 0.55, top + r * 0.1, r * 0.3, r * 0.5, team);
  // corner turrets
  for (const s of [-1, 1]) {
    const tx = x + s * w;
    const tt = top - r * 0.35;
    cylinder(c, tx, tt, base - r * 0.12, r * 0.3, STONE);
    battlements(c, tx, tt, r * 0.36);
    cone(c, tx, tt - r * 0.1, r * 0.34, r * 0.62, team);
    flag(c, tx, tt - r * 0.72, r * 0.36, team, t + s);
  }
  // crown on top
  const cy = top - r * 0.38;
  const cw = r * 0.3;
  c.save();
  if (active) {
    c.shadowColor = "#ffd34a";
    c.shadowBlur = r * 0.5;
  }
  c.fillStyle = active ? GOLD : "#9aa0ad";
  c.beginPath();
  c.moveTo(x - cw, cy + cw * 0.5);
  c.lineTo(x - cw, cy - cw * 0.4);
  c.lineTo(x - cw * 0.5, cy);
  c.lineTo(x, cy - cw * 0.75);
  c.lineTo(x + cw * 0.5, cy);
  c.lineTo(x + cw, cy - cw * 0.4);
  c.lineTo(x + cw, cy + cw * 0.5);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
  if (active) {
    c.fillStyle = team.light;
    c.beginPath();
    c.arc(x, cy + cw * 0.1, cw * 0.18, 0, Math.PI * 2);
    c.fill();
  } else {
    c.fillStyle = "rgba(255,255,255,.85)";
    c.font = `800 ${Math.max(9, r * 0.3)}px system-ui, sans-serif`;
    for (let i = 0; i < 2; i++) {
      const k = (t * 0.6 + i * 0.5) % 1;
      c.globalAlpha = 1 - k;
      c.fillText("z", x + r * 0.45 + k * r * 0.3, cy - r * 0.2 - k * r * 0.7);
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
