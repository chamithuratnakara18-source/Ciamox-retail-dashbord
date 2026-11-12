const test=require('node:test'),assert=require('node:assert/strict');
const {detect,fuseProposals,foregroundShare,Tracker,decide,selectInventoryMatch,canAutoAdd}=require('../ai-scan-engine.js');
const W=192,H=108;
function frame(rects=[],brightness=90){const f=new Uint8ClampedArray(W*H*4);for(let i=0;i<W*H;i++){f[i*4]=f[i*4+1]=f[i*4+2]=brightness;f[i*4+3]=255;}for(const r of rects)for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++){const j=(y*W+x)*4;f[j]=r.color?.[0]??230;f[j+1]=r.color?.[1]??30;f[j+2]=r.color?.[2]??20;}return f;}
const box=(x=0.1)=>({bbox:{x0:x,y0:.2,x1:x+.15,y1:.6},motion:0});
test('empty view and uniform exposure shift do not create products',()=>{const base=frame();assert.equal(detect(frame(),base,base,W,H).boxes.length,0);assert.equal(detect(frame([],110),base,base,W,H).boxes.length,0);});
test('three separated items are segmented independently, including identical copies',()=>{const base=frame(),g=frame([{x:15,y:20,w:22,h:45},{x:70,y:20,w:22,h:45},{x:130,y:20,w:22,h:45,color:[30,220,50]}]);const out=detect(g,base,g,W,H);assert.equal(out.boxes.length,3);assert.ok(out.boxes.every(b=>b.motion===0));});
test('two products with a visible three-pixel gap stay independent',()=>{
  const base=frame(),image=frame([{x:12,y:20,w:30,h:50},{x:45,y:20,w:30,h:50,color:[20,190,40]}]);
  assert.equal(detect(image,base,image,W,H).boxes.length,2);
});
test('RT-DETR splits a foreground blob into two separately tracked objects',()=>{
  const merged=[{bbox:{x0:.1,y0:.1,x1:.85,y1:.85},motion:0}];
  const objects=[
    {bbox:{x0:.12,y0:.2,x1:.38,y1:.7},score:.8},
    {bbox:{x0:.55,y0:.2,x1:.82,y1:.7},score:.9},
  ];
  const fused=fuseProposals(merged,objects);
  assert.equal(fused.length,2);
  const t=new Tracker();t.update(fused,0);assert.equal(t.ready(200).length,2);
});
test('generic detections without foreground cannot enter checkout; unrecognized cartons still use foreground',()=>{
  const carton={bbox:{x0:.3,y0:.2,x1:.6,y1:.7},motion:0};
  const staticObject={bbox:{x0:.01,y0:.01,x1:.12,y1:.13},score:.99};
  assert.deepEqual(fuseProposals([carton],[staticObject]),[carton]);
  assert.deepEqual(fuseProposals([carton],[]),[carton]);
});
test('duplicate detector boxes for one object create only one proposal',()=>{
  const foreground=[{bbox:{x0:.2,y0:.2,x1:.6,y1:.7},motion:0}];
  const objects=[{bbox:{x0:.22,y0:.22,x1:.58,y1:.68},score:.9},{bbox:{x0:.23,y0:.23,x1:.57,y1:.67},score:.75}];
  assert.equal(fuseProposals(foreground,objects).length,1);
});
test('a large hand/background region no longer blocks two separated tracked products',()=>{
  const merged=[{bbox:{x0:.1,y0:.08,x1:.95,y1:.95},motion:.2}];
  const bottle={bbox:{x0:.35,y0:.15,x1:.46,y1:.37},score:.83};
  const old=[{bbox:{x0:.35,y0:.15,x1:.46,y1:.37},counted:false},
    {bbox:{x0:.43,y0:.48,x1:.58,y1:.75},counted:true}];
  const proposals=fuseProposals(merged,[bottle],8,old);
  assert.equal(proposals.length,2);
  const t=new Tracker();t.update(old.map(x=>({bbox:x.bbox,motion:0})),0);
  t.tracks[1].counted=true;
  t.update(proposals,300);
  assert.ok(t.tracks.every(x=>x.visible&&!x.blocked));
  assert.equal(t.tracks[1].counted,true);
});
test('a foreground carton fragment remains alongside a generic bottle detection',()=>{
  const merged=[{bbox:{x0:.08,y0:.1,x1:.9,y1:.85},motion:0}];
  const bottle={bbox:{x0:.34,y0:.12,x1:.45,y1:.38},score:.83};
  const carton={bbox:{x0:.38,y0:.46,x1:.62,y1:.72},motion:0};
  const proposals=fuseProposals(merged,[bottle],8,[],[carton]);
  assert.equal(proposals.length,2);
  assert.ok(proposals.some(p=>p.source==='foreground-part'));
});
test('a removed item is not recovered from an unrelated large foreground region',()=>{
  const base=frame(),item={x0:.2,y0:.2,x1:.4,y1:.6};
  assert.equal(foregroundShare(base,base,item,W,H),0);
  assert.ok(foregroundShare(frame([{x:39,y:22,w:36,h:42}]),base,item,W,H)>.18);
  const proposals=fuseProposals([{bbox:{x0:.05,y0:.05,x1:.9,y1:.9},motion:0}],
    [{bbox:{x0:.6,y0:.2,x1:.76,y1:.5},score:.9}],8,[{bbox:item,present:false}]);
  assert.ok(proposals.every(p=>p.source!=='tracked'));
});
test('a 79 percent match may auto-add when the user chooses a low threshold',()=>{
  const result=selectInventoryMatch([{bbox:box().bbox,top:[{p:{id:'ZANG'},score:.79},{p:{id:'OMEZ'},score:.54}]}],[.31],.78,.08);
  assert.equal(result.level,'ok');
  assert.equal(canAutoAdd(result,2,.24,.08),true);
  assert.equal(canAutoAdd(result,1,.24,.08),false);
});
test('the 24 percent setting accepts a stable candidate but rejects a below-threshold object',()=>{
  const eligible=selectInventoryMatch([{bbox:box().bbox,top:[{p:{id:'OMEZ'},score:.68},{p:{id:'OTHER'},score:.43}]}],[.30],.24,.08);
  assert.equal(canAutoAdd(eligible,2,.24,.08),true);
  assert.equal(canAutoAdd(eligible,2,.70,.08),false);
  const below=selectInventoryMatch([{bbox:box().bbox,top:[{p:{id:'OMEZ'},score:.23}]}],[.02],.24,.08);
  assert.equal(below,null);
});
test('two copies of the same SKU keep separate identities and count once each',()=>{const t=new Tracker();t.update([box(),box(.5)],0);assert.equal(t.ready(200).length,2);for(const track of t.tracks){t.accept(track,{pid:'SKU-A',level:'ok',score:.9},200);assert.equal(t.accept(track,{pid:'SKU-A',level:'ok',score:.91},350),true);track.counted=true;}t.update([box(.11),box(.51)],400);assert.deepEqual(t.tracks.map(x=>x.id),[1,2]);assert.equal(t.ready(900).length,0);});
test('brief occlusion does not count an item again, full removal rearms a new object',()=>{const t=new Tracker();t.update([box()],0);t.tracks[0].counted=true;t.update([],100);t.update([box()],400);assert.equal(t.tracks[0].counted,true);t.update([],500);t.update([],1500);t.update([box()],1600);assert.equal(t.tracks[0].counted,false);assert.equal(t.tracks[0].id,2);});
test('a calibrated, fully empty counter rearms the next identical copy promptly',()=>{
  const t=new Tracker();t.update([box()],0);t.tracks[0].counted=true;
  t.update([],100,{emptyView:true});t.update([],450,{emptyView:true});
  assert.equal(t.tracks[0].counted,true);
  t.update([],510,{emptyView:true});assert.equal(t.tracks.length,0);
  t.update([box()],540);assert.equal(t.tracks[0].id,2);
  assert.equal(t.ready(750).length,1);
});
test('a briefly missing or occluded product cannot be charged twice',()=>{
  const t=new Tracker();t.update([box()],0);t.tracks[0].counted=true;
  t.update([],100,{emptyView:true});t.update([box()],440);
  assert.equal(t.tracks[0].counted,true);
  t.update([],500,{emptyView:false});t.update([box()],850);
  assert.equal(t.tracks[0].counted,true);
});
test('a merged hand/object region blocks all affected tracks then restores their identities',()=>{const t=new Tracker();t.update([box(),box(.5)],0);t.tracks[0].counted=true;const merged={bbox:{x0:.05,y0:.1,x1:.7,y1:.7},motion:.2};t.update([merged],300);t.update([merged],1700);assert.equal(t.tracks.length,2);assert.ok(t.tracks.every(x=>x.blocked));assert.equal(t.ready(2000).length,0);t.update([box(),box(.5)],2100);assert.equal(t.tracks[0].counted,true);assert.equal(t.tracks[1].counted,false);});
test('stale inference cannot add a moved, removed or recalibrated item',()=>{const t=new Tracker();t.update([box()],0);const token=t.token(t.tracks[0]);assert.ok(t.resolve(token,200));t.update([{...box(),motion:.5}],250);assert.equal(t.resolve(token,500),undefined);const newer=t.token(t.tracks[0]);t.update([],550);assert.equal(t.resolve(newer,800),undefined);t.reset();assert.equal(t.resolve(newer,900),undefined);});
test('small detector-box jitter keeps an item identity and its previous vote',()=>{
  const t=new Tracker();t.update([box()],0);t.update([box()],120);
  t.accept(t.tracks[0],{pid:'A',level:'ok',score:.88},200);
  const revision=t.tracks[0].revision;
  const token=t.token(t.tracks[0]);
  t.update([box(.14)],300); // 58% overlap from a small box shift
  assert.equal(t.tracks[0].revision,revision);
  assert.equal(t.tracks[0].hits,1);
  assert.equal(t.tracks.length,1);
  assert.ok(t.resolve(token,400));
});
test('late inference after a small correction is provisional and cannot auto-add',()=>{
  const t=new Tracker();t.update([box()],0);
  const token=t.token(t.tracks[0]);
  t.update([{...box(),motion:.5}],250);
  assert.equal(t.resolve(token,500),undefined);
  assert.ok(t.resolveCandidate(token,500));
  const candidate=t.resolveCandidate(token,500);
  candidate.hits=0;candidate.matchPid=null;
  const result={pid:'A',level:'ok',score:.9,gap:.2,backgroundLead:.2};
  assert.equal(t.accept(candidate,result,500),false);
  assert.equal(canAutoAdd(result,candidate.hits,.78,.08),false);
  t.update([box(.6)],600);
  assert.equal(t.resolveCandidate(token,900),undefined);
  t.reset();assert.equal(t.resolveCandidate(token,1000),undefined);
});
test('small camera motion does not discard a nearly identical product twice',()=>{
  const t=new Tracker();t.update([box()],0);t.update([box()],150);
  t.accept(t.tracks[0],{pid:'A',level:'ok',score:.88},200);
  t.update([{...box(.11),motion:.15}],250);
  assert.equal(t.tracks[0].hits,1);
  assert.equal(t.accept(t.tracks[0],{pid:'A',level:'ok',score:.89},400),true);
});
test('inference queue excludes busy tracks and limits scene capacity',()=>{const t=new Tracker({maxTracks:2});t.update([box(),box(.4),box(.7)],0);assert.equal(t.tracks.length,2);t.tracks[0].busy=true;assert.equal(t.ready(200).length,1);});
test('close product scores require confirmation, not automatic addition',()=>{const ranked=[{p:{id:'A'},score:.89},{p:{id:'B'},score:.85}];assert.equal(decide(ranked,.72,.08).level,'maybe');assert.equal(decide([{p:{id:'A'},score:.89},{p:{id:'B'},score:.4}],.72,.08).level,'ok');assert.equal(decide([], .72,.08).level,'none');});
test('a package is detected while small background changes are ignored',()=>{
  const base=frame(),sample=frame([{x:45,y:18,w:92,h:72},{x:5,y:12,w:7,h:9,color:[20,200,10]},{x:169,y:80,w:8,h:10,color:[20,200,10]}]);
  const boxes=detect(sample,base,sample,W,H).boxes;
  assert.equal(boxes.length,1);
  assert.ok(boxes[0].bbox.x0<.25&&boxes[0].bbox.x1>.7);
});
test('a second smaller package remains a separate candidate',()=>{
  const base=frame(),sample=frame([{x:35,y:15,w:90,h:65},{x:155,y:40,w:17,h:21,color:[20,200,10]}]);
  assert.equal(detect(sample,base,sample,W,H).boxes.length,2);
});
test('unfamiliar motion and background-like patches are not inventory matches',()=>{
  const unknown=[{bbox:{x0:0,y0:0,x1:1,y1:1},top:[{p:{id:'A'},score:.64}]}];
  assert.equal(selectInventoryMatch(unknown,[.2],.72,.08),null);
  const background=[{bbox:{x0:0,y0:0,x1:1,y1:1},top:[{p:{id:'A'},score:.82},{p:{id:'B'},score:.55}]}];
  assert.equal(selectInventoryMatch(background,[.79],.72,.08),null);
});
test('inventory recognition chooses the matching product region over unrelated surroundings',()=>{
  const cloth={bbox:{x0:0,y0:0,x1:1,y1:1},top:[{p:{id:'A'},score:.61}]};
  const product={bbox:{x0:.25,y0:.18,x1:.75,y1:.75},top:[{p:{id:'A'},score:.88},{p:{id:'B'},score:.59}]};
  const winner=selectInventoryMatch([cloth,product],[.56,.43],.72,.08);
  assert.equal(winner.pid,'A');assert.deepEqual(winner.bbox,product.bbox);
  assert.equal(selectInventoryMatch([{bbox:product.bbox,top:[{p:{id:'A'},score:.86},{p:{id:'B'},score:.82}]}],[.25],.72,.08),null);
});
test('auto-add follows the selected threshold while keeping repeated-match and background checks',()=>{
  const trusted={level:'ok',pid:'A',score:.88,gap:.19,backgroundLead:.22};
  assert.equal(canAutoAdd(trusted,1,.78,.08),false);
  assert.equal(canAutoAdd(trusted,2,.24,.08),true);
  assert.equal(canAutoAdd({...trusted,score:.24},2,.24,.08),true);
  assert.equal(canAutoAdd(trusted,2,.23,.08),false);
  assert.equal(canAutoAdd(trusted,2,.89,.08),false);
  assert.equal(canAutoAdd(trusted,2,.86,.08),true);
  assert.equal(canAutoAdd({...trusted,manualOnly:true},2,.86,.08),false);
  assert.equal(canAutoAdd({...trusted,score:.40},2,.72,.08),false);
  assert.equal(canAutoAdd({...trusted,backgroundLead:.04},2,.72,.08),false);
  assert.equal(canAutoAdd({...trusted,gap:.03},2,.72,.08),false);
});
