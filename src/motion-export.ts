import { appleMovie, appleStill, motionPhoto, concat } from './live-photo';
export type MotionFormat = 'motion'|'live'|'mp4';
type Opts = {w:number;h:number;fps:number;n:number;format:MotionFormat;render:(i:number)=>Promise<Uint8Array>;progress:(p:number,s:string)=>void};
export async function makeMotion(o:Opts):Promise<{blob:Blob;cover:Blob;ext:string;label:string;preview:Blob}>{
 const {w,h,fps,n}=o;
 const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d')!;
 const mid=Math.floor(n/2);let cover:Blob|null=null,mp4:Uint8Array<ArrayBuffer>;
 const bunny=await import('mediabunny');
 const native=await bunny.canEncodeVideo('avc',{width:w,height:h});
 const put=(px:Uint8Array)=>{ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer,px.byteOffset,px.byteLength),w,h),0,0);
  // Video/live photos are opaque even when exporting a sticker.
  ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#f4ead6';ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation='source-over';};
 if(native){
  const output=new bunny.Output({format:new bunny.Mp4OutputFormat({fastStart:false}),target:new bunny.BufferTarget()});
  const source=new bunny.CanvasSource(canvas,{codec:'avc',bitrate:2_000_000,keyFrameInterval:1});
  output.addVideoTrack(source,{frameRate:fps});
  try {await output.start();for(let i=0;i<n;i++){put(await o.render(i));if(i===mid)cover=await canvas.convertToBlob({type:'image/jpeg',quality:0.94});await source.add(i/fps,1/fps);o.progress((i+1)/n*.9,`渲染与编码 ${i+1}/${n} 帧`);}source.close();await output.finalize();mp4=new Uint8Array(output.target.buffer!);}
  catch(e){await output.cancel().catch(()=>{});throw e;}
 }else{
  o.progress(.01,'首次加载视频编码器（约 32 MB）');
  const {FFmpeg}=await import('@ffmpeg/ffmpeg');const ff=new FFmpeg();
  try {
   await ff.load({coreURL:new URL('/ffmpeg/ffmpeg-core.js',location.href).href,wasmURL:new URL('/ffmpeg/ffmpeg-core.wasm',location.href).href});
   const frames:Uint8Array[]=[];
   for(let i=0;i<n;i++){put(await o.render(i));if(i===mid)cover=await canvas.convertToBlob({type:'image/jpeg',quality:0.94});frames.push(new Uint8Array(ctx.getImageData(0,0,w,h).data.buffer));o.progress((i+1)/n*.65,`渲染 ${i+1}/${n} 帧`);}
   await ff.writeFile('frames.rgba',concat(...frames));frames.length=0;
   o.progress(.7,'正在编码 H.264 视频…');
   const result=await ff.exec(['-f','rawvideo','-pixel_format','rgba','-video_size',`${w}x${h}`,'-framerate',String(fps),'-i','frames.rgba','-an','-c:v','libx264','-preset','ultrafast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart','out.mp4']);
   if(result!==0)throw Error('视频编码失败，请降低导出尺寸或帧率');
   const data=await ff.readFile('out.mp4');if(typeof data==='string')throw Error('编码结果无效');mp4=new Uint8Array(data);
  }finally{ff.terminate();}
 }
 const still=cover!;const jpeg=new Uint8Array(await still.arrayBuffer());
 const preview=new Blob([mp4],{type:'video/mp4'});
 if(o.format==='mp4')return {blob:preview,preview,cover:still,ext:'mp4',label:'MP4 短视频'};
 if(o.format==='motion')return {blob:new Blob([motionPhoto(jpeg,mp4,mid/fps)],{type:'image/jpeg'}),preview,cover:still,ext:'MP.JPG',label:'安卓动态照片'};
 o.progress(.95,'打包 Live Photo 配对资源');
 const id=crypto.randomUUID().toUpperCase();const mov=appleMovie(mp4,id,mid/fps),jpg=appleStill(jpeg,id);
 const {zipSync,strToU8}=await import('fflate');
 const zip=zipSync({'CRAYON.JPG':jpg,'CRAYON.MOV':mov,'导入说明.txt':strToU8('这是 Apple Live Photo 配对资源，两个文件拥有同一个内容标识，MOV 含 still-image-time 定时元数据。\n请通过支持配对导入的 iOS 工具或 macOS 照片 App 将 JPG 和 MOV 一起作为一个 Live Photo 导入。\n仅在浏览器分别保存照片和视频不会自动合成实况。\n导入后请在手机相册确认实况标记，再上传支持 Live 图的社交平台。\n不同设备与应用的识别可能不同；本导出不保证动态锁屏壁纸兼容性。\n')},{level:0});
 return {blob:new Blob([zip as Uint8Array<ArrayBuffer>],{type:'application/zip'}),preview,cover:still,ext:'zip',label:'Apple Live Photo 配对包'};
}
