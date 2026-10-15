// 生成对照图：15 种画面后期 + 30 个排版模板，写到 qa/post-sheet.png、qa/type-sheet.png
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/local/bin/chromium', headless: true, args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--disable-vulkan-surface'], protocolTimeout: 600000 });
try {
  const page = await b.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto('http://localhost:5226/?nodetect', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__app?.firstFrame, { timeout: 120000 });
  const sheet = async (items, apply, cols, cw, ch, file) => {
    const urls = [];
    for (const it of items) {
      await page.evaluate(apply, it);
      urls.push(await page.evaluate(async (cw, ch) => {
        const a = window.__app; await new Promise((r) => setTimeout(r, 50));
        await document.fonts.ready;
        const px = await a.renderFrame(cw, ch, 5);
        const c = document.createElement('canvas'); c.width = cw; c.height = ch;
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), cw, ch), 0, 0);
        return c.toDataURL();
      }, cw, ch));
    }
    const data = await page.evaluate(async (urls, labels, cols, cw, ch) => {
      const rows = Math.ceil(urls.length / cols), c = document.createElement('canvas');
      c.width = cols * cw; c.height = rows * (ch + 22); const x = c.getContext('2d');
      x.fillStyle = '#fbf8f2'; x.fillRect(0, 0, c.width, c.height); x.font = '14px sans-serif'; x.fillStyle = '#241d17';
      for (let i = 0; i < urls.length; i++) {
        const im = new Image(); im.src = urls[i]; await im.decode();
        const cx = (i % cols) * cw, cy = Math.floor(i / cols) * (ch + 22);
        x.drawImage(im, cx, cy); x.fillText(labels[i], cx + 6, cy + ch + 16);
      }
      return c.toDataURL('image/png');
    }, urls, items.map((i) => i.label), cols, cw, ch);
    (await import('node:fs')).writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  };
  const posts = await page.evaluate(() => [...document.querySelectorAll('#postGrid button')].map((b) => ({ id: +b.dataset.v, label: b.textContent })));
  await sheet(posts, (p) => { window.__app.params.post = p.id; window.__app.syncControls(); }, 8, 160, 240, 'qa/post-sheet.png');
  await page.evaluate(() => { window.__app.params.post = 0; });
  const types = await page.evaluate(() => [...document.querySelectorAll('.type-card')].map((b) => ({ id: b.dataset.id, label: b.textContent })));
  await page.evaluate(() => document.querySelector('[data-tab="type"]').click());
  await sheet(types, (t) => { window.__app.typography.text = ''; document.querySelector(`.type-card[data-id="${t.id}"]`).click(); }, 6, 200, 300, 'qa/type-sheet.png');
  console.log('sheets written');
} finally { await b.close(); }
