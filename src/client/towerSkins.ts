// Painted tower skins (assets/towers/*.webp). "classic" is the code-drawn castle tower.
import ironhide from "../../assets/towers/ironhide.webp";
import colossus from "../../assets/towers/colossus.webp";
import warden from "../../assets/towers/warden.webp";
import ranger from "../../assets/towers/ranger.webp";
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
