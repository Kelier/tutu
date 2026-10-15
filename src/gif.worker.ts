// GIF 编码 Worker：全局调色板（跨帧采样，避免闪烁）+ 重复帧合并 + 帧间差分 + 可选 1 位透明
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

interface Job { frames: ArrayBuffer[]; width: number; height: number; delay: number; transparent: boolean }

self.onmessage = (e: MessageEvent<Job>) => {
  const { frames, width, height, delay, transparent } = e.data;
  const N = width * height;
  const views = frames.map((b) => new Uint8Array(b));

  if (transparent) {
    for (const f of views) for (let i = 0; i < N * 4; i += 4) {
      if (f[i + 3] < 128) { f[i] = f[i + 1] = f[i + 2] = f[i + 3] = 0; } else f[i + 3] = 255;
    }
  }

  // 从多帧中采样像素构建一张全局调色板
  const pick = Math.min(views.length, 12);
  const budget = Math.ceil(300000 / pick);
  const stride = Math.max(1, Math.floor(N / budget));
  const perFrame = Math.ceil(N / stride);
  const sample = new Uint8Array(pick * perFrame * 4);
  let o = 0;
  for (let k = 0; k < pick; k++) {
    const f = views[Math.floor((k * views.length) / pick)];
    for (let i = 0; i < N; i += stride) { sample.set(f.subarray(i * 4, i * 4 + 4), o); o += 4; }
  }
  const format = transparent ? 'rgba4444' : 'rgb565';
  // 不透明 GIF 预留一个索引给“与上一帧相同”的像素（帧间差分）
  const palette = quantize(sample.subarray(0, o), transparent ? 256 : 255, transparent ? { format, oneBitAlpha: true } : { format });
  let tIndex: number;
  if (transparent) {
    tIndex = palette.findIndex((c: number[]) => c[3] === 0);
    if (tIndex < 0) { palette[palette.length - 1] = [0, 0, 0, 0]; tIndex = palette.length - 1; }
  } else {
    tIndex = palette.length;
    palette.push([255, 0, 255]);
  }

  // 1) 量化；2) 合并完全相同的相邻帧（boil 每 N 帧才换一次，静态图会有大量重复帧）
  const unique: { index: Uint8Array; delay: number }[] = [];
  views.forEach((f, i) => {
    const index = applyPalette(f, palette, format);
    const last = unique[unique.length - 1];
    if (last && sameBytes(last.index, index)) last.delay += delay;
    else unique.push({ index, delay });
    (self as any).postMessage({ progress: ((i + 1) / views.length) * 0.5 });
  });

  const gif = GIFEncoder();
  let prev: Uint8Array | null = null;
  unique.forEach((fr, i) => {
    let index = fr.index;
    if (!transparent && prev) {
      // 3) 帧间差分：没变的像素写成透明，叠在上一帧上（dispose=1 保留上一帧）
      index = new Uint8Array(fr.index);
      for (let k = 0; k < index.length; k++) if (index[k] === prev[k]) index[k] = tIndex;
    }
    gif.writeFrame(index, width, height, {
      palette: i === 0 ? palette : undefined,
      delay: fr.delay, repeat: 0,
      transparent: transparent || i > 0, transparentIndex: tIndex,
      dispose: transparent ? 2 : 1,
    });
    prev = fr.index;
    (self as any).postMessage({ progress: 0.5 + ((i + 1) / unique.length) * 0.5 });
  });
  gif.finish();
  const bytes = gif.bytes();
  (self as any).postMessage({ done: true, bytes }, [bytes.buffer]);
};

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
