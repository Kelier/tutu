import { drawArt, typography, fontFamily } from './typography';
// 漫画加料的叠加层：拟声字 + 对话气泡。Canvas2D 画在输出尺寸上，按 boil 步抖动，交给 shader 合成。
export interface OverlayOpts {
  type?: typeof typography;
  font?: string;
  sfx: string;                       // 拟声字，空 = 不画
  bubble: string;                    // 气泡台词，空 = 不画
  anchor: [number, number] | null;   // 人脸 / 焦点位置（输出 uv），气泡尾巴指向这里
  title?: string;                    // 手账标题（画在上边距里）
  caption?: string;                  // 落款（画在下边距里）
  sparkles?: boolean;                // 小星星 + 表情线
  frame?: { top: number; bottom: number; side: number } | null;   // 手账边框留白（输出 uv）
}

const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", "Kaiti SC", "STKaiti", "KaiTi", cursive';
const STAR = '#f0c03a';

/** 手写感文字：逐字抖动旋转 / 上下错落 */
function handText(ctx: OffscreenCanvasRenderingContext2D, text: string, cx: number, cy: number, fs: number, r: () => number, color = INK, family = HAND) {
  ctx.font = `600 ${fs}px ${family}`;
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const chars = [...text];
  const tracking = family === HAND ? 0.06 : typography.tracking;
  let widths = chars.map((c) => ctx.measureText(c).width + fs * tracking);
  let total = widths.reduce((a, b) => a + b, 0);
  if (total > ctx.canvas.width * 0.82) {
    fs *= ctx.canvas.width * 0.82 / total;
    ctx.font = `600 ${fs}px ${family}`;
    widths = chars.map((c) => ctx.measureText(c).width + fs * tracking);
    total = widths.reduce((a, b) => a + b, 0);
  }
  let x = cx - total / 2;
  chars.forEach((c, i) => {
    ctx.save();
    ctx.translate(x + widths[i] / 2, cy + (r() - 0.5) * fs * 0.14);
    ctx.rotate((r() - 0.5) * 0.12);
    ctx.textAlign = 'center';
    ctx.fillText(c, 0, 0);
    ctx.restore();
    x += widths[i];
  });
  return total;
}

/** 手绘波浪线 ～ */
function squiggle(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, len: number, amp: number, r: () => number) {
  ctx.beginPath();
  const n = 3;
  ctx.moveTo(x, y);
  for (let i = 0; i < n; i++) {
    const x0 = x + (len / n) * i, x1 = x + (len / n) * (i + 1);
    ctx.bezierCurveTo(x0 + len / n / 3, y - amp * (0.8 + r() * 0.4), x1 - len / n / 3, y + amp * (0.8 + r() * 0.4), x1, y);
  }
  ctx.stroke();
}

/** 四角星 ✦ */
function sparkle(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x + s * 0.12, y - s * 0.12, x + s, y);
  ctx.quadraticCurveTo(x + s * 0.12, y + s * 0.12, x, y + s);
  ctx.quadraticCurveTo(x - s * 0.12, y + s * 0.12, x - s, y);
  ctx.quadraticCurveTo(x - s * 0.12, y - s * 0.12, x, y - s);
  ctx.fillStyle = STAR; ctx.fill();
}

const FONT = '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif';
const INK = '#1b1612';

function rng(seed: number) {
  let a = (seed * 9973 + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 按字符折行（中文无空格），行宽尽量均匀，避免最后一行只剩一个字 */
function wrap(ctx: OffscreenCanvasRenderingContext2D, text: string, maxW: number) {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const n = Math.max(1, Math.ceil(ctx.measureText(para).width / maxW));
    const target = ctx.measureText(para).width / n + 1;
    let cur = '';
    for (const ch of para) {
      if (ctx.measureText(cur + ch).width > target && cur && lines.length < 3) { lines.push(cur); cur = ch; } else cur += ch;
    }
    lines.push(cur);
  }
  return lines.slice(0, 4);
}

/** 返回是否画了任何东西 */
export function drawOverlay(cv: OffscreenCanvas, w: number, h: number, boil: number, o: OverlayOpts): boolean {
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  const sfx = o.sfx.trim(), bubble = o.bubble.trim();
  const title = (o.title ?? '').trim(), caption = (o.caption ?? '').trim();
  const fr = o.frame ?? null;
  const art = drawArt(ctx, w, h, boil);
  if (!sfx && !bubble && !o.sparkles && !(fr && (title || caption))) return art;
  const hand = typography.applyToJournal ? fontFamily() : HAND;
  const font = typography.applyToJournal ? fontFamily() : FONT;
  const typeScale = typography.applyToJournal ? typography.size / 0.1 : 1;
  const r = rng(Math.floor(boil) + 1);
  const S = Math.min(w, h);
  const anchor = o.anchor ?? [0.5, 0.42];
  const bubbleRight = anchor[0] < 0.5;           // 气泡放在空间更大的一侧
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // —— 手账装饰：标题 / 落款 / 星星 / 表情线 ——
  ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1.5, S * 0.005);
  if (fr && title) {
    const fs = Math.min(S * 0.07 * typeScale, fr.top * h * 0.75);
    const tw = handText(ctx, title, w / 2, fr.top * h * 0.52, fs, r, INK, hand);
    squiggle(ctx, w / 2 - tw / 2 - fs * 2.3, fr.top * h * 0.55, fs * 1.6, fs * 0.16, r);
    squiggle(ctx, w / 2 + tw / 2 + fs * 0.7, fr.top * h * 0.55, fs * 1.6, fs * 0.16, r);
  }
  if (fr && caption) {
    const fs = Math.min(S * 0.038 * typeScale, fr.bottom * h * 0.7);
    const tw = handText(ctx, caption, w / 2, h - fr.bottom * h * 0.5, fs, r, '#4a4440', hand);
    ctx.lineWidth = Math.max(1, S * 0.0035);
    squiggle(ctx, w / 2 - tw / 2 - fs * 2.2, h - fr.bottom * h * 0.48, fs * 1.4, fs * 0.15, r);
    squiggle(ctx, w / 2 + tw / 2 + fs * 0.8, h - fr.bottom * h * 0.48, fs * 1.4, fs * 0.15, r);
    ctx.lineWidth = Math.max(1.5, S * 0.005);
  }
  if (o.sparkles) {
    // 位置固定（不随 boil 变），大小随 boil 一闪一闪
    const fixed = rng(7);
    const twinkle = rng(Math.floor(boil) * 13 + 5);
    const spots: [number, number, number][] = [];
    for (let i = 0; i < 6; i++) {
      let x = 0.08 + fixed() * 0.84, y = 0.06 + fixed() * 0.42;
      if (Math.hypot(x - anchor[0], (y - anchor[1]) * h / w) < 0.2) x = x < anchor[0] ? x - 0.18 : x + 0.18;
      spots.push([Math.min(0.94, Math.max(0.06, x)), y, i < 2 ? 1 : 0.55]);
    }
    for (const [x, y, k] of spots) {
      const s0 = S * 0.032 * k * (0.8 + twinkle() * 0.45);
      sparkle(ctx, x * w, y * h, s0);
      ctx.fillStyle = STAR; ctx.beginPath(); ctx.arc(x * w + s0 * 1.5, y * h + s0 * 1.2, s0 * 0.14, 0, Math.PI * 2); ctx.fill();
    }
    if (o.anchor) {
      // 人物旁的三笔表情线
      const ax = anchor[0] * w, ay = anchor[1] * h, side = anchor[0] > 0.5 ? 1 : -1;
      const d = S * 0.09;
      for (let i = -1; i <= 1; i++) {
        const a = Math.PI / 2 - side * Math.PI / 2 + i * 0.42 + (r() - 0.5) * 0.08;
        const x0 = ax - side * d * 0.0 + Math.cos(a) * d, y0 = ay + Math.sin(a) * d * 0.9;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(a) * S * 0.035, y0 + Math.sin(a) * S * 0.03); ctx.stroke();
      }
    }
  }

  if (bubble) {
    const fs = S * 0.062 * typeScale;
    ctx.font = `700 ${fs}px ${font}`;
    const lines = wrap(ctx, bubble, w * 0.36);
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const lh = fs * 1.28;
    const bw = tw + fs * 1.6, bh = lines.length * lh + fs * 1.1;
    let cx = anchor[0] * w + (bubbleRight ? 1 : -1) * (bw * 0.5 + S * 0.06);
    let cy = anchor[1] * h - bh * 0.5 - S * 0.12;
    cx = Math.min(w - bw * 0.56 - S * 0.02, Math.max(bw * 0.56 + S * 0.02, cx));
    cy = Math.min(h - bh * 0.6, Math.max(bh * 0.62 + S * 0.02, cy));
    const jx = (r() - 0.5) * S * 0.006, jy = (r() - 0.5) * S * 0.006;
    const lw = Math.max(2, S * 0.008);
    // 尾巴：从气泡指向人脸，只走六成距离
    const ax = anchor[0] * w, ay = anchor[1] * h;
    const tx = cx + (ax - cx) * 0.6, ty = cy + (ay - cy) * 0.6;
    const ang = Math.atan2(ty - cy, tx - cx);
    const base = bw * 0.12;
    ctx.beginPath();
    ctx.moveTo(cx + jx + Math.cos(ang + Math.PI / 2) * base, cy + jy + Math.sin(ang + Math.PI / 2) * base);
    ctx.quadraticCurveTo(cx + (tx - cx) * 0.6, cy + (ty - cy) * 0.6 + base * 0.3, tx + jx, ty + jy);
    ctx.lineTo(cx + jx + Math.cos(ang - Math.PI / 2) * base, cy + jy + Math.sin(ang - Math.PI / 2) * base);
    ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke();
    // 手绘感椭圆：半径逐点抖动
    ctx.beginPath();
    const N = 44, rx = bw * 0.58, ry = bh * 0.62;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const k = 1 + (r() - 0.5) * 0.035;
      const x = cx + jx + Math.cos(t) * rx * k, y = cy + jy + Math.sin(t) * ry * k;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, cx + jx, cy + jy + (i - (lines.length - 1) / 2) * lh));
  }

  if (sfx) {
    const len = [...sfx].length;
    const fs = S * 0.2 * typeScale * Math.min(1, 3.2 / Math.max(1, len));
    ctx.font = `900 ${fs}px ${font}`;
    const x = (bubble ? (bubbleRight ? 0.25 : 0.75) : 0.72) * w + (r() - 0.5) * S * 0.012;
    const y = 0.16 * h + fs * 0.4 + (r() - 0.5) * S * 0.012;
    const rotA = ((bubbleRight || !bubble ? 1 : -1) * -9 + (r() - 0.5) * 6) * Math.PI / 180;
    const sc = 1 + (r() - 0.5) * 0.08;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rotA); ctx.scale(sc, sc);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // 冲击线
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2, fs * 0.05);
    const tw = ctx.measureText(sfx).width;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI * 0.95 + (i / 6) * Math.PI * 0.9 + (r() - 0.5) * 0.15;
      const r0 = Math.max(tw * 0.55, fs * 0.75), r1 = r0 + fs * (0.25 + r() * 0.25);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 * 0.7); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1 * 0.7); ctx.stroke();
    }
    ctx.lineWidth = fs * 0.3; ctx.strokeStyle = '#fff'; ctx.strokeText(sfx, 0, 0);
    ctx.lineWidth = fs * 0.12; ctx.strokeStyle = INK; ctx.strokeText(sfx, 0, 0);
    ctx.fillStyle = '#ffcf26'; ctx.fillText(sfx, 0, 0);
    ctx.restore();
  }
  return true;
}
