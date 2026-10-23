// Painted unit sprites (assets/units/<unit>_<view>.webp), cut from the art sheets. Generated list.
import bombardier_back from "../../assets/units/bombardier_back.webp";
import bombardier_front from "../../assets/units/bombardier_front.webp";
import bombardier_side from "../../assets/units/bombardier_side.webp";
import brute_back from "../../assets/units/brute_back.webp";
import brute_front from "../../assets/units/brute_front.webp";
import brute_side from "../../assets/units/brute_side.webp";
import bulwark_front from "../../assets/units/bulwark_front.webp";
import cannon_front from "../../assets/units/cannon_front.webp";
import colossus_back from "../../assets/units/colossus_back.webp";
import colossus_front from "../../assets/units/colossus_front.webp";
import colossus_side from "../../assets/units/colossus_side.webp";
import ironhide_back from "../../assets/units/ironhide_back.webp";
import ironhide_front from "../../assets/units/ironhide_front.webp";
import ironhide_side from "../../assets/units/ironhide_side.webp";
import ranger_back from "../../assets/units/ranger_back.webp";
import ranger_front from "../../assets/units/ranger_front.webp";
import ranger_side from "../../assets/units/ranger_side.webp";
import skyrider_back from "../../assets/units/skyrider_back.webp";
import skyrider_front from "../../assets/units/skyrider_front.webp";
import skyrider_side from "../../assets/units/skyrider_side.webp";
import skywing_back from "../../assets/units/skywing_back.webp";
import skywing_front from "../../assets/units/skywing_front.webp";
import skywing_side from "../../assets/units/skywing_side.webp";
import sparkcaster_back from "../../assets/units/sparkcaster_back.webp";
import sparkcaster_front from "../../assets/units/sparkcaster_front.webp";
import sparkcaster_side from "../../assets/units/sparkcaster_side.webp";
import swarmlings_back from "../../assets/units/swarmlings_back.webp";
import swarmlings_front from "../../assets/units/swarmlings_front.webp";
import swarmlings_side from "../../assets/units/swarmlings_side.webp";
import twinrangers_back from "../../assets/units/twinrangers_back.webp";
import twinrangers_front from "../../assets/units/twinrangers_front.webp";
import twinrangers_side from "../../assets/units/twinrangers_side.webp";
import twinrangersp_front from "../../assets/units/twinrangersp_front.webp";
import warden_back from "../../assets/units/warden_back.webp";
import warden_front from "../../assets/units/warden_front.webp";
import warden_side from "../../assets/units/warden_side.webp";
import wisps_back from "../../assets/units/wisps_back.webp";
import wisps_front from "../../assets/units/wisps_front.webp";
import wisps_side from "../../assets/units/wisps_side.webp";

export type View = "front" | "side" | "back";

export const UNIT_SPRITES: Record<string, Partial<Record<View, string>>> = {
  bombardier: { back: bombardier_back, front: bombardier_front, side: bombardier_side },
  brute: { back: brute_back, front: brute_front, side: brute_side },
  bulwark: { front: bulwark_front },
  cannon: { front: cannon_front },
  colossus: { back: colossus_back, front: colossus_front, side: colossus_side },
  ironhide: { back: ironhide_back, front: ironhide_front, side: ironhide_side },
  ranger: { back: ranger_back, front: ranger_front, side: ranger_side },
  skyrider: { back: skyrider_back, front: skyrider_front, side: skyrider_side },
  skywing: { back: skywing_back, front: skywing_front, side: skywing_side },
  sparkcaster: { back: sparkcaster_back, front: sparkcaster_front, side: sparkcaster_side },
  swarmlings: { back: swarmlings_back, front: swarmlings_front, side: swarmlings_side },
  twinrangers: { back: twinrangers_back, front: twinrangers_front, side: twinrangers_side },
  twinrangersp: { front: twinrangersp_front },
  warden: { back: warden_back, front: warden_front, side: warden_side },
  wisps: { back: wisps_back, front: wisps_front, side: wisps_side },
};

/** Twin Rangers are a blue and a pink archer: the pink one has its own sprite key. */
export const spriteKey = (card: string, id: number) => (card === "twinrangers" && id % 2 ? "twinrangersp" : card);

/** Which way each unit's side view faces in the source art (1 = right, -1 = left). */
export const SIDE_FACES: Record<string, 1 | -1> = {
  ironhide: 1, colossus: 1, skyrider: 1, brute: 1, warden: 1, ranger: 1, twinrangers: 1,
  sparkcaster: 1, bombardier: 1, swarmlings: 1, skywing: 1, wisps: 1,
};

/** Sprite height in body radii (radius already includes the renderer's visual scale). */
export const SPRITE_HEIGHT: Record<string, number> = {
  ironhide: 3.31, colossus: 3.38, skyrider: 3.38, brute: 3.51, warden: 3.65, ranger: 3.65, twinrangers: 3.65,
  sparkcaster: 3.65, twinrangersp: 3.65, bombardier: 3.51, swarmlings: 3.92, skywing: 3.51, wisps: 3.1, bulwark: 3.38, cannon: 2.7,
};
