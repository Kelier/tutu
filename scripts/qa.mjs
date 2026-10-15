// 无头 QA：加载页面 → 截图 → 每个模板导出一张 PNG → 导出画面 GIF 与贴纸 GIF → 保存到 qa/
// 用法：node scripts/qa.mjs [url] [--stills]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5226/';
const STILLS = process.argv.includes('--stills');
const out = new URL('../qa/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/local/bin/chromium',
  headless: 'new',
  // 无头环境用 SwiftShader 跑 WebGPU；没有呈现表面，画布内容截不到，靠离屏读回验证
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--disable-vulkan-surface'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const idle = () => page.waitForFunction(() => window.__app && !window.__app.thumbing, { timeout: 600000 });

// 首屏：200ms 时截一张，确认样式已生效（没有无样式闪烁）
const tNav = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 200));
const styled = await page.evaluate(() => getComputedStyle(document.querySelector('.stage')).borderRadius);
await page.screenshot({ path: out + 'ui-boot.png' });
console.log('styled at 200ms:', styled, '| boot overlay visible:', await page.evaluate(() => !document.querySelector('#stage').classList.contains('ready')));
await page.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 120000 });
console.log('first frame ms (in page):', await page.evaluate(() => window.__app.bootMs), '| wall:', Date.now() - tNav);
await page.waitForFunction(() => window.__app.foci.length > 0, { timeout: 300000 }).catch(() => {});
await idle();
await new Promise((r) => setTimeout(r, 1500));

// 把离屏渲染结果盖在画布上再截图
async function mirrorCanvas() {
  await page.evaluate(async () => {
    const a = window.__app, c = document.querySelector('#view');
    const w = c.width, h = c.height;
    const px = await a.engine.renderToPixels(a.params, a.frameOpts(w, h, 0));
    let o = document.querySelector('#qaMirror');
    if (!o) { o = document.createElement('canvas'); o.id = 'qaMirror'; c.after(o); }
    o.width = w; o.height = h; o.style.cssText = c.style.cssText + ';position:absolute;left:0;top:0;';
    o.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), w, h), 0, 0);
  });
}

async function save(name, fn) {
  await page.evaluate((fn) => { window.__lastResult = null; return window.__app[fn](); }, fn);
  await page.waitForFunction(() => window.__lastResult, { timeout: 600000 });
  const { b64, label, size } = await page.evaluate(async () => {
    const r = window.__lastResult;
    const buf = new Uint8Array(await (await fetch(r.url)).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { b64: btoa(s), label: r.label, size: r.size };
  });
  fs.writeFileSync(out + name, Buffer.from(b64, 'base64'));
  console.log(name, label, (size / 1024).toFixed(0) + 'KB');
}

console.log('foci', await page.evaluate(() => JSON.stringify(window.__app.foci.map((f) => [f.kind, +f.cx.toFixed(2), +f.cy.toFixed(2)]))));
await page.evaluate(() => document.querySelector('#stage').classList.add('show-focus'));
await mirrorCanvas();
await page.screenshot({ path: out + 'ui-scene.png' });
await page.evaluate(() => document.querySelector('#stage').classList.remove('show-focus'));

for (const id of ['crayon', 'kid', 'manga', 'pop', 'riso', 'pixel', 'chalk', 'neon', 'papercut', 'stitch', 'news', 'water', 'oil', 'woodcut']) {
  await page.evaluate((id) => window.__app.applyTemplate(id), id);
  await new Promise((r) => setTimeout(r, 1200));
  await save(`tpl-${id}.png`, 'exportPng');
}
console.log('thumbs rendered:', await page.evaluate(() => window.__app.thumbsDone));
// 五官重绘 + 漫画加料
await page.evaluate(() => {
  const a = window.__app; a.applyTemplate('kid');
  a.ui.featOn = true; a.ui.fxRadial = true; a.ui.sfx = '哇哦'; a.ui.bubble = '今天也要开心'; a.syncControls();
  document.querySelector('#focusControls input[type=checkbox]') && null;
});
await page.evaluate(() => { const a = window.__app; a.ui.autoFocus = false; a.syncControls(); a.ui.autoFocus = true; a.syncControls(); });
await page.evaluate(() => { const t = [...document.querySelectorAll('#focusControls .toggle')].find((el) => el.textContent.includes('五官')); t.querySelector('input').checked = true; t.querySelector('input').dispatchEvent(new Event('change')); });
await new Promise((r) => setTimeout(r, 1500));
await save('fx-kid.png', 'exportPng');
await mirrorCanvas();
await page.screenshot({ path: out + 'ui-fx.png' });
await page.evaluate(() => { const a = window.__app; a.ui.fxRadial = false; a.ui.sfx = ''; a.ui.bubble = ''; a.syncControls(); a.applyTemplate('crayon'); });
await new Promise((r) => setTimeout(r, 1200));
if (!STILLS) await save('scene.gif', 'exportGif');

await page.evaluate(() => window.__app.loadImageUrl('/samples/bull.jpg', 'bull.jpg'));
await idle();
await page.evaluate(() => { window.__app.setMode('sticker'); window.__app.params.motion = 1; });
await new Promise((r) => setTimeout(r, 1500));
await mirrorCanvas();
await page.screenshot({ path: out + 'ui-sticker.png' });
await save('still-sticker.png', 'exportPng');
if (!STILLS) await save('sticker.gif', 'exportGif');

const errs = await page.evaluate(() => window.__app.engine.errors || []);
console.log('gpu errors', errs.slice(0, 5));
console.log(logs.filter((l) => !l.includes('[vite]')).slice(0, 20).join('\n'));
await browser.close();
