/** Thin WebGL2 helpers: programs with readable errors, textures, render targets. */

export type GL = WebGL2RenderingContext;

function annotateSource(source: string, log: string): string {
  const lines = source.split("\n");
  const marks = new Set<number>();
  for (const m of log.matchAll(/ERROR:\s*\d+:(\d+)/g)) marks.add(Number(m[1]));
  if (marks.size === 0) return "";
  const out: string[] = [];
  for (const line of [...marks].sort((a, b) => a - b)) {
    for (let i = Math.max(1, line - 3); i <= Math.min(lines.length, line + 2); i++) {
      out.push(`${i === line ? ">>" : "  "} ${String(i).padStart(4)} | ${lines[i - 1]}`);
    }
    out.push("   ...");
  }
  return out.join("\n");
}

function createShader(gl: GL, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`${label}: could not create shader`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/**
 * A linked shader program. Construction never blocks: compile and link are
 * only queued, so drivers exposing KHR_parallel_shader_compile can build it in
 * the background (critical on Windows, where D3D shader compilation is slow).
 * Call `isComplete()` to poll, then `finalize()` to verify and set up.
 */
export class Program {
  readonly handle: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();
  private pending: { vs: WebGLShader; fs: WebGLShader; vsSrc: string; fsSrc: string } | null;

  constructor(
    private readonly gl: GL,
    vertexSource: string,
    fragmentSource: string,
    readonly label: string,
  ) {
    const program = gl.createProgram();
    if (!program) throw new Error(`${label}: could not create program`);
    const vs = createShader(gl, gl.VERTEX_SHADER, vertexSource, label);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource, label);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    this.handle = program;
    this.pending = { vs, fs, vsSrc: vertexSource, fsSrc: fragmentSource };
  }

  /** Non-blocking: true once the driver has finished building (always true without the extension). */
  isComplete(parallel: KHR_parallel_shader_compile | null): boolean {
    if (!this.pending || !parallel) return true;
    return this.gl.getProgramParameter(this.handle, parallel.COMPLETION_STATUS_KHR) === true;
  }

  /** Verify compile/link status (blocks if still building) and bind the shared Frame block. */
  finalize(): void {
    const pending = this.pending;
    if (!pending) return;
    const { gl, label } = this;
    if (!gl.getProgramParameter(this.handle, gl.LINK_STATUS)) {
      const problems: string[] = [];
      for (const [shader, src, kind] of [
        [pending.vs, pending.vsSrc, "vertex"],
        [pending.fs, pending.fsSrc, "fragment"],
      ] as const) {
        if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) continue;
        const log = gl.getShaderInfoLog(shader) ?? "(no log)";
        problems.push(`${kind} shader failed to compile:\n${log}\n${annotateSource(src, log)}`);
      }
      if (problems.length === 0) problems.push(`program failed to link:\n${gl.getProgramInfoLog(this.handle)}`);
      throw new Error(`[${label}] ${problems.join("\n")}`);
    }
    gl.deleteShader(pending.vs);
    gl.deleteShader(pending.fs);
    this.pending = null;
    const frameIndex = gl.getUniformBlockIndex(this.handle, "Frame");
    if (frameIndex !== gl.INVALID_INDEX) gl.uniformBlockBinding(this.handle, frameIndex, 0);
  }

  use(): this {
    this.gl.useProgram(this.handle);
    return this;
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locations.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.handle, name);
      this.locations.set(name, l);
    }
    return l;
  }

  i(name: string, v: number): this {
    this.gl.uniform1i(this.loc(name), v);
    return this;
  }

  f(name: string, v: number): this {
    this.gl.uniform1f(this.loc(name), v);
    return this;
  }

  f2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.loc(name), x, y);
    return this;
  }

  f3(name: string, x: number, y: number, z: number): this {
    this.gl.uniform3f(this.loc(name), x, y, z);
    return this;
  }

  f4(name: string, x: number, y: number, z: number, w: number): this {
    this.gl.uniform4f(this.loc(name), x, y, z, w);
    return this;
  }

  f4v(name: string, data: Float32Array): this {
    this.gl.uniform4fv(this.loc(name), data);
    return this;
  }
}

export interface TextureOptions {
  width: number;
  height: number;
  internalFormat: number;
  format: number;
  type: number;
  filter?: number;
  wrap?: number;
  data?: ArrayBufferView | null;
}

export function createTexture(gl: GL, o: TextureOptions): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("createTexture failed");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, o.internalFormat, o.width, o.height, 0, o.format, o.type, o.data ?? null);
  const filter = o.filter ?? gl.LINEAR;
  const wrap = o.wrap ?? gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return tex;
}

/** A color texture + framebuffer, optionally with a depth renderbuffer. */
export class RenderTarget {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  depth: WebGLRenderbuffer | null = null;

  constructor(
    private readonly gl: GL,
    public width: number,
    public height: number,
    private readonly internalFormat: number,
    private readonly format: number,
    private readonly type: number,
    private readonly withDepth = false,
    private readonly filter?: number,
  ) {
    this.texture = this.makeTexture();
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error("createFramebuffer failed");
    this.fbo = fbo;
    this.attach();
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.gl.deleteTexture(this.texture);
    if (this.depth) this.gl.deleteRenderbuffer(this.depth);
    this.texture = this.makeTexture();
    this.attach();
  }

  bind(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo);
    this.gl.viewport(0, 0, this.width, this.height);
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteFramebuffer(this.fbo);
    if (this.depth) this.gl.deleteRenderbuffer(this.depth);
  }

  private makeTexture(): WebGLTexture {
    const { gl } = this;
    return createTexture(gl, {
      width: this.width,
      height: this.height,
      internalFormat: this.internalFormat,
      format: this.format,
      type: this.type,
      filter: this.filter ?? gl.LINEAR,
    });
  }

  private attach(): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    if (this.withDepth) {
      this.depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.width, this.height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    }
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
