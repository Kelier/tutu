// 视频导入 / 导出背景 / 透明 WebM / 手账默认值回归。用法：CHROME=... node scripts/video-qa.mjs [url] [video]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5226/';
const video = process.argv.find((a) => /\.(mp4|mov|webm)$/.test(a)) || '/tmp/qa-media/test.mp4';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!cond) process.exitCode = 1; };

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 120000 });

// 1) 手账默认值
for (const id of ['island', 'pastel']) {
  await page.evaluate((i) => window.__app.applyTemplate(i), id);
  const s = await page.evaluate(() => ({ j: window.__app.ui.journal, sp: window.__app.ui.sparkles, t: window.__app.ui.title, c: window.__app.ui.caption }));
  ok(`模板 ${id} 不带手账/星星/文字`, !s.j && !s.sp && !s.t && !s.c, JSON.stringify(s));
}
await page.evaluate(() => window.__app.applyTemplate('crayon'));

// 2) 导入视频：模拟手机选文件
const input = await page.$('#file');
const t0 = Date.now();
await input.uploadFile(video);
await page.waitForFunction(() => window.__app.source?.kind === 'video', { timeout: 30000 }).catch(() => {});
const kind = await page.evaluate(() => window.__app.source?.kind);
ok('视频导入成功', kind === 'video', `${Date.now() - t0}ms`);
await page.waitForFunction(() => !document.querySelector('#stage').classList.contains('loading'), { timeout: 30000 }).catch(() => {});
const loadingGone = await page.evaluate(() => !document.querySelector('#stage').classList.contains('loading'));
ok('加载遮罩已收起', loadingGone);

// 2b) 损坏文件应在超时内给出提示而不是一直转圈
fs.writeFileSync('/tmp/qa-media/bad.mp4', Buffer.from('not a video at all'));
await input.uploadFile('/tmp/qa-media/bad.mp4');
const tb = Date.now();
await page.waitForFunction(() => document.querySelector('#toast')?.dataset.show === 'true' && /视频|解码|读取/.test(document.querySelector('#toast').textContent), { timeout: 30000 }).catch(() => {});
const toastText = await page.evaluate(() => document.querySelector('#toast').textContent);
ok('损坏视频有提示', /视频|解码|读取/.test(toastText), `${Date.now() - tb}ms "${toastText}"`);
ok('损坏后仍保留原视频', await page.evaluate(() => window.__app.source?.kind === 'video'));
ok('损坏后遮罩已收起', await page.evaluate(() => !document.querySelector('#stage').classList.contains('loading')));

// 3) 导出 MP4：白 / 黑背景（贴纸模式下背景可见）
await page.evaluate(() => { window.__app.setMode('sticker'); window.__app.ui.fps = 10; window.__app.ui.stickerSize = 240; window.__app.syncControls(); });
const bgTest = async (bg) => {
  await page.evaluate((b) => { window.__app.ui.format = 'mp4'; window.__app.ui.videoBg = b; window.__app.syncControls(); }, bg);
  await page.evaluate(() => window.__app.exportMotion());
  return page.evaluate(async () => {
    const r = window.__lastResult;
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = r.url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; });
    await new Promise((res) => { v.onseeked = res; v.currentTime = 0.1; });
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    const g = c.getContext('2d'); g.drawImage(v, 0, 0);
    const d = g.getImageData(2, 2, 1, 1).data;   // 左上角：贴纸外，应为背景色
    return { size: r.size, px: [d[0], d[1], d[2]] };
  });
};
const white = await bgTest('white');
ok('MP4 白底', white.px.every((x) => x > 240), JSON.stringify(white));
const black = await bgTest('black');
ok('MP4 黑底', black.px.every((x) => x < 15), JSON.stringify(black));

// 4) 透明 WebM
const alpha = await page.evaluate(() => !document.querySelector('#formatSeg [data-v="webm"]').hidden);
console.log('alpha 编码支持:', alpha);
if (alpha) {
  await page.evaluate(() => { window.__app.ui.format = 'webm'; window.__app.syncControls(); });
  await page.evaluate(() => window.__app.exportMotion());
  const w = await page.evaluate(() => ({ label: window.__lastResult.label, size: window.__lastResult.size }));
  ok('透明 WebM 导出', /WebM/.test(w.label) && w.size > 1000, JSON.stringify(w));
}
console.log(logs.filter((l) => /error|warn/i.test(l)).slice(0, 10).join('\n'));
await browser.close();
