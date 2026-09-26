const STORAGE_KEY = "sonic-sense:v1";

/** Bumped when stored progress needs upgrading on load. */
export const SAVE_VERSION = 2;

/**
 * Index of Act I's last chapter. Version-1 saves were written when the game
 * ended there, so reaching it meant the whole game was open to you.
 */
const ACT_ONE_FINALE = 6;

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
  let unlocked = clampIndex(r.unlocked);
  // Act I players who reached its finale may continue straight into Act II.
  if (r.version !== SAVE_VERSION && unlocked >= ACT_ONE_FINALE) unlocked = ACT_ONE_FINALE + 1;
  return {
    version: SAVE_VERSION,
    unlocked,
    last: clampIndex(r.last),
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
