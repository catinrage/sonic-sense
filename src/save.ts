const STORAGE_KEY = "sonic-sense:v1";

/** Bumped when stored progress needs upgrading on load. */
export const SAVE_VERSION = 3;

/**
 * Index of Act I's last chapter. Version-1 saves were written when the game
 * ended there, so reaching it meant the whole game was open to you.
 */
const ACT_ONE_FINALE = 6;

/**
 * Index of Act II's last chapter. Version-2 saves were written when the game
 * ended there: finishing it left `unlocked` on it and `last` back at 0.
 */
const ACT_TWO_FINALE = 13;

/**
 * Upgrades progress saved by older versions, one version at a time, so the
 * chapters a player had earned stay open when new acts are added after them.
 */
function migrateUnlocked(version: unknown, unlocked: number, last: number): number {
  let v = typeof version === "number" && Number.isInteger(version) ? version : 1;
  if (v < 2) {
    // Act I players who reached its finale may continue straight into Act II.
    if (unlocked >= ACT_ONE_FINALE) unlocked = Math.max(unlocked, ACT_ONE_FINALE + 1);
    v = 2;
  }
  if (v < 3) {
    // Act II players who finished it may continue straight into Act III.
    if (unlocked === ACT_TWO_FINALE && last === 0) unlocked = ACT_TWO_FINALE + 1;
    v = 3;
  }
  return unlocked;
}

export interface SaveData {
  version: number;
  /** Highest chapter index unlocked. */
  unlocked: number;
  /** Chapter to continue from. */
  last: number;
  volumes: { master: number; sfx: number; music: number };
  shake: boolean;
  gentle: boolean;
}

const DEFAULTS: SaveData = {
  version: SAVE_VERSION,
  unlocked: 0,
  last: 0,
  volumes: { master: 0.8, sfx: 1, music: 0.7 },
  shake: true,
  gentle: false,
};

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

const clampIndex = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 64 ? v : 0);

/** Validates untrusted storage content, falling back to defaults field by field. */
export function parseSave(raw: unknown): SaveData {
  if (!raw || typeof raw !== "object") return structuredClone(DEFAULTS);
  const r = raw as Record<string, unknown>;
  const vol = (r.volumes && typeof r.volumes === "object" ? r.volumes : {}) as Record<string, unknown>;
  const last = clampIndex(r.last);
  const unlocked = migrateUnlocked(r.version, clampIndex(r.unlocked), last);
  return {
    version: SAVE_VERSION,
    unlocked,
    last,
    volumes: {
      master: clamp01(vol.master, DEFAULTS.volumes.master),
      sfx: clamp01(vol.sfx, DEFAULTS.volumes.sfx),
      music: clamp01(vol.music, DEFAULTS.volumes.music),
    },
    shake: typeof r.shake === "boolean" ? r.shake : DEFAULTS.shake,
    gentle: typeof r.gentle === "boolean" ? r.gentle : DEFAULTS.gentle,
  };
}

export function loadSave(): SaveData {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return parseSave(text ? JSON.parse(text) : null);
  } catch {
    // Storage may be unavailable (private mode) or corrupted; play without saving.
    return structuredClone(DEFAULTS);
  }
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch {
    // Non-fatal: progress simply is not kept across sessions.
  }
}
