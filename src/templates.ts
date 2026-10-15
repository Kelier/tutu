// 风格模板：同一条预处理管线（去细节 → 量化 → 线/明度），换一个合成 shader + 色板 + 参数
import type { StyleParams } from './engine';
import { CRAYON_BOX } from './palette';

export type ControlKey =
  | 'kuwR' | 'chroma' | 'palette' | 'palCount'
  | 'spacing' | 'pressure' | 'grain' | 'cross' | 'hatchAng'
  | 'lineW' | 'detail' | 'edgeTh' | 'wobble' | 'boil'
  | 'shadow' | 'colors';

export interface Template {
  id: string;
  name: string;
  en: string;
  desc: string;
  palette: string[];
  params: Partial<StyleParams> & { style: number };
  paper: string; ink: string; shadow: string;
  boilEvery?: number;
  journal?: boolean;          // 切到这个模板时默认打开手账装饰（边框 + 标题 + 星星）
  hide?: ControlKey[];
  labels?: Partial<Record<ControlKey, string>>;
}

const MANGA_GRAYS = ['#111111', '#3c3c3c', '#6a6a6a', '#9a9a9a', '#c9c9c9', '#f4f4f4'];
const POP = ['#111111', '#ffffff', '#ffd400', '#ff2d2d', '#1e88ff', '#00c2d1', '#ff6fb1', '#f6c39a', '#7a3cff', '#2fbf4a', '#ff8a00', '#8a8a8a'];
const RISO = ['#ff48b0', '#0078bf', '#ffe800', '#f3efe6', '#2b2b2b'];
const CHALK = ['#f4f1e8', '#f7d36b', '#f29e7a', '#f28fb3', '#a9d8f0', '#9fe0b8', '#c9b3f2', '#e8775c', '#6fb3e0', '#cfcfc6', '#3a4a44', '#20302a'];
const NEON = ['#ff2bd6', '#00f0ff', '#fff200', '#39ff14', '#ff7a00', '#9d4dff', '#ff3b3b', '#ffffff', '#3d7bff', '#1a1a2e'];
const PAPERCUT = ['#2b2b2b', '#f5f0e6', '#e94f37', '#f6bd60', '#3d5a80', '#98c1d9', '#81b29a', '#f2cc8f', '#e07a5f', '#6d597a', '#b56576', '#4a7c59', '#f4a259', '#c9c1b6'];
const THREAD = ['#1c1c1c', '#f4efe4', '#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#d35400', '#7f8c8d', '#e8a598', '#5d4037', '#a3d5e0', '#f5b7c5'];
const WATER = ['#2f3e46', '#e8c07d', '#d1495b', '#edae49', '#66a182', '#00798c', '#30638e', '#8d6a9f', '#f2d0a9', '#b8b8aa', '#f7f3ea', '#8c5e3c', '#a7c4d6', '#e9967a'];
const PASTEL = ['#2a2626', '#fbf6ec', '#8fb4ea', '#b9d3f2', '#f2a7b8', '#e98f7e', '#9bb06a', '#6f7d3a', '#e9c25a', '#a8463a', '#c49a6c', '#b7a6dc', '#f4c7a1', '#c9c2b4'];
const PICO8 = ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'];

export const TEMPLATES: Template[] = [
  {
    id: 'crayon', name: '蜡笔抖抖', en: 'Crayon Boil', desc: '参考视频同款：粗描边、斜排线、6fps 抖动',
    palette: CRAYON_BOX,
    params: { style: 0, kuwR: 5, chroma: 1.35, spacing: 6, pressure: 0.9, grain: 0.55, lineW: 2.0, wobble: 2.0, edgeTh: 0.14, hatchAng: 35, cross: 0.35, detail: 0.4, tone: 0.6 },
    paper: '#ebe3d7', ink: '#2a2018', shadow: '#2f6f78',
  },
  {
    id: 'island', name: '云岛蜡笔', en: 'Island Crayon', desc: '参考图画风 · 天蓝与珊瑚粉、粗蜡笔排线、奶油纸和金色星星',
    palette: ['#292c30', '#f7efdc', '#78a7d8', '#b3cce7', '#ed9d9d', '#ce6e62', '#75804c', '#a2a16a', '#e4bd58', '#9b493c', '#d9b18c', '#e6cfb4'],
    params: { style: 14, kuwR: 7, chroma: 1.12, spacing: 4.2, pressure: 1.12, grain: 0.48, lineW: 0.65, wobble: 1.1, edgeTh: 0.2, hatchAng: 32, detail: 0.3, tone: 0.35, bgSimp: 0.65 },
    paper: '#f4ead6', ink: '#35302b', shadow: '#78a7d8', journal: true, boilEvery: 3,
    hide: ['cross', 'shadow'],
    labels: { spacing: '蜡笔笔触', grain: '纸面露白', lineW: '色块间隙' },
  },
  {
    id: 'kid', name: '儿童涂鸦', en: 'Kid Doodle', desc: '大色块、抖得更凶、轮廓更粗',
    palette: CRAYON_BOX,
    params: { style: 0, kuwR: 7, chroma: 1.6, spacing: 7, pressure: 0.95, grain: 0.5, lineW: 3.6, wobble: 3.2, edgeTh: 0.08, hatchAng: -30, cross: 0.2, detail: 0.15, tone: 0.3 },
    paper: '#efe7da', ink: '#2a2018', shadow: '#2f6f78',
  },
  {
    id: 'manga', name: '漫画线稿', en: 'Manga Ink', desc: '墨线 + 三阶网点 + 暗部涂黑',
    palette: MANGA_GRAYS,
    params: { style: 1, kuwR: 3, chroma: 1, spacing: 5, lineW: 1.4, wobble: 0.8, edgeTh: 0.12, detail: 0.9, tone: 1 },
    paper: '#f7f5f0', ink: '#141414', shadow: '#141414',
    hide: ['pressure', 'cross', 'hatchAng', 'chroma', 'palette', 'palCount'],
    labels: { spacing: '网点大小', grain: '纸纹' },
  },
  {
    id: 'pop', name: '波普网点', en: 'Pop Dots', desc: '平涂高饱和 + 本戴点 + 粗黑线',
    palette: POP,
    params: { style: 2, kuwR: 5, chroma: 1.5, spacing: 6, lineW: 3, wobble: 1.2, edgeTh: 0.12, detail: 0.5, tone: 0.8 },
    paper: '#fffaf0', ink: '#111111', shadow: '#111111',
    hide: ['pressure', 'grain', 'cross', 'hatchAng'],
    labels: { spacing: '网点大小' },
  },
  {
    id: 'riso', name: '孔版印刷', en: 'Risograph', desc: '粉 / 蓝 / 黄三色油墨，套色错位当抖动',
    palette: RISO,
    params: { style: 3, kuwR: 3, chroma: 1.35, spacing: 5, grain: 0.3, lineW: 0, wobble: 1.5, edgeTh: 0.14, detail: 0, tone: 0 },
    paper: '#f3efe6', ink: '#2b2b2b', shadow: '#0078bf',
    hide: ['pressure', 'cross', 'hatchAng', 'lineW', 'detail', 'edgeTh', 'palette', 'palCount'],
    labels: { spacing: '网点大小', grain: '颗粒感', wobble: '套色错位', chroma: '油墨浓度' },
  },
  {
    id: 'pixel', name: '像素贴纸', en: 'Pixel Pop', desc: 'PICO-8 16 色、有序抖动、硬边描线',
    palette: PICO8,
    params: { style: 4, kuwR: 3, chroma: 1.2, spacing: 6, lineW: 1, wobble: 0, edgeTh: 0.12, detail: 0, tone: 0.7 },
    paper: '#f4f0e6', ink: '#1d1a2b', shadow: '#1d1a2b',
    hide: ['pressure', 'grain', 'cross', 'hatchAng', 'detail', 'wobble'],
    labels: { spacing: '像素大小', lineW: '描边（0 关闭）' },
  },
  {
    id: 'chalk', name: '粉笔黑板', en: 'Chalkboard', desc: '深色黑板 + 粉笔粗颗粒 + 擦痕',
    palette: CHALK,
    params: { style: 5, kuwR: 5, chroma: 1.2, spacing: 5, pressure: 1, grain: 0.6, lineW: 1.8, wobble: 1.8, edgeTh: 0.14, hatchAng: 30, detail: 0.35, tone: 0.5 },
    paper: '#26352f', ink: '#f2f0e8', shadow: '#f2f0e8',
    hide: ['cross'],
    labels: { grain: '粉笔颗粒' },
  },
  {
    id: 'neon', name: '霓虹描边', en: 'Neon Sign', desc: '只画线、发光，灯管闪烁就是抖动',
    palette: NEON,
    params: { style: 6, kuwR: 6, chroma: 1.6, lineW: 1.6, wobble: 1.2, edgeTh: 0.16, detail: 0.15, tone: 0 },
    paper: '#0d0c16', ink: '#ffffff', shadow: '#000000',
    hide: ['spacing', 'pressure', 'grain', 'cross', 'hatchAng', 'shadow'],
    labels: { lineW: '灯管粗细' },
  },
  {
    id: 'papercut', name: '剪纸拼贴', en: 'Paper Cut', desc: '纸片撕边 + 投影，每块纸轻轻晃',
    palette: PAPERCUT,
    params: { style: 7, kuwR: 7, chroma: 1.4, lineW: 2.2, wobble: 1.5, edgeTh: 0.12, detail: 0, tone: 0 },
    paper: '#efe6d6', ink: '#2b2b2b', shadow: '#2b2b2b',
    hide: ['spacing', 'pressure', 'grain', 'cross', 'hatchAng', 'detail', 'edgeTh'],
    labels: { lineW: '撕边宽度', wobble: '纸片晃动' },
  },
  {
    id: 'stitch', name: '刺绣', en: 'Embroidery', desc: '缎面针脚 + 布纹 + 回针描边',
    palette: THREAD,
    params: { style: 8, kuwR: 6, chroma: 1.3, spacing: 4.5, lineW: 1.6, wobble: 0.8, edgeTh: 0.14, hatchAng: 0, detail: 0.2, tone: 0.5 },
    paper: '#e9e2d4', ink: '#3a2e26', shadow: '#3a2e26',
    hide: ['pressure', 'grain', 'cross'],
    labels: { spacing: '针脚大小', hatchAng: '针脚方向' },
  },
  {
    id: 'news', name: '复古报纸', en: 'Old Newsprint', desc: '单色网点 + 发黄纸 + 油墨晕染',
    palette: ['#111111', '#3c3c3c', '#6a6a6a', '#9a9a9a', '#c9c9c9', '#f4f4f4'],
    params: { style: 9, kuwR: 3, chroma: 1, spacing: 4.5, grain: 0.7, lineW: 1, wobble: 0.8, edgeTh: 0.14, detail: 0.7, tone: 1 },
    paper: '#e8dcc0', ink: '#2a241d', shadow: '#2a241d',
    hide: ['pressure', 'cross', 'hatchAng', 'chroma', 'palette', 'palCount'],
    labels: { spacing: '网点大小', grain: '油墨晕染', wobble: '套印偏移' },
  },
  {
    id: 'water', name: '水彩', en: 'Watercolor', desc: '湿边扩散、边缘积色、纸纹颗粒',
    palette: WATER,
    params: { style: 10, kuwR: 6, chroma: 1.2, pressure: 1, grain: 0.7, lineW: 1.5, wobble: 1.4, edgeTh: 0.12, detail: 0.6, tone: 0.5 },
    paper: '#f6f1e6', ink: '#3a3530', shadow: '#5b6f8a',
    hide: ['spacing', 'cross', 'hatchAng'],
    labels: { pressure: '颜料浓度', grain: '颗粒感', lineW: '边缘积色', wobble: '湿边扩散', detail: '铅笔底稿' },
  },
  {
    id: 'oil', name: '油画厚涂', en: 'Impasto Oil', desc: '沿形体方向的短笔刷 + 厚涂高光',
    palette: CRAYON_BOX,
    params: { style: 11, kuwR: 4, chroma: 1.3, spacing: 6, lineW: 0, wobble: 0.6, edgeTh: 0.14, detail: 0, tone: 0.4 },
    paper: '#e9e1d2', ink: '#2a2018', shadow: '#2a2018',
    hide: ['pressure', 'grain', 'cross', 'hatchAng', 'lineW', 'detail', 'edgeTh'],
    labels: { spacing: '笔刷长度' },
  },
  {
    id: 'woodcut', name: '版画木刻', en: 'Woodcut', desc: '沿形体走向的刻线，粗细随明暗',
    palette: ['#111111', '#3c3c3c', '#6a6a6a', '#9a9a9a', '#c9c9c9', '#f4f4f4'],
    params: { style: 12, kuwR: 4, chroma: 1, spacing: 5, lineW: 1.6, wobble: 0.6, edgeTh: 0.16, detail: 0.5, tone: 1 },
    paper: '#efe6d2', ink: '#16110d', shadow: '#16110d',
    hide: ['pressure', 'grain', 'cross', 'hatchAng', 'chroma', 'palette', 'palCount'],
    labels: { spacing: '刻线间距' },
  },
  {
    id: 'pastel', name: '粉彩手账', en: 'Pastel Journal', desc: '油画棒来回涂、色块留白、细铅笔线、手账标题和星星',
    palette: PASTEL,
    params: { style: 13, kuwR: 8, chroma: 1.25, spacing: 5.5, pressure: 0.9, grain: 0.62, lineW: 1, wobble: 1.6, edgeTh: 0.22, hatchAng: 20, detail: 0.25, tone: 0.4, bgSimp: 0.8 },
    paper: '#f3ecdf', ink: '#2e2a28', shadow: '#8fb4ea',
    journal: true,
    hide: ['cross', 'shadow'],
    labels: { spacing: '笔触间距', grain: '纸纹露白', lineW: '色块留白' },
  },
];
