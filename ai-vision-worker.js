/* Run DINO in a worker so camera playback and overlay tracking stay responsive. */
const TF_URL='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js';
let extractor, tf, loading, backend='wasm';
const report=text=>postMessage({type:'status',text});
async function load(){
  if(loading)return loading;
  loading=(async()=>{
    report('Loading recognition model…');
    tf=await import(TF_URL);tf.env.allowLocalModels=false;
    // No cross-origin isolation is required for the single-thread WASM fallback.
    tf.env.backends.onnx.wasm.numThreads=1;
    const options={dtype:'q8',progress_callback:p=>{if(p.status==='progress'&&p.progress)report(`Loading model · ${Math.round(p.progress)}%`);}};
    let gpuAdapter=null;
    try{gpuAdapter=await self.navigator?.gpu?.requestAdapter();}catch{}
    if(gpuAdapter){
      try{extractor=await tf.pipeline('image-feature-extraction','Xenova/dinov2-small',{...options,device:'webgpu'});backend='webgpu';}
      catch{report('GPU unavailable · loading CPU fallback…');}
    }
    if(!extractor)extractor=await tf.pipeline('image-feature-extraction','Xenova/dinov2-small',{...options,device:'wasm'});
    // Build kernels before the first customer places a product. This cannot
    // remove download time, but it moves one-time setup out of checkout.
    report('Warming up recognition…');
    try{
      const pixels=new Uint8ClampedArray(224*224*4);
      for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
      await extractor([new tf.RawImage(pixels,224,224,4)]);
    }catch(error){report('Warmup skipped · model ready');}
    report(`Model ready · ${backend==='webgpu'?'GPU':'CPU'}`);return backend;
  })().catch(e=>{loading=null;throw e;});
  return loading;
}
async function infer(images){
  await load();
  const raw=images.map(im=>new tf.RawImage(new Uint8ClampedArray(im.buffer),im.width,im.height,4));
  let output;
  try{output=await extractor(raw);}
  catch(error){
    if(backend!=='webgpu')throw error;
    await extractor.dispose?.();backend='wasm';
    report('GPU inference failed · using CPU');
    extractor=await tf.pipeline('image-feature-extraction','Xenova/dinov2-small',{dtype:'q8',device:'wasm'});
    output=await extractor(raw);
  }
  const dim=output.dims.at(-1),stride=output.data.length/images.length;
  if(dim!==384||!Number.isInteger(stride))throw new Error('Unexpected recognition model output.');
  return images.map((_,i)=>{
    const vec=Float32Array.from(output.data.subarray(i*stride,i*stride+dim));let sum=0;
    for(const n of vec)sum+=n*n;const length=Math.sqrt(sum)||1;
    for(let j=0;j<vec.length;j++)vec[j]/=length;
    return vec.buffer;
  });
}
let queue=Promise.resolve();
onmessage=({data})=>{
  queue=queue.then(async()=>{
    try{
      const started=performance.now();
      if(data.type==='load'){await load();postMessage({id:data.id,backend});return;}
      const vectors=await infer(data.images);
      postMessage({id:data.id,vectors,backend,ms:performance.now()-started},vectors);
    }catch(error){postMessage({id:data.id,error:error.message||String(error)});}
  });
};
