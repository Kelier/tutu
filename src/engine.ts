// WebGPU 渲染引擎：源帧 → Kuwahara×2 → 细节线 → 量化(ping-pong) → 众数滤波×2 → (方向场) → 模板合成
// 所有管线异步编译；合成管线按模板懒编译并缓存，首帧只等当前模板。
import { WGSL, UNIFORM_ROWS, FLOW_STYLES } from './shaders';
import type { Lab } from './palette';

export interface StyleParams {
  kuwR: number; chroma: number; hyst: number;
  spacing: number; pressure: number; grain: number; lineW: number;
  wobble: number; edgeTh: number; hatchAng: number; cross: number; detail: number;
  maskOn: boolean; bgPaper: boolean;
  shadowOn: boolean; shadowAng: number; shadowDist: number;
  motion: number; motionAmt: number;
  style: number; tone: number; focusStr: number; bgSimp: number;
  post: number; postAmt: number;   // 画面后期：0 = 无，1–15 见 POSTS
  paper: [number, number, number]; ink: [number, number, number]; shadowCol: [number, number, number];
}

/** 焦点：源图 uv 空间的椭圆（中心 + 半径）与权重 */
export interface Focus { cx: number; cy: number; rx: number; ry: number; w: number; kind: 'face' | 'person' | 'manual' }

/** 人脸关键点（源图 uv）：右眼、左眼、嘴、脸宽 */
export interface FaceKeys { eyeR: [number, number]; eyeL: [number, number]; mouth: [number, number]; size: number }

/** 漫画加料：集中线 / 速度线（中心为输出 uv） */
export interface Fx { radial: boolean; speed: boolean; amt: number; cx: number; cy: number }

export interface FrameOpts {
  width: number; height: number;
  time: number; boil: number;
  sticker: boolean; border: number;
  viewOff: [number, number]; viewScale: [number, number];
}

const WORK_FMT: GPUTextureFormat = 'rgba8unorm';
const PASSES: [string, string, GPUTextureFormat][] = [
  ['kuwahara', 'fs_kuwahara', WORK_FMT], ['edge', 'fs_edge', WORK_FMT], ['quant', 'fs_quant', WORK_FMT],
  ['mode', 'fs_mode', WORK_FMT], ['tensor', 'fs_tensor', 'rgba16float'], ['flow', 'fs_flow', WORK_FMT],
];

export class Engine {
  device: GPUDevice;
  ctx: GPUCanvasContext;
  canvasFormat: GPUTextureFormat;
  private ubuf: GPUBuffer;
  private u = new Float32Array(UNIFORM_ROWS * 4);
  private layout: GPUBindGroupLayout;
  private plLayout: GPUPipelineLayout;
  private module: GPUShaderModule;
  private pipes: Record<string, GPURenderPipeline> = {};
  private finals = new Map<string, GPURenderPipeline>();
  private finalsPending = new Map<string, Promise<GPURenderPipeline>>();
  private sampler: GPUSampler;
  private tex: Record<string, GPUTexture> = {};
  private maskTex!: GPUTexture;
  private overlayTex!: GPUTexture;
  private ovOn = false;
  private quantFlip = false;
  private palette: Lab[] = [];
  private focus: Focus[] = [];
  private feats: FaceKeys[] = [];
  private featOn = false;
  private fx: Fx = { radial: false, speed: false, amt: 1, cx: 0.5, cy: 0.4 };
  private flowReady = false;
  work = { w: 0, h: 0 };
  lostReason: string | null = null;
  errors: string[] = [];

  private constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
    this.device = device;
    this.ctx = canvas.getContext('webgpu')!;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format: this.canvasFormat, alphaMode: 'premultiplied' });
    this.ubuf = device.createBuffer({ size: this.u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const tex = { texture: { sampleType: 'float' as GPUTextureSampleType } };
    const F = GPUShaderStage.FRAGMENT;
    this.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, buffer: {} },
        { binding: 1, visibility: F, ...tex }, { binding: 2, visibility: F, ...tex }, { binding: 3, visibility: F, ...tex },
        { binding: 4, visibility: F, sampler: {} },
        { binding: 5, visibility: F, ...tex }, { binding: 6, visibility: F, ...tex }, { binding: 7, visibility: F, ...tex },
      ],
    });
    this.module = device.createShaderModule({ code: WGSL });
    this.plLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    this.setMask(new Uint8Array([255]), 1, 1);
    this.overlayTex = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  }

  private desc(entry: string, format: GPUTextureFormat, style = 0): GPURenderPipelineDescriptor {
    return {
      layout: this.plLayout,
      vertex: { module: this.module, entryPoint: 'vs' },
      fragment: { module: this.module, entryPoint: entry, targets: [{ format }], constants: { STYLE: style } },
      primitive: { topology: 'triangle-list' },
    };
  }

  /** 创建设备并异步编译预处理管线 + 首个模板的合成管线 */
  static async create(canvas: HTMLCanvasElement, firstStyle: number, onStep?: (s: string) => void): Promise<Engine> {
    if (!navigator.gpu) throw new Error('当前浏览器不支持 WebGPU（请使用 Chrome / Edge 113+ 或 Safari 26+）');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('没有可用的 GPU 适配器');
    const device = await adapter.requestDevice();
    const eng = new Engine(device, canvas);
    device.lost.then((info) => { eng.lostReason = info.message || 'GPU 设备丢失'; });
    device.addEventListener('uncapturederror', (e) => eng.errors.push((e as GPUUncapturedErrorEvent).error.message));
    onStep?.('编译着色器');
    await Promise.all([
      ...PASSES.map(async ([k, entry, fmt]) => { eng.pipes[k] = await device.createRenderPipelineAsync(eng.desc(entry, fmt)); }),
      eng.ensureFinal(firstStyle),
    ]);
    return eng;
  }

  /** 合成管线：按模板 × 目标格式懒编译 */
  ensureFinal(style: number, format: GPUTextureFormat = this.canvasFormat): Promise<GPURenderPipeline> {
    const key = `${style}:${format}`;
    const done = this.finals.get(key);
    if (done) return Promise.resolve(done);
    let p = this.finalsPending.get(key);
    if (!p) {
      p = this.device.createRenderPipelineAsync(this.desc('fs_final', format, style)).then((pipe) => {
        this.finals.set(key, pipe); this.finalsPending.delete(key); return pipe;
      });
      this.finalsPending.set(key, p);
    }
    return p;
  }
  hasFinal(style: number) { return this.finals.has(`${style}:${this.canvasFormat}`); }

  setWorkSize(w: number, h: number) {
    if (w === this.work.w && h === this.work.h) return;
    for (const t of Object.values(this.tex)) t.destroy();
    this.work = { w, h };
    const mk = (format: GPUTextureFormat = WORK_FMT) => this.device.createTexture({
      size: [w, h], format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
    });
    this.tex = { src: mk(), tmp: mk(), simp: mk(), edge: mk(), qRaw: mk(), qTmp: mk(), qA: mk(), qB: mk(), tensor: mk('rgba16float'), flow: mk() };
    this.flowReady = false;
  }

  setMask(data: Uint8Array, w: number, h: number) {
    if (!this.maskTex || this.maskTex.width !== w || this.maskTex.height !== h) {
      this.maskTex?.destroy();
      this.maskTex = this.device.createTexture({ size: [w, h], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    }
    this.device.queue.writeTexture({ texture: this.maskTex }, data as Uint8Array<ArrayBuffer>, { bytesPerRow: w }, [w, h]);
  }

  /** 叠加层（拟声字、气泡）：与输出同尺寸的画布；null 关闭 */
  setOverlay(src: OffscreenCanvas | HTMLCanvasElement | null) {
    this.ovOn = !!src;
    if (!src) return;
    if (this.overlayTex.width !== src.width || this.overlayTex.height !== src.height) {
      this.overlayTex.destroy();
      this.overlayTex = this.device.createTexture({ size: [src.width, src.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    }
    this.device.queue.copyExternalImageToTexture({ source: src }, { texture: this.overlayTex }, [src.width, src.height]);
  }

  setPalette(labs: Lab[]) { this.palette = labs.slice(0, 16); }
  setFocus(list: Focus[]) { this.focus = list.slice(0, 4); }
  setFeatures(on: boolean, list: FaceKeys[]) { this.featOn = on && list.length > 0; this.feats = list.slice(0, 2); }
  setFx(fx: Fx) { this.fx = fx; }

  private writeUniforms(p: StyleParams, f: Partial<FrameOpts> & { first?: boolean }) {
    const u = this.u;
    const set = (row: number, ...v: number[]) => v.forEach((x, i) => (u[row * 4 + i] = x));
    set(0, f.width ?? this.work.w, f.height ?? this.work.h, this.work.w, this.work.h);
    set(1, f.time ?? 0, f.boil ?? 0, p.maskOn ? 1 : 0, f.sticker ? 1 : 0);
    // 简化半径按 512 基准随工作分辨率缩放，换分辨率观感不变
    set(2, p.kuwR * Math.max(this.work.w, this.work.h) / 512, this.palette.length, p.chroma, p.hyst);
    set(3, p.spacing, p.pressure, p.grain, p.lineW);
    set(4, p.wobble, p.edgeTh, (p.hatchAng * Math.PI) / 180, p.cross);
    set(5, p.shadowOn ? 1 : 0, (p.shadowAng * Math.PI) / 180, p.shadowDist, p.bgPaper ? 1 : 0);
    set(6, f.border ?? 0, p.motion, p.motionAmt, p.detail);
    set(7, ...(f.viewOff ?? [0, 0]), ...(f.viewScale ?? [1, 1]));
    set(8, f.first ? 1 : 0, p.style, p.tone, this.focus.length);
    set(9, p.focusStr, p.bgSimp, this.featOn ? 1 : 0, this.feats.length);
    set(10, ...p.paper, 1); set(11, ...p.ink, 1); set(12, ...p.shadowCol, 1);
    set(13, ...[0, 1, 2, 3].map((i) => (this.focus[i]?.kind === 'face' ? 1 : 0)));
    for (let i = 0; i < 4; i++) { const fo = this.focus[i]; set(14 + i, fo?.cx ?? 0, fo?.cy ?? 0, fo?.rx ?? 0, fo?.ry ?? 0); }
    set(18, ...[0, 1, 2, 3].map((i) => this.focus[i]?.w ?? 0));
    for (let i = 0; i < 16; i++) set(19 + i, ...(this.palette[i] ?? [0, 0, 0]), 0);
    set(35, this.fx.radial ? 1 : 0, this.fx.speed ? 1 : 0, this.fx.amt, this.ovOn ? 1 : 0);
    set(36, this.fx.cx, this.fx.cy, p.post, p.postAmt);
    for (let i = 0; i < 2; i++) {
      const k = this.feats[i];
      set(37 + i * 2, ...(k?.eyeR ?? [0, 0]), ...(k?.eyeL ?? [0, 0]));
      set(38 + i * 2, ...(k?.mouth ?? [0, 0]), k?.size ?? 0, 0);
    }
    this.device.queue.writeBuffer(this.ubuf, 0, u);
  }

  private bind(a: GPUTexture, b: GPUTexture, m: GPUTexture, c: GPUTexture = this.tex.src, d: GPUTexture = this.tex.src, e: GPUTexture = this.tex.src) {
    return this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.ubuf } },
        { binding: 1, resource: a.createView() },
        { binding: 2, resource: b.createView() },
        { binding: 3, resource: m.createView() },
        { binding: 4, resource: this.sampler },
        { binding: 5, resource: c.createView() },
        { binding: 6, resource: d.createView() },
        { binding: 7, resource: e.createView() },
      ],
    });
  }

  private pass(enc: GPUCommandEncoder, pipe: GPURenderPipeline, target: GPUTextureView, bg: GPUBindGroup) {
    const p = enc.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    p.setPipeline(pipe); p.setBindGroup(0, bg); p.draw(3); p.end();
  }

  get quantCur() { return this.quantFlip ? this.tex.qB : this.tex.qA; }
  get quantPrev() { return this.quantFlip ? this.tex.qA : this.tex.qB; }

  private quantPasses(enc: GPUCommandEncoder) {
    const { tex, maskTex: M } = this;
    this.pass(enc, this.pipes.quant, tex.qRaw.createView(), this.bind(tex.simp, this.quantPrev, M));
    this.pass(enc, this.pipes.mode, tex.qTmp.createView(), this.bind(tex.qRaw, tex.qRaw, M));
    this.pass(enc, this.pipes.mode, this.quantCur.createView(), this.bind(tex.qTmp, tex.qTmp, M));
  }
  private flowPasses(enc: GPUCommandEncoder) {
    const { tex, maskTex: M } = this;
    this.pass(enc, this.pipes.tensor, tex.tensor.createView(), this.bind(tex.simp, tex.simp, M));
    this.pass(enc, this.pipes.flow, tex.flow.createView(), this.bind(tex.tensor, tex.tensor, M));
    this.flowReady = true;
  }

  /** 处理一帧源图（已缩放到工作尺寸）：去细节 → 细节线 → 量化 → 众数滤波 →（需要时）方向场 */
  process(bitmap: ImageBitmap, p: StyleParams, first: boolean) {
    const { device, tex, maskTex: M } = this;
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex.src }, [this.work.w, this.work.h]);
    this.quantFlip = !this.quantFlip;
    this.writeUniforms(p, { first });
    const enc = device.createCommandEncoder();
    this.pass(enc, this.pipes.kuwahara, tex.tmp.createView(), this.bind(tex.src, tex.src, M));
    this.pass(enc, this.pipes.kuwahara, tex.simp.createView(), this.bind(tex.tmp, tex.tmp, M));
    this.pass(enc, this.pipes.edge, tex.edge.createView(), this.bind(tex.simp, tex.simp, M));
    this.quantPasses(enc);
    this.flowReady = false;
    if (FLOW_STYLES.has(p.style)) this.flowPasses(enc);
    device.queue.submit([enc.finish()]);
  }

  /** 只换色板时用：沿用已去细节的图，重新量化（模板缩略图用，很快） */
  requant(p: StyleParams) {
    this.quantFlip = !this.quantFlip;
    this.writeUniforms(p, { first: true });
    const enc = this.device.createCommandEncoder();
    this.quantPasses(enc);
    if (FLOW_STYLES.has(p.style) && !this.flowReady) this.flowPasses(enc);
    this.device.queue.submit([enc.finish()]);
  }

  private finalBind() {
    return this.bind(this.quantCur, this.tex.edge, this.maskTex, this.tex.simp, this.tex.flow, this.overlayTex);
  }

  /** 合成到画布；管线还没编译好就跳过这一帧（保持上一帧），返回是否画了 */
  renderToCanvas(p: StyleParams, f: FrameOpts): boolean {
    const pipe = this.finals.get(`${p.style}:${this.canvasFormat}`);
    if (!pipe) { this.ensureFinal(p.style); return false; }
    if (FLOW_STYLES.has(p.style) && !this.flowReady) return false;
    const canvas = this.ctx.canvas as HTMLCanvasElement;
    if (canvas.width !== f.width || canvas.height !== f.height) { canvas.width = f.width; canvas.height = f.height; }
    this.writeUniforms(p, f);
    const enc = this.device.createCommandEncoder();
    this.pass(enc, pipe, this.ctx.getCurrentTexture().createView(), this.finalBind());
    this.device.queue.submit([enc.finish()]);
    return true;
  }

  /** 合成到离屏纹理并读回 RGBA（非预乘） */
  async renderToPixels(p: StyleParams, f: FrameOpts): Promise<Uint8Array> {
    const { device } = this;
    const pipe = await this.ensureFinal(p.style, 'rgba8unorm');
    const { width: w, height: h } = f;
    const target = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const bpr = Math.ceil((w * 4) / 256) * 256;
    const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.writeUniforms(p, f);
    const enc = device.createCommandEncoder();
    this.pass(enc, pipe, target.createView(), this.finalBind());
    enc.copyTextureToBuffer({ texture: target }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) out.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
    buf.unmap(); buf.destroy(); target.destroy();
    for (let i = 0; i < out.length; i += 4) {
      const a = out[i + 3];
      if (a > 0 && a < 255) {
        out[i] = Math.min(255, (out[i] * 255) / a);
        out[i + 1] = Math.min(255, (out[i + 1] * 255) / a);
        out[i + 2] = Math.min(255, (out[i + 2] * 255) / a);
      }
    }
    return out;
  }
}
