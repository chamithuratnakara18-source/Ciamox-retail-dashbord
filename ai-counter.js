/* =====================================================================
   AI Counter — camera-based product recognition for a checkout counter
   Pipeline: webcam → RT-DETRv2 proposals plus empty-counter foreground → crop → image
   embedding (DINOv2-small, runs in the browser) → nearest enrolled product
   → cashier confirms → cart → payment.
   ===================================================================== */
const MOCK = new URLSearchParams(location.search).has('mock');   // test mode: tiny colour embedder
const MODEL_ID = 'Xenova/dinov2-small';
const MODEL_TAG = MOCK ? 'mock-colour' : MODEL_ID;
const $ = id => document.getElementById(id);

/* ---------- small helpers ---------- */
const money = n => (Math.round(n * 100) / 100).toFixed(2);
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); }
function norm(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; for (let i = 0; i < v.length; i++) v[i] /= s; return v; }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = str => { const s = atob(str), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- IndexedDB ---------- */
const DB = (() => {
  let db;
  const open = () => new Promise((res, rej) => {
    if (db) return res(db);
    const r = indexedDB.open('ai-counter', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('products', { keyPath: 'id' }); r.result.createObjectStore('sales', { keyPath: 'id' }); };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); };
  return {
    all: store => tx(store, 'readonly', s => s.getAll()),
    put: (store, v) => tx(store, 'readwrite', s => s.put(v)),
    del: (store, k) => tx(store, 'readwrite', s => s.delete(k)),
    clear: store => tx(store, 'readwrite', s => s.clear()),
    replaceProducts: items => tx('products', 'readwrite', store => {
      store.clear();
      for (const item of items) store.put(item);
    }),
  };
})();

/* ---------- catalogue in memory ---------- */
let products = [];            // {id,name,sku,price,thumb,model,samples:[ArrayBuffer]}
let bank = [];                // flat list [{pid, vec:Float32Array}] for fast matching
function rebuildBank() {
  bank = [];
  for(const p of products)if(p.model===MODEL_TAG){
    for(const buf of [...p.samples,...(p.trainingSamples||[])])bank.push({pid:p.id,vec:new Float32Array(buf)});
    if(p.photoSample)bank.push({pid:p.id,vec:new Float32Array(p.photoSample)});
  }
  $('readyStat').textContent=`${new Set(bank.map(s=>s.pid)).size} / ${products.length} products ready`;
  $('pCount').textContent = products.length;
  $('sCount').textContent = new Set(bank.map(sample=>sample.pid)).size;
}
const byId = id => products.find(p => p.id === id);

/* ---------- model worker: batched crops, no inference on the UI thread ---------- */
let modelPromise=null, modelReady=false, modelBackend='CPU', visionWorker=null, visionId=0, inferenceMs=0;
const pendingVision=new Map();
function setModelState(t){ $('modelState').textContent=t; }
function visionRequest(type, images=[]){
  if(!visionWorker){
    visionWorker=new Worker('./ai-vision-worker.js?v=repeat-20261110-1');
    visionWorker.onmessage=({data})=>{
      if(data.type==='status'){setModelState(data.text);return;}
      const request=pendingVision.get(data.id);if(!request)return;
      clearTimeout(request.timer);pendingVision.delete(data.id);
      data.error?request.reject(new Error(data.error)):request.resolve(data);
    };
    visionWorker.onerror=()=>resetVision(new Error('Recognition worker could not start. Reload or retry model loading.'));
  }
  const id=++visionId;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>resetVision(new Error('Recognition timed out. Check the connection, then retry.')),type==='load'?180000:60000);
    pendingVision.set(id,{resolve,reject,timer});
    visionWorker.postMessage({id,type,images},images.map(im=>im.buffer));
  });
}
function resetVision(error){
  visionWorker?.terminate();visionWorker=null;modelPromise=null;modelReady=false;
  for(const r of pendingVision.values()){clearTimeout(r.timer);r.reject(error);}pendingVision.clear();
  setModelState('Model unavailable · retry');
}
function loadModel(){
  if(modelPromise)return modelPromise;
  modelPromise=(MOCK?Promise.resolve({backend:'test'}):visionRequest('load')).then(result=>{
    modelReady=true;modelBackend=result.backend==='webgpu'?'GPU':MOCK?'TEST':'CPU';
    setModelState(`Model ready · ${modelBackend}`);return result;
  }).catch(error=>{modelPromise=null;modelReady=false;setModelState('Model unavailable · press Retry model');$('cameraHelp').textContent=error.message;throw error;});
  return modelPromise;
}
async function embedBatch(canvases){
  await loadModel();
  if(MOCK)return canvases.map(canvas=>{
    const c=document.createElement('canvas');c.width=c.height=8;const ctx=c.getContext('2d');ctx.drawImage(canvas,0,0,8,8);
    const d=ctx.getImageData(0,0,8,8).data,v=new Float32Array(192);let m=0;
    for(let i=0,j=0;i<d.length;i+=4){v[j++]=d[i];v[j++]=d[i+1];v[j++]=d[i+2];}
    for(const n of v)m+=n;m/=v.length;for(let i=0;i<v.length;i++)v[i]-=m;return norm(v);
  });
  const images=canvases.map(c=>({buffer:c.getContext('2d').getImageData(0,0,c.width,c.height).data.buffer,width:c.width,height:c.height}));
  const result=await visionRequest('embed',images);inferenceMs=Math.round(result.ms);modelBackend=result.backend==='webgpu'?'GPU':'CPU';
  $('latencyStat').textContent=`${inferenceMs} ms / ${canvases.length} ${canvases.length===1?'item':'items'} · ${modelBackend}`;
  return result.vectors.map(v=>new Float32Array(v));
}
async function embed(canvas){return (await embedBatch([canvas]))[0];}
let ocrWorkerPromise=null;
async function textWorker(){
  if(!ocrWorkerPromise)ocrWorkerPromise=(async()=>{
    if(!window.Tesseract)await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
      script.onload=resolve;script.onerror=()=>reject(new Error('Text recognition unavailable'));
      document.head.append(script);
    });
    return window.Tesseract.createWorker('eng');
  })().catch(error=>{ocrWorkerPromise=null;throw error;});
  return ocrWorkerPromise;
}
async function readLabel(canvas){
  const worker=await textWorker();
  const result=await worker.recognize(canvas,{rotateAuto:true});
  return String(result.data?.text||'');
}

/* ---------- matching ---------- */
function match(q) {   // best score per product, top 3
  const best = new Map();
  for (const s of bank) { const c = dot(q, s.vec); if (c > (best.get(s.pid) ?? -2)) best.set(s.pid, c); }
  return [...best].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([pid, score]) => ({ p: byId(pid), score }));
}

/* ---------- camera + presence engine ---------- */
const SW=192, SH=108;
const small=document.createElement('canvas');small.width=SW;small.height=SH;
const sctx=small.getContext('2d',{willReadFrequently:true});
function grab(video){sctx.drawImage(video,0,0,SW,SH);return sctx.getImageData(0,0,SW,SH).data;}

/* RT-DETRv2 is a generic object localizer, not a retail SKU classifier. It
   runs independently so loading or inferencing never pauses the camera UI. */
let detectorWorker=null,detectorReady=false,detectorLoading=null,detectorBusy=false;
let detectorSeq=0,detectorLastAt=0,detectorResult=null,detectorFailed=false;
const detectorPending=new Map();
const detectorCanvas=document.createElement('canvas');
function detectorStatus(text){$('detectorState').textContent=text;}
function resetDetector(error){
  detectorWorker?.terminate();detectorWorker=null;detectorReady=false;detectorLoading=null;detectorBusy=false;
  detectorResult=null;detectorFailed=true;
  for(const item of detectorPending.values()){clearTimeout(item.timer);item.reject(error);}
  detectorPending.clear();detectorStatus('Object detector unavailable · foreground fallback');
}
function detectorRequest(type,image){
  if(!detectorWorker){
    detectorWorker=new Worker('./ai-detector-worker.js?v=repeat-20261110-1');
    detectorWorker.onmessage=({data})=>{
      const item=detectorPending.get(data.id);if(!item)return;
      clearTimeout(item.timer);detectorPending.delete(data.id);
      data.type==='error'?item.reject(new Error(data.error)):item.resolve(data);
    };
    detectorWorker.onerror=()=>resetDetector(new Error('Object detector worker failed.'));
  }
  const id=++detectorSeq;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>resetDetector(new Error('Object detector timed out.')),type==='load'?180000:45000);
    detectorPending.set(id,{resolve,reject,timer});
    try{detectorWorker.postMessage({id,type,...image},image?[image.buffer]:[]);}
    catch(error){clearTimeout(timer);detectorPending.delete(id);reject(error);}
  });
}
function loadDetector(){
  if(detectorFailed||MOCK)return Promise.resolve(false);
  if(detectorLoading)return detectorLoading;
  detectorStatus('Loading RT-DETRv2 object detector…');
  detectorLoading=detectorRequest('load').then(()=>{
    detectorReady=true;detectorStatus('RT-DETRv2 ready · CPU');return true;
  }).catch(error=>{resetDetector(error);console.warn('RT-DETR unavailable; foreground fallback remains active:',error);return false;});
  return detectorLoading;
}
function requestObjectBoxes(video,now){
  const interval=tracker.tracks.filter(t=>t.visible).length>=2?1200:850;
  if(!detectorReady||detectorBusy||counter.busy||now-detectorLastAt<interval)return;
  detectorLastAt=now;detectorBusy=true;
  detectorCanvas.width=512;
  detectorCanvas.height=Math.round(512*video.videoHeight/video.videoWidth);
  const context=detectorCanvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(video,0,0,detectorCanvas.width,detectorCanvas.height);
  const image={buffer:context.getImageData(0,0,detectorCanvas.width,detectorCanvas.height).data.buffer,
    width:detectorCanvas.width,height:detectorCanvas.height};
  const epoch=counter.referenceEpoch;
  void detectorRequest('detect',image).then(result=>{
    if(counter.stream&&epoch===counter.referenceEpoch){
      detectorResult={boxes:result.boxes,at:performance.now()};
      detectorStatus(`RT-DETRv2 ready · ${result.ms} ms / frame`);
    }
  }).catch(error=>{resetDetector(error);console.warn('RT-DETR inference failed:',error);}).finally(()=>{detectorBusy=false;});
}

async function openCamera(video, deviceId) {
  const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
  const tries = [deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: { ideal: 'environment' } }, true];
  let err;
  for (const v of tries) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      video.srcObject = stream;
      await video.play();
      if (!video.videoWidth) await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Camera opened but no video frames arrived. Check the lens or close other camera apps.')), 5000);
        video.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(); }, { once: true });
        video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('The camera opened but the video stream failed.')); }, { once: true });
      });
      return stream;
    } catch (e) {
      stream?.getTracks().forEach(track => track.stop());
      video.srcObject = null;
      err = e;
      if (['NotAllowedError', 'PermissionDeniedError', 'NotReadableError', 'TrackStartError'].includes(e?.name)) throw e;
    }
  }
  throw err;
}
function cameraErrorMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return 'The browser or embedded-frame policy blocked camera access. Open AI Detection Cam directly in a new tab, allow Camera for that URL, then reload.';
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return 'No camera was found. Connect or enable a camera, then try again.';
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') return 'The camera is busy or blocked by another app. Close apps using it and try again.';
  if (error?.name === 'SecurityError' || !window.isSecureContext) return 'Camera access requires HTTPS. Open this app using its secure Vercel address.';
  return `Could not start the camera${error?.message ? `: ${error.message}` : '.'}`;
}
async function listCameras() {
  try { const ds = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); const sel = $('camSel'); const cur = sel.value; sel.replaceChildren(...ds.map((d, i) => Object.assign(document.createElement('option'), { value: d.deviceId, textContent: d.label || 'Camera ' + (i + 1) }))); if (cur) sel.value = cur; } catch { /* ignore */ }
}

function cropSquare(video, bbox, padding=1.25) {   // bbox in 0..1 of the frame, or null → centre square. Returns 224×224 canvas.
  const vw = video.videoWidth, vh = video.videoHeight;
  let x, y, w, h;
  if (bbox) { x = bbox.x0 * vw; y = bbox.y0 * vh; w = (bbox.x1 - bbox.x0) * vw; h = (bbox.y1 - bbox.y0) * vh; }
  else { const s = Math.min(vw, vh) * .7; x = (vw - s) / 2; y = (vh - s) / 2; w = h = s; }
  const side = Math.min(Math.max(w, h) * padding, Math.min(vw, vh));
  let cx = x + w / 2 - side / 2, cy = y + h / 2 - side / 2;
  cx = Math.max(0, Math.min(vw - side, cx)); cy = Math.max(0, Math.min(vh - side, cy));
  const c = $('work'); c.width = c.height = 224;
  c.getContext('2d').drawImage(video, cx, cy, side, side, 0, 0, 224, 224);
  const out = document.createElement('canvas'); out.width = out.height = 224; out.getContext('2d').drawImage(c, 0, 0);
  return out;
}
function rotateCrop(source,degrees){
  const out=document.createElement('canvas');out.width=out.height=224;
  const ctx=out.getContext('2d');ctx.translate(112,112);ctx.rotate(degrees*Math.PI/180);
  ctx.drawImage(source,-112,-112);
  return out;
}
function focusRegions(bbox){
  const regions=[bbox],w=bbox.x1-bbox.x0,h=bbox.y1-bbox.y0;
  // A broad motion region can include a hand or moving cloth. Search smaller
  // overlapping views, then display the region that actually matches inventory.
  if(w*h>.11){
    const cw=w*.68,ch=h*.68;
    for(const dx of [0,.32])for(const dy of [0,.32])
      regions.push({x0:bbox.x0+w*dx,y0:bbox.y0+h*dy,x1:bbox.x0+w*dx+cw,y1:bbox.y0+h*dy+ch});
  }
  return regions;
}

/* ---------- independent objects + identity-preserving tracking ---------- */
const tracker=new RetailScan.Tracker({settleMs:180,missingMs:900,maxTracks:8});
const counter={paused:false,stream:null,baseline:null,prev:null,busy:false,timer:null,calibrating:false,lastBBox:null,backgroundBank:[],referenceEpoch:0};
const cart=new Map();
let inventoryReady=false, checkoutBusy=false, inventoryRevision=0, recognitionFailures=0, retryAfter=0;
const repeatCache=new RetailScan.RepeatCache();
let batchWaitingSince=0;
function viewFingerprint(canvas){
  const c=document.createElement('canvas');c.width=c.height=16;
  const context=c.getContext('2d',{willReadFrequently:true});
  context.drawImage(canvas,0,0,16,16);
  return RetailScan.repeatFingerprint(context.getImageData(0,0,16,16).data,16,16);
}
function tryRecentRepeat(track,now){
  if(track.repeatTriedRevision===track.revision)return false;
  const crop=cropSquare($('vidC'),track.bbox,1.08);
  const signature=viewFingerprint(crop);
  const found=repeatCache.find(signature,track.bbox,now,counter.referenceEpoch);
  if(!found){track.repeatTriedRevision=track.revision;track.repeatCandidate=null;return false;}
  const prev=track.repeatCandidate;
  if(!prev||prev.pid!==found.pid||prev.revision!==track.revision){
    track.repeatCandidate={pid:found.pid,revision:track.revision,at:now};
    track.nextAt=now+80;
    return true;
  }
  if(now-prev.at<70)return true;
  track.repeatTriedRevision=track.revision;
  const original=found.entry;
  // Only near-identical pixels from two successive frames may reuse a trusted
  // checkout. Similar packaging below this mark remains a manual suggestion.
  const repeatTrusted=original.trusted&&found.similarity>=.992;
  const result={pid:found.pid,score:Math.min(original.score,found.similarity),gap:original.gap,
    backgroundLead:original.backgroundLead,level:'ok',bbox:track.bbox,
    top:[{p:byId(found.pid),score:Math.min(original.score,found.similarity)}],source:'repeat',
    repeatTrusted,manualOnly:!repeatTrusted};
  track.result=result;track.matchPid=found.pid;track.hits=2;
  track.lastFingerprint=signature;
  // A weaker manually confirmed view can suggest a repeat, but cannot charge it.
  if(result.repeatTrusted&&$('autoAdd').checked&&
    RetailScan.canAutoAdd(result,track.hits,$('thr').value/100,$('mar').value/100))addTrack(track);
  renderCandidates(true);drawBoxes();
  return true;
}
function setState(t){$('stateC').textContent=t;$('stateE').textContent=t;}
function analyse(frame){return counter.baseline?RetailScan.detect(frame,counter.baseline,counter.prev,SW,SH):{fraction:0,boxes:[]};}
const overlayMaps=new Map();
function drawBoxes(){
  for(const id of ['bboxC','bboxE']){
    const root=$(id),nodes=overlayMaps.get(id)||new Map();overlayMaps.set(id,nodes);
    const video=$(id==='bboxC'?'vidC':'vidE'),width=root.parentElement.clientWidth,height=root.parentElement.clientHeight;
    if(video.videoWidth&&video.videoHeight&&width&&height){
      const scale=Math.min(width/video.videoWidth,height/video.videoHeight);
      const shownWidth=video.videoWidth*scale,shownHeight=video.videoHeight*scale;
      root.style.inset='auto';root.style.left=`${(width-shownWidth)/2}px`;root.style.top=`${(height-shownHeight)/2}px`;
      root.style.width=`${shownWidth}px`;root.style.height=`${shownHeight}px`;
    }
    const visible=tracker.tracks.filter(t=>t.visible&&!t.blocked&&(t.counted||t.result?.level==='ok'&&t.hits>=2)),ids=new Set(visible.map(t=>t.id));
    for(const [key,node] of nodes)if(!ids.has(key)){node.remove();nodes.delete(key);}
    for(const t of visible){
      let node=nodes.get(t.id);if(!node){node=document.createElement('div');node.className='object-box';node.append(document.createElement('span'));root.append(node);nodes.set(t.id,node);}
      const r=t.result,p=byId(r?.pid),b=t.focusBBox||t.bbox;
      node.style.left=`${b.x0*100}%`;node.style.top=`${b.y0*100}%`;node.style.width=`${(b.x1-b.x0)*100}%`;node.style.height=`${(b.y1-b.y0)*100}%`;
      node.firstChild.style.transform=b.y0<.15?'none':'translateY(-100%)';
      node.firstChild.style.left=b.x0>.85?'auto':'-2px';node.firstChild.style.right=b.x0>.85?'-2px':'auto';
      node.dataset.state=t.counted?'added':r?.manualOnly?'maybe':'ok';
      node.firstChild.textContent=t.counted?`${p?.name||'Item'} · added`:
        `${p?.name||'Inventory match'} · ${Math.round(Math.max(0,r.score)*100)}% match${r?.manualOnly?' · confirm':''}`;
    }
  }
  $('visibleStat').textContent=`${tracker.tracks.filter(t=>t.visible&&!t.blocked&&(t.counted||t.result?.level==='ok'&&t.hits>=2)).length} inventory matches`;
}
function canScan(){return counter.stream&&counter.baseline&&counter.backgroundBank.length&&!counter.paused&&!counter.calibrating&&!checkoutBusy&&!$('payDlg').open&&inventoryReady&&!document.hidden;}
function tick(){
  const v=$('vidC');if(!counter.stream||!v.videoWidth||document.hidden||counter.calibrating)return;
  if(!counter.baseline){setState('Clear the counter → Set empty counter');return;}
  const g=grab(v),a=analyse(g),now=performance.now();counter.prev=g;
  requestObjectBoxes(v,now);
  const objects=detectorResult&&now-detectorResult.at<3500?detectorResult.boxes:null;
  const coarseMerge=a.boxes.some(d=>{
    const inside=tracker.tracks.filter(t=>RetailScan.iou(d.bbox,t.bbox)>.04||
      (d.bbox.x0<=t.bbox.x0&&d.bbox.y0<=t.bbox.y0&&d.bbox.x1>=t.bbox.x1&&d.bbox.y1>=t.bbox.y1));
    return inside.length>1||inside.some(t=>t.result?.level==='ok'&&
      RetailScan.area(d.bbox)>RetailScan.area(t.bbox)*3);
  });
  if(objects?.length||coarseMerge){
    const prior=tracker.tracks.map(t=>({...t,present:RetailScan.foregroundShare(g,counter.baseline,t.bbox,SW,SH)>.18}));
    a.boxes=RetailScan.fuseProposals(a.boxes,objects||[],8,prior,a.parts||[]);
  }
  tracker.update(a.boxes,now,{emptyView:!a.boxes.length&&a.fraction<.015});
  counter.lastBBox=a.boxes.length===1?a.boxes[0].bbox:null;
  drawBoxes();renderCandidates();$('rescanBtn').disabled=!tracker.tracks.some(t=>t.visible&&!t.counted);
  if(a.boxes.length>8){setState('Up to 8 separated items · scan the rest next');return;}
  if(!canScan()){if(counter.baseline&&!counter.backgroundBank.length)setState('Preparing empty-counter reference…');return;}
  if(!a.boxes.length){setState('Ready · place separated items');return;}
  if(!bank.length){setState('Preparing inventory photos · train products without photos');return;}
  if(!modelReady){setState('Preparing recognition model…');return;}
  if(!counter.busy&&now>=retryAfter){
    const ready=tracker.ready(now).filter(t=>!t.result||t.result.level!=='ok'||t.hits<2);
    const needsModel=ready.filter(t=>!tryRecentRepeat(t,now));
    if(needsModel.length){
      if(!batchWaitingSince)batchWaitingSince=now;
      const pending=tracker.tracks.some(t=>t.visible&&!t.counted&&!t.blocked&&
        now-t.stableSince<tracker.settleMs&&now-t.stableSince>=0);
      if(!pending||now-batchWaitingSince>=160){
        batchWaitingSince=0;
        void recogniseTracks(needsModel.slice(0,modelBackend==='GPU'?4:2));
      }
    }else batchWaitingSince=0;
  }
  if(!counter.busy)setState(tracker.tracks.some(t=>t.blocked)?'Objects overlap · keep items visible and retry':tracker.tracks.some(t=>t.visible&&t.hits>=2&&t.result?.level==='ok'&&!t.counted)?'Inventory match ready · tap Add below':tracker.tracks.filter(t=>t.visible).every(t=>t.counted)?'Items added · remove before the next batch':'Checking view against inventory photos…');
}
async function recogniseTracks(tracks){
  counter.busy=true;const revision=inventoryRevision,referenceEpoch=counter.referenceEpoch;
  const jobs=tracks.map(t=>{t.busy=true;return {token:tracker.token(t),regions:focusRegions(t.bbox)};});
  setState(`Matching ${jobs.length} ${jobs.length===1?'item':'items'}…`);
  try{
    // Run the full object crop first; only search smaller regions when it fails.
    const primary=jobs.map(j=>cropSquare($('vidC'),j.regions[0],1.08));
    const vectors=await embedBatch(primary);recognitionFailures=0;
    if(revision!==inventoryRevision||referenceEpoch!==counter.referenceEpoch||!canScan())return;
    const threshold=$('thr').value/100,margin=$('mar').value/100;
    const picks=jobs.map((job,i)=>RetailScan.selectInventoryMatch([{bbox:job.regions[0],top:match(vectors[i])}],
      [Math.max(...counter.backgroundBank.map(bg=>dot(vectors[i],bg)))],threshold,margin));
    // Rotating only failed crops keeps upright multi-item scans to one batch.
    // A 180-degree retry handles upside-down labels; sideways views are last.
    for(const degrees of [180,90,270]){
      const indices=jobs.map((_,i)=>i).filter(i=>!picks[i]);
      if(!indices.length)break;
      for(let start=0;start<indices.length;start+=(modelBackend==='GPU'?4:2)){
        const ids=indices.slice(start,start+(modelBackend==='GPU'?4:2));
        const rotated=ids.map(i=>rotateCrop(primary[i],degrees));
        const outputs=await embedBatch(rotated);
        if(revision!==inventoryRevision||referenceEpoch!==counter.referenceEpoch||!canScan())return;
        for(let k=0;k<ids.length;k++){
          const i=ids[k],q=outputs[k];
          const choice=RetailScan.selectInventoryMatch([{bbox:jobs[i].regions[0],top:match(q)}],
            [Math.max(...counter.backgroundBank.map(bg=>dot(q,bg)))],threshold,margin);
          if(choice)picks[i]={...choice,orientation:degrees};
        }
      }
    }
    const search=[];
    for(let i=0;i<jobs.length;i++)if(!picks[i]&&jobs[i].regions.length>1)
      for(const bbox of jobs[i].regions.slice(1))search.push({i,bbox,crop:cropSquare($('vidC'),bbox,1.05)});
    if(search.length){
      const extra=[];
      for(let i=0;i<search.length;i+=modelBackend==='GPU'?8:2)
        extra.push(...await embedBatch(search.slice(i,i+(modelBackend==='GPU'?8:2)).map(s=>s.crop)));
      if(revision!==inventoryRevision||referenceEpoch!==counter.referenceEpoch||!canScan())return;
      for(let i=0;i<search.length;i++){
        const q=extra[i],candidate=RetailScan.selectInventoryMatch([{bbox:search[i].bbox,top:match(q)}],
          [Math.max(...counter.backgroundBank.map(bg=>dot(q,bg)))],threshold,margin);
        if(candidate&&(!picks[search[i].i]||candidate.rank>picks[search[i].i].rank))picks[search[i].i]=candidate;
      }
    }
    // Start all ambiguous label checks together. A slow OCR worker has a
    // shared 1.7-second budget, rather than multiplying delay by item count.
    const evidence=await Promise.all(jobs.map(async(job,i)=>{
      const result=picks[i];if(!result||result.level!=='ok'||result.score>=.94)return null;
      const p=byId(result.pid),last=tracker.tracks.find(t=>t.id===job.token.id);
      const previous=last?.ocrRevision===job.token.revision&&last.ocrPid===result.pid?last.ocrStatus:null;
      if(previous)return previous;
      let observed='unreadable';
      if(p&&/[a-zA-Z]{4}/.test(p.name)){
        const image=result.orientation?rotateCrop(primary[i],result.orientation):primary[i];
        try{
          const label=await Promise.race([readLabel(image),
            new Promise((_,reject)=>setTimeout(()=>reject(new Error('Text check timed out')),1700))]);
          observed=RetailScan.textEvidence(label,p.name,products.map(product=>product.name));
        }catch{ /* An unavailable OCR model never approves an automatic sale. */ }
      }
      if(last){last.ocrRevision=job.token.revision;last.ocrPid=result.pid;last.ocrStatus=observed;}
      return observed;
    }));
    for(let i=0;i<jobs.length;i++){
      const picked=picks[i],result=picked?{...picked}:{pid:null,score:0,top:[],level:'none'};
      if(evidence[i]&&evidence[i]!=='verified')result.manualOnly=true;
      const verified=tracker.resolve(jobs[i].token,performance.now());
      const t=verified||tracker.resolveCandidate(jobs[i].token,performance.now());
      if(!t)continue;
      if(!verified){t.hits=0;t.matchPid=null;t.result=null;}
      const stable=tracker.accept(t,result,performance.now());
      t.lastFingerprint=result.level==='ok'?viewFingerprint(
        result.bbox===jobs[i].regions[0]?primary[i]:cropSquare($('vidC'),result.bbox,1.08)):null;
      t.focusBBox=result.level==='ok'?result.bbox:null;
      // Keep tracking the matched product crop, rather than the broad hand or
      // shadow region from which that crop was found.
      if(result.level==='ok'&&result.bbox&&RetailScan.area(result.bbox)<RetailScan.area(t.bbox)*.85)
        t.bbox=result.bbox;
      if(stable&&$('autoAdd').checked&&RetailScan.canAutoAdd(result,t.hits,threshold,margin))addTrack(t);
    }
  }catch(error){
    recognitionFailures++;retryAfter=performance.now()+Math.min(15000,1000*2**recognitionFailures);
    setState('Recognition unavailable');$('cameraHelp').textContent=error.message;
  }finally{for(const job of jobs){const t=tracker.tracks.find(t=>t.id===job.token.id);if(t)t.busy=false;}counter.busy=false;drawBoxes();renderCandidates(true);}
}
function addTrack(t,pid=t.result?.pid){
  if(t.counted||!t.visible||t.blocked||checkoutBusy||$('payDlg').open||!inventoryReady)return false;
  if(!addToCart(pid))return false;
  if(t.lastFingerprint&&pid===t.result?.pid)
    repeatCache.remember(pid,t.lastFingerprint,t.bbox,t.result,performance.now(),counter.referenceEpoch);
  t.counted=true;t.result={...t.result,pid,level:'ok'};drawBoxes();renderCandidates(true);return true;
}
let candidatesKey='';
function renderCandidates(force=false){
  const visible=tracker.tracks.filter(t=>t.visible&&!t.blocked&&!t.counted&&t.result?.level==='ok'&&t.hits>=2);
  const key=visible.map(t=>`${t.id}:${t.result?.pid}:${t.result?.level}:${t.hits}`).join('|')+inventoryReady;
  if(!force&&key===candidatesKey)return;candidatesKey=key;
  const box=$('candBox'),quick=$('quickAdds');box.replaceChildren();quick.replaceChildren();
  $('addVisibleBtn').disabled=!inventoryReady||!visible.some(t=>t.result?.level==='ok');
  for(const t of visible){
    if(!t.result)continue;const r=t.result;
    const product=byId(r.pid);
    if(product){
      const button=document.createElement('button');button.type='button';
      button.textContent=`Add ${product.name} · ${Math.round(r.score*100)}% match`;
      button.onclick=()=>{if(!addTrack(t))toast('Could not add this item. Check stock and keep the product in view.');};
      quick.append(button);
    }
    const wrap=document.createElement('div');wrap.className='cand '+r.level;
    const title=document.createElement('div');title.className='t';title.textContent=`Item ${t.id} · ${r.manualOnly?'Confirm product':r.level==='ok'?'Match ready':r.level==='maybe'?'Confirm product':'Unknown item'}`;wrap.append(title);
    for(const m of r.top){
      const b=document.createElement('button');b.className='opt';const name=document.createElement('span');name.className='n';name.textContent=m.p.name;
      const score=document.createElement('span');score.className='pct';score.textContent=`${Math.round(Math.max(0,m.score)*100)}% · Add`;
      b.append(name,score);b.disabled=!inventoryReady;b.onclick=()=>addTrack(t,m.p.id);wrap.append(b);
    }
    if(r.level!=='ok'){
      const select=document.createElement('select');select.setAttribute('aria-label',`Select inventory product for item ${t.id}`);
      select.add(new Option('Choose from inventory…',''));for(const p of products)select.add(new Option(p.name,p.id));
      const add=document.createElement('button');add.className='btn ghost';add.textContent='Add selected';add.onclick=()=>select.value&&addTrack(t,select.value);wrap.append(select,add);
    }
    box.append(wrap);
  }
  if(visible.length){
    const note=document.createElement('small');
    note.textContent='Review the product name before tapping Add. Lower-scoring matches require this confirmation.';
    quick.append(note);
  }
}
async function calibrate(){
  if(!counter.stream||counter.calibrating)return;
  if(tracker.tracks.some(t=>t.visible)&&!confirm('Remove every item from the counter first. Is the camera view now empty?'))return;
  counter.calibrating=true;counter.backgroundBank=[];detectorResult=null;const epoch=++counter.referenceEpoch;
  repeatCache.clear();batchWaitingSince=0;
  tracker.reset();drawBoxes();renderCandidates(true);$('calBtn').disabled=true;
  setState('Capturing empty counter…');
  try{
    const samples=[];for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,65));if(!counter.stream)return;samples.push(grab($('vidC')));}
    counter.baseline=new Uint8ClampedArray(samples[0].length);
    for(let i=0;i<counter.baseline.length;i++)counter.baseline[i]=samples.map(s=>s[i]).sort((a,b)=>a-b)[2];
    counter.prev=samples.at(-1);
    // The empty scene is a negative example: a region matching it is background,
    // even if movement segmentation proposed it as an item.
    setState('Learning empty-counter background…');
    const v=$('vidC');
    const referencePhotos=[cropSquare(v,null,1),...[
      {x0:0,y0:0,x1:.5,y1:.5},{x0:.5,y0:0,x1:1,y1:.5},
      {x0:0,y0:.5,x1:.5,y1:1},{x0:.5,y0:.5,x1:1,y1:1},
    ].map(box=>cropSquare(v,box,1.05))];
    const refs=[];
    for(let i=0;i<referencePhotos.length;i+=modelBackend==='GPU'?5:2)
      refs.push(...await embedBatch(referencePhotos.slice(i,i+(modelBackend==='GPU'?5:2))));
    if(epoch!==counter.referenceEpoch||!counter.stream)return;
    counter.backgroundBank=refs;
    setState('Ready · show an inventory product');
    $('cameraHelp').textContent='Only confirmed inventory matches are outlined. Keep the camera fixed and show the product clearly.';
  }catch(error){
    counter.baseline=null;setState('Calibration failed');$('cameraHelp').textContent=error.message||'Could not prepare the empty-counter reference.';
  }finally{counter.calibrating=false;$('calBtn').disabled=!counter.stream;}
}

/* ---------- cart + payment ---------- */
function addToCart(pid) {
  const p = byId(pid), quantity = cart.get(pid) || 0;
  if (!p || !inventoryReady || checkoutBusy || $('payDlg').open) return false;
  if (quantity >= p.quantity) { toast(`Only ${p.quantity} ${p.name} in Firebase stock.`); return false; }
  cart.set(pid, quantity + 1); renderCart(); return true;
}
function cartTotal() { let t = 0; for (const [pid, q] of cart) t += (byId(pid)?.price || 0) * q; return t; }
function renderCart() {
  const box = $('cartLines'); box.replaceChildren();
  if (!cart.size) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Place a product on the counter.'; box.append(e); }
  for (const [pid, q] of cart) {
    const p = byId(pid); if (!p) continue;
    const l = document.createElement('div'); l.className = 'line';
    const im = document.createElement('img'); im.className = 'thumb'; im.src = p.thumb || '';
    const n = document.createElement('div'); n.className = 'n'; const b = document.createElement('b'); b.textContent = p.name; const s = document.createElement('span'); s.className = 'mute'; s.textContent = money(p.price) + ' each'; n.append(b, s);
    const qt = document.createElement('div'); qt.className = 'qty';
    const mi = document.createElement('button'); mi.textContent = '−'; mi.onclick = () => { const v = (cart.get(pid) || 0) - 1; v > 0 ? cart.set(pid, v) : cart.delete(pid); renderCart(); };
    const qs = document.createElement('b'); qs.textContent = q;
    const pl = document.createElement('button'); pl.textContent = '+'; pl.disabled = q >= p.quantity; pl.title = pl.disabled ? 'No more stock available' : 'Add one'; pl.onclick = () => addToCart(pid);
    qt.append(mi, qs, pl);
    const amt = document.createElement('b'); amt.textContent = money(p.price * q); amt.style.minWidth = '64px'; amt.style.textAlign = 'right';
    l.append(im, n, qt, amt); box.append(l);
  }
  $('cartTotal').textContent = money(cartTotal());
  $('payBtn').disabled = !cart.size || !inventoryReady || checkoutBusy;
}
$('clearBtn').onclick = () => { if(checkoutBusy||$('payDlg').open)return; cart.clear(); renderCart(); };
$('addVisibleBtn').onclick=()=>{for(const t of [...tracker.tracks])if(t.result?.level==='ok')addTrack(t);};
$('autoAdd').onchange=()=>{if($('autoAdd').checked)for(const t of [...tracker.tracks])
  if((t.result?.source!=='repeat'||t.result.repeatTrusted)&&
    RetailScan.canAutoAdd(t.result,t.hits,$('thr').value/100,$('mar').value/100))addTrack(t);};
$('payBtn').onclick = () => { $('payTotal').textContent = money(cartTotal()); $('cashIn').value = ''; $('changeV').textContent = '0.00'; $('payMethod').dispatchEvent(new Event('change')); $('payDlg').showModal(); };
$('payMethod').onchange = () => $('cashBox').classList.toggle('hide', $('payMethod').value !== 'Cash');
$('cashIn').oninput = () => { $('changeV').textContent = money(Math.max(0, (+$('cashIn').value || 0) - cartTotal())); };
$('payCancel').onclick = () => $('payDlg').close();
$('payDone').onclick = async () => {
  if(checkoutBusy||!cart.size||!inventoryReady)return;
  const total = cartTotal();
  if ($('payMethod').value === 'Cash' && (+$('cashIn').value || 0) < total) { toast('Cash received is less than the total.'); return; }
  const paymentMethod = ({ Cash: 'cash', Card: 'card', 'Mobile / QR': 'qr' })[$('payMethod').value];
  const items = [...cart].map(([barcode, quantity]) => ({ barcode, quantity }));
  checkoutBusy=true; $('payDone').disabled = true; $('payCancel').disabled=true;
  let sale;
  try {
    ({ sale } = await aiModelRequest('/api/sales', { method: 'POST', body: { items, paymentMethod } }));
    cart.clear(); renderCart(); $('payDlg').close();
    toast(`Sale #${sale.id} saved to Firebase · ${money(sale.totalOriginalPrice)}`);
  } catch (error) {
    toast(error.message || 'Firebase could not save the sale.');
    checkoutBusy=false; $('payDone').disabled = false; $('payCancel').disabled=false;
    return;
  }
  checkoutBusy=false; $('payDone').disabled = false; $('payCancel').disabled=false;
  window.parent.postMessage({type:'retailflow:ai-sale-saved'},location.origin);
  try { await syncFirebaseProducts(); }
  catch { $('firebaseState').textContent = `Sale saved; inventory refresh failed. Tap “Refresh from Firebase”.`; }
};

/* ---------- counter camera controls ---------- */
async function startCounterCam() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    const message = 'Camera access is unavailable here. Open the secure HTTPS site in a current browser.';
    $('cameraHelp').textContent = message; setState('Camera unavailable'); toast(message); return;
  }
  if (document.permissionsPolicy?.allowsFeature?.('camera') === false || document.featurePolicy?.allowsFeature?.('camera') === false) {
    const message = 'This embedded page is blocked from using the camera. Open the camera directly using the link below.';
    $('cameraHelp').textContent = message; setState('Camera blocked in frame'); return;
  }
  $('camBtn').disabled = true;
  $('cameraHelp').textContent = 'Waiting for browser camera permission…'; setState('Requesting camera…');
  try {
    // This call runs directly from the Start-camera button click, so the browser can show its native permission prompt.
    counter.stream = await openCamera($('vidC'), $('camSel').value || null);
    $('vidE').srcObject = counter.stream; $('vidE').play().catch(() => {});
    await listCameras();
    counter.baseline=null;counter.prev=null;counter.backgroundBank=[];counter.referenceEpoch++;tracker.reset();repeatCache.clear();batchWaitingSince=0;
    detectorResult=null;
    for(const video of [$('vidC'),$('vidE')])video.parentElement.style.aspectRatio=`${$('vidC').videoWidth}/${$('vidC').videoHeight}`;
    $('camBtn').textContent = $('camBtnE').textContent = 'Stop camera'; $('calBtn').disabled = false; $('snapBtn').disabled = false;
    setState('Clear counter → Set empty counter');
    $('cameraHelp').textContent = 'Camera is live. Clear the counter, then press Set empty counter. Video stays on this device.';
    clearInterval(counter.timer); counter.timer = setInterval(tick, 70);
    void loadDetector();
    loadModel().then(()=>indexInventoryPhotos()).catch(() => {});
  } catch (e) { const message = cameraErrorMessage(e); $('cameraHelp').textContent = message; setState('Camera could not start'); toast(message); }
  finally { $('camBtn').disabled = false; }
}
function stopCounterCam() {
  clearInterval(counter.timer); counter.stream?.getTracks().forEach(t => t.stop()); counter.stream = null; $('vidC').srcObject = null; $('vidE').srcObject = null;
  $('camBtn').textContent = $('camBtnE').textContent = 'Start camera'; $('calBtn').disabled = true; $('snapBtn').disabled = true; setState('Camera off'); $('cameraHelp').textContent = 'Press Start camera to trigger your browser’s camera permission prompt.'; counter.baseline=null;counter.backgroundBank=[];counter.referenceEpoch++;tracker.reset();repeatCache.clear();batchWaitingSince=0;drawBoxes();renderCandidates(true);
  detectorResult=null;
}
$('camBtn').onclick = () => counter.stream ? stopCounterCam() : startCounterCam();
$('camSel').onchange = () => { if (counter.stream) { stopCounterCam(); startCounterCam(); } };
$('cameraHelp').textContent = 'Camera controls ready. Press Start camera to request access.';
$('calBtn').onclick=calibrate;
$('retryModel').onclick=()=>{
  detectorFailed=false;void loadDetector();
  loadModel().then(()=>indexInventoryPhotos()).catch(error=>toast(error.message));
};
$('rescanBtn').onclick=()=>{for(const t of tracker.tracks)if(!t.counted){t.revision++;t.result=null;t.hits=0;t.lastFingerprint=null;t.nextAt=0;}renderCandidates(true);};
$('thr').oninput = $('mar').oninput = () => {
  $('thrV').textContent=$('thr').value+'%';$('marV').textContent=$('mar').value+'%';
  $('thresholdHelp').textContent=Number($('thr').value)<RetailScan.PROVISIONAL_AUTO_MIN*100
    ?'Manual only below 86%. The 0–100 number is visual similarity, not measured accuracy.'
    :'Auto-add can use this level after two matching scans and background checks. 86% is provisional until tested on your products.';
  renderCandidates(true);
  try{localStorage.setItem('aic-thr',$('thr').value);localStorage.setItem('aic-mar',$('mar').value);}catch{}
};

/* ---------- enrolment ---------- */
const enrol = { samples: [], editId: null };
function updateSelectedProduct() {
  const p = byId($('pProduct').value);
  $('selectedProductInfo').textContent = p
    ? `${p.barcode} · ${p.quantity} in stock · ${p.price > 0 ? money(p.price) : 'Set selling price in Finance'} · ${p.category || 'No category'}`
    : 'Product name, barcode, price, stock, and photo come from Firebase Inventory.';
  $('usePhotoBtn').disabled = !p?.photoDataUrl;
  $('saveProd').disabled = !(p && enrol.samples.length);
}
async function aiModelRequest(path, { method = 'GET', body } = {}) {
  if(MOCK&&method!=='GET')throw new Error('Test mode cannot write to Firebase.');
  const response = await fetch(path, {
    cache:'no-store',
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let result = {};
  try { result = await response.json(); } catch { /* use the generic response below */ }
  if (!response.ok) throw new Error(result.error || `AI model request failed (${response.status}).`);
  return result;
}
async function persistAiSamples(product, samples) {
  if (MODEL_TAG !== 'Xenova/dinov2-small') throw new Error('Test mode samples are not saved to Firebase.');
  if (samples.length > 32) throw new Error('This product has reached the 32 sample limit. Clear training first.');
  const [{ firebaseApp }, { doc, getFirestore, runTransaction }] = await Promise.all([
    import('./firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js'),
  ]);
  const db=getFirestore(firebaseApp),ref=doc(db,'products',product.firebaseDocId);
  await runTransaction(db,async transaction=>{
    const current=await transaction.get(ref);
    if(!current.exists()||String(current.data().barcode||current.id)!==product.barcode)
      throw new Error('This inventory product changed. Refresh and try again.');
    transaction.update(ref,{aiCameraSamples:{model:MODEL_TAG,samples:samples.map(b64)}});
  });
  inventoryRevision++;
  product.samples = samples; product.model = MODEL_TAG;
  await DB.put('products', product).catch(()=>{}); rebuildBank(); renderList();
}
async function loadAiModels(barcodes) {
  const found = new Map();
  for (let start = 0; start < barcodes.length; start += 25) {
    const query = new URLSearchParams();
    for (const barcode of barcodes.slice(start, start + 25)) query.append('barcode', barcode);
    const response = await aiModelRequest(`/api/ai-models?${query}`);
    for (const model of response.models || []) found.set(String(model.barcode), model);
  }
  return found;
}
function photoSetKey(photos){
  let h=2166136261;
  for(const photo of photos)for(let i=0;i<photo.length;i++){h=Math.imul(h^photo.charCodeAt(i),16777619);}
  return `views-v1-${(h>>>0).toString(16)}`;
}
async function readTrainingInventory(){
  // The generic /api/inventory route is not guaranteed to be deployed by Vercel.
  // Read the same product documents the scanner writes, including their six views.
  const [{ firebaseApp }, { collection, getDocs, getFirestore }] = await Promise.all([
    import('./firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js'),
  ]);
  const snapshot = await getDocs(collection(getFirestore(firebaseApp), 'products'));
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}
async function storeInventoryReferences(product,key,embeddings){
  const [{ firebaseApp }, { doc, getFirestore, runTransaction }] = await Promise.all([
    import('./firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js'),
  ]);
  const ref=doc(getFirestore(firebaseApp),'products',product.firebaseDocId);
  await runTransaction(getFirestore(firebaseApp),async transaction=>{
    const current=await transaction.get(ref);
    const views=current.data()?.trainingPhotos;
    if(!current.exists() || views?.length!==6 || !views.every(Boolean) || photoSetKey(views)!==key)throw new Error('Product photos changed while preparing AI references. Refresh inventory.');
    transaction.update(ref,{aiReference:{model:MODEL_TAG,sourceKey:key,photoSamples:embeddings.map(b64)}});
  });
}
const cloudUploadAttempts=new Set();
function saveTrainingToCloud(product,key,embeddings){
  const uploadKey=`${product.id}:${key}`;
  if(cloudUploadAttempts.has(uploadKey))return;
  cloudUploadAttempts.add(uploadKey);
  const modelSave=aiModelRequest('/api/ai-models',{method:'PUT',body:{
    barcode:product.barcode,model:MODEL_TAG,kind:'inventoryViews',
    photoSamples:embeddings.map(b64),sourceKey:key,
  }});
  // A direct product reference also works if the Vercel AI-model route is absent.
  void Promise.allSettled([storeInventoryReferences(product,key,embeddings),modelSave]).then(([inventorySave,apiSave])=>{
    if(inventorySave.status==='fulfilled'||apiSave.status==='fulfilled'){
      if(product.sourceKey===key)product.cloudSourceKey=key;
      if(inventorySave.status==='fulfilled')$('firebaseState').textContent=`${product.name} ready · six views saved with Firebase inventory`;
    }else{
      console.warn('Firebase AI reference saves failed:',inventorySave.reason,apiSave.reason);
      $('firebaseState').textContent=`${product.name} ready on this device; Firebase save failed: ${inventorySave.reason?.message||apiSave.reason?.message}`;
    }
  });
}
async function indexTrainingViews(product){
  const photos=product.trainingPhotos;
  if(photos?.length!==6 || photos.some(p=>!p))return;
  const key=photoSetKey(photos);
  if(product.sourceKey===key && product.trainingSamples?.length===6){
    if(product.cloudSourceKey!==key)saveTrainingToCloud(product,key,product.trainingSamples);
    return;
  }
  const canvases=await Promise.all(photos.map(async src=>{
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Training image unreadable'));image.src=src;});
    const canvas=document.createElement('canvas');canvas.width=canvas.height=224;
    const context=canvas.getContext('2d');context.fillStyle='#f3f4f6';context.fillRect(0,0,224,224);
    const scale=224/Math.max(image.naturalWidth,image.naturalHeight);
    context.drawImage(image,(224-image.naturalWidth*scale)/2,(224-image.naturalHeight*scale)/2,image.naturalWidth*scale,image.naturalHeight*scale);
    return canvas;
  }));
  const embeddings=[];
  // WebGPU can process all six together; keep CPU batches small on low-memory devices.
  const batchSize=modelBackend==='GPU'?6:2;
  for(let start=0;start<canvases.length;start+=batchSize){
    // A product's main photo is already usable. Do not queue six background
    // embeddings ahead of a live batch of products awaiting checkout.
    while(counter.busy||checkoutBusy||(counter.stream&&(product.photoSample||product.samples.length)
      &&tracker.tracks.some(t=>t.visible&&!t.counted))){
      if(indexRequested||!products.includes(product))return;
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    if(indexRequested||!products.includes(product))return;
    $('firebaseState').textContent=`Preparing ${product.name}: views ${start+1}–${Math.min(start+batchSize,6)} of 6…`;
    const vectors=await embedBatch(canvases.slice(start,start+batchSize));
    embeddings.push(...vectors.map(vector=>vector.buffer.slice(0)));
  }
  if(embeddings.length!==6)throw new Error('Could not prepare all six product views.');
  if(!products.includes(product))return;
  product.trainingSamples=embeddings;product.sourceKey=key;
  await DB.put('products',product).catch(error=>console.warn('Local training cache unavailable:',error));
  rebuildBank();renderList();
  $('firebaseState').textContent=`${product.name} ready for recognition · six product views indexed`;
  if(!MOCK)saveTrainingToCloud(product,key,embeddings);
}
let syncPromise=null, indexingPromise=null, indexRequested=false, inventoryListener=null;
let lastInventorySignature='', queuedSync=false, listenerTimer=null;
function inventorySignature(rows){
  return JSON.stringify(rows.map(row=>({
    id:row.id,barcode:row.barcode,name:row.name,quantity:row.quantity,
    price:row.originalPrice??row.price,category:row.category,
    photo:row.photoDataUrl?photoSetKey([row.photoDataUrl]):'',
    photos:Array.isArray(row.trainingPhotos)?photoSetKey(row.trainingPhotos):'',
  })).sort((a,b)=>String(a.id).localeCompare(String(b.id))));
}
async function watchInventory(){
  if(inventoryListener)return;
  const [{firebaseApp},{collection,getFirestore,onSnapshot}]=await Promise.all([
    import('./firebase-app.js'),import('https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js'),
  ]);
  inventoryListener=onSnapshot(collection(getFirestore(firebaseApp),'products'),snapshot=>{
    const signature=inventorySignature(snapshot.docs.map(doc=>({...doc.data(),id:doc.id})));
    if(signature===lastInventorySignature)return;
    clearTimeout(listenerTimer);
    listenerTimer=setTimeout(()=>{
      if(syncPromise){queuedSync=true;return;}
      syncFirebaseProducts().catch(error=>console.warn('Inventory listener refresh failed:',error));
    },250);
  },error=>{
    $('firebaseState').textContent=`Inventory updates unavailable: ${error.message}. Use Refresh from Firebase.`;
  });
}
async function indexPrimaryPhoto(product){
  const photo=product.photoDataUrl||product.trainingPhotos?.[0];
  if(!photo||product.photoSample||product.samples.length||product.trainingSamples?.length||!products.includes(product))return;
  while(counter.busy||checkoutBusy)await new Promise(resolve=>setTimeout(resolve,150));
  const image=new Image();image.crossOrigin='anonymous';
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Product photo timed out')),10000);
    image.onload=()=>{clearTimeout(timer);resolve();};
    image.onerror=()=>{clearTimeout(timer);reject(new Error('Product photo unavailable'));};
    image.src=photo;
  });
  const canvas=document.createElement('canvas');canvas.width=canvas.height=224;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#f3f4f6';ctx.fillRect(0,0,224,224);
  const scale=224/Math.max(image.naturalWidth,image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  ctx.drawImage(image,(224-w)/2,(224-h)/2,w,h);
  const q=await embed(canvas);if(!products.includes(product))return;
  product.photoSample=q.buffer.slice(0);
  await DB.put('products',product).catch(()=>{});
  rebuildBank();renderList();
  $('firebaseState').textContent=`${product.name} ready from inventory photo · preparing six views in background`;
  if(!product.samples.length){
    try{await persistAiSamples(product,[q.buffer.slice(0)]);}
    catch(error){$('firebaseState').textContent=`Photo ready here; Firebase reference save failed: ${error.message}`;console.warn('Photo save failed:',error);}
  }
}
async function indexInventoryPhotos(){
  if(indexingPromise){indexRequested=true;return indexingPromise;}
  indexingPromise=(async()=>{
    if(!modelReady||!inventoryReady)return;
    let failed=0;
    for(const product of [...products].sort((a,b)=>Number(!!a.trainingSamples?.length)-Number(!!b.trainingSamples?.length))){
      if(indexRequested||!products.includes(product))break;
      try{await indexPrimaryPhoto(product);}
      catch(error){failed++;console.warn('Primary inventory photo could not be indexed:',product.barcode,error);}
      if(indexRequested||!products.includes(product))break;
      if(product.trainingPhotos?.length===6 && product.trainingPhotos.every(Boolean)){
        try{await indexTrainingViews(product);}catch(error){failed++;console.warn('Six-view training failed:',product.barcode,error.message);$('firebaseState').textContent=`Six-view training failed: ${error.message}`;}
      }
      await new Promise(r=>setTimeout(r,0));
    }
    if(failed)$('firebaseState').textContent=`Inventory connected · ${failed} photos need camera training. Open Firebase Products to train them.`;
  })().finally(()=>{
    const repeat=indexRequested;indexRequested=false;indexingPromise=null;
    if(repeat)void indexInventoryPhotos();
  });
  return indexingPromise;
}
function syncFirebaseProducts(){
  if(syncPromise){queuedSync=true;return syncPromise;}
  syncPromise=(async()=>{
    $('firebaseState').textContent='Loading Firebase inventory…';$('syncProducts').disabled=true;
    try{
      // Start the model download while Firestore and the local cache are loading.
      const warmup=loadModel().catch(()=>null);
      const [inventory,saved]=await Promise.all([readTrainingInventory(),DB.all('products').catch(()=>[])]);
      const signature=inventorySignature(inventory);
      const existing=new Map(saved.map(p=>[String(p.id),p]));
      const rows=inventory.filter(row=>row&&(row.barcode||row.id));
      let cloudModels=new Map(),modelsUnavailable='';
      try{cloudModels=await loadAiModels(rows.map(row=>String(row.barcode||row.id)));}
      catch(error){modelsUnavailable=' · Using inventory photo references';}
      const next=rows.map(row=>{
        const barcode=String(row.barcode||row.id),old=existing.get(barcode),remote=cloudModels.get(barcode);
        const validSamples=value=>Array.isArray(value)?value.filter(buf=>buf?.byteLength===1536):[];
        const direct=row.aiCameraSamples?.model===MODEL_TAG&&Array.isArray(row.aiCameraSamples.samples)?row.aiCameraSamples.samples:null;
        const samples=direct?direct.map(unb64).filter(buf=>buf.byteLength===1536)
          :remote?.model===MODEL_TAG&&Array.isArray(remote.samples)?remote.samples.map(unb64).filter(buf=>buf.byteLength===1536)
          :modelsUnavailable?validSamples(old?.model===MODEL_TAG?old.samples:[]):[];
        const views=Array.isArray(row.trainingPhotos)?row.trainingPhotos:[];
        const key=views.length===6&&views.every(Boolean)?photoSetKey(views):'';
        const reference=remote?.model===MODEL_TAG&&remote.sourceKey===key&&Array.isArray(remote.photoSamples)
          ?remote:row.aiReference?.model===MODEL_TAG&&row.aiReference.sourceKey===key?row.aiReference:null;
        const cloudViews=Array.isArray(reference?.photoSamples)?reference.photoSamples.map(unb64).filter(buf=>buf.byteLength===1536):[];
        const localViews=old?.model===MODEL_TAG&&old.sourceKey===key?validSamples(old.trainingSamples):[];
        const trainingSamples=cloudViews.length===6?cloudViews:localViews.length===6?localViews:[];
        return {id:barcode,barcode,name:String(row.name||barcode),sku:barcode,price:Number(row.originalPrice??row.price)||0,
          quantity:Math.max(0,Number(row.quantity)||0),category:String(row.category||''),photoDataUrl:row.photoDataUrl||'',
          thumb:row.photoDataUrl||'',model:MODEL_TAG,samples,trainingSamples,sourceKey:trainingSamples.length===6?key:'',
          cloudSourceKey:cloudViews.length===6?key:'',trainingPhotos:views,firebaseDocId:String(row.id),
          photoSample:old?.model===MODEL_TAG&&old.photoDataUrl===row.photoDataUrl?old.photoSample:null};
      });
      products=next;inventoryReady=true;
      if(signature!==lastInventorySignature){
        inventoryRevision++;repeatCache.clear();batchWaitingSince=0;
        for(const t of tracker.tracks)if(!t.counted){t.revision++;t.result=null;t.hits=0;t.lastFingerprint=null;t.nextAt=0;}
      }
      lastInventorySignature=signature;
      for(const barcode of [...cart.keys()]){
        const p=byId(barcode);if(!p||!p.quantity)cart.delete(barcode);else if(cart.get(barcode)>p.quantity)cart.set(barcode,p.quantity);
      }
      await DB.replaceProducts(next).catch(error=>console.warn('Local training cache unavailable:',error));
      rebuildBank();renderProductSelect();renderList();renderCart();renderCandidates(true);updateSelectedProduct();
      $('firebaseState').textContent=`Firebase connected · ${next.length} inventory products${modelsUnavailable}`;
      // Current photos automatically become recognition references; embeddings are cached locally.
      void warmup.then(ready=>ready&&indexInventoryPhotos()).catch(()=>{});
      void watchInventory().catch(error=>console.warn('Real-time inventory unavailable:',error));
    }catch(error){inventoryReady=false;$('firebaseState').textContent=`Inventory unavailable: ${error.message}`;renderCart();renderCandidates(true);throw error;}
    finally{$('syncProducts').disabled=false;}
  })().finally(()=>{
    syncPromise=null;
    if(queuedSync){queuedSync=false;void syncFirebaseProducts().catch(()=>{});}
  });
  return syncPromise;
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.data?.type !== 'retailflow:refresh-inventory') return;
  syncFirebaseProducts().catch(error => toast(error.message));
});
function renderProductSelect() {
  const select = $('pProduct'), previous = select.value || enrol.editId || '';
  select.replaceChildren(new Option(products.length ? 'Choose an inventory product…' : 'No Firebase products found', ''));
  for (const p of [...products].sort((a, b) => a.name.localeCompare(b.name))) {
    select.add(new Option(`${p.name} · ${p.barcode}`, p.id));
  }
  select.value = products.some(p => p.id === previous) ? previous : '';
}
function renderSamples() {
  const r = $('samplesRow'); r.replaceChildren();
  enrol.samples.forEach((s, i) => { const im = document.createElement('img'); im.src = s.thumb; im.title = 'Click to remove'; im.style.cursor = 'pointer'; im.onclick = () => { enrol.samples.splice(i, 1); renderSamples(); }; r.append(im); });
  const n = enrol.samples.length;
  $('snapHint').textContent = n ? n + ' extra camera sample' + (n > 1 ? 's' : '') + ' ready' + (n < 6 ? ' — capture more angles for better accuracy.' : '.') : 'Scanner photos from six angles are prepared automatically. Capture extra camera samples here if needed.';
  updateSelectedProduct();
}
$('pProduct').onchange = () => { enrol.samples = []; enrol.editId = $('pProduct').value || null; $('enrolTitle').textContent = byId(enrol.editId)?.name ? 'Optional extra views: ' + byId(enrol.editId).name : 'Optional camera examples'; renderSamples(); };
$('syncProducts').onclick = () => syncFirebaseProducts().catch(error => toast(error.message));
$('camBtnE').onclick = () => $('camBtn').click();
$('snapBtn').onclick = async () => {
  const p = byId($('pProduct').value);
  if (!p) { toast('Select an onboarded Firebase product first.'); return; }
  if (p.samples.length + enrol.samples.length >= 32) { toast('This product has reached the 32 sample limit.'); return; }
  $('snapBtn').disabled = true;
  try {
    // Same pipeline as the live counter: if an item is on the (calibrated) counter, crop to it.
    let bbox = null;
    if (counter.baseline) { const a = analyse(grab($('vidE'))); if(a.boxes.length===1)bbox=a.boxes[0].bbox;else if(a.boxes.length>1)throw new Error('Train one product at a time; remove other items.'); }
    if (!bbox) toast('Tip: place the product on the empty counter so it is cropped exactly like at checkout.');
    const crop = cropSquare($('vidE'), bbox), q = await embed(crop);
    enrol.samples.push({ q, thumb: crop.toDataURL('image/jpeg', .7) }); renderSamples();
  } catch (e) { console.error(e); toast(e.message||'Capture failed.'); }
  $('snapBtn').disabled = !counter.stream;
};
$('resetEnrol').onclick = resetEnrol;
function resetEnrol() { enrol.samples = []; enrol.editId = $('pProduct').value || null; $('enrolTitle').textContent = byId(enrol.editId) ? 'Optional extra views: ' + byId(enrol.editId).name : 'Optional camera examples'; renderSamples(); }
$('usePhotoBtn').onclick = async () => {
  const p = byId($('pProduct').value);
  if (!p?.photoDataUrl) return;
  if (p.samples.length + enrol.samples.length >= 32) { toast('This product has reached the 32 sample limit.'); return; }
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = p.photoDataUrl; });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 224;
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    canvas.getContext('2d').drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 224, 224);
    const q = await embed(canvas); enrol.samples.push({ q, thumb: canvas.toDataURL('image/jpeg', .7) }); renderSamples();
  } catch (error) { console.error(error); toast('Could not use the Firebase product photo.'); }
};
$('saveProd').onclick = async () => {
  const p = byId($('pProduct').value);
  if (!p || !enrol.samples.length) return;
  $('saveProd').disabled = true;
  try {
    await persistAiSamples(p, [...p.samples, ...enrol.samples.map(s => s.q.buffer.slice(0))]);
    toast('AI samples saved to Firebase for ' + p.name); resetEnrol();
  } catch (error) { toast(error.message || 'Firebase could not save AI samples.'); }
  finally { updateSelectedProduct(); }
};
function renderList() {
  const q = $('pSearch').value.trim().toLowerCase(), box = $('pList'); box.replaceChildren();
  const list = products.filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = products.length ? 'No match.' : 'No Firebase inventory products found. Add products in RetailFlow Inventory, then refresh.'; box.append(e); }
  for (const p of list.slice(0, 300)) {
    const r = document.createElement('div'); r.className = 'prow';
    const im = document.createElement('img'); im.className = 'thumb'; im.src = p.thumb || '';
    const n = document.createElement('div'); n.className = 'n'; const b = document.createElement('b'); b.textContent = p.name; const s = document.createElement('span'); s.className = 'mute'; s.textContent = `${money(p.price)} · ${p.quantity} in stock · ${p.samples.length} camera samples${p.trainingSamples?.length===6?' · Six views ready':p.photoSample?' · Photo ready':p.trainingPhotos?.length===6?' · Six views preparing':p.photoDataUrl?' · Photo preparing':' · Needs training'}${p.category ? ' · ' + p.category : ''}`; n.append(b, s);
    const del = document.createElement('button'); del.className = 'btn ghost'; del.textContent = 'Clear extra camera examples'; del.disabled = !p.samples.length; del.onclick = async () => {
      try {
        await persistAiSamples(p,[]);
        toast('Extra camera examples removed from Firebase inventory.');
      } catch (error) { toast(error.message || 'Could not clear Firebase training.'); }
    };
    r.append(im,n);if(p.samples.length)r.append(del);box.append(r);
  }
  if (list.length > 300) { const m = document.createElement('div'); m.className = 'mute'; m.style.padding = '8px'; m.textContent = `Showing 300 of ${list.length}. Use search.`; box.append(m); }
}
$('pSearch').oninput = renderList;

/* ---------- self-test (leave-one-sample-out) ---------- */
$('selfTest').onclick = () => {
  const out = $('testOut'); out.classList.remove('hide');
  const multi = bank.filter(s => bank.filter(x => x.pid === s.pid).length >= 2);
  if (multi.length < 4) { out.textContent = 'Enrol at least a few products with 2+ samples each, then run this again.'; return; }
  let right = 0, tot = 0, okScores = [], badScores = [], confusions = new Map();
  for (const s of multi) {
    const best = new Map();
    for (const o of bank) { if (o === s) continue; const c = dot(s.vec, o.vec); if (c > (best.get(o.pid) ?? -2)) best.set(o.pid, c); }
    const r = [...best].sort((a, b) => b[1] - a[1]); if (!r.length) continue;
    tot++; if (r[0][0] === s.pid) { right++; okScores.push(r[0][1]); } else { badScores.push(r[0][1]); const k = byId(s.pid).name + ' → ' + byId(r[0][0]).name; confusions.set(k, (confusions.get(k) || 0) + 1); }
  }
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 100) + '%' : '—';
  const conf = [...confusions].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `  ${k} (×${n})`).join('\n');
  out.textContent = `Top-1 accuracy: ${right}/${tot} = ${Math.round(right / tot * 100)}%\nAverage similarity when right: ${avg(okScores)} · when wrong: ${avg(badScores)}\n${conf ? 'Most confused pairs:\n' + conf + '\n' : ''}Tip: set "minimum similarity" a little above the "when wrong" average.`;
};

/* ---------- backup ---------- */
$('expBtn').onclick = () => {
  const data = { app: 'ai-counter', model: MODEL_TAG, products: products.map(p => ({ ...p, samples: p.samples.map(b64) })) };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })); a.download = 'ai-counter-catalogue.json'; a.click();
};
$('impBtn').onclick = () => $('impFile').click();
$('impFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (d.app !== 'ai-counter') throw new Error('Not a catalogue backup');
    if(d.model!==MODEL_TAG||!Array.isArray(d.products))throw new Error('Incompatible model backup');
    let restored=0;
    for(const item of d.products){
      const current=byId(String(item.id));if(!current)continue;
      if(!Array.isArray(item.samples)||item.samples.length>32)throw new Error('Invalid sample count');
      const samples=item.samples.map(unb64);if(samples.some(b=>b.byteLength!==1536))throw new Error('Invalid sample size');
      if(samples.length){await persistAiSamples(current,samples);restored++;}
    }
    toast(`Restored training for ${restored} current inventory products. Names, prices and stock stay from Firebase.`);
  } catch (err) { toast('Import failed: ' + err.message); }
  e.target.value = '';
};

/* ---------- tabs + boot ---------- */
function switchTab(t) {
  $('viewCounter').classList.toggle('hide', t !== 'counter'); $('viewCatalogue').classList.toggle('hide', t !== 'catalogue');
  $('tabCounter').classList.toggle('on', t === 'counter'); $('tabCatalogue').classList.toggle('on', t === 'catalogue');
  counter.paused = t !== 'counter';
}
$('tabCounter').onclick = () => switchTab('counter'); $('tabCatalogue').onclick = () => switchTab('catalogue');

(async () => {
  try { const a = localStorage.getItem('aic-thr'), b = localStorage.getItem('aic-mar');
    if (a!==null) $('thr').value = Math.max(0,Math.min(100,Number(a)||0));
    if (b) $('mar').value = Math.max(8,Math.min(30,Number(b)||8));
  } catch { /* ignore */ }
  $('thr').dispatchEvent(new Event('input'));
  // Do not show persisted inventory cache before a successful Firebase read.
  // Only camera samples are reused, matched to current inventory by barcode.
  products = []; rebuildBank(); renderList(); renderCart(); renderSamples();
  try { await syncFirebaseProducts(); } catch { /* Keep the page open and show the Firebase error above. */ }
  if (MOCK) window.__t={embed,match,products:()=>products,bank:()=>bank,enrol,cart,counter,tracker,DB,renderSamples,tick,addTrack,syncFirebaseProducts};
})();

// Refresh current inventory periodically; never resurrect product rows from a local backup.
setInterval(()=>{if(!document.hidden&&!checkoutBusy&&!indexingPromise&&!$('payDlg').open)syncFirebaseProducts().catch(()=>{});},30000);
window.addEventListener('focus',()=>{if(!checkoutBusy&&!indexingPromise&&!$('payDlg').open)syncFirebaseProducts().catch(()=>{});});
window.addEventListener('pagehide',()=>{
  stopCounterCam();visionWorker?.terminate();detectorWorker?.terminate();
  inventoryListener?.();clearTimeout(listenerTimer);
});
