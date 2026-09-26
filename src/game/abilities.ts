import { MUFFLE_COOLDOWN, MUFFLE_TIME, type Player } from "./entities/player";
import type { Ability } from "./level-types";

export interface AbilityInfo {
  name: string;
  /** Key that uses it, or "" for a passive ability. */
  key: string;
  /** One line shown when the ability is granted. */
  blurb: string;
}

export const ABILITY_INFO: Readonly<Record<Ability, AbilityInfo>> = {
  deepListen: {
    name: "Deep Listen",
    key: "",
    blurb: "Stand still and silent: drips, clicks and hums reveal far more of the dark.",
  },
  focus: {
    name: "Focus",
    key: "Q",
    blurb: "Hold [Q] to gather a narrow call towards the pointer: it strikes harder, and hunters barely hear it.",
  },
  lureStone: {
    name: "Lure Stone",
    key: "",
    blurb: "Thrown stones keep chirping where they land. Hunters come to listen.",
  },
  muffle: {
    name: "Muffle",
    key: "F",
    blurb: "Press [F] to silence your footfalls for a few breaths. It needs a long rest after.",
  },
};

/** What the HUD shows for one ability. */
export interface AbilityView {
  id: Ability;
  name: string;
  key: string;
  /** In use right now. */
  active: boolean;
  /** 0 .. 1: how ready it is (or how much of an active effect is left). */
  fill: number;
}

export function abilityViews(abilities: ReadonlySet<Ability>, p: Player): AbilityView[] {
  const order: Ability[] = ["deepListen", "focus", "lureStone", "muffle"];
  return order
    .filter((id) => abilities.has(id))
    .map((id) => {
      const { name, key } = ABILITY_INFO[id];
      switch (id) {
        case "deepListen":
          return { id, name, key, active: p.listen > 0.5, fill: p.listen };
        case "focus":
          return { id, name, key, active: p.charging && p.chargeKind === "focus", fill: p.charging ? p.charge : 1 };
        case "lureStone":
          return { id, name, key, active: false, fill: 1 };
        case "muffle":
          // Drains while muffled, then refills over the rest of the cooldown: one continuous bar.
          return p.muffled
            ? { id, name, key, active: true, fill: p.muffleLeft / MUFFLE_TIME }
            : { id, name, key, active: false, fill: 1 - p.muffleCooldown / (MUFFLE_COOLDOWN - MUFFLE_TIME) };
      }
    });
}
