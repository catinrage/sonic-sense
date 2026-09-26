import { ENTITY_VS } from "./entity-common";
import { AURA_FS, PLAYER_FS, RETICLE_FS } from "./entity-player";
import { BELL_FS, CRYSTAL_FS, EXIT_FS, MUSHROOM_FS, PILE_FS, PUDDLE_FS, SHARD_FS, STONE_FS } from "./entity-props";
import { CHIME_FS, CURTAIN_FS, DISH_FS } from "./entity-fixtures";
import { WARDEN_FS } from "./entity-warden";

export const ENTITY_SHADERS = {
  player: PLAYER_FS,
  aura: AURA_FS,
  warden: WARDEN_FS,
  crystal: CRYSTAL_FS,
  bell: BELL_FS,
  shard: SHARD_FS,
  exit: EXIT_FS,
  stone: STONE_FS,
  pile: PILE_FS,
  mushroom: MUSHROOM_FS,
  puddle: PUDDLE_FS,
  reticle: RETICLE_FS,
  curtain: CURTAIN_FS,
  dish: DISH_FS,
  chime: CHIME_FS,
} as const;

export type EntityShaderId = keyof typeof ENTITY_SHADERS;

export { ENTITY_VS };
