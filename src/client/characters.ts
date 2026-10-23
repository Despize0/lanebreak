// Unit art: shaded, rigged characters drawn in code (no image files).
// (x, y) is where the unit touches the ground; r is its size in pixels.
// Humanoids share one rig (legs, torso, arms, head) with walk and per-weapon attack animation.

import { blob, glow, limb, shade, slab, type Ctx, type Pose } from "./paint";

export function drawUnit(c: Ctx, card: string, x: number, y: number, r: number, p: Pose) {
  c.save();
  c.translate(x, y);
  if (p.face < 0) c.scale(-1, 1); // everything below is drawn facing right
  c.lineJoin = "round";
  c.lineCap = "round";
  switch (card) {
    case "ranger": humanoid(c, r, p, RANGER(p)); break;
    case "twinrangers": humanoid(c, r, p, TWIN(p)); break;
    case "warden": humanoid(c, r, p, WARDEN(p)); break;
    case "brute": humanoid(c, r, p, BRUTE(p)); break;
    case "sparkcaster": humanoid(c, r, p, MAGE(p)); break;
    case "bombardier": humanoid(c, r, p, BOMBER(p)); break;
    case "skyrider": humanoid(c, r, p, RIDER(p)); break;
    case "ironhide": golem(c, r, p, false); break;
    case "colossus": golem(c, r, p, true); break;
    case "swarmlings": imp(c, r, p); break;
    case "skywing": wyvern(c, r, p); break;
    case "wisps": wisp(c, r, p); break;
    case "bulwark": crystalTurret(c, r, p); break;
    case "cannon": cannon(c, r, p); break;
    default: blob(c, 0, -r, r, r, p.team.main, 1);
  }
  c.restore();
}

// ------------------------------------------------------------------ humanoid rig
type Head = "hood" | "helm" | "wizard" | "horns" | "goggles" | "ponytail" | "aviator";
type Weapon = "bow" | "sword" | "club" | "staff" | "bomb" | "lance";
interface Look {
  skin: string;
  tunic: string;
  pants: string;
  boots: string;
  build?: number; // shoulder width multiplier
  tall?: number; // height multiplier
  head: Head;
  headColor: string;
  hair?: string;
  cape?: string;
  armor?: string;
  beard?: string;
  belt?: string;
  weapon: Weapon;
  shield?: string;
  robe?: boolean;
  hover?: boolean; // rides a hover-disc instead of walking
  scarf?: string;
  noStaff?: boolean; // casts from bare hands
}

const STEEL = "#b8c0cc";
const WOOD = "#8a5a2e";
const LEATHER = "#7b5536";

// Designs follow the painted card art; each one keeps its team color on clothing or gear.
const RANGER = (p: Pose): Look => ({
  skin: "#e9b58f", tunic: p.team.main, pants: "#4b5a3a", boots: "#4a3020", head: "hood", headColor: "#3f8f3a",
  cape: "#2f6e2c", belt: "#5a3a1e", weapon: "bow",
});
const TWIN = (p: Pose): Look => {
  const hood = p.id % 2 ? "#c2408c" : "#3a6fd0"; // one pink, one blue hood, like the card
  return {
    skin: "#f0c29d", tunic: p.team.main, pants: "#3f4656", boots: "#4a3020", head: "hood", headColor: hood,
    cape: shade(hood, -0.25), belt: "#5a3a1e", weapon: "bow", tall: 0.95,
  };
};
const WARDEN = (p: Pose): Look => ({
  skin: "#e2ab85", tunic: p.team.main, pants: "#6d7380", boots: "#3a3a44", head: "helm", headColor: p.team.main,
  armor: STEEL, belt: "#4a3020", weapon: "sword", shield: p.team.main, build: 1.1,
});
const BRUTE = (p: Pose): Look => ({
  skin: "#e2a07a", tunic: "#7a5434", pants: "#5a4030", boots: "#3e2a1c", head: "horns", headColor: "#e9dcc0",
  beard: "#a4532a", belt: p.team.dark, armor: p.team.main, weapon: "club", build: 1.55, tall: 1.05,
});
const MAGE = (p: Pose): Look => ({
  skin: "#efc6a0", tunic: p.team.main, pants: p.team.dark, boots: "#3a2a20", head: "hood", headColor: shade(p.team.dark, -0.25),
  beard: "#3a2a22", belt: "#ffcf5a", weapon: "staff", robe: true, noStaff: true,
});
const BOMBER = (p: Pose): Look => ({
  skin: "#e0a77f", tunic: "#6e5440", pants: "#4a4a52", boots: "#3a2a20", head: "goggles", headColor: "#c8402e",
  hair: "#c8402e", belt: "#2a2018", scarf: p.team.main, weapon: "bomb", build: 1.1,
});
const RIDER = (p: Pose): Look => ({
  skin: "#e7b48e", tunic: p.team.main, pants: "#3f4656", boots: "#3a2a20", head: "aviator", headColor: "#d9822b",
  scarf: p.team.light, belt: "#3a2616", weapon: "lance", hover: true, armor: STEEL,
});

function humanoid(c: Ctx, r: number, p: Pose, L: Look) {
  const tall = L.tall ?? 1;
  const build = L.build ?? 1;
  const u = r * 0.25 * tall; // rig unit; total height ≈ 10u
  const ol = Math.max(0.7, r * 0.045);
  const w = p.moving && !L.hover ? p.t * 9 + p.id : 0;
  const swing = p.moving && !L.hover ? Math.sin(w) * 0.55 : 0;
  const bob = L.hover
    ? -u * 0.6 - Math.sin(p.t * 3 + p.id) * u * 0.2
    : p.moving ? -Math.abs(Math.cos(w)) * u * 0.25 : Math.sin(p.t * 2 + p.id) * u * 0.05;
  const hipY = -4.3 * u + bob;
  const shY = -7.4 * u + bob;
  const headY = -8.75 * u + bob;
  const atk = p.atk;

  // hover-disc under the rider
  if (L.hover) {
    glow(c, 0, -u * 0.2, u * 3.2, p.team.main, 0.45);
    blob(c, 0, -u * 0.35, u * 2.4, u * 0.55, "#4a5266", ol);
    c.fillStyle = shade(p.team.light, 0.2);
    c.beginPath();
    c.ellipse(0, -u * 0.45, u * 1.7, u * 0.25, 0, 0, Math.PI * 2);
    c.fill();
  }

  // cape (behind everything)
  if (L.cape) {
    const flap = Math.sin(p.t * 6 + p.id) * u * 0.3 + (p.moving ? u * 0.6 : 0);
    slab(c, [-u * 0.9, shY + u * 0.2, u * 0.4, shY + u * 0.1, -u * 0.6, hipY + u * 1.6, -u * 2.0 - flap, hipY + u * 1.2], L.cape, ol);
  }

  // arm angles (direction = (sin a, cos a): 0 = down, PI/2 = forward, PI = up)
  let backA = 0.15 + swing * 0.8;
  let frontA = 0.15 - swing * 0.8;
  let backBend = 0.5;
  let frontBend = 0.5;
  const swingK = atk < 0.35 ? atk / 0.35 : 1; // 0..1 through the strike
  switch (L.weapon) {
    case "bow":
      if (atk < 1) {
        frontA = 1.45;
        frontBend = 0.05;
        backA = 1.25;
        backBend = 1.9 - (atk < 0.25 ? 0 : 0.6); // drawing hand near the chest, released after the shot
      }
      break;
    case "sword":
      frontA = 0.95;
      frontBend = 0.9;
      backA = atk < 1 ? Math.PI - 0.4 - swingK * 2.0 : 0.35 + swing * 0.5;
      backBend = 0.25;
      break;
    case "club":
      frontA = atk < 1 ? Math.PI - 0.3 - swingK * 1.9 : 0.5 + swing * 0.4;
      frontBend = 0.25;
      break;
    case "staff":
      frontA = atk < 0.5 ? 2.4 : 0.85;
      frontBend = atk < 0.5 ? 0.1 : 0.7;
      break;
    case "bomb":
      frontA = atk < 0.45 ? -0.9 + (atk / 0.45) * 3.6 : 0.5 + swing * 0.5;
      frontBend = atk < 0.45 ? 0.2 : 0.9;
      break;
    case "lance":
      frontA = 1.25;
      frontBend = 0.6;
      backA = 1.0;
      backBend = 1.1;
      break;
  }

  const shBack = { x: -0.55 * u * build, y: shY + u * 0.45 };
  const shFront = { x: 0.6 * u * build, y: shY + u * 0.45 };
  const armW = u * (L.weapon === "club" ? 1.05 : 0.72) * Math.sqrt(build);
  const arm = (s: { x: number; y: number }, a: number, bend: number) => {
    const e = { x: s.x + Math.sin(a) * 1.7 * u, y: s.y + Math.cos(a) * 1.7 * u };
    const h = { x: e.x + Math.sin(a + bend) * 1.6 * u, y: e.y + Math.cos(a + bend) * 1.6 * u };
    return { e, h };
  };
  const back = arm(shBack, backA, backBend);
  const front = arm(shFront, frontA, frontBend);
  const sleeve = L.weapon === "club" ? L.skin : L.tunic;
  const drawArm = (s: { x: number; y: number }, a: { e: { x: number; y: number }; h: { x: number; y: number } }) => {
    limb(c, s.x, s.y, a.e.x, a.e.y, armW, sleeve, ol);
    limb(c, a.e.x, a.e.y, a.h.x, a.h.y, armW * 0.9, L.weapon === "club" ? L.skin : shade(sleeve, -0.08), ol);
    blob(c, a.h.x, a.h.y, armW * 0.55, armW * 0.55, L.skin, ol * 0.8);
  };

  // legs
  const leg = (hx: number, s: number, dark: number) => {
    const knee = { x: hx + Math.sin(s) * 2.2 * u, y: hipY + Math.cos(s) * 2.2 * u };
    const footA = s * 0.45 + (L.hover ? 0.5 : 0);
    const foot = { x: knee.x + Math.sin(footA) * 2.1 * u, y: knee.y + Math.cos(footA) * 2.1 * u * (L.hover ? 0.75 : 1) };
    const col = shade(L.pants, dark);
    limb(c, hx, hipY, knee.x, knee.y, u * 0.88 * Math.sqrt(build), col, ol);
    limb(c, knee.x, knee.y, foot.x, foot.y, u * 0.76 * Math.sqrt(build), col, ol);
    blob(c, foot.x + u * 0.3, foot.y - u * 0.15, u * 0.6, u * 0.32, shade(L.boots, dark), ol);
  };

  // back arm + weapon parts that sit behind the body
  if (L.weapon !== "sword") drawArm(shBack, back);
  if (L.weapon === "sword") {
    drawArm(shBack, back);
    sword(c, back.h.x, back.h.y, backA + backBend, u, ol);
  }
  if (!L.robe) {
    leg(-0.35 * u * build, -swing, -0.15);
    leg(0.35 * u * build, swing, 0);
  }

  // torso
  const sw = 1.3 * u * build;
  const hw = 1.05 * u * build;
  if (L.robe) {
    slab(c, [-sw * 0.8, shY, sw * 0.8, shY, sw * 1.35, -u * 0.1, -sw * 1.35, -u * 0.1], L.tunic, ol);
    c.fillStyle = shade(L.belt ?? "#ffcf5a", 0);
    c.fillRect(-sw * 1.3, -u * 0.55, sw * 2.6, u * 0.35);
    blob(c, u * 0.6, -u * 0.05, u * 0.55, u * 0.25, L.boots, ol);
  } else if (L.weapon === "club") {
    blob(c, 0, (shY + hipY) / 2 + u * 0.2, sw * 1.05, (hipY - shY) * 0.68, L.skin, ol);
    blob(c, u * 0.35, (shY + hipY) / 2 + u * 0.7, sw * 0.6, (hipY - shY) * 0.38, shade(L.skin, 0.12), 0);
  } else {
    slab(c, [-sw, shY, sw, shY, hw, hipY + u * 0.35, -hw, hipY + u * 0.35], L.tunic, ol);
  }
  if (L.armor && L.weapon === "sword") {
    // breastplate + tabard
    slab(c, [-sw * 0.92, shY + u * 0.1, sw * 0.92, shY + u * 0.1, hw * 0.9, hipY - u * 0.4, -hw * 0.9, hipY - u * 0.4], L.armor, ol);
    slab(c, [-hw * 0.45, shY + u * 1.0, hw * 0.45, shY + u * 1.0, hw * 0.55, hipY + u * 1.0, -hw * 0.55, hipY + u * 1.0], L.tunic, ol);
  }
  if (L.armor && L.weapon !== "sword") {
    // shoulder pads
    blob(c, shFront.x, shY + u * 0.2, u * 0.8 * build, u * 0.55, L.armor, ol);
  }
  if (L.belt && !L.robe) {
    c.fillStyle = L.belt;
    c.fillRect(-hw * 1.02, hipY - u * 0.1, hw * 2.04, u * 0.42);
    c.fillStyle = "#e0b84a";
    c.fillRect(hw * 0.2, hipY - u * 0.05, u * 0.35, u * 0.32);
  }
  if (L.scarf) {
    const flap = Math.sin(p.t * 8 + p.id) * u * 0.25;
    slab(c, [-u * 0.9, shY - u * 0.1, u * 0.9, shY - u * 0.1, u * 0.5, shY + u * 0.6, -u * 0.6, shY + u * 0.5], L.scarf, ol);
    slab(c, [-u * 0.7, shY + u * 0.2, -u * 0.2, shY + u * 0.3, -u * 1.9 - flap, shY + u * 1.6, -u * 2.2 - flap, shY + u * 1.1], L.scarf, ol);
  }

  // head
  head(c, L, headY, u, ol, p);

  // front arm + weapon
  switch (L.weapon) {
    case "bow": {
      drawArm(shFront, front);
      const bx = front.h.x;
      const by = front.h.y;
      c.strokeStyle = shade(WOOD, -0.5);
      c.lineWidth = u * 0.42;
      c.beginPath();
      c.arc(bx - u * 1.2, by, u * 2.3, -0.95, 0.95);
      c.stroke();
      c.strokeStyle = WOOD;
      c.lineWidth = u * 0.26;
      c.stroke();
      const tipX = bx - u * 1.2 + Math.cos(0.95) * u * 2.3;
      const tipY = Math.sin(0.95) * u * 2.3;
      const pull = atk < 0.25 ? back.h.x : tipX;
      c.strokeStyle = "rgba(245,240,225,.95)";
      c.lineWidth = Math.max(0.6, u * 0.08);
      c.beginPath();
      c.moveTo(tipX, by - tipY);
      c.lineTo(Math.min(pull, tipX), by);
      c.lineTo(tipX, by + tipY);
      c.stroke();
      break;
    }
    case "sword":
      drawArm(shFront, front);
      shieldDraw(c, front.h.x + u * 0.2, front.h.y - u * 0.4, u, L.shield!, ol);
      break;
    case "club":
      drawArm(shFront, front);
      club(c, front.h.x, front.h.y, frontA + frontBend, u, ol);
      break;
    case "staff": {
      const sx = front.h.x;
      const sy = front.h.y;
      if (!L.noStaff) limb(c, sx - u * 0.2, sy + u * 3.4, sx + u * 0.15, sy - u * 2.4, u * 0.32, WOOD, ol * 0.8);
      drawArm(shFront, front);
      if (L.noStaff) {
        glow(c, back.h.x, back.h.y, u * 1.4, "#7fe7ff", 0.55);
        blob(c, back.h.x, back.h.y, u * 0.35, u * 0.35, "#e6fbff", 0);
      }
      const ox = L.noStaff ? sx + u * 0.5 : sx + u * 0.2;
      const oy = L.noStaff ? sy - u * 0.4 : sy - u * 2.9;
      const charge = atk < 0.4 ? 1.7 : 1;
      glow(c, ox, oy, u * 2.2 * charge, "#7fe7ff", 0.7);
      blob(c, ox, oy, u * 0.6 * charge, u * 0.6 * charge, "#e6fbff", 0);
      c.strokeStyle = "rgba(170,245,255,.9)";
      c.lineWidth = Math.max(0.6, u * 0.12);
      const k = Math.floor(p.t * 14 + p.id);
      for (let i = 0; i < 3; i++) {
        const a = ((k * 7 + i * 13) % 10) * 0.63;
        c.beginPath();
        c.moveTo(ox, oy);
        c.lineTo(ox + Math.cos(a) * u * 1.0, oy + Math.sin(a) * u * 1.0);
        c.lineTo(ox + Math.cos(a + 0.6) * u * 1.4, oy + Math.sin(a + 0.6) * u * 1.4);
        c.stroke();
      }
      break;
    }
    case "bomb":
      drawArm(shFront, front);
      if (atk >= 0.3) bomb(c, front.h.x + u * 0.7, front.h.y - u * 0.4, u * 2.0, ol, p.t);
      break;
    case "lance": {
      const thrust = atk < 0.3 ? Math.sin((atk / 0.3) * Math.PI) * u * 1.6 : 0;
      const lx = -u * 1.6 + thrust;
      const ly = shY + u * 1.6;
      const tx = u * 5.2 + thrust;
      const ty = shY + u * 0.6;
      limb(c, lx, ly, tx - u * 1.2, ty + u * 0.25, u * 0.38, WOOD, ol * 0.8);
      slab(c, [tx - u * 1.3, ty - u * 0.05, tx + u * 0.4, ty + u * 0.1, tx - u * 1.3, ty + u * 0.55], STEEL, ol);
      slab(c, [tx - u * 2.6, ty + u * 0.05, tx - u * 1.5, ty + u * 0.15, tx - u * 2.2, ty - u * 0.9 - Math.sin(p.t * 9) * u * 0.2], p.team.main, ol * 0.7);
      drawArm(shFront, front);
      break;
    }
  }
}

function head(c: Ctx, L: Look, hy: number, u: number, ol: number, p: Pose) {
  const hx = u * 0.15;
  const hr = u * 1.22;
  // hair / hood back layer
  if (L.head === "hood") blob(c, hx - u * 0.15, hy - u * 0.1, hr * 1.22, hr * 1.25, L.headColor, ol);
  if (L.head === "horns" && L.beard) blob(c, hx + u * 0.35, hy + u * 0.75, hr * 0.95, hr * 0.85, L.beard, ol); // big viking beard
  if (L.head === "ponytail" || L.head === "goggles") {
    const sway = Math.sin(p.t * 7 + p.id) * u * 0.25;
    if (L.head === "ponytail") limb(c, hx - u * 0.9, hy - u * 0.4, hx - u * 2.0 - sway, hy + u * 1.3, u * 0.7, L.hair!, ol);
    blob(c, hx - u * 0.2, hy - u * 0.25, hr * 1.06, hr * 1.02, L.hair!, ol);
  }
  // face
  blob(c, hx + (L.head === "hood" ? u * 0.25 : 0), hy + u * 0.05, L.head === "hood" ? hr * 0.82 : hr, L.head === "hood" ? hr * 0.9 : hr * 1.05, L.skin, ol);
  // ear
  if (L.head !== "hood" && L.head !== "helm" && L.head !== "aviator" && L.head !== "horns") blob(c, hx - u * 0.35, hy + u * 0.1, u * 0.25, u * 0.35, shade(L.skin, -0.05), ol * 0.7);
  // eye, brow, nose
  const ex = hx + u * 0.62;
  const ey = hy - u * 0.05;
  if (L.head !== "goggles") {
    c.fillStyle = "#fff";
    c.beginPath();
    c.ellipse(ex, ey, u * 0.2, u * 0.24, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#2a1e1a";
    c.beginPath();
    c.ellipse(ex + u * 0.06, ey + u * 0.02, u * 0.12, u * 0.16, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = shade(L.hair ?? "#3a2a20", -0.2);
    c.lineWidth = Math.max(0.6, u * 0.14);
    c.beginPath();
    const angry = L.head === "horns" ? u * 0.2 : 0;
    c.moveTo(ex - u * 0.3, ey - u * 0.32 - angry * 0.3);
    c.lineTo(ex + u * 0.25, ey - u * 0.3 + angry);
    c.stroke();
  }
  blob(c, hx + u * 1.02, hy + u * 0.25, u * 0.22, u * 0.18, shade(L.skin, -0.06), ol * 0.6);
  c.strokeStyle = shade(L.skin, -0.45);
  c.lineWidth = Math.max(0.6, u * 0.1);
  c.beginPath();
  c.moveTo(hx + u * 0.55, hy + u * 0.62);
  c.lineTo(hx + u * 0.88, hy + u * 0.58);
  c.stroke();

  switch (L.head) {
    case "hood":
      if (L.beard) {
        slab(c, [hx + u * 0.1, hy + u * 0.3, hx + u * 1.05, hy + u * 0.35, hx + u * 0.75, hy + u * 1.3, hx + u * 0.35, hy + u * 1.5], L.beard, ol * 0.8);
      }
      c.strokeStyle = shade(L.headColor, -0.35);
      c.lineWidth = u * 0.35;
      c.beginPath();
      c.arc(hx + u * 0.2, hy + u * 0.05, hr * 0.95, -1.7, 1.25);
      c.stroke();
      break;
    case "helm":
      c.save();
      c.beginPath();
      c.arc(hx, hy - u * 0.05, hr * 1.12, Math.PI, 0);
      c.lineTo(hx + hr * 1.12, hy + u * 0.15);
      c.lineTo(hx - hr * 1.12, hy + u * 0.15);
      c.closePath();
      c.fillStyle = blobGrad(c, hx, hy - u * 0.4, hr, L.headColor);
      c.fill();
      c.lineWidth = ol;
      c.strokeStyle = shade(L.headColor, -0.6);
      c.stroke();
      c.restore();
      limb(c, hx + u * 0.75, hy - u * 0.2, hx + u * 0.75, hy + u * 0.55, u * 0.22, L.headColor, ol * 0.6);
      // plume
      c.strokeStyle = "#ffcf5a";
      c.lineWidth = u * 0.55;
      c.beginPath();
      c.moveTo(hx - u * 0.1, hy - hr * 1.1);
      c.quadraticCurveTo(hx - u * 1.2, hy - hr * 1.9, hx - u * 2.0 - Math.sin(p.t * 6) * u * 0.2, hy - hr * 0.6);
      c.stroke();
      break;
    case "wizard": {
      const tip = Math.sin(p.t * 3 + p.id) * u * 0.25;
      slab(c, [hx - u * 1.0, hy - u * 0.65, hx + u * 1.2, hy - u * 0.65, hx - u * 0.6 + tip, hy - u * 3.4], L.headColor, ol);
      blob(c, hx + u * 0.1, hy - u * 0.65, u * 1.75, u * 0.35, shade(L.headColor, -0.05), ol);
      c.fillStyle = "#ffd35a";
      c.beginPath();
      c.arc(hx - u * 0.05, hy - u * 1.6, u * 0.22, 0, Math.PI * 2);
      c.fill();
      // beard
      slab(c, [hx + u * 0.05, hy + u * 0.35, hx + u * 1.05, hy + u * 0.4, hx + u * 0.45, hy + u * 2.1], L.beard!, ol * 0.8);
      break;
    }
    case "horns": {
      // steel viking helmet with a nose guard
      c.save();
      c.beginPath();
      c.arc(hx, hy - u * 0.15, hr * 1.06, Math.PI, 0);
      c.lineTo(hx + hr * 1.06, hy - u * 0.05);
      c.lineTo(hx - hr * 1.06, hy - u * 0.05);
      c.closePath();
      c.fillStyle = blobGrad(c, hx, hy - u * 0.6, hr, "#8f96a3");
      c.fill();
      c.lineWidth = ol;
      c.strokeStyle = "#2c2f38";
      c.stroke();
      c.restore();
      c.fillStyle = "#c9a24a";
      c.fillRect(hx - hr * 1.06, hy - u * 0.3, hr * 2.12, u * 0.28);
      limb(c, hx + u * 0.7, hy - u * 0.3, hx + u * 0.75, hy + u * 0.35, u * 0.22, "#8f96a3", ol * 0.6);
      for (const s of [-1, 1]) {
        c.strokeStyle = shade(L.headColor, -0.5);
        c.lineWidth = u * 0.6;
        c.beginPath();
        c.moveTo(hx + s * u * 0.5, hy - u * 0.8);
        c.quadraticCurveTo(hx + s * u * 1.4, hy - u * 1.4, hx + s * u * 1.2, hy - u * 2.3);
        c.stroke();
        c.strokeStyle = L.headColor;
        c.lineWidth = u * 0.4;
        c.stroke();
      }
      break;
    }
    case "goggles":
      // red cap with a small brim, goggles pushed onto the face
      c.save();
      c.beginPath();
      c.arc(hx - u * 0.05, hy - u * 0.35, hr * 1.02, Math.PI * 1.02, Math.PI * 1.98);
      c.closePath();
      c.fillStyle = blobGrad(c, hx, hy - u * 0.8, hr, L.headColor);
      c.fill();
      c.lineWidth = ol;
      c.strokeStyle = shade(L.headColor, -0.6);
      c.stroke();
      c.restore();
      blob(c, hx + u * 1.0, hy - u * 0.42, u * 0.65, u * 0.16, shade(L.headColor, -0.15), ol * 0.7);
      c.fillStyle = "#3a2a20";
      c.fillRect(hx - u * 1.1, hy - u * 0.45, u * 2.2, u * 0.35);
      for (const gx of [hx + u * 0.55, hx + u * 0.05]) {
        blob(c, gx, hy - u * 0.25, u * 0.38, u * 0.38, "#9a7a4a", ol * 0.7);
        c.fillStyle = "rgba(160,230,255,.85)";
        c.beginPath();
        c.arc(gx, hy - u * 0.25, u * 0.24, 0, Math.PI * 2);
        c.fill();
      }
      break;
    case "aviator":
      c.save();
      c.beginPath();
      c.arc(hx, hy - u * 0.1, hr * 1.08, Math.PI * 0.95, Math.PI * 2.05);
      c.closePath();
      c.fillStyle = blobGrad(c, hx, hy - u * 0.5, hr, L.headColor);
      c.fill();
      c.lineWidth = ol;
      c.strokeStyle = shade(L.headColor, -0.6);
      c.stroke();
      c.restore();
      blob(c, hx - u * 0.45, hy + u * 0.2, u * 0.4, u * 0.55, L.headColor, ol * 0.7); // ear flap
      blob(c, hx + u * 0.45, hy - u * 0.85, u * 0.42, u * 0.28, "#cfe8ff", ol * 0.7); // goggles up on the cap
      break;
    case "ponytail":
      blob(c, hx + u * 0.05, hy - u * 0.75, hr * 0.95, hr * 0.45, L.hair!, ol * 0.8);
      break;
  }
}

function blobGrad(c: Ctx, x: number, y: number, r: number, base: string) {
  const g = c.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r * 1.4);
  g.addColorStop(0, shade(base, 0.55));
  g.addColorStop(0.5, base);
  g.addColorStop(1, shade(base, -0.45));
  return g;
}

function sword(c: Ctx, hx: number, hy: number, a: number, u: number, ol: number) {
  const dx = Math.sin(a);
  const dy = Math.cos(a);
  const tip = { x: hx + dx * u * 3.4, y: hy + dy * u * 3.4 };
  limb(c, hx + dx * u * 0.5, hy + dy * u * 0.5, tip.x, tip.y, u * 0.42, "#dfe5ee", ol * 0.8);
  limb(c, hx - dy * u * 0.6, hy + dx * u * 0.6, hx + dy * u * 0.6, hy - dx * u * 0.6, u * 0.26, "#d9a83a", ol * 0.7);
}

function shieldDraw(c: Ctx, x: number, y: number, u: number, color: string, ol: number) {
  blob(c, x, y, u * 1.05, u * 1.4, shade(color, -0.1), ol);
  c.lineWidth = u * 0.28;
  c.strokeStyle = "#c9ced8";
  c.beginPath();
  c.ellipse(x, y, u * 0.92, u * 1.27, 0, 0, Math.PI * 2);
  c.stroke();
  // emblem: gold cross
  c.fillStyle = "#ffcf5a";
  c.fillRect(x - u * 0.16, y - u * 0.75, u * 0.32, u * 1.5);
  c.fillRect(x - u * 0.55, y - u * 0.25, u * 1.1, u * 0.3);
}

function club(c: Ctx, hx: number, hy: number, a: number, u: number, ol: number) {
  const dx = Math.sin(a);
  const dy = Math.cos(a);
  const end = { x: hx + dx * u * 3.6, y: hy + dy * u * 3.6 };
  limb(c, hx - dx * u * 0.4, hy - dy * u * 0.4, hx + dx * u * 1.6, hy + dy * u * 1.6, u * 0.55, WOOD, ol);
  limb(c, hx + dx * u * 1.6, hy + dy * u * 1.6, end.x, end.y, u * 1.15, shade(WOOD, 0.05), ol);
  c.fillStyle = "#d8dde6";
  for (let i = 0; i < 3; i++) {
    const k = 2.0 + i * 0.6;
    c.beginPath();
    c.arc(hx + dx * u * k - dy * u * 0.55, hy + dy * u * k + dx * u * 0.55, u * 0.17, 0, Math.PI * 2);
    c.fill();
  }
}

export function bomb(c: Ctx, x: number, y: number, u: number, ol: number, t: number) {
  blob(c, x, y, u * 0.75, u * 0.75, "#2c2f3a", ol);
  limb(c, x + u * 0.35, y - u * 0.6, x + u * 0.6, y - u * 1.1, u * 0.16, "#a07a4a", 0);
  const f = 0.6 + Math.sin(t * 40) * 0.4;
  glow(c, x + u * 0.65, y - u * 1.2, u * 0.7 * f + u * 0.2, "#ffb43a", 0.9);
}

// ------------------------------------------------------------------ creatures
function golem(c: Ctx, r: number, p: Pose, crystal: boolean) {
  const ol = Math.max(0.8, r * 0.04);
  const stone = crystal ? "#5e6b8e" : "#a08f7e"; // blue-grey crystal giant / warm sandstone golem
  const w = p.moving ? p.t * (crystal ? 3.2 : 4.5) + p.id : 0;
  const step = p.moving ? Math.sin(w) : 0;
  const sway = step * r * 0.04;
  const slam = p.atk < 1 ? Math.sin(Math.min(1, p.atk / 0.45) * Math.PI) : 0;
  // legs
  for (const s of [-1, 1]) {
    const lift = Math.max(0, s * step) * r * 0.18;
    blob(c, s * r * 0.42, -r * 0.28 - lift, r * 0.34, r * 0.3, shade(stone, s < 0 ? -0.15 : 0), ol);
  }
  const by = -r * 1.05 - Math.abs(step) * r * 0.04;
  // back arm
  const armY = (s: number) => by + r * 0.35 - slam * r * 0.75 + s * step * r * 0.12;
  blob(c, -r * 0.95 + sway, by - r * 0.25, r * 0.36, r * 0.32, shade(stone, -0.2), ol);
  blob(c, -r * 1.05 + sway, armY(-1), r * 0.36, r * 0.34, shade(stone, -0.2), ol);
  // body: a stack of boulders
  blob(c, sway, by, r * 0.95, r * 0.82, stone, ol);
  blob(c, sway - r * 0.2, by - r * 0.45, r * 0.6, r * 0.42, shade(stone, 0.1), ol);
  blob(c, sway + r * 0.35, by + r * 0.3, r * 0.5, r * 0.38, shade(stone, -0.05), ol);
  // team-colored strap across the chest
  c.save();
  c.beginPath();
  c.ellipse(sway, by, r * 0.95, r * 0.82, 0, 0, Math.PI * 2);
  c.clip();
  c.strokeStyle = shade(p.team.main, -0.1);
  c.lineWidth = r * 0.2;
  c.beginPath();
  c.moveTo(sway - r * 0.9, by - r * 0.55);
  c.lineTo(sway + r * 0.9, by + r * 0.5);
  c.stroke();
  c.restore();
  // cracks (the sandstone golem's glow like embers)
  if (!crystal) {
    c.save();
    c.shadowColor = "#ff8a2a";
    c.shadowBlur = r * 0.25;
    c.strokeStyle = "#ffb04a";
    c.lineWidth = Math.max(0.8, r * 0.05);
    c.beginPath();
    c.moveTo(sway - r * 0.55, by + r * 0.1);
    c.lineTo(sway - r * 0.3, by + r * 0.25);
    c.lineTo(sway - r * 0.38, by + r * 0.5);
    c.stroke();
    c.restore();
  }
  c.strokeStyle = shade(stone, -0.55);
  c.lineWidth = Math.max(0.7, r * 0.035);
  c.beginPath();
  c.moveTo(sway - r * 0.55, by + r * 0.1);
  c.lineTo(sway - r * 0.3, by + r * 0.25);
  c.lineTo(sway - r * 0.38, by + r * 0.5);
  c.moveTo(sway + r * 0.1, by - r * 0.7);
  c.lineTo(sway + r * 0.25, by - r * 0.45);
  c.stroke();
  // moss or crystals
  if (crystal) {
    for (const [dx, dy, s, a] of [[-0.55, -0.85, 0.5, -0.5], [-0.1, -1.0, 0.65, -0.1], [0.35, -0.9, 0.45, 0.35], [-0.95, -0.4, 0.4, -0.9]]) {
      c.save();
      c.translate(sway + dx * r, by + dy * r);
      c.rotate(a);
      slab(c, [-r * 0.12 * s, 0, 0, -r * 0.7 * s, r * 0.12 * s, 0, 0, r * 0.1 * s], p.team.light, ol * 0.6);
      c.restore();
    }
  } else {
    blob(c, sway - r * 0.15, by - r * 0.78, r * 0.45, r * 0.14, "#6a9a48", 0);
  }
  // glowing core + eyes (crystal giant glows in team color, the golem's eyes burn orange)
  glow(c, sway + r * 0.2, by + r * 0.05, r * (crystal ? 0.7 : 0.4), p.team.main, 0.8);
  blob(c, sway + r * 0.2, by + r * 0.05, r * (crystal ? 0.2 : 0.12), r * (crystal ? 0.2 : 0.12), p.team.light, 0);
  const eye = crystal ? p.team.main : "#ff7a1a";
  for (const ex of [0.38, 0.62]) {
    glow(c, sway + ex * r, by - r * 0.42, r * 0.17, eye, 0.95);
    c.fillStyle = crystal ? shade(p.team.light, 0.5) : "#ffe0a0";
    c.fillRect(sway + ex * r - r * 0.06, by - r * 0.45, r * 0.12, r * 0.06);
  }
  // heavy brow
  blob(c, sway + r * 0.5, by - r * 0.55, r * 0.35, r * 0.1, shade(stone, -0.2), 0);
  // front arm
  blob(c, r * 0.9 + sway, by - r * 0.2, r * 0.38, r * 0.34, stone, ol);
  blob(c, r * 1.05 + sway, armY(1), r * 0.4, r * 0.36, shade(stone, 0.05), ol);
  if (p.hp < 0.5) {
    c.strokeStyle = shade(stone, -0.7);
    c.beginPath();
    c.moveTo(sway + r * 0.6, by - r * 0.3);
    c.lineTo(sway + r * 0.45, by);
    c.lineTo(sway + r * 0.62, by + r * 0.25);
    c.stroke();
  }
}

function imp(c: Ctx, r: number, p: Pose) {
  const ol = Math.max(0.6, r * 0.06);
  const hop = p.moving ? Math.abs(Math.sin(p.t * 13 + p.id * 1.7)) * r * 0.5 : Math.abs(Math.sin(p.t * 3 + p.id)) * r * 0.06;
  const bite = p.atk < 1 ? Math.sin(Math.min(1, p.atk / 0.4) * Math.PI) * r * 0.3 : 0;
  const cx = bite;
  const cy = -r * 0.95 - hop;
  const flap = Math.sin(p.t * 20 + p.id) * 0.5;
  // tail
  c.strokeStyle = shade(p.team.dark, -0.2);
  c.lineWidth = r * 0.16;
  c.beginPath();
  c.moveTo(cx - r * 0.7, cy + r * 0.3);
  c.quadraticCurveTo(cx - r * 1.5, cy + r * 0.2, cx - r * 1.35, cy - r * 0.45);
  c.stroke();
  // wings
  slab(c, [cx - r * 0.3, cy - r * 0.35, cx - r * 1.5, cy - r * (1.1 + flap * 0.5), cx - r * 1.0, cy - r * 0.1], shade(p.team.dark, -0.15), ol);
  // body
  blob(c, cx, cy, r * 0.95, r * 0.85, p.team.main, ol);
  blob(c, cx + r * 0.2, cy + r * 0.3, r * 0.5, r * 0.38, shade(p.team.light, -0.05), 0);
  // horns
  for (const s of [-1, 1]) slab(c, [cx + s * r * 0.35 + r * 0.1, cy - r * 0.7, cx + s * r * 0.55 + r * 0.1, cy - r * 1.35, cx + s * r * 0.15 + r * 0.1, cy - r * 0.78], "#efe6d0", ol * 0.7);
  // eyes (glowing slits)
  for (const ex of [0.2, 0.6]) {
    blob(c, cx + ex * r, cy - r * 0.2, r * 0.17, r * 0.2, "#ffe066", ol * 0.6);
    c.fillStyle = "#1d1416";
    c.fillRect(cx + ex * r - r * 0.03, cy - r * 0.34, r * 0.07, r * 0.28);
  }
  // teeth
  c.fillStyle = "#fff";
  c.beginPath();
  c.moveTo(cx + r * 0.45, cy + r * 0.2);
  c.lineTo(cx + r * 0.55, cy + r * 0.38);
  c.lineTo(cx + r * 0.65, cy + r * 0.2);
  c.fill();
  // near wing
  slab(c, [cx - r * 0.1, cy - r * 0.4, cx - r * 0.9, cy - r * (1.35 + flap), cx - r * 0.3, cy - r * 0.05], p.team.dark, ol);
}

function wyvern(c: Ctx, r: number, p: Pose) {
  const ol = Math.max(0.7, r * 0.045);
  const flap = Math.sin(p.t * 11 + p.id);
  const cy = -r * 0.6;
  const body = "#6a4cae";
  // tail
  c.strokeStyle = shade(body, -0.6);
  c.lineWidth = r * 0.3;
  c.beginPath();
  c.moveTo(-r * 0.5, cy + r * 0.05);
  c.quadraticCurveTo(-r * 1.3, cy + r * 0.3, -r * 1.7, cy - r * 0.15);
  c.stroke();
  c.strokeStyle = body;
  c.lineWidth = r * 0.2;
  c.stroke();
  slab(c, [-r * 1.75, cy - r * 0.35, -r * 1.55, cy - r * 0.05, -r * 2.05, cy - r * 0.05], shade(body, -0.2), ol * 0.7);
  // far wing
  wing(c, -r * 0.05, cy - r * 0.2, r * 1.5, -0.8 - flap * 0.6, shade(p.team.main, -0.3), ol);
  // body
  blob(c, 0, cy, r * 0.8, r * 0.5, body, ol);
  blob(c, r * 0.1, cy + r * 0.2, r * 0.55, r * 0.22, "#f0c868", 0);
  // neck + head
  limb(c, r * 0.5, cy - r * 0.1, r * 0.9, cy - r * 0.5, r * 0.32, body, ol);
  blob(c, r * 1.05, cy - r * 0.6, r * 0.36, r * 0.28, body, ol);
  slab(c, [r * 1.25, cy - r * 0.68, r * 1.75, cy - r * 0.55, r * 1.25, cy - r * 0.42], shade(body, 0.1), ol * 0.8);
  slab(c, [r * 0.85, cy - r * 0.8, r * 0.5, cy - r * 1.15, r * 0.95, cy - r * 0.86], "#efe6d0", ol * 0.6);
  blob(c, r * 1.15, cy - r * 0.7, r * 0.1, r * 0.09, "#9dff5a", 0);
  // near wing
  wing(c, r * 0.1, cy - r * 0.15, r * 1.7, -1.0 - flap * 0.8, p.team.main, ol);
}

function wing(c: Ctx, x: number, y: number, len: number, a: number, color: string, ol: number) {
  const tip = { x: x - Math.cos(a) * len * 0.35, y: y + Math.sin(a) * len };
  const mid = { x: x - len * 0.75, y: y + Math.sin(a) * len * 0.45 };
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(tip.x, tip.y);
  c.quadraticCurveTo(mid.x, mid.y + len * 0.15, x - len * 0.55, y + len * 0.12);
  c.closePath();
  const g = c.createLinearGradient(x, y, tip.x, tip.y);
  g.addColorStop(0, color);
  g.addColorStop(1, shade(color, 0.35));
  c.fillStyle = g;
  c.fill();
  c.lineWidth = ol;
  c.strokeStyle = shade(color, -0.55);
  c.stroke();
  c.lineWidth = ol * 0.8;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(mid.x, mid.y + len * 0.1);
  c.stroke();
}

function wisp(c: Ctx, r: number, p: Pose) {
  const cy = -r * 1.0 + Math.sin(p.t * 5 + p.id) * r * 0.25;
  const flick = Math.sin(p.t * 17 + p.id) * r * 0.15;
  glow(c, 0, cy, r * 2.2, p.team.main, 0.55);
  // flame tail streaming backwards
  c.beginPath();
  c.moveTo(r * 0.55, cy - r * 0.35);
  c.quadraticCurveTo(-r * 0.6, cy - r * 0.9 + flick, -r * 1.9, cy - r * 0.2 + flick);
  c.quadraticCurveTo(-r * 0.6, cy + r * 0.4, r * 0.55, cy + r * 0.4);
  c.closePath();
  const g = c.createLinearGradient(r * 0.5, cy, -r * 1.9, cy);
  g.addColorStop(0, shade(p.team.light, 0.5));
  g.addColorStop(0.5, shade(p.team.main, 0, 0.8));
  g.addColorStop(1, shade(p.team.main, 0, 0));
  c.fillStyle = g;
  c.fill();
  for (const ex of [-0.3, 0.45]) {
    c.fillStyle = shade(p.team.light, 0.35);
    c.beginPath();
    c.moveTo(r * (ex - 0.18), cy - r * 0.38);
    c.lineTo(r * (ex + 0.02), cy - r * 0.95);
    c.lineTo(r * (ex + 0.2), cy - r * 0.4);
    c.fill();
  }
  blob(c, r * 0.1, cy, r * 0.66, r * 0.62, shade(p.team.light, 0.55), 0);
  c.fillStyle = shade(p.team.dark, -0.4);
  for (const ex of [0.12, 0.42]) {
    c.beginPath();
    c.ellipse(ex * r, cy - r * 0.05, r * 0.08, r * 0.13, 0, 0, Math.PI * 2);
    c.fill();
  }
}

function crystalTurret(c: Ctx, r: number, p: Pose) {
  const ol = Math.max(0.8, r * 0.035);
  const by = -r * 0.15;
  slab(c, [-r * 0.85, by, -r * 0.72, by - r * 0.85, r * 0.72, by - r * 0.85, r * 0.85, by], "#a39c8f", ol);
  blob(c, 0, by, r * 0.85, r * 0.28, "#8b8578", ol);
  blob(c, 0, by - r * 0.85, r * 0.72, r * 0.24, "#c9c2b4", ol);
  c.strokeStyle = "rgba(40,30,20,.3)";
  c.lineWidth = Math.max(0.7, r * 0.03);
  for (let i = 1; i < 3; i++) {
    c.beginPath();
    c.moveTo(-r * 0.8, by - r * 0.28 * i);
    c.lineTo(r * 0.8, by - r * 0.28 * i);
    c.stroke();
  }
  const pulse = 0.85 + Math.sin(p.t * 4 + p.id) * 0.15;
  const ky = by - r * 1.3 - Math.sin(p.t * 2 + p.id) * r * 0.06;
  glow(c, 0, ky, r * 1.1 * pulse, p.team.main, 0.6);
  slab(c, [0, ky - r * 0.65, r * 0.34, ky, 0, ky + r * 0.4, -r * 0.34, ky], p.team.main, ol);
  slab(c, [0, ky - r * 0.65, r * 0.13, ky - r * 0.05, 0, ky + r * 0.4], shade(p.team.light, 0.3), 0);
  if (p.hp < 0.55) {
    c.strokeStyle = "rgba(30,20,10,.7)";
    c.beginPath();
    c.moveTo(-r * 0.4, by - r * 0.8);
    c.lineTo(-r * 0.25, by - r * 0.45);
    c.lineTo(-r * 0.45, by - r * 0.2);
    c.stroke();
  }
}

function cannon(c: Ctx, r: number, p: Pose) {
  const ol = Math.max(0.8, r * 0.035);
  const recoil = p.atk < 0.25 ? (1 - p.atk / 0.25) * r * 0.25 : 0;
  // platform
  slab(c, [-r * 0.9, -r * 0.05, -r * 0.8, -r * 0.55, r * 0.8, -r * 0.55, r * 0.9, -r * 0.05], "#8a6038", ol);
  c.strokeStyle = "rgba(40,25,10,.4)";
  c.lineWidth = ol;
  for (const x of [-0.4, 0, 0.4]) {
    c.beginPath();
    c.moveTo(x * r, -r * 0.52);
    c.lineTo(x * r, -r * 0.08);
    c.stroke();
  }
  // carriage + barrel aimed slightly up
  const bx = -recoil;
  const by = -r * 0.85;
  c.save();
  c.translate(bx, by);
  c.rotate(-0.25);
  const g = c.createLinearGradient(0, -r * 0.3, 0, r * 0.3);
  g.addColorStop(0, "#9aa2b0");
  g.addColorStop(0.45, "#4a505e");
  g.addColorStop(1, "#22252e");
  c.fillStyle = g;
  c.beginPath();
  c.roundRect(-r * 0.55, -r * 0.27, r * 1.35, r * 0.54, r * 0.2);
  c.fill();
  c.lineWidth = ol;
  c.strokeStyle = "#16181e";
  c.stroke();
  c.fillStyle = "#d9a83a";
  c.fillRect(-r * 0.42, -r * 0.29, r * 0.12, r * 0.58);
  c.fillRect(r * 0.55, -r * 0.29, r * 0.1, r * 0.58);
  c.fillStyle = p.team.main;
  c.fillRect(-r * 0.2, -r * 0.29, r * 0.18, r * 0.58);
  c.fillStyle = "#16181e";
  c.beginPath();
  c.ellipse(r * 0.8, 0, r * 0.08, r * 0.22, 0, 0, Math.PI * 2);
  c.fill();
  if (p.atk < 0.12) glow(c, r * 1.05, 0, r * 0.7, "#ffb43a", 0.95);
  c.restore();
  blob(c, -r * 0.1, -r * 0.55, r * 0.3, r * 0.3, "#5a3a20", ol); // wheel
  blob(c, -r * 0.1, -r * 0.55, r * 0.1, r * 0.1, "#c9a060", 0);
}
