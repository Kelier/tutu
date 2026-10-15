// 单一 WGSL 模块。模板由 override 常量 STYLE 选择：每个模板编译成独立管线，只保留自己的分支。
//   fs_kuwahara  照片 → 色块（焦点区域半径小、背景半径大）
//   fs_edge      r = 暗部细节线（高斯差分），g = 平滑后的 Oklab 明度
//   fs_quant     Oklab 量化到模板色板（带时间滞回，视频不闪）
//   fs_mode      众数滤波，去掉零碎色块
//   fs_tensor    结构张量（油画 / 版画用）
//   fs_flow      张量平滑 → 方向场（沿边缘的切线方向 + 一致性）
//   fs_final     按模板合成 → 五官重绘 → 画面后期（15 种，uniform 切换不重编译）→ 集中线 / 速度线 → 叠加层 → 贴纸白边
// 所有“手绘感”尺寸都在 720 基准的内容像素空间里计算，导出尺寸变化时观感一致。

export const UNIFORM_ROWS = 42; // vec4 行数，与 struct U 一致

/** 模板编号 → 需要方向场的模板 */
export const FLOW_STYLES = new Set([11, 12]);

export const WGSL = /* wgsl */ `
override STYLE: i32 = 0;

struct U {
  res: vec2f, work: vec2f,
  time: f32, boil: f32, maskOn: f32, sticker: f32,
  kuwR: f32, palCount: f32, chroma: f32, hyst: f32,
  spacing: f32, pressure: f32, grain: f32, lineW: f32,
  wobble: f32, edgeTh: f32, hatchAng: f32, cross: f32,
  shadowOn: f32, shadowAng: f32, shadowDist: f32, bgPaper: f32,
  border: f32, motion: f32, motionAmt: f32, detail: f32,
  viewOff: vec2f, viewScale: vec2f,
  first: f32, _s: f32, tone: f32, focusN: f32,
  focusStr: f32, bgSimp: f32, featOn: f32, featN: f32,
  paper: vec4f, ink: vec4f, shadowCol: vec4f, isFace: vec4f,
  focus: array<vec4f, 4>,   // 源图 uv 空间的椭圆：cx, cy, rx, ry
  focusW: vec4f,
  pal: array<vec4f, 16>,    // Oklab
  fxRadial: f32, fxSpeed: f32, fxAmt: f32, ovOn: f32,
  fxC: vec2f, post: f32, postAmt: f32,   // 集中线中心（输出 uv）、画面后期编号与强度
  feat: array<vec4f, 4>,    // 每张脸两行：(右眼 xy, 左眼 xy), (嘴 xy, 脸宽, 0)，源图 uv
  subj: vec4f,              // x = 主体细节保留（0 = 关，行为与旧版完全一致），y = 复杂度阈值（亮度标准差）
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tA: texture_2d<f32>;
@group(0) @binding(2) var tB: texture_2d<f32>;
@group(0) @binding(3) var tM: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@group(0) @binding(5) var tC: texture_2d<f32>;   // 平滑后的原图颜色
@group(0) @binding(6) var tD: texture_2d<f32>;   // 方向场
@group(0) @binding(7) var tE: texture_2d<f32>;   // 叠加层（拟声字 / 气泡）

struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var p = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  var o: VO;
  o.pos = vec4f(p[i], 0., 1.);
  o.uv = vec2f(p[i].x * .5 + .5, .5 - p[i].y * .5);
  return o;
}

// ---------- 工具 ----------
fn ld(t: texture_2d<f32>, p: vec2i) -> vec3f {
  let d = vec2i(textureDimensions(t)) - 1;
  return textureLoad(t, clamp(p, vec2i(0), d), 0).rgb;
}
fn lum(c: vec3f) -> f32 { return dot(c, vec3f(.299, .587, .114)); }

fn srgb2lin(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}
fn lin2srgb(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.));
  return select(1.055 * pow(x, vec3f(1. / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}
fn toOklab(c: vec3f) -> vec3f {
  let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  let s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  let l_ = pow(max(l, 0.), 1. / 3.); let m_ = pow(max(m, 0.), 1. / 3.); let s_ = pow(max(s, 0.), 1. / 3.);
  return vec3f(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_);
}
fn fromOklab(c: vec3f) -> vec3f {
  let l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  let m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  let s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  let l = l_ * l_ * l_; let m = m_ * m_ * m_; let s = s_ * s_ * s_;
  return vec3f(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
fn palRGB(i: i32) -> vec3f { return clamp(lin2srgb(fromOklab(u.pal[i].xyz)), vec3f(0.), vec3f(1.)); }

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let w = f * f * (3. - 2. * f);
  return mix(mix(hash21(i), hash21(i + vec2f(1., 0.)), w.x),
             mix(hash21(i + vec2f(0., 1.)), hash21(i + vec2f(1., 1.)), w.x), w.y);
}
fn fbm(p: vec2f) -> f32 {
  var a = 0.5; var s = 0.; var q = p;
  for (var i = 0; i < 4; i++) { s += a * vnoise(q); q = q * 2.03 + vec2f(17.1, 9.2); a *= 0.5; }
  return s / 0.9375;
}
fn rot(p: vec2f, a: f32) -> vec2f {
  let c = cos(a); let s = sin(a);
  return vec2f(c * p.x - s * p.y, s * p.x + c * p.y);
}
fn dir8(k: i32) -> vec2f { let a = f32(k) * 0.7853982; return vec2f(cos(a), sin(a)); }

// 焦点权重：人脸 / 人物 / 手动焦点，椭圆内 1，边缘羽化
fn focusAt(uv: vec2f) -> f32 {
  var w = 0.0;
  for (var i = 0; i < 4; i++) {
    if (f32(i) >= u.focusN) { break; }
    let f = u.focus[i];
    let d = length((uv - f.xy) / max(f.zw, vec2f(1e-4)));
    w = max(w, u.focusW[i] * (1.0 - smoothstep(0.75, 1.2, d)));
  }
  return clamp(w * u.focusStr, 0.0, 1.0);
}
// 人脸区域（小脸只保留最强的五官线，肤色偏亮，避免糊成一团）
fn faceAt(uv: vec2f) -> f32 {
  var w = 0.0;
  for (var i = 0; i < 4; i++) {
    if (f32(i) >= u.focusN) { break; }
    let f = u.focus[i];
    let d = length((uv - f.xy) / max(f.zw, vec2f(1e-4)));
    w = max(w, u.isFace[i] * (1.0 - smoothstep(0.7, 1.05, d)));
  }
  return w * step(0.01, u.focusStr);
}

// ---------- Pass 1: Kuwahara ----------
@fragment fn fs_kuwahara(v: VO) -> @location(0) vec4f {
  let c = vec2i(v.pos.xy);
  let uvp = v.pos.xy / u.work;
  let fw = focusAt(uvp);
  var rf = mix(u.kuwR + u.bgSimp * 3.0, max(1.0, u.kuwR * 0.35), fw);
  if (u.subj.x > 0.0) {
    // 主体细节保留：局部复杂度（取自原图 tB）超过阈值的地方，半径向 1 收缩；平坦处照常抽象
    var s1 = 0.; var s2 = 0.;
    for (var y = -2; y <= 2; y++) {
      for (var x = -2; x <= 2; x++) {
        let l = lum(ld(tB, c + vec2i(x, y)));
        s1 += l; s2 += l * l;
      }
    }
    let mean = s1 / 25.;
    let sd = sqrt(max(s2 / 25. - mean * mean, 0.));
    let gate = smoothstep(u.subj.y * 0.6, u.subj.y * 1.4, sd);
    // 有焦点 / 抠图时只作用于主体；都没有时作用于全图，由阈值决定保留哪里
    let hasSubj = u.focusN > 0.5 || u.maskOn > 0.5;
    let reg = select(1.0, max(fw, select(0.0, maskAt(uvp), u.maskOn > 0.5)), hasSubj);
    rf = mix(rf, 1.0, clamp(u.subj.x * gate * reg, 0.0, 1.0));
  }
  let r = i32(round(rf));
  var m0 = vec3f(0.); var m1 = vec3f(0.); var m2 = vec3f(0.); var m3 = vec3f(0.);
  var s0 = vec3f(0.); var s1 = vec3f(0.); var s2 = vec3f(0.); var s3 = vec3f(0.);
  for (var y = 0; y <= r; y++) {
    for (var x = 0; x <= r; x++) {
      let a = ld(tA, c + vec2i(-x, -y)); m0 += a; s0 += a * a;
      let b = ld(tA, c + vec2i( x, -y)); m1 += b; s1 += b * b;
      let d = ld(tA, c + vec2i(-x,  y)); m2 += d; s2 += d * d;
      let e = ld(tA, c + vec2i( x,  y)); m3 += e; s3 += e * e;
    }
  }
  let n = f32((r + 1) * (r + 1));
  m0 /= n; m1 /= n; m2 /= n; m3 /= n;
  let v0 = dot(s0 / n - m0 * m0, vec3f(1.));
  let v1 = dot(s1 / n - m1 * m1, vec3f(1.));
  let v2 = dot(s2 / n - m2 * m2, vec3f(1.));
  let v3 = dot(s3 / n - m3 * m3, vec3f(1.));
  var best = m0; var bv = v0;
  if (v1 < bv) { bv = v1; best = m1; }
  if (v2 < bv) { bv = v2; best = m2; }
  if (v3 < bv) { bv = v3; best = m3; }
  return vec4f(best, 1.);
}

// ---------- Pass 2: 细节线 + 平滑明度 ----------
@fragment fn fs_edge(v: VO) -> @location(0) vec4f {
  let c = vec2i(v.pos.xy);
  var g1 = 0.; var w1 = 0.; var g2 = 0.; var w2 = 0.;
  var col = vec3f(0.);
  for (var y = -4; y <= 4; y++) {
    for (var x = -4; x <= 4; x++) {
      let d2 = f32(x * x + y * y);
      let s = ld(tA, c + vec2i(x, y));
      let l = lum(s);
      let a = exp(-d2 / 2.0);
      let b = exp(-d2 / 5.12);
      g1 += l * a; w1 += a; g2 += l * b; w2 += b;
      col += s * a;
    }
  }
  g1 /= w1; g2 /= w2;
  let e = clamp((g2 - g1) * 16.0 - 0.10, 0., 1.);
  let L = toOklab(srgb2lin(col / w1)).x;
  return vec4f(e, L, 0., 1.);
}

// ---------- Pass 3: 色板量化（Oklab + 滞回） ----------
fn palDist(lab: vec3f, i: i32) -> f32 {
  let d = lab - u.pal[i].xyz;
  return d.x * d.x + 2.0 * (d.y * d.y + d.z * d.z);
}
@fragment fn fs_quant(v: VO) -> @location(0) vec4f {
  let c = vec2i(v.pos.xy);
  var lab = toOklab(srgb2lin(ld(tA, c)));
  let face = faceAt(v.pos.xy / u.work);
  lab = vec3f(lab.x + face * 0.12, lab.yz * mix(u.chroma, 1.1, face));
  let n = i32(u.palCount);
  var bi = 0; var bd = 1e9;
  for (var i = 0; i < 16; i++) {
    if (i >= n) { break; }
    let dd = palDist(lab, i);
    if (dd < bd) { bd = dd; bi = i; }
  }
  if (u.first < 0.5) {
    let pi = clamp(i32(round(textureLoad(tB, c, 0).a * 255.0)), 0, n - 1);
    if (palDist(lab, pi) < bd * u.hyst + 0.0006) { bi = pi; }
  }
  return vec4f(palRGB(bi), f32(bi) / 255.0);
}

// ---------- Pass 3b: 众数滤波 ----------
@fragment fn fs_mode(v: VO) -> @location(0) vec4f {
  let c = vec2i(v.pos.xy);
  let center = textureLoad(tA, c, 0);
  let uvp = v.pos.xy / u.work;
  if (focusAt(uvp) > 0.5 && faceAt(uvp) < 0.5) { return center; }   // 主体保留细节；人脸仍清理碎点
  let d = vec2i(textureDimensions(tA)) - 1;
  var cnt: array<f32, 16>;
  for (var i = 0; i < 16; i++) { cnt[i] = 0.; }
  for (var y = -2; y <= 2; y++) {
    for (var x = -2; x <= 2; x++) {
      let j = clamp(i32(round(textureLoad(tA, clamp(c + vec2i(x, y), vec2i(0), d), 0).a * 255.)), 0, 15);
      cnt[j] += select(1.0, 1.5, x == 0 && y == 0);
    }
  }
  var best = clamp(i32(round(center.a * 255.)), 0, 15);
  var bc = cnt[best];
  for (var i = 0; i < 16; i++) { if (cnt[i] > bc) { bc = cnt[i]; best = i; } }
  return vec4f(palRGB(best), f32(best) / 255.0);
}

// ---------- Pass 4: 结构张量 → 方向场 ----------
@fragment fn fs_tensor(v: VO) -> @location(0) vec4f {
  let c = vec2i(v.pos.xy);
  let tl = lum(ld(tA, c + vec2i(-1, -1))); let tc = lum(ld(tA, c + vec2i(0, -1))); let tr = lum(ld(tA, c + vec2i(1, -1)));
  let ml = lum(ld(tA, c + vec2i(-1, 0)));                                           let mr = lum(ld(tA, c + vec2i(1, 0)));
  let bl = lum(ld(tA, c + vec2i(-1, 1)));  let bc = lum(ld(tA, c + vec2i(0, 1)));  let br = lum(ld(tA, c + vec2i(1, 1)));
  let gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  let gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  return vec4f(gx * gx, gy * gy, gx * gy, 1.0);
}
@fragment fn fs_flow(v: VO) -> @location(0) vec4f {
  let c = vec2i(v.pos.xy);
  let d = vec2i(textureDimensions(tA)) - 1;
  var t = vec3f(0.); var ws = 0.;
  for (var y = -6; y <= 6; y += 2) {
    for (var x = -6; x <= 6; x += 2) {
      let w = exp(-f32(x * x + y * y) / 32.0);
      t += textureLoad(tA, clamp(c + vec2i(x, y), vec2i(0), d), 0).xyz * w; ws += w;
    }
  }
  t /= ws;
  let E = t.x; let G = t.y; let F = t.z;
  let disc = sqrt(max((E - G) * (E - G) + 4.0 * F * F, 0.0));
  let l1 = 0.5 * (E + G + disc); let l2 = 0.5 * (E + G - disc);
  var tg = vec2f(l1 - E, -F);              // 切线：沿边缘方向
  if (length(tg) < 1e-6) { tg = vec2f(1.0, 0.0); }
  tg = normalize(tg);
  if (tg.x < 0.0) { tg = -tg; }
  let coh = (l1 - l2) / (l1 + l2 + 1e-5);
  return vec4f(tg * 0.5 + 0.5, coh, 1.0);
}

// ---------- Pass 5: 按模板合成 ----------
fn inside(uv: vec2f) -> f32 {
  return select(0.0, 1.0, all(uv >= vec2f(0.)) && all(uv <= vec2f(1.)));
}
fn quantAt(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * u.work));
  return textureLoad(tA, clamp(p, vec2i(0), vec2i(u.work) - 1), 0);
}
fn idxAt(uv: vec2f) -> i32 { return i32(round(quantAt(uv).a * 255.0)); }
fn maskAt(uv: vec2f) -> f32 {
  if (u.maskOn < 0.5) { return inside(uv); }
  return textureSampleLevel(tM, samp, uv, 0.0).r * inside(uv);
}
fn flowAt(uv: vec2f) -> vec2f {
  let f = textureSampleLevel(tD, samp, uv, 0.0).rg * 2.0 - 1.0;
  return f / max(length(f), 1e-4);
}
// 一组同向的蜡笔排线：每条线宽度、断续、笔压都随机
fn hatch(px: vec2f, ang: f32, seed: f32, spacing: f32) -> f32 {
  let d = vec2f(cos(ang), sin(ang));
  let nrm = vec2f(-d.y, d.x);
  let a = dot(px, d);
  let w = dot(px, nrm) / spacing + (vnoise(vec2f(a * 0.015, seed * 1.7)) - 0.5) * 0.9;
  let id = floor(w); let f = fract(w);
  let hs = hash21(vec2f(id, seed));
  let width = 0.45 + 0.45 * hs;
  let prof = 1.0 - smoothstep(width * 0.5 - 0.12, width * 0.5 + 0.12, abs(f - 0.5));
  let segLen = 40.0 + 90.0 * hs;
  let s = (a + hs * 317.0) / segLen;
  let sid = floor(s); let sf = fract(s);
  let hseg = hash21(vec2f(sid, id + seed * 3.1));
  let ends = smoothstep(0.0, 0.06, sf) * (1.0 - smoothstep(0.92, 1.0, sf));
  let press = 0.55 + 0.45 * hseg;
  return prof * press * (0.4 + 0.6 * ends) * mix(0.3, 1.0, step(0.12, hseg));
}
// 圆点网屏：返回 0..1 覆盖，radius 为网格单元的比例
fn dots(px: vec2f, cell: f32, ang: f32, radius: f32) -> f32 {
  let g = rot(px, ang) / cell;
  let f = fract(g) - 0.5;
  return 1.0 - smoothstep(radius - 0.07, radius + 0.07, length(f));
}
fn bayer4(p: vec2f) -> f32 {
  let x = i32(p.x) & 3; let y = i32(p.y) & 3;
  var m = array<f32, 16>(0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[y * 4 + x] + 0.5) / 16.0;
}

// —— 画面后期：几何类（CRT 弯曲 / 镜像 / 万花筒 / 鱼眼 / 水波纹）先改采样坐标 ——
fn postWarp(uv: vec2f, mode: i32, amt: f32, b: f32, aspect: f32) -> vec2f {
  if (mode == 5) {
    let c = uv * 2.0 - 1.0;
    return c * (1.0 + 0.09 * amt * dot(c, c)) * 0.5 + 0.5;
  }
  if (mode == 9) { return vec2f(select(uv.x, 1.0 - uv.x, uv.x > 0.5), uv.y); }
  if (mode == 10) {
    let c = (uv - 0.5) * vec2f(aspect, 1.0);
    let seg = 6.2831853 / 6.0;
    var a = atan2(c.y, c.x) + 0.04 * sin(b * 1.7) * amt;
    a = abs(a - seg * floor(a / seg) - seg * 0.5);
    return vec2f(cos(a), sin(a)) * length(c) / vec2f(aspect, 1.0) + 0.5;
  }
  if (mode == 11) {
    let c = (uv - 0.5) * vec2f(aspect, 1.0);
    let s = 1.0 - 0.45 * amt * (1.0 - smoothstep(0.0, 0.75, length(c)));
    return c * s / vec2f(aspect, 1.0) + 0.5;
  }
  if (mode == 12) {
    return uv + vec2f(sin(uv.y * 38.0 + b * 1.3), cos(uv.x * 31.0 + b * 1.1)) * 0.007 * amt;
  }
  return uv;
}

@fragment fn fs_final(v: VO) -> @location(0) vec4f {
  let fc = v.pos.xy;
  let uv0 = fc / u.res;
  let aspect = u.res.x / u.res.y;
  let T = u.time;
  let st = STYLE;
  let pm = i32(u.post + 0.5);
  let uvo = postWarp(uv0, pm, u.postAmt, u.boil, aspect);

  // —— 动作（以底部中心为支点，3 秒内整周期循环）——
  let pivot = vec2f(0.5, 0.88);
  var q = (uvo - pivot) * vec2f(aspect, 1.0);
  let mo = i32(u.motion + 0.5);
  if (mo == 1) {
    q = rot(q, -sin(T * 6.2831853 / 1.5) * 0.10 * u.motionAmt);
  } else if (mo == 2) {
    let ph = fract(T / 0.75);
    let hop = sin(ph * 3.14159265);
    let sq = pow(1.0 - hop, 6.0) * 0.12 * u.motionAmt;
    q.y += hop * 0.10 * u.motionAmt;
    q = vec2f(q.x / (1.0 + sq), q.y / (1.0 - sq));
  } else if (mo == 3) {
    let s = 1.0 + 0.045 * u.motionAmt * sin(T * 6.2831853 / 1.5);
    q = vec2f(q.x / (2.0 - s), q.y / s);
  }
  let uvM = q / vec2f(aspect, 1.0) + pivot;
  let uvS0 = u.viewOff + uvM * u.viewScale;

  let cs = 720.0 / max(u.work.x, u.work.y);
  let pxToUv = 1.0 / (u.work * cs);
  let toPx = u.work * cs;
  let b = u.boil;
  let spx = fc / u.res.y * 720.0;       // 屏幕像素（纸张）

  // 像素模板：先把采样点吸附到像素网格
  var uvS = uvS0;
  let cell = max(2.0, u.spacing);
  let pc = floor(uvS0 / pxToUv / cell);
  if (st == 4) { uvS = (pc + 0.5) * cell * pxToUv; }
  let px = uvS * toPx;                  // 内容像素（720 基准）
  let fw = focusAt(uvS);
  let face = faceAt(uvS);
  let featFace = face * step(0.5, u.featOn);

  // —— boil：每个 boil 步换一次噪声种子；焦点处抖得轻一些 ——
  let wob = select(u.wobble * mix(1.0, 0.5, fw), 0.0, st == 4);
  let wp = px * 0.018;
  let warp = (vec2f(vnoise(wp + b * 7.31), vnoise(wp + vec2f(41.7, 13.3) + b * 5.17)) - 0.5) * 2.0 * wob
           + (vec2f(vnoise(px * 0.09 + b * 3.7), vnoise(px * 0.09 + 77.0 + b * 2.9)) - 0.5) * wob * 0.6;
  let uvW = uvS + warp * pxToUv;
  let pxw = px + warp;

  let qc = quantAt(uvW);
  var idx = i32(round(qc.a * 255.0));
  var col = qc.rgb;
  // 五官重绘：脸部整块平涂肤色，再在上面画简笔五官
  if (featFace > 0.5) {
    for (var fi = 0; fi < 2; fi++) {
      if (f32(fi) >= u.featN) { break; }
      let A = u.feat[fi * 2]; let B = u.feat[fi * 2 + 1];
      let nose = mix((A.xy + A.zw) * 0.5, B.xy, 0.5);
      let sz = B.z * toPx.x;
      let e = (pxw - (nose - vec2f(0.0, B.z * 0.05)) * toPx) / vec2f(sz * 0.52, sz * 0.66);
      if (length(e) < 1.0) {
        // 肤色：取鼻子处的原图颜色，提亮后找最近的色板颜色
        var sk = toOklab(srgb2lin(textureSampleLevel(tC, samp, nose, 0.0).rgb));
        sk = vec3f(max(sk.x + 0.2, 0.72), sk.yz * 1.15);
        var bi = 0; var bd = 1e9;
        for (var i = 0; i < 16; i++) {
          if (f32(i) >= u.palCount) { break; }
          let dd = palDist(sk, i);
          if (dd < bd) { bd = dd; bi = i; }
        }
        idx = bi; col = palRGB(bi);
      }
    }
  }
  let m = smoothstep(0.42, 0.58, maskAt(uvW));
  let tooth = vnoise(spx * 0.45) * 0.55 + vnoise(spx * 1.1 + 5.0) * 0.45;
  let ed = textureSampleLevel(tB, samp, uvW, 0.0);
  let Ls = ed.g;
  let toneD = Ls - u.pal[idx].x;
  let shadeT = smoothstep(0.03, 0.18, -toneD) * u.tone * (1.0 - 0.6 * face) * (1.0 - featFace);
  let lightT = smoothstep(0.05, 0.20, toneD) * u.tone * (1.0 - featFace);

  let paperBase = select(u.paper.rgb, vec3f(0.995, 0.988, 0.965), u.sticker > 0.5 && lum(u.paper.rgb) > 0.4);
  let fib = fbm(spx * vec2f(0.012, 0.05));
  let paper = paperBase * (0.955 + 0.06 * fib) * (0.97 + 0.045 * tooth);
  let darkPaper = lum(u.paper.rgb) < 0.3;

  let bgKeep = select(1.0, 1.0 - u.bgPaper, u.maskOn > 0.5) * (1.0 - u.sticker);
  let bgA = (1.0 - m) * bgKeep * inside(uvW);
  let vis = max(m, bgA);

  // —— 投影遮罩 ——
  var sh = 0.0;
  if (u.shadowOn > 0.5 && u.maskOn > 0.5 && u.sticker < 0.5) {
    let sd = vec2f(cos(u.shadowAng), sin(u.shadowAng)) * u.shadowDist;
    let jit = (vec2f(vnoise(px * 0.05 + b), vnoise(px * 0.05 + 9.0 + b)) - 0.5) * 6.0;
    sh = smoothstep(0.35, 0.6, maskAt(uvW - (sd + jit) * pxToUv)) * (1.0 - m);
  }

  // —— 轮廓：色块边界 + 主体轮廓 + 暗部细节 ——
  let knock = u.bgSimp * (1.0 - fw) * step(0.5, u.focusN) * select(1.0, 0.0, u.sticker > 0.5);
  let eth = u.edgeTh * mix(1.0, 0.6, fw) * (1.0 + knock * 1.5);
  let noLines = st == 3 || st == 4 || st == 7 || st == 10 || st == 11;
  let rr = select(u.lineW, 0.0, noLines) * (0.65 + 0.7 * vnoise(px * 0.03 + b * 4.1)) * mix(1.0, 0.6, face);
  let myLab = u.pal[idx].xyz;
  var bnd = 0.0;
  if (rr > 0.05) {
    for (var k = 0; k < 8; k++) {
      let o = dir8(k) * rr * pxToUv;
      let j = idxAt(uvW + o);
      if (j != idx && length(u.pal[j].xyz - myLab) > eth * (1.0 + face * 1.5)) { bnd = max(bnd, vis * mix(0.75, 1.0, fw) * (1.0 - featFace)); }
      if (u.maskOn > 0.5) {
        let mn = smoothstep(0.42, 0.58, maskAt(uvW + o));
        if (abs(mn - m) > 0.5) { bnd = 1.0; }
      }
    }
  }
  let detRaw = mix(ed.r, smoothstep(0.35, 0.75, ed.r), face);
  let det = detRaw * u.detail * mix(1.0, 1.6, fw * (1.0 - face)) * mix(1.0, 1.4, face) * vis * (1.0 - knock * 0.8) * (1.0 - featFace);
  let L = max(bnd, det);

  var outc = paper;
  var inkCol = u.ink.rgb;

  if (st == 0) {
    // ================= 蜡笔 =================
    let hseed = f32(idx) * 1.618 + b * 0.37;
    let ang = u.hatchAng + (hash21(vec2f(f32(idx), 3.7)) - 0.5) * 0.9;
    let h1 = hatch(pxw, ang, hseed, u.spacing);
    let h2 = hatch(pxw, ang + 1.15, hseed + 7.0, u.spacing * 1.35) * u.cross;
    let h3 = hatch(pxw, ang - 1.3, hseed + 21.0, u.spacing * 0.8);
    let sd = vec2f(cos(ang), sin(ang));
    let along = dot(pxw, sd);
    let across = dot(pxw, vec2f(-sd.y, sd.x));
    let streak = vnoise(vec2f(along * 0.05, across * 0.8) + b * 13.0) * 0.6
               + vnoise(vec2f(along * 0.14, across * 2.1) + b * 7.0) * 0.4;
    let tooth2 = mix(tooth, streak, 0.6);
    let cover = (0.62 + 0.45 * h1 + 0.3 * h2) * u.pressure * (1.0 - 0.45 * lightT);
    let wax = smoothstep(0.0, 0.14, cover - (1.0 - tooth2) * u.grain * 1.25 - 0.1);
    var fillCol = col * (0.84 + 0.24 * h1) * (1.0 - 0.10 * h2) * (0.94 + 0.1 * streak);
    fillCol *= 1.0 - shadeT * (0.12 + 0.45 * h3);
    outc = mix(outc, fillCol, wax * bgA);
    if (sh > 0.0) {
      let hs = hatch(pxw, -0.65, b * 1.3 + 99.0, 4.5);
      let s2 = sh * smoothstep(0.0, 0.16, 0.30 + 0.8 * hs - (1.0 - tooth) * u.grain - 0.1) * 0.92;
      let tgt = select(u.shadowCol.rgb * (0.9 + 0.2 * hs), outc * u.shadowCol.rgb * 1.5, bgA > 0.5);
      outc = mix(outc, tgt, s2);
    }
    outc = mix(outc, fillCol, wax * m);
    let lineTex = smoothstep(0.0, 0.2, L * (0.8 + 0.3 * vnoise(px * 0.04 + b * 2.0)) - (1.0 - tooth) * u.grain * 0.55 - 0.1);
    outc = mix(outc, mix(u.ink.rgb, col * 0.3, 0.25), lineTex);
  } else if (st == 1) {
    // ================= 漫画线稿：墨线 + 网点 + 涂黑 =================
    let dark = clamp((0.80 - Ls) / 0.52, 0.0, 1.0) * (1.0 - featFace * 0.7);
    let lev = floor(dark * 3.0 + 0.35) / 3.0;
    var ink = dots(px, max(3.0, u.spacing), 0.785398, sqrt(lev) * 0.6) * step(0.01, lev) * u.tone;
    ink = max(ink, (1.0 - smoothstep(0.22, 0.30, Ls)) * (1.0 - featFace));
    ink = max(ink, sh * dots(px, max(3.0, u.spacing) * 0.8, 0.785398, 0.42));
    let lineM = smoothstep(0.0, 0.18, L * (0.85 + 0.3 * vnoise(px * 0.05 + b)) - 0.12);
    ink = max(ink * vis, lineM);
    outc = mix(outc, u.ink.rgb, ink);
  } else if (st == 2) {
    // ================= 波普网点 =================
    let cellP = max(4.0, u.spacing * 1.2);
    let base = mix(col, col * 0.78, dots(px, cellP, 0.2618, 0.2));
    let sDot = dots(px, cellP * 0.85, 0.785398, 0.18 + 0.42 * shadeT) * step(0.05, shadeT);
    var fillCol = mix(base, u.ink.rgb, sDot);
    fillCol = mix(fillCol, vec3f(1.0), dots(px, cellP, 0.2618, 0.32) * lightT * 0.9);
    outc = mix(outc, fillCol, bgA);
    outc = mix(outc, mix(outc, u.ink.rgb, dots(px, cellP * 0.7, 0.785398, 0.3)), sh);
    outc = mix(outc, fillCol, m);
    outc = mix(outc, u.ink.rgb, smoothstep(0.25, 0.45, L));
  } else if (st == 3) {
    // ================= 孔版印刷 =================
    var acc = paper;
    for (var i = 0; i < 3; i++) {
      let fi = f32(i);
      let off = (vec2f(hash21(vec2f(b, fi * 7.1)), hash21(vec2f(fi * 3.3, b + 2.0))) - 0.5) * 2.0 * u.wobble * 1.4;
      let uvI = uvW + (off + vec2f(fi - 1.0, 1.0 - fi) * 1.2) * pxToUv;
      let c = textureSampleLevel(tC, samp, uvI, 0.0).rgb;
      let mI = select(1.0, smoothstep(0.42, 0.58, maskAt(uvI)), u.maskOn > 0.5);
      let visI = max(mI, (1.0 - mI) * bgKeep) * inside(uvI);
      let dark = 1.0 - lum(c);
      var dens = 0.0;
      if (i == 0) { dens = clamp((c.r - c.g) * 1.7 + dark * 0.12, 0.0, 1.0); }
      else if (i == 1) { dens = clamp(pow(clamp((dark - 0.2) / 0.72, 0.0, 1.0), 1.1) + max(c.b - c.r - 0.04, 0.0) * 0.9, 0.0, 1.0); }
      else { dens = clamp((min(c.r, c.g) - c.b) * 2.0, 0.0, 1.0); }
      dens = clamp(dens * u.chroma / 1.35, 0.0, 1.0);
      if (i == 1) { dens = max(dens, sh * 0.6); }
      let lev = floor(dens * 4.0 + 0.5) / 4.0;
      let grainI = hash21(floor(spx * 0.9) + vec2f(fi * 17.0, b * 3.0));
      let scr = 1.0 - dots(px, max(3.0, u.spacing * 0.7), 0.26 + fi * 0.52, 0.5);
      let thr = mix(scr, grainI, u.grain);
      acc *= mix(vec3f(1.0), palRGB(i), step(thr, lev) * visI * 0.92);
    }
    outc = acc;
  } else if (st == 4) {
    // ================= 像素贴纸 =================
    var fillCol = col;
    if (bayer4(pc) < shadeT * 0.9) { fillCol *= 0.68; }
    if (bayer4(pc + 2.0) < lightT * 0.7) { fillCol = mix(fillCol, vec3f(1.0), 0.35); }
    outc = mix(outc, fillCol, vis);
    outc = mix(outc, outc * 0.55, sh * step(0.5, bayer4(pc)));
    var edge = 0.0;
    for (var k = 0; k < 4; k++) {
      var dir = vec2f(0., -1.);
      if (k == 1) { dir = vec2f(0., 1.); } else if (k == 2) { dir = vec2f(-1., 0.); } else if (k == 3) { dir = vec2f(1., 0.); }
      let uvN = (pc + dir + 0.5) * cell * pxToUv;
      let mN = smoothstep(0.42, 0.58, maskAt(uvN));
      if (u.maskOn > 0.5 && m > 0.5 && mN < 0.5) { edge = 1.0; }
      let j = idxAt(uvN);
      if (j != idx && length(u.pal[j].xyz - myLab) > u.edgeTh * 1.6 && u.pal[j].x > myLab.x) { edge = max(edge, 0.8 * vis); }
    }
    outc = mix(outc, u.ink.rgb, edge * step(0.05, u.lineW));
  } else if (st == 5) {
    // ================= 粉笔黑板：深底 + 粗颗粒 + 擦痕 =================
    let smudge = fbm(spx * 0.006 + 3.0);
    let erase = smoothstep(0.55, 0.9, fbm(vec2f(spx.x * 0.004, spx.y * 0.03) + 11.0));
    let board = u.paper.rgb * (0.85 + 0.3 * smudge) + vec3f(0.07) * erase;
    let ang = u.hatchAng + (hash21(vec2f(f32(idx), 3.7)) - 0.5) * 0.9;
    let h1 = hatch(pxw, ang, f32(idx) * 1.618 + b * 0.37, u.spacing);
    let gr = vnoise(spx * 0.8 + b * 5.0) * 0.55 + vnoise(spx * 2.2 + b) * 0.45;
    let lightness = clamp(Ls * 1.2 - 0.12, 0.0, 1.0);
    let cover = (0.3 + 0.6 * h1) * (0.3 + 0.8 * lightness) * u.pressure;
    let chalk = smoothstep(0.0, 0.15, cover - (1.0 - gr) * u.grain);
    var c = mix(board, mix(col, vec3f(1.0), 0.2), chalk * vis * 0.95);
    c = mix(c, c + vec3f(0.12), sh * 0.0);
    let lineC = smoothstep(0.0, 0.2, L * (0.6 + 0.5 * gr) - 0.25);
    c = mix(c, vec3f(0.95, 0.94, 0.9), lineC * 0.92);
    outc = c;
    inkCol = vec3f(0.95, 0.94, 0.9);
  } else if (st == 6) {
    // ================= 霓虹描边：只画线 + 发光 + 闪烁 =================
    var far = 0.0;
    let rf = max(u.lineW, 1.0) * 3.5;
    for (var k = 0; k < 8; k++) {
      let o = dir8(k) * rf * pxToUv;
      let j = idxAt(uvW + o);
      if (j != idx && length(u.pal[j].xyz - myLab) > eth) { far += 0.125 * vis; }
      if (u.maskOn > 0.5 && abs(smoothstep(0.42, 0.58, maskAt(uvW + o)) - m) > 0.5) { far += 0.125; }
    }
    let flick = 0.8 + 0.2 * hash21(vec2f(b, f32(idx) * 3.1));
    let alive = step(0.07, hash21(vec2f(floor(b * 0.5), f32(idx) + 7.0)));      // 偶尔灭一根灯管
    let tube = mix(col, vec3f(1.0), 0.12) * smoothstep(0.2, 0.5, myLab.x);
    let bgN = u.paper.rgb * (0.75 + 0.4 * fbm(spx * 0.004));
    let core = smoothstep(0.3, 0.6, L);
    var c = bgN + tube * vis * 0.05;
    c += tube * (min(far, 1.0) * 0.6 + bnd * 0.3) * flick * alive;
    c = mix(c, mix(tube, vec3f(1.0), 0.55), core * flick * alive);
    outc = c;
    inkCol = vec3f(1.0, 0.95, 0.98);
  } else if (st == 7) {
    // ================= 剪纸拼贴：白边 + 投影 + 每块轻微错位 =================
    let offA = (vec2f(hash21(vec2f(f32(idx), b)), hash21(vec2f(b, f32(idx) + 3.0))) - 0.5) * 2.0 * u.wobble * 1.6;
    let uvC = uvW - offA * pxToUv;
    let q2 = quantAt(uvC);
    let j2 = i32(round(q2.a * 255.0));
    let rim = max(1.0, u.lineW) * (0.6 + 0.8 * vnoise(px * 0.12 + b));
    var rimA = 0.0;
    for (var k = 0; k < 8; k++) {
      let j = idxAt(uvC + dir8(k) * rim * pxToUv);
      if (j != j2 && j < j2) { rimA = 1.0; }   // 序号大的纸片在上层，露出撕边白芯
    }
    let js = idxAt(uvC - vec2f(2.5, 3.5) * pxToUv);
    let shadowP = select(0.0, 0.3, js > j2);   // 上层纸片投下的影子
    var c = q2.rgb * (0.93 + 0.1 * fbm(pxw * vec2f(0.04, 0.16) + f32(j2) * 3.0));
    c *= 1.0 - shadowP;
    c = mix(c, vec3f(0.98, 0.96, 0.92), rimA * 0.95 * (1.0 - featFace));
    if (featFace > 0.5) { c = col; }
    outc = mix(paper, c, vis);
    outc = mix(outc, outc * 0.75, sh);
  } else if (st == 8) {
    // ================= 刺绣：缎面针脚 + 布纹 + 回针描边 =================
    let wv = sin(spx.x * 1.7) * sin(spx.y * 1.7);
    let fabric = u.paper.rgb * (0.9 + 0.05 * wv + 0.08 * fbm(spx * 0.05));
    let ang = u.hatchAng + hash21(vec2f(f32(idx), 1.3)) * 3.14159;
    let dirS = vec2f(cos(ang), sin(ang));
    let pr = vec2f(dot(pxw, dirS), dot(pxw, vec2f(-dirS.y, dirS.x)));
    let sw = max(1.6, u.spacing * 0.45);                 // 线宽
    let sl = u.spacing * 2.4;                             // 针脚长
    let row = floor(pr.y / sw);
    let along = pr.x / sl + hash21(vec2f(row, f32(idx))) + fract(row * 0.5) ;
    let fa = fract(along);
    let profile = sin(fract(pr.y / sw) * 3.14159);
    let ends = smoothstep(0.0, 0.08, fa) * (1.0 - smoothstep(0.9, 1.0, fa));
    let thread = profile * ends;
    let jit = 0.9 + 0.2 * hash21(vec2f(floor(along), row + b));
    var tc = col * (0.5 + 0.65 * profile) * jit + vec3f(0.22) * pow(profile, 10.0);
    tc *= 1.0 - shadeT * 0.35;
    var c = mix(fabric, tc, smoothstep(0.1, 0.35, thread) * vis);
    let dashL = step(0.35, fract((pxw.x + pxw.y) / (u.spacing * 1.6)));
    c = mix(c, u.ink.rgb * (0.7 + 0.3 * tooth), smoothstep(0.2, 0.45, L) * dashL);
    c = mix(c, c * 0.8, sh);
    outc = c;
  } else if (st == 9) {
    // ================= 复古报纸：单色网点 + 发黄纸 + 油墨晕染 =================
    let stain = smoothstep(0.55, 0.9, fbm(spx * 0.004 + 7.0));
    let paperN = u.paper.rgb * (0.93 + 0.08 * fbm(spx * 0.012)) - vec3f(0.07, 0.06, 0.0) * stain;
    let dark = clamp((0.86 - Ls) / 0.68, 0.0, 1.0);
    let cellN = max(3.0, u.spacing);
    let reg = (vec2f(hash21(vec2f(b, 1.0)), hash21(vec2f(2.0, b))) - 0.5) * u.wobble * 0.8;
    let g = rot(px + reg, 0.785398) / cellN;
    let f = fract(g) - 0.5;
    let r = sqrt(dark) * 0.64 + (vnoise(px * 0.35 + b * 2.0) - 0.5) * 0.14 * u.grain;
    var ink = (1.0 - smoothstep(r - 0.12, r + 0.05, length(f))) * step(0.03, dark) * vis;
    ink = max(ink, smoothstep(0.1, 0.35, L) * 0.95);
    ink = max(ink, sh * 0.5 * (1.0 - smoothstep(0.2, 0.32, length(f))));
    outc = mix(paperN, u.ink.rgb, ink * (0.86 + 0.1 * tooth));
  } else if (st == 10) {
    // ================= 水彩：湿边扩散 + 边缘加深 + 颗粒 =================
    let wet = (vec2f(fbm(px * 0.012 + b * 0.3), fbm(px * 0.012 + 5.2 + b * 0.3)) - 0.5) * 14.0 * (0.4 + u.wobble * 0.3);
    let uvWet = uvW + wet * pxToUv;
    let qw = quantAt(uvWet);
    let jw = i32(round(qw.a * 255.0));
    let soft = textureSampleLevel(tC, samp, uvWet, 0.0).rgb;
    var pig = mix(select(qw.rgb, col, featFace > 0.5), soft, 0.35);
    var e = 0.0;
    let er = max(u.lineW, 1.0) * 2.0 + 2.0;
    for (var k = 0; k < 8; k++) { if (idxAt(uvWet + dir8(k) * er * pxToUv) != jw) { e += 0.125; } }
    pig *= 1.0 - 0.32 * smoothstep(0.0, 0.5, e);           // 颜料在边缘堆积变深
    pig *= 1.0 - shadeT * 0.25;
    let gran = vnoise(spx * 0.7) * 0.5 + vnoise(spx * 1.9) * 0.5;
    let wash = (0.74 + 0.26 * fbm(px * 0.02 + f32(jw))) * (0.9 + 0.14 * gran * u.grain) * u.pressure;
    let wcPaper = u.paper.rgb * (0.965 + 0.05 * fbm(spx * 0.03));
    pig = mix(pig, vec3f(1.0), 0.06);
    var c = wcPaper * mix(vec3f(1.0), pig, clamp(wash, 0.0, 1.0) * vis);
    c = mix(c, c * u.shadowCol.rgb * 1.4, sh * 0.6);
    c = mix(c, vec3f(0.35, 0.33, 0.32), smoothstep(0.25, 0.6, det) * 0.55);  // 铅笔底稿
    outc = c;
  } else if (st == 11) {
    // ================= 油画厚涂：沿方向场的短笔刷 + 厚涂高光 =================
    let stepL = max(1.0, u.spacing * 0.45);
    var acc = vec3f(0.); var tex = 0.0; var wsum = 0.0;
    let seed = vec2f(b * 13.1, b * 7.7);
    for (var sgn = 0; sgn < 2; sgn++) {
      var p = uvW;
      var d = flowAt(uvW) * select(1.0, -1.0, sgn == 1);
      for (var i = 0; i < 9; i++) {
        if (sgn == 1 && i == 0) { p += d * stepL * pxToUv; continue; }
        let w = 1.0 - f32(i) / 9.0;
        let cc = mix(quantAt(p).rgb, textureSampleLevel(tC, samp, p, 0.0).rgb, 0.45);
        acc += cc * w;
        tex += vnoise(p * toPx * 0.55 + seed) * w;
        wsum += w;
        p += d * stepL * pxToUv;
        let nd = flowAt(p);
        d = select(nd, -nd, dot(nd, d) < 0.0);
      }
    }
    acc /= wsum; tex /= wsum;
    if (featFace > 0.5) { acc = col; }
    let h = tex * 2.0;
    let nrm = normalize(vec3f(-dpdx(h) * 2.5, -dpdy(h) * 2.5, 1.0));
    let light = dot(nrm, normalize(vec3f(-0.5, -0.6, 0.65)));
    var c = acc * (0.86 + 0.28 * tex) * (0.82 + 0.3 * light) + vec3f(0.08) * pow(max(light, 0.0), 12.0);
    c *= 1.0 - shadeT * 0.3;
    c = mix(c, c * 0.7, sh);
    outc = mix(paper, c, vis);
  } else if (st == 12) {
    // ================= 版画 / 木刻：沿方向场的粗细刻线 =================
    // 白噪声沿方向场做线积分卷积（LIC）→ 顺着形体走向的细刻线
    var s = 0.0; var wsum = 0.0;
    let seed = vec2f(floor(b * 0.5) * 3.3, 1.7);
    let freq = 1.6 / max(2.0, u.spacing);
    for (var sgn = 0; sgn < 2; sgn++) {
      var p = uvW;
      var d = flowAt(uvW) * select(1.0, -1.0, sgn == 1);
      for (var i = 0; i < 12; i++) {
        let w = 1.0 - f32(i) / 12.0;
        s += hash21(floor(p * toPx * freq) + seed) * w; wsum += w;
        p += d * 2.0 * pxToUv;
        let nd = flowAt(p);
        d = select(nd, -nd, dot(nd, d) < 0.0);
      }
    }
    let streak = clamp((s / wsum - 0.5) * 3.6 + 0.5, 0.0, 1.0);
    let dark = clamp((0.8 - Ls) / 0.62, 0.0, 1.0) * (1.0 - featFace * 0.8);
    let lev = floor(dark * 4.0 + 0.5) / 4.0;
    var ink = step(1.0 - lev, streak) * step(0.01, lev);
    ink = max(ink, (1.0 - smoothstep(0.18, 0.26, Ls)) * (1.0 - featFace));
    ink = max(ink, smoothstep(0.15, 0.4, L));
    ink = max(ink, sh * step(0.45, streak));
    let woodPaper = u.paper.rgb * (0.94 + 0.08 * fbm(spx * vec2f(0.01, 0.06)));
    outc = mix(woodPaper, u.ink.rgb * (0.9 + 0.15 * tooth), ink * max(vis, step(0.5, L)));
  } else if (st == 13 || st == 14) {
    // ================= 粉彩手账：来回涂的油画棒 + 色块间留白 + 断续细铅笔线 + 四边涂抹淡出 =================
    let ang = u.hatchAng + (hash21(vec2f(f32(idx), 5.1)) - 0.5) * 1.4;
    let hseed = f32(idx) * 2.31 + b * 0.53;
    // 笔触沿正弦摆动，像手腕来回划；两层不同方向叠加
    let swing = vec2f(sin(pxw.y * 0.03 + hseed), cos(pxw.x * 0.028 + hseed)) * 5.5;
    let h1 = hatch(pxw + swing, ang, hseed, u.spacing);
    let h2 = hatch(pxw - swing, ang + 0.55 + sin(hseed) * 0.3, hseed + 9.0, u.spacing * 1.25);
    let gr = vnoise(spx * 0.9 + b * 3.0) * 0.5 + vnoise(spx * 2.4) * 0.5;
    // 色块边缘留一圈纸白：颜色互不相碰
    var gap = 0.0;
    let gapR = max(u.lineW, 0.5) * 2.0 + 1.5 * vnoise(px * 0.06 + b);
    for (var k = 0; k < 8; k++) { if (idxAt(uvW + dir8(k) * gapR * pxToUv) != idx) { gap = 1.0; } }
    let darkReg = 1.0 - smoothstep(0.25, 0.45, myLab.x);           // 深色块（屋顶、黑衣）涂得更满
    let cover = (0.1 + 0.72 * max(h1, h2 * 0.85) + 0.35 * darkReg) * u.pressure
              * (1.0 - 0.8 * gap * (1.0 - darkReg * 0.6)) * (1.0 - 0.35 * lightT);
    let wax = smoothstep(0.0, 0.12, cover - (1.0 - gr) * u.grain);
    // 一深一浅两层笔触，带出油画棒的叠色
    let tint = select(col, mix(col, vec3f(1.0), 0.32), h2 * 0.85 > h1);
    let fillCol = tint * (1.0 - shadeT * 0.28) * (0.95 + 0.08 * gr);
    // 画面四边也是涂出来的：按到边缘的距离 + 噪声淡出
    let ex = min(uvW.x, 1.0 - uvW.x) * toPx.x;
    let ey = min(uvW.y, 1.0 - uvW.y) * toPx.y;
    let fade = smoothstep(0.0, 22.0, min(ex, ey) + (fbm(px * 0.04 + b * 0.2) - 0.5) * 28.0);
    // 云岛：保留蜡质颗粒的密排短线，叠一层相邻冷暖色，避免纯平涂。
    var pigment = fillCol;
    var coverage = wax;
    if (st == 14) {
      let tooth = hash21(floor(spx * 1.8));
      let strokes = smoothstep(0.2, 0.65, h1 + h2 * 0.55);
      coverage = clamp(wax * 0.75 + strokes * 0.35, 0.0, 1.0) * mix(0.72, 1.0, tooth);
      pigment = mix(fillCol, mix(col, u.paper.rgb, 0.18), h2 * 0.28);
    }
    outc = mix(outc, pigment, coverage * vis * fade);
    let lineP = smoothstep(0.3, 0.6, L) * step(0.33, vnoise(px * 0.08 + b * 2.0)) * fade;
    outc = mix(outc, u.ink.rgb, lineP * 0.8);
  }

  // —— 五官重绘：点眼睛 + 弧线嘴 + 腮红 ——
  if (featFace > 0.0 || u.featOn > 0.5) {
    let fCol = select(u.ink.rgb, vec3f(0.96), darkPaper || st == 6);
    for (var fi = 0; fi < 2; fi++) {
      if (f32(fi) >= u.featN || u.featOn < 0.5) { break; }
      let A = u.feat[fi * 2]; let B = u.feat[fi * 2 + 1];
      let sp = B.z * toPx.x;                                 // 脸宽（内容像素）
      let er = sp * 0.075;
      var ink = 0.0; var blush = 0.0; var hi = 0.0;
      for (var e = 0; e < 2; e++) {
        let ep = select(A.zw, A.xy, e == 0) * toPx;
        let dv = pxw - ep;
        ink = max(ink, 1.0 - smoothstep(er * 0.85, er * 1.1, length(dv * vec2f(1.0, 0.85))));
        hi = max(hi, 1.0 - smoothstep(er * 0.22, er * 0.38, length(dv + vec2f(er * 0.3, er * 0.35))));
        let cp = ep + vec2f(select(-1.0, 1.0, e == 0) * sp * 0.06, sp * 0.24);
        blush = max(blush, 1.0 - smoothstep(sp * 0.05, sp * 0.1, length(pxw - cp)));
      }
      // 脸的轮廓（与平涂椭圆一致），线宽跟随模板描边
      let nose = mix((A.xy + A.zw) * 0.5, B.xy, 0.5);
      let fe = (pxw - (nose - vec2f(0.0, B.z * 0.05)) * toPx) / vec2f(sp * 0.52, sp * 0.66);
      let ringW = max(u.lineW, 1.2) * 0.7 / (sp * 0.58);
      ink = max(ink, (1.0 - smoothstep(ringW * 0.6, ringW, abs(length(fe) - 1.0))) * select(1.0, 0.0, st == 3 || st == 11));
      let mp = B.xy * toPx;
      let ql = (pxw - mp) / sp;
      let curve = ql.y + 1.6 * ql.x * ql.x - 0.02;   // 屏幕 y 向下：嘴角上扬
      let mouth = (1.0 - smoothstep(0.018, 0.032, abs(curve))) * (1.0 - smoothstep(0.14, 0.17, abs(ql.x)));
      outc = mix(outc, vec3f(0.94, 0.45, 0.5), blush * 0.4 * select(1.0, 0.0, st == 1 || st == 9 || st == 12));
      outc = mix(outc, fCol, max(ink, mouth));
      outc = mix(outc, select(vec3f(1.0), vec3f(0.1), darkPaper), hi * ink * 0.9);
    }
  }

  outc = mix(outc, paper, knock * 0.4);

  // —— 画面后期：色彩类 ——
  if (pm > 0) {
    var pc = outc;
    let L = lum(outc);
    let dc = (uv0 - 0.5) * vec2f(aspect, 1.0);
    if (pm == 1) {            // 胶片颗粒
      let g = hash21(floor(spx * 1.3) + vec2f(b * 17.0, b * 3.0)) - 0.5;
      pc = outc * vec3f(1.04, 1.0, 0.9) * 0.9 + vec3f(0.06, 0.05, 0.04) + g * 0.16;
    } else if (pm == 2) {     // 暗角聚光
      let d = length(dc);
      pc = outc * (1.0 - smoothstep(0.28, 0.95, d) * 0.8) * (1.0 + 0.14 * (1.0 - smoothstep(0.0, 0.45, d)));
    } else if (pm == 3) {     // 双色调：墨 → 投影色 → 纸
      pc = mix(mix(u.ink.rgb, u.shadowCol.rgb, smoothstep(0.05, 0.5, L)), u.paper.rgb, smoothstep(0.5, 0.95, L));
    } else if (pm == 4) {     // 色调分离
      pc = floor(outc * 3.999 + (bayer4(fc) - 0.5) * 0.6) / 3.0;
    } else if (pm == 5) {     // CRT 扫描线
      let ly = uv0.y * u.res.y / max(2.0, u.res.y / 200.0);
      let scan = 0.7 + 0.3 * abs(sin(ly * 3.14159265));
      let col = i32(fc.x / max(1.0, u.res.x / 360.0)) % 3;
      let msk = select(select(vec3f(0.85, 0.85, 1.15), vec3f(0.85, 1.15, 0.85), col == 1), vec3f(1.15, 0.85, 0.85), col == 0);
      pc = outc * scan * msk * (1.08 + 0.04 * hash21(vec2f(b, 7.0)));
      if (any(uvo < vec2f(0.0)) || any(uvo > vec2f(1.0))) { pc = vec3f(0.04); }
    } else if (pm == 6) {     // 漏光
      let c1 = vec2f(0.05 + 0.08 * sin(b * 0.9), 0.12) * vec2f(aspect, 1.0);
      let c2 = vec2f(0.98, 0.9 + 0.06 * cos(b * 1.3)) * vec2f(aspect, 1.0);
      let p = uv0 * vec2f(aspect, 1.0);
      let leak = vec3f(1.0, 0.45, 0.12) * exp(-dot(p - c1, p - c1) * 5.0) + vec3f(0.95, 0.2, 0.45) * exp(-dot(p - c2, p - c2) * 7.0);
      pc = 1.0 - (1.0 - outc) * (1.0 - clamp(leak, vec3f(0.0), vec3f(1.0)));
    } else if (pm == 7) {     // 纸张折痕：横对折 + 竖三折
      let fx = abs(uv0.x - 0.5);
      let fy = min(abs(uv0.y - 0.3333), abs(uv0.y - 0.6667));
      let crease = (1.0 - smoothstep(0.0, 0.006, fx)) * 0.22 + (1.0 - smoothstep(0.0, 0.006, fy)) * 0.18;
      let hi = (1.0 - smoothstep(0.006, 0.02, fx)) * step(0.006, fx) * 0.06;
      let panel = 0.96 + 0.05 * step(0.5, uv0.x) - 0.03 * step(0.6667, uv0.y) + 0.02 * fbm(spx * 0.01);
      pc = outc * panel * (1.0 - crease) + hi;
    } else if (pm == 8) {     // 浮雕：用平滑明度的梯度打光
      let d = 1.5 / u.work;
      let rel = (textureSampleLevel(tB, samp, uvW - d, 0.0).g - textureSampleLevel(tB, samp, uvW + d, 0.0).g) * 7.0;
      pc = mix(vec3f(0.6), outc, 0.3) * u.paper.rgb / max(0.4, lum(u.paper.rgb)) + rel;
    } else if (pm == 13) {    // 热成像
      let t = clamp(L * 1.1, 0.0, 1.0);
      pc = mix(mix(vec3f(0.02, 0.0, 0.15), vec3f(0.45, 0.0, 0.6), smoothstep(0.0, 0.3, t)), vec3f(0.95, 0.15, 0.1), smoothstep(0.3, 0.6, t));
      pc = mix(pc, vec3f(1.0, 0.85, 0.2), smoothstep(0.6, 0.85, t));
      pc = mix(pc, vec3f(1.0), smoothstep(0.88, 1.0, t));
    } else if (pm == 14) {    // 蓝晒
      pc = mix(vec3f(0.04, 0.17, 0.42), vec3f(0.92, 0.95, 0.97), smoothstep(0.12, 0.92, L)) * (0.95 + 0.08 * fib);
    } else if (pm == 15) {    // 褪色宝丽来
      pc = (mix(outc, vec3f(L), 0.3) * 0.84 + vec3f(0.1, 0.08, 0.05)) * vec3f(1.04, 1.0, 0.92);
      let fr = step(uv0.x, 0.05) + step(0.95, uv0.x) + step(uv0.y, 0.05) + step(0.83, uv0.y);
      pc = mix(pc, vec3f(0.97, 0.96, 0.93) * (0.97 + 0.03 * fib), min(1.0, fr));
    }
    let warpOnly = pm >= 9 && pm <= 12;
    outc = select(mix(outc, clamp(pc, vec3f(0.0), vec3f(1.0)), select(u.postAmt, 1.0, pm == 5 || pm == 15)), outc, warpOnly);
  }

  // —— 漫画加料：集中线 / 速度线 ——
  let fxCol = select(u.ink.rgb, vec3f(0.97), darkPaper || st == 6);
  var fxA = 0.0;
  if (u.fxRadial > 0.5) {
    let dc = (uvo - u.fxC) * vec2f(aspect, 1.0);
    let r = length(dc);
    let a = (atan2(dc.y, dc.x) / 6.2831853 + 0.5) * 120.0;
    let id = floor(a); let fr = fract(a);
    let bs = floor(b * 0.5);
    let hs = hash21(vec2f(id, bs));
    let r0 = 0.22 + 0.3 * hash21(vec2f(id + 7.0, bs));
    let wdt = (0.12 + 0.4 * hs) * smoothstep(r0, r0 + 0.35, r);
    fxA = max(fxA, (1.0 - smoothstep(wdt * 0.5 - 0.06, wdt * 0.5, abs(fr - 0.5))) * step(0.3, hs) * step(r0, r));
  }
  if (u.fxSpeed > 0.5) {
    let rowH = 0.014;
    let rid = floor(uvo.y / rowH);
    let bs = floor(b * 0.5);
    let hs = hash21(vec2f(rid, bs + 3.0));
    let len = 0.12 + 0.4 * hs;
    let x0 = hash21(vec2f(rid + 9.0, bs)) * (1.0 + len) - len;
    let inL = step(x0, uvo.x) * step(uvo.x, x0 + len) * step(0.55, hs);
    let taper = smoothstep(x0, x0 + len * 0.7, uvo.x);
    let thick = 1.0 - smoothstep(0.08 + 0.18 * taper, 0.2 + 0.2 * taper, abs(fract(uvo.y / rowH) - 0.5));
    fxA = max(fxA, inL * thick * (1.0 - m * u.maskOn));
  }
  fxA *= u.fxAmt;
  outc = mix(outc, fxCol, fxA);

  // —— 叠加层：拟声字 / 对话气泡（输出空间，Canvas2D 绘制）——
  var ovA = 0.0;
  if (u.ovOn > 0.5) {
    let ov = textureSampleLevel(tE, samp, uv0, 0.0);
    outc = mix(outc, ov.rgb, ov.a);
    ovA = ov.a;
  }

  // —— 贴纸：遮罩外扩成白边，外部透明 ——
  var alpha = 1.0;
  if (u.sticker > 0.5) {
    let uvB = select(uvW, uvS, st == 4);
    var dm = maskAt(uvB);
    let bw = u.border * u.viewScale / u.res;
    for (var k = 0; k < 16; k++) {
      let a = f32(k) * 0.3926991;
      let dir = vec2f(cos(a), sin(a));
      dm = max(dm, maskAt(uvB + dir * bw * 0.5));
      dm = max(dm, maskAt(uvB + dir * bw));
    }
    alpha = select(smoothstep(0.3, 0.5, dm), step(0.4, dm), st == 4);
    alpha = max(alpha, max(ovA, fxA));
  }
  return vec4f(outc * alpha, alpha);
}
`;
