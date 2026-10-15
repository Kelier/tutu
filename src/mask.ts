// 主体分离（无模型版）：从画面四边估计背景色 → 洪水填充 → 去碎块 → 羽化
// 适合纯色 / 渐变背景的商品、角色、宠物照；复杂场景会自动判定为“不可分离”。
import { rgbToOklab } from './palette';

export interface MaskResult {
  mask: Uint8Array;          // 0-255，尺寸同输入
  bbox: [number, number, number, number]; // uv 空间 x0,y0,x1,y1
  confident: boolean;
  fromAlpha: boolean;
}

export function computeMask(img: ImageData, tol: number, prev?: Uint8Array | null): MaskResult {
  const { width: w, height: h, data: d } = img;
  const N = w * h;
  const soft = new Float32Array(N);
  let fromAlpha = false;
  let confident = false;

  // 1) 带透明通道的 PNG：直接用 alpha
  let transparent = 0;
  for (let i = 0; i < N; i++) if (d[i * 4 + 3] < 200) transparent++;
  if (transparent > N * 0.02) {
    for (let i = 0; i < N; i++) soft[i] = d[i * 4 + 3] / 255;
    fromAlpha = confident = true;
  } else {
    const lab = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const [L, a, b] = rgbToOklab(d[i * 4] / 255, d[i * 4 + 1] / 255, d[i * 4 + 2] / 255);
      lab[i * 3] = L; lab[i * 3 + 1] = a; lab[i * 3 + 2] = b;
    }
    // 2) 四条边分别取样；与另外三边都不像的那条边视为“主体贴边”（如半身像的底边），不当背景
    const sides: number[][] = [[], [], [], []]; // 上 下 左 右
    for (let x = 0; x < w; x++) { sides[0].push(x); sides[1].push((h - 1) * w + x); }
    for (let y = 1; y < h - 1; y++) { sides[2].push(y * w); sides[3].push(y * w + w - 1); }
    const near = (i: number, c: number[]) =>
      Math.hypot(lab[i * 3] - c[0], 1.5 * (lab[i * 3 + 1] - c[1]), 1.5 * (lab[i * 3 + 2] - c[2]));
    const kmeans = (pts: number[], K: number, minFrac: number) => {
      let centers = Array.from({ length: K }, (_, k) => {
        const i = pts[Math.floor(((k + 0.5) / K) * (pts.length - 1))];
        return [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]];
      });
      const counts = new Array(K).fill(0);
      for (let it = 0; it < 8; it++) {
        const acc = centers.map(() => [0, 0, 0, 0]);
        for (const i of pts) {
          let bi = 0, bd = Infinity;
          centers.forEach((c, k) => { const dd = near(i, c); if (dd < bd) { bd = dd; bi = k; } });
          const a = acc[bi]; a[0] += lab[i * 3]; a[1] += lab[i * 3 + 1]; a[2] += lab[i * 3 + 2]; a[3]++;
        }
        acc.forEach((a, k) => { counts[k] = a[3]; if (a[3]) centers[k] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
      }
      return centers.filter((_, k) => counts[k] >= pts.length * minFrac);
    };
    const nearest = (i: number, cs: number[][]) => cs.reduce((m, c) => Math.min(m, near(i, c)), Infinity);
    const useSide = sides.map((side, s) => {
      const others = kmeans(sides.filter((_, o) => o !== s).flat(), 3, 0.15);
      let hit = 0;
      for (const i of side) if (nearest(i, others) < tol * 1.5) hit++;
      return hit / side.length > 0.45;
    });
    if (!useSide.some(Boolean)) useSide.fill(true);
    const border = sides.filter((_, s) => useSide[s]).flat();
    const centers = kmeans(border, 4, 0.15); // 只认占比大的背景色，避免贴边的深色衣物被当成背景
    const bgDist = new Float32Array(N);
    for (let i = 0; i < N; i++) bgDist[i] = nearest(i, centers);
    // 3) 从可用的边做洪水填充
    const bg = new Uint8Array(N);
    const queue = new Int32Array(N);
    let qh = 0, qt = 0, seeds = 0;
    for (const i of border) if (!bg[i] && bgDist[i] < tol * 1.2) { bg[i] = 1; queue[qt++] = i; seeds++; }
    // 不跨越强边缘：相邻像素差太大时停止扩散
    const step = (i: number, j: number) => {
      if (bg[j] || bgDist[j] >= tol) return;
      if (Math.hypot(lab[i * 3] - lab[j * 3], lab[i * 3 + 1] - lab[j * 3 + 1], lab[i * 3 + 2] - lab[j * 3 + 2]) > tol * 0.6) return;
      bg[j] = 1; queue[qt++] = j;
    };
    while (qh < qt) {
      const i = queue[qh++];
      const x = i % w, y = (i / w) | 0;
      if (x > 0) step(i, i - 1);
      if (x < w - 1) step(i, i + 1);
      if (y > 0) step(i, i - w);
      if (y < h - 1) step(i, i + w);
    }
    // 4) 去掉小碎块（保留最大连通块及足够大的块）
    const label = new Int32Array(N).fill(-1);
    const areas: number[] = [];
    for (let s = 0; s < N; s++) {
      if (bg[s] || label[s] >= 0) continue;
      const id = areas.length; let area = 0; qh = qt = 0; queue[qt++] = s; label[s] = id;
      while (qh < qt) {
        const i = queue[qh++]; area++;
        const x = i % w, y = (i / w) | 0;
        const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
        for (const j of nb) if (j >= 0 && !bg[j] && label[j] < 0) { label[j] = id; queue[qt++] = j; }
      }
      areas.push(area);
    }
    const largest = Math.max(0, ...areas);
    const keep = areas.map((a) => a >= Math.max(N * 0.004, largest * 0.08));
    let fg = 0;
    for (let i = 0; i < N; i++) { soft[i] = !bg[i] && keep[label[i]] ? 1 : 0; fg += soft[i]; }
    const bgFrac = 1 - fg / N;
    confident = bgFrac > 0.12 && bgFrac < 0.92 && seeds > border.length * 0.55;
  }

  // 5) 两次 3×3 盒式模糊 = 软边
  const tmp = new Float32Array(N);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? soft : tmp, dst = pass === 0 ? tmp : soft;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += src[yy * w + xx]; n++; }
      }
      dst[y * w + x] = s / n;
    }
  }

  const mask = new Uint8Array(N);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < N; i++) {
    let v = soft[i] * 255;
    if (prev && prev.length === N) v = v * 0.55 + prev[i] * 0.45; // 视频：时间平滑
    mask[i] = v;
    if (v > 127) {
      const x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const bbox: [number, number, number, number] =
    x1 < 0 ? [0, 0, 1, 1] : [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h];
  return { mask, bbox, confident, fromAlpha };
}
