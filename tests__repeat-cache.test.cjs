const test=require('node:test');
const assert=require('node:assert/strict');
const {repeatFingerprint,repeatSimilarity,RepeatCache,textEvidence,canAutoAdd,Tracker}=require('../ai-scan-engine.js');

const rect={x0:.2,y0:.25,x1:.4,y1:.65};
const trusted={level:'ok',score:.94,gap:.25,backgroundLead:.24};
function image(seed=0){
  const pixels=new Uint8ClampedArray(16*16*4);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const i=(y*16+x)*4;
    const band=(x+y)%4<2;
    pixels[i]=band?20+seed:225-seed;
    pixels[i+1]=band?125+seed:220-seed;
    pixels[i+2]=band?60+seed:190-seed;
    pixels[i+3]=255;
  }
  return repeatFingerprint(pixels,16,16);
}
test('two distinct tracked copies share a quick SKU lookup but have separate charge identities',()=>{
  const cache=new RepeatCache();const first=image();
  cache.remember('OMEZ',first,rect,trusted,100,5);
  const tracker=new Tracker();tracker.update([{bbox:rect,motion:0},
    {bbox:{x0:.6,y0:.25,x1:.8,y1:.65},motion:0}],0);
  assert.equal(cache.find(image(),rect,300,5).pid,'OMEZ');
  assert.equal(tracker.ready(300).length,2);
  for(const track of tracker.tracks){track.counted=true;}
  assert.equal(tracker.ready(400).length,0);
});
test('colour or texture difference does not inherit a previously confirmed SKU',()=>{
  const cache=new RepeatCache();cache.remember('OMEZ',image(),rect,trusted,100,5);
  assert.equal(cache.find(image(85),rect,300,5),null);
  assert.ok(repeatSimilarity(image(),image(85))<.962);
});
test('competing similar inventory examples do not shortcut to either SKU',()=>{
  const cache=new RepeatCache();cache.remember('A',image(),rect,trusted,100,5);
  cache.remember('B',image(2),rect,trusted,110,5);
  assert.equal(cache.find(image(1),rect,300,5),null);
});
test('manual or OCR-uncertain matches are never promoted to trusted auto-adds',()=>{
  const cache=new RepeatCache();cache.remember('A',image(),rect,{...trusted,manualOnly:true},100,5);
  const found=cache.find(image(),rect,300,5);
  assert.equal(found.pid,'A');assert.equal(found.entry.trusted,false);
  assert.equal(canAutoAdd({...trusted,manualOnly:true},2,.86,.08),false);
});
test('a low-score accepted product can use an exact repeat at the chosen threshold',()=>{
  const cache=new RepeatCache();cache.remember('A',image(),rect,{...trusted,score:.68,gap:.1,backgroundLead:.08},100,5);
  const found=cache.find(image(),rect,200,5);
  assert.equal(found.pid,'A');assert.equal(found.entry.trusted,true);
  assert.equal(canAutoAdd({level:'ok',pid:'A',score:.68,gap:.1,backgroundLead:.08},2,.24,.08),true);
});
test('stale calibration, expiry and size change invalidate a remembered view',()=>{
  const cache=new RepeatCache({ttlMs:500});cache.remember('A',image(),rect,trusted,100,5);
  assert.equal(cache.find(image(),rect,200,6),null);
  assert.equal(cache.find(image(),rect,700,5),null);
  assert.equal(cache.find(image(),{...rect,x1:.65},200,5),null);
  cache.clear();assert.equal(cache.find(image(),rect,200,5),null);
});
test('text evidence uses unique product words, including a rotated OCR result',()=>{
  const names=['OMEZ 20 mg','Zang hong 20 mg'];
  assert.equal(textEvidence('zemo',names[0],names),'unknown');
  assert.equal(textEvidence('OMEZ 20 mg',names[0],names),'verified');
  assert.equal(textEvidence('zang hong',names[0],names),'conflict');
  assert.equal(textEvidence('',names[0],names),'unreadable');
});
