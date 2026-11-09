/* Small, deterministic camera segmentation and tracking core; no network or DOM. */
(function(root) {
  'use strict';
  const area = b => Math.max(0, b.x1-b.x0)*Math.max(0, b.y1-b.y0);
  function intersection(a,b) { return Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0)); }
  function iou(a,b) { const n=intersection(a,b); return n/(area(a)+area(b)-n || 1); }
  function contains(a,b) { return intersection(a,b)/(area(b)||1); }
  function foregroundShare(frame,baseline,b,w,h){
    const x0=Math.max(0,Math.floor(b.x0*w)),y0=Math.max(0,Math.floor(b.y0*h));
    const x1=Math.min(w,Math.ceil(b.x1*w)),y1=Math.min(h,Math.ceil(b.y1*h));
    let changed=0,total=0;
    for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){
      const i=(y*w+x)*4;total++;
      if(Math.max(Math.abs(frame[i]-baseline[i]),Math.abs(frame[i+1]-baseline[i+1]),
        Math.abs(frame[i+2]-baseline[i+2]))>42)changed++;
    }
    return total?changed/total:0;
  }
  function detect(rgba, baseline, previous, w, h, threshold=32) {
    const size=w*h, mask=new Uint8Array(size), clean=new Uint8Array(size);
    // Median brightness shift ignores small whole-frame exposure changes.
    const hist=new Uint32Array(511);
    for(let i=0;i<size;i+=4) hist[Math.round((rgba[i*4]+rgba[i*4+1]+rgba[i*4+2]-baseline[i*4]-baseline[i*4+1]-baseline[i*4+2])/3)+255]++;
    let total=0, shift=0; for(let i=0;i<511;i++){total+=hist[i];if(total>=Math.ceil(size/4)/2){shift=i-255;break;}}
    shift=Math.max(-24,Math.min(24,shift));
    let changed=0;
    for(let i=0;i<size;i++) {
      const j=i*4;
      mask[i]=Math.max(Math.abs(rgba[j]-baseline[j]-shift),Math.abs(rgba[j+1]-baseline[j+1]-shift),Math.abs(rgba[j+2]-baseline[j+2]-shift))>threshold?1:0;
      changed+=mask[i];
    }
    // Majority filter removes isolated sensor noise, keeps narrow real objects.
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      let n=0; for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)n+=mask[(y+dy)*w+x+dx];
      clean[y*w+x]=n>=4?1:0;
    }
    const queue=new Int32Array(size), components=[];
    for(let i=0;i<size;i++)if(clean[i]){
      let head=0,tail=1,n=0,x0=w,y0=h,x1=0,y1=0,moved=0;queue[0]=i;clean[i]=0;
      while(head<tail){
        const p=queue[head++],x=p%w,y=(p/w)|0,j=p*4;n++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
        if(previous && Math.max(Math.abs(rgba[j]-previous[j]),Math.abs(rgba[j+1]-previous[j+1]),Math.abs(rgba[j+2]-previous[j+2]))>24)moved++;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const nx=x+dx,ny=y+dy,k=ny*w+nx;
          if(nx>=0&&nx<w&&ny>=0&&ny<h&&clean[k]){clean[k]=0;queue[tail++]=k;}
        }
      }
      // Retain fragments for merging; reject noise after adjacent pieces join.
      if(n>=24&&x1-x0>=3&&y1-y0>=3)
        components.push({x0:x0/w,y0:y0/h,x1:(x1+1)/w,y1:(y1+1)/h,pixels:n,moved});
    }
    // Preserve substantial independent fragments for the detector fusion step.
    // Joining via a hand or shadow can otherwise swallow a second product.
    const parts=components.filter(c=>c.pixels>=96&&area(c)>.008).map(c=>({
      bbox:{x0:c.x0,y0:c.y0,x1:c.x1,y1:c.y1},motion:previous?c.moved/c.pixels:1,
    }));
    // Join fragments belonging to the same package. Keep a visible gap between items.
    let merged=true;
    while(merged){merged=false;outer:for(let i=0;i<components.length;i++)for(let j=i+1;j<components.length;j++){
      const a=components[i],b=components[j],gapX=Math.max(0,a.x0-b.x1,b.x0-a.x1),gapY=Math.max(0,a.y0-b.y1,b.y0-a.y1);
      if(intersection(a,b)>0 || (gapX<2/w&&gapY<2/h)){
        components[i]={x0:Math.min(a.x0,b.x0),y0:Math.min(a.y0,b.y0),x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1),pixels:a.pixels+b.pixels,moved:a.moved+b.moved};
        components.splice(j,1);merged=true;break outer;
      }
    }
    }
    // A large package can leave small disjoint highlights around its edges.
    // Keep separate substantial products, but do not track tiny bystanders.
    // Text, fabric texture and reflections are too small to make a useful crop.
    // A product below this size should be moved closer to the camera.
    const candidates=components.filter(c=>c.pixels>=Math.max(96,size*.005) &&
      (c.x1-c.x0)*w>=8 && (c.y1-c.y0)*h>=8 &&
      c.x0<.96&&c.x1>.04&&c.y0<.96&&c.y1>.04);
    candidates.sort((a,b)=>b.pixels-a.pixels);
    const primary=candidates[0];
    const visible=primary && area(primary)>.15
      ?candidates.filter((c,i)=>i===0||c.pixels>=Math.max(160,primary.pixels*.04)||area(c)>.012)
      :candidates;
    return {fraction:changed/size, parts, boxes:visible.map(c=>({bbox:{x0:c.x0,y0:c.y0,x1:c.x1,y1:c.y1},motion:previous?c.moved/c.pixels:1}))};
  }
  // RT-DETR provides separate object boxes when foreground segmentation merges
  // touching items. A generic COCO detection alone cannot create a cart item:
  // it must also overlap a change since the empty-counter calibration.
  function fuseProposals(foreground,objects,max=8,prior=[],parts=[]){
    const accepted=objects.filter(d=>area(d.bbox)>.001 && foreground.some(m=>
      intersection(d.bbox,m.bbox)/Math.max(area(d.bbox),.0001)>.18))
      .sort((a,b)=>(b.score||0)-(a.score||0));
    const distinct=[];
    for(const d of accepted){
      if(distinct.some(other=>iou(d.bbox,other.bbox)>.55||contains(other.bbox,d.bbox)>.88))continue;
      distinct.push({bbox:d.bbox,motion:0,source:'rtdetr'});
    }
    // Keep an already tracked package when a later hand/desk change creates
    // one large foreground rectangle around several distinct products.
    const recovered=prior.filter(t=>t.bbox&&t.present!==false&&area(t.bbox)<.18&&foreground.some(m=>contains(m.bbox,t.bbox)>.65)
      &&!distinct.some(d=>iou(d.bbox,t.bbox)>.22||contains(d.bbox,t.bbox)>.78))
      .map(t=>({bbox:t.bbox,motion:0,source:'tracked'}));
    const smallParts=parts.filter(p=>area(p.bbox)<.18 && foreground.some(m=>contains(m.bbox,p.bbox)>.65)
      &&![...distinct,...recovered].some(d=>iou(d.bbox,p.bbox)>.25||contains(d.bbox,p.bbox)>.75))
      .map(p=>({...p,source:'foreground-part'}));
    const detailed=[...distinct,...recovered,...smallParts];
    const remaining=foreground.filter(m=>{
      const inside=detailed.filter(d=>contains(m.bbox,d.bbox)>.65);
      // A coarse rectangle must not block two separately found/tracked items.
      if(inside.length>1)return false;
      if(inside.length===1&&area(m.bbox)>area(inside[0].bbox)*3)return false;
      return !inside.some(d=>iou(m.bbox,d.bbox)>.4);
    });
    const proposals=[];
    for(const d of [...distinct,...recovered,...smallParts,...remaining]){
      if(proposals.some(p=>iou(p.bbox,d.bbox)>.55||contains(p.bbox,d.bbox)>.88))continue;
      proposals.push(d);
    }
    return proposals.slice(0,max);
  }
  class Tracker {
    constructor({settleMs=180, missingMs=900, maxTracks=8}={}) {this.settleMs=settleMs;this.missingMs=missingMs;this.maxTracks=maxTracks;this.nextId=1;this.epoch=0;this.tracks=[];}
    reset(){this.tracks=[];this.epoch++;}
    update(detections,now){
      for(const t of this.tracks){t.visible=false;t.blocked=false;}
      const used=new Set(),assigned=new Set();
      // A hand joining two tracked items must never create a new chargeable item.
      detections.forEach((d,i)=>{
        const hits=this.tracks.filter(t=>contains(d.bbox,t.bbox)>.65);
        if(hits.length>1){used.add(i);for(const t of hits){t.visible=true;t.blocked=true;t.lastSeen=now;t.stableSince=now;assigned.add(t.id);}}
      });
      const pairs=[];
      detections.forEach((d,i)=>{if(used.has(i))return;for(const t of this.tracks){
        if(assigned.has(t.id))continue;
        const overlap=iou(d.bbox,t.bbox),dx=(d.bbox.x0+d.bbox.x1-t.bbox.x0-t.bbox.x1)/2,dy=(d.bbox.y0+d.bbox.y1-t.bbox.y0-t.bbox.y1)/2;
        const dist=Math.hypot(dx,dy),ratio=area(d.bbox)/Math.max(area(t.bbox),.0001);
        if(overlap>.12||(dist<.08&&ratio>.45&&ratio<2.2))pairs.push({i,t,score:overlap-dist});
      }});
      pairs.sort((a,b)=>b.score-a.score);
      for(const {i,t} of pairs){
        if(used.has(i)||assigned.has(t.id))continue;
        const d=detections[i],overlap=iou(t.bbox,d.bbox),wasMissing=now-t.lastSeen>220;
        const oldArea=area(t.bbox),newArea=area(d.bbox);
        const cx=(t.bbox.x0+t.bbox.x1-d.bbox.x0-d.bbox.x1)/2;
        const cy=(t.bbox.y0+t.bbox.y1-d.bbox.y0-d.bbox.y1)/2;
        const boxJitter=overlap>=.5&&Math.hypot(cx,cy)<.05&&
          newArea/Math.max(oldArea,.0001)>.65&&newArea/Math.max(oldArea,.0001)<1.5;
        if(d.motion>.28||(!boxJitter&&overlap<.68)||wasMissing){
          t.stableSince=now;
          if(!t.counted){t.revision++;t.result=null;t.hits=0;t.matchPid=null;}
        }
        t.bbox=d.bbox;t.visible=true;t.lastSeen=now;t.motion=d.motion;
        used.add(i);assigned.add(t.id);
      }
      this.tracks=this.tracks.filter(t=>now-t.lastSeen<this.missingMs);
      detections.forEach((d,i)=>{
        if(used.has(i)||this.tracks.length>=this.maxTracks)return;
        // Ignore fragments while a known item is temporarily occluded/merged.
        if(this.tracks.some(t=>t.blocked&&intersection(t.bbox,d.bbox)>0))return;
        this.tracks.push({id:this.nextId++,epoch:this.epoch,revision:0,bbox:d.bbox,visible:true,blocked:false,lastSeen:now,stableSince:now,motion:d.motion,counted:false,result:null,hits:0,matchPid:null,nextAt:0,busy:false});
      });
      return this.tracks;
    }
    ready(now){return this.tracks.filter(t=>t.visible&&!t.blocked&&!t.counted&&!t.busy&&now-t.stableSince>=this.settleMs&&now>=t.nextAt).sort((a,b)=>a.nextAt-b.nextAt||a.id-b.id);}
    token(t){return {id:t.id,epoch:t.epoch,revision:t.revision,bbox:{...t.bbox}};}
    resolve(token,now){return this.tracks.find(t=>t.id===token.id&&t.epoch===token.epoch&&t.revision===token.revision&&t.visible&&!t.blocked&&!t.counted&&now-t.stableSince>=this.settleMs&&iou(t.bbox,token.bbox)>.52);}
    // An inference can finish just after a small position correction. Its
    // result is provisional: the caller resets votes and needs another match.
    resolveCandidate(token,now){return this.tracks.find(t=>t.id===token.id&&t.epoch===token.epoch&&
      t.visible&&!t.blocked&&!t.counted&&now-t.stableSince>=this.settleMs&&
      iou(t.bbox,token.bbox)>.52);}
    accept(t,result,now){
      t.hits=result.level==='ok'&&t.matchPid===result.pid?t.hits+1:result.level==='ok'?1:0;
      t.matchPid=result.pid;t.result=result;t.nextAt=now+(result.level==='ok'&&t.hits<2?120:1200);
      return t.hits>=2;
    }
  }
  function decide(top,threshold,margin){
    const first=top[0],gap=top.length>1?first.score-top[1].score:1;
    return {pid:first?.p?.id||null,score:first?.score||0,gap,level:first&&first.score>=threshold&&gap>=margin?'ok':first&&first.score>=threshold-.15?'maybe':'none'};
  }
  // Each region must beat both other inventory products and the empty-counter
  // reference. Motion alone is never evidence that a region is a product.
  function selectInventoryMatch(regions,backgroundScores,threshold,margin,backgroundLead=.06){
    let winner=null;
    for(let i=0;i<regions.length;i++){
      const region=regions[i],decision=decide(region.top,threshold,margin);
      const lead=decision.score-(backgroundScores[i]??1);
      if(decision.level!=='ok'||lead<backgroundLead)continue;
      const rank=decision.score+Math.min(.15,lead)*.25;
      if(!winner||rank>winner.rank)winner={...decision,top:region.top,bbox:region.bbox,index:i,backgroundLead:lead,rank};
    }
    return winner;
  }
  function canAutoAdd(result,hits,threshold,margin){
    return hits>=2&&result?.level==='ok'&&result.score>=Math.max(.82,threshold+.08)
      &&result.gap>=Math.max(.08,margin)&&result.backgroundLead>=.10;
  }
  const api={detect,fuseProposals,foregroundShare,Tracker,iou,area,decide,selectInventoryMatch,canAutoAdd};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RetailScan=api;
})(globalThis);
