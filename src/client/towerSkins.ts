// Painted tower skins (assets/towers/*.webp). "classic" is the code-drawn castle tower.
import ironhide from "../../assets/towers/ironhide.webp";
import colossus from "../../assets/towers/colossus.webp";
import warden from "../../assets/towers/warden.webp";
import ranger from "../../assets/towers/ranger.webp";
import king_blue from "../../assets/towers/king_blue.webp";
import king_red from "../../assets/towers/king_red.webp";
import { TOWER_SKINS, type TowerSkin } from "../net/tiers";

export const TOWER_ART: Partial<Record<TowerSkin, string>> = { ironhide, colossus, warden, ranger };
export const TOWER_NAMES: Record<TowerSkin, string> = {
  classic: "Castle", ironhide: "Stone Fort", colossus: "Crystal Spire", warden: "Warden Keep", ranger: "Ranger Post",
};
export { TOWER_SKINS, type TowerSkin };

const images = new Map<string, HTMLImageElement>();
for (const [k, url] of Object.entries(TOWER_ART)) {
  const img = new Image();
  img.src = url!;
  images.set(k, img);
}
export function towerImage(skin: string): HTMLImageElement | null {
  const img = images.get(skin);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/** Floating-island king towers, one per team color. */
const kings = new Map<string, HTMLImageElement>();
for (const [k, url] of Object.entries({ blue: king_blue, red: king_red })) {
  if (typeof Image === "undefined") break;
  const img = new Image();
  img.src = url;
  kings.set(k, img);
}
export function kingImage(blue: boolean): HTMLImageElement | null {
  const img = kings.get(blue ? "blue" : "red");
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

export const KING_ART = { blue: king_blue, red: king_red };
