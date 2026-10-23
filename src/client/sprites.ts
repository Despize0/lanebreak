// Procedural cartoon sprites. Everything is drawn with canvas paths: no image files.
// Coordinates are screen pixels. (x, y) is the point where the unit touches the ground;
// r is the unit's body radius in pixels.

export interface Team {
  main: string;
  dark: string;
  light: string;
}
export const BLUE: Team = { main: "#2f9bff", dark: "#1a5fc2", light: "#a8d8ff" };
export const RED: Team = { main: "#ff5b4f", dark: "#c22f27", light: "#ffbab3" };

export interface Pose {
  t: number; // seconds, for idle/walk cycles
  id: number; // de-syncs animation phases between units
  moving: boolean;
  face: 1 | -1; // 1 = facing right
  atk: number; // 0..1 progress of the current attack animation; 1 = idle
  hp: number; // 0..1
  team: Team;
}

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

// ------------------------------------------------------------------ units
export function drawUnit(c: CanvasRenderingContext2D, card: string, x: number, y: number, r: number, p: Pose) {
  c.save();
  ink(c, r);
  switch (card) {
    case "ironhide": golem(c, x, y, r, p); break;
    case "ranger": ranger(c, x, y, r, p); break;
    case "swarmlings": critter(c, x, y, r, p); break;
    case "bulwark": turret(c, x, y, r, p); break;
    case "skywing": wyvern(c, x, y, r, p); break;
    case "brute": brute(c, x, y, r, p); break;
    case "sparkcaster": mage(c, x, y, r, p); break;
    default: ellipse(c, x, y - r, r, r, p.team.main);
  }
  c.restore();
}

function golem(c: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pose) {
  const step = p.moving ? Math.sin(p.t * 5 + p.id) : 0;
  const bob = p.moving ? Math.abs(step) * r * 0.07 : Math.sin(p.t * 1.5 + p.id) * r * 0.02;
  const slam = p.atk < 1 ? Math.sin(Math.min(1, p.atk / 0.5) * Math.PI) : 0;
  const cy = y - r * 0.85 - bob;
  // arms (back)
  const armY = cy + r * 0.25 + step * r * 0.12 - slam * r * 0.5;
  ellipse(c, x - r * 0.95, armY, r * 0.36, r * 0.34, "#76727f");
  ellipse(c, x + r * 0.95, cy + r * 0.25 - step * r * 0.12 - slam * r * 0.5, r * 0.36, r * 0.34, "#76727f");
  // body
  ellipse(c, x, cy, r * 0.92, r * 0.86, "#8f8b99");
  ellipse(c, x - r * 0.18, cy - r * 0.28, r * 0.55, r * 0.38, "#a7a3b1", false);
  // moss
  ellipse(c, x - r * 0.15, cy - r * 0.72, r * 0.48, r * 0.17, "#6db04f", false);
  ellipse(c, x + r * 0.32, cy - r * 0.66, r * 0.22, r * 0.11, "#5d9d43", false);
  // chest rune
  c.save();
  c.shadowColor = p.team.main;
  c.shadowBlur = r * 0.6;
  ellipse(c, x, cy + r * 0.28, r * 0.19, r * 0.19, p.team.light, false);
  // glowing eyes
  for (const s of [-1, 1]) ellipse(c, x + s * r * 0.3 + p.face * r * 0.12, cy - r * 0.12, r * 0.13, r * 0.09, p.team.light, false);
  c.restore();
  // cracks show damage
  if (p.hp < 0.5) {
    c.beginPath();
    c.moveTo(x + r * 0.4, cy - r * 0.5);
    c.lineTo(x + r * 0.2, cy - r * 0.2);
    c.lineTo(x + r * 0.35, cy + r * 0.05);
    c.stroke();
  }
}

function ranger(c: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pose) {
  const walk = p.moving ? Math.sin(p.t * 9 + p.id) : 0;
  const bob = Math.abs(walk) * r * 0.1;
  // feet
  ellipse(c, x - r * 0.3, y - r * 0.12 + Math.max(0, walk) * -r * 0.15, r * 0.2, r * 0.13, "#3b2f2a");
  ellipse(c, x + r * 0.3, y - r * 0.12 + Math.max(0, -walk) * -r * 0.15, r * 0.2, r * 0.13, "#3b2f2a");
  const top = y - r * 1.9 - bob;
  // cloak
  c.beginPath();
  c.moveTo(x, top + r * 0.25);
  c.quadraticCurveTo(x + r * 0.85, y - r * 0.6, x + r * 0.7, y - r * 0.2 - bob);
  c.lineTo(x - r * 0.7, y - r * 0.2 - bob);
  c.quadraticCurveTo(x - r * 0.85, y - r * 0.6, x, top + r * 0.25);
  c.fillStyle = p.team.main;
  c.fill();
  c.stroke();
  // face + hood
  const hx = x + p.face * r * 0.06;
  const hy = top + r * 0.55;
  ellipse(c, hx, hy, r * 0.42, r * 0.42, p.team.dark);
  ellipse(c, hx + p.face * r * 0.05, hy + r * 0.06, r * 0.28, r * 0.28, SKIN, false);
  eyes(c, hx + p.face * r * 0.05, hy + r * 0.04, r * 0.1, p.face);
  // bow
  const pull = p.atk < 0.3 ? 1 - p.atk / 0.3 : 0;
  const bx = x + p.face * r * 0.72;
  const by = y - r * 0.95 - bob;
  c.save();
  c.strokeStyle = "#7a4a22";
  c.lineWidth = Math.max(1.2, r * 0.12);
  c.beginPath();
  c.arc(bx - p.face * r * 0.35, by, r * 0.6, p.face > 0 ? -1.1 : Math.PI - 1.1, p.face > 0 ? 1.1 : Math.PI + 1.1);
  c.stroke();
  c.strokeStyle = "#f4ead2";
  c.lineWidth = Math.max(0.8, r * 0.04);
  const sx = bx - p.face * r * 0.35 + Math.cos(1.1) * r * 0.6 * p.face;
  c.beginPath();
  c.moveTo(sx, by - Math.sin(1.1) * r * 0.6);
  c.lineTo(sx - p.face * pull * r * 0.35, by);
  c.lineTo(sx, by + Math.sin(1.1) * r * 0.6);
  c.stroke();
  c.restore();
}

function critter(c: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pose) {
  const hop = p.moving ? Math.abs(Math.sin(p.t * 13 + p.id * 1.7)) * r * 0.55 : Math.abs(Math.sin(p.t * 3 + p.id)) * r * 0.08;
  const bite = p.atk < 1 ? Math.sin(Math.min(1, p.atk / 0.4) * Math.PI) * r * 0.25 : 0;
  const cx = x + p.face * bite;
  const cy = y - r * 0.95 - hop;
  // ears
  poly(c, [cx - r * 0.7, cy - r * 0.4, cx - r * 0.35, cy - r * 1.25, cx - r * 0.05, cy - r * 0.55], p.team.dark);
  poly(c, [cx + r * 0.7, cy - r * 0.4, cx + r * 0.35, cy - r * 1.25, cx + r * 0.05, cy - r * 0.55], p.team.dark);
  ellipse(c, cx, cy, r, r * 0.92, p.team.main);
  ellipse(c, cx, cy + r * 0.32, r * 0.6, r * 0.45, p.team.light, false);
  eyes(c, cx, cy - r * 0.15, r * 0.24, p.face);
}

function turret(c: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pose) {
  const by = y - r * 0.15;
  // body
  c.beginPath();
  c.moveTo(x - r * 0.85, by);
  c.lineTo(x - r * 0.72, by - r * 0.85);
  c.lineTo(x + r * 0.72, by - r * 0.85);
  c.lineTo(x + r * 0.85, by);
  c.closePath();
  c.fillStyle = "#a69f92";
  c.fill();
  c.stroke();
  ellipse(c, x, by, r * 0.85, r * 0.28, "#8d877b");
  ellipse(c, x, by - r * 0.85, r * 0.72, r * 0.24, "#c4bdaf");
  // bricks
  c.save();
  c.strokeStyle = "rgba(29,23,51,.35)";
  c.lineWidth = Math.max(1, r * 0.04);
  for (let i = 1; i < 3; i++) {
    const yy = by - r * 0.28 * i;
    c.beginPath();
    c.moveTo(x - r * 0.8, yy);
    c.lineTo(x + r * 0.8, yy);
    c.stroke();
  }
  c.restore();
  // crystal
  const pulse = 0.8 + Math.sin(p.t * 4 + p.id) * 0.2;
  const ky = by - r * 1.25 - Math.sin(p.t * 2 + p.id) * r * 0.06;
  c.save();
  c.shadowColor = p.team.main;
  c.shadowBlur = r * 0.8 * pulse;
  poly(c, [x, ky - r * 0.6, x + r * 0.32, ky, x, ky + r * 0.38, x - r * 0.32, ky], p.team.main);
  poly(c, [x, ky - r * 0.6, x + r * 0.12, ky - r * 0.05, x, ky + r * 0.38], p.team.light, false);
  c.restore();
  if (p.hp < 0.55) {
    c.beginPath();
    c.moveTo(x - r * 0.4, by - r * 0.8);
    c.lineTo(x - r * 0.25, by - r * 0.45);
    c.lineTo(x - r * 0.45, by - r * 0.2);
    c.stroke();
  }
}

function wyvern(c: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pose) {
  const flap = Math.sin(p.t * 13 + p.id);
  const cy = y - r * 0.6;
  const f = p.face;
  // tail
  poly(c, [x - f * r * 0.55, cy, x - f * r * 1.35, cy - r * 0.35, x - f * r * 1.15, cy + r * 0.1], p.team.dark);
  // far wing
  poly(c, [x - r * 0.1, cy - r * 0.15, x - f * r * 0.2, cy - r * 0.9 - flap * r * 0.55, x + f * r * 0.55, cy - r * 0.2], p.team.dark);
  // body
  ellipse(c, x, cy, r * 0.78, r * 0.5, p.team.main);
  ellipse(c, x + f * r * 0.05, cy + r * 0.18, r * 0.5, r * 0.25, p.team.light, false);
  // head
  const hx = x + f * r * 0.75;
  const hy = cy - r * 0.3;
  poly(c, [hx + f * r * 0.25, hy - r * 0.05, hx + f * r * 0.65, hy + r * 0.08, hx + f * r * 0.22, hy + r * 0.22], "#ffb43a");
  ellipse(c, hx, hy, r * 0.36, r * 0.32, p.team.main);
  ellipse(c, hx + f * r * 0.1, hy - r * 0.06, r * 0.1, r * 0.12, "#fff", false);
  ellipse(c, hx + f * r * 0.13, hy - r * 0.04, r * 0.05, r * 0.07, INK, false);
  // near wing
  poly(c, [x + r * 0.1, cy - r * 0.1, x + f * r * 0.1 - r * 0.2 * f, cy - r * 1.1 - flap * r * 0.7, x - f * r * 0.7, cy - r * 0.15], p.team.main);
}

function brute(c: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pose) {
  const walk = p.moving ? Math.sin(p.t * 7 + p.id) : 0;
  const bob = Math.abs(walk) * r * 0.08;
  const f = p.face;
  // legs
  ellipse(c, x - r * 0.38, y - r * 0.15 - Math.max(0, walk) * r * 0.15, r * 0.26, r * 0.18, "#4a3426");
  ellipse(c, x + r * 0.38, y - r * 0.15 - Math.max(0, -walk) * r * 0.15, r * 0.26, r * 0.18, "#4a3426");
  const cy = y - r * 0.95 - bob;
  // club (behind when idle, swings forward when attacking)
  const swing = p.atk < 1 ? -1.9 + Math.min(1, p.atk / 0.35) * 2.6 : 0.55;
  const hx = x + f * r * 0.85;
  const hy = cy + r * 0.05;
  c.save();
  c.translate(hx, hy);
  c.scale(f, 1);
  c.rotate(swing);
  c.beginPath();
  c.moveTo(-r * 0.08, 0);
  c.lineTo(-r * 0.2, -r * 1.15);
  c.quadraticCurveTo(0, -r * 1.42, r * 0.2, -r * 1.15);
  c.lineTo(r * 0.08, 0);
  c.closePath();
  c.fillStyle = "#8b5a2b";
  c.fill();
  c.stroke();
  c.restore();
  // body
  ellipse(c, x, cy, r * 0.88, r * 0.8, "#c98f5f");
  ellipse(c, x + f * r * 0.1, cy + r * 0.22, r * 0.5, r * 0.4, "#e0ad80", false);
  // belt + pads
  c.fillStyle = p.team.dark;
  c.fillRect(x - r * 0.8, cy + r * 0.32, r * 1.6, r * 0.18);
  ellipse(c, x - r * 0.72, cy - r * 0.42, r * 0.34, r * 0.28, p.team.main);
  ellipse(c, x + r * 0.72, cy - r * 0.42, r * 0.34, r * 0.28, p.team.main);
  // head + horns
  const hdx = x + f * r * 0.12;
  const hdy = cy - r * 0.78;
  poly(c, [hdx - r * 0.28, hdy - r * 0.1, hdx - r * 0.55, hdy - r * 0.6, hdx - r * 0.12, hdy - r * 0.3], "#f4ead2");
  poly(c, [hdx + r * 0.28, hdy - r * 0.1, hdx + r * 0.55, hdy - r * 0.6, hdx + r * 0.12, hdy - r * 0.3], "#f4ead2");
  ellipse(c, hdx, hdy, r * 0.36, r * 0.32, "#c98f5f");
  // angry brows + eyes
  for (const s of [-1, 1]) {
    ellipse(c, hdx + s * r * 0.13 + f * r * 0.06, hdy, r * 0.06, r * 0.07, INK, false);
    c.beginPath();
    c.moveTo(hdx + s * r * 0.24 + f * r * 0.06, hdy - r * 0.16);
    c.lineTo(hdx + s * r * 0.04 + f * r * 0.06, hdy - r * 0.08);
    c.stroke();
  }
}

function mage(c: CanvasRenderingContext2D, x: number, y: number, r: number, p: Pose) {
  const walk = p.moving ? Math.sin(p.t * 8 + p.id) : 0;
  const bob = Math.abs(walk) * r * 0.08;
  const f = p.face;
  const base = y - r * 0.1 - bob;
  // robe
  poly(c, [x - r * 0.35, base - r * 1.2, x + r * 0.35, base - r * 1.2, x + r * 0.8, base, x - r * 0.8, base], p.team.main);
  c.fillStyle = "#ffd36b";
  c.fillRect(x - r * 0.75, base - r * 0.16, r * 1.5, r * 0.14);
  // face + beard
  const hy = base - r * 1.38;
  ellipse(c, x + f * r * 0.05, hy, r * 0.33, r * 0.33, SKIN);
  poly(c, [x - r * 0.25 + f * r * 0.05, hy + r * 0.1, x + r * 0.25 + f * r * 0.05, hy + r * 0.1, x + f * r * 0.12, hy + r * 0.62], "#f3f0ea");
  eyes(c, x + f * r * 0.06, hy - r * 0.03, r * 0.08, f);
  // hat
  const tip = Math.sin(p.t * 3 + p.id) * r * 0.08;
  poly(c, [x - r * 0.52, hy - r * 0.2, x + r * 0.52, hy - r * 0.2, x - f * r * 0.3 + tip, hy - r * 1.15], p.team.dark);
  ellipse(c, x, hy - r * 0.2, r * 0.6, r * 0.12, p.team.dark);
  // orb with crackle
  const ox = x + f * r * 0.85;
  const oy = base - r * 1.15 + Math.sin(p.t * 3.3 + p.id) * r * 0.1;
  const charge = p.atk < 0.3 ? 1.6 : 1;
  c.save();
  c.shadowColor = "#7fe7ff";
  c.shadowBlur = r * 0.9 * charge;
  ellipse(c, ox, oy, r * 0.24 * charge, r * 0.24 * charge, "#dff9ff", false);
  c.restore();
  c.save();
  c.strokeStyle = "rgba(160,240,255,.9)";
  c.lineWidth = Math.max(1, r * 0.05);
  const k = Math.floor(p.t * 12 + p.id);
  for (let i = 0; i < 2; i++) {
    const a = ((k * 7 + i * 13) % 10) * 0.63;
    c.beginPath();
    c.moveTo(ox, oy);
    c.lineTo(ox + Math.cos(a) * r * 0.35, oy + Math.sin(a) * r * 0.35);
    c.lineTo(ox + Math.cos(a + 0.5) * r * 0.5, oy + Math.sin(a + 0.5) * r * 0.5);
    c.stroke();
  }
  c.restore();
}

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
  ironhide: 34, ranger: 26, swarmlings: 14, bulwark: 30, skywing: 26, brute: 30, sparkcaster: 27,
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
  } else if (card === "swarmlings") {
    drawUnit(c, card, 36, 98, 14, { ...pose, id: 2 });
    drawUnit(c, card, 78, 98, 14, { ...pose, id: 3, face: -1 });
    drawUnit(c, card, 57, 80, 15, pose);
  } else if (card === "skywing") {
    drawUnit(c, card, 52, 80, 28, { ...pose, t: 0.1 });
  } else {
    drawUnit(c, card, 56, 104, ART_R[card] ?? 26, pose);
  }
  artCache.set(key, cv);
  return cv;
}
