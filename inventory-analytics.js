import { api } from './firebase-store.js';
const Chart=window.Chart;
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
Chart.defaults.color=css('--muted');Chart.defaults.font.family=css('--font');Chart.defaults.font.size=12;
const GRID='rgba(128,128,128,0.2)';
const f$=v=>v==null||!Number.isFinite(Number(v))?'—':'$'+Math.round(Number(v)).toLocaleString();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const RAMP={blue:['#042c53','#0a3a6c','#0c447c','#185fa5','#1f6bbd','#2a78d6','#3382d9'],
 A:['#173404','#27500A','#3B6D11','#4f8318','#639922','#97C459','#C0DD97'],
 B:['#412402','#633806','#854F0B','#BA7517','#EF9F27','#FAC775','#FAEEDA'],
 C:['#26215C','#3C3489','#534AB7','#6a60cc','#7F77DD','#AFA9EC','#CECBF6']};
const TX={blue:['#fff','#fff','#fff','#fff','#fff','#fff','#fff'],A:['#fff','#fff','#fff','#fff','#fff','#fff','#173404'],
 B:['#fff','#fff','#fff','#fff','#412402','#412402','#412402'],C:['#fff','#fff','#fff','#fff','#fff','#26215C','#26215C']};
const ZC={A:'#c6e5b3',B:'#fbf3a5',C:'#d9d6f7'};
const EB=[{k:'exp',t:'Expired',c:'#8a1c1c',tx:'#fff'},{k:'b7',t:'Within 7 days',c:'#d03b3b',tx:'#fff'},
 {k:'b30',t:'8 to 30 days',c:'#ec835a',tx:'#fff'},{k:'b90',t:'31 to 90 days',c:'#fab219',tx:'#412402'},{k:'ok',t:'Over 90 days',c:'#0ca30c',tx:'#fff'}];
const ESL={exp:'Expired',b7:'Critical',b30:'Soon',b90:'Watch',ok:'OK'};
const bkt=d=>d<0?'exp':(d<=7?'b7':(d<=30?'b30':(d<=90?'b90':'ok')));
const ecol=k=>EB.find(b=>b.k===k);
const status=document.getElementById('analyticsStatus');
const updatedStatus=document.getElementById('updatedStatus');
let inventoryAnalyticsDays=30,loadRequest=0;
let CATS=[], EXP=[], RUN=[], PRODUCTS=[], summaryData={};
function classify(items){
 items.sort((a,b)=>b.v-a.v);
 const total=items.reduce((a,b)=>a+(Number(b.v)||0),0);let cum=0;
 items.forEach((it,i)=>{it.rank=i;it.share=total?it.v/total*100:0;const before=cum;cum+=it.share;it.cum=cum;it.cls=before<70?'A':(before<90?'B':'C');});
 return items;
}
function products(name){
 return classify(PRODUCTS.filter(p=>(p.category||'Uncategorized')===name).map(p=>{
  const units=Math.max(0,Number(p.quantity)||0),price=p.unitCost==null?0:Number(p.unitCost)||0;
  return {name:p.name,units,price,v:units*price,barcode:p.barcode,supplier:p.supplierName||''};
 }));
}
function squarify(items,x,y,w,h,out){
 let rem=items.slice();
 const worst=(row,s)=>{const sum=row.reduce((a,b)=>a+b.a,0);const mx=Math.max(...row.map(r=>r.a)),mn=Math.min(...row.map(r=>r.a));return mn<=0?Infinity:Math.max(s*s*mx/(sum*sum),sum*sum/(s*s*mn));};
 while(rem.length){
  const s=Math.min(w,h);let row=[rem[0]],i=1;
  while(i<rem.length){const nr=row.concat(rem[i]);if(worst(nr,s)<=worst(row,s)){row=nr;i++;}else break;}
  const sum=row.reduce((a,b)=>a+b.a,0);
  if(w>=h){const cw=sum/h;let yy=y;row.forEach(r=>{const hh=r.a/cw;out.push({it:r.it,i:r.i,x,y:yy,w:cw,h:hh});yy+=hh;});x+=cw;w-=cw;}
  else{const rh=sum/w;let xx=x;row.forEach(r=>{const ww=r.a/rh;out.push({it:r.it,i:r.i,x:xx,y,w:ww,h:rh});xx+=ww;});y+=rh;h-=rh;}
  rem=rem.slice(row.length);
 }
}
function tiles(el,items,W,H,o){
 el.style.width=W+'px';el.style.height=H+'px';
 const valid=items.filter(it=>Number(it.v)>0);
 if(!valid.length||W<10){el.innerHTML='';return;}
 const wt=valid.map(it=>o.mode==='read'?Math.pow(it.v,0.55):it.v),sw=wt.reduce((a,b)=>a+b,0),k=W*H/sw;
 const out=[];squarify(valid.map((it,i)=>({it,i,a:wt[i]*k})),0,0,W,H,out);
 el.innerHTML=out.map(t=>{
  const it=t.it,ci=Math.min(6,Math.floor(t.i*7/valid.length)),w=t.w-3,h=t.h-3;
  const big=w>=110&&h>=70,mid=w>=70&&h>=44,fs=big?15:(mid?13:11),pad=big?'8px 10px':(mid?'6px 8px':'3px 5px');
  let inner='';
  if(w>=30&&h>=20){inner='<span class="tn" style="font-size:'+fs+'px">'+esc(it.name)+'</span>';if(mid)inner+='<span style="font-size:'+(fs-1)+'px">'+Math.round(it.share)+'%</span>';}
  return '<div class="tile'+(o.click?' go':'')+'" data-n="'+esc(it.name)+'" title="'+esc(it.name)+': '+f$(it.v)+' ('+it.share.toFixed(1)+'%)" style="left:'+(t.x+1.5)+'px;top:'+(t.y+1.5)+'px;width:'+w+'px;height:'+h+'px;padding:'+pad+';background:'+RAMP[o.ramp][ci]+';color:'+TX[o.ramp][ci]+'">'+inner+'</div>';
 }).join('');
}
function renderKpis(){
 const total=Number(summaryData.knownStockValue)||0;
 const expired=EXP.filter(i=>i.k==='exp'),w7=EXP.filter(i=>i.k==='b7');
 const run=RUN.filter(r=>r.days<=7);
 const stockValue=summaryData.stockValue==null?'Incomplete':f$(total);
 const cards=[
  ['Stock value',stockValue,summaryData.missingCostProducts?summaryData.missingCostProducts+' stocked product costs missing':CATS.length+(CATS.length===1?' category':' categories'),'#185fa5'],
  ['Expired',expired.length+' products',f$(expired.reduce((a,b)=>a+b.val,0))+' at recorded cost','#8a1c1c'],
  ['Expiring within 7 days',w7.length+' products',f$(w7.reduce((a,b)=>a+b.val,0))+' at recorded cost','#d03b3b'],
  ['Running out within 7 days',run.length+' products','Based on recent recorded sales','#ec835a']];
 document.getElementById('kpis').innerHTML=cards.map(x=>'<div class="kpi" style="border-left-color:'+x[3]+'"><span>'+x[0]+'</span><b>'+esc(x[1])+'</b><em>'+esc(x[2])+'</em></div>').join('');
 document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.t).scrollIntoView({behavior:'smooth',block:'start'}));
}
function renderCategoryTreemap(){
 const items=classify(CATS.map(c=>({name:c.name,v:c.knownValue,productCount:c.productCount})));
 const w1=document.getElementById('w1'),tm1=document.getElementById('tm1'),back=document.getElementById('back1'),pop=document.getElementById('pop1');
 const H=()=>Math.max(240,w1.clientHeight||400);let mode='read';
 const render=()=>{
  const height=H();
  if(!items.some(item=>item.v>0)){tm1.style.width='100%';tm1.style.height=height+'px';tm1.innerHTML='<div style="display:grid;place-items:center;height:100%;color:var(--muted);text-align:center">Add purchase costs to inventory products to show stock value by category.</div>';return;}
  tiles(tm1,items,w1.clientWidth,height,{ramp:'blue',click:true,mode});
 };
 function close(){pop.style.display='none';back.style.display='none';}
 function open(name){
  const c=items.find(i=>i.name===name),ps=products(name);
  const rows=ps.map((p,i)=>'<tr><td><span class="dot" style="background:'+RAMP.blue[Math.min(6,Math.floor(i*7/Math.max(1,ps.length)))]+'"></span>'+esc(p.name)+'</td><td>'+p.units.toLocaleString()+'</td><td>'+(p.price?('$'+p.price.toFixed(2)):'—')+'</td><td>'+f$(p.v)+'</td><td>'+p.share.toFixed(1)+'%</td></tr>').join('');
  pop.innerHTML='<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h2>'+esc(c.name)+'</h2><p class="sub">'+ps.length+' products · '+f$(c.v)+' · '+c.share.toFixed(1)+'% of known stock value</p></div><button class="chipbtn" id="x1">Close</button></div><div id="mini1"></div><div class="tw" style="margin-top:8px"><table><thead><tr><th>Product</th><th>Stock</th><th>Unit cost</th><th>Value</th><th>Share</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  back.style.display='block';pop.style.display='block';
  const mini=document.getElementById('mini1');
  tiles(mini,ps,mini.clientWidth,mini.clientHeight,{ramp:'blue',click:false,mode:'true'});
  document.getElementById('x1').onclick=close;
 }
 tm1.onclick=e=>{const t=e.target.closest('.tile.go');if(t)open(t.dataset.n);};
 back.onclick=close;document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 const b1=document.getElementById('t1'),b2=document.getElementById('t2');
 b1.onclick=()=>{mode='read';b1.classList.add('on');b2.classList.remove('on');render();};
 b2.onclick=()=>{mode='true';b2.classList.add('on');b1.classList.remove('on');render();};
 render();new ResizeObserver(render).observe(w1);
}
function renderAbc(){
 const totalKnown=CATS.reduce((sum,category)=>sum+category.knownValue,0);
 if(!totalKnown){
  document.getElementById('bc2').textContent='ABC analysis needs recorded purchase costs.';
  document.getElementById('abcT').innerHTML='<div><b>Waiting for cost data</b>Enter purchase costs for stocked products.</div>';
  document.getElementById('w2').style.display='none';
  document.getElementById('th2').innerHTML='<tr><th>Category</th><th>Value</th><th>Share</th><th>Cumulative</th><th>Class</th><th>Products</th></tr>';
  document.getElementById('tb2').innerHTML='<tr><td colspan="6">No category can be classified until purchase costs are available.</td></tr>';
  return;
 }
 document.getElementById('w2').style.display='';
 const zones={a:10,b:30};let zi={A:[],B:[],C:[]};let st={level:0,items:[],cat:''};
 const w2=document.getElementById('w2');
 const plug={id:'zones',afterDraw(ch){
  const {ctx,chartArea:ca,scales:{x,y}}=ch,xa=x.getPixelForValue(zones.a),xb=x.getPixelForValue(zones.b);
  ctx.save();ctx.fillStyle='#1f2a1a';ctx.font='600 15px '+css('--font');ctx.textAlign='center';
  [[ca.left,xa,'A'],[xa,xb,'B'],[xb,ca.right,'C']].forEach(z=>ctx.fillText(z[2],(z[0]+z[1])/2,ca.bottom-10));
  ctx.strokeStyle='#1f2a1a';ctx.setLineDash([3,3]);ctx.lineWidth=1;
  [[70,xa],[90,xb]].forEach(l=>{const yy=y.getPixelForValue(l[0]);ctx.beginPath();ctx.moveTo(ca.left,yy);ctx.lineTo(l[1],yy);ctx.lineTo(l[1],ca.bottom);ctx.stroke();});ctx.restore();
 },afterRender(ch){
  const ca=ch.chartArea,x=ch.scales.x,xa=x.getPixelForValue(zones.a),xb=x.getPixelForValue(zones.b),H=Math.round((ca.bottom-ca.top)*0.55),topT=ca.bottom-34-H;
  [['A',ca.left,xa],['B',xa,xb],['C',xb,ca.right]].forEach(z=>{
   const f=document.getElementById('f'+z[0]);f.style.left=z[1]+'px';f.style.width=(z[2]-z[1])+'px';f.style.top=ca.top+'px';f.style.height=(ca.bottom-ca.top)+'px';
   const t=document.getElementById('z'+z[0]);t.style.left=(z[1]+6)+'px';t.style.top=topT+'px';tiles(t,zi[z[0]],Math.max(0,Math.round(z[2]-z[1]-12)),H,{ramp:z[0],click:!st.level,mode:'read'});
  });
 }};
 const chart=new Chart(document.getElementById('cv2'),{type:'line',plugins:[plug],data:{datasets:[]},options:{animation:false,events:[],responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{enabled:false}},
  scales:{x:{type:'linear',min:0,max:100,grid:{display:false},border:{display:false},title:{display:true,text:'% of items'},ticks:{stepSize:10}},y:{min:0,max:100,grid:{display:false},border:{display:false},title:{display:true,text:'Value (%)'},ticks:{stepSize:10}}}}});
 function show(items,level,cat){
  st={level,items,cat};classify(items);const n=items.length||1,cnt={A:0,B:0,C:0},val={A:0,B:0,C:0};items.forEach(it=>{cnt[it.cls]++;val[it.cls]+=it.share;});
  zones.a=cnt.A/n*100;zones.b=(cnt.A+cnt.B)/n*100;zi={A:items.filter(i=>i.cls==='A'),B:items.filter(i=>i.cls==='B'),C:items.filter(i=>i.cls==='C')};chart.update();
  document.getElementById('bc2').innerHTML=level?'<button class="chipbtn" id="bk2">Back to categories</button><span class="sub" style="margin:0">All categories</span><span>›</span><b style="font-weight:600">'+esc(cat)+'</b>':'<b style="font-weight:600">All categories</b><span class="sub" style="margin:0">'+items.length+' categories</span>';
  if(level)document.getElementById('bk2').onclick=()=>show(CATS.map(c=>({name:c.name,v:c.knownValue})),0,'');
  document.getElementById('abcT').innerHTML=['A','B','C'].map(k=>'<div style="background:'+ZC[k]+'"><b>Class '+k+'</b>'+cnt[k]+' items ('+Math.round(cnt[k]/n*100)+'%) hold '+Math.round(val[k])+'% of value</div>').join('');
  document.getElementById('th2').innerHTML=level?'<tr><th>Product</th><th>Stock</th><th>Unit cost</th><th>Value</th><th>Share</th><th>Cumulative</th><th>Class</th></tr>':'<tr><th>Category</th><th>Value</th><th>Share</th><th>Cumulative</th><th>Class</th><th>Products</th></tr>';
  document.getElementById('tb2').innerHTML=items.map(it=>{
   const b='<span class="bd" style="background:'+ZC[it.cls]+'">'+it.cls+'</span>';
   if(level)return '<tr><td>'+esc(it.name)+'</td><td>'+it.units.toLocaleString()+'</td><td>'+(it.price?'$'+it.price.toFixed(2):'—')+'</td><td>'+f$(it.v)+'</td><td>'+it.share.toFixed(1)+'%</td><td>'+it.cum.toFixed(1)+'%</td><td>'+b+'</td></tr>';
   return '<tr class="go" data-n="'+esc(it.name)+'"><td>'+esc(it.name)+'</td><td>'+f$(it.v)+'</td><td>'+it.share.toFixed(1)+'%</td><td>'+it.cum.toFixed(1)+'%</td><td>'+b+'</td><td>'+it.productCount+' &rsaquo;</td></tr>';
  }).join('');
 }
 function open(name){if(st.level)return;const c=CATS.find(x=>x.name===name);if(c)show(products(name),1,name);}
 document.getElementById('tb2').onclick=e=>{const tr=e.target.closest('tr.go');if(tr)open(tr.dataset.n);};
 w2.onclick=e=>{const t=e.target.closest('.tile.go');if(t)open(t.dataset.n);};
 show(CATS.map(c=>({name:c.name,v:c.knownValue,productCount:c.productCount})),0,'');
}
function renderExpiry(){
 let fb='all',fc='all';const sel=document.getElementById('ecat');
 sel.innerHTML='<option value="all">All categories</option>'+Array.from(new Set(EXP.map(i=>i.cat))).sort().map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
 sel.onchange=()=>{fc=sel.value;draw();};
 const lab=d=>d<0?'expired '+(-d)+'d ago':(d===0?'today':d+' days');
 const line={id:'today',afterDatasetsDraw(c){const x=c.scales.x,a=c.chartArea,px=x.getPixelForValue(0),ctx=c.ctx;ctx.save();ctx.strokeStyle='#d03b3b';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(px,a.top);ctx.lineTo(px,a.bottom);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#d03b3b';ctx.font='600 11px '+css('--font');ctx.textAlign='left';ctx.fillText('Today',px+4,a.top+10);ctx.restore();}};
 const chart=new Chart(document.getElementById('cv3'),{type:'bar',plugins:[line],data:{labels:[],datasets:[{data:[],backgroundColor:[],borderRadius:4,barThickness:18}]},
  options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{const it=c.chart.$items[c.dataIndex];return it.date+' · '+lab(it.days)+' · '+f$(it.val)+' at risk';}}}},
   scales:{x:{grid:{color:GRID},border:{display:false},title:{display:true,text:'Days until expiry (left of Today = already expired)'}},y:{grid:{display:false},border:{display:false}}}}});
 function draw(){
  const cnt={},risk={};EB.forEach(b=>{cnt[b.k]=0;risk[b.k]=0;});EXP.filter(i=>fc==='all'||i.cat===fc).forEach(i=>{cnt[i.k]++;risk[i.k]+=i.val;});
  const bk=document.getElementById('bk3');bk.innerHTML=EB.map(b=>'<button class="bkb'+(fb===b.k?' on':'')+'" data-k="'+b.k+'"><span><i style="background:'+b.c+'"></i>'+b.t+'</span><b>'+cnt[b.k]+'</b><em>'+f$(risk[b.k])+' value</em></button>').join('');
  bk.querySelectorAll('.bkb').forEach(e=>e.onclick=()=>{fb=fb===e.dataset.k?'all':e.dataset.k;draw();});
  const list=EXP.filter(i=>(fb==='all'||i.k===fb)&&(fc==='all'||i.cat===fc)).sort((a,b)=>a.days-b.days),top=list.slice(0,15);
  document.getElementById('ecnt').textContent='Showing '+top.length+' of '+list.length+' products, soonest first';
  chart.$items=top;chart.data.labels=top.map(i=>i.name+' · '+lab(i.days));chart.data.datasets[0].data=top.map(i=>i.days);chart.data.datasets[0].backgroundColor=top.map(i=>ecol(i.k).c);
  chart.options.scales.x.min=Math.min(0,...top.map(i=>i.days))-3;document.getElementById('w3').style.height=(Math.max(top.length,3)*30+90)+'px';chart.update();chart.resize();
  document.getElementById('tb3').innerHTML=top.map(i=>{const b=ecol(i.k);return '<tr><td>'+esc(i.name)+'</td><td>'+esc(i.cat)+'</td><td>'+esc(i.date)+'</td><td>'+i.days+'</td><td>'+i.qty+'</td><td>'+f$(i.val)+'</td><td><span class="st" style="background:'+b.c+';color:'+b.tx+'">'+ESL[i.k]+'</span></td></tr>';}).join('');
 }
 draw();
}
function renderRunout(){
 let f='ALL';const chart=new Chart(document.getElementById('cv4'),{type:'bar',data:{labels:[],datasets:[{data:[],backgroundColor:[],borderRadius:4,barThickness:18}]},
  options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{const r=c.chart.$items[c.dataIndex];return r.stock+' in stock, sold '+r.sold+' in selected period, '+r.days+' days left';}}}},
   scales:{x:{grid:{color:GRID},border:{display:false},title:{display:true,text:'Days of stock left'}},y:{grid:{display:false},border:{display:false}}}}});
 function draw(){
  const list=RUN.filter(r=>f==='ALL'||r.cls===f).sort((a,b)=>a.days-b.days);
  chart.$items=list;chart.data.labels=list.map(r=>r.name+' ('+r.cls+') · '+r.days+' days');chart.data.datasets[0].data=list.map(r=>r.days);chart.data.datasets[0].backgroundColor=list.map(r=>({A:'#3B6D11',B:'#BA7517',C:'#534AB7'}[r.cls]||'#534AB7'));
  document.getElementById('rcnt').textContent=list.length+' products, fewest days first';document.getElementById('w4').style.height=(Math.max(list.length,3)*30+90)+'px';chart.update();chart.resize();
  document.getElementById('tb4').innerHTML=list.map(r=>{const urgent=r.days<=7,plan=r.days<=14;return '<tr><td>'+esc(r.name)+'</td><td>'+({A:'A fast',B:'B medium',C:'C slow'}[r.cls]||'Unclassified')+'</td><td>'+r.stock+'</td><td>'+r.daily.toFixed(2)+'</td><td>'+r.days.toFixed(1)+'</td><td><span class="st" style="background:'+(urgent?'#d03b3b':(plan?'#fab219':'#0ca30c'))+';color:'+(!urgent&&plan?'#412402':'#fff')+'">'+(urgent?'Reorder now':(plan?'Plan reorder':'Healthy'))+'</span></td></tr>';}).join('');
 }
 document.querySelectorAll('#s4 .ctl button').forEach(b=>b.onclick=()=>{f=b.dataset.c;document.querySelectorAll('#s4 .ctl button').forEach(x=>x.classList.toggle('on',x===b));draw();});
 draw();
}
async function loadInventoryDashboard(){
 const request=++loadRequest;
 try{
  if(typeof Chart==='undefined')throw new Error('Chart library did not load. Check your internet connection and refresh.');
  const [analytics,inventory]=await Promise.all([
   api('/api/inventory/analytics?days='+inventoryAnalyticsDays),
   api('/api/inventory')
  ]);
  if(request!==loadRequest)return;
  summaryData=analytics.summary||{};PRODUCTS=inventory.products||[];
  CATS=(analytics.categories||[]).map(c=>({name:c.name,knownValue:Number(c.knownValue)||0,productCount:Number(c.productCount)||0,units:Number(c.units)||0,complete:c.complete!==false}));
  EXP=(analytics.expiryItems||[]).map(i=>({name:i.name,cat:i.category||'Uncategorized',days:Number(i.daysLeft)||0,date:i.expiryDate,qty:Number(i.quantity)||0,val:i.valueAtRisk==null?null:Number(i.valueAtRisk),k:bkt(Number(i.daysLeft)||0)}));
  RUN=(analytics.stockoutItems||[]).filter(i=>i.daysLeft!=null&&Number.isFinite(Number(i.daysLeft))).map(i=>({name:i.name,cls:i.movementClass||'C',stock:Number(i.quantity)||0,sold:Number(i.unitsSold)||0,daily:Number(i.unitsPerDay)||0,days:Number(i.daysLeft)}));
  status.textContent='Live Firebase inventory'+(summaryData.missingCostProducts?' · '+summaryData.missingCostProducts+' product costs missing':'');
  updatedStatus.textContent='Updated '+new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  updatedStatus.style.color='';
  renderKpis();renderCategoryTreemap();renderAbc();renderExpiry();renderRunout();
  document.getElementById('inventoryAnalyticsEmpty')?.remove();
  if(!PRODUCTS.length){const empty=document.createElement('section');empty.id='inventoryAnalyticsEmpty';empty.className='card';empty.innerHTML='<h2>No inventory yet</h2><p class="sub">Add products in Inbound to populate this analytics dashboard.</p>';document.getElementById('kpis').after(empty);}
 }catch(error){if(request!==loadRequest)return;status.textContent='Analytics unavailable: '+error.message;updatedStatus.textContent='Firebase disconnected';updatedStatus.style.color='#c6533b';}
}
document.getElementById('inventoryAnalyticsDays').addEventListener('change',event=>{inventoryAnalyticsDays=Number(event.currentTarget.value);loadInventoryDashboard();});
loadInventoryDashboard();
new ResizeObserver(()=>parent.postMessage({type:'inventory-analytics-height',height:document.documentElement.scrollHeight},location.origin)).observe(document.body);
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.type==='inventory-analytics-refresh')location.reload();});
