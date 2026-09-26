import { MUFFLE_COOLDOWN, MUFFLE_TIME, type Player } from "./entities/player";
import type { Ability } from "./level-types";

/** How a newly granted ability is taught: shown on its own screen before the chapter begins. */
export interface AbilityLesson {
  /** What to do. [Key] tokens render as keycaps. */
  use: string;
  /** What happens, in the game's terms. */
  does: string;
  /** What to watch for, and the catch. */
  tip: string;
}

export interface AbilityInfo {
  name: string;
  /** Key that uses it, or "" for an ability that works on its own. */
  key: string;
  /** For an ability without a key: what sets it off, shown on its HUD chip. */
  trigger: string;
  /** One line, shown in the pause menu. */
  blurb: string;
  lesson: AbilityLesson;
}

export const ABILITY_INFO: Readonly<Record<Ability, AbilityInfo>> = {
  deepListen: {
    name: "Deep Listen",
    key: "",
    trigger: "Stand still",
    blurb: "Stand still and don't call: every sound you did not make reveals far more of the dark.",
    lesson: {
      use: "Stand still, and don't call. After a breath, your ears open.",
      does: "Every sound you did not make — dripping water, a hunter's clicking, a crystal's song — lights up far more of the dark, and brighter.",
      tip: "Rings drawing in around you mean you are listening. Moving or calling breaks it, and your own calls are unchanged.",
    },
  },
  focus: {
    name: "Focus",
    key: "Q",
    trigger: "",
    blurb: "Hold Q, aim with the pointer, release: a narrow call that strikes harder, and that hunters barely hear.",
    lesson: {
      use: "Hold [Q] to gather your breath, aim with the pointer, then release.",
      does: "Your call leaves as a narrow beam. It reaches as far as a full call and strikes harder — enough for bells too heavy for an ordinary voice — yet hunters barely hear it.",
      tip: "It shows only what the beam touches. Without a pointer, it flies the way you are facing.",
    },
  },
  lureStone: {
    name: "Lure Stone",
    key: "",
    trigger: "Throw",
    blurb: "A thrown stone keeps chirping where it lands, and hunters come to listen.",
    lesson: {
      use: "Throw a stone as before: [Click] or [E] where the reticle shows.",
      does: "Where it comes to rest, the stone keeps chirping for about ten seconds. Hunters come to listen, and search around it while it calls.",
      tip: "A stone falls silent on silt — but a lure stone still sings from there. It glows while it calls. Pick it up to throw it again.",
    },
  },
  muffle: {
    name: "Muffle",
    key: "F",
    trigger: "",
    blurb: "Press F: four seconds of footfalls that make no sound at all. Then a long rest.",
    lesson: {
      use: "Press [F] — then walk, don't creep, while it lasts.",
      does: "For four seconds your footfalls make no sound at all — not even to the things that feel the ground — so you can cross at full speed.",
      tip: "It needs a long rest afterwards: the bar under its name drains while it lasts, then slowly refills.",
    },
  },
};

/** Abilities a chapter gives for the first time, in the order they are taught. */
export function lessonsFor(grants: readonly Ability[] | undefined): AbilityInfo[] {
  return (grants ?? []).map((id) => ABILITY_INFO[id]);
}

/** What the HUD shows for one ability. */
export interface AbilityView {
  id: Ability;
  name: string;
  key: string;
  /** What sets it off, for an ability without a key. */
  trigger: string;
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
      const { name, key, trigger } = ABILITY_INFO[id];
      const base = { id, name, key, trigger };
      switch (id) {
        case "deepListen":
          return { ...base, active: p.listen > 0.5, fill: p.listen };
        case "focus":
          return { ...base, active: p.charging && p.chargeKind === "focus", fill: p.charging ? p.charge : 1 };
        case "lureStone":
          return { ...base, active: false, fill: 1 };
        case "muffle":
          // Drains while muffled, then refills over the rest of the cooldown: one continuous bar.
          return p.muffled
            ? { ...base, active: true, fill: p.muffleLeft / MUFFLE_TIME }
            : { ...base, active: false, fill: 1 - p.muffleCooldown / (MUFFLE_COOLDOWN - MUFFLE_TIME) };
      }
    });
}
