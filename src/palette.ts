// 色彩工具：sRGB ↔ Oklab，固定蜡笔盒色板，k-means 自动取色
export type Lab = [number, number, number];

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => {
  const x = Math.max(0, c);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
};

export function rgbToOklab(r: number, g: number, b: number): Lab {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// 取自参考视频的蜡笔色：出租车橙、校车红、天蓝、紫、青绿、奶白，外加肤色桃色
export const CRAYON_BOX = [
  '#1f1b1d', '#5b3a2a', '#9a6a45', '#e39a1e',
  '#f2cf3c', '#e2522c', '#c3262c', '#e98aa8',
  '#6b47c9', '#3346b8', '#4a86d4', '#2ba39a',
  '#4d9a3c', '#f0b08a', '#f0e8dc', '#9c9893',
];

export function crayonLabs(): Lab[] {
  return CRAYON_BOX.map((h) => rgbToOklab(...hexToRgb(h)));
}

// 与 shader 中像素一致的“蜡笔化”：色度放大
export function crayonize([L, a, b]: Lab, chroma: number): Lab {
  return [L, a * chroma, b * chroma];
}

// k-means（Oklab），从图像里提取主色
export function autoPalette(img: ImageData, k: number): Lab[] {
  const d = img.data;
  const pts: Lab[] = [];
  const step = Math.max(1, Math.floor((img.width * img.height) / 6000));
  for (let i = 0; i < img.width * img.height; i += step) {
    if (d[i * 4 + 3] < 128) continue;
    pts.push(rgbToOklab(d[i * 4] / 255, d[i * 4 + 1] / 255, d[i * 4 + 2] / 255));
  }
  if (pts.length < k) return crayonLabs().slice(0, k);
  const dist = (p: Lab, q: Lab) => (p[0] - q[0]) ** 2 + 2 * ((p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2);

  // k-means++ 初始化（确定性伪随机，结果稳定）
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const centers: Lab[] = [pts[Math.floor(rnd() * pts.length)]];
  const dmin = new Float64Array(pts.length).fill(Infinity);
  while (centers.length < k) {
    const c = centers[centers.length - 1];
    let sum = 0;
    for (let i = 0; i < pts.length; i++) { dmin[i] = Math.min(dmin[i], dist(pts[i], c)); sum += dmin[i]; }
    let r = rnd() * sum, j = 0;
    while (j < pts.length - 1 && (r -= dmin[j]) > 0) j++;
    centers.push([...pts[j]] as Lab);
  }
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < pts.length; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const dd = dist(pts[i], centers[c]); if (dd < bd) { bd = dd; bi = c; } }
      assign[i] = bi;
    }
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const a = acc[assign[i]]; a[0] += pts[i][0]; a[1] += pts[i][1]; a[2] += pts[i][2]; a[3]++;
    }
    acc.forEach((a, c) => { if (a[3]) centers[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  return centers.sort((p, q) => p[0] - q[0]);
}

export function labToHex(lab: Lab): string {
  return '#' + oklabToRgb(lab).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
