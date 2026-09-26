import type { CreatureKind } from "../game/entities/warden-traits";
import type { World } from "../game/world";
import { Ambience, type AmbienceScene } from "./ambience";
import { AudioCore } from "./engine";
import { SampleBank } from "./samples";
import { Sfx, type EchoTap } from "./sounds";
import { WindBed } from "./wind";
import { TILE } from "../game/level-types";

const ECHO_RAYS = 20;
/** Each hunter cries in its own register: the pack shrill, the sentinel low. */
const CRY_PITCH: Readonly<Record<CreatureKind, number>> = { warden: 1, chorus: 1.35, stalker: 0.82, sentinel: 0.7, tremor: 0.6 };
const MAX_TAPS = 7;

/** Distance along a ray until it hits a sound-blocking tile (or maxDist). */
function rayToWall(world: World, x: number, y: number, dx: number, dy: number, maxDist: number): number {
  const step = 0.2;
  for (let d = step; d < maxDist; d += step) {
    if (world.soundGrid.solidAt(Math.floor(x + dx * d), Math.floor(y + dy * d))) return d;
  }
  return maxDist;
}

/** Echo pattern of the surrounding room: nearer walls answer sooner and brighter. */
export function echoTaps(world: World, x: number, y: number, radius: number): EchoTap[] {
  const raw: EchoTap[] = [];
  for (let i = 0; i < ECHO_RAYS; i++) {
    const a = (i / ECHO_RAYS) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const d = rayToWall(world, x, y, dx, dy, radius);
    if (d >= radius) continue;
    raw.push({ delay: 0.05 + d * 0.06, gain: 1.6 / (1 + d * 0.45) / ECHO_RAYS, pan: dx * 0.8, cutoff: 7000 / (1 + d * 0.35) });
  }
  raw.sort((a, b) => a.delay - b.delay);
  const merged: EchoTap[] = [];
  for (const tap of raw) {
    const last = merged[merged.length - 1];
    if (last && tap.delay - last.delay < 0.03) {
      const g = last.gain + tap.gain;
      last.pan = (last.pan * last.gain + tap.pan * tap.gain) / g;
      last.gain = g;
    } else {
      merged.push({ ...tap });
    }
  }
  return merged.sort((a, b) => b.gain - a.gain).slice(0, MAX_TAPS);
}

const WIND_REACH = 4;

/** Fraction of the open ground within WIND_REACH of (x, y) that is moving air, nearer tiles counting more. */
export function draftDensity(world: World, x: number, y: number): number {
  if (!world.soundGrid.hasWind) return 0;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let sum = 0;
  let total = 0;
  for (let ty = cy - WIND_REACH; ty <= cy + WIND_REACH; ty++) {
    for (let tx = cx - WIND_REACH; tx <= cx + WIND_REACH; tx++) {
      const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
      if (d > WIND_REACH) continue;
      const tile = world.tileAt(tx, ty);
      if (tile === TILE.Wall) continue;
      const weight = 1 - d / WIND_REACH;
      total += weight;
      if (tile === TILE.Draft) sum += weight;
    }
  }
  return total > 0 ? sum / total : 0;
}

/** Routes world events to generated samples, with synthesis as the fallback. */
export class AudioDirector {
  readonly core = new AudioCore();
  readonly samples = new SampleBank(this.core);
  readonly sfx = new Sfx(this.core, this.samples);
  readonly ambience = new Ambience(this.core, this.samples);
  readonly wind = new WindBed(this.core);
  private unsubscribe: (() => void)[] = [];
  private world: World | null = null;

  unlock(): void {
    this.core.unlock();
    // Decoding needs a context, so loading only starts once one exists.
    this.samples.load();
  }

  /** Choose the ambient bed for the current screen. */
  setScene(scene: AmbienceScene): void {
    this.ambience.setScene(scene);
  }

  attach(world: World): void {
    this.detach();
    this.world = world;
    const ev = world.events;
    const s = this.sfx;
    this.unsubscribe.push(
      ev.on("pulse", (e) => (e.aim ? s.focus(e.charge) : s.pulse(e.charge, echoTaps(world, e.x, e.y, 6 + e.charge * 8)))),
      ev.on("muffle", (e) => s.muffle(e.on)),
      ev.on("lure", (e) => s.lure(e.x, e.y, e.left)),
      ev.on("step", (e) => s.footstep(e.x, e.y, e.water, e.sneak, e.silt)),
      ev.on("throw", (e) => s.whoosh(e.x, e.y)),
      ev.on("stoneHit", (e) => s.stoneHit(e.x, e.y, e.strength, e.water)),
      ev.on("crystal", (e) => s.crystal(e.x, e.y, e.pitch)),
      ev.on("bell", (e) => s.bell(e.x, e.y, e.group)),
      ev.on("door", (e) => s.door(e.x, e.y, e.open)),
      ev.on("tick", (e) => s.tick(e.x, e.y, e.left < 3)),
      ev.on("wardenClick", (e) => s.wardenClick(e.x, e.y)),
      ev.on("wardenAlert", (e) => s.wardenAlert(e.x, e.y, CRY_PITCH[e.creature])),
      ev.on("sentinelCall", (e) => s.sentinelCall(e.x, e.y)),
      ev.on("chime", (e) => s.chime(e.x, e.y, e.note)),
      ev.on("tremorThump", (e) => s.tremorThump(e.x, e.y)),
      ev.on("shard", (e) => s.shard(e.got)),
      ev.on("pickup", () => s.pickup()),
      ev.on("noStones", () => s.empty()),
      ev.on("exitHum", (e) => s.exitHum(e.x, e.y, e.active)),
      ev.on("exitAwake", () => s.exitAwake()),
      ev.on("drip", (e) => s.drip(e.x, e.y)),
      ev.on("death", (e) => s.death(e.cause)),
      ev.on("complete", () => s.complete()),
    );
  }

  detach(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.world = null;
    this.wind.stop();
  }

  update(dt: number, danger: number): void {
    const w = this.world;
    if (w) {
      this.core.listenerX = w.player.x;
      this.core.listenerY = w.player.y;
      this.wind.update(draftDensity(w, w.player.x, w.player.y), dt);
    }
    this.ambience.update(dt, danger);
  }
}
