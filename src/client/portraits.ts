// Painted card portraits (assets/cards/*.webp), inlined into the bundle as data URLs.
import bombardier from "../../assets/cards/bombardier.webp";
import brute from "../../assets/cards/brute.webp";
import bulwark from "../../assets/cards/bulwark.webp";
import cannon from "../../assets/cards/cannon.webp";
import colossus from "../../assets/cards/colossus.webp";
import ember from "../../assets/cards/ember.webp";
import ironhide from "../../assets/cards/ironhide.webp";
import ranger from "../../assets/cards/ranger.webp";
import skyrider from "../../assets/cards/skyrider.webp";
import skywing from "../../assets/cards/skywing.webp";
import sparkcaster from "../../assets/cards/sparkcaster.webp";
import swarmlings from "../../assets/cards/swarmlings.webp";
import twinrangers from "../../assets/cards/twinrangers.webp";
import warden from "../../assets/cards/warden.webp";
import wisps from "../../assets/cards/wisps.webp";
import zap from "../../assets/cards/zap.webp";
import { CARDS } from "../sim/cards";

export const PORTRAITS: Record<string, string> = {
  bombardier, brute, bulwark, cannon, colossus, ember, ironhide, ranger, skyrider, skywing, sparkcaster,
  swarmlings, twinrangers, warden, wisps, zap,
};

/** Frame color group, matching the art sheet: tanks/buildings/air blue, troops orange, spells pink. */
export function cardType(id: string): "tank" | "troop" | "air" | "building" | "spell" {
  const d = CARDS[id];
  if (d.kind === "spell") return "spell";
  if (d.kind === "building") return "building";
  if (d.flying) return "air";
  if (d.targets === "buildings") return "tank";
  return "troop";
}

/** Point an element's background at a card's portrait. */
export function setPortrait(el: HTMLElement, id: string) {
  const url = PORTRAITS[id];
  el.style.setProperty("--art", url ? `url("${url}")` : "none");
  el.dataset.type = cardType(id);
}
