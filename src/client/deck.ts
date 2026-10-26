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
    draft[i] ? cardTile(draft[i], true) : `<div class="dcard empty" aria-hidden="true"><span class="nm">Empty</span></div>`,
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
