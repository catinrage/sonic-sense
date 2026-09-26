import type { Vec2 } from "../core/math";
import { CHORD_SUSTAIN } from "./calls";
import { cascade, chordRings, WHITE, type Cascade } from "./check-acoustics";
import { CHARGE_TIME, PULSE_COOLDOWN, WALK_SPEED } from "./entities/player";
import type { Situation } from "./level-check";
import { TILE } from "./level-types";

/**
 * The proofs that need one call's timing: chords (every note ringing on the
 * pane at once, with no discord) and timed doors (rung from somewhere the
 * creature can reach the door from before it shuts). Each call is followed
 * through everything it sets off, with real travel times and relay delays.
 */

/** Slack against frame timing and standing off-centre. */
const SUSTAIN_SLACK = 0.3;
/** A timed door must be reached within this share of its time. */
const TIMED_SLACK = 0.85;
/** Paths are never walked quite straight or at full speed. */
const WALK_SLACK = 1.25;

export interface TimedProofs {
  broken: number[];
  passable: number[];
}

export function provePanesAndTimedDoors(s: Situation, passable: ReadonlySet<number>): TimedProofs {
  const chords = s.panes.flatMap((p, i) => (!s.broken.has(i) && p.pane.notes.length > 1 ? [i] : []));
  const timed = s.level.bells.flatMap((b, i) => (!b.toggle && b.timed > 0 && !s.open.has(b.group) && !passable.has(b.group) ? [i] : []));
  if (chords.length === 0 && timed.length === 0) return { broken: [], passable: [] };

  const combos = facingCombos(s);
  const memo = new Map<number, Cascade>();
  const cascadeAt = (tile: number, combo: number): Cascade => {
    const key = combo * s.level.w * s.level.h + tile;
    let c = memo.get(key);
    if (!c) {
      const tone = s.level.keys[tile]! >= 0 ? s.level.keys[tile]! : WHITE;
      c = cascade(s.ac, s.relays, combos[combo]!, s.panes, center(s, tile), tone, s.call);
      memo.set(key, c);
    }
    return c;
  };
  const tiles: number[] = [];
  s.reachable.forEach((r, i) => r && tiles.push(i));

  const broken = chords.filter((p) => proveChord(s, p, tiles, combos.length, cascadeAt));
  const opened = timed.filter((b) => proveTimedDoor(s, b, combos.length, cascadeAt)).map((b) => s.level.bells[b]!.group);
  return { broken, passable: [...new Set(opened)] };
}

const center = (s: Situation, tile: number): Vec2 => ({ x: (tile % s.level.w) + 0.5, y: Math.floor(tile / s.level.w) + 0.5 });

/** Every way the turnable dishes can be set: one facing per relay. */
function facingCombos(s: Situation): (Vec2 | null)[][] {
  let combos: (Vec2 | null)[][] = [[]];
  for (const options of s.facings) combos = combos.flatMap((c) => options.map((f) => [...c, f]));
  return combos;
}

/**
 * A call that sets nothing else off on the way: no discord anywhere, no other
 * pane breaking, and no bell rung that would change the level mid-chord.
 */
function clean(s: Situation, cas: Cascade, pane: number): boolean {
  for (let q = 0; q < s.panes.length; q++) {
    if (q === pane || s.broken.has(q)) continue;
    const notes = s.panes[q]!.pane.notes;
    const hits = cas.hits[q]!;
    if (notes.length === 1 ? hits.some((h) => h.tone === notes[0]) : hits.some((h) => !(notes as readonly number[]).includes(h.tone)) || chordRings(hits, notes, CHORD_SUSTAIN)) return false;
  }
  return s.relays.every((r, k) => {
    if (r.kind !== "bell" || cas.answeredAt[k] === Infinity) return true;
    const bell = s.level.bells[r.index]!;
    return !bell.toggle && s.open.has(bell.group);
  });
}

type CascadeAt = (tile: number, combo: number) => Cascade;

/**
 * A chord pane breaks from one call (a keyed call and the prisms and relays it
 * sets off), or from two keyed calls made one after the other — the second as
 * soon as the creature can walk to its key and draw a full breath.
 */
function proveChord(s: Situation, pane: number, tiles: readonly number[], combos: number, cascadeAt: CascadeAt): boolean {
  const notes = s.panes[pane]!.pane.notes;
  const sustain = CHORD_SUSTAIN - SUSTAIN_SLACK;
  for (let combo = 0; combo < combos; combo++) {
    const useful: number[] = [];
    for (const tile of tiles) {
      const cas = cascadeAt(tile, combo);
      const hits = cas.hits[pane]!;
      if (hits.length === 0 || !clean(s, cas, pane)) continue;
      if (chordRings(hits, notes, sustain)) return true;
      if (s.level.keys[tile]! >= 0 && hits.every((h) => (notes as readonly number[]).includes(h.tone))) useful.push(tile);
    }
    for (const a of useful) {
      const walk = walkDistances(s, [a]);
      const first = cascadeAt(a, combo);
      for (const b of useful) {
        if (b === a || walk[b]! < 0) continue;
        const second = cascadeAt(b, combo);
        // A crystal that sang for the first call is still cooling down for the second.
        if (s.relays.some((r, k) => r.kind === "crystal" && first.answeredAt[k]! < Infinity && second.answeredAt[k]! < Infinity)) continue;
        const gap = Math.max(PULSE_COOLDOWN, (walk[b]! * WALK_SLACK) / WALK_SPEED) + CHARGE_TIME;
        const hits = [...first.hits[pane]!, ...second.hits[pane]!.map((h) => ({ t: h.t + gap, tone: h.tone }))];
        if (chordRings(hits, notes, sustain)) return true;
      }
    }
  }
  return false;
}

/** A timed door can be passed if its bell rings from somewhere the creature reaches the door from in time. */
function proveTimedDoor(s: Situation, bellIndex: number, combos: number, cascadeAt: CascadeAt): boolean {
  const bell = s.level.bells[bellIndex]!;
  const relay = s.relays.findIndex((r) => r.kind === "bell" && r.index === bellIndex);
  const doors: number[] = [];
  s.level.doorGroup.forEach((g, i) => g === bell.group && s.level.tiles[i] === TILE.Door && doors.push(i));
  const walk = walkDistances(s, doors);
  const limit = (bell.timed * TIMED_SLACK * WALK_SPEED) / WALK_SLACK;
  const st = { e: 0, d: 0 };
  for (let tile = 0; tile < walk.length; tile++) {
    if (walk[tile]! < 0 || walk[tile]! > limit || !s.reachable[tile]) continue;
    if (s.focus && s.ac.strike(center(s, tile), null, s.focus, bell.x, bell.y, st).e >= bell.threshold) return true;
    for (let combo = 0; combo < combos; combo++) if (cascadeAt(tile, combo).answeredAt[relay]! < Infinity) return true;
  }
  return false;
}

/** Steps from the nearest of `from` to every reachable tile (-1 = cannot get there). */
function walkDistances(s: Situation, from: readonly number[]): Int32Array {
  const { w, h } = s.level;
  const dist = new Int32Array(w * h).fill(-1);
  const queue = [...from];
  for (const i of from) dist[i] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % w;
    const y = Math.floor(i / w);
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (dist[n]! >= 0 || !s.reachable[n]) continue;
      dist[n] = dist[i]! + 1;
      queue.push(n);
    }
  }
  return dist;
}
