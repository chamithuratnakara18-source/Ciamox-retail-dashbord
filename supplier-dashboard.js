let S=[];
let supplierCategories=[];
let selectedSupplierName='';
let supplierDeleteBusy=false;
const st={q:'',cat:'all',type:'all',sel:null,sort:'leadTimeDays',dir:1,color:'lead'};
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const numeric=value=>value==null||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
const fmtNumber=(value,digits=1)=>numeric(value)==null?'Not tracked':Number(value).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const fmtInteger=value=>Number(value||0).toLocaleString('en-US');
const fmtMoney=value=>value==null?'—':'€ '+Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const lband=d=>d==null?{c:'#9a9890',t:'Not tracked',tx:'#fff'}:d<=7?{c:'#0ca30c',t:'Up to 7 days',tx:'#fff'}:(d<=21?{c:'#fab219',t:'8 to 21 days',tx:'#412402'}:{c:'#d03b3b',t:'Over 21 days',tx:'#fff'});
const qband=q=>q==null?{c:'#9a9890',t:'Not tracked',tx:'#fff'}:q>=95?{c:'#0ca30c',t:'Excellent',tx:'#fff'}:(q>=85?{c:'#fab219',t:'Acceptable',tx:'#412402'}:{c:'#d03b3b',t:'Poor',tx:'#fff'});
const status=document.getElementById('supplierStatus');
const categorySelect=document.getElementById('cat');
const searchInput=document.getElementById('q');
const listBody=document.getElementById('tb');
const supplierForm=document.getElementById('supplierForm');
const supplierFormPanel=document.getElementById('supplierFormPanel');
const supplierFormMessage=document.getElementById('supplierFormMessage');
const supplierSaveButton=document.getElementById('saveSupplierButton');
let scatter=null;
let map=null,markerLayer=null,mapHasFitted=false;
const osmTileUrl='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const osmAttribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>';

function gauge(value,min,max,color,aria){
 if(numeric(value)==null)return '';
 const cx=100,cy=88,r=68,sw=18,a0=150,sweep=240;
 const f=Math.max(0,Math.min(1,(value-min)/(max-min)));
 const point=(a,rr)=>[cx+rr*Math.cos(a*Math.PI/180),cy+rr*Math.sin(a*Math.PI/180)];
 const arc=(from,to,rr)=>{const p0=point(from,rr),p1=point(to,rr);return 'M'+p0[0].toFixed(1)+' '+p0[1].toFixed(1)+' A'+rr+' '+rr+' 0 '+((to-from)>180?1:0)+' 1 '+p1[0].toFixed(1)+' '+p1[1].toFixed(1);};
 let html='<svg viewBox="0 0 200 132" width="100%" role="img" aria-label="'+esc(aria)+'">';
 html+='<path d="'+arc(a0,a0+sweep,r)+'" fill="none" style="stroke:var(--border-strong)" stroke-width="'+sw+'"/>';
 if(f>0)html+='<path d="'+arc(a0,a0+sweep*f,r)+'" fill="none" stroke="'+color+'" stroke-width="'+sw+'"/>';
 return html+'</svg>';
}
function smallGauge(value,min,max,color,center,aria){
 if(numeric(value)==null)return '';
 const cx=50,cy=46,r=33,sw=10,a0=150,sweep=240;
 const f=Math.max(0,Math.min(1,(value-min)/(max-min)));
 const point=(a,rr)=>[cx+rr*Math.cos(a*Math.PI/180),cy+rr*Math.sin(a*Math.PI/180)];
 const arc=(from,to,rr)=>{const p0=point(from,rr),p1=point(to,rr);return 'M'+p0[0].toFixed(1)+' '+p0[1].toFixed(1)+' A'+rr+' '+rr+' 0 '+((to-from)>180?1:0)+' 1 '+p1[0].toFixed(1)+' '+p1[1].toFixed(1);};
 let html='<svg viewBox="0 0 100 72" role="img" aria-label="'+esc(aria)+'">';
 html+='<path d="'+arc(a0,a0+sweep,r)+'" fill="none" style="stroke:var(--border-strong)" stroke-width="'+sw+'"/>';
 if(f>0)html+='<path d="'+arc(a0,a0+sweep*f,r)+'" fill="none" stroke="'+color+'" stroke-width="'+sw+'"/>';
 html+='<path d="'+arc(a0+8,a0+sweep-8,r-sw/2-6)+'" fill="none" style="stroke:var(--text-muted)" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="0.1 5" opacity="0.8"/>';
 return html+'<text x="50" y="51" text-anchor="middle" style="fill:var(--text-primary)" font-size="21" font-weight="500">'+esc(center)+'</text></svg>';
}
function filteredSuppliers(){
 const query=st.q.trim().toLocaleLowerCase();
 return S.filter(s=>{
  const cats=Array.isArray(s.categories)?s.categories:[];
  const items=Array.isArray(s.items)?s.items:[];
  const text=[s.name,s.city,s.country,s.supplierType,...cats,...items.flatMap(item=>[item.name,item.barcode,item.category])].join(' ').toLocaleLowerCase();
  const kind=s.supplierType||'Not recorded';
  return (!query||text.includes(query))&&(st.cat==='all'||cats.includes(st.cat))&&(st.type==='all'||kind===st.type);
 });
}
function drawTypeButtons(){
 const types=[...new Set(S.map(s=>s.supplierType||'Not recorded'))].sort((a,b)=>a.localeCompare(b));
 const choices=['all',...types];
 if(!choices.includes(st.type))st.type='all';
 document.getElementById('types').innerHTML=choices.map(type=>'<button type="button" class="ch'+(st.type===type?' on':'')+'" data-t="'+esc(type)+'">'+(type==='all'?'All types':esc(type))+'</button>').join('');
 document.querySelectorAll('#types button').forEach(button=>button.addEventListener('click',()=>{st.type=button.dataset.t;draw();}));
}
function updateControls(){
 const current=st.cat;
 const categories=[...new Set(S.flatMap(s=>s.categories||[]))].sort((a,b)=>a.localeCompare(b));
 categorySelect.innerHTML='<option value="all">All categories</option>'+categories.map(category=>'<option value="'+esc(category)+'">'+esc(category)+'</option>').join('');
 st.cat=categories.includes(current)?current:'all';categorySelect.value=st.cat;
 document.getElementById('supplierNames').innerHTML=S.map(s=>'<option value="'+esc(s.name)+'"></option>').join('');
}
function drawKpis(rows){
 const countries=[...new Set(rows.map(s=>s.country).filter(Boolean))];
 const leadRows=rows.filter(s=>numeric(s.leadTimeDays)!=null);
 const qualityRows=rows.filter(s=>numeric(s.qualityScore)!=null);
 const averageLead=leadRows.length?leadRows.reduce((sum,s)=>sum+Number(s.leadTimeDays),0)/leadRows.length:null;
 const longest=leadRows.reduce((best,s)=>!best||Number(s.leadTimeDays)>Number(best.leadTimeDays)?s:best,null);
 const averageQuality=qualityRows.length?qualityRows.reduce((sum,s)=>sum+Number(s.qualityScore),0)/qualityRows.length:null;
 const best=qualityRows.reduce((winner,s)=>!winner||Number(s.qualityScore)>Number(winner.qualityScore)?s:winner,null);
 const leadColor=lband(averageLead).c,qualityColor=qband(averageQuality).c;
 document.getElementById('kp').innerHTML=
  '<div class="k"><span class="l">Suppliers</span><b>'+fmtInteger(rows.length)+'</b><i>'+fmtInteger(countries.length)+' countries recorded</i></div>'+
  '<div class="k kg"><div><span class="l">Average lead time</span><b>'+(averageLead==null?'Not tracked':fmtNumber(averageLead)+' days')+'</b><i>'+(leadRows.length?'order to delivery · '+fmtInteger(leadRows.length)+' tracked':'Enter supplier lead times to calculate')+'</i></div>'+(averageLead==null?'':gauge(averageLead,0,40,leadColor,'Average lead time '+fmtNumber(averageLead)+' days'))+'</div>'+
  '<div class="k"><span class="l">Longest lead time</span><b>'+(longest?fmtNumber(longest.leadTimeDays)+' days':'Not tracked')+'</b><i>'+esc(longest?longest.name:'Enter supplier lead times to calculate')+'</i></div>'+
  '<div class="k kg"><div><span class="l">Average quality</span><b>'+(averageQuality==null?'Not tracked':fmtNumber(averageQuality)+' / 100')+'</b><i>'+(best?'Best: '+esc(best.name):'Enter supplier quality scores to calculate')+'</i></div>'+(averageQuality==null?'':gauge(averageQuality,60,100,qualityColor,'Average supplier quality '+fmtNumber(averageQuality)+' out of 100'))+'</div>';
}
function tinyGauge(value,min,max,color,center,aria){return '<div class="cg">'+smallGauge(value,min,max,color,center,aria)+'<div><span class="pill" style="background:'+color+';color:'+(color==='#fab219'?'#412402':'#fff')+'">'+(value==null?'Not tracked':value<=7?'Up to 7 days':value>=95?'Excellent':'Recorded')+'</span><small>'+esc(aria)+'</small></div></div>';}
function requestDeleteSupplier(s,button){
 if(supplierDeleteBusy)return;
 if(!window.confirm('Remove '+s.name+' from the Suppliers dashboard? Product and receipt history will be kept. A new scanned delivery restores this supplier.'))return;
 if(window.parent===window){supplierFormMessage.textContent='Open this page from the RetailFlow Suppliers tab to delete suppliers.';return;}
 supplierDeleteBusy=true;
 if(button){button.disabled=true;button.textContent='Deleting…';}
 window.parent.postMessage({type:'supplier-delete',data:{name:s.name}},location.origin);
}
function drawDetails(s){
 const detail=document.getElementById('det');
 if(!s){detail.innerHTML='<p class="hd">No supplier selected</p><p class="sb" style="margin:0">No supplier matches these filters. Clear the search or choose another category.</p>';return;}
 const location=[s.city,s.country].filter(Boolean).join(', ')||'Not recorded';
 const coordinates=numeric(s.latitude)!=null&&numeric(s.longitude)!=null?Number(s.latitude).toFixed(5)+', '+Number(s.longitude).toFixed(5):'Not recorded';
 const productNames=(s.items||[]).map(item=>item.name+(item.quantity>0?' ('+fmtInteger(item.quantity)+' in stock)':'' )).join(', ')||'No products recorded yet';
 const fields=[
  ['Location',location],['Coordinates',coordinates],['Product categories',(s.categories||[]).join(', ')||'Not assigned'],['Type of products',s.supplierType||'Not recorded'],
  ['Products supplied',productNames],['Lead time',s.leadTimeDays==null?'Not tracked':fmtNumber(s.leadTimeDays)+' days'],
  ['Product quality',s.qualityScore==null?'Not tracked':fmtNumber(s.qualityScore)+' / 100'],['Defect rate',s.defectRate==null?'Not tracked':fmtNumber(s.defectRate)+'%'],
  ['Current stock',fmtInteger(s.currentStock)+' units'],['Inbound units',fmtInteger(s.inboundUnits)+' units'],['Inbound receipts',fmtInteger(s.inboundRecords)],
  ['Recorded inbound cost',s.costedInboundUnits?fmtMoney(s.recordedInboundCost):'No recorded unit costs'],['Last arrival',s.lastArrivalDate||'—']
 ];
 detail.innerHTML='<div class="top"><div><p class="hd">'+esc(s.name)+'</p><p class="sb" style="margin-bottom:0">'+fmtInteger(s.productCount)+' products · '+fmtInteger(s.currentStock)+' units in stock</p></div><button class="ch delete-supplier" type="button" data-delete-supplier>Delete supplier</button></div><div class="dg">'+fields.map(([label,value])=>'<div><span class="l">'+esc(label)+'</span><p>'+esc(value)+'</p></div>').join('')+'</div>';
 detail.querySelector('[data-delete-supplier]').addEventListener('click',event=>requestDeleteSupplier(s,event.currentTarget));
}
function sortValue(s,key){return key==='name'?String(s.name||'').toLocaleLowerCase():key==='lastArrivalDate'?String(s[key]||''):numeric(s[key]);}
function drawTable(rows){
 const sorted=[...rows].sort((a,b)=>{
  const av=sortValue(a,st.sort),bv=sortValue(b,st.sort);
  if(av==null)return bv==null?String(a.name).localeCompare(String(b.name)):1;
  if(bv==null)return -1;
  const cmp=typeof av==='string'?av.localeCompare(bv):av-bv;
  return cmp*st.dir||String(a.name).localeCompare(String(b.name));
 });
 document.getElementById('cnt').textContent='Showing '+rows.length+' of '+S.length+' suppliers, sorted by '+(st.sort==='leadTimeDays'?'lead time':st.sort==='qualityScore'?'quality':'name');
 if(!sorted.length){listBody.innerHTML='<tr class="r"><td colspan="7" style="color:var(--text-secondary)">No suppliers match.</td></tr>';return;}
 listBody.innerHTML=sorted.map(s=>{
  const location=[s.city,s.country].filter(Boolean).join(', ')||'Not recorded';
  const cats=(s.categories||[]).slice(0,3).map(value=>'<span class="tag">'+esc(value)+'</span>').join('')||'—';
  const lead=lband(numeric(s.leadTimeDays)),quality=qband(numeric(s.qualityScore));
  const leadHtml=tinyGauge(numeric(s.leadTimeDays),0,40,lead.c,numeric(s.leadTimeDays)==null?'—':fmtNumber(s.leadTimeDays)+'d',numeric(s.leadTimeDays)==null?'Lead time not tracked':fmtNumber(s.leadTimeDays)+' days');
  const qualityHtml=tinyGauge(numeric(s.qualityScore),60,100,quality.c,numeric(s.qualityScore)==null?'—':fmtNumber(s.qualityScore),numeric(s.qualityScore)==null?'Quality not tracked':fmtNumber(s.qualityScore)+' / 100 · '+(s.defectRate==null?'defect rate not tracked':fmtNumber(s.defectRate)+'% defects'));
  return '<tr class="r'+(s.key===st.sel?' on':'')+'" data-key="'+esc(s.key)+'"><td><b style="font-weight:600">'+esc(s.name)+'</b></td><td>'+esc(location)+'</td><td>'+cats+'</td><td>'+esc(s.supplierType||'Not recorded')+'</td><td>'+leadHtml+'</td><td>'+qualityHtml+'</td><td><button class="ch delete-supplier" type="button" data-delete-supplier>Delete</button></td></tr>';
 }).join('');
 listBody.querySelectorAll('tr[data-key]').forEach(row=>{
  row.addEventListener('click',()=>{st.sel=row.dataset.key;draw();});
  row.querySelector('[data-delete-supplier]').addEventListener('click',event=>{
   event.stopPropagation();requestDeleteSupplier(sorted.find(s=>s.key===row.dataset.key),event.currentTarget);
  });
 });
}
function locationOf(s){
 const lat=numeric(s.latitude),lon=numeric(s.longitude);
 return lat!=null&&lon!=null&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180?[lon,lat]:null;
}
function drawMap(rows){
 if(!map||!markerLayer)return;
 markerLayer.clearLayers();
 const located=rows.filter(s=>locationOf(s));
 for(const supplier of located){
  const [longitude,latitude]=locationOf(supplier);
  const metric=st.color==='lead'?numeric(supplier.leadTimeDays):numeric(supplier.qualityScore);
  const color=(st.color==='lead'?lband(metric):qband(metric)).c;
  const marker=L.circleMarker([latitude,longitude],{
   radius:supplier.key===st.sel?9:6,color:'#ffffff',weight:2,fillColor:color,fillOpacity:0.95,supplierKey:supplier.key,
  }).addTo(markerLayer);
  const location=[supplier.city,supplier.country].filter(Boolean).join(', ')||'Location recorded';
  const metricText=st.color==='lead'
   ?(supplier.leadTimeDays==null?'Lead time not tracked':fmtNumber(supplier.leadTimeDays)+' days')
   :(supplier.qualityScore==null?'Quality not tracked':fmtNumber(supplier.qualityScore)+' / 100 quality');
  marker.bindTooltip(esc(supplier.name));
  marker.bindPopup('<strong>'+esc(supplier.name)+'</strong><br>'+esc(location)+'<br>'+esc(metricText));
  marker.on('click',()=>{
   st.sel=supplier.key;draw();
   markerLayer.eachLayer(layer=>{if(layer.options.supplierKey===supplier.key)layer.openPopup();});
  });
 }
 if(located.length&&!mapHasFitted){
  map.fitBounds(L.latLngBounds(located.map(s=>{const [longitude,latitude]=locationOf(s);return [latitude,longitude];})).pad(0.18),{maxZoom:5});
  mapHasFitted=true;
 }
 const legend=document.getElementById('mlg');
 if(st.color==='lead')legend.innerHTML='<span><i style="background:#0ca30c"></i>Up to 7 days</span><span><i style="background:#fab219"></i>8 to 21 days</span><span><i style="background:#d03b3b"></i>Over 21 days</span><span>No coordinates: '+(S.length-located.length)+' suppliers</span>';
 else legend.innerHTML='<span><i style="background:#0ca30c"></i>Excellent, 95 and above</span><span><i style="background:#fab219"></i>Acceptable, 85 to 94</span><span><i style="background:#d03b3b"></i>Poor, below 85</span><span>No coordinates: '+(S.length-located.length)+' suppliers</span>';
}
function initMap(){
 if(typeof L==='undefined'){document.getElementById('mlg').textContent='OpenStreetMap could not be loaded. Supplier records remain available below.';return;}
 map=L.map('map',{scrollWheelZoom:false}).setView([20,0],2);
 L.tileLayer(osmTileUrl,{maxZoom:19,attribution:osmAttribution}).addTo(map);
 markerLayer=L.layerGroup().addTo(map);
 window.setTimeout(()=>map.invalidateSize(),0);
 drawMap(filteredSuppliers());
}
function initScatter(){
 if(typeof Chart==='undefined')return;
 const muted=getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim()||'#898781';
 const surface=getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim()||'#fff';
 const quad={id:'quad',beforeDatasetsDraw(chart){const x=chart.scales.x,y=chart.scales.y,a=chart.chartArea,ctx=chart.ctx;if(!a)return;ctx.save();ctx.strokeStyle='rgba(128,128,128,0.55)';ctx.setLineDash([4,4]);ctx.lineWidth=1;const px=x.getPixelForValue(21),py=y.getPixelForValue(90);ctx.beginPath();ctx.moveTo(px,a.top);ctx.lineTo(px,a.bottom);ctx.moveTo(a.left,py);ctx.lineTo(a.right,py);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=muted;ctx.font='12px sans-serif';ctx.textAlign='left';ctx.fillText('Fast and high quality',a.left+8,a.top+16);ctx.textAlign='right';ctx.fillText('Slow and high quality',a.right-8,a.top+16);ctx.textAlign='left';ctx.fillText('Fast, quality to watch',a.left+8,a.bottom-8);ctx.textAlign='right';ctx.fillText('Slow, quality to watch',a.right-8,a.bottom-8);ctx.restore();}};
 Chart.defaults.color=muted;
 scatter=new Chart(document.getElementById('sc'),{type:'scatter',plugins:[quad],data:{datasets:[{data:[],pointBackgroundColor:[],pointBorderColor:surface,pointBorderWidth:2,pointRadius:[],pointHoverRadius:9}]},options:{responsive:true,maintainAspectRatio:false,animation:false,
  onClick:(event,elements)=>{if(elements.length){st.sel=scatter.data.datasets[0].data[elements[0].index].key;draw();}},
  plugins:{legend:{display:false},tooltip:{callbacks:{label:context=>{const s=S.find(row=>row.key===context.raw.key);return s?s.name+': '+s.leadTimeDays+' days, quality '+s.qualityScore+(s.defectRate==null?'':', defects '+s.defectRate+'%'):'Supplier';}}}},
  scales:{x:{min:0,max:40,grid:{color:'rgba(128,128,128,0.15)'},border:{display:false},title:{display:true,text:'Lead time (days)'},ticks:{color:muted}},y:{min:0,max:100,grid:{color:'rgba(128,128,128,0.15)'},border:{display:false},title:{display:true,text:'Quality score'},ticks:{color:muted}}}}});
}
function drawScatter(rows){
 if(!scatter){const canvas=document.getElementById('sc');if(canvas)canvas.parentElement.innerHTML='<p class="sb">The chart library is unavailable. Supplier records are listed above.</p>';return;}
 const points=rows.filter(s=>numeric(s.leadTimeDays)!=null&&numeric(s.qualityScore)!=null).map(s=>({x:Number(s.leadTimeDays),y:Number(s.qualityScore),key:s.key}));
 scatter.data.datasets[0].data=points;
 scatter.data.datasets[0].pointBackgroundColor=points.map(point=>qband(point.y).c);
 scatter.data.datasets[0].pointRadius=points.map(point=>point.key===st.sel?10:6);
 scatter.options.scales.x.max=Math.max(40,...points.map(point=>point.x));
 scatter.update();
}
function draw(){
 drawTypeButtons();
 const rows=filteredSuppliers();
 if(!rows.some(s=>s.key===st.sel))st.sel=rows[0]?.key||null;
 drawKpis(rows);
 if(map)drawMap(rows);
 const selected=rows.find(s=>s.key===st.sel)||null;
 drawDetails(selected);
 drawTable(rows);
 drawScatter(rows);
 sendHeight();
}
function sendHeight(){if(window.parent!==window)window.parent.postMessage({type:'supplier-dashboard-height',height:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)},location.origin);}
function fillFormFromSupplier(name){
 const supplier=S.find(s=>s.name.toLocaleLowerCase()===name.trim().toLocaleLowerCase());
 if(!supplier)return;
 document.getElementById('supplierType').value=supplier.supplierType||'';
 document.getElementById('supplierCity').value=supplier.city||'';
 document.getElementById('supplierCountry').value=supplier.country||'';
 document.getElementById('supplierLatitude').value=supplier.latitude??'';
 document.getElementById('supplierLongitude').value=supplier.longitude??'';
 document.getElementById('supplierLeadTime').value=supplier.leadTimeDays??'';
 document.getElementById('supplierQuality').value=supplier.qualityScore??'';
 document.getElementById('supplierDefectRate').value=supplier.defectRate??'';
}
function mergeSavedSupplier(profile){
 const key=String(profile.name||'').trim().toLocaleLowerCase();
 if(!key)return;
 const previous=S.find(s=>s.key===key)||{};
 const merged={key,name:profile.name,city:profile.city||'',country:profile.country||'',supplierType:profile.supplierType||'',latitude:profile.latitude,longitude:profile.longitude,leadTimeDays:profile.leadTimeDays,qualityScore:profile.qualityScore,defectRate:profile.defectRate,
  categories:previous.categories||[],items:previous.items||[],productCount:previous.productCount||0,currentProductCount:previous.currentProductCount||0,currentStock:previous.currentStock||0,currentStockValue:previous.currentStockValue||0,missingCurrentCostProducts:previous.missingCurrentCostProducts||0,inboundUnits:previous.inboundUnits||0,inboundRecords:previous.inboundRecords||0,recordedInboundCost:previous.recordedInboundCost||0,costedInboundUnits:previous.costedInboundUnits||0,averageRecordedUnitCost:previous.averageRecordedUnitCost??null,lastArrivalDate:previous.lastArrivalDate||''};
 S=[...S.filter(s=>s.key!==key),merged].sort((a,b)=>a.name.localeCompare(b.name));
 st.sel=key;selectedSupplierName=profile.name;updateControls();draw();
}
function receiveData(data){
 S=Array.isArray(data?.suppliers)?data.suppliers:[];
 supplierCategories=Array.isArray(data?.categories)?data.categories:[];
 updateControls();
 status.textContent=data?.supplierProfileWarning
  ?'Live scanner product and receipt data · saved supplier profile details are unavailable; check Firestore read rules.'
  :'Live RetailFlow data · scanner products and inbound receipts included';
 draw();
 if(selectedSupplierName){document.getElementById('supplierName').value=selectedSupplierName;fillFormFromSupplier(selectedSupplierName);}
}
searchInput.addEventListener('input',()=>{st.q=searchInput.value;draw();});
categorySelect.addEventListener('change',()=>{st.cat=categorySelect.value;draw();});
document.querySelectorAll('th.s').forEach(header=>header.addEventListener('click',()=>{const key=header.dataset.s;st.dir=st.sort===key?st.dir*-1:(key==='name'?-1:1);st.sort=key;draw();}));
document.getElementById('m1').addEventListener('click',()=>{st.color='lead';document.getElementById('m1').classList.add('on');document.getElementById('m2').classList.remove('on');draw();});
document.getElementById('m2').addEventListener('click',()=>{st.color='quality';document.getElementById('m2').classList.add('on');document.getElementById('m1').classList.remove('on');draw();});
document.getElementById('openSupplierForm').addEventListener('click',()=>{supplierFormPanel.hidden=false;supplierFormPanel.scrollIntoView({behavior:'smooth',block:'nearest'});document.getElementById('supplierName').focus();});
document.getElementById('closeSupplierForm').addEventListener('click',()=>{supplierFormPanel.hidden=true;});
document.getElementById('supplierName').addEventListener('change',event=>fillFormFromSupplier(event.target.value));
supplierForm.addEventListener('submit',event=>{
 event.preventDefault();supplierFormMessage.textContent='';
 const raw={name:document.getElementById('supplierName').value.trim(),supplierType:document.getElementById('supplierType').value.trim(),city:document.getElementById('supplierCity').value.trim(),country:document.getElementById('supplierCountry').value.trim(),latitude:document.getElementById('supplierLatitude').value.trim(),longitude:document.getElementById('supplierLongitude').value.trim(),leadTimeDays:document.getElementById('supplierLeadTime').value.trim(),qualityScore:document.getElementById('supplierQuality').value.trim(),defectRate:document.getElementById('supplierDefectRate').value.trim()};
 const numberOrNull=(value,label)=>{if(!value)return null;const number=Number(value);if(!Number.isFinite(number)){throw new Error(label+' must be a number.');}return number;};
 try{
  const latitude=numberOrNull(raw.latitude,'Latitude'),longitude=numberOrNull(raw.longitude,'Longitude');
  if((latitude==null)!==(longitude==null))throw new Error('Enter both latitude and longitude to place the supplier on the map.');
  const leadTimeDays=numberOrNull(raw.leadTimeDays,'Lead time'),qualityScore=numberOrNull(raw.qualityScore,'Quality score'),defectRate=numberOrNull(raw.defectRate,'Defect rate');
  if(latitude!=null&&(latitude < -90||latitude > 90))throw new Error('Latitude must be from -90 to 90.');
  if(longitude!=null&&(longitude < -180||longitude > 180))throw new Error('Longitude must be from -180 to 180.');
  if(leadTimeDays!=null&&(leadTimeDays<0||leadTimeDays>3650))throw new Error('Lead time must be between 0 and 3650 days.');
  if(qualityScore!=null&&(qualityScore<0||qualityScore>100))throw new Error('Quality score must be between 0 and 100.');
  if(defectRate!=null&&(defectRate<0||defectRate>100))throw new Error('Defect rate must be between 0 and 100.');
  if(window.parent===window)throw new Error('Open this page from the RetailFlow Suppliers tab to save data.');
  supplierSaveButton.disabled=true;supplierSaveButton.textContent='Saving…';
  window.parent.postMessage({type:'supplier-save',data:{...raw,latitude,longitude,leadTimeDays,qualityScore,defectRate}},location.origin);
 }catch(error){supplierFormMessage.textContent=error.message;}
});
initMap();initScatter();draw();
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==window.parent)return;
 if(event.data?.type==='supplier-data')receiveData(event.data.data);
 if(event.data?.type==='supplier-error')status.textContent=S.length?'RetailFlow connection unavailable · showing the last loaded supplier data':'Supplier data is unavailable. Check the RetailFlow connection and try again.';
 if(event.data?.type==='supplier-save-result'){
  supplierSaveButton.disabled=false;supplierSaveButton.textContent='Save supplier data';
  if(event.data.ok){mergeSavedSupplier(event.data.supplier);supplierFormMessage.textContent='Supplier data saved to RetailFlow.';}
  else {supplierFormMessage.textContent=event.data.message||'Supplier data could not be saved.';status.textContent='Supplier save failed: '+supplierFormMessage.textContent;}
 }
 if(event.data?.type==='supplier-delete-result'){
  supplierDeleteBusy=false;
  if(event.data.ok){
   const deletedName=event.data.supplier?.name||'';
   const key=deletedName.normalize('NFC').trim().toLocaleLowerCase();
   S=S.filter(s=>s.key!==key);
   if(st.sel===key)st.sel=null;
   selectedSupplierName='';
   updateControls();draw();
   supplierFormMessage.textContent='Supplier removed. Product and receipt history was kept.';
   status.textContent='Supplier '+deletedName+' removed from this dashboard; product and receipt history is retained.';
  }else{
   supplierFormMessage.textContent=event.data.message||'Supplier could not be deleted.';
   status.textContent='Supplier delete failed: '+supplierFormMessage.textContent;
   draw();
  }
 }
});
window.addEventListener('resize',sendHeight);
if('ResizeObserver'in window)new ResizeObserver(sendHeight).observe(document.body);
if(window.parent!==window)window.parent.postMessage({type:'supplier-dashboard-ready'},location.origin);
