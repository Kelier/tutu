// Minimal ISO-BMFF/Exif packaging. Motion Photo follows Android's public 1.0 spec;
// Apple pairs include the common UUID plus a mebx timed still-image-time track.
const utf = (s: string) => new TextEncoder().encode(s);
const u16 = (n: number) => new Uint8Array([n >>> 8, n & 255]);
const u32 = (n: number) => new Uint8Array([n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255]);
const zero = (n: number) => new Uint8Array(n);
export function concat(...xs: Uint8Array[]): Uint8Array<ArrayBuffer> {const o=new Uint8Array(xs.reduce((a,b)=>a+b.length,0));let at=0;for(const x of xs){o.set(x,at);at+=x.length;}return o;}
const box = (t: string | number,...parts: Uint8Array[]) => {const p=concat(...parts);return concat(u32(p.length+8),typeof t==='number'?u32(t):utf(t),p);};
const full = (t: string, flags: number,...parts: Uint8Array[]) => box(t,u32(flags),...parts);
const read = (a:Uint8Array,at:number) => new DataView(a.buffer,a.byteOffset,a.byteLength).getUint32(at);
function atoms(a:Uint8Array,start=0,end=a.length){const out:{type:string;start:number;end:number;data:Uint8Array}[]=[];
  for(let at=start;at+8<=end;){let n=read(a,at);const type=new TextDecoder().decode(a.subarray(at+4,at+8));if(n===1){n=read(a,at+8)*4294967296+read(a,at+12);}if(!n)n=end-at;if(n<8||at+n>end)throw Error('视频容器结构无效');out.push({type,start:at,end:at+n,data:a.subarray(at,at+n)});at+=n;}return out;}
const matrix=concat(u32(0x10000),u32(0),u32(0),u32(0),u32(0x10000),u32(0),u32(0),u32(0),u32(0x40000000));
const handler=(type:string)=>full('hdlr',0,u32(0),utf(type),zero(12),utf('Core Media Metadata\0'));

export function appleMovie(mp4:Uint8Array,id:string,stillTime=1.5){
  const top=atoms(mp4),movie=top.find(a=>a.type==='moov');if(!movie)throw Error('缺少视频索引');
  const children=atoms(movie.data,8),mvhd=children.find(a=>a.type==='mvhd')!;
  if(mvhd.data[8]!==0)throw Error('暂不支持超长视频时间格式');
  const movieScale=read(mvhd.data,20),movieDuration=read(mvhd.data,24);
  const ids=children.filter(a=>a.type==='trak').map(t=>{const h=atoms(t.data,8).find(a=>a.type==='tkhd')!;return read(h.data,h.data[8]===1?28:20);});
  const trackId=Math.max(0,...ids)+1;
  const head=mp4.slice();head.set(utf('free'),movie.start+4);
  const ftyp=top.find(a=>a.type==='ftyp');if(ftyp){head.set(utf('qt  '),ftyp.start+8);for(let at=ftyp.start+16;at+4<=ftyp.end;at+=4)head.set(utf('qt  '),at);}
  const sample=box(1,new Uint8Array([0]));
  const dataOffset=head.length+8;
  const metaTrack=box('trak',
    full('tkhd',7,u32(0),u32(0),u32(trackId),u32(0),u32(movieDuration),zero(8),u16(0),u16(0),u16(0),u16(0),matrix,u32(0),u32(0)),
    box('edts',full('elst',0,u32(2),u32(Math.round(stillTime*movieScale)),u32(0xffffffff),u16(1),u16(0),u32(Math.max(1,Math.round(movieScale/30))),u32(0),u16(1),u16(0))),
    box('mdia',full('mdhd',0,u32(0),u32(0),u32(600),u32(20),u16(0x55c4),u16(0)),handler('meta'),
      box('minf',box('gmhd',full('gmin',0,u16(0),zero(6),u16(0),u16(0))),
        box('dinf',full('dref',0,u32(1),full('url ',1))),
        box('stbl',full('stsd',0,u32(1),box('mebx',zero(6),u16(1),
          box('keys',box(1,box('keyd',utf('mdta'),utf('com.apple.quicktime.still-image-time')),box('dtyp',u32(1),utf('com.apple.metadata.datatype.int8')))))),
          full('stts',0,u32(1),u32(1),u32(20)),full('stsc',0,u32(1),u32(1),u32(1),u32(1)),full('stsz',0,u32(0),u32(1),u32(sample.length)),full('stco',0,u32(1),u32(dataOffset))))));
  const key='com.apple.quicktime.content.identifier';
  const meta=full('meta',0,handler('mdta'),full('keys',0,u32(1),concat(u32(8+utf(key).length),utf('mdta'),utf(key))),box('ilst',box(1,full('data',1,u32(0),utf(id)))));
  const updated=children.filter(a=>a.type!=='meta').map(a=>a.data.slice());
  const header=updated.find(a=>new TextDecoder().decode(a.subarray(4,8))==='mvhd')!;
  header.set(u32(trackId+1),header.length-4);
  return concat(head,box('mdat',sample),box('moov',...updated,metaTrack,meta));
}

/** Insert valid Exif IFD0 -> ExifIFD -> Apple MakerNote; key 17 is the shared UUID. */
export function appleStill(jpeg:Uint8Array,id:string){
 const uuid=utf(id+'\0');
 const mn=concat(utf('Apple iOS\0'),u16(1),utf('MM'),u16(1),u16(0x11),u16(2),u32(uuid.length),u32(32),u32(0),uuid);
 const tiff=concat(utf('MM'),u16(42),u32(8),u16(1),u16(0x8769),u16(4),u32(1),u32(26),u32(0),
   u16(1),u16(0x927c),u16(7),u32(mn.length),u32(44),u32(0),mn);
 const payload=concat(utf('Exif\0\0'),tiff);
 return concat(jpeg.subarray(0,2),new Uint8Array([255,225]),u16(payload.length+2),payload,jpeg.subarray(2));
}
export function motionPhoto(jpeg:Uint8Array,mp4:Uint8Array,stillTime=1.5){
 const xmp=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Camera="http://ns.google.com/photos/1.0/camera/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" Camera:MotionPhoto="1" Camera:MotionPhotoVersion="1" Camera:MotionPhotoPresentationTimestampUs="${Math.round(stillTime*1e6)}"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${mp4.length}"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>`;
 const payload=concat(utf('http://ns.adobe.com/xap/1.0/\0'),utf(xmp));
 return concat(jpeg.subarray(0,2),new Uint8Array([255,225]),u16(payload.length+2),payload,jpeg.subarray(2),mp4);
}
