import { MAX_WAVES, WAVE_KIND_ID, type Wave } from "../game/waves";
import { FIELD_RES, UNREACHED } from "../game/geodesic";
import { Program, RenderTarget, createTexture, type GL } from "./gl";
import { FULLSCREEN_VS, SCENE_FS } from "./glsl/scene";
import { BLOOM_DOWN_FS, BLOOM_UP_FS, COMPOSITE_FS, MEMORY_FS, SHOCK_FS } from "./glsl/post";
import { DUST_FS, DUST_VS, PARTICLE_FS, PARTICLE_VS } from "./glsl/particles";
import { ENTITY_SHADERS, ENTITY_VS, type EntityShaderId } from "./glsl/entities";
import type { LevelTextures } from "./level-textures";

export const MEMORY_RES = 8;
const BLOOM_LEVELS = 6;
/** Internal resolution cap: the scene shader is heavy, so never shade more than ~1080p. */
const MAX_RENDER_PIXELS = 1920 * 1080;
const UBO_FLOATS = (4 + MAX_WAVES * 3) * 4;

export interface CameraView {
  x: number;
  y: number;
  /** Tiles visible vertically on the floor plane. */
  viewHeight: number;
  /** Camera height above the floor (controls wall perspective). */
  height: number;
}

export interface PostParams {
  exposure: number;
  bloom: number;
  chromatic: number;
  grain: number;
  vignette: number;
  fade: number;
  danger: number;
  heartbeat: number;
  flash: [number, number, number, number];
}

export interface EntityDraw {
  shader: EntityShaderId;
  x: number;
  y: number;
  z: number;
  rot: number;
  hw: number;
  hh: number;
  /** Four vec4 parameter slots (16 floats). */
  params: Float32Array;
  /** Optional extra vec4 array bound to uExtra. */
  extra?: Float32Array;
  /** Additive entities are drawn after alpha-blended ones. */
  additive?: boolean;
  order: number;
}

export interface ParticleBatch {
  count: number;
  /** 12 floats per particle: pos(4), color(4), vel(4). */
  data: Float32Array;
}

export interface FrameView {
  time: number;
  dt: number;
  camera: CameraView;
  waves: readonly Wave[];
  /** How far past its radius a wave can reach (drafts carry sound downwind); 1 in still air. */
  waveReach: number;
  /** Visual radius multiplier for sounds the player did not make (Deep Listen); 1 normally. */
  listenGain: number;
  player: { x: number; y: number; charge: number; alive: number };
  entities: readonly EntityDraw[];
  particles: ParticleBatch;
  post: PostParams;
}

export class Renderer {
  readonly gl: GL;
  private readonly canvas: HTMLCanvasElement;
  private readonly ubo: WebGLBuffer;
  private readonly uboData = new Float32Array(UBO_FLOATS);
  private readonly emptyVao: WebGLVertexArrayObject;
  private readonly quadVao: WebGLVertexArrayObject;
  private readonly particleVao: WebGLVertexArrayObject;
  private readonly particleBuffer: WebGLBuffer;
  private particleCapacity = 0;
  private dustVao: WebGLVertexArrayObject | null = null;
  private dustCount = 0;

  private scene!: Program;
  private memory!: Program;
  private bloomDown!: Program;
  private bloomUp!: Program;
  private composite!: Program;
  private shock!: Program;
  private particles!: Program;
  private dust!: Program;
  private readonly entityPrograms = new Map<EntityShaderId, Program>();
  /** Programs not yet handed to the driver (only used without parallel compilation). */
  private readonly programQueue: { label: string; vs: string; fs: string; assign: (p: Program) => void }[] = [];
  private readonly builtPrograms: Program[] = [];
  private readonly parallel: KHR_parallel_shader_compile | null;
  private programsReady = false;

  private hdr: RenderTarget;
  private shockTarget: RenderTarget;
  private bloom: RenderTarget[] = [];
  private memA: RenderTarget | null = null;
  private memB: RenderTarget | null = null;
  private level: LevelTextures | null = null;
  private fieldTex: WebGLTexture | null = null;
  private fieldW = 0;
  private fieldH = 0;
  private readonly uploadedJobs = new WeakMap<object, number>();
  width = 1;
  height = 1;
  renderScale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    if (!gl.getExtension("EXT_color_buffer_float")) {
      throw new Error("This GPU/browser lacks EXT_color_buffer_float (floating point render targets).");
    }
    gl.getExtension("OES_texture_float_linear");
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
    this.gl = gl;

    const ubo = gl.createBuffer();
    if (!ubo) throw new Error("Could not create uniform buffer");
    this.ubo = ubo;
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, this.uboData.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);

    this.emptyVao = gl.createVertexArray()!;
    this.quadVao = this.createQuadVao();
    this.particleBuffer = gl.createBuffer()!;
    this.particleVao = this.createParticleVao();

    const q = this.programQueue;
    q.push({ label: "scene", vs: FULLSCREEN_VS, fs: SCENE_FS, assign: (p) => (this.scene = p) });
    q.push({ label: "memory", vs: FULLSCREEN_VS, fs: MEMORY_FS, assign: (p) => (this.memory = p) });
    q.push({ label: "bloomDown", vs: FULLSCREEN_VS, fs: BLOOM_DOWN_FS, assign: (p) => (this.bloomDown = p) });
    q.push({ label: "bloomUp", vs: FULLSCREEN_VS, fs: BLOOM_UP_FS, assign: (p) => (this.bloomUp = p) });
    q.push({ label: "composite", vs: FULLSCREEN_VS, fs: COMPOSITE_FS, assign: (p) => (this.composite = p) });
    q.push({ label: "shock", vs: FULLSCREEN_VS, fs: SHOCK_FS, assign: (p) => (this.shock = p) });
    q.push({ label: "particles", vs: PARTICLE_VS, fs: PARTICLE_FS, assign: (p) => (this.particles = p) });
    q.push({ label: "dust", vs: DUST_VS, fs: DUST_FS, assign: (p) => (this.dust = p) });
    for (const [id, fs] of Object.entries(ENTITY_SHADERS)) {
      q.push({ label: `entity:${id}`, vs: ENTITY_VS, fs, assign: (p) => this.entityPrograms.set(id as EntityShaderId, p) });
    }
    // With parallel compilation the driver builds everything in the background at once.
    if (this.parallel) while (q.length > 0) this.buildNextProgram();

    this.hdr = new RenderTarget(gl, 1, 1, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, true);
    this.shockTarget = new RenderTarget(gl, 1, 1, gl.RG16F, gl.RG, gl.HALF_FLOAT);
    this.resize();
  }

  /** Match the drawing buffer to the canvas' CSS size (capped for performance). */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const cssW = Math.max(1, this.canvas.clientWidth);
    const cssH = Math.max(1, this.canvas.clientHeight);
    let w = Math.round(cssW * dpr);
    let h = Math.round(cssH * dpr);
    const scale = Math.min(1, Math.sqrt(MAX_RENDER_PIXELS / (w * h))) * this.renderScale;
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const { gl } = this;
    this.hdr.resize(w, h);
    this.shockTarget.resize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    for (const t of this.bloom) t.dispose();
    this.bloom = [];
    let bw = w;
    let bh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      this.bloom.push(new RenderTarget(gl, bw, bh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT));
    }
  }

  /** Bind per-level textures and reset field/memory buffers. */
  setLevel(level: LevelTextures): void {
    const { gl } = this;
    this.level = level;
    const fw = level.w * FIELD_RES;
    const fh = level.h * FIELD_RES;
    if (this.fieldTex) gl.deleteTexture(this.fieldTex);
    this.fieldTex = gl.createTexture();
    this.fieldW = fw;
    this.fieldH = fh;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.fieldTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, fw, fh, MAX_WAVES);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const blank = new Float32Array(fw * fh * 4);
    for (let i = 0; i < fw * fh; i++) blank[i * 4] = UNREACHED;
    for (let layer = 0; layer < MAX_WAVES; layer++) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, fw, fh, 1, gl.RGBA, gl.FLOAT, blank);
    }

    const mw = level.w * MEMORY_RES;
    const mh = level.h * MEMORY_RES;
    this.memA?.dispose();
    this.memB?.dispose();
    this.memA = new RenderTarget(gl, mw, mh, gl.R16F, gl.RED, gl.HALF_FLOAT);
    this.memB = new RenderTarget(gl, mw, mh, gl.R16F, gl.RED, gl.HALF_FLOAT);
    for (const t of [this.memA, this.memB]) {
      t.bind();
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  /** Upload dust mote positions (x, y, z, seed per mote). */
  setDust(motes: Float32Array): void {
    const { gl } = this;
    if (this.dustVao) gl.deleteVertexArray(this.dustVao);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    this.bindQuadCorners();
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, motes, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    this.dustVao = vao;
    this.dustCount = motes.length / 4;
  }

  /**
   * True once every shader program is built. Non-blocking while the driver
   * compiles in the background; throws if a program failed to compile.
   */
  get ready(): boolean {
    if (this.programsReady) return true;
    if (this.programQueue.length > 0) {
      // No parallel compilation: build one program per frame so the page never locks up.
      this.buildNextProgram().finalize();
      return false;
    }
    const all = this.builtPrograms;
    if (!all.every((p) => p.isComplete(this.parallel))) return false;
    for (const p of all) p.finalize();
    this.bindSamplers();
    this.programsReady = true;
    return true;
  }

  /** How far shader building has come, for the loading screen. */
  get buildStatus(): { done: number; total: number; building: string } {
    const total = this.builtPrograms.length + this.programQueue.length;
    if (this.programsReady) return { done: total, total, building: "" };
    let done = 0;
    let building = this.programQueue[0]?.label ?? "";
    for (const p of this.builtPrograms) {
      if (p.isComplete(this.parallel)) done++;
      else if (!building) building = p.label;
    }
    return { done, total, building };
  }

  private buildNextProgram(): Program {
    const spec = this.programQueue.shift()!;
    const program = new Program(this.gl, spec.vs, spec.fs, spec.label);
    spec.assign(program);
    this.builtPrograms.push(program);
    return program;
  }

  render(view: FrameView): void {
    const level = this.level;
    if (!level || !this.memA || !this.memB || !this.fieldTex || !this.ready) return;
    const { gl } = this;
    this.resize();
    level.sync(gl);
    this.writeFrameUniforms(view);
    this.uploadFields(view.waves);

    gl.bindVertexArray(this.emptyVao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    this.bindCommonTextures(level);

    // 1. Memory (world space ping-pong).
    this.memB.bind();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.memA.texture);
    this.memory.use().f("uDecay", view.dt / 16);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    [this.memA, this.memB] = [this.memB, this.memA];
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.memA.texture);

    // 2. Scene (writes depth).
    this.hdr.bind();
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.scene.use();
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. Entities, dust, particles (depth-tested against the scene).
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    this.drawEntities(view.entities);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.drawDust();
    this.drawParticles(view.particles);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);

    // 4. Shock distortion + bloom.
    gl.bindVertexArray(this.emptyVao);
    this.shockTarget.bind();
    this.shock.use();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.renderBloom();

    // 5. Composite to screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.hdr.texture);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.bloom[0]!.texture);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.shockTarget.texture);
    const p = view.post;
    this.composite
      .use()
      .f4("uPost", p.exposure, p.bloom, p.chromatic, p.grain)
      .f4("uPost2", p.vignette, p.fade, p.danger, p.heartbeat)
      .f4("uPost3", p.flash[0], p.flash[1], p.flash[2], p.flash[3])
      .f2("uRes", this.width, this.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private writeFrameUniforms(view: FrameView): void {
    const { gl } = this;
    const d = this.uboData;
    const level = this.level!;
    const cam = view.camera;
    const aspect = this.width / this.height;
    const halfH = cam.viewHeight / 2;
    d.fill(0);
    d.set([cam.x, cam.y, halfH * aspect, halfH], 0);
    d.set([cam.height, view.time, level.w, level.h], 4);
    const waves = view.waves.filter((w) => w.layer >= 0);
    const count = Math.min(waves.length, MAX_WAVES);
    d.set([count, view.waveReach, (halfH * 2) / this.height, 0], 8);
    d.set([view.player.x, view.player.y, view.player.charge, view.player.alive], 12);
    const baseA = 16;
    const baseB = baseA + MAX_WAVES * 4;
    const baseC = baseB + MAX_WAVES * 4;
    for (let i = 0; i < count; i++) {
      const w = waves[i]!;
      const age = Math.max(0, view.time - w.t0);
      d.set([w.x, w.y, age, w.speed], baseA + i * 4);
      // Deep Listen: the world's sounds carry further and ring brighter; the creature's own do not.
      const radius = w.own ? w.radius : w.radius * view.listenGain;
      const strength = w.own ? w.strength : w.strength * (1 + (view.listenGain - 1) * 0.35);
      d.set([radius, strength * w.glow, w.layer, WAVE_KIND_ID[w.kind]], baseB + i * 4);
      d.set([w.color[0], w.color[1], w.color[2], w.fade], baseC + i * 4);
    }
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, d);
  }

  private uploadFields(waves: readonly Wave[]): void {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.fieldTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    for (const w of waves) {
      const job = w.job;
      if (w.layer < 0) continue;
      const uploadedLayer = this.uploadedJobs.get(job);
      if (!job.dirty && uploadedLayer === w.layer) continue;
      const bw = Math.min(job.bw, this.fieldW - job.x0);
      const bh = Math.min(job.bh, this.fieldH - job.y0);
      if (bw <= 0 || bh <= 0) continue;
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, job.bw);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, job.x0, job.y0, w.layer, bw, bh, 1, gl.RGBA, gl.FLOAT, job.data);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      job.dirty = false;
      this.uploadedJobs.set(job, w.layer);
    }
  }

  private bindCommonTextures(level: LevelTextures): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.fieldTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, level.tiles);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, level.wallDist);
  }

  private bindSamplers(): void {
    const all = [this.scene, this.memory, this.shock, this.dust, this.composite, ...this.entityPrograms.values()];
    for (const p of all) {
      p.use();
      p.i("uField", 0).i("uTiles", 1).i("uWallDist", 2).i("uMemory", 3).i("uPrev", 3);
    }
    this.composite.use().i("uScene", 4).i("uBloom", 5).i("uShock", 6);
    this.bloomDown.use().i("uSrc", 7);
    this.bloomUp.use().i("uSrc", 7);
  }

  private renderBloom(): void {
    const { gl } = this;
    let src = this.hdr;
    gl.activeTexture(gl.TEXTURE7);
    for (let i = 0; i < this.bloom.length; i++) {
      const dst = this.bloom[i]!;
      dst.bind();
      gl.bindTexture(gl.TEXTURE_2D, src.texture);
      this.bloomDown
        .use()
        .f2("uTexel", 1 / src.width, 1 / src.height)
        .f("uThreshold", 1.0)
        .i("uPrefilter", i === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = dst;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.bloom.length - 1; i > 0; i--) {
      const s = this.bloom[i]!;
      const dst = this.bloom[i - 1]!;
      dst.bind();
      gl.bindTexture(gl.TEXTURE_2D, s.texture);
      this.bloomUp
        .use()
        .f2("uTexel", 0.5 / s.width, 0.5 / s.height)
        .f("uWeight", 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
  }

  private drawEntities(entities: readonly EntityDraw[]): void {
    const { gl } = this;
    gl.bindVertexArray(this.quadVao);
    const sorted = [...entities].sort((a, b) => Number(!!a.additive) - Number(!!b.additive) || a.order - b.order);
    for (const e of sorted) {
      const prog = this.entityPrograms.get(e.shader);
      if (!prog) continue;
      if (e.additive) gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      prog.use();
      prog.f4("uEnt", e.x, e.y, e.z, e.rot).f2("uHalf", e.hw, e.hh).f4v("uP[0]", e.params);
      if (e.extra) prog.f4v("uExtra[0]", e.extra);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  private drawDust(): void {
    if (!this.dustVao || this.dustCount === 0) return;
    const { gl } = this;
    gl.bindVertexArray(this.dustVao);
    this.dust.use();
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.dustCount);
  }

  private drawParticles(batch: ParticleBatch): void {
    if (batch.count === 0) return;
    const { gl } = this;
    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    const floats = batch.count * 12;
    if (floats > this.particleCapacity) {
      this.particleCapacity = Math.max(floats, this.particleCapacity * 2);
      gl.bufferData(gl.ARRAY_BUFFER, this.particleCapacity * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, floats);
    this.particles.use();
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
  }

  private bindQuadCorners(): void {
    const { gl } = this;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  private createQuadVao(): WebGLVertexArrayObject {
    const { gl } = this;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    this.bindQuadCorners();
    gl.bindVertexArray(null);
    return vao;
  }

  private createParticleVao(): WebGLVertexArrayObject {
    const { gl } = this;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    this.bindQuadCorners();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);
    return vao;
  }
}

