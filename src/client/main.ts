// Browser client.
//  - Practice: runs the sim locally with a bot as player 1.
//  - Online (casual, ranked, friends): the server runs the real match; this client replays the
//    server's frames through the same deterministic sim and only ever sends "play card X at (x,y)".

import { Bot } from "../ai/bot";
import { CARDS, DEFAULT_DECK } from "../sim/cards";
import {
  DOUBLE_ELIXIR_AT, ELIXIR_UNIT, OVERTIME_TICKS, REGULATION_TICKS, TICK_RATE, canDeployAt, createGame, hashState, replay, step,
  type GameState, type Input, type PlayerId,
} from "../sim/sim";
import type { ClientMsg, LogEntry, ServerMsg } from "../net/protocol";
import type { PlayerInfo } from "../net/tiers";
import { draw, observe, resetFx, resize, setPerspective, toWorld, type Mark } from "./render";
import { PORTRAITS, setPortrait } from "./portraits";
import { isMuted, setMuted, sfx, unlockAudio } from "./audio";
import { getToken, getUser, initAccount, onAccountChange, openAuth, refreshMe, setUser, tierColor } from "./account";
import { getDeck, getSkin, initDeck } from "./deck";
import { KING_ART, TOWER_SKINS } from "./towerSkins";

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
const stage = $("stage");
const handEl = $("hand");

const screens = ["startScreen", "friendScreen", "practiceScreen", "authScreen", "boardScreen", "deckScreen", "waitScreen", "endScreen"];
function show(id: string | null) {
  for (const s of screens) $(s).hidden = s !== id;
  // menus are their own full screen: no scoreboard or card tray behind them
  $("app").classList.toggle("in-menu", id !== null && id !== "endScreen");
}

// ------------------------------------------------------------------ state
type Mode = "menu" | "bot" | "online";
let mode: Mode = "menu";
let me: PlayerId = 0;
let game: GameState = createGame(1);
let bot: Bot | null = null;
let seed = 0;
let decks: [string[], string[]] = [DEFAULT_DECK, DEFAULT_DECK];
let diff: Diff = "normal";
let running = false;
let ranked = false;
let skins: [string, string] = ["classic", "classic"];
let players: [PlayerInfo, PlayerInfo] | null = null;
let acc = 0;
let lastT = 0;
let inputLog: Input[] = [];
let pending: Input[] = []; // practice mode: my inputs waiting for the next tick
let selected: string | null = null;
let ghost: { x: number; y: number } | null = null;
let dragging = false;
const prevPos = new Map<number, { x: number; y: number }>();
let sentMarks: Mark[] = []; // online: deploys sent but not yet confirmed by the server
const opp = (): PlayerId => (me === 0 ? 1 : 0);

new ResizeObserver(() => resize(stage)).observe(stage);

// ------------------------------------------------------------------ hand UI
const cardButtons: HTMLButtonElement[] = [];
const shownArt: string[] = ["", "", "", "", ""];
for (let i = 0; i < 4; i++) {
  const b = document.createElement("button");
  b.className = "card";
  b.id = `card${i}`;
  b.type = "button";
  b.innerHTML = `<span class="fill"></span><span class="cost"></span><span class="nm"></span>`;
  b.addEventListener("pointerdown", (e) => {
    unlockAudio();
    if (!running) return;
    const id = game.players[me].hand[i];
    selected = selected === id ? null : id;
    dragging = selected !== null;
    if (selected) sfx.select();
    e.preventDefault();
    renderHand();
  });
  handEl.appendChild(b);
  cardButtons.push(b);
}

function setArt(el: HTMLElement, slot: number, card: string) {
  if (shownArt[slot] === card) return;
  shownArt[slot] = card;
  setPortrait(el, card);
}

function renderHand() {
  const p = game.players[me];
  const elixir = p.elixir / ELIXIR_UNIT;
  p.hand.forEach((id, i) => {
    const def = CARDS[id];
    const b = cardButtons[i];
    b.className = `card${elixir < def.cost ? " poor" : ""}${selected === id ? " sel" : ""}`;
    b.setAttribute("aria-label", `${def.name}, ${def.cost} aether. ${def.description}`);
    b.title = def.description;
    setArt(b, i, id);
    (b.querySelector(".cost") as HTMLElement).textContent = String(def.cost);
    (b.querySelector(".nm") as HTMLElement).textContent = def.name;
    (b.querySelector(".fill") as HTMLElement).style.height = `${Math.min(100, (elixir / def.cost) * 100)}%`;
  });
  const next = CARDS[p.queue[0]];
  setArt($("nextCard"), 4, next.id);
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
  $("clockLabel").textContent = ot ? "SUDDEN DEATH" : t >= DOUBLE_ELIXIR_AT ? "2× AETHER" : ranked ? "RANKED" : "REGULATION";
}

const sub = (p: PlayerInfo) => (p.rating === null ? "" : p.placed ? `${p.tier} ${p.rating}` : "Placement");
function renderNames() {
  if (mode === "online" && players) {
    const mine = players[me];
    const theirs = players[opp()];
    $("meName").textContent = mine.name;
    $("meSub").textContent = sub(mine);
    $("oppName").textContent = theirs.name;
    $("oppSub").textContent = sub(theirs);
  } else {
    $("meName").textContent = getUser()?.name ?? "You";
    $("meSub").textContent = "";
    $("oppName").textContent = mode === "bot" ? "Bot" : "Rival";
    $("oppSub").textContent = mode === "bot" ? DIFF[diff].label : "";
  }
}

let toastTimer = 0;
function toast(msg: string) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 1600);
}

function showMatchup(ms: number) {
  if (!players) return;
  const mine = players[me];
  const theirs = players[opp()];
  $("vsMe").textContent = mine.name;
  $("vsMeSub").textContent = sub(mine);
  $("vsThem").textContent = theirs.name;
  $("vsThemSub").textContent = sub(theirs) || (ranked ? "" : "Casual");
  $("matchup").hidden = false;
  window.setTimeout(() => ($("matchup").hidden = true), ms);
}

// ------------------------------------------------------------------ deploy input
function tryDeploy(clientX: number, clientY: number) {
  if (!selected || !running) return;
  const w = toWorld(clientX, clientY);
  if (!w) return;
  const def = CARDS[selected];
  if (game.players[me].elixir < def.cost * ELIXIR_UNIT) {
    sfx.error();
    return toast(`Need ${def.cost} aether`);
  }
  if (!canDeployAt(game, me, def.kind, w.x, w.y)) {
    sfx.error();
    return toast("Deploy on your island");
  }
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
  unlockAudio();
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
  sentMarks = [];
  prevPos.clear();
  selected = null;
  acc = 0;
  lastT = performance.now();
  resetFx(game);
}

function afterStep() {
  const now = performance.now();
  observe(game, now);
  for (const ev of game.events) {
    if (ev.type === "reject" && ev.player === me && mode === "bot") {
      toast(ev.reason === "not enough elixir" ? "Not enough aether" : "Can't deploy there");
    }
    if (ev.type === "deploy" && ev.owner === me && sentMarks.length) {
      const i = sentMarks.findIndex((m) => m.card === ev.card && m.x === ev.x && m.y === ev.y);
      if (i >= 0) sentMarks.splice(i, 1);
    }
  }
}

function snapshotPositions() {
  prevPos.clear();
  for (const e of game.entities) prevPos.set(e.id, { x: e.x, y: e.y });
}

const hex = (h: number) => h.toString(16).padStart(8, "0");

function finishLocal(serverEnd?: Extract<ServerMsg, { t: "end" }>) {
  running = false;
  selected = null;
  const w = game.winner;
  const won = w === me;
  const title = $("endTitle");
  title.textContent = won ? "Victory!" : w === -1 ? "Draw" : "Defeat";
  title.className = `result ${won ? "win" : w === -1 ? "" : "loss"}`;
  $("endLabel").textContent = mode === "online" ? (ranked ? "Ranked match" : "Casual match") : `Practice · ${DIFF[diff].label} bot`;
  $("endScore").textContent = `${game.players[me].crowns} – ${game.players[opp()].crowns} crowns · ${Math.round(game.tick / TICK_RATE)}s`;
  // rating change
  const deltaEl = $("endDelta");
  deltaEl.hidden = true;
  if (serverEnd?.ratings) {
    const [before, after] = serverEnd.ratings[me];
    const d = after - before;
    const mine = players?.[me];
    deltaEl.hidden = false;
    deltaEl.innerHTML = `${after} <span class="${d >= 0 ? "up" : "down"}">(${d >= 0 ? "+" : ""}${d})</span>` +
      (mine && !mine.placed ? `<br><span style="font-size:14px;font-family:var(--font-ui);color:var(--muted)">Placement match: ratings move fast at first</span>` : "");
  }
  // Re-simulate from seed + inputs and compare: proves the result is reproducible.
  const live = hashState(game);
  const ok = game.phase === "over" && hashState(replay(seed, inputLog, decks).state) === live;
  let html = ok ? `<b>Replay verified</b> · ${inputLog.length} inputs · hash ${hex(live)}` : "";
  if (serverEnd && game.phase === "over") {
    html += serverEnd.hash === live ? `<br><b>Matches server result</b>` : `<br>Server hash ${hex(serverEnd.hash)} differs`;
  }
  $("verify").innerHTML = html;
  $("matchup").hidden = true;
  show("endScreen");
  if (won) sfx.win();
  else if (w !== -1) sfx.lose();
  renderHand();
  renderScore();
}

// ------------------------------------------------------------------ practice vs bot
/** Dev-only (?dev in the URL, practice mode only): stage exact matchups for checking animations. */
const devHook = typeof location !== "undefined" && location.search.includes("dev")
  ? {
      noBot: false,
      spawn(player: 0 | 1, card: string, x: number, y: number) {
        game.players[player].elixir = 560;
        game.players[player].hand[0] = card;
        pending.push({ tick: -1, player, card, x, y });
      },
    }
  : null;
if (devHook) (window as unknown as { __lb: typeof devHook }).__lb = devHook;

function startBot(d: Diff) {
  unlockAudio();
  net.close();
  mode = "bot";
  ranked = false;
  diff = d;
  me = 0;
  setPerspective(0);
  seed = (Math.random() * 0xffffffff) >>> 0; // fine for local play; the server picks seeds online
  decks = [getDeck(), botDeck(seed)];
  skins = [getSkin(), TOWER_SKINS[seed % TOWER_SKINS.length]];
  game = createGame(seed, decks);
  bot = new Bot(1, { seed: seed ^ 0x5eed, ...DIFF[d] });
  resetView();
  running = true;
  $("net").hidden = true;
  show(null);
  renderNames();
  renderHand();
  renderScore();
  sfx.start();
}

/** The practice bot plays one of a few themed decks. */
const BOT_DECKS = [
  DEFAULT_DECK,
  ["colossus", "twinrangers", "zap", "warden", "bombardier", "wisps", "cannon", "ember"],
  ["skyrider", "zap", "swarmlings", "ranger", "cannon", "skywing", "warden", "ember"],
  ["ironhide", "sparkcaster", "wisps", "brute", "zap", "bulwark", "twinrangers", "bombardier"],
];
function botDeck(s: number): string[] {
  return [...BOT_DECKS[s % BOT_DECKS.length]];
}

function botTick() {
  const inputs: Input[] = pending.map((p) => ({ ...p, tick: game.tick }));
  pending = [];
  const b = devHook?.noBot ? null : bot!.decide(game);
  if (b) inputs.push(b);
  inputLog.push(...inputs);
  snapshotPositions();
  step(game, inputs);
  afterStep();
  if (game.phase === "over") finishLocal();
}

// ------------------------------------------------------------------ online
interface Frame { k: number; inputs: Input[] }
let frames: Frame[] = [];
let session: { code: string; token: string } | null = null;
let serverEnd: Extract<ServerMsg, { t: "end" }> | null = null;
let waitingFor: "casual" | "ranked" | "friend" | "join" | null = null;
let rtt = 0;
let oppGone = false;
let started = false;

const net = {
  ws: null as WebSocket | null,
  wantOpen: false,
  ready: false, // open and (if signed in) authenticated
  retry: 0,
  pingTimer: 0,
  queued: [] as (() => void)[],
  open(then: () => void) {
    this.wantOpen = true;
    if (this.ws && this.ready) return then();
    this.queued.push(then);
    if (this.ws) return;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    this.ws = ws;
    this.ready = false;
    ws.onopen = () => {
      this.retry = 0;
      const tk = getToken();
      if (tk) ws.send(JSON.stringify({ t: "auth", token: tk } satisfies ClientMsg));
      else this.markReady();
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
      this.ready = false;
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
  markReady() {
    this.ready = true;
    const q = this.queued;
    this.queued = [];
    for (const f of q) f();
  },
  send(m: ClientMsg): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  },
  close() {
    this.wantOpen = false;
    this.queued = [];
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    ws?.close();
  },
};

function setNet(text: string, level: "" | "warn" | "bad" = "") {
  const el = $("net");
  el.hidden = mode !== "online";
  el.textContent = text;
  el.className = `net ${level}`;
}

function rebuild(newSeed: number, log: LogEntry[], tick: number, d: [string[], string[]]) {
  seed = newSeed;
  decks = d;
  game = createGame(seed, decks);
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
  resetFx(game);
}

function onServer(m: ServerMsg) {
  switch (m.t) {
    case "me":
      setUser(m.user);
      if (!net.ready) net.markReady();
      return;
    case "pong":
      rtt = Math.round(performance.now() - m.n);
      if (mode === "online" && running) {
        if (oppGone) setNet(`Rival disconnected · ${rtt} ms`, "warn");
        else setNet(`${rtt} ms`, rtt > 250 ? "warn" : "");
      }
      return;
    case "queued":
      return showWait(m.ranked ? "ranked" : "casual");
    case "room":
      return showWait("friend", m.code);
    case "start": {
      waitingFor = null;
      mode = "online";
      me = m.you;
      ranked = m.ranked;
      players = m.players;
      skins = [m.players[0].skin ?? "classic", m.players[1].skin ?? "classic"];
      setPerspective(me);
      session = { code: m.code, token: m.token };
      try { sessionStorage.setItem(`lb:${m.code}`, m.token); } catch {}
      history.replaceState(null, "", `?room=${m.code}`);
      serverEnd = null;
      oppGone = false;
      frames = [];
      rebuild(m.seed, m.log, m.tick, m.decks);
      resetView();
      inputLog = m.log.map(([t, player, card, x, y]) => ({ tick: t, player, card, x, y }));
      running = game.phase !== "over";
      started = m.tick > 0;
      setNet(m.tick > 0 ? "Reconnected" : "Connected");
      show(null);
      renderNames();
      if (m.tick === 0) showMatchup(2400);
      resize(stage);
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
      sfx.error();
      return toast(m.reason === "not enough elixir" ? "Not enough aether" : m.reason === "match hasn't started" ? "Wait for the start" : "Can't deploy there");
    case "opp":
      oppGone = m.status === "disconnected";
      if (oppGone) {
        setNet("Rival disconnected", "warn");
        toast("Rival disconnected. They have 20s to return.");
      } else setNet("Rival is back");
      return;
    case "sync":
      rebuild(m.seed, m.log, m.tick, m.decks);
      return;
    case "end":
      serverEnd = m;
      if (session) try { sessionStorage.removeItem(`lb:${session.code}`); } catch {}
      net.close();
      if (mode !== "online") return backToMenu("That match has already ended");
      if (m.reason === "forfeit") {
        running = false;
        game.winner = m.winner;
        finishLocal(m);
        $("verify").innerHTML = m.winner === me ? "<b>Your rival left the match</b>" : "You were disconnected too long";
      } else if (game.phase === "over") {
        finishLocal(m);
      }
      // otherwise the final frames are still queued; applyFrame finishes the match
      void refreshMe();
      return;
    case "err":
      if (waitingFor || mode !== "online" || !running) return backToMenu(m.msg);
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
  if (!started) {
    started = true;
    $("matchup").hidden = true;
    sfx.start();
  }
  snapshotPositions();
  step(game, f.inputs);
  inputLog.push(...f.inputs);
  afterStep();
  if (game.tick % 100 === 0) net.send({ t: "hash", tick: game.tick, h: hashState(game) });
  if (game.phase === "over") {
    running = false;
    if (serverEnd) finishLocal(serverEnd);
    else window.setTimeout(() => !serverEnd && finishLocal(), 1500);
  }
}

function showWait(kind: "casual" | "ranked" | "friend" | "join", code?: string) {
  waitingFor = kind;
  mode = "menu";
  const u = getUser();
  $("waitLabel").textContent = kind === "ranked" ? "Ranked" : kind === "casual" ? "Casual" : kind === "friend" ? "Play a friend" : "Joining";
  $("waitTitle").innerHTML = kind === "friend"
    ? `Waiting for your friend<span class="dots"></span>`
    : kind === "join" ? `Joining ${code ?? ""}<span class="dots"></span>` : `Looking for a rival<span class="dots"></span>`;
  $("waitNote").textContent = kind === "ranked" && u
    ? `Matching you with players near ${u.rating}. The range widens the longer you wait.`
    : kind === "casual" ? "No rating on the line. Anyone can join." : "";
  $("invite").hidden = kind !== "friend" || !code;
  if (code && kind === "friend") {
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
  players = null;
  $("net").hidden = true;
  $("matchup").hidden = true;
  history.replaceState(null, "", location.pathname);
  renderNames();
  show("startScreen");
  if (msg) toast(msg);
}

function queueMatch(isRanked: boolean) {
  unlockAudio();
  if (isRanked && !getUser()) {
    return openAuth("login", () => queueMatch(true), "Sign in to play ranked.");
  }
  showWait(isRanked ? "ranked" : "casual");
  net.open(() => net.send({ t: "queue", ranked: isRanked, deck: getDeck(), skin: getSkin() }));
}
function playFriend() {
  unlockAudio();
  showWait("friend");
  $("invite").hidden = true;
  net.open(() => net.send({ t: "create", deck: getDeck(), skin: getSkin() }));
}
function joinCode(code: string) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return toast("Codes are 5 letters or numbers");
  let token: string | null = null;
  try { token = sessionStorage.getItem(`lb:${code}`); } catch {}
  showWait("join", code);
  // a stored token means this tab was already in that match (page refresh): rejoin it
  net.open(() => net.send(token ? { t: "rejoin", code, token } : { t: "join", code, deck: getDeck(), skin: getSkin() }));
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
    while (frames.length && running && (acc >= TICK_MS || frames.length > 3)) {
      applyFrame(frames.shift()!);
      acc = Math.max(0, acc - TICK_MS);
    }
    if (!frames.length) acc = Math.min(acc, TICK_MS);
  }
  if (running || mode === "menu") {
    renderHand();
    renderScore();
  }
  sentMarks = sentMarks.filter((m) => t - m.t < 1500);
  draw(game, {
    me, alpha: running ? Math.min(1, acc / TICK_MS) : 1, prevPos, selected, ghost, marks: sentMarks, skins,
    canAfford: !!selected && game.players[me].elixir >= CARDS[selected].cost * ELIXIR_UNIT,
  }, t);
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  lastT = performance.now();
});

// ------------------------------------------------------------------ menus
const SPEAKER_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>`;
const SPEAKER_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>`;
function renderMute() {
  const b = $("muteBtn");
  b.innerHTML = isMuted() ? SPEAKER_OFF : SPEAKER_ON;
  b.setAttribute("aria-label", isMuted() ? "Sound off" : "Sound on");
}
$("muteBtn").addEventListener("click", () => {
  unlockAudio();
  setMuted(!isMuted());
  renderMute();
});
renderMute();

document.querySelectorAll<HTMLButtonElement>("[data-diff]").forEach((b) =>
  b.addEventListener("click", () => startBot(b.dataset.diff as Diff)),
);
$("rankedBtn").addEventListener("click", () => (__ONLINE__ ? queueMatch(true) : show("practiceScreen")));
$("friendBtn").addEventListener("click", () => show("friendScreen"));
$("practiceBtn").addEventListener("click", () => show("practiceScreen"));
$("friendBack").addEventListener("click", () => show("startScreen"));
$("practiceBack").addEventListener("click", () => show("startScreen"));
$("findMatch").addEventListener("click", () => queueMatch(false));
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
  const fallback = () => {
    input.select();
    toast("Press Ctrl+C to copy");
  };
  if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(() => toast("Link copied"), fallback);
  else fallback();
});
$("rematch").addEventListener("click", () => {
  if (mode === "bot") return startBot(diff);
  const wasRanked = ranked;
  session = null;
  players = null;
  history.replaceState(null, "", location.pathname);
  queueMatch(wasRanked);
});
$("menu").addEventListener("click", () => backToMenu());

initAccount(show);
initDeck(show, toast);
onAccountChange(() => {
  if (mode !== "online") renderNames();
  const u = getUser();
  $("rankedBtn").title = u ? "" : "Sign in to play ranked";
});

if (!__ONLINE__) {
  $("onlineGroup").hidden = true;
  $("signInBtn").hidden = true;
  $("boardBtn").hidden = true;
  $("rankedBtn").querySelector("small")!.textContent = "Practice vs bot";
  $("diffNormal").classList.add("primary");
} else {
  void refreshMe();
  const room = new URLSearchParams(location.search).get("room");
  if (room) joinCode(room);
}

// home screen art: the keep and a fan of cards
{
  const root = document.documentElement.style;
  root.setProperty("--art-king", `url(${KING_ART.blue})`);
  const fan = ["warden", "skywing", "colossus"];
  fan.forEach((id, i) => root.setProperty(`--art-${i + 1}`, `url(${PORTRAITS[id]})`));
  skins = ["warden", "ironhide"];
}

resize(stage);
renderNames();
renderHand();
renderScore();
requestAnimationFrame((t) => {
  lastT = t;
  frame(t);
});

export { tierColor };
