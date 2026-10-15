import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const browser=await puppeteer.launch({executablePath:'/usr/local/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--disable-vulkan-surface'],protocolTimeout:240000});
const errors=[];
try{
 const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
 const requests=[];p.on('request',r=>requests.push(r.url()));
 await p.setViewport({width:1440,height:940});await p.goto('http://localhost:5226/?nodetect',{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__app?.firstFrame,{timeout:120000});
 if(await p.$('#aiMenu,#aiConfig,#aiBtn'))throw Error('AI remains');
 if(await p.$$eval('select',s=>s.length))throw Error('native select remains');
 await p.click('[data-tab="type"]');
 if(await p.$$eval('.type-card',s=>s.length)!==30)throw Error('not 30 templates');
 const visible=()=>p.$$eval('.type-card',s=>s.filter(e=>!e.hidden).map(e=>e.dataset.id));
 if((await visible()).length!==6)throw Error('pagination failed');
 const ids=new Set(await visible());
 for(let i=0;i<4;i++){await p.click('#typeNext');for(const id of await visible())ids.add(id);}
 if(ids.size!==30)throw Error('not all 30 templates reachable');
 if(!await p.$eval('#typeNext',e=>e.disabled))throw Error('last-page next enabled');
 await p.$eval('#artText',e=>{e.value='留住这一刻';e.dispatchEvent(new Event('input'));});
 await p.click('#typeCats [data-cat="古典"]');
 await p.click('.type-card[data-id="vertical"]');
 await p.waitForFunction(()=>document.querySelector('#fontStatus').textContent.includes('已就绪'),{timeout:120000});
 const before=await p.evaluate(()=>({...window.__app.typography}));
 await p.click('#rollType');
 const roll=await p.evaluate(()=>({...window.__app.typography}));if(roll.text!=='留住这一刻'||roll.preset===before.preset)throw Error('roll invalid');
 await p.click('#undoType');
 if(await p.evaluate(()=>window.__app.typography.preset)!==before.preset)throw Error('undo failed');
 await p.click('#typeTune summary');
 const size=await p.$('input[aria-label="字号"]');await size.evaluate(e=>{e.value='0.18';e.dispatchEvent(new Event('input'));});
 await p.click('#resetType');
 if(await p.evaluate(()=>window.__app.typography.size)!==before.size)throw Error('reset failed');
 await p.$eval('#typeTune',e=>e.open=false);
 await p.evaluate(()=>document.querySelector('.panel-scroll').scrollTop=0);
 // Read back the real GPU render for headless screenshots.
 const mirror=()=>p.evaluate(async()=>{const a=window.__app,c=document.querySelector('#view');const px=await a.renderFrame(c.width,c.height,4);let m=document.querySelector('#qaMirror');if(!m){m=document.createElement('canvas');m.id='qaMirror';c.after(m);}m.width=c.width;m.height=c.height;m.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';m.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer),c.width,c.height),0,0);});
 await mirror();await p.screenshot({path:'qa/review-desktop.png'});
 await p.click('[data-tab="post"]');
 if(await p.$$eval('#postGrid button[data-v]',s=>s.filter(e=>e.dataset.v!=='0').length)!==15)throw Error('not 15 post effects');
 const results=[];
 for(let i=0;i<=15;i++){
  await p.evaluate(i=>{window.__app.params.post=i;window.__app.params.postAmt=1;window.__app.typography.text='';window.__app.syncControls();},i);
  const result=await p.evaluate(async()=>{const px=await window.__app.renderFrame(120,180,5);let hash=2166136261,total=0;for(let k=0;k<px.length;k++){hash=Math.imul(hash^px[k],16777619);if(k%4!==3)total+=px[k];}return {hash:hash>>>0,mean:total/(px.length/4*3)};});
  if(result.mean<2||result.mean>254)throw Error('blank post '+i);results.push(result);
 }
 if(new Set(results.map(x=>x.hash)).size!==16)throw Error('duplicate processing results');
 console.log('30 reachable presets / pagination / category roll / undo / reset / 15 distinct GPU effects passed');
 await p.evaluate(()=>{const a=window.__app;a.params.post=14;a.typography.text='留住这一刻';a.typography.font='mincho';a.ui.sceneSize=160;a.ui.fps=10;a.ui.format='gif';a.syncControls();});
 await p.evaluate(()=>window.__app.exportGif());
 if(!await p.evaluate(()=>window.__lastResult?.label.includes('GIF')))throw Error('GIF export failed');
 await p.evaluate(()=>{window.__lastResult=null;window.__app.ui.format='live';window.__app.syncControls();});
 await p.evaluate(()=>window.__app.exportMotion());
 if(!await p.evaluate(()=>window.__lastResult?.label.includes('Live Photo')))throw Error('Live export failed');
 console.log('GIF and Live Photo exports with GPU post + typography passed');
 await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__app?.firstFrame,{timeout:120000});
 await p.click('[data-tab="type"]');await p.click('.type-card[data-id="film"]');
 await p.waitForFunction(()=>document.querySelector('#fontStatus').textContent.includes('已就绪'),{timeout:120000});
 await p.click('#moveType');await new Promise(r=>setTimeout(r,450));
 const r=await p.$eval('#view',e=>e.getBoundingClientRect().toJSON());
 const client=await p.createCDPSession();
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width*.5,y:r.y+r.height*.5}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+r.width*.72,y:r.y+r.height*.62}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const pos=await p.evaluate(()=>({x:window.__app.typography.x,y:window.__app.typography.y}));
 if(Math.abs(pos.x-.72)>.03||Math.abs(pos.y-.62)>.03)throw Error('touch drag failed '+JSON.stringify(pos));
 await p.click('.type-move-done');if(await p.$eval('#stage',e=>e.classList.contains('moving-type')))throw Error('drag did not finish');
 await mirror();await p.click('[data-tab="type"]');await p.evaluate(()=>document.querySelector('#panelTabs').scrollIntoView({block:'start'}));
 await p.screenshot({path:'qa/review-mobile-type.png'});
 for(const width of [320,390,768,844,1440]){await p.setViewport({width,height:940,isMobile:true,hasTouch:true});const sw=await p.evaluate(()=>document.documentElement.scrollWidth);if(sw>width)throw Error(`overflow ${width}/${sw}`);}
 const gpuErrors=await p.evaluate(()=>window.__app.engine.errors);
 if(requests.some(u=>u.includes('/api/ai/')||u.includes('fal.run')))throw Error('AI request remains');
 if(errors.length||gpuErrors.length)throw Error(JSON.stringify({errors,gpuErrors}));
 console.log('Touch drag / responsive widths / no AI calls / no GPU or browser errors passed');
}finally{await browser.close();}
