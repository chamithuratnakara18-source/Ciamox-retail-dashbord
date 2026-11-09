/* Generic RT-DETRv2 object proposals. SKU recognition stays in ai-vision-worker.js. */
const TF_URL='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js';
const MODEL='onnx-community/rtdetr_v2_r18vd-ONNX';
let pipeline, loading;
async function load(){
  if(loading)return loading;
  loading=(async()=>{
    const tf=await import(TF_URL);
    tf.env.allowLocalModels=false;
    tf.env.backends.onnx.wasm.numThreads=1;
    // The small quantized model avoids competing with DINO for GPU memory.
    pipeline=await tf.pipeline('object-detection',MODEL,{device:'wasm',dtype:'q8'});
    return tf;
  })().catch(error=>{loading=null;throw error;});
  return loading;
}
onmessage=async({data})=>{
  const {id,type}=data;
  try{
    const tf=await load();
    if(type==='load'){postMessage({id,type:'ready',model:MODEL});return;}
    if(type!=='detect')return;
    const {width,height,buffer}=data;
    const raw=new tf.RawImage(new Uint8ClampedArray(buffer),width,height,4);
    const start=performance.now();
    const found=await pipeline(raw,{threshold:.28});
    const boxes=found.filter(item=>item.score>=.28).map(item=>({
      bbox:{x0:Math.max(0,item.box.xmin/width),y0:Math.max(0,item.box.ymin/height),
        x1:Math.min(1,item.box.xmax/width),y1:Math.min(1,item.box.ymax/height)},
      score:item.score,label:item.label,
    })).filter(item=>item.bbox.x1-item.bbox.x0>.025&&item.bbox.y1-item.bbox.y0>.035)
      .sort((a,b)=>b.score-a.score).slice(0,12);
    postMessage({id,type:'result',boxes,ms:Math.round(performance.now()-start)});
  }catch(error){postMessage({id,type:'error',error:error.message||String(error)});}
};
