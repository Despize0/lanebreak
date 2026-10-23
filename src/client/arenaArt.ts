// Painted arena kit (assets/arena), cut from the arena tile sheet.
import banner_blue from "../../assets/arena/banner_blue.webp";
import banner_red from "../../assets/arena/banner_red.webp";
import base_king_blue from "../../assets/arena/base_king_blue.webp";
import base_king_red from "../../assets/arena/base_king_red.webp";
import base_side_blue from "../../assets/arena/base_side_blue.webp";
import base_side_red from "../../assets/arena/base_side_red.webp";
import bridge from "../../assets/arena/bridge.webp";
import bush from "../../assets/arena/bush.webp";
import cliff from "../../assets/arena/cliff.webp";
import cliff2 from "../../assets/arena/cliff2.webp";
import cliff_falls from "../../assets/arena/cliff_falls.webp";
import cloud from "../../assets/arena/cloud.webp";
import cloudpuff from "../../assets/arena/cloudpuff.webp";
import crystal from "../../assets/arena/crystal.webp";
import falls from "../../assets/arena/falls.webp";
import far_island from "../../assets/arena/far_island.webp";
import flowers from "../../assets/arena/flowers.webp";
import grass from "../../assets/arena/grass.webp";
import pathtile from "../../assets/arena/pathtile.webp";
import pine from "../../assets/arena/pine.webp";
import river from "../../assets/arena/river.webp";
import rock from "../../assets/arena/rock.webp";
import rock_under from "../../assets/arena/rock_under.webp";
import torch from "../../assets/arena/torch.webp";
import tuft from "../../assets/arena/tuft.webp";

const URLS: Record<string, string> = { banner_blue, banner_red, base_king_blue, base_king_red, base_side_blue, base_side_red, bridge, bush, cliff, cliff2, cliff_falls, cloud, cloudpuff, crystal, falls, far_island, flowers, grass, pathtile, pine, river, rock, rock_under, torch, tuft };
const imgs = new Map<string, HTMLImageElement>();
let pending = 0;
let onReady: (() => void) | null = null;
for (const [k, url] of Object.entries(URLS)) {
  if (typeof Image === "undefined") break;
  const im = new Image();
  pending++;
  im.onload = im.onerror = () => {
    pending--;
    if (pending === 0 && onReady) onReady();
  };
  im.src = url;
  imgs.set(k, im);
}
/** Called once every arena image has loaded (to rebuild the cached scenery). */
export function whenArenaReady(cb: () => void) {
  if (pending === 0) cb();
  else onReady = cb;
}
export function arenaImg(name: string): HTMLImageElement | null {
  const im = imgs.get(name);
  return im && im.complete && im.naturalWidth > 0 ? im : null;
}
