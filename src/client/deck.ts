// Deck builder: pick 8 of the 16 cards. Saved in this browser, and to the account when signed in.

import { CARD_LIST, CARDS, DEFAULT_DECK, DECK_SIZE, isValidDeck, type CardDef } from "../sim/cards";
import { PORTRAITS, cardType } from "./portraits";
import { TOWER_ART, TOWER_NAMES, TOWER_SKINS, type TowerSkin } from "./towerSkins";
import { DEFAULT_SKIN, isTowerSkin } from "../net/tiers";
import { getToken, getUser, onAccountChange } from "./account";
import { sfx } from "./audio";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY = "lb:deck";
const SKIN_KEY = "lb:skin";

let deck: string[] = load();
let draft: string[] = [];
let focus: string = CARD_LIST[0];
let show: (id: string | null) => void = () => {};
let toast: (m: string) => void = () => {};

function load(): string[] {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (isValidDeck(d)) return d;
  } catch {}
  return [...DEFAULT_DECK];
}

export const getDeck = () => [...deck];

let skin: TowerSkin = loadSkin();
let draftSkin: TowerSkin = skin;
function loadSkin(): TowerSkin {
  try {
    const v = localStorage.getItem(SKIN_KEY);
    if (isTowerSkin(v)) return v;
  } catch {}
  return DEFAULT_SKIN;
}
export const getSkin = () => skin;

function renderSkins() {
  $("skinRow").innerHTML = TOWER_SKINS.map((k) => {
    const art = TOWER_ART[k];
    return `<button type="button" class="skin${draftSkin === k ? " on" : ""}" data-skin="${k}" aria-pressed="${draftSkin === k}" title="${TOWER_NAMES[k]}">
      ${art ? `<img src="${art}" alt="">` : ""}<span>${TOWER_NAMES[k]}</span></button>`;
  }).join("");
}

async function persist(d: string[]) {
  deck = [...d];
  try {
    localStorage.setItem(KEY, JSON.stringify(deck));
  } catch {}
  const token = getToken();
  if (!token) return;
  try {
    await fetch("/api/deck", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ deck }),
    });
  } catch {
    // offline: it's saved locally and goes with every match request anyway
  }
}

const avg = (d: string[]) => (d.length ? d.reduce((n, c) => n + CARDS[c].cost, 0) / d.length : 0);

function role(d: CardDef): string {
  if (d.kind === "spell") return "Spell";
  if (d.kind === "building") return "Building";
  if (d.targets === "buildings") return "Tank · targets buildings";
  if (d.flying) return (d.count ?? 1) > 1 ? "Air swarm" : "Air troop";
  if ((d.count ?? 1) > 2) return "Swarm";
  if ((d.range ?? 0) >= 3500) return (d.splash ?? 0) > 0 ? "Ranged · splash" : "Ranged";
  return "Melee";
}

function stats(d: CardDef): string {
  const parts: string[] = [];
  if (d.kind === "spell") {
    parts.push(`Damage ${d.damage}`, `Radius ${((d.spellRadius ?? 0) / 1000).toFixed(1)}`, `Towers take ${d.towerPct ?? 100}%`);
  } else {
    parts.push(`HP ${d.hp}${(d.count ?? 1) > 1 ? ` ×${d.count}` : ""}`);
    parts.push(`Hit ${d.damage} every ${((d.hitTicks ?? 20) / 20).toFixed(1)}s`);
    parts.push(`Range ${((d.range ?? 0) / 1000).toFixed(1)}`);
    parts.push(d.targets === "buildings" ? "Targets buildings" : d.targets === "ground" ? "Hits ground only" : "Hits ground + air");
    if (d.kind === "building") parts.push(`Lasts ${((d.lifetime ?? 0) / 20).toFixed(0)}s`);
  }
  return parts.join(" · ");
}

function cardTile(id: string, inDeck: boolean): string {
  const d = CARDS[id];
  return `<button type="button" class="dcard${inDeck ? " in" : ""}${focus === id ? " focus" : ""}" data-card="${id}" data-type="${cardType(id)}" style="--art:url('${PORTRAITS[id]}')" aria-pressed="${inDeck}" aria-label="${d.name}, ${d.cost} aether${inDeck ? ", in deck" : ""}">
    <span class="cost">${d.cost}</span><span class="nm">${d.name}</span>
  </button>`;
}

function render() {
  const slots = $("deckSlots");
  slots.innerHTML = Array.from({ length: DECK_SIZE }, (_, i) =>
    draft[i] ? cardTile(draft[i], true) : `<div class="dcard empty" data-slot="${i}" aria-hidden="true"><span class="nm">Empty</span></div>`,
  ).join("");
  $("deckPool").innerHTML = CARD_LIST.filter((c) => !draft.includes(c)).map((c) => cardTile(c, false)).join("");
  $("deckAvg").textContent = draft.length ? `Average cost ${avg(draft).toFixed(1)}` : "Pick 8 cards";
  $("deckCount").textContent = `${draft.length}/${DECK_SIZE}`;
  const save = $<HTMLButtonElement>("deckSave");
  save.disabled = draft.length !== DECK_SIZE;
  save.textContent = draft.length === DECK_SIZE ? "Save deck" : `Add ${DECK_SIZE - draft.length} more`;
  const d = CARDS[focus];
  $("deckInfoName").textContent = `${d.name}`;
  $("deckInfoRole").textContent = `${d.cost} aether · ${role(d)}`;
  $("deckInfoDesc").textContent = d.description;
  $("deckInfoStats").textContent = stats(d);
}

export function openDeck() {
  draftSkin = skin;
  renderSkins();
  draft = [...deck];
  focus = draft[0] ?? CARD_LIST[0];
  render();
  show("deckScreen");
}

export function initDeck(showScreen: (id: string | null) => void, showToast: (m: string) => void) {
  show = showScreen;
  toast = showToast;
  const onClick = (e: Event) => {
    if (dragJustEnded) return; // the click that ends a drag isn't a tap
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-card]");
    if (!btn) return;
    const id = btn.dataset.card!;
    focus = id;
    if (draft.includes(id)) draft = draft.filter((c) => c !== id);
    else if (draft.length >= DECK_SIZE) {
      render();
      return toast("Deck is full. Tap a card in your deck to remove it.");
    } else draft.push(id);
    sfx.select();
    render();
  };
  $("deckSlots").addEventListener("click", onClick);
  $("deckPool").addEventListener("click", onClick);
  initDrag();
  $("deckBtn").addEventListener("click", openDeck);
  $("deckBack").addEventListener("click", () => show("startScreen"));
  $("deckReset").addEventListener("click", () => {
    draft = [...DEFAULT_DECK];
    render();
  });
  $("skinRow").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-skin]");
    if (!b || !isTowerSkin(b.dataset.skin)) return;
    draftSkin = b.dataset.skin;
    sfx.select();
    renderSkins();
  });
  $("deckSave").addEventListener("click", async () => {
    if (!isValidDeck(draft)) return;
    skin = draftSkin;
    try {
      localStorage.setItem(SKIN_KEY, skin);
    } catch {}
    await persist(draft);
    toast(getUser() ? "Deck saved to your account" : "Deck saved");
    show("startScreen");
  });
  // a signed-in account brings its saved deck to this device
  onAccountChange(() => {
    const u = getUser();
    if (u && isValidDeck(u.deck) && JSON.stringify(u.deck) !== JSON.stringify(deck)) {
      deck = [...u.deck];
      try {
        localStorage.setItem(KEY, JSON.stringify(deck));
      } catch {}
    } else if (u && !u.deck) {
      void persist(deck); // first sign-in on this device: upload the local deck
    }
  });
}

// ------------------------------------------------------------------ drag and drop
// Pointer-based (works with touch on iPhone, where HTML drag-and-drop doesn't):
//  - collection card onto a deck card: swap them; onto an empty slot: add it
//  - deck card onto another deck card: reorder; onto the collection: remove it
let dragJustEnded = false;

function initDrag() {
  const screen = $("deckScreen");
  let start: { id: string; fromDeck: boolean; x: number; y: number; el: HTMLElement; pid: number } | null = null;
  let ghost: HTMLElement | null = null;
  let over: HTMLElement | null = null;

  const target = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return null;
    return el.closest<HTMLElement>("#deckSlots .dcard") ?? el.closest<HTMLElement>("#deckPool");
  };
  const setOver = (el: HTMLElement | null) => {
    if (over === el) return;
    over?.classList.remove("drop");
    over = el;
    over?.classList.add("drop");
  };
  const end = () => {
    ghost?.remove();
    ghost = null;
    start?.el.classList.remove("lifted");
    setOver(null);
    start = null;
  };

  screen.addEventListener("pointerdown", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".dcard[data-card]");
    if (!el || e.button > 0) return;
    start = { id: el.dataset.card!, fromDeck: !!el.closest("#deckSlots"), x: e.clientX, y: e.clientY, el, pid: e.pointerId };
  });
  screen.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.pid) return;
    if (!ghost) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
      // lift the card: a copy follows the finger
      const r = start.el.getBoundingClientRect();
      ghost = start.el.cloneNode(true) as HTMLElement;
      ghost.classList.add("ghost");
      ghost.style.width = `${r.width}px`;
      ghost.style.height = `${r.height}px`;
      document.body.appendChild(ghost);
      start.el.classList.add("lifted");
      try { start.el.setPointerCapture(e.pointerId); } catch {}
    }
    e.preventDefault();
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    const t = target(e.clientX, e.clientY);
    // only highlight places where the drop would do something
    if (t && t.id === "deckPool" && !start.fromDeck) setOver(null);
    else if (t && t.dataset.card === start.id) setOver(null);
    else setOver(t);
  });
  const finish = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.pid) return;
    if (!ghost) return end(); // never moved: it's a tap, the click handler deals with it
    const t = over;
    const { id, fromDeck } = start;
    end();
    dragJustEnded = true;
    setTimeout(() => (dragJustEnded = false), 0);
    if (!t) return;
    if (t.id === "deckPool") {
      if (fromDeck) draft = draft.filter((c) => c !== id);
    } else {
      const slotCard = t.dataset.card;
      const slotIdx = slotCard ? draft.indexOf(slotCard) : Number(t.dataset.slot);
      if (fromDeck) {
        const from = draft.indexOf(id);
        if (slotCard) [draft[from], draft[slotIdx]] = [draft[slotIdx], draft[from]];
        else {
          draft.splice(from, 1);
          draft.push(id);
        }
      } else if (slotCard) draft[slotIdx] = id; // the replaced card goes back to the collection
      else if (draft.length < DECK_SIZE) draft.push(id);
    }
    focus = id;
    sfx.select();
    render();
  };
  screen.addEventListener("pointerup", finish);
  screen.addEventListener("pointercancel", (e) => {
    if (start && e.pointerId === start.pid) end();
  });
}
