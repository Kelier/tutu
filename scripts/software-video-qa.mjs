import puppeteer from 'puppeteer-core';import fs from 'node:fs';
const b=await puppeteer.launch({executablePath:'/usr/local/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--disable-vulkan-surface'],protocolTimeout:240000});
try{const p=await b.newPage();p.on('pageerror',e=>console.log('PAGEERROR',e.message));await p.evaluateOnNewDocument(()=>Object.defineProperty(window,'VideoEncoder',{value:undefined,configurable:true}));await p.goto('http://localhost:5226/?nodetect');await p.waitForFunction(()=>window.__app?.firstFrame,{timeout:120000});
await p.evaluate(()=>{window.__app.ui.sceneSize=64;window.__app.ui.fps=2;window.__app.ui.format='mp4';});
console.log('starting software encoder');await p.evaluate(()=>window.__app.exportMotion());
const data=await p.evaluate(async()=>{if(!window.__lastResult)throw Error(document.querySelector('.toast').textContent);const a=new Uint8Array(await(await fetch(window.__lastResult.url)).arrayBuffer());let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s);});fs.writeFileSync('qa/software-video.mp4',Buffer.from(data,'base64'));console.log('software MP4 passed',Buffer.from(data,'base64').length);
}finally{await b.close();}
