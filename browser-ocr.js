/* 浏览器内运行识别模型，截图不上传。 */
(function(root){
 'use strict';let ready,progressSink=()=>{};
 function report(label,stage,percent=null){progressSink(label,{stage,percent});}
 const inWorker=typeof document==='undefined'&&typeof root.importScripts==='function';
 const baseURL=inWorker?new URL('vendor/onnx/',root.location.href).href:typeof document!=='undefined'?new URL('vendor/onnx/',document.baseURI).href:'';
 function linesFromWords(words){
  const lines=[];
  for(const w of [...words].sort((a,b)=>a.y+a.height/2-b.y-b.height/2)){
   const cy=w.y+w.height/2,l=lines.find(l=>Math.abs(l.cy-cy)<Math.max(6,w.height*.45));
   if(l)l.words.push(w);else lines.push({cy,words:[w]});
  }
  return lines.sort((a,b)=>a.cy-b.cy).map(l=>l.words.sort((a,b)=>a.x-b.x).map(w=>w.text).join(' ')).join('\n');
 }
 async function initialize(){
  const base=baseURL;
  report('正在加载识别引擎……','engine');
  if(!root.ort){if(inWorker)importScripts(base+'ort.wasm.min.js');else await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=base+'ort.wasm.min.js';s.onload=resolve;s.onerror=()=>reject(new Error('识别模型加载失败，请检查网络后重试。'));document.head.append(s);});}
  ort.env.wasm.wasmPaths=base;ort.env.wasm.numThreads=1;
  const names=['ch_PP-OCRv4_det_infer.onnx','ch_PP-OCRv4_rec_infer.onnx'],loaded=[0,0],totals=[0,0];
  const buffers=await Promise.all(names.map(async(name,index)=>{
   const response=await fetch(base+name);if(!response.ok)throw new Error('模型下载失败，请检查网络后重试。');totals[index]=Number(response.headers.get('Content-Length'))||0;
   const update=()=>{const known=totals.every(n=>n>0),received=loaded.reduce((a,b)=>a+b,0),total=totals.reduce((a,b)=>a+b,0),percent=known?Math.min(100,Math.floor(received/total*100)):null;report('正在下载识别模型'+(percent===null?'……':' '+percent+'%……'),'download',percent);};
   if(!response.body||!response.body.getReader){const bytes=new Uint8Array(await response.arrayBuffer());loaded[index]=bytes.length;update();return bytes;}
   const reader=response.body.getReader(),chunks=[];for(;;){const {value,done}=await reader.read();if(done)break;chunks.push(value);loaded[index]+=value.length;update();}
   const bytes=new Uint8Array(loaded[index]);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
  }));
  report('模型已下载，正在准备手机识别……','prepare');
  const [det,rec,chars]=await Promise.all([ort.InferenceSession.create(buffers[0]),ort.InferenceSession.create(buffers[1]),fetch(base+'characters.json').then(r=>{if(!r.ok)throw new Error('字典加载失败');return r.json();})]);return {det,rec,chars};
 }
 function tensor(canvas,width=canvas.width){
  const {data}=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),area=width*canvas.height,values=new Float32Array(area*3);
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4,j=y*width+x;for(let c=0;c<3;c++)values[c*area+j]=data[i+2-c]/127.5-1;}
  return new ort.Tensor('float32',values,[1,3,canvas.height,width]);
 }
 function resized(source,w,h,box){
  const c=inWorker?new OffscreenCanvas(w,h):document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
  if(box)ctx.drawImage(source,box.x,box.y,box.width,box.height,0,0,w,h);else ctx.drawImage(source,0,0,w,h);return c;
 }
 function regions(prob,w,h,source){
  const seen=new Uint8Array(w*h),queue=new Int32Array(w*h),boxes=[];
  for(let start=0;start<prob.length;start++){
   if(seen[start]||prob[start]<.3)continue;
   let head=0,tail=1,minx=w,miny=h,maxx=0,maxy=0,sum=0;queue[0]=start;seen[start]=1;
   while(head<tail){const i=queue[head++],x=i%w,y=Math.floor(i/w);sum+=prob[i];minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;const n=ny*w+nx;if(!seen[n]&&prob[n]>=.3){seen[n]=1;queue[tail++]=n;}}
   }
   const bw=maxx-minx+1,bh=maxy-miny+1;if(bw<3||bh<3||tail<6||sum/tail<.65)continue;
   const pad=bw*bh/(bw+bh),sx=source.width/w,sy=source.height/h,x=Math.max(0,(minx-pad)*sx),y=Math.max(0,(miny-pad)*sy);
   boxes.push({x,y,width:Math.min(source.width-x,(bw+2*pad)*sx),height:Math.min(source.height-y,(bh+2*pad)*sy)});
  }return boxes;
 }
 async function recognize(canvas,onProgress=()=>{}){
  progressSink=onProgress;report(ready?'正在准备识别……':'首次使用正在加载识别模型，请稍候……','prepare');if(!ready)ready=initialize().catch(e=>{ready=null;throw e;});let models=await ready;if(!models){ready=initialize().catch(e=>{ready=null;throw e;});models=await ready;}const {det,rec,chars}=models;
  report('正在定位尺码表文字……','detect');const scale=Math.min(736/Math.min(canvas.width,canvas.height),2400/Math.max(canvas.width,canvas.height)),w=Math.max(32,Math.round(canvas.width*scale/32)*32),h=Math.max(32,Math.round(canvas.height*scale/32)*32);
  const detection=await det.run({[det.inputNames[0]]:tensor(resized(canvas,w,h))}),out=detection[det.outputNames[0]],boxes=regions(out.data,out.dims[3],out.dims[2],canvas),words=[];
  for(let n=0;n<boxes.length;n++){
   const box=boxes[n],cw=Math.max(1,Math.ceil(48*box.width/box.height)),padded=Math.max(32,Math.ceil(cw/32)*32),result=await rec.run({[rec.inputNames[0]]:tensor(resized(canvas,cw,48,box),padded)}),pred=result[rec.outputNames[0]],classes=pred.dims[2];let text='',previous=-1,total=0,count=0;
   for(let t=0;t<pred.dims[1];t++){let best=0;for(let c=1;c<classes;c++)if(pred.data[t*classes+c]>pred.data[t*classes+best])best=c;if(best&&best!==previous){text+=chars[best]||'';total+=pred.data[t*classes+best];count++;}previous=best;}
   if(text.trim()&&total/count>.5)words.push({...box,text:text.trim()});report('正在识别尺码表 '+Math.round((n+1)/boxes.length*100)+'%……','recognize',Math.round((n+1)/boxes.length*100));await new Promise(resolve=>setTimeout(resolve,0));
  }return {text:linesFromWords(words),words,engine:'browser'};
 }
 if(inWorker&&typeof root.importScripts==='function'){
  root.onmessage=async e=>{if(e.data.prepare){if(!ready)ready=initialize().catch(()=>{ready=null;});return;}const bitmap=e.data.bitmap;try{const canvas=resized(bitmap,bitmap.width,bitmap.height);bitmap.close();const result=await recognize(canvas,(message,detail)=>root.postMessage({progress:message,detail}));root.postMessage({result});}catch(e){console.error('OCR',e);root.postMessage({error:'识别未完成，请检查网络或裁剪到清晰的尺码表后重试。'});}};
 }else{
  let worker;
  function prepare(){if(!root.Worker||!root.OffscreenCanvas||!root.createImageBitmap)return;if(!worker)worker=new Worker(new URL('browser-ocr.js?v=3',document.baseURI));worker.postMessage({prepare:true});}
  async function recognizeInWorker(canvas,onProgress=()=>{}){
   if(!root.Worker||!root.OffscreenCanvas||!root.createImageBitmap)return recognize(canvas,onProgress);
   if(!worker)worker=new Worker(new URL('browser-ocr.js?v=3',document.baseURI));
   const bitmap=await createImageBitmap(canvas);
   return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{worker.terminate();worker=null;reject(new Error('识别超时，请检查网络或裁剪到尺码表后重试。'));},600000);
    worker.onmessage=e=>{if(e.data.progress)onProgress(e.data.progress,e.data.detail);else{clearTimeout(timeout);if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.result);}};
    worker.onerror=()=>{clearTimeout(timeout);worker.terminate();worker=null;reject(new Error('浏览器识别暂时失败，请重新上传；也可裁剪到尺码表后重试。'));};worker.postMessage({bitmap},[bitmap]);
   });
  }
  const api={recognize:recognizeInWorker,prepare,linesFromWords};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BrowserSizeOCR=api;
 }
})(globalThis);
