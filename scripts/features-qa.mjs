import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const b=await puppeteer.launch({executablePath:'/usr/local/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--disable-vulkan-surface'],protocolTimeout:300000});
try {
const page=await b.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')console.log('console error',m.text().slice(0,200));});
await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
await page.goto('http://localhost:5226/?nodetect',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__app?.firstFrame,{timeout:120000});console.log('booted');
await page.evaluate(()=>{const a=window.__app;a.ui.fps=10;a.ui.sceneSize=240;a.ui.autoFocus=false;a.ui.title='云岛与风';a.ui.caption='a small memory';a.applyTemplate('island');});
await page.evaluate(()=>document.querySelector('[data-tab="type"]').click());await page.$eval('#typeTune',el=>el.open=true);await page.click('#artFont [data-v="mincho"]');
await page.waitForFunction(()=>document.querySelector('#fontStatus').textContent.includes('已就绪'),{timeout:120000});
await page.$eval('#artText',el=>{el.value='风在这里停留';el.dispatchEvent(new Event('input'));});
await page.click('#artLayout [data-v="orbit"]');await page.click('#artEffect [data-v="chromatic"]');
await page.waitForFunction(()=>!window.__app.thumbing,{timeout:120000});
console.log('font loaded and art applied');
await page.evaluate(()=>window.__app.exportPng());
await page.waitForFunction(()=>window.__lastResult,{timeout:120000});
async function saveResult(name){const data=await page.evaluate(async()=>{const a=new Uint8Array(await(await fetch(window.__lastResult.url)).arrayBuffer());let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s);});fs.writeFileSync('qa/'+name,Buffer.from(data,'base64'));}
await saveResult('typography-art.png');console.log('PNG saved');
// The exported pixels are shown over the headless GPU surface for a visual screenshot.
await page.evaluate(()=>{const view=document.querySelector('#view');const image=document.createElement('img');image.src=window.__lastResult.url;image.id='qaMirror';image.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none';view.after(image);});
await page.screenshot({path:'qa/features-mobile.png',fullPage:true});
await page.evaluate(()=>{window.__app.ui.sceneSize=240;window.__app.ui.fps=10;});
for(const [format,name] of [['mp4','motion-video.mp4'],['motion','motion-photo.MP.JPG'],['live','apple-live.zip']]){
 await page.evaluate(f=>{window.__app.ui.format=f;window.__app.syncControls();},format);await page.evaluate(()=>window.__lastResult=null);
 console.log('exporting',format);
 await page.evaluate(()=>window.__app.exportMotion());
 if(!await page.evaluate(()=>window.__lastResult))throw Error(await page.$eval('.toast',el=>el.textContent));
 await saveResult(name);console.log('saved',name,fs.statSync('qa/'+name).size);
}
await page.$eval('#rollType',el=>el.click());
await page.waitForFunction(()=>document.querySelector('#fontStatus').textContent.includes('已就绪'),{timeout:120000});
if(!await page.evaluate(()=>window.__app.typography.text))throw Error('roll lost text');
const widths=[];
for(const width of [320,390,768,1440]){await page.setViewport({width,height:940,isMobile:true,hasTouch:true});const scroll=await page.evaluate(()=>document.documentElement.scrollWidth);widths.push({width,scroll});if(scroll>width)throw Error('horizontal overflow');}
await page.screenshot({path:'qa/features-desktop.png',fullPage:true});
const gpuErrors=await page.evaluate(()=>window.__app.engine.errors);
console.log(JSON.stringify({widths,gpuErrors,errors}));if(errors.length||gpuErrors.length)throw Error('browser error');
} finally { await b.close(); }
