import { typography, initTypography, ensureArtFont, fontFamily } from './typography';
import { POSTS } from './post';
import { Engine, type StyleParams, type FrameOpts, type Focus, type FaceKeys } from './engine';
import { computeMask, type MaskResult } from './mask';
import { autoPalette, crayonize, hexToRgb, labToHex, rgbToOklab, type Lab } from './palette';
import { TEMPLATES, type Template, type ControlKey } from './templates';
import { drawOverlay } from './overlay';

// ---------------- 状态 ----------------
type Mode = 'scene' | 'sticker';
interface UiState {
  mode: Mode; palMode: 'template' | 'auto'; palCount: number; tol: number;
  boilEvery: number; fps: number; sceneSize: number; stickerSize: number;
  paperHex: string; inkHex: string; shadowHex: string; autoFocus: boolean;
  featOn: boolean; fxRadial: boolean; fxSpeed: boolean; fxAmt: number; sfx: string; bubble: string;
  journal: boolean; title: string; caption: string; sparkles: boolean;
  format: 'gif' | 'motion' | 'live' | 'mp4';
}

const params: StyleParams = {
  style: 0, kuwR: 5, chroma: 1.35, hyst: 1.25,
  spacing: 6, pressure: 0.9, grain: 0.55, lineW: 2.0,
  wobble: 2.0, edgeTh: 0.14, hatchAng: 35, cross: 0.35, detail: 0.4,
  tone: 0.6, focusStr: 0.85, bgSimp: 0.5, subjDetail: 0, detailSens: 0.5, post: 0, postAmt: 1,
  maskOn: false, bgPaper: false,
  shadowOn: true, shadowAng: 135, shadowDist: 14,
  motion: 0, motionAmt: 1,
  paper: hexToRgb('#ebe3d7'), ink: hexToRgb('#2a2018'), shadowCol: hexToRgb('#2f6f78'),
};
const ui: UiState = {
  mode: 'scene', palMode: 'template', palCount: 8, tol: 0.07,
  boilEvery: 2, fps: 12.5, sceneSize: 480, stickerSize: 320,
  paperHex: '#ebe3d7', inkHex: '#2a2018', shadowHex: '#2f6f78', autoFocus: true,
  featOn: false, fxRadial: false, fxSpeed: false, fxAmt: 1, sfx: '', bubble: '',
  journal: false, title: '今天的小回忆', caption: 'a small memory', sparkles: false,
  format: 'gif',
};
let tpl: Template = TEMPLATES[0];

type Source =
  | { kind: 'image'; el: ImageBitmap; w: number; h: number; name: string }
  | { kind: 'video'; el: HTMLVideoElement; w: number; h: number; name: string; start: number };

let engine: Engine;
let source: Source | null = null;
let W = 0, H = 0, MW = 0, MH = 0;
let maskRes: MaskResult | null = null;
let stickerBBox: [number, number, number, number] = [0, 0, 1, 1];
let autoCache: { k: number; labs: Lab[] } | null = null;
let maskImage: ImageData | null = null;
let busy = false, exporting = false, playing = true, thumbing = false;
let dirty = true;
let t0 = performance.now(), pausedAt = 0;
let lastVideoStep = -1, processing = false;
let autoFoci: Focus[] = [];
let faceKeys: FaceKeys[] = [];
let manualFocus: Focus | null = null;
let lastDetect = 0, detecting = false;
let lastView: { off: [number, number]; scale: [number, number] } = { off: [0, 0], scale: [1, 1] };
let firstFrameShown = false;
let renderVersion = 0;          // 任何会影响画面的状态变化都 +1；预览只在帧号 / 尺寸 / 版本变化时重画
let lastRenderKey = '';
const bump = () => { renderVersion++; };
let sourceToken = 0;

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const $$ = <T extends HTMLElement = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
const canvas = $<HTMLCanvasElement>('#view');
const stage = $('#stage');
const maskCanvas = new OffscreenCanvas(1, 1);
const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
const overlayCanvas = new OffscreenCanvas(1, 1);
let overlayKey = '';

// GPU 任务锁：缩略图、导出都会临时改引擎状态（色板 / 量化纹理），必须串行
let gpuChain: Promise<unknown> = Promise.resolve();
function withGpu<T>(fn: () => Promise<T>): Promise<T> {
  const run = gpuChain.then(fn, fn);
  gpuChain = run.catch(() => {});
  return run;
}

const idle = (fn: () => void, timeout = 1500) =>
  ('requestIdleCallback' in window ? (window as any).requestIdleCallback(fn, { timeout }) : setTimeout(fn, 60));

function bootStep(text: string, p: number) {
  $('#bootStep').textContent = text;
  $('#bootBar').style.transform = `scaleX(${p})`;
}

// ---------------- 源加载 ----------------
function fitLong(w: number, h: number, long: number) {
  const s = long / Math.max(w, h);
  return [Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s))];
}

async function loadFile(file: File) {
  if (file.type.startsWith('video/')) return loadVideo(URL.createObjectURL(file), file.name);
  if (file.type.startsWith('image/')) return loadImage(await createImageBitmap(file, { imageOrientation: 'from-image' }), file.name);
  toast('只支持图片或视频文件');
}

async function loadImageUrl(url: string, name: string) {
  const blob = await (await fetch(url)).blob();
  return loadImage(await createImageBitmap(blob), name);
}

async function loadImage(bmp: ImageBitmap, name: string) {
  stopVideo();
  source = { kind: 'image', el: bmp, w: bmp.width, h: bmp.height, name };
  await prepareSource();
}

async function loadVideo(url: string, name: string) {
  stopVideo();
  const v = document.createElement('video');
  v.src = url; v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous'; v.preload = 'auto';
  await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('视频无法解码')); });
  source = { kind: 'video', el: v, w: v.videoWidth, h: v.videoHeight, name, start: 0 };
  const trim = $<HTMLInputElement>('#trim');
  trim.max = String(Math.max(0, v.duration - 3));
  trim.value = '0';
  $('#trimRow').hidden = false;
  updateTrimLabel();
  await seek(v, 0);
  await prepareSource();
  if (playing) v.play().catch(() => {});
}

function stopVideo() {
  if (source?.kind === 'video') { source.el.pause(); URL.revokeObjectURL(source.el.src); }
  $('#trimRow').hidden = true;
}

function seek(v: HTMLVideoElement, t: number) {
  return new Promise<void>((res) => {
    if (Math.abs(v.currentTime - t) < 1e-3 && v.readyState >= 2) return res();
    const done = () => { v.removeEventListener('seeked', done); res(); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

function grabMaskImage(el: CanvasImageSource) {
  maskCtx.clearRect(0, 0, MW, MH);
  maskCtx.drawImage(el, 0, 0, MW, MH);
  return maskCtx.getImageData(0, 0, MW, MH);
}

async function prepareSource() {
  if (!source) return;
  const token = ++sourceToken;
  [W, H] = fitLong(source.w, source.h, matchMedia('(max-width: 600px)').matches ? 512 : 768);
  [MW, MH] = fitLong(source.w, source.h, 256);
  maskCanvas.width = MW; maskCanvas.height = MH;
  engine.setWorkSize(W, H);
  maskImage = grabMaskImage(source.el);
  autoCache = null;
  maskRes = null;
  manualFocus = null; autoFoci = []; faceKeys = [];
  applyFocus();
  runMask(true);
  stickerBBox = expandBBox(maskRes!.bbox, 0.04);
  uploadPalette();
  await processFrame(true);
  updateSourceInfo();
  stage.classList.add('has-source');
  t0 = performance.now();
  // 识别与模板缩略图都放到空闲时做，不挡首帧
  thumbUrls.forEach((u) => URL.revokeObjectURL(u)); thumbUrls.clear();
  $$<HTMLImageElement>('.tpl img').forEach((img) => img.removeAttribute('src'));
  idle(() => { if (token === sourceToken) runDetection(true); });
  queueThumbs();
}

function updateSourceInfo() {
  if (!source) return;
  $('#sourceName').textContent = source.name;
  $('#sourceMeta').textContent = `${source.kind === 'video' ? '视频' : '图片'} · ${source.w}×${source.h}${source.kind === 'video' ? ` · ${source.el.duration.toFixed(1)}s` : ''}`;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  const s = Math.max(64 / source.w, 64 / source.h);
  ctx.drawImage(source.el, (64 - source.w * s) / 2, (64 - source.h * s) / 2, source.w * s, source.h * s);
  $('#sourceThumb').style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.8)})`;
}

function expandBBox([x0, y0, x1, y1]: number[], m: number): [number, number, number, number] {
  return [Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(1, x1 + m), Math.min(1, y1 + m)];
}

function runMask(autoToggle: boolean, prev?: Uint8Array | null) {
  if (!maskImage) return;
  maskRes = computeMask(maskImage, ui.tol, prev);
  engine.setMask(maskRes.mask, MW, MH);
  if (autoToggle) { params.maskOn = maskRes.confident; syncControls(); }
  const s = document.querySelector<HTMLElement>('#maskStatus');
  if (s) {
    s.textContent = maskRes.fromAlpha ? '使用 PNG 透明通道' : maskRes.confident ? '已识别主体（背景较干净）' : '背景较复杂，建议关闭';
    s.dataset.ok = String(maskRes.confident);
  }
}

function paletteFor(t: Template, mode: UiState['palMode']): Lab[] {
  if (mode === 'auto' && !t.hide?.includes('palette')) {
    if (!autoCache || autoCache.k !== ui.palCount) {
      autoCache = { k: ui.palCount, labs: maskImage ? autoPalette(maskImage, ui.palCount) : [] };
    }
    return autoCache.labs.map((l) => crayonize(l, params.chroma));
  }
  return t.palette.map((h) => rgbToOklab(...hexToRgb(h)));
}

function uploadPalette() {
  const labs = paletteFor(tpl, ui.palMode);
  engine.setPalette(labs);
  const sw = document.querySelector('#swatches');
  if (sw) sw.innerHTML = labs.map((l) => `<i style="background:${labToHex(l)}"></i>`).join('');
}

/** 把当前源帧送进 GPU：缩放 → (视频)更新遮罩 → 去细节/量化 */
async function processFrame(first: boolean) {
  if (!source) return;
  const bmp = await createImageBitmap(source.el, { resizeWidth: W, resizeHeight: H, resizeQuality: 'high' });
  if (source.kind === 'video') {
    maskImage = grabMaskImage(source.el);
    if (params.maskOn || ui.mode === 'sticker') runMask(false, first ? null : maskRes?.mask);
  }
  engine.process(bmp, params, first);
  bmp.close();
  bump();
}

// ---------------- 主体识别 / 焦点 / 五官 ----------------
function applyFocus() {
  const list: Focus[] = [];
  if (manualFocus) list.push(manualFocus);
  if (ui.autoFocus) list.push(...autoFoci);
  engine.setFocus(list);
  engine.setFeatures(ui.featOn && ui.autoFocus, faceKeys);
  drawFocusRings(list.slice(0, 4));
  dirty = true;
  bump();
}

/** 集中线中心 / 气泡指向：人脸 > 手动焦点 > 主体 > 画面中上（输出 uv） */
function anchorUv(view = lastView): [number, number] | null {
  const f = faceKeys[0]
    ? { cx: faceKeys[0].mouth[0], cy: (faceKeys[0].eyeR[1] + faceKeys[0].mouth[1]) / 2 }
    : manualFocus ?? autoFoci[0];
  if (!f) return null;
  return [(f.cx - view.off[0]) / view.scale[0], (f.cy - view.off[1]) / view.scale[1]];
}

async function runDetection(announce: boolean) {
  if (!source || !ui.autoFocus || detecting) return;
  detecting = true;
  lastDetect = performance.now();
  const token = sourceToken;
  const status = document.querySelector<HTMLElement>('#focusStatus');
  if (status && announce) { status.textContent = '加载识别模型…'; status.dataset.ok = ''; }
  try {
    const { detectSubjects } = await import('./detect');
    if (status && announce) status.textContent = '识别中…';
    // 识别（WebGL）与 WebGPU 任务串行，避免部分驱动下两者同时提交时卡住
    const src = source;
    const res = await withGpu(() => detectSubjects(src.el, src.w, src.h));
    if (token !== sourceToken) return;
    autoFoci = res.foci; faceKeys = res.keys;
    const faces = autoFoci.filter((f) => f.kind === 'face').length;
    const others = autoFoci.length - faces;
    if (status) {
      status.textContent = autoFoci.length
        ? [faces ? `${faces} 张脸` : '', others ? `${others} 个主体` : ''].filter(Boolean).join(' · ')
        : '没有识别到人或动物，可手动设焦点';
      status.dataset.ok = String(autoFoci.length > 0);
    }
    applyFocus();
    syncControls();
    if (announce && autoFoci.length) flashFocus();
  } catch (e) {
    if (status) { status.textContent = '识别模型加载失败，可手动设焦点'; status.dataset.ok = 'false'; }
    console.warn(e);
  } finally {
    detecting = false;
  }
}

const KIND_LABEL = { face: '人脸', person: '主体', manual: '焦点' };
function drawFocusRings(list: Focus[]) {
  const layer = $('#focusLayer');
  const { off, scale } = lastView;
  layer.innerHTML = list.map((f) => {
    const cx = (f.cx - off[0]) / scale[0], cy = (f.cy - off[1]) / scale[1];
    const rx = f.rx / scale[0], ry = f.ry / scale[1];
    return `<div class="ring ring-${f.kind}" style="left:${(cx - rx) * 100}%;top:${(cy - ry) * 100}%;width:${rx * 200}%;height:${ry * 200}%"><span>${KIND_LABEL[f.kind]}</span></div>`;
  }).join('');
}
let flashTimer = 0;
function flashFocus() {
  stage.classList.add('show-focus');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => stage.classList.remove('show-focus'), 2600);
}

function setPicking(on: boolean) {
  stage.classList.toggle('picking', on);
  $('#focusBtn').classList.toggle('on', on);
}

// ---------------- 漫画加料 ----------------
/** 更新集中线中心 + 叠加层（只在尺寸 / boil / 文字 / 位置变化时重画） */
function updateFx(w: number, h: number, boil: number, view = lastView) {
  const a = anchorUv(view);
  engine.setFx({ radial: ui.fxRadial, speed: ui.fxSpeed, amt: ui.fxAmt, cx: a?.[0] ?? 0.5, cy: a?.[1] ?? 0.4 });
  const frame = journalFrame(ui.mode);
  const key = `${w}x${h}|${boil}|${ui.sfx}|${ui.bubble}|${a?.map((v) => v.toFixed(3))}|${!!frame}|${ui.title}|${ui.caption}|${ui.sparkles}|${JSON.stringify(typography)}`;
  if (key === overlayKey) return;
  overlayKey = key;
  const drawn = drawOverlay(overlayCanvas, w, h, boil, { sfx: ui.sfx, bubble: ui.bubble, anchor: a, title: ui.title, caption: ui.caption, sparkles: ui.sparkles, frame, type: typography, font: fontFamily() });
  engine.setOverlay(drawn ? overlayCanvas : null);
  bump();
}

// ---------------- 帧参数 ----------------
function totalFrames() { return Math.round(3 * ui.fps); }
function boilAt(frame: number) {
  const steps = Math.ceil(totalFrames() / ui.boilEvery);
  return Math.floor(frame / ui.boilEvery) % steps;
}

/** 手账边框留白（输出 uv）：上边放标题、下边放落款 */
const FRAME = { top: 0.13, bottom: 0.08, side: 0.06 };
const journalFrame = (mode: Mode) => (ui.journal && mode === 'scene' ? FRAME : null);

function frameOpts(width: number, height: number, frame: number, mode: Mode = ui.mode): FrameOpts {
  const sticker = mode === 'sticker';
  let viewOff: [number, number] = [0, 0], viewScale: [number, number] = [1, 1];
  const jf = journalFrame(mode);
  if (jf) {
    viewScale = [1 / (1 - 2 * jf.side), 1 / (1 - jf.top - jf.bottom)];
    viewOff = [-jf.side * viewScale[0], -jf.top * viewScale[1]];
  }
  if (sticker) {
    const [x0, y0, x1, y1] = params.maskOn ? stickerBBox : [0, 0, 1, 1];
    const bw = (x1 - x0) * W, bh = (y1 - y0) * H;
    const pad = 0.12;
    const k = Math.max(bw, bh) / (width * (1 - 2 * pad));
    viewScale = [(width * k) / W, (height * k) / H];
    viewOff = [(x0 + x1) / 2 - viewScale[0] / 2, (y0 + y1) / 2 - viewScale[1] / 2];
  }
  return { width, height, time: frame / ui.fps, boil: boilAt(frame), sticker, border: width * 0.03, viewOff, viewScale };
}

function exportDims(): [number, number] {
  if (ui.mode === 'sticker') return [ui.stickerSize, ui.stickerSize];
  const [w, h] = fitLong(W, H, ui.sceneSize);
  return [w & ~1, h & ~1];
}

// ---------------- 预览循环 ----------------
function previewDims(): [number, number] {
  const box = $('#canvasWrap').getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  const pad = matchMedia('(max-width: 600px)').matches ? 24 : 56;
  const availW = Math.max(1, box.width - pad), availH = Math.max(1, box.height - pad);
  const aspect = ui.mode === 'sticker' ? 1 : W / H;
  let cw = availW, ch = cw / aspect;
  if (ch > availH) { ch = availH; cw = ch * aspect; }
  const sw = `${Math.round(cw)}px`, sh = `${Math.round(ch)}px`;
  if (canvas.style.width !== sw || canvas.style.height !== sh) { canvas.style.width = sw; canvas.style.height = sh; }
  const cap = ui.mode === 'sticker' ? 720 : 1100;
  const s = Math.min(dpr, cap / Math.max(cw, ch));
  return [Math.round(cw * s), Math.round(ch * s)];
}

function tick() {
  requestAnimationFrame(tick);
  if (!source || exporting || thumbing || engine.lostReason) return;
  let t: number;
  if (source.kind === 'video') {
    const v = source.el;
    if (v.currentTime >= source.start + 3 || v.currentTime < source.start - 0.05) v.currentTime = source.start;
    t = Math.max(0, v.currentTime - source.start);
    const step = Math.floor(v.currentTime * ui.fps);
    if (step !== lastVideoStep && !processing) {
      lastVideoStep = step; processing = true;
      processFrame(false).finally(() => (processing = false));
    }
    if (ui.autoFocus && firstFrameShown && performance.now() - lastDetect > 1200) runDetection(false);
  } else {
    if (dirty && !busy) { dirty = false; busy = true; processFrame(true).finally(() => (busy = false)); }
    t = playing ? ((performance.now() - t0) / 1000) % 3 : pausedAt;
  }
  const frame = Math.min(totalFrames() - 1, Math.floor(t * ui.fps));
  const [pw, ph] = previewDims();
  const fo = frameOpts(pw, ph, frame);
  if (fo.viewOff[0] !== lastView.off[0] || fo.viewOff[1] !== lastView.off[1] || fo.viewScale[0] !== lastView.scale[0]) {
    lastView = { off: fo.viewOff, scale: fo.viewScale };
    applyFocus();
  }
  updateFx(pw, ph, fo.boil);
  // 动画是 12.5fps 的步进：只有帧号 / 尺寸 / 状态变了才重画，省下 GPU 给编译、缩略图和导出
  const key = `${frame}|${pw}x${ph}|${renderVersion}|${tpl.id}|${ui.mode}`;
  if (key === lastRenderKey && !stage.classList.contains('compiling')) { $('#timecode').textContent = `${t.toFixed(2)} / 3.00s`; return; }
  const drew = engine.renderToCanvas(params, fo);
  if (drew) lastRenderKey = key;
  stage.classList.toggle('compiling', !drew);
  if (drew && !firstFrameShown) {
    firstFrameShown = true;
    stage.classList.add('ready');
  }
  $('#timecode').textContent = `${t.toFixed(2)} / 3.00s`;
}

// ---------------- 模板缩略图：空闲时一张一张渲染，只重新量化，不重跑去细节 ----------------
const thumbUrls = new Map<string, string>();
let thumbQueue: Template[] = [];
let thumbScheduled = false;
const thumbObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const t = TEMPLATES.find((x) => x.id === (e.target as HTMLElement).dataset.id);
    if (e.isIntersecting && t && !thumbUrls.has(t.id) && !thumbQueue.includes(t)) thumbQueue.push(t);
  }
  pumpThumbs();
}, { root: null, rootMargin: '200px' });

function queueThumbs() {
  thumbQueue = [];
  $$('.tpl').forEach((el) => { thumbObserver.unobserve(el); thumbObserver.observe(el); });
}

function pumpThumbs() {
  if (thumbScheduled || !thumbQueue.length) return;
  thumbScheduled = true;
  idle(async () => {
    thumbScheduled = false;
    if (!source || exporting || detecting || !firstFrameShown) { setTimeout(pumpThumbs, 300); return; }
    const t = thumbQueue.shift();
    if (t && !thumbUrls.has(t.id)) await renderThumb(t);
    pumpThumbs();
  }, 800);
}

async function renderThumb(t: Template) {
  const token = sourceToken;
  await engine.ensureFinal(t.params.style, 'rgba8unorm');
  if (token !== sourceToken || exporting) return;
  await withGpu(async () => {
    if (token !== sourceToken || exporting) return;
    thumbing = true;
    const tp: StyleParams = { ...params, ...t.params, kuwR: params.kuwR, post: 0, paper: hexToRgb(t.paper), ink: hexToRgb(t.ink), shadowCol: hexToRgb(t.shadow) };
    try {
      const tw = 150, th = Math.round(Math.min(200, (150 * H) / W));
      engine.setPalette(paletteFor(t, 'template'));
      engine.requant(tp);
      engine.setOverlay(null); overlayKey = '';
      engine.setFx({ radial: false, speed: false, amt: 0, cx: 0.5, cy: 0.5 });
      const px = await engine.renderToPixels(tp, { ...frameOpts(tw, th, 0, 'scene'), viewOff: [0, 0], viewScale: [1, 1] });
      const c = new OffscreenCanvas(tw, th);
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), tw, th), 0, 0);
      const url = URL.createObjectURL(await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 }));
      if (token !== sourceToken) { URL.revokeObjectURL(url); return; }
      thumbUrls.set(t.id, url);
      const img = document.querySelector<HTMLImageElement>(`.tpl[data-id="${t.id}"] img`);
      if (img) img.src = url;
    } finally {
      uploadPalette();
      engine.requant(params);
      thumbing = false;
      bump();
    }
  });
}

async function prepareTypography() {
  if (typography.text || (typography.applyToJournal && (ui.journal || ui.sfx || ui.bubble))) await ensureArtFont();
}

// ---------------- 导出 ----------------
const gifWorker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });

function encodeGif(frames: ArrayBuffer[], width: number, height: number, transparent: boolean, onProgress: (p: number) => void) {
  return new Promise<Uint8Array>((resolve) => {
    gifWorker.onmessage = (e) => {
      if (e.data.done) resolve(e.data.bytes);
      else onProgress(e.data.progress);
    };
    gifWorker.postMessage({ frames, width, height, delay: Math.round(1000 / ui.fps), transparent }, frames);
  });
}

async function renderExportFrame(w: number, h: number, frame: number) {
  const fo = frameOpts(w, h, frame);
  overlayKey = '';
  updateFx(w, h, fo.boil, { off: fo.viewOff, scale: fo.viewScale });
  const px = await engine.renderToPixels(params, fo);
  overlayKey = '';
  return px;
}

function exportGif() { return withGpu(exportGifLocked); }
async function exportGifLocked() {
  if (!source || exporting) return;
  exporting = true;
  const btns = $$<HTMLButtonElement>('.export-btn');
  btns.forEach((b) => (b.disabled = true));
  const [w, h] = exportDims();
  const n = totalFrames();
  const frames: ArrayBuffer[] = [];
  const started = performance.now();
  try {
    await prepareTypography();
    if (source.kind === 'video') source.el.pause();
    for (let i = 0; i < n; i++) {
      if (source.kind === 'video') {
        await seek(source.el, Math.min(source.el.duration - 0.01, source.start + i / ui.fps));
        if (ui.autoFocus && i % 4 === 0) await runDetection(false);
        await processFrame(i === 0);
      } else if (i === 0) await processFrame(true);
      const px = await renderExportFrame(w, h, i);
      frames.push(px.buffer as ArrayBuffer);
      setProgress(((i + 1) / n) * 0.6, `渲染 ${i + 1}/${n} 帧`);
    }
    const bytes = await encodeGif(frames, w, h, ui.mode === 'sticker', (p) => setProgress(0.6 + p * 0.4, '编码 GIF'));
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
    const kind = ui.mode === 'sticker' ? '贴纸 GIF' : '画面 GIF';
    addResult(blob, `${tpl.name} · ${kind}`, `${w}×${h} · ${n} 帧 · ${ui.fps}fps`, 'gif', ((performance.now() - started) / 1000).toFixed(1));
  } catch (err) {
    toast('导出失败：' + (err as Error).message);
  } finally {
    exporting = false;
    btns.forEach((b) => (b.disabled = false));
    setProgress(0, '');
    if (source?.kind === 'video') { lastVideoStep = -1; await seek(source.el, source.start); if (playing) source.el.play().catch(() => {}); }
  }
}

function exportMotion() { return withGpu(async () => {
  if (!source || exporting) return;
  exporting = true;
  const btns = $$<HTMLButtonElement>('.export-btn');
  btns.forEach(b => b.disabled = true);
  const locked = $$('.panel-scroll, .source-actions, #modeSeg, .export-opts');
  locked.forEach(el => el.inert = true);
  const format = ui.format as 'motion' | 'live' | 'mp4';
  const [w, h] = exportDims();
  const n = totalFrames();
  const started = performance.now();
  try {
    await prepareTypography();
    if (source.kind === 'video') source.el.pause();
    const { makeMotion } = await import('./motion-export');
    const result = await makeMotion({ w, h, fps: ui.fps, n, format, progress: setProgress, render: async (i) => {
      if (source?.kind === 'video') {
        await seek(source.el, Math.min(source.el.duration - 0.01, source.start + i / ui.fps));
        if (ui.autoFocus && i % 4 === 0) await runDetection(false);
        await processFrame(i === 0);
      } else if (i === 0) await processFrame(true);
      return renderExportFrame(w, h, i);
    } });
    addResult(result.blob, `${tpl.name} · ${result.label}`, `${w}×${h} · ${(n / ui.fps).toFixed(2)}s`, result.ext, ((performance.now() - started) / 1000).toFixed(1), result.preview);
    toast(format === 'live' ? 'Live Photo 配对包已生成，导入方式见下载包内说明' : '动态作品已生成，可下载或分享原文件');
  } catch (e) {
    toast('导出失败：' + (e as Error).message);
  } finally {
    exporting = false;
    btns.forEach(b => b.disabled = false);
    locked.forEach(el => el.inert = false);
    setProgress(0, '');
    if (source?.kind === 'video') { lastVideoStep = -1; await seek(source.el, source.start); if (playing) source.el.play().catch(() => {}); }
  }
}); }

function exportPng() { return withGpu(exportPngLocked); }
async function exportPngLocked() {
  if (!source || exporting) return;
  exporting = true;
  try {
    await prepareTypography();
    // 预览循环可能还没把最新参数处理完：导出前同步处理一次
    if (source.kind === 'image') { await processFrame(true); dirty = false; }
    const [w, h] = ui.mode === 'sticker' ? [512, 512] : fitLong(W, H, 1080);
    const frame = source.kind === 'video' ? 0 : Math.floor((playing ? ((performance.now() - t0) / 1000) % 3 : pausedAt) * ui.fps);
    const px = await renderExportFrame(w, h, frame);
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), w, h), 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    addResult(blob, `${tpl.name} · ${ui.mode === 'sticker' ? '贴纸' : '画面'} PNG`, `${w}×${h}`, 'png');
  } finally {
    exporting = false;
  }
}

let resultCount = 0;
function addResult(blob: Blob, title: string, meta: string, ext: string, secs?: string, preview?: Blob) {
  const url = URL.createObjectURL(blob);
  const kb = blob.size / 1024;
  const size = kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${Math.round(kb)} KB`;
  const name = `${tpl.id}-${(source?.name ?? 'art').replace(/\.[^.]+$/, '')}-${++resultCount}.${ext}`;
  const previewUrl = preview ? URL.createObjectURL(preview) : '';
  const el = document.createElement('figure');
  el.className = 'result' + (ui.mode === 'sticker' ? ' is-sticker' : '');
  el.innerHTML = `<div class="result-img">${preview ? `<video src="${previewUrl}" controls playsinline loop muted aria-label="${title}"></video>` : `<img src="${url}" alt="${title}">`}</div>
    <figcaption><b>${title}</b><span>${meta}</span><span>${size}${secs ? ` · 用时 ${secs}s` : ''}</span>
    <a class="dl" href="${url}" download>下载</a></figcaption>`;
  el.querySelector<HTMLAnchorElement>('.dl')!.download = name;
  const share = document.createElement('button'); share.className = 'btn ghost small share'; share.textContent = '分享原文件';
  share.onclick = async () => {
    const file = new File([blob], name, { type: blob.type });
    if (!navigator.canShare?.({ files: [file] })) { toast('当前浏览器不支持文件分享，请先下载原文件'); return; }
    try { await navigator.share({ files: [file], title }); } catch (e) { if ((e as Error).name !== 'AbortError') toast('分享失败，请下载原文件后分享'); }
  };
  el.querySelector('figcaption')!.append(share);
  if (ext === 'zip' || ext === 'MP.JPG') {
    const note = document.createElement('span'); note.className = 'result-note';
    note.textContent = ext === 'zip' ? '配对包需导入相册；使用方法见包内说明。' : '请保存完整 JPG 原文件，兼容相册可识别动态片段。';
    el.querySelector('figcaption')!.append(note);
  }
  $('#results').prepend(el);
  $('#resultsEmpty').hidden = true;
  (window as any).__lastResult = { url, size: blob.size, label: `${title} · ${meta}` };
}

function setProgress(p: number, text: string) {
  $('#progress').style.setProperty('--p', String(p));
  $('#progressText').textContent = text;
  $('#progressWrap').dataset.active = String(p > 0);
}

let toastTimer = 0;
function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg; t.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.dataset.show = 'false'), 3200);
}

// ---------------- 控件 ----------------
type SliderKey = keyof StyleParams | 'tol' | 'palCount' | 'fxAmt';
type Slider = { key: SliderKey; ctl?: ControlKey; label: string; min: number; max: number; step: number; unit?: string; reprocess?: boolean };
type Item = Slider | 'palette' | 'boil' | 'maskOn' | 'bgPaper' | 'shadowOn' | 'motion' | 'colors' | 'autoFocus' | 'featOn' | 'focusActions'
  | 'fxLines' | 'sfx' | 'bubble' | 'journal' | 'title' | 'caption' | 'sparkles';

const FOCUS_ITEMS: Item[] = [
  'autoFocus',
  { key: 'focusStr', label: '主体清晰度', min: 0, max: 1, step: 0.05, reprocess: true },
  { key: 'bgSimp', label: '背景简化', min: 0, max: 1, step: 0.05, reprocess: true },
  { key: 'subjDetail', label: '主体细节保留', min: 0, max: 1, step: 0.05, reprocess: true },
  { key: 'detailSens', label: '细节解析灵敏度', min: 0, max: 1, step: 0.05, reprocess: true },
  { key: 'tone', label: '明暗保留', min: 0, max: 1, step: 0.05 },
  'featOn',
  'focusActions',
];
const FX_ITEMS: Item[] = ['fxLines', { key: 'fxAmt', label: '线条强度', min: 0, max: 1, step: 0.05 }, 'sfx', 'bubble', 'journal', 'title', 'caption', 'sparkles'];
const GROUPS: { title: string; open?: boolean; items: Item[] }[] = [
  { title: '色块', open: true, items: [
    { key: 'kuwR', label: '简化程度', min: 1, max: 8, step: 1, reprocess: true },
    { key: 'chroma', ctl: 'chroma', label: '饱和度', min: 0.8, max: 1.8, step: 0.05, reprocess: true },
    'palette',
    { key: 'palCount', ctl: 'palCount', label: '颜色数', min: 4, max: 16, step: 1, reprocess: true },
  ] },
  { title: '笔触', items: [
    { key: 'spacing', ctl: 'spacing', label: '排线间距', min: 3, max: 12, step: 0.5 },
    { key: 'pressure', ctl: 'pressure', label: '笔压', min: 0.4, max: 1.3, step: 0.05 },
    { key: 'grain', ctl: 'grain', label: '纸纹露白', min: 0, max: 1, step: 0.05 },
    { key: 'cross', ctl: 'cross', label: '交叉排线', min: 0, max: 1, step: 0.05 },
    { key: 'hatchAng', ctl: 'hatchAng', label: '排线角度', min: -90, max: 90, step: 5, unit: '°' },
  ] },
  { title: '描边', items: [
    { key: 'lineW', ctl: 'lineW', label: '粗细', min: 0, max: 6, step: 0.1 },
    { key: 'detail', ctl: 'detail', label: '暗部细节线', min: 0, max: 1, step: 0.05 },
    { key: 'edgeTh', ctl: 'edgeTh', label: '分色阈值', min: 0, max: 0.3, step: 0.01 },
  ] },
  { title: '抖动', items: [
    { key: 'wobble', ctl: 'wobble', label: '抖动幅度', min: 0, max: 5, step: 0.1 },
    'boil',
  ] },
  { title: '抠图与投影', items: [
    'maskOn',
    { key: 'tol', label: '背景容差', min: 0.03, max: 0.2, step: 0.005, reprocess: true },
    'bgPaper', 'shadowOn',
    { key: 'shadowAng', ctl: 'shadow', label: '投影方向', min: 0, max: 360, step: 5, unit: '°' },
    { key: 'shadowDist', ctl: 'shadow', label: '投影距离', min: 0, max: 40, step: 1 },
  ] },
  { title: '动作', items: ['motion', { key: 'motionAmt', label: '动作幅度', min: 0, max: 2, step: 0.05 }] },
  { title: '纸与墨', items: ['colors'] },
];

const syncers: (() => void)[] = [];
function syncControls() { syncers.forEach((s) => s()); bump(); }

function getVal(key: SliderKey): number {
  if (key === 'tol') return ui.tol;
  if (key === 'palCount') return ui.palCount;
  if (key === 'fxAmt') return ui.fxAmt;
  return params[key] as number;
}
function setVal(key: SliderKey, v: number) {
  if (key === 'tol') ui.tol = v;
  else if (key === 'palCount') ui.palCount = v;
  else if (key === 'fxAmt') ui.fxAmt = v;
  else (params as any)[key] = v;
}

function onChanged(reprocess: boolean, key?: string) {
  bump();
  if (key === 'tol') { runMask(false); stickerBBox = expandBBox(maskRes!.bbox, 0.04); }
  if (key === 'chroma' || key === 'palCount' || key === 'palette') uploadPalette();
  if (key === 'fxAmt' || key === 'postAmt') return;
  if (reprocess || source?.kind === 'image') dirty = true;
  if (key === 'focusStr' || key === 'bgSimp') flashFocus();
}

function toggle(label: string, get: () => boolean, set: (v: boolean) => void, extra = '') {
  const row = document.createElement('label');
  row.className = 'toggle';
  row.innerHTML = `<span>${label}${extra}</span><input type="checkbox"><i></i>`;
  const input = row.querySelector('input')!;
  input.onchange = () => { set(input.checked); onChanged(false); };
  syncers.push(() => (input.checked = get()));
  return row;
}

function segmented(label: string, opts: [string, string][], get: () => string, set: (v: string) => void) {
  const row = document.createElement('div');
  row.className = 'seg-row';
  row.innerHTML = `<span>${label}</span><div class="seg">${opts.map(([v, t]) => `<button data-v="${v}">${t}</button>`).join('')}</div>`;
  row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => { set(b.dataset.v!); syncControls(); }));
  syncers.push(() => row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === get())));
  return row;
}

function textField(label: string, placeholder: string, chips: string[], get: () => string, set: (v: string) => void) {
  const wrap = document.createElement('div');
  wrap.className = 'text-field';
  wrap.innerHTML = `<label><span>${label}</span><input type="text" maxlength="24" placeholder="${placeholder}"></label>
    <div class="chips">${chips.map((c) => `<button class="chip" data-v="${c}">${c}</button>`).join('')}<button class="chip ghost" data-v="">清空</button></div>`;
  const input = wrap.querySelector('input')!;
  input.oninput = () => set(input.value);
  wrap.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => (b.onclick = () => { set(b.dataset.v!); syncControls(); }));
  syncers.push(() => {
    if (document.activeElement !== input) input.value = get();
    wrap.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.classList.toggle('on', !!b.dataset.v && b.dataset.v === get()));
  });
  return wrap;
}

function hidden(ctl?: ControlKey) { return !!ctl && !!tpl.hide?.includes(ctl); }

function buildItem(it: Item): HTMLElement {
  if (typeof it !== 'string') {
    const row = document.createElement('label');
    row.className = 'slider';
    row.innerHTML = `<span></span><output></output><input type="range" min="${it.min}" max="${it.max}" step="${it.step}">`;
    const input = row.querySelector('input')!, out = row.querySelector('output')!, lab = row.querySelector('span')!;
    const fmt = (v: number) => (it.step >= 1 ? String(Math.round(v)) : v.toFixed(it.step < 0.01 ? 3 : 2)) + (it.unit ?? '');
    input.oninput = () => { const v = +input.value; setVal(it.key, v); out.textContent = fmt(v); onChanged(!!it.reprocess, it.key); };
    syncers.push(() => {
      const v = getVal(it.key); input.value = String(v); out.textContent = fmt(v);
      lab.textContent = (it.ctl && tpl.labels?.[it.ctl]) || it.label;
      row.hidden = hidden(it.ctl) || (it.key === 'palCount' && ui.palMode !== 'auto') || (it.key === 'fxAmt' && !ui.fxRadial && !ui.fxSpeed);
    });
    return row;
  }
  switch (it) {
    case 'palette': {
      const wrap = document.createElement('div');
      wrap.append(segmented('色板', [['template', '模板色板'], ['auto', '取自原图']], () => ui.palMode, (v) => { ui.palMode = v as UiState['palMode']; onChanged(true, 'palette'); }));
      const sw = document.createElement('div'); sw.id = 'swatches'; sw.className = 'swatches'; wrap.append(sw);
      syncers.push(() => (wrap.hidden = hidden('palette')));
      return wrap;
    }
    case 'boil': {
      const wrap = document.createElement('div');
      wrap.append(segmented('换纹理', [['1', '每帧'], ['2', '2 帧'], ['3', '3 帧'], ['4', '4 帧']], () => String(ui.boilEvery), (v) => { ui.boilEvery = +v; }));
      const hint = document.createElement('p'); hint.className = 'hint'; wrap.append(hint);
      syncers.push(() => { hint.textContent = `每秒刷新 ${(ui.fps / ui.boilEvery).toFixed(1)} 次（参考视频约 6 次）`; wrap.hidden = hidden('boil'); });
      return wrap;
    }
    case 'maskOn':
      return toggle('分离主体', () => params.maskOn, (v) => { params.maskOn = v; if (v && source?.kind === 'video') runMask(false); }, '<em id="maskStatus"></em>');
    case 'bgPaper': return toggle('背景换成白纸', () => params.bgPaper, (v) => (params.bgPaper = v));
    case 'shadowOn': {
      const r = toggle('投影', () => params.shadowOn, (v) => (params.shadowOn = v));
      syncers.push(() => (r.hidden = hidden('shadow')));
      return r;
    }
    case 'motion':
      return segmented('动作', [['0', '无'], ['1', '摇摆'], ['2', '弹跳'], ['3', '呼吸']], () => String(params.motion), (v) => (params.motion = +v));
    case 'autoFocus':
      return toggle('自动识别人脸 / 主体', () => ui.autoFocus, (v) => { ui.autoFocus = v; if (v && !autoFoci.length) runDetection(true); else applyFocus(); }, '<em id="focusStatus"></em>');
    case 'featOn': {
      const r = toggle('五官重绘', () => ui.featOn, (v) => { ui.featOn = v; applyFocus(); },
        '<em id="featStatus">小脸看不清时，用人脸关键点画简笔五官</em>');
      syncers.push(() => {
        const s = r.querySelector('em')!;
        s.textContent = !faceKeys.length ? '需要识别到人脸（正脸效果最好）' : '用人脸关键点画点眼睛、弧线嘴和腮红';
      });
      return r;
    }
    case 'focusActions': {
      const row = document.createElement('div');
      row.className = 'focus-actions';
      row.innerHTML = `<button class="btn small" data-act="pick">手动设焦点</button><button class="btn small ghost" data-act="clear">清除手动焦点</button>`;
      row.querySelector<HTMLButtonElement>('[data-act="pick"]')!.onclick = () => setPicking(!stage.classList.contains('picking'));
      const clear = row.querySelector<HTMLButtonElement>('[data-act="clear"]')!;
      clear.onclick = () => { manualFocus = null; applyFocus(); syncControls(); };
      syncers.push(() => (clear.disabled = !manualFocus));
      return row;
    }
    case 'fxLines': {
      const row = document.createElement('div');
      row.className = 'seg-row';
      row.innerHTML = `<span>效果线</span><div class="seg"><button data-k="fxRadial">集中线</button><button data-k="fxSpeed">速度线</button></div>`;
      row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => {
        const k = b.dataset.k as 'fxRadial' | 'fxSpeed'; ui[k] = !ui[k]; syncControls();
      }));
      syncers.push(() => row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', ui[b.dataset.k as 'fxRadial' | 'fxSpeed'])));
      return row;
    }
    case 'sfx':
      return textField('拟声字', '比如：砰！', ['砰！', '哇哦', '嘿嘿', '咻——', '叮！'], () => ui.sfx, (v) => (ui.sfx = v));
    case 'bubble':
      return textField('对话气泡', '想说的话', ['你好呀', '今天也要开心', '冲鸭！'], () => ui.bubble, (v) => (ui.bubble = v));
    case 'journal':
      return toggle('手账边框', () => ui.journal, (v) => (ui.journal = v), '<em>留出纸边，上写标题、下写落款（画面模式）</em>');
    case 'title': {
      const f = textField('标题', '手写标题', ['今天的小回忆', 'Island of Churches', '周末散步'], () => ui.title, (v) => (ui.title = v));
      syncers.push(() => (f.hidden = !ui.journal));
      return f;
    }
    case 'caption': {
      const f = textField('落款', '一句小注', ['a small memory', 'same sky, different little houses', '2026 · 秋'], () => ui.caption, (v) => (ui.caption = v));
      syncers.push(() => (f.hidden = !ui.journal));
      return f;
    }
    case 'sparkles':
      return toggle('小星星和表情线', () => ui.sparkles, (v) => (ui.sparkles = v));
    case 'colors': {
      const row = document.createElement('div'); row.className = 'colors';
      const defs: [keyof UiState, 'paper' | 'ink' | 'shadowCol', string, ControlKey?][] = [['paperHex', 'paper', '纸'], ['inkHex', 'ink', '墨线'], ['shadowHex', 'shadowCol', '投影', 'shadow']];
      for (const [uk, pk, label, ctl] of defs) {
        const l = document.createElement('label');
        l.innerHTML = `<input type="color"><span>${label}</span>`;
        const input = l.querySelector('input')!;
        input.oninput = () => { (ui as any)[uk] = input.value; params[pk] = hexToRgb(input.value); onChanged(false); };
        syncers.push(() => { input.value = ui[uk] as string; l.hidden = hidden(ctl); });
        row.append(l);
      }
      return row;
    }
  }
}

function applyTemplate(t: Template) {
  if (!engine) { toast('浏览器尚未就绪，请使用支持 WebGPU 的浏览器'); return; }
  tpl = t;
  Object.assign(params, t.params, { paper: hexToRgb(t.paper), ink: hexToRgb(t.ink), shadowCol: hexToRgb(t.shadow) });
  Object.assign(ui, { paperHex: t.paper, inkHex: t.ink, shadowHex: t.shadow, boilEvery: t.boilEvery ?? 2, journal: !!t.journal, sparkles: !!t.journal });
  if (t.hide?.includes('palette')) ui.palMode = 'template';
  if (t.journal) void ensureArtFont().then(() => { overlayKey = ''; bump(); }).catch(() => toast('艺术字体暂未载入，使用系统字体'));
  engine.ensureFinal(t.params.style);
  uploadPalette();
  dirty = true;
  syncControls();
}

function buildControls() {
  initTypography($('#typographyBlock'), () => { overlayKey = ''; bump(); }, toast);
  FOCUS_ITEMS.forEach((it) => $('#focusControls').append(buildItem(it)));
  FX_ITEMS.forEach((it) => $('#fxControls').append(buildItem(it)));
  const panel = $('#controls');
  for (const g of GROUPS) {
    const d = document.createElement('details');
    d.className = 'block group';
    d.open = !!g.open;
    d.innerHTML = `<summary><h3>${g.title}</h3><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></summary>`;
    const body = document.createElement('div'); body.className = 'group-body';
    g.items.forEach((it) => body.append(buildItem(it)));
    d.append(body);
    panel.append(d);
  }

  // 模板卡片
  const grid = $('#templates');
  for (const t of TEMPLATES) {
    const b = document.createElement('button');
    b.className = 'tpl'; b.dataset.id = t.id;
    b.innerHTML = `<span class="tpl-img"><img alt="" decoding="async"></span><span class="tpl-text"><b>${t.name}</b><small>${t.en}</small></span>`;
    b.title = t.desc; b.setAttribute('aria-label', `${t.name}：${t.desc}`);
    b.onclick = () => applyTemplate(t);
    grid.append(b);
  }
  syncers.push(() => {
    grid.querySelectorAll<HTMLElement>('.tpl').forEach((el) => { const on = el.dataset.id === tpl.id; el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); });
    $('#tplName').textContent = tpl.name;
    $('#tplDesc').textContent = tpl.desc;
  });

  // 导出类型
  $$<HTMLButtonElement>('#modeSeg button').forEach((b) => (b.onclick = () => {
    ui.mode = b.dataset.v as Mode;
    if (ui.mode === 'sticker' && maskRes && !params.maskOn) toast('当前背景较复杂，贴纸会使用整张画面；可在「抠图与投影」里开启分离主体');
    syncControls();
  }));
  syncers.push(() => {
    $$<HTMLButtonElement>('#modeSeg button').forEach((b) => { const on = b.dataset.v === ui.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    stage.dataset.mode = ui.mode;
    const sizes = ui.mode === 'sticker'
      ? [[240, '240', '微信表情'], [320, '320', '常用'], [512, '512', '高清贴纸']]
      : [[360, '360', '长边'], [480, '480', '长边'], [640, '640', '长边']];
    const cur = ui.mode === 'sticker' ? ui.stickerSize : ui.sceneSize;
    const sizeSeg = $('#sizeSeg');
    const sig = sizes.map((x) => x[0]).join();
    if (sizeSeg.dataset.sig !== sig) {
      sizeSeg.dataset.sig = sig;
      sizeSeg.innerHTML = sizes.map(([v, t, sub]) => `<button role="radio" data-v="${v}"><b>${t}</b><small>${sub}</small></button>`).join('');
      sizeSeg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => {
        if (ui.mode === 'sticker') ui.stickerSize = +b.dataset.v!; else ui.sceneSize = +b.dataset.v!;
        syncControls();
      }));
    }
    const mark = (root: string, v: string) => $$<HTMLButtonElement>(`${root} button`).forEach((b) => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    mark('#sizeSeg', String(cur)); mark('#fpsSeg', String(ui.fps)); mark('#formatSeg', ui.format);
    $('#exportSummary').textContent = `${cur}${ui.mode === 'sticker' ? ' 方' : ' 长边'} · ${ui.fps} fps · ${totalFrames()} 帧`;
    const format = ui.format;
    $('#exportGif').textContent = format === 'gif' ? (ui.mode === 'sticker' ? '导出 3 秒贴纸 GIF' : '导出 3 秒 GIF') : format === 'mp4' ? '导出 3 秒 MP4' : format === 'live' ? '导出 Live Photo' : '导出动态照片';
    $('#motionHint').textContent = (format !== 'gif' && ui.mode === 'sticker' ? '贴纸会合成纸色背景。' : '') + (format === 'gif' ? 'GIF 支持透明贴纸，聊天软件都能直接发。' : format === 'motion' ? '单文件动态照片。保存原始 JPG 至兼容安卓相册，勿经聊天工具压缩；相册和发布平台的识别可能不同。' : format === 'live' ? '含配对 JPG + MOV 的 ZIP。需用支持 Live Photo 配对导入的工具保存到 iPhone 相册，浏览器不能直接写入为实况。' : 'H.264 短视频，适合移动端分享。');
  });
  $$<HTMLButtonElement>('#fpsSeg button').forEach((b) => (b.onclick = () => { ui.fps = +b.dataset.v!; syncControls(); }));
  $$<HTMLButtonElement>('#formatSeg button').forEach((b) => (b.onclick = () => { ui.format = b.dataset.v as UiState['format']; syncControls(); }));
  $('#exportGif').onclick = () => ui.format === 'gif' ? exportGif() : exportMotion();

  // 画面后期：15 种 GPU 处理，uniform 切换，不重编译
  const postGrid = $('#postGrid');
  postGrid.innerHTML = POSTS.map((p) => `<button class="post" role="radio" data-v="${p.id}" title="${p.desc}"><i style="background:${p.swatch}"></i><span>${p.name}</span></button>`).join('');
  postGrid.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => { params.post = +b.dataset.v!; syncControls(); }));
  const postAmt = buildItem({ key: 'postAmt', label: '后期强度', min: 0, max: 1, step: 0.05 });
  $('#postControls').append(postAmt);
  syncers.push(() => {
    postGrid.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { const on = +b.dataset.v! === params.post; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    const p = POSTS[params.post];
    $('#postDesc').textContent = p.id ? `${p.name} · ${p.desc}` : '在任何风格模板上叠加一层 GPU 处理';
    postAmt.hidden = params.post === 0 || params.post === 9 || params.post === 15;
    $('#postBadge').textContent = p.id ? p.name : '';
    $('#postBadge').hidden = !p.id;
  });
  $('#exportPng').onclick = exportPng;
  $('#playBtn').onclick = () => {
    playing = !playing;
    if (playing) t0 = performance.now() - pausedAt * 1000; else pausedAt = ((performance.now() - t0) / 1000) % 3;
    if (source?.kind === 'video') playing ? source.el.play() : source.el.pause();
    $('#playBtn').dataset.playing = String(playing);
  };

  // 焦点：显式进入“设焦点”模式后才响应画布点击，避免误触
  $('#focusBtn').onclick = () => setPicking(!stage.classList.contains('picking'));
  $('#focusBlock').onmouseenter = () => stage.classList.add('show-focus');
  $('#focusBlock').onmouseleave = () => stage.classList.remove('show-focus');
  $('#canvasBox').onclick = (e) => {
    if (!stage.classList.contains('picking') || !source) return;
    const r = canvas.getBoundingClientRect();
    const ux = (e.clientX - r.left) / r.width, uy = (e.clientY - r.top) / r.height;
    const cx = lastView.off[0] + ux * lastView.scale[0], cy = lastView.off[1] + uy * lastView.scale[1];
    const short = Math.min(W, H), rad = 0.17;
    manualFocus = { cx, cy, rx: (rad * short) / W, ry: (rad * short * 1.15) / H, w: 1, kind: 'manual' };
    setPicking(false);
    applyFocus(); flashFocus(); syncControls();
  };

  // 显式启用拖字，普通触摸仍然滚动页面；完成后恢复画布默认行为。
  const moveButton = $<HTMLButtonElement>('#moveType');
  const stopMovingType = () => { stage.classList.remove('moving-type'); moveButton.setAttribute('aria-pressed', 'false'); moveButton.textContent = '拖动文字'; };
  const doneMove = document.createElement('button'); doneMove.className = 'btn small type-move-done'; doneMove.textContent = '完成拖动'; doneMove.onclick = stopMovingType; $('#canvasWrap').append(doneMove);
  moveButton.onclick = () => {
    if (stage.classList.contains('moving-type')) { stopMovingType(); return; }
    if (!typography.text.trim()) { toast('先输入文字或选择一个排版模板'); return; }
    setPicking(false); stage.classList.add('moving-type'); moveButton.setAttribute('aria-pressed', 'true'); moveButton.textContent = '拖动中 · 完成';
    if (matchMedia('(max-width: 960px)').matches) stage.scrollIntoView({ block: 'start', behavior: 'smooth' });
    toast('在画面上拖动文字，完成后点「完成拖动」');
  };
  let typePointer: number | null = null;
  const moveTypeTo = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    typography.x = Math.max(0.05, Math.min(0.95, (e.clientX - r.left) / r.width));
    typography.y = Math.max(0.05, Math.min(0.95, (e.clientY - r.top) / r.height));
    $('#typographyBlock').dispatchEvent(new Event('type-position'));
  };
  $('#canvasBox').addEventListener('pointerdown', e => {
    if (!stage.classList.contains('moving-type') || !source) return;
    e.preventDefault(); typePointer = e.pointerId; $('#canvasBox').setPointerCapture(e.pointerId); moveTypeTo(e);
  });
  $('#canvasBox').addEventListener('pointermove', e => { if (typePointer === e.pointerId) { e.preventDefault(); moveTypeTo(e); } });
  const endMove = (e: PointerEvent) => { if (typePointer === e.pointerId) { typePointer = null; if ($('#canvasBox').hasPointerCapture(e.pointerId)) $('#canvasBox').releasePointerCapture(e.pointerId); } };
  $('#canvasBox').addEventListener('pointerup', endMove);
  $('#canvasBox').addEventListener('pointercancel', endMove);
  $('#focusBtn').addEventListener('click', stopMovingType);
  $('#clearType').addEventListener('click', stopMovingType);
  window.addEventListener('keydown', e => { if (e.key === 'Escape') stopMovingType(); });

  // 素材 & 菜单
  const file = $<HTMLInputElement>('#file');
  $$('[data-action="upload"]').forEach((b) => (b.onclick = () => file.click()));
  file.onchange = () => { if (file.files?.[0]) loadFile(file.files[0]).catch((e) => toast(e.message)); file.value = ''; };
  const menus = $$('.menu');
  const closeMenus = () => menus.forEach((m) => m.classList.remove('open'));
  $('#sampleBtn').onclick = (e) => { e.stopPropagation(); const o = !$('#sampleMenu').classList.contains('open'); closeMenus(); $('#sampleMenu').classList.toggle('open', o); };
  document.addEventListener('click', (e) => { if (!menus.some((m) => m.contains(e.target as Node))) closeMenus(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setPicking(false); closeMenus(); } });
  $$<HTMLButtonElement>('[data-sample]').forEach((b) => (b.onclick = () => {
    closeMenus();
    loadImageUrl(b.dataset.sample!, b.dataset.name!).then(() => {
      if (b.dataset.mode) { ui.mode = b.dataset.mode as Mode; syncControls(); }
    });
  }));
  stage.ondragover = (e) => { e.preventDefault(); stage.classList.add('drag'); };
  stage.ondragleave = () => stage.classList.remove('drag');
  stage.ondrop = (e) => { e.preventDefault(); stage.classList.remove('drag'); const f = e.dataTransfer?.files[0]; if (f) loadFile(f).catch((er) => toast(er.message)); };
  window.addEventListener('paste', (e) => { const f = e.clipboardData?.files[0]; if (f) loadFile(f).catch((er) => toast(er.message)); });
  // 面板分页：风格 / 后期 / 文字 / 装饰 / 细调，方向键切换
  const tabs = $$<HTMLButtonElement>('#panelTabs [role="tab"]');
  const showTab = (id: string, focus = false, scroll = false) => {
    if (id !== 'type') stopMovingType();
    tabs.forEach((b) => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    $$('.pane').forEach((p) => (p.hidden = p.dataset.pane !== id));
    $('.panel-scroll').scrollTop = 0;
    if (scroll && matchMedia('(max-width: 960px)').matches) $('#panelTabs').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  tabs.forEach((b, i) => {
    b.id = `tab-${b.dataset.tab}`; b.setAttribute('aria-controls', `pane-${b.dataset.tab}`);
    const pane = $<HTMLElement>(`.pane[data-pane="${b.dataset.tab}"]`); pane.id = `pane-${b.dataset.tab}`; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', b.id);
    b.onclick = () => showTab(b.dataset.tab!, false, true);
    b.onkeydown = (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); showTab(tabs[(i + d + tabs.length) % tabs.length].dataset.tab!, true); }
    };
  });
  showTab('style');

  $<HTMLInputElement>('#trim').oninput = () => {
    if (source?.kind !== 'video') return;
    source.start = +$<HTMLInputElement>('#trim').value;
    source.el.currentTime = source.start;
    updateTrimLabel();
  };
  syncControls();
}

function updateTrimLabel() {
  if (source?.kind !== 'video') return;
  $('#trimLabel').textContent = `${source.start.toFixed(1)}s – ${(source.start + 3).toFixed(1)}s`;
}

// ---------------- 启动：GPU 初始化与示例图下载并行 ----------------
async function boot() {
  const t = performance.now();
  if (new URLSearchParams(location.search).has('nodetect')) ui.autoFocus = false;   // 调试：关闭主体识别
  bootStep('连接 GPU', 0.15);
  const sample = fetch('/samples/street.jpg').then((r) => r.blob()).then((b) => createImageBitmap(b));
  buildControls();          // 面板先出来，不等 GPU
  try {
    engine = await Engine.create(canvas, TEMPLATES[0].params.style, (s) => bootStep(s, 0.45));
  } catch (e) {
    stage.classList.add('no-gpu', 'ready');
    $('#gpuMsg').textContent = (e as Error).message;
    $('#gpuStatus').dataset.state = 'error';
    $$<HTMLButtonElement>('#exportGif, #exportPng, #focusBtn, #playBtn, [data-action="upload"], [data-sample]').forEach((b) => { b.disabled = true; });
    return;
  }
  $('#gpuStatus').dataset.state = 'ok';
  applyTemplate(TEMPLATES[0]);
  requestAnimationFrame(tick);
  bootStep('载入示例', 0.75);
  try {
    await loadImage(await sample, 'street.jpg');
  } catch {
    stage.classList.add('ready');   // 示例加载失败也要让用户能拖文件
  }
  bootStep('渲染第一帧', 0.95);
  (window as any).__app = {
    renderFrame: (w: number, h: number, f: number) => withGpu(async () => { await prepareTypography(); return renderExportFrame(w, h, f); }),
    engine, params, ui, typography, exportGif, exportPng, exportMotion, frameOpts, loadImageUrl, syncControls,
    setMode: (m: Mode) => { ui.mode = m; syncControls(); },
    applyTemplate: (id: string) => applyTemplate(TEMPLATES.find((x) => x.id === id)!),
    get source() { return source; }, get maskRes() { return maskRes; }, get foci() { return autoFoci; }, get keys() { return faceKeys; },
    get thumbing() { return thumbing; }, get thumbsDone() { return thumbUrls.size; },
    get thumbDebug() { return { queue: thumbQueue.map((t) => t.id), scheduled: thumbScheduled, thumbing, exporting, detecting }; },
    get firstFrame() { return firstFrameShown; },
    bootMs: 0,
  };
  const wait = () => (firstFrameShown ? Promise.resolve() : new Promise<void>((r) => setTimeout(() => wait().then(r), 16)));
  await wait();
  (window as any).__app.bootMs = Math.round(performance.now() - t);
  document.body.dataset.ready = 'true';
}
boot();
