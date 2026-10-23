// Browser client.
//  - Practice: runs the sim locally with a bot as player 1.
//  - Online: the server runs the real match; this client replays the server's frames
//    through the same deterministic sim and only ever sends "play card X at (x,y)".

import { Bot } from "../ai/bot";
import { CARDS } from "../sim/cards";
import {
  ARENA_H, ARENA_W, BRIDGES, BRIDGE_HALF, DOUBLE_ELIXIR_AT, ELIXIR_UNIT, REGULATION_TICKS,
  OVERTIME_TICKS, RIVER_BOTTOM, RIVER_TOP, TICK_RATE, canDeployAt, createGame, hashState, replay, step,
  type Entity, type GameState, type Input, type PlayerId, type SimEvent,
} from "../sim/sim";
import type { ClientMsg, LogEntry, ServerMsg } from "../net/protocol";

declare const __ONLINE__: boolean;

const TICK_MS = 1000 / TICK_RATE;

type Diff = "easy" | "normal" | "hard";
const DIFF: Record<Diff, { thinkEvery: number; pushAt: number; label: string }> = {
  easy: { thinkEvery: 26, pushAt: 10, label: "Easy" },
  normal: { thinkEvery: 12, pushAt: 9, label: "Normal" },
  hard: { thinkEvery: 5, pushAt: 8, label: "Hard" },
};

// ------------------------------------------------------------------ DOM
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("arena");
const ctx = canvas.getContext("2d")!;
const stage = $("stage");
const handEl = $("hand");
const css = getComputedStyle(document.documentElement);
const C = (n: string) => css.getPropertyValue(n).trim();
const COL = {
  blue: C("--blue"), red: C("--red"), gold: C("--gold"), elixir: C("--elixir"), ink: C("--ink"),
  fieldA: C("--field-a"), fieldB: C("--field-b"), river: C("--river"), bridge: C("--bridge"), text: C("--text"),
};
const FONT_NUM = C("--font-num");

const screens = ["startScreen", "waitScreen", "endScreen"] as const;
function show(id: (typeof screens)[number] | null) {
  for (const s of screens) $(s).hidden = s !== id;
}

// ------------------------------------------------------------------ state
type Mode = "menu" | "bot" | "online";
let mode: Mode = "menu";
let me: PlayerId = 0;
let game: GameState = createGame(1);
let bot: Bot | null = null;
let seed = 0;
let diff: Diff = "normal";
let running = false;
let acc = 0;
let lastT = 0;
let inputLog: Input[] = [];
let pending: Input[] = []; // practice mode: my inputs waiting for the next tick
let selected: string | null = null;
let ghost: { x: number; y: number } | null = null;
let dragging = false;
const prevPos = new Map<number, { x: number; y: number }>();
interface Fx { ev: SimEvent; t: number }
let fx: Fx[] = [];
interface Mark { card: string; x: number; y: number; t: number }
let sentMarks: Mark[] = []; // online: deploys sent but not yet confirmed by the server

const teamCol = (o: number) => (o === me ? COL.blue : COL.red);
const opp = (): PlayerId => (me === 0 ? 1 : 0);

// ------------------------------------------------------------------ layout (player 2 sees the board flipped)
let scale = 1;
function resize() {
  const r = stage.getBoundingClientRect();
  const s = Math.min(r.width / ARENA_W, r.height / ARENA_H);
  const w = Math.floor(ARENA_W * s);
  const h = Math.floor(ARENA_H * s);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  scale = (w * dpr) / ARENA_W;
}
new ResizeObserver(resize).observe(stage);

const flip = () => me === 1;
const sx = (x: number) => x * scale;
const sy = (y: number) => (flip() ? ARENA_H - y : y) * scale;
const sl = (l: number) => l * scale;
/** Fill a world-space rectangle (works with the flipped view). */
function rectW(x0: number, y0: number, x1: number, y1: number) {
  const a = sy(y0);
  const b = sy(y1);
  ctx.fillRect(sx(x0), Math.min(a, b), sl(x1 - x0), Math.abs(b - a));
}

function toWorld(clientX: number, clientY: number) {
  const r = canvas.getBoundingClientRect();
  const x = ((clientX - r.left) / r.width) * ARENA_W;
  let y = ((clientY - r.top) / r.height) * ARENA_H;
  if (x < 0 || y < 0 || x > ARENA_W || y > ARENA_H) return null;
  if (flip()) y = ARENA_H - y;
  // snap to tile centers: integer, server-friendly coordinates
  return { x: Math.min(17, Math.floor(x / 1000)) * 1000 + 500, y: Math.min(31, Math.floor(y / 1000)) * 1000 + 500 };
}

// ------------------------------------------------------------------ hand UI
const cardButtons: HTMLButtonElement[] = [];
for (let i = 0; i < 4; i++) {
  const b = document.createElement("button");
  b.className = "card";
  b.id = `card${i}`;
  b.type = "button";
  b.innerHTML = `<span class="fill"></span><span class="cost"></span><span class="glyph"></span><span class="nm"></span>`;
  b.addEventListener("pointerdown", (e) => {
    if (!running) return;
    const id = game.players[me].hand[i];
    selected = selected === id ? null : id;
    dragging = selected !== null;
    e.preventDefault();
    renderHand();
  });
  handEl.appendChild(b);
  cardButtons.push(b);
}

function renderHand() {
  const p = game.players[me];
  const elixir = p.elixir / ELIXIR_UNIT;
  p.hand.forEach((id, i) => {
    const def = CARDS[id];
    const b = cardButtons[i];
    b.className = `card ${def.kind}${elixir < def.cost ? " poor" : ""}${selected === id ? " sel" : ""}`;
    b.setAttribute("aria-label", `${def.name}, ${def.cost} elixir. ${def.description}`);
    b.title = def.description;
    (b.querySelector(".cost") as HTMLElement).textContent = String(def.cost);
    (b.querySelector(".glyph") as HTMLElement).textContent = def.short;
    (b.querySelector(".nm") as HTMLElement).textContent = def.name;
    (b.querySelector(".fill") as HTMLElement).style.height = `${Math.min(100, (elixir / def.cost) * 100)}%`;
  });
  const next = CARDS[p.queue[0]];
  $("nextCard").textContent = next.short;
  $("nextCard").title = `Next: ${next.name}`;
  $("elixirNum").textContent = String(Math.floor(elixir));
  $("elixirLvl").style.width = `${elixir * 10}%`;
}

function renderScore() {
  const paint = (el: string, crowns: number) =>
    $(el).querySelectorAll("i").forEach((c, i) => c.classList.toggle("on", i < crowns));
  paint("crowns0", game.players[me].crowns);
  paint("crowns1", game.players[opp()].crowns);
  const t = game.tick;
  const ot = t >= REGULATION_TICKS;
  const left = ot ? REGULATION_TICKS + OVERTIME_TICKS - t : REGULATION_TICKS - t;
  const secs = Math.max(0, Math.ceil(left / TICK_RATE));
  const clock = $("clock");
  clock.firstChild!.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  clock.classList.toggle("ot", ot);
  clock.classList.toggle("hot", t >= DOUBLE_ELIXIR_AT);
  $("clockLabel").textContent = ot ? "SUDDEN DEATH" : t >= DOUBLE_ELIXIR_AT ? "2× ELIXIR" : "REGULATION";
}

let toastTimer = 0;
function toast(msg: string) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 1400);
}

// ------------------------------------------------------------------ deploy input
function tryDeploy(clientX: number, clientY: number) {
  if (!selected || !running) return;
  const w = toWorld(clientX, clientY);
  if (!w) return;
  const def = CARDS[selected];
  if (game.players[me].elixir < def.cost * ELIXIR_UNIT) return toast(`Need ${def.cost} elixir`);
  if (!canDeployAt(game, me, def.kind, w.x, w.y)) return toast("Deploy on your side");
  if (mode === "online") {
    if (!net.send({ t: "play", card: selected, x: w.x, y: w.y })) return toast("Reconnecting…");
    sentMarks.push({ card: selected, x: w.x, y: w.y, t: performance.now() });
  } else {
    pending.push({ tick: -1, player: me, card: selected, x: w.x, y: w.y });
  }
  selected = null;
  dragging = false;
  ghost = null;
  renderHand();
}

canvas.addEventListener("pointermove", (e) => {
  ghost = selected ? toWorld(e.clientX, e.clientY) : null;
});
canvas.addEventListener("pointerleave", () => (ghost = null));
canvas.addEventListener("pointerdown", (e) => {
  if (selected && !dragging) tryDeploy(e.clientX, e.clientY);
});
const overCanvas = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
};
window.addEventListener("pointermove", (e) => {
  if (dragging && overCanvas(e)) ghost = toWorld(e.clientX, e.clientY);
});
window.addEventListener("pointerup", (e) => {
  if (!dragging) return;
  dragging = false;
  if (overCanvas(e)) tryDeploy(e.clientX, e.clientY);
});
window.addEventListener("keydown", (e) => {
  if (!running || (e.target as HTMLElement).tagName === "INPUT") return;
  const n = Number(e.key);
  if (n >= 1 && n <= 4) {
    const id = game.players[me].hand[n - 1];
    selected = selected === id ? null : id;
    renderHand();
  } else if (e.key === "Escape") {
    selected = null;
    renderHand();
  }
});

// ------------------------------------------------------------------ shared match flow
function resetView() {
  inputLog = [];
  pending = [];
  fx = [];
  sentMarks = [];
  prevPos.clear();
  selected = null;
  acc = 0;
  lastT = performance.now();
}

function handleEvents(now: number) {
  for (const ev of game.events) {
    if (ev.type === "reject") {
      if (ev.player === me && mode === "bot") toast(ev.reason === "not enough elixir" ? "Not enough elixir" : "Can't deploy there");
      continue;
    }
    if (ev.type === "deploy" && ev.owner === me && sentMarks.length) {
      const i = sentMarks.findIndex((m) => m.card === ev.card && m.x === ev.x && m.y === ev.y);
      if (i >= 0) sentMarks.splice(i, 1);
    }
    fx.push({ ev, t: now });
  }
}

function snapshotPositions() {
  prevPos.clear();
  for (const e of game.entities) prevPos.set(e.id, { x: e.x, y: e.y });
}

function finishLocal(serverHash?: number) {
  running = false;
  selected = null;
  const w = game.winner;
  const title = $("endTitle");
  title.textContent = w === me ? "Victory" : w === -1 ? "Draw" : "Defeat";
  title.className = `result ${w === me ? "win" : w === -1 ? "" : "loss"}`;
  $("endLabel").textContent = mode === "online" ? "Online match" : `Practice · ${DIFF[diff].label} bot`;
  $("endScore").textContent = `${game.players[me].crowns} – ${game.players[opp()].crowns} crowns · ${Math.round(game.tick / TICK_RATE)}s`;
  // Re-simulate from seed + inputs and compare: proves the result is reproducible.
  const live = hashState(game);
  const ok = hashState(replay(seed, inputLog).state) === live;
  const hex = (h: number) => h.toString(16).padStart(8, "0");
  let html = ok
    ? `<b>Replay verified</b><br>${inputLog.length} inputs · ${game.tick} ticks · hash ${hex(live)}`
    : `Replay mismatch: ${hex(live)}`;
  if (serverHash !== undefined) {
    html += serverHash === live ? `<br><b>Matches server result</b>` : `<br>Server hash ${hex(serverHash)} differs`;
  }
  $("verify").innerHTML = html;
  $("countdown").hidden = true;
  show("endScreen");
  renderHand();
  renderScore();
}

// ------------------------------------------------------------------ practice vs bot
function startBot(d: Diff) {
  net.close();
  mode = "bot";
  diff = d;
  me = 0;
  seed = (Math.random() * 0xffffffff) >>> 0; // fine for local play; the server picks seeds online
  game = createGame(seed);
  bot = new Bot(1, { seed: seed ^ 0x5eed, ...DIFF[d] });
  resetView();
  running = true;
  $("botName").textContent = "Bot";
  $("botName").title = `${DIFF[d].label} difficulty`;
  $("net").hidden = true;
  show(null);
  renderHand();
  renderScore();
}

function botTick() {
  const inputs: Input[] = pending.map((p) => ({ ...p, tick: game.tick }));
  pending = [];
  const b = bot!.decide(game);
  if (b) inputs.push(b);
  inputLog.push(...inputs);
  snapshotPositions();
  step(game, inputs);
  handleEvents(performance.now());
  if (game.phase === "over") finishLocal();
}

// ------------------------------------------------------------------ online
interface Frame { k: number; inputs: Input[] }
let frames: Frame[] = [];
let session: { code: string; token: string } | null = null;
let serverEnd: Extract<ServerMsg, { t: "end" }> | null = null;
let waitingFor: "queue" | "friend" | null = null;
let rtt = 0;
let oppGone = false;

const net = {
  ws: null as WebSocket | null,
  wantOpen: false,
  retry: 0,
  pingTimer: 0,
  onOpenOnce: null as null | (() => void),
  open(then: () => void) {
    this.wantOpen = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return then();
    this.onOpenOnce = then;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      const f = this.onOpenOnce;
      this.onOpenOnce = null;
      f?.();
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: "ping", n: Math.round(performance.now()) }), 2000);
    };
    ws.onmessage = (e) => {
      try {
        onServer(JSON.parse(e.data) as ServerMsg);
      } catch (err) {
        console.error(err);
      }
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.wantOpen) return;
      if (mode === "online" && session && !serverEnd) {
        setNet("Reconnecting…", "bad");
        const delay = Math.min(4000, 500 * 2 ** this.retry++);
        setTimeout(() => this.open(() => this.send({ t: "rejoin", ...session! })), delay);
      } else if (waitingFor) {
        backToMenu("Lost connection to the server");
      }
    };
  },
  send(m: ClientMsg): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  },
  close() {
    this.wantOpen = false;
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  },
};

function setNet(text: string, level: "" | "warn" | "bad" = "") {
  const el = $("net");
  el.hidden = mode !== "online";
  el.textContent = text;
  el.className = `net ${level}`;
}

function rebuild(newSeed: number, log: LogEntry[], tick: number) {
  seed = newSeed;
  game = createGame(seed);
  inputLog = log.map(([t, player, card, x, y]) => ({ tick: t, player, card, x, y }));
  const byTick = new Map<number, Input[]>();
  for (const i of inputLog) {
    const a = byTick.get(i.tick) ?? [];
    a.push(i);
    byTick.set(i.tick, a);
  }
  while (game.tick < tick && game.phase !== "over") step(game, byTick.get(game.tick) ?? []);
  frames = frames.filter((f) => f.k >= tick);
  prevPos.clear();
}

function onServer(m: ServerMsg) {
  switch (m.t) {
    case "pong":
      rtt = Math.round(performance.now() - m.n);
      if (mode === "online" && running) {
        if (oppGone) setNet(`Opponent disconnected · ${rtt} ms`, "warn");
        else setNet(`${rtt} ms`, rtt > 250 ? "warn" : "");
      }
      return;
    case "queued":
      return showWait("queue");
    case "room":
      return showWait("friend", m.code);
    case "start": {
      waitingFor = null;
      mode = "online";
      me = m.you;
      session = { code: m.code, token: m.token };
      try { sessionStorage.setItem(`lb:${m.code}`, m.token); } catch {}
      history.replaceState(null, "", `?room=${m.code}`);
      serverEnd = null;
      oppGone = false;
      resetView();
      frames = [];
      rebuild(m.seed, m.log, m.tick);
      running = game.phase !== "over";
      $("botName").textContent = "Rival";
      $("botName").title = "";
      $("countdown").hidden = m.tick > 0;
      $("countdown").textContent = "Get ready";
      setNet(m.tick > 0 ? "Reconnected" : "Connected");
      show(null);
      resize();
      renderHand();
      renderScore();
      return;
    }
    case "f": {
      const inputs = (m.i ?? []).map(([player, card, x, y]) => ({ tick: m.k, player, card, x, y }));
      frames.push({ k: m.k, inputs });
      return;
    }
    case "rej":
      sentMarks = [];
      return toast(m.reason === "not enough elixir" ? "Not enough elixir" : m.reason === "match hasn't started" ? "Wait for the start" : "Can't deploy there");
    case "opp":
      oppGone = m.status === "disconnected";
      if (oppGone) {
        setNet("Opponent disconnected", "warn");
        toast("Opponent disconnected. They have 20s to return.");
      } else {
        setNet("Opponent is back");
      }
      return;
    case "sync":
      rebuild(m.seed, m.log, m.tick);
      return;
    case "end":
      serverEnd = m;
      if (session) try { sessionStorage.removeItem(`lb:${session.code}`); } catch {}
      net.close();
      if (mode !== "online") return backToMenu("That match has already ended");
      if (m.reason === "forfeit") {
        running = false;
        game.winner = m.winner;
        finishLocal();
        $("verify").innerHTML = m.winner === me ? "<b>Opponent left the match</b>" : "You were disconnected too long";
      } else if (game.phase === "over") {
        finishLocal(m.hash);
      }
      // otherwise the final frames are still queued; applyFrame finishes the match
      return;
    case "err":
      if (waitingFor || mode !== "online") return backToMenu(m.msg);
      if (!running) return backToMenu(m.msg);
      toast(m.msg);
      return;
  }
}

function applyFrame(f: Frame) {
  if (f.k < game.tick) return; // already applied (e.g. after a sync)
  if (f.k > game.tick) {
    console.warn(`frame gap: have ${game.tick}, got ${f.k}`);
    return; // the server's hash check will resync us
  }
  $("countdown").hidden = true;
  snapshotPositions();
  step(game, f.inputs);
  inputLog.push(...f.inputs);
  handleEvents(performance.now());
  if (game.tick % 100 === 0) net.send({ t: "hash", tick: game.tick, h: hashState(game) });
  if (game.phase === "over") {
    running = false;
    // wait for the server's "end" (usually already in flight) to show both verifications
    if (serverEnd) finishLocal(serverEnd.hash);
    else window.setTimeout(() => !serverEnd && finishLocal(), 1500);
  }
}

function showWait(kind: "queue" | "friend", code?: string) {
  waitingFor = kind;
  mode = "menu";
  $("waitLabel").textContent = kind === "queue" ? "Find match" : "Play a friend";
  $("waitTitle").innerHTML = kind === "queue"
    ? `Looking for an opponent<span class="dots"></span>`
    : `Waiting for your friend<span class="dots"></span>`;
  $("invite").hidden = kind !== "friend";
  if (code) {
    $("roomCode").textContent = code;
    $<HTMLInputElement>("roomLink").value = `${location.origin}${location.pathname}?room=${code}`;
  }
  show("waitScreen");
}

function backToMenu(msg?: string) {
  net.close();
  waitingFor = null;
  session = null;
  running = false;
  mode = "menu";
  $("net").hidden = true;
  $("countdown").hidden = true;
  history.replaceState(null, "", location.pathname);
  show("startScreen");
  if (msg) toast(msg);
}

function findMatch() {
  showWait("queue");
  net.open(() => net.send({ t: "queue" }));
}
function playFriend() {
  showWait("friend");
  $("waitTitle").innerHTML = `Creating room<span class="dots"></span>`;
  $("invite").hidden = true;
  net.open(() => net.send({ t: "create" }));
}
function joinCode(code: string) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return toast("Codes are 5 letters/numbers");
  let token: string | null = null;
  try { token = sessionStorage.getItem(`lb:${code}`); } catch {}
  showWait("queue");
  $("waitLabel").textContent = "Joining";
  $("waitTitle").innerHTML = `Joining ${code}<span class="dots"></span>`;
  // a stored token means this tab was already in that match (page refresh): rejoin it
  net.open(() => net.send(token ? { t: "rejoin", code, token } : { t: "join", code }));
}

// ------------------------------------------------------------------ main loop
function frame(t: number) {
  const dt = Math.min(250, t - lastT);
  lastT = t;
  if (running && mode === "bot") {
    acc += dt;
    while (acc >= TICK_MS && running) {
      botTick();
      acc -= TICK_MS;
    }
  } else if (running && mode === "online") {
    acc += dt;
    // play frames at 20/s; if a backlog builds up (lag spike), catch up quickly
    while (frames.length && running && (acc >= TICK_MS || frames.length > 3)) {
      applyFrame(frames.shift()!);
      acc = Math.max(0, acc - TICK_MS);
    }
    if (!frames.length) acc = Math.min(acc, TICK_MS); // starved: don't bank time
  }
  if (running) {
    renderHand();
    renderScore();
  }
  draw(running ? Math.min(1, acc / TICK_MS) : 1, t);
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  lastT = performance.now();
});

// ------------------------------------------------------------------ drawing
function draw(alpha: number, now: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawField();
  if (selected) drawZones();
  const pos = (e: Entity) => {
    const p = prevPos.get(e.id);
    if (!p || e.kind === "tower" || e.kind === "building") return { x: e.x, y: e.y };
    return { x: p.x + (e.x - p.x) * alpha, y: p.y + (e.y - p.y) * alpha };
  };
  const ents = game.entities;
  for (const e of ents) if (e.kind === "tower") drawTower(e);
  for (const e of ents) if (e.kind === "building") drawUnit(e, pos(e));
  for (const e of ents) if (e.kind === "troop" && !e.flying) drawUnit(e, pos(e));
  for (const e of ents) if (e.kind === "troop" && e.flying) drawUnit(e, pos(e));
  for (const e of ents) if (e.kind === "spell") drawPendingSpell(e);
  drawMarks(now);
  drawFx(now);
  if (selected && ghost) drawGhost();
}

function drawField() {
  for (let ty = 0; ty < ARENA_H / 1000; ty++) {
    for (let tx = 0; tx < ARENA_W / 1000; tx++) {
      ctx.fillStyle = (tx + ty) % 2 ? COL.fieldA : COL.fieldB;
      rectW(tx * 1000, ty * 1000, tx * 1000 + 1000.5, ty * 1000 + 1000.5);
    }
  }
  ctx.fillStyle = COL.river;
  rectW(0, RIVER_TOP, ARENA_W, RIVER_BOTTOM);
  ctx.strokeStyle = "rgba(255,255,255,.12)";
  ctx.lineWidth = Math.max(1, sl(60));
  for (let x = 400; x < ARENA_W; x += 1600) {
    ctx.beginPath();
    ctx.moveTo(sx(x), sy(15800));
    ctx.quadraticCurveTo(sx(x + 400), sy(15500), sx(x + 800), sy(15800));
    ctx.stroke();
  }
  for (const bx of BRIDGES) {
    ctx.fillStyle = COL.bridge;
    rectW(bx - BRIDGE_HALF, RIVER_TOP - 200, bx + BRIDGE_HALF, RIVER_BOTTOM + 200);
    ctx.fillStyle = "rgba(0,0,0,.18)";
    for (let y = RIVER_TOP; y < RIVER_BOTTOM; y += 400) rectW(bx - BRIDGE_HALF, y, bx + BRIDGE_HALF, y + 40);
  }
}

function drawZones() {
  const def = CARDS[selected!];
  if (def.kind === "spell") return;
  ctx.fillStyle = "rgba(229, 83, 61, .28)";
  for (let y = 500; y < ARENA_H; y += 1000) {
    for (let x = 500; x < ARENA_W; x += 1000) {
      if (!canDeployAt(game, me, def.kind, x, y)) rectW(x - 500, y - 500, x + 500.5, y + 500.5);
    }
  }
}

/** HP bar in screen space. */
function hpBar(cx: number, top: number, w: number, frac: number, col: string) {
  const h = Math.max(3, sl(220));
  ctx.fillStyle = "rgba(20,26,36,.75)";
  ctx.fillRect(cx - w / 2, top, w, h);
  ctx.fillStyle = col;
  ctx.fillRect(cx - w / 2, top, w * Math.max(0, frac), h);
}

function drawTower(e: Entity) {
  const r = sl(e.radius);
  const col = teamCol(e.owner);
  const x = sx(e.x);
  const y = sy(e.y);
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.fillRect(x - r + sl(150), y - r + sl(220), r * 2, r * 2);
  ctx.fillStyle = "#c9cbd1";
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.fillStyle = "#a9adb7";
  const b = r * 0.18;
  for (let i = 0; i < 4; i++) ctx.fillRect(x - r + (i * (r * 2 - b)) / 3, y - r - b * 0.6, b, b * 0.6);
  ctx.fillStyle = e.active ? col : "#6b7180";
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  if (e.card === "king") {
    ctx.fillStyle = e.active ? COL.gold : "#9aa0ad";
    const cw = r * 0.6;
    const ch = r * 0.36;
    ctx.beginPath();
    ctx.moveTo(x - cw / 2, y + ch / 2);
    ctx.lineTo(x - cw / 2, y - ch / 2);
    ctx.lineTo(x - cw / 4, y);
    ctx.lineTo(x, y - ch / 2 - ch * 0.3);
    ctx.lineTo(x + cw / 4, y);
    ctx.lineTo(x + cw / 2, y - ch / 2);
    ctx.lineTo(x + cw / 2, y + ch / 2);
    ctx.closePath();
    ctx.fill();
  }
  // my towers: bar below; enemy towers: bar above (on screen)
  const barTop = e.owner === me ? y + r + sl(150) : y - r - sl(450);
  hpBar(x, barTop, r * 2, e.hp / e.maxHp, col);
  const fs = Math.max(9, sl(520));
  const py = y + r - fs * 0.75;
  ctx.font = `700 ${fs}px ${FONT_NUM}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(String(e.hp)).width + fs * 0.6;
  ctx.fillStyle = "rgba(20,26,36,.82)";
  ctx.fillRect(x - tw / 2, py - fs * 0.6, tw, fs * 1.2);
  ctx.fillStyle = COL.text;
  ctx.fillText(String(e.hp), x, py + 1);
}

function drawUnit(e: Entity, p: { x: number; y: number }) {
  const col = teamCol(e.owner);
  const def = CARDS[e.card];
  const r = sl(e.radius);
  const x = sx(p.x);
  let y = sy(p.y);
  const deploying = e.deployTicks > 0;
  ctx.globalAlpha = deploying ? 0.55 : 1;
  if (e.flying) {
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + sl(500), r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    y -= sl(700);
  }
  if (e.kind === "building") {
    ctx.fillStyle = "#3a3f4a";
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = col;
    ctx.fillRect(x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4);
  } else {
    ctx.fillStyle = "rgba(20,26,36,.8)";
    ctx.beginPath();
    ctx.arc(x, y, r + Math.max(1.5, sl(70)), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (e.radius >= 400 && def) {
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.max(8, r * 0.85)}px ${FONT_NUM}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.short, x, y + 1);
  }
  ctx.globalAlpha = 1;
  if (deploying) {
    ctx.strokeStyle = COL.text;
    ctx.lineWidth = Math.max(1.5, sl(80));
    ctx.beginPath();
    ctx.arc(x, y, r + sl(220), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - e.deployTicks / 20));
    ctx.stroke();
  } else if (e.hp < e.maxHp) {
    const w = sl(Math.max(700, e.radius * 1.6));
    hpBar(x, y - r - sl(380), w, e.hp / e.maxHp, col);
  }
}

function drawPendingSpell(e: Entity) {
  ctx.strokeStyle = e.owner === me ? COL.gold : COL.red;
  ctx.setLineDash([sl(300), sl(250)]);
  ctx.lineWidth = Math.max(1.5, sl(90));
  ctx.beginPath();
  ctx.arc(sx(e.x), sy(e.y), sl(e.spellRadius), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Online: show my deploy immediately as a faint marker until the server confirms it. */
function drawMarks(now: number) {
  sentMarks = sentMarks.filter((m) => now - m.t < 1500);
  for (const m of sentMarks) {
    const def = CARDS[m.card];
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = COL.blue;
    ctx.lineWidth = Math.max(1.5, sl(100));
    ctx.setLineDash([sl(200), sl(200)]);
    ctx.beginPath();
    ctx.arc(sx(m.x), sy(m.y), sl(def.kind === "spell" ? def.spellRadius! : (def.radius ?? 500)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

function drawFx(now: number) {
  fx = fx.filter((f) => now - f.t < 600);
  for (const f of fx) {
    const age = (now - f.t) / 1000;
    const ev = f.ev;
    if (ev.type === "attack") {
      if (age > 0.15) continue;
      const a = 1 - age / 0.15;
      const ranged = (ev.x1 - ev.x2) ** 2 + (ev.y1 - ev.y2) ** 2 > 2000 * 2000;
      ctx.strokeStyle = ev.owner === me ? `rgba(160,200,255,${a})` : `rgba(255,190,170,${a})`;
      ctx.lineWidth = Math.max(1.5, sl(ranged ? 90 : 160));
      ctx.beginPath();
      if (ranged) {
        ctx.moveTo(sx(ev.x1), sy(ev.y1));
        ctx.lineTo(sx(ev.x2), sy(ev.y2));
      } else {
        ctx.arc(sx(ev.x2), sy(ev.y2), sl(400), 0, Math.PI * 2);
      }
      ctx.stroke();
      if (ev.splash) {
        ctx.fillStyle = `rgba(242,193,78,${a * 0.35})`;
        ctx.beginPath();
        ctx.arc(sx(ev.x2), sy(ev.y2), sl(ev.splash), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (ev.type === "spell") {
      const a = 1 - age / 0.6;
      ctx.fillStyle = `rgba(242,140,60,${a * 0.5})`;
      ctx.beginPath();
      ctx.arc(sx(ev.x), sy(ev.y), sl(ev.r) * (0.6 + age), 0, Math.PI * 2);
      ctx.fill();
    } else if (ev.type === "death") {
      const a = 1 - age / 0.6;
      ctx.strokeStyle = `rgba(233,237,244,${a * 0.7})`;
      ctx.lineWidth = Math.max(1, sl(80));
      ctx.beginPath();
      ctx.arc(sx(ev.x), sy(ev.y), sl(300 + age * (ev.kind === "tower" ? 4000 : 1200)), 0, Math.PI * 2);
      ctx.stroke();
    } else if (ev.type === "deploy") {
      if (age > 0.3) continue;
      ctx.strokeStyle = `rgba(255,255,255,${1 - age / 0.3})`;
      ctx.lineWidth = Math.max(1, sl(60));
      ctx.beginPath();
      ctx.arc(sx(ev.x), sy(ev.y), sl(400 + age * 3000), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawGhost() {
  const def = CARDS[selected!];
  const g = ghost!;
  const ok = canDeployAt(game, me, def.kind, g.x, g.y) && game.players[me].elixir >= def.cost * ELIXIR_UNIT;
  ctx.globalAlpha = 0.6;
  if (def.kind === "spell") {
    ctx.fillStyle = ok ? "rgba(242,193,78,.25)" : "rgba(229,83,61,.25)";
    ctx.strokeStyle = ok ? COL.gold : COL.red;
    ctx.lineWidth = Math.max(1.5, sl(80));
    ctx.beginPath();
    ctx.arc(sx(g.x), sy(g.y), sl(def.spellRadius!), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = ok ? COL.blue : COL.red;
    ctx.beginPath();
    ctx.arc(sx(g.x), sy(g.y), sl(def.radius ?? 500), 0, Math.PI * 2);
    ctx.fill();
    if (def.kind === "building" || (def.range ?? 0) > 2000) {
      ctx.strokeStyle = "rgba(255,255,255,.6)";
      ctx.setLineDash([sl(250), sl(250)]);
      ctx.lineWidth = Math.max(1, sl(60));
      ctx.beginPath();
      ctx.arc(sx(g.x), sy(g.y), sl(def.range!), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ menus
document.querySelectorAll<HTMLButtonElement>("[data-diff]").forEach((b) =>
  b.addEventListener("click", () => startBot(b.dataset.diff as Diff)),
);
$("findMatch").addEventListener("click", findMatch);
$("playFriend").addEventListener("click", playFriend);
$("joinForm").addEventListener("submit", (e) => {
  e.preventDefault();
  joinCode($<HTMLInputElement>("joinCode").value);
});
$("cancelWait").addEventListener("click", () => {
  net.send({ t: "leave" });
  backToMenu();
});
$("copyLink").addEventListener("click", () => {
  const input = $<HTMLInputElement>("roomLink");
  const done = () => toast("Link copied");
  navigator.clipboard?.writeText(input.value).then(done, () => {
    input.select();
    toast("Press Ctrl+C to copy");
  }) ?? (input.select(), toast("Press Ctrl+C to copy"));
});
$("rematch").addEventListener("click", () => {
  if (mode === "bot") return startBot(diff);
  session = null;
  history.replaceState(null, "", location.pathname);
  findMatch();
});
$("menu").addEventListener("click", () => backToMenu());

if (!__ONLINE__) {
  $("onlineGroup").hidden = true;
  $("diffNormal").classList.add("primary");
} else {
  const room = new URLSearchParams(location.search).get("room");
  if (room) joinCode(room);
}

resize();
renderHand();
renderScore();
requestAnimationFrame((t) => {
  lastT = t;
  frame(t);
});
