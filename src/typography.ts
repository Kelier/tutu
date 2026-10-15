// 字体与艺术排版：同一个 Canvas2D 渲染器画预览、模板缩略图和所有导出
export const FONTS = [
  { id: 'mincho', label: '古典明朝', en: 'Shippori', family: '"ArtMincho", "ArtSerif", serif', face: 'ArtMincho', file: '/fonts/ShipporiMincho-Regular.woff2' },
  { id: 'serif', label: '思源宋体', en: 'Noto Serif', family: '"ArtSerif", serif', face: 'ArtSerif', file: '/fonts/NotoSerifSC[wght].woff2' },
  { id: 'brush', label: '毛笔行楷', en: 'Ma Shan Zheng', family: '"ArtBrush", "ArtSerif", serif', face: 'ArtBrush', file: '/fonts/MaShanZheng-Regular.woff2' },
  { id: 'hand', label: '手账楷书', en: 'Kaiti', family: '"Kaiti SC", "STKaiti", "KaiTi", "AR PL UKai CN", cursive', face: '', file: '' },
  { id: 'song', label: '系统宋体', en: 'Song', family: '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif', face: '', file: '' },
  { id: 'sans', label: '粗黑体', en: 'Heavy Sans', family: '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif', face: '', file: '', weight: 800 },
  { id: 'round', label: '圆体', en: 'Rounded', family: '"Hiragino Maru Gothic ProN", "Yuanti SC", "Arial Rounded MT Bold", "PingFang SC", sans-serif', face: '', file: '', weight: 700 },
  { id: 'mono', label: '打字机', en: 'Mono', family: '"Courier New", ui-monospace, "SF Mono", Menlo, monospace', face: '', file: '' },
] as const;
export type FontId = typeof FONTS[number]['id'];

export const LAYOUTS = [
  ['straight', '横排'], ['vertical', '竖排'], ['orbit', '弧形'], ['circle', '整圆'], ['wave', '波浪'],
  ['scatter', '散落'], ['diagonal', '斜排'], ['stairs', '阶梯'], ['stack', '主副标题'],
] as const;
export const EFFECTS = [
  ['ink', '实色'], ['outline', '空心'], ['sticker', '贴纸白边'], ['shadow', '立体投影'], ['neon', '霓虹'],
  ['crayon', '蜡笔抖动'], ['highlight', '荧光笔'], ['subtitle', '字幕条'], ['stamp', '朱红印章'],
  ['chromatic', '双色套印'], ['glitch', '数字故障'], ['digits', '数字矩阵'],
] as const;
export type ArtLayout = typeof LAYOUTS[number][0];
export type ArtEffect = typeof EFFECTS[number][0];

export interface TypeStyle {
  text: string; font: FontId; size: number; tracking: number; x: number; y: number;
  rotation: number; radius: number; color: string; opacity: number;
  layout: ArtLayout; effect: ArtEffect; seed: number;
}
export const typography: TypeStyle & { applyToJournal: boolean; preset: string } = {
  text: '', font: 'mincho', size: 0.1, tracking: 0.08, x: 0.5, y: 0.5,
  rotation: 0, radius: 0.32, color: '#292c30', opacity: 1,
  layout: 'straight', effect: 'ink', seed: 1,
  applyToJournal: true, preset: '',
};

// ---------------- 30 个排版模板 ----------------
export interface TypeTemplate extends Omit<TypeStyle, 'text' | 'seed' | 'opacity' | 'radius'> {
  id: string; name: string; cat: string; sample: string; radius?: number; opacity?: number;
}
export const TYPE_CATS = ['全部', '标题', '古典', '手账', '海报', '漫画', '实验'];
const T = (id: string, name: string, cat: string, sample: string, font: FontId, layout: ArtLayout, effect: ArtEffect,
  color: string, size: number, x = 0.5, y = 0.5, rotation = 0, tracking = 0.08, radius = 0.32): TypeTemplate =>
  ({ id, name, cat, sample, font, layout, effect, color, size, x, y, rotation, tracking, radius });
export const TYPE_TEMPLATES: TypeTemplate[] = [
  T('headline', '晨报标题', '标题', '今日晴', 'serif', 'straight', 'ink', '#1f1d1a', 0.13, 0.5, 0.15, 0, 0.12),
  T('stack', '主副标题', '标题', '夏日\n漫长的午后', 'serif', 'stack', 'ink', '#1f1d1a', 0.12, 0.5, 0.2),
  T('film', '电影片名', '标题', '远方', 'mincho', 'straight', 'shadow', '#f7efdc', 0.15, 0.5, 0.5, 0, 0.5),
  T('mag', '杂志角标', '标题', 'VOL.07\n秋日特辑', 'sans', 'stack', 'ink', '#c3262c', 0.09, 0.24, 0.14),
  T('minimal', '极简留白', '标题', '安静', 'serif', 'straight', 'ink', '#2a2622', 0.05, 0.5, 0.9, 0, 0.6),
  T('vertical', '古典竖排', '古典', '山河远阔', 'mincho', 'vertical', 'ink', '#2a2622', 0.09, 0.84, 0.5, 0, 0.18),
  T('brush', '毛笔题字', '古典', '风起', 'brush', 'vertical', 'ink', '#1b1714', 0.16, 0.18, 0.42),
  T('seal', '朱红印章', '古典', '长乐', 'brush', 'vertical', 'stamp', '#c3262c', 0.07, 0.86, 0.8),
  T('poem', '竖排诗句', '古典', '春风又绿\n江南岸', 'song', 'vertical', 'ink', '#3a2e26', 0.065, 0.8, 0.45, 0, 0.12),
  T('ring', '环形印记', '古典', '一期一会·一期一会·', 'mincho', 'circle', 'outline', '#2f6f78', 0.06, 0.5, 0.5, 0, 0.1, 0.34),
  T('note', '手账便签', '手账', '今天也很好', 'hand', 'straight', 'highlight', '#2e2a28', 0.085, 0.5, 0.86, -3),
  T('crayon', '蜡笔手写', '手账', '去海边吧', 'hand', 'straight', 'crayon', '#e8962a', 0.12, 0.5, 0.82, -4),
  T('arc', '弧形徽章', '手账', '周末散步日记', 'round', 'orbit', 'ink', '#f7efdc', 0.07, 0.5, 0.56, 0, 0.18, 0.36),
  T('wave', '波浪小语', '手账', '慢慢来～', 'round', 'wave', 'sticker', '#2f6f78', 0.1, 0.5, 0.8),
  T('stairs', '阶梯日记', '手账', '一步\n一步\n往前走', 'hand', 'stairs', 'ink', '#ad493f', 0.08, 0.38, 0.3),
  T('scatter', '散落拼贴', '手账', '快乐碎片', 'brush', 'scatter', 'sticker', '#e94f37', 0.1),
  T('outline', '空心大字', '海报', 'WOW', 'sans', 'straight', 'outline', '#ffffff', 0.24, 0.5, 0.5, 0, 0.04),
  T('shadow', '立体投影', '海报', '出发！', 'sans', 'straight', 'shadow', '#ffd400', 0.15, 0.5, 0.2, -6),
  T('slogan', '斜切标语', '海报', '就是现在', 'sans', 'diagonal', 'ink', '#111111', 0.12, 0.5, 0.5, -10),
  T('neon', '霓虹招牌', '海报', '营业中', 'round', 'straight', 'neon', '#ff4fb8', 0.13, 0.5, 0.2),
  T('neonring', '霓虹星环', '海报', '★ OPEN ★ NIGHT ', 'mono', 'circle', 'neon', '#39e6ff', 0.055, 0.5, 0.5, 0, 0.1, 0.4),
  T('sub', '底部字幕', '海报', '那天风很大，我们都没说话', 'sans', 'straight', 'subtitle', '#fffaf0', 0.05, 0.5, 0.9, 0, 0.04),
  T('boom', '漫画爆字', '漫画', '砰！！', 'sans', 'straight', 'sticker', '#ffd400', 0.17, 0.72, 0.22, -12, 0),
  T('bubblegum', '气泡糖', '漫画', '嘿嘿嘿', 'round', 'wave', 'sticker', '#ff6fb1', 0.12, 0.3, 0.75, 6),
  T('shout', '速度喊话', '漫画', '冲鸭——', 'sans', 'diagonal', 'shadow', '#e94f37', 0.13, 0.5, 0.25, -8, 0),
  T('chalk', '粉笔板书', '漫画', '今日课题', 'hand', 'straight', 'crayon', '#f4f1e8', 0.11, 0.5, 0.14),
  T('glitch', '故障海报', '实验', 'ERROR 404', 'mono', 'straight', 'glitch', '#111111', 0.12),
  T('riso', '双色套印', '实验', '印刷物', 'sans', 'straight', 'chromatic', '#222222', 0.15),
  T('matrix', '数字矩阵', '实验', '0101', 'mono', 'straight', 'digits', '#2f6f78', 0.1),
  T('type', '复古打字', '实验', 'dear diary,\nit rained again', 'mono', 'stairs', 'ink', '#2a241d', 0.055, 0.32, 0.4, 0, 0.02),

];

// ---------------- 字体按需加载 ----------------
const loaded = new Map<string, Promise<void>>();
const fontById = (id: string) => FONTS.find((f) => f.id === id) ?? FONTS[0];
export function fontFamily(id: string = typography.font) { return fontById(id).family; }
const fontWeight = (id: string) => ('weight' in fontById(id) ? (fontById(id) as { weight: number }).weight : 400);

function loadFace(id: string) {
  const f = fontById(id);
  if (!f.file) return Promise.resolve();
  if (!loaded.has(f.id)) loaded.set(f.id, (async () => {
    const face = new FontFace(f.face, `url("${f.file}")`);
    await face.load(); document.fonts.add(face);
  })().catch((e) => { loaded.delete(f.id); throw e; }));
  return loaded.get(f.id)!;
}
/** 当前字体 + （明朝 / 毛笔体缺字时的）完整简体中文宋体 */
export async function ensureArtFont(id: string = typography.font) {
  await loadFace(id);
  if (id === 'mincho' || id === 'brush') await loadFace('serif');
}
/** 模板缩略图用：只加载小字体，不触发 11MB 的宋体兜底 */
export const preloadPreviewFonts = () => Promise.allSettled([loadFace('mincho'), loadFace('brush')]);

// ---------------- 渲染 ----------------
const rnd = (n: number) => { const a = Math.sin(n * 12.9898) * 43758.5453; return a - Math.floor(a); };

/** 把单行长文字切成几行（阶梯、主副标题用） */
function splitLines(text: string, per: number) {
  if (text.includes('\n')) return text.split('\n').filter(Boolean);
  const cs = [...text], out: string[] = [];
  for (let i = 0; i < cs.length; i += per) out.push(cs.slice(i, i + per).join(''));
  return out;
}

/** Output-resolution typography; all export paths share this renderer. */
export function drawArt(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, w: number, h: number, frame: number, o: TypeStyle = typography) {
  const text = o.text.trim();
  if (!text) return false;
  const S = Math.min(w, h), fs = Math.max(9, S * o.size);
  const fam = fontFamily(o.font), wt = fontWeight(o.font);
  const boil = Math.floor(frame / 2);
  ctx.save(); ctx.translate(o.x * w, o.y * h); ctx.rotate(o.rotation * Math.PI / 180);
  ctx.globalAlpha = o.opacity;
  const setFont = (size: number) => { ctx.font = `${wt} ${size}px ${fam}`; };
  setFont(fs);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';

  // 单个字：所有效果都在这里，cw 为字格宽度（字幕条 / 荧光笔连成一条）
  const paint = (ch: string, x: number, y: number, cw: number, f = fs, k = 0) => {
    ctx.save();
    const col = o.color;
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, f * 0.035);
    switch (o.effect) {
      case 'outline': ctx.strokeText(ch, x, y); break;
      case 'sticker':
        ctx.shadowColor = 'rgba(40,28,16,.28)'; ctx.shadowOffsetY = f * 0.06; ctx.shadowBlur = f * 0.05;
        ctx.strokeStyle = '#fffdf8'; ctx.lineWidth = f * 0.24; ctx.strokeText(ch, x, y);
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = '#241d17'; ctx.lineWidth = f * 0.05; ctx.strokeText(ch, x, y);
        ctx.fillText(ch, x, y); break;
      case 'shadow': {
        const n = 8, d = f * 0.012;
        ctx.fillStyle = '#241d17';
        for (let i = n; i > 0; i--) ctx.fillText(ch, x + i * d, y + i * d);
        ctx.fillStyle = col; ctx.fillText(ch, x, y);
        ctx.strokeStyle = '#241d17'; ctx.lineWidth = f * 0.025; ctx.strokeText(ch, x, y); break;
      }
      case 'neon': {
        const flick = rnd(boil * 3.1 + k + o.seed) > 0.93 ? 0.35 : 1;
        ctx.globalAlpha *= flick;
        ctx.shadowColor = col; ctx.shadowBlur = f * 0.45; ctx.lineWidth = f * 0.06; ctx.strokeText(ch, x, y);
        ctx.shadowBlur = f * 0.15; ctx.fillText(ch, x, y);
        ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = f * 0.02; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(ch, x, y); break;
      }
      case 'crayon':
        for (let i = 0; i < 3; i++) {
          const j = rnd(boil * 7 + k * 3 + i + o.seed), j2 = rnd(boil * 5 + k * 11 + i * 7 + o.seed);
          ctx.globalAlpha = o.opacity * 0.45; ctx.fillText(ch, x + (j - 0.5) * f * 0.06, y + (j2 - 0.5) * f * 0.06);
        }
        ctx.globalAlpha = o.opacity * 0.9; ctx.lineWidth = f * 0.018; ctx.strokeText(ch, x + (rnd(boil + k) - 0.5) * f * 0.04, y); break;
      case 'highlight':
        ctx.save(); ctx.globalAlpha = o.opacity * 0.7; ctx.fillStyle = '#f6d36b';
        ctx.fillRect(x - cw / 2 - 1, y + f * 0.02, cw + 2, f * 0.42); ctx.restore();
        ctx.fillText(ch, x, y); break;
      case 'subtitle':
        ctx.save(); ctx.globalAlpha = o.opacity * 0.72; ctx.fillStyle = '#16120e';
        ctx.fillRect(x - cw / 2 - 0.5, y - f * 0.72, cw + 1, f * 1.44); ctx.restore();
        ctx.fillText(ch, x, y); break;
      case 'stamp': {
        const s = f * 1.2;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        ctx.fillStyle = '#f7efdc'; ctx.fillText(ch, x, y);
        ctx.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + (rnd(k * 13 + i) - 0.5) * s, y + (rnd(k * 17 + i * 3) - 0.5) * s, f * 0.03 * (1 + rnd(i + k)), 0, 7); ctx.fill(); }
        break;
      }
      case 'chromatic': case 'glitch': {
        const offset = f * (o.effect === 'glitch' ? 0.05 + 0.05 * Math.sin(frame * 1.7) : 0.035);
        ctx.fillStyle = '#d95371'; ctx.fillText(ch, x - offset, y);
        ctx.fillStyle = '#268dba'; ctx.fillText(ch, x + offset, y + offset * 0.6);
        ctx.fillStyle = col; ctx.fillText(ch, x, y);
        if (o.effect === 'glitch') {
          ctx.beginPath(); ctx.rect(x - f, y - f * 0.1, f * 2, f * 0.12); ctx.clip();
          ctx.clearRect(x - f, y - f * 0.1, f * 2, f * 0.12);
          ctx.fillStyle = col; ctx.fillText(ch, x + f * 0.14 * Math.sin(frame + o.seed), y);
        }
        break;
      }
      default: ctx.fillText(ch, x, y);
    }
    ctx.restore();
  };
  const cellW = (ch: string, f = fs) => ctx.measureText(ch).width + f * o.tracking;
  /** 一行横排（居中于 0），dy 为每个字的额外纵向偏移 */
  const row = (line: string, y: number, f = fs, dy: (i: number) => number = () => 0, k0 = 0) => {
    setFont(f);
    const cs = [...line], ws = cs.map((c) => cellW(c, f)), total = ws.reduce((a, b) => a + b, 0) - f * o.tracking;
    let x = -total / 2;
    cs.forEach((ch, i) => { paint(ch, x + ws[i] / 2, y + dy(i), ws[i], f, k0 + i); x += ws[i]; });
  };

  const chars = [...text.replace(/\n/g, ' ')];
  const lines = text.split('\n');
  switch (o.effect === 'digits' ? 'digits' : o.layout) {
    case 'digits': {
      // ASCII / 数字艺术：稳定种子，播放时数字缓慢变化
      const cols = 14, rows = 7, step = fs * 0.75;
      ctx.font = `400 ${fs * 0.52}px ui-monospace, monospace`;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const n = Math.abs(Math.round(Math.sin(i * 12.98 + j * 78.23 + o.seed + Math.floor(frame / 3)) * 43758));
        ctx.globalAlpha = o.opacity * (0.2 + (n % 8) / 10);
        ctx.fillStyle = o.color; ctx.fillText(String(n % 10), (i - (cols - 1) / 2) * step, (j - (rows - 1) / 2) * step);
      }
      ctx.globalAlpha = o.opacity; o = { ...o, effect: 'ink' };
      row(lines[0], 0);
      break;
    }
    case 'orbit': case 'circle': {
      const radius = S * o.radius, full = o.layout === 'circle';
      const angleStep = full ? 2 * Math.PI / Math.max(chars.length, 1) : Math.min(2 * Math.PI / Math.max(chars.length, 1), fs * (1 + o.tracking) / radius);
      const spin = frame * (full ? 0.012 : 0.006);
      chars.forEach((ch, i) => {
        const a = -Math.PI / 2 + (i - (chars.length - 1) / 2) * angleStep + spin;
        ctx.save(); ctx.translate(Math.cos(a) * radius, Math.sin(a) * radius); ctx.rotate(a + Math.PI / 2); paint(ch, 0, 0, fs, fs, i); ctx.restore();
      });
      break;
    }
    case 'vertical':
      lines.forEach((line, col) => [...line].forEach((ch, i) =>
        paint(ch, ((lines.length - 1) / 2 - col) * fs * 1.4, (i - ([...line].length - 1) / 2) * fs * (1.1 + o.tracking), fs * 1.1, fs, col * 20 + i)));
      break;
    case 'scatter':
      chars.forEach((ch, i) => {
        const n = rnd(i + 1 + o.seed);
        ctx.save(); ctx.translate((n - 0.5) * w * 0.7, Math.sin(i * 7 + o.seed) * 0.5 * h * 0.65); ctx.rotate((n - 0.5) * 1.2); paint(ch, 0, 0, fs, fs, i); ctx.restore();
      });
      break;
    case 'diagonal':
      lines.forEach((line, j) => row(line, (j - (lines.length - 1) / 2) * fs * 1.35, fs, (i) => (i - ([...line].length - 1) / 2) * fs * 0.32, j * 20));
      break;
    case 'stairs': {
      const ls = splitLines(text, 4);
      ls.forEach((line, j) => { ctx.save(); ctx.translate((j - (ls.length - 1) / 2) * fs * 1.3, 0); row(line, (j - (ls.length - 1) / 2) * fs * 1.3, fs, undefined, j * 20); ctx.restore(); });
      break;
    }
    case 'stack': {
      const ls = splitLines(text, 4);
      const big = fs * 1.5, small = fs * 0.5;
      const total = big + (ls.length - 1) * small * 1.6;
      row(ls[0], -total / 2 + big / 2, big);
      ls.slice(1).forEach((line, j) => row(line, -total / 2 + big + small * 0.9 + j * small * 1.6, small, undefined, 20 + j * 20));
      break;
    }
    default:
      lines.forEach((line, j) => row(line, (j - (lines.length - 1) / 2) * fs * 1.35, fs,
        o.layout === 'wave' ? (i) => Math.sin(i * 0.7 + frame * 0.15) * fs * 0.55 : undefined, j * 20));
  }
  ctx.restore(); return true;
}

// ---------------- 面板 ----------------
export function initTypography(root: HTMLElement, changed: () => void, notify: (s: string) => void) {
  root.innerHTML = `
    <header class="block-head"><h3>字体与艺术排版</h3><button class="btn small ghost" id="rollType" title="保留文字，从当前分类换一个排版模板">Roll 换一版</button></header>
    <label class="art-field"><span class="field-label">画面文字</span><textarea id="artText" rows="2" maxlength="80" placeholder="写一句话，让它成为画面的一部分"></textarea></label>
    <div class="type-head"><span class="field-label">排版模板 <b>${TYPE_TEMPLATES.length}</b></span><span class="muted" id="fontStatus">点一下直接套用</span></div>
    <div class="chips type-cats" id="typeCats" role="tablist">${TYPE_CATS.map((c, i) => `<button class="chip${i ? '' : ' on'}" role="tab" data-cat="${c}">${c}</button>`).join('')}</div>
    <div class="type-selection"><span id="typeSelection" aria-live="polite">选择一张排版小样</span><button class="text-btn" id="undoType" disabled>撤销套用</button></div>
    <div class="type-gallery" id="typeGallery" aria-label="字体排版模板">${TYPE_TEMPLATES.map((t) => `<button class="type-card" data-id="${t.id}" data-cat="${t.cat}" title="${t.name}"><canvas width="1" height="1" aria-hidden="true"></canvas><span>${t.name}</span></button>`).join('')}</div>
    <div class="type-pages"><button class="btn small ghost" id="typePrev" aria-label="上一页模板">上一页</button><span id="typePage" role="status"></span><button class="btn small ghost" id="typeNext" aria-label="下一页模板">下一页</button></div>
    <div class="type-actions"><button class="btn small ghost" id="moveType" aria-pressed="false">拖动文字</button><button class="btn small ghost" id="resetType">还原排版</button><button class="btn small ghost" id="clearType">清空</button><a class="type-preview" href="#stage">查看画面</a></div>
    <details class="type-tune" id="typeTune"><summary><span>细调字体、布局和效果</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></summary>
      <span class="field-label">字体</span>
      <div class="font-grid" id="artFont" role="radiogroup" aria-label="字体">${FONTS.map((f) => `<button role="radio" data-v="${f.id}"><i style="font-family:${f.family.replace(/"/g, "'")};font-weight:${'weight' in f ? f.weight : 400}">永 Aa</i><span>${f.label}</span></button>`).join('')}</div>
      <span class="field-label">布局</span>
      <div class="chips" id="artLayout" role="radiogroup" aria-label="布局">${LAYOUTS.map(([v, t]) => `<button class="chip" role="radio" data-v="${v}">${t}</button>`).join('')}</div>
      <span class="field-label">艺术效果</span>
      <div class="chips" id="artEffect" role="radiogroup" aria-label="艺术效果">${EFFECTS.map(([v, t]) => `<button class="chip" role="radio" data-v="${v}">${t}</button>`).join('')}</div>
      <div id="artSliders"></div>
      <span class="field-label">文字颜色</span>
      <div class="ink-row" id="artColors">${['#292c30', '#f7efdc', '#c3262c', '#e8962a', '#2f6f78', '#ffd400', '#ff4fb8', '#39e6ff'].map((c) => `<button data-v="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}<label class="ink-custom" title="自定义颜色"><input type="color" id="artColor" value="${typography.color}"></label></div>
      <label class="art-check"><input type="checkbox" id="artJournal" checked>字体同时用于手账标题、落款和漫画文字</label>
      <p class="art-hint">明朝、思源宋体、毛笔体采用 SIL OFL 免费授权；其余为设备系统字体。按需加载。<a href="/fonts/LICENSES.txt" target="_blank" rel="noopener">字体授权</a></p>
    </details>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const syncers: (() => void)[] = [];
  const history: typeof typography[] = [];
  let sampleText = !typography.text.trim();
  let category = '全部', page = 0;
  let lastPreset: TypeTemplate | undefined;
  const pageSize = 6;
  const remember = () => { history.push({ ...typography }); if (history.length > 20) history.shift(); };
  const syncAll = () => syncers.forEach((f) => f());
  const status = $('fontStatus');
  let fontRequest = 0;
  const fontReady = async () => {
    const request = ++fontRequest;
    const f = fontById(typography.font);
    if (!f.file) { status.textContent = `${f.label}已就绪 · 系统字体`; changed(); return; }
    status.textContent = `正在加载${f.label}…`;
    try { await ensureArtFont(f.id); if (request !== fontRequest) return; status.textContent = `${f.label}已就绪`; changed(); renderCards(); }
    catch { if (request !== fontRequest) return; status.textContent = '字体加载失败，暂用系统字体'; notify('字体下载失败，请重新选择字体'); }
  };

  const text = $<HTMLTextAreaElement>('artText');
  text.oninput = () => { typography.text = text.value; sampleText = !text.value.trim(); changed(); renderCards(); };
  syncers.push(() => { if (document.activeElement !== text) text.value = typography.text; });

  // 单选按钮组：字体 / 布局 / 效果 / 颜色
  const radios = (id: string, get: () => string, set: (v: string) => void) => {
    const el = $(id);
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('button')];
    buttons.forEach((b, i) => {
      b.onclick = () => { set(b.dataset.v!); typography.preset = ''; syncAll(); changed(); };
      b.onkeydown = e => { const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0; if (d) { e.preventDefault(); const next = buttons[(i + d + buttons.length) % buttons.length]; next.click(); next.focus(); } };
    });
    syncers.push(() => el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { const on = b.dataset.v === get(); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }));
  };
  radios('artFont', () => typography.font, (v) => { typography.font = v as FontId; void fontReady(); });
  radios('artLayout', () => typography.layout, (v) => (typography.layout = v as ArtLayout));
  radios('artEffect', () => typography.effect, (v) => (typography.effect = v as ArtEffect));
  radios('artColors', () => typography.color, (v) => (typography.color = v));
  const color = $<HTMLInputElement>('artColor');
  color.oninput = () => { typography.color = color.value; typography.preset = ''; syncAll(); changed(); };
  syncers.push(() => (color.value = typography.color));
  $<HTMLInputElement>('artJournal').onchange = (e) => { typography.applyToJournal = (e.target as HTMLInputElement).checked; changed(); void fontReady(); };

  const defs: [keyof TypeStyle, string, number, number, number][] = [['size', '字号', 0.03, 0.26, 0.005], ['tracking', '字距', -0.03, 0.6, 0.01], ['x', '水平位置', 0.05, 0.95, 0.01], ['y', '垂直位置', 0.05, 0.95, 0.01], ['rotation', '旋转', -180, 180, 1], ['radius', '环绕半径', 0.12, 0.48, 0.01], ['opacity', '透明度', 0.1, 1, 0.05]];
  for (const [key, label, min, max, step] of defs) {
    const r = document.createElement('label'); r.className = 'slider';
    r.innerHTML = `<span>${label}</span><output></output><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${label}">`;
    const input = r.querySelector('input')!, output = r.querySelector('output')!;
    const sync = () => {
      input.value = String(typography[key]);
      output.value = key === 'rotation' ? `${typography[key]}°` : `${Math.round(Number(typography[key]) * 100)}%`;
      r.hidden = key === 'radius' && typography.layout !== 'orbit' && typography.layout !== 'circle';
    };
    syncers.push(sync);
    input.oninput = () => { (typography[key] as number) = +input.value; typography.preset = ''; syncAll(); changed(); };
    $('artSliders').append(r);
  }

  // 模板卡片：用当前文字（没有就用模板示例）在小画布上实时渲染
  const gallery = $('typeGallery');
  const cards = [...gallery.querySelectorAll<HTMLButtonElement>('.type-card')];
  const renderCards = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    for (const card of cards) {
      if (card.hidden) continue;
      const t = TYPE_TEMPLATES.find((x) => x.id === card.dataset.id)!;
      const c = card.querySelector('canvas')!;
      const w = 132, h = 92;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const light = ['#ffffff', '#f7efdc', '#fffaf0', '#f4f1e8', '#ffd400', '#39e6ff', '#ff4fb8'].includes(t.color.toLowerCase());
      ctx.fillStyle = light ? '#3a3129' : '#f3ece0'; ctx.fillRect(0, 0, w, h);
      const own = typography.text.trim();
      const sample = own ? [...own.replace(/\n/g, '')].slice(0, ['circle', 'border', 'spiral'].includes(t.layout) ? 24 : 8).join('') : t.sample;
      // 缩略图里字号放大一点、位置收拢到中间，便于辨认
      drawArt(ctx, w, h, 4, { ...t, text: sample, opacity: 1, seed: 7, radius: t.radius ?? 0.32, size: Math.min(0.26, Math.max(0.085, t.size * 1.3)), x: 0.5 + (t.x - 0.5) * 0.25, y: 0.5 + (t.y - 0.5) * 0.25 });
    }
  };
  const filtered = () => TYPE_TEMPLATES.filter(t => category === '全部' || t.cat === category);
  const renderGallery = () => {
    const options = filtered(), total = Math.max(1, Math.ceil(options.length / pageSize));
    page = Math.max(0, Math.min(page, total - 1));
    const visible = new Set(options.slice(page * pageSize, (page + 1) * pageSize).map(t => t.id));
    cards.forEach(c => c.hidden = !visible.has(c.dataset.id!));
    $('typePage').textContent = `${page + 1} / ${total} · ${options.length} 款`;
    $<HTMLButtonElement>('typePrev').disabled = page === 0;
    $<HTMLButtonElement>('typeNext').disabled = page === total - 1;
    $('typeCats').querySelectorAll<HTMLButtonElement>('.chip').forEach(b => {
      const on = b.dataset.cat === category; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    renderCards();
  };
  const applyPreset = (t: TypeTemplate) => {
    remember(); lastPreset = t;
    if (!typography.text.trim() || sampleText) { typography.text = t.sample; text.value = t.sample; sampleText = true; }
    Object.assign(typography, { font: t.font, layout: t.layout, effect: t.effect, color: t.color, size: t.size, tracking: t.tracking, x: t.x, y: t.y, rotation: t.rotation, radius: t.radius ?? 0.32, opacity: t.opacity ?? 1, preset: t.id });
    if (category !== '全部' && category !== t.cat) category = '全部';
    page = Math.floor(filtered().findIndex(x => x.id === t.id) / pageSize);
    syncAll(); renderGallery(); changed(); void fontReady();
  };
  cards.forEach((c) => (c.onclick = () => applyPreset(TYPE_TEMPLATES.find((t) => t.id === c.dataset.id)!)));
  syncers.push(() => {
    cards.forEach((c) => { const on = c.dataset.id === typography.preset; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
    $('typeSelection').textContent = TYPE_TEMPLATES.find(t => t.id === typography.preset)?.name ?? (typography.text ? '自由排版 · 已微调' : '选择一张排版小样');
    $<HTMLButtonElement>('undoType').disabled = !history.length;
  });
  const catButtons = [...$('typeCats').querySelectorAll<HTMLButtonElement>('.chip')];
  const selectCategory = (b: HTMLButtonElement) => { category = b.dataset.cat!; page = 0; renderGallery(); };
  catButtons.forEach((b, i) => {
    b.onclick = () => selectCategory(b);
    b.onkeydown = e => {
      const direction = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (direction) { e.preventDefault(); const next = catButtons[(i + direction + catButtons.length) % catButtons.length]; selectCategory(next); next.focus(); }
    };
  });
  $('typePrev').onclick = () => { page--; renderGallery(); };
  $('typeNext').onclick = () => { page++; renderGallery(); };
  $('undoType').onclick = () => {
    const prev = history.pop(); if (!prev) return;
    Object.assign(typography, prev); sampleText = false; lastPreset = TYPE_TEMPLATES.find(t => t.id === prev.preset);
    syncAll(); changed(); void fontReady(); renderGallery();
  };
  $('resetType').onclick = () => {
    const t = lastPreset;
    if (t) applyPreset(t);
    else { remember(); Object.assign(typography, { size: 0.1, tracking: 0.08, x: 0.5, y: 0.5, rotation: 0, radius: 0.32, opacity: 1, layout: 'straight', effect: 'ink' }); syncAll(); changed(); }
  };
  $('clearType').onclick = () => { remember(); typography.text = ''; typography.preset = ''; sampleText = true; syncAll(); changed(); renderCards(); };
  root.addEventListener('type-position', () => { typography.preset = ''; syncAll(); changed(); });
  renderGallery();

  // 卡片进入视口才画；小字体（明朝 / 毛笔）在空闲时加载，加载完再重画一次
  let started = false;
  new IntersectionObserver((es) => {
    if (started || !es.some((e) => e.isIntersecting)) return;
    started = true; renderCards();
    void preloadPreviewFonts().then(renderCards);
  }, { rootMargin: '200px' }).observe(gallery);

  $('rollType').onclick = () => {
    const choices = filtered().filter(t => t.id !== typography.preset);
    const t = choices[Math.floor(Math.random() * choices.length)];
    if (t) { applyPreset(t); typography.seed = Math.floor(Math.random() * 10000); changed(); }
  };
  // 字体只在首次输入、选择或套用模板时加载，首屏不下载大型 CJK 字库
  text.addEventListener('input', () => void fontReady(), { once: true });
  syncAll();
}
