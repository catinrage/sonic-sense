import { Emitter } from "../core/events";
import { clamp, dist, type Vec2 } from "../core/math";
import { Rng, seedFor } from "../core/rng";
import type { BlockQuery, CircleObstacle } from "./collision";
import { Bell, Crystal, Drip, ExitGate, Mushroom, Shard, Stone, StonePile, type Listener } from "./entities/props";
import { MAX_STONES, Player, type PlayerIntent } from "./entities/player";
import { LISTEN_GAIN } from "./calls";
import { Chime } from "./entities/chime";
import { Warden } from "./entities/warden";
import { creatureTraits, type CreatureKind } from "./entities/warden-traits";
import { SoundGrid } from "./geodesic";
import { DECOR, TILE, type Ability, type HintSpawn, type LevelData } from "./level-types";
import { COLORS } from "./palette";
import type { WalkGrid } from "./pathfinding";
import { WaveSystem, type Wave, type WaveSpec } from "./waves";

export interface WorldEvents {
  pulse: { x: number; y: number; charge: number; aim: Vec2 | null };
  muffle: { x: number; y: number; on: boolean };
  /** Deep Listen has fully opened the creature's ears. */
  listen: { x: number; y: number };
  lure: { x: number; y: number; left: number };
  step: { x: number; y: number; water: boolean; silt: boolean; sneak: boolean };
  noStones: { x: number; y: number };
  throw: { x: number; y: number };
  stoneHit: { x: number; y: number; strength: number; water: boolean };
  stoneLost: { x: number; y: number };
  pickup: { x: number; y: number; stones: number };
  crystal: { x: number; y: number; pitch: number; beam: Vec2 | null };
  chime: { x: number; y: number; note: number };
  bell: { x: number; y: number; group: number };
  tick: { x: number; y: number; left: number };
  door: { x: number; y: number; open: boolean; group: number };
  wardenClick: { x: number; y: number };
  wardenAlert: { x: number; y: number; creature: CreatureKind };
  sentinelCall: { x: number; y: number };
  tremorThump: { x: number; y: number };
  shard: { x: number; y: number; got: number; total: number };
  exitAwake: { x: number; y: number };
  exitHum: { x: number; y: number; active: boolean };
  drip: { x: number; y: number };
  death: { cause: "pit" | "warden"; x: number; y: number };
  complete: { x: number; y: number };
  hint: { text: string };
  wave: { wave: Wave };
}

const DOOR_SPEED = 1 / 1.1;
const DOOR_WALKABLE = 0.85;

export class World {
  readonly level: LevelData;
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  readonly variant: Uint8Array;
  readonly decor: Uint8Array;
  readonly doorGroup: Int8Array;
  /** Wind per tile (index into WIND_DIRS, -1 = still air). */
  readonly wind: Int8Array;
  readonly doorOpen: Float32Array;
  readonly doorGlow: Float32Array;
  private readonly doorTarget: Float32Array;
  private readonly propTile: Uint8Array;
  readonly soundGrid: SoundGrid;
  readonly waves: WaveSystem;
  readonly events = new Emitter<WorldEvents>();
  /** The kit this chapter is played with. */
  readonly abilities: ReadonlySet<Ability>;
  time = 0;

  readonly player: Player;
  readonly wardens: Warden[];
  readonly crystals: Crystal[];
  readonly bells: Bell[];
  readonly shards: Shard[];
  readonly stones: Stone[] = [];
  readonly piles: StonePile[];
  readonly mushrooms: Mushroom[];
  readonly drips: Drip[];
  readonly chimes: Chime[];
  /** Centres of the moss-curtain tiles. */
  readonly baffles: Vec2[] = [];
  readonly exit: ExitGate | null;
  readonly obstacles: CircleObstacle[];
  private readonly hints: (HintSpawn & { shown: boolean })[];
  private readonly listeners: Listener[];

  completed = false;
  /** Incremented whenever tile solidity changes (renderer rebuilds distance maps). */
  solidityVersion = 0;
  /** Incremented whenever door visuals change. */
  tilesVersion = 0;

  readonly moveQuery: BlockQuery = { isBlocked: (tx, ty) => this.blocksPlayer(tx, ty) };
  readonly walkQuery: BlockQuery = { isBlocked: (tx, ty) => !this.isWalkable(tx, ty) };
  readonly walkGrid: WalkGrid;

  constructor(level: LevelData) {
    this.level = level;
    this.w = level.w;
    this.h = level.h;
    this.tiles = level.tiles.slice();
    this.variant = level.variant;
    this.decor = level.decor;
    this.doorGroup = level.doorGroup;
    this.wind = level.wind;
    const n = this.w * this.h;
    this.doorOpen = new Float32Array(n);
    this.doorGlow = new Float32Array(n);
    this.doorTarget = new Float32Array(n);
    this.propTile = new Uint8Array(n);

    this.player = new Player(level.player.x, level.player.y, level.def.stones ?? 0);
    this.abilities = new Set(level.def.abilities ?? []);
    this.wardens = level.wardens.map(
      (s) => new Warden(s.x, s.y, s.route, creatureTraits(s.creature, { speedMul: s.speed }), seedFor(s.x, s.y, 0x5a1d)),
    );
    this.crystals = level.crystals.map((c) => new Crystal(c.x, c.y, c.facing));
    this.bells = level.bells.map((b) => new Bell(b.x, b.y, b.group, b.timed, b.threshold));
    this.shards = level.shards.map((s) => new Shard(s.x, s.y));
    this.piles = level.stonePiles.map((p) => new StonePile(p.x, p.y, 2));
    this.mushrooms = level.mushrooms.map((m) => new Mushroom(m.x, m.y));
    this.drips = level.drips.map((d) => new Drip(d.x, d.y));
    this.chimes = level.chimes.map((c) => new Chime(c.x, c.y));
    for (let i = 0; i < n; i++) {
      if (this.decor[i]! & DECOR.Baffle) this.baffles.push({ x: (i % this.w) + 0.5, y: Math.floor(i / this.w) + 0.5 });
    }
    this.exit = level.exit ? new ExitGate(level.exit.x, level.exit.y, level.shards.length > 0) : null;
    this.hints = level.hints.map((h) => ({ ...h, shown: false }));
    this.obstacles = [
      ...this.crystals.map((c) => ({ x: c.x, y: c.y, r: 0.36 })),
      ...this.bells.map((b) => ({ x: b.x, y: b.y, r: 0.4 })),
    ];
    for (const o of this.obstacles) this.propTile[Math.floor(o.y) * this.w + Math.floor(o.x)] = 1;
    this.listeners = [this.player, ...this.wardens, ...this.crystals, ...this.bells, ...this.shards, ...this.mushrooms];

    this.walkGrid = { w: this.w, h: this.h, isWalkable: (tx, ty) => this.isWalkable(tx, ty) };
    this.soundGrid = new SoundGrid(this.w, this.h);
    this.soundGrid.setSolidTiles(this.soundMask());
    this.soundGrid.setSiltTiles(this.tiles.map((t) => (t === TILE.Silt ? 1 : 0)));
    this.soundGrid.setWind(level.wind);
    this.waves = new WaveSystem(this.soundGrid);
  }

  get shardsCollected(): number {
    return this.shards.filter((s) => s.collected).length;
  }

  tileAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return TILE.Wall;
    return this.tiles[ty * this.w + tx]!;
  }

  tileAtPos(x: number, y: number): number {
    return this.tileAt(Math.floor(x), Math.floor(y));
  }

  isPitAt(x: number, y: number): boolean {
    return this.tileAtPos(x, y) === TILE.Pit;
  }

  private doorClosedAt(tx: number, ty: number, threshold: number): boolean {
    const i = ty * this.w + tx;
    return this.tiles[i] === TILE.Door && this.doorOpen[i]! < threshold;
  }

  blocksPlayer(tx: number, ty: number): boolean {
    const t = this.tileAt(tx, ty);
    return t === TILE.Wall || (t === TILE.Door && this.doorClosedAt(tx, ty, DOOR_WALKABLE));
  }

  /** Stones fly over pits and water but bounce off walls and closed doors. */
  stoneBlocked(tx: number, ty: number): boolean {
    const t = this.tileAt(tx, ty);
    return t === TILE.Wall || (t === TILE.Door && this.doorClosedAt(tx, ty, 0.6));
  }

  isWalkable(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    const t = this.tileAt(tx, ty);
    if (t === TILE.Wall || t === TILE.Pit) return false;
    if (t === TILE.Door && this.doorClosedAt(tx, ty, DOOR_WALKABLE)) return false;
    return this.propTile[ty * this.w + tx] === 0;
  }

  emitSound(spec: WaveSpec): Wave {
    const own = spec.source === this.player;
    const headroom = !own && this.abilities.has("deepListen") ? LISTEN_GAIN : 1;
    const wave = this.waves.emit({ ...spec, own, revealHeadroom: headroom }, this.time);
    this.events.emit("wave", { wave });
    return wave;
  }

  throwStone(x: number, y: number, tx: number, ty: number): void {
    const stone = new Stone(x, y);
    stone.launch(tx, ty);
    this.stones.push(stone);
    this.events.emit("throw", { x, y });
  }

  stoneImpact(stone: Stone, impact: number): void {
    const tile = this.tileAtPos(stone.x, stone.y);
    const water = tile === TILE.Water;
    const first = stone.bounces === 0;
    const strength = clamp(impact / 7, 0.35, 1);
    if (tile === TILE.Silt) {
      // Soft silt takes a falling stone without a sound: nothing hears it, and it shows almost nothing.
      this.emitSound({ kind: "stone", x: stone.x, y: stone.y, radius: 1, loudness: 0, strength: 0.2, speed: 5, fade: 0.8, color: COLORS.stone, source: stone });
      this.events.emit("stoneHit", { x: stone.x, y: stone.y, strength: 0.15, water: false });
      return;
    }
    this.emitSound({
      kind: "stone",
      x: stone.x,
      y: stone.y,
      radius: first ? 6.2 : 3,
      loudness: first ? 9 : 4,
      strength,
      speed: 9,
      fade: first ? 2.6 : 1.4,
      color: water ? COLORS.splash : COLORS.stone,
      source: stone,
      alerts: true,
      hits: first,
    });
    this.events.emit("stoneHit", { x: stone.x, y: stone.y, strength, water });
  }

  /** Open or close every door of a group. Closing waits for creatures to clear the doorway. */
  setGroupOpen(group: number, open: boolean, _by: Bell | null): void {
    let any: Vec2 | null = null;
    for (let i = 0; i < this.doorGroup.length; i++) {
      if (this.doorGroup[i] !== group) continue;
      this.doorTarget[i] = open ? 1 : 0;
      any ??= { x: (i % this.w) + 0.5, y: Math.floor(i / this.w) + 0.5 };
    }
    if (any) this.events.emit("door", { x: any.x, y: any.y, open, group });
  }

  update(dt: number, intent: PlayerIntent): void {
    this.time += dt;
    this.player.update(dt, intent, this);
    for (const s of this.stones) s.update(dt, this);
    for (const w of this.wardens) w.update(dt, this);
    for (const c of this.crystals) c.update(dt, this);
    for (const c of this.chimes) c.update(dt, this);
    for (const b of this.bells) b.update(dt, this);
    for (const s of this.shards) s.update(dt);
    for (const m of this.mushrooms) m.update(dt);
    for (const d of this.drips) d.update(dt, this);
    this.exit?.update(dt, this);
    this.updateDoors(dt);
    this.waves.update(this.time);
    this.processHearing();
    this.updatePickups();
    this.updateHints();
  }

  private processHearing(): void {
    for (const wave of this.waves.waves) {
      for (const l of this.listeners) {
        if (wave.heard.has(l)) continue;
        if (wave.source === l) {
          wave.heard.add(l);
          continue;
        }
        if (l instanceof Shard && l.collected) continue;
        const s = this.waves.arrival(wave, l.x, l.y, this.time);
        if (!s) continue;
        wave.heard.add(l);
        l.hear(wave, s, this);
      }
    }
  }

  private updatePickups(): void {
    const p = this.player;
    if (p.dying) return;
    for (const s of this.stones) {
      if (!s.resting || s.lost || s.pickupDelay > 0 || p.stones >= MAX_STONES) continue;
      if (dist(p.x, p.y, s.x, s.y) < 0.5) {
        s.lost = true;
        p.stones++;
        this.events.emit("pickup", { x: s.x, y: s.y, stones: p.stones });
      }
    }
    for (let i = this.stones.length - 1; i >= 0; i--) if (this.stones[i]!.lost) this.stones.splice(i, 1);
    for (const pile of this.piles) {
      if (pile.count <= 0 || p.stones >= MAX_STONES || dist(p.x, p.y, pile.x, pile.y) > 0.6) continue;
      const take = Math.min(pile.count, MAX_STONES - p.stones);
      pile.count -= take;
      p.stones += take;
      this.events.emit("pickup", { x: pile.x, y: pile.y, stones: p.stones });
    }
    for (const s of this.shards) {
      if (s.collected || dist(p.x, p.y, s.x, s.y) > 0.5) continue;
      s.collected = true;
      const got = this.shardsCollected;
      this.events.emit("shard", { x: s.x, y: s.y, got, total: this.shards.length });
      if (got === this.shards.length) this.exit?.activate(this);
    }
    const exit = this.exit;
    if (exit && exit.active && !this.completed && dist(p.x, p.y, exit.x, exit.y) < 0.42) {
      this.completed = true;
      // The Gate has taken the creature: nothing that is still hunting can reach it now.
      p.invulnerable = true;
      this.events.emit("complete", { x: exit.x, y: exit.y });
    }
  }

  private updateHints(): void {
    const p = this.player;
    for (const h of this.hints) {
      if (h.shown || dist(p.x, p.y, h.x, h.y) > h.radius) continue;
      h.shown = true;
      this.events.emit("hint", { text: h.text });
    }
  }

  private updateDoors(dt: number): void {
    let solidity = false;
    let visuals = false;
    for (let i = 0; i < this.doorGroup.length; i++) {
      if (this.doorGroup[i]! < 0) continue;
      const target = this.doorTarget[i]!;
      const cur = this.doorOpen[i]!;
      const glowTarget = target > 0.5 ? 1 : 0;
      const glow = this.doorGlow[i]!;
      if (Math.abs(glow - glowTarget) > 1e-3) {
        this.doorGlow[i] = glow + (glowTarget - glow) * Math.min(1, dt * 2.5);
        visuals = true;
      }
      if (cur === target) continue;
      if (target < cur && this.doorwayOccupied(i)) continue;
      const next = target > cur ? Math.min(target, cur + dt * DOOR_SPEED) : Math.max(target, cur - dt * DOOR_SPEED);
      if ((cur < 0.5) !== (next < 0.5) || (cur < DOOR_WALKABLE) !== (next < DOOR_WALKABLE)) solidity = true;
      this.doorOpen[i] = next;
      visuals = true;
    }
    if (solidity) {
      this.soundGrid.setSolidTiles(this.soundMask());
      this.solidityVersion++;
    }
    if (visuals) this.tilesVersion++;
  }

  private doorwayOccupied(i: number): boolean {
    const tx = i % this.w;
    const ty = Math.floor(i / this.w);
    const inside = (x: number, y: number, r: number) => x + r > tx && x - r < tx + 1 && y + r > ty && y - r < ty + 1;
    if (inside(this.player.x, this.player.y, this.player.r)) return true;
    return this.wardens.some((w) => inside(w.x, w.y, w.r * 0.7));
  }

  private soundMask(): Uint8Array {
    const mask = new Uint8Array(this.w * this.h);
    for (let i = 0; i < mask.length; i++) {
      const t = this.tiles[i];
      const baffle = (this.decor[i]! & DECOR.Baffle) !== 0;
      mask[i] = t === TILE.Wall || baffle || (t === TILE.Door && this.doorOpen[i]! < 0.5) ? 1 : 0;
    }
    return mask;
  }

  /**
   * Air-borne dust positions (x, y, z, seed) spread over open floor. In a draft
   * the seed's integer part is the wind index + 1, so the motes stream downwind.
   */
  dustMotes(): Float32Array {
    const rng = new Rng(this.w * 131 + this.h * 7);
    const out: number[] = [];
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        const t = this.tileAt(tx, ty);
        if (t === TILE.Wall) continue;
        const wind = this.wind[ty * this.w + tx]!;
        const count = t === TILE.Pit ? 3 : t === TILE.Draft ? 6 : 2;
        for (let k = 0; k < count; k++) {
          const z = t === TILE.Pit ? rng.range(-1.5, 0.9) : t === TILE.Draft ? rng.range(0.04, 0.6) : rng.range(0.06, 1.0);
          out.push(tx + rng.next(), ty + rng.next(), z, rng.next() * 0.999 + (wind >= 0 ? wind + 1 : 0));
        }
      }
    }
    return new Float32Array(out);
  }
}
