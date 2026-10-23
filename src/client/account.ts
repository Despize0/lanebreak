// Accounts on the client: sign in / sign up, the profile card, and the leaderboard screens.

import { tierFor, TIERS, type PublicUser } from "../net/tiers";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let token: string | null = null;
try {
  token = localStorage.getItem("lb:token");
} catch {}
let user: PublicUser | null = null;
const listeners: (() => void)[] = [];

export const getToken = () => token;
export const getUser = () => user;
export function onAccountChange(fn: () => void) {
  listeners.push(fn);
}
function changed() {
  renderProfile();
  for (const fn of listeners) fn();
}
export function setUser(u: PublicUser | null) {
  user = u;
  changed();
}
function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem("lb:token", t);
    else localStorage.removeItem("lb:token");
  } catch {}
}

async function api(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as any) } });
  let body: any = {};
  try {
    body = await r.json();
  } catch {}
  return { ok: r.ok, status: r.status, body };
}

export async function refreshMe() {
  if (!token) return setUser(null);
  try {
    const r = await api("/api/me");
    if (r.ok) setUser(r.body.user);
    else if (r.status === 401) {
      setToken(null);
      setUser(null);
    }
  } catch {
    // offline: keep whatever we had
  }
}

export const tierColor = (name: string | null | undefined) => TIERS.find((t) => t.name === name)?.color ?? "#9aa3c7";

function renderProfile() {
  const card = $("profileCard");
  const btn = $("signInBtn");
  if (!user) {
    card.hidden = true;
    btn.hidden = false;
    return;
  }
  card.hidden = false;
  btn.hidden = true;
  $("profName").textContent = user.name;
  const badge = $("profBadge");
  badge.style.setProperty("--tier", tierColor(user.placed ? user.tier : null));
  badge.textContent = user.placed ? user.tier.slice(0, 2) : "?";
  const rec = `${user.wins}W ${user.losses}L`;
  $("profLine").textContent = user.placed
    ? `${user.tier} · ${user.rating}${user.rank ? ` · #${user.rank}` : ""} · ${rec}`
    : `Placement ${user.games}/5 · ${rec}`;
}

// ------------------------------------------------------------------ auth screen
let authMode: "login" | "register" = "login";
let afterAuth: (() => void) | null = null;
let showScreen: (id: string | null) => void = () => {};

export function initAccount(show: (id: string | null) => void) {
  showScreen = show;
  $("signInBtn").addEventListener("click", () => openAuth("login"));
  $("signOut").addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST", body: "{}" });
    } catch {}
    setToken(null);
    setUser(null);
  });
  $("tabLogin").addEventListener("click", () => setAuthMode("login"));
  $("tabRegister").addEventListener("click", () => setAuthMode("register"));
  $("authBack").addEventListener("click", () => {
    afterAuth = null;
    showScreen("startScreen");
  });
  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $<HTMLInputElement>("authUser").value.trim();
    const password = $<HTMLInputElement>("authPass").value;
    const err = $("authError");
    if (authMode === "register") {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return void (err.textContent = "Usernames are 3–16 letters, numbers or _");
      if (password.length < 8) return void (err.textContent = "Passwords need at least 8 characters");
    }
    const submit = $<HTMLButtonElement>("authSubmit");
    submit.disabled = true;
    err.textContent = "";
    try {
      const r = await api(authMode === "login" ? "/api/login" : "/api/register", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) {
        err.textContent = r.body.error ?? "Something went wrong. Try again.";
        return;
      }
      setToken(r.body.token);
      setUser(r.body.user);
      $<HTMLInputElement>("authPass").value = "";
      const next = afterAuth;
      afterAuth = null;
      showScreen("startScreen");
      next?.();
    } catch {
      err.textContent = "Can't reach the server. Check your connection.";
    } finally {
      submit.disabled = false;
    }
  });
  $("boardBtn").addEventListener("click", () => openBoard());
  $("boardBack").addEventListener("click", () => showScreen("startScreen"));
  $("tabTop").addEventListener("click", () => loadBoard("top"));
  $("tabMine").addEventListener("click", () => loadBoard("mine"));
  renderProfile();
}

function setAuthMode(m: "login" | "register") {
  authMode = m;
  $("tabLogin").setAttribute("aria-selected", String(m === "login"));
  $("tabRegister").setAttribute("aria-selected", String(m === "register"));
  $("authTitle").textContent = m === "login" ? "Sign in" : "Create account";
  $("authSubmit").textContent = m === "login" ? "Sign in" : "Create account";
  $<HTMLInputElement>("authPass").autocomplete = m === "login" ? "current-password" : "new-password";
  $("authError").textContent = "";
}

export function openAuth(mode: "login" | "register", then?: () => void, note?: string) {
  afterAuth = then ?? null;
  setAuthMode(mode);
  if (note) $("authError").textContent = note;
  showScreen("authScreen");
  setTimeout(() => $<HTMLInputElement>("authUser").focus(), 50);
}

// ------------------------------------------------------------------ leaderboard
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function openBoard() {
  showScreen("boardScreen");
  void loadBoard("top");
}

async function loadBoard(tab: "top" | "mine") {
  $("tabTop").setAttribute("aria-selected", String(tab === "top"));
  $("tabMine").setAttribute("aria-selected", String(tab === "mine"));
  const list = $("boardList");
  const note = $("boardNote");
  list.innerHTML = `<div class="empty">Loading…</div>`;
  note.textContent = "";
  try {
    if (tab === "top") {
      const r = await api("/api/leaderboard");
      if (!r.ok) throw new Error();
      const players: PublicUser[] = r.body.players;
      list.innerHTML = players.length
        ? players.map((p) => `
          <div class="lrow${user && p.id === user.id ? " me" : ""}">
            <span class="rk">${p.rank}</span>
            <span class="nm">${esc(p.name)}</span>
            <span class="pill" style="--tier:${tierColor(p.tier)}">${esc(p.tier)}</span>
            <span>${p.rating}</span>
          </div>`).join("")
        : `<div class="empty">No ranked players yet. Play ${r.body.placementGames} ranked matches to appear here.</div>`;
      const you: PublicUser | null = r.body.you;
      note.textContent = you
        ? you.placed ? `You: #${you.rank} · ${you.tier} ${you.rating}` : `You: placement ${you.games}/${r.body.placementGames}`
        : "Sign in and play ranked to get on the board.";
    } else {
      if (!user) {
        list.innerHTML = `<div class="empty">Sign in to see your match history.</div>`;
        return;
      }
      const r = await api(`/api/players/${encodeURIComponent(user.name)}`);
      if (!r.ok) throw new Error();
      const recent: any[] = r.body.recent;
      list.innerHTML = recent.length
        ? recent.map((m) => {
            const delta = m.rating ? m.rating[1] - m.rating[0] : null;
            const d = delta === null ? (m.ranked ? "" : "casual") : `${delta >= 0 ? "+" : ""}${delta}`;
            return `
          <div class="lrow">
            <span class="rk res-${m.result}">${m.result === "win" ? "W" : m.result === "loss" ? "L" : "D"}</span>
            <span class="nm">vs ${esc(m.opponent)}</span>
            <span class="wl">${m.crowns[0]}–${m.crowns[1]}${m.reason === "forfeit" ? " (left)" : ""}</span>
            <span class="${delta === null ? "wl" : delta >= 0 ? "res-win" : "res-loss"}">${d}</span>
          </div>`;
          }).join("")
        : `<div class="empty">No matches yet. Your games show up here.</div>`;
      note.textContent = `${user.wins}W ${user.losses}L ${user.draws}D`;
    }
  } catch {
    list.innerHTML = `<div class="empty">Couldn't load. Check your connection and try again.</div>`;
  }
}

export { tierFor };
