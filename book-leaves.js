/* Printed leaves are narrow ruled surfaces of the SAME bound-book geometry.
 * A whole page is painted once with the existing natural-glyph painter. Strips
 * crop that shared texture; they never reflow, individually size, or stretch
 * scripture glyphs. The ordinary SVG returns when the leaf lies flat. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./book-kinematics.js'));
  else root.PaperBookLeaves=factory(root.PaperBookKinematics);
})(typeof window!=='undefined'?window:globalThis,function(K){
  'use strict';
  const STRIPS=32,WIDTH=480,HEIGHT=704,MAX_TEXTURES=4,SEAM_OVERLAP=.38;
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number(v)||0));
  const fmt=n=>Number(n.toFixed(7)).toString();
  function isActive(close,state={}){
    return clamp(close)>0||clamp(state.fanLeft)>0||clamp(state.fanRight)>0;
  }
  function stripMatrix(side,depth,u0,u1,material,close,state){
    const m=K.surfaceStripMatrixValues(side,depth,u0,u1,material,close,state).slice();
    if(side==='left'){
      // Geometry walks from the spine outwards, but the page's print always
      // walks left-to-right. Reverse the strip basis, not the painted letters.
      const width=(u1-u0)*WIDTH;
      m[12]+=m[0]*width;m[13]+=m[1]*width;m[14]+=m[2]*width;
      m[0]*=-1;m[1]*=-1;m[2]*=-1;
      // Flip the normal basis with the in-plane axis. Otherwise the left
      // strip is a reflection whose CSS backface test hides its printed face.
      m[8]*=-1;m[9]*=-1;m[10]*=-1;
    }
    return m;
  }
  function samples(state={}){
    const ys=new Set([0,HEIGHT]);
    for(const notch of state.notches||[]){
      const center=Number(notch.y),radius=Number(notch.radius)||13;
      if(!Number.isFinite(center)||!(radius>0))continue;
      // Closely sample the semicircle near its ends, where its tangent turns
      // fastest. Exact extrema make adjacent clipped strips share one edge.
      for(let i=0;i<=32;i++)ys.add(clamp(center-radius*Math.cos(Math.PI*i/32),0,HEIGHT));
    }
    return [...ys].sort((a,b)=>a-b);
  }
  function edgeProfile(side,depth,material,state={}){
    // A cut at another absolute layer cannot affect this page silhouette.
    // Avoid sampling all 22 groups for each of the 64 printed strips.
    const relevant=(state.notches||[]).filter(n=>Math.abs(depth-Number(n.depth))<(Number(n.span)||1.2));
    if(!relevant.length)return {edge:[],max:0};
    const edge=samples({notches:relevant}).map(y=>({y,inset:Math.max(0,Number(K.edgeInset(side,depth,y,material,state))||0)}));
    return {edge,max:Math.max(0,...edge.map(p=>p.inset))};
  }
  function stripClip(side,depth,sourceX,width,material,state={},profile){
    if(!state.notches?.length)return 'none';
    const {edge,max}=profile||edgeProfile(side,depth,material,state);
    if(max===0)return 'none';
    if(side==='left'&&sourceX>=max||side==='right'&&sourceX+width<=WIDTH-max)return 'none';
    const points=side==='left'?
      edge.map(p=>[clamp(p.inset-sourceX,0,width),p.y]).concat([[width,HEIGHT],[width,0]]):
      [[0,0],[0,HEIGHT]].concat(edge.slice().reverse().map(p=>[clamp(WIDTH-p.inset-sourceX,0,width),p.y]));
    return 'polygon('+points.map(p=>fmt(p[0])+'px '+fmt(p[1])+'px').join(',')+')';
  }
  function shade(m){
    // The sheet normal is derived from the surface basis. Only illumination
    // changes between strips; no translucent whole-book replacement is used.
    const length=Math.hypot(m[0],m[2])||1;
    const normalX=-m[2]/length,normalZ=m[0]/length;
    const light=Math.abs(normalZ)*.82+normalX*.18;
    return clamp(.12-light*.105,.012,.21);
  }
  function boundaryShade(side,depth,u,material,close,state){
    const step=.0002,lo=Math.max(0,u-step),hi=Math.min(1,u+step);
    const a=K.pagePoint(side,depth,lo,0,material,close,state),b=K.pagePoint(side,depth,hi,0,material,close,state);
    const direction=side==='left'?-1:1;
    return shade([direction*(b.x-a.x),0,direction*(b.z-a.z)]);
  }
  function create({host,paintPage,textureRatio=2.5,requestFrame,cancelFrame,retainFlat=false}={}){
    if(!host?.ownerDocument||typeof paintPage!=='function')throw new TypeError('BookLeaves requires a host and the shared page painter');
    if(!K?.surfaceStripMatrixValues||!K?.edgeInset)throw new TypeError('BookLeaves requires curved BookKinematics');
    const doc=host.ownerDocument,ratio=clamp(textureRatio,2,3),cache=new Map(),owned=[],sides={},surfaceImages={};
    const view=doc.defaultView;
    const raf=requestFrame||(view?.requestAnimationFrame?view.requestAnimationFrame.bind(view):fn=>setTimeout(fn,16));
    const caf=cancelFrame||(view?.cancelAnimationFrame?view.cancelAnimationFrame.bind(view):id=>clearTimeout(id));
    const objectURLs=view?.URL?.createObjectURL&&view?.URL?.revokeObjectURL&&view?.Blob&&view?.atob;
    let indices=[null,null],last=null,active=false,destroyed=false,paintCount=0,fontRevision=0,clipPaths=[];
    let clipDepth=NaN,clipTotal=NaN,clipNotches=null,clipRevision=null,clipBuilds=0;
    let retaining=false,hideEpoch=0,hideFrame=null;
    let activated=false,lastRenderKey=null,renderPasses=0,cacheHits=0;
    host.classList.add('book-leaves');host.setAttribute('aria-hidden','true');host.hidden=true;
    for(const side of ['left','right']){
      sides[side]=Array.from({length:STRIPS},(_,i)=>{
        const node=doc.createElement('div');node.className='bl-strip';node.dataset.side=side;node.dataset.strip=String(i);
        node.setAttribute('aria-hidden','true');host.appendChild(node);owned.push(node);return node;
      });
    }
    function texture(index){
      const key=fontRevision+':'+index;
      if(cache.has(key)){const hit=cache.get(key);cache.delete(key);cache.set(key,hit);return hit.image;}
      const canvas=doc.createElement('canvas');canvas.width=Math.round(WIDTH*ratio);canvas.height=Math.round(HEIGHT*ratio);
      paintPage(canvas,index,ratio);paintCount++;
      const data=canvas.toDataURL('image/png');let url=data,blobURL=null;
      if(objectURLs){
        // Chromium limits the expanded size of a custom property's token
        // stream. A high-resolution page can exceed it and become `none`.
        // The DOM therefore carries only a short blob URL, never the pixels.
        const binary=view.atob(data.slice(data.indexOf(',')+1)),bytes=new Uint8Array(binary.length);
        for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        blobURL=url=view.URL.createObjectURL(new view.Blob([bytes],{type:'image/png'}));
      }
      const image='url("'+url+'")';let decoded=Promise.resolve();
      if(view?.Image){
        let preload=new view.Image();preload.decoding='async';preload.src=url;
        if(preload.decode)decoded=preload.decode().catch(()=>{}).then(()=>{preload=null;});
      }
      // Raster memory is not retained after URL creation. At most four encoded
      // pages survive rapid navigation; all 32 strips share each URL string.
      canvas.width=canvas.height=1;cache.set(key,{image,blobURL,decoded});
      if(cache.size>MAX_TEXTURES){
        const pinned=new Set(indices.map(index=>fontRevision+':'+index));
        const oldest=[...cache.keys()].find(candidate=>!pinned.has(candidate))||cache.keys().next().value;
        release(cache.get(oldest));cache.delete(oldest);
      }
      return image;
    }
    function release(entry){if(entry?.blobURL)view.URL.revokeObjectURL(entry.blobURL);}
    function clearTextures(){for(const entry of cache.values())release(entry);cache.clear();}
    function bindTexture(side,image){
      if(surfaceImages[side]===image)return;
      surfaceImages[side]=image;
      if(host.style.setProperty)host.style.setProperty('--bl-image-'+side,image);
      else host.style['--bl-image-'+side]=image;
    }
    function prepare(left=indices[0],right=indices[1]){
      if(destroyed)return Promise.resolve({ready:false,destroyed:true});
      if(!Number.isInteger(left)||!Number.isInteger(right)||left<0||right<0)throw new RangeError('Prepare requires page indices');
      // Rasterisation happens synchronously here, BEFORE callers start their
      // animation clock. Await the returned promise to also finish decoding.
      const revision=fontRevision;
      const leftImage=texture(left),rightImage=texture(right);
      // Prewarming a destination must not display that scripture before the
      // selected packet starts moving. Only bind the currently assigned pages.
      if(left===indices[0])bindTexture('left',leftImage);
      if(right===indices[1])bindTexture('right',rightImage);
      const pending=[cache.get(revision+':'+left)?.decoded,cache.get(revision+':'+right)?.decoded];
      return Promise.all(pending).then(()=>{
        if(destroyed)return {ready:false,destroyed:true};
        if(fontRevision!==revision)return prepare(left,right);
        return {ready:true,paintCount};
      });
    }
    function setPages(left,right){
      if(destroyed)return;
      if(!Number.isInteger(left)||!Number.isInteger(right)||left<0||right<0)throw new RangeError('Page indices must be non-negative integers');
      if(indices[0]===left&&indices[1]===right)return;
      indices=[left,right];
      if(last&&(active||retaining))update(last.material,last.close,last.state);
    }
    function cancelHandoff(){
      hideEpoch++;if(hideFrame!==null){caf(hideFrame);hideFrame=null;}
    }
    function retireAfterPaint(){
      cancelHandoff();const epoch=hideEpoch;
      // The restored SVG can take a compositor frame to rasterize after its
      // opacity changed from zero. Keep the NEW flat textures for two frames,
      // never the last curved pose. Starting another movement cancels this.
      hideFrame=raf(()=>{if(destroyed||epoch!==hideEpoch)return;
        hideFrame=raf(()=>{if(destroyed||epoch!==hideEpoch||active)return;
          hideFrame=null;retaining=false;host.hidden=true;host.style.transform='none';host.style.transformOrigin='0 0';host.dataset.handoff='complete';
        });
      });
    }
    function update(material,close,state={}){
      if(destroyed)return {active:false,destroyed:true};
      const amount=clamp(close),m=K.frame(material,amount),depth=m.leftDepth;
      const wasActive=active;
      const validPages=indices.every(Number.isInteger),curved=isActive(amount,state);
      if(validPages&&curved)activated=true;
      last={material,close:amount,state};active=validPages&&(curved||retainFlat&&activated);
      if(active){cancelHandoff();retaining=false;host.style.transform='none';host.style.transformOrigin='0 0';host.dataset.handoff='curved';}
      else if(wasActive||retaining){
        retaining=true;
        // Flat SVG ink uses an isolated z=300 compositor plane. The brief
        // texture handoff sits above that ink but below z=320 silk, with an
        // exact inverse-perspective scale so no printed pixel moves.
        host.style.transformOrigin='480px 352px';
        host.style.transform='translateZ(310px) scale(.827777777778)';host.dataset.handoff='flat';
      }
      host.hidden=!(active||retaining);host.dataset.active=String(active);host.dataset.close=fmt(amount);
      host.dataset.fanLeft=fmt(clamp(state.fanLeft));host.dataset.fanRight=fmt(clamp(state.fanRight));
      if(!active&&!retaining)return {active:false,strips:owned.length};
      // The camera lives outside this surface. Panning or zooming an unchanged
      // book must not rebuild 64 matrices, gradients, or their style strings.
      // Pages and font revision are explicit so content updates cannot hit a
      // stale geometry-only cache. Notch arrays are immutable model data.
      const renderKey=[depth,m.rightDepth,m.totalDepth,amount,clamp(state.fanLeft),clamp(state.fanRight),
        state.notches,state.notchesRevision,indices[0],indices[1],fontRevision];
      if(lastRenderKey&&renderKey.every((value,i)=>value===lastRenderKey[i])){
        cacheHits++;if(retaining)retireAfterPaint();return {active,retaining,strips:owned.length,cached:true};
      }
      lastRenderKey=renderKey;renderPasses++;
      // Notch descriptors are immutable model data. Replacing that array (or
      // bumping notchesRevision) invalidates it; bending/fan time alone does
      // not rebuild clip polygons, stringify the model, or rasterize a page.
      if(depth!==clipDepth||m.totalDepth!==clipTotal||state.notches!==clipNotches||state.notchesRevision!==clipRevision){
        clipDepth=depth;clipTotal=m.totalDepth;clipNotches=state.notches;clipRevision=state.notchesRevision;clipPaths=[];clipBuilds++;
        for(const side of ['left','right']){
          const profile=edgeProfile(side,depth,m,state);
          for(let i=0;i<STRIPS;i++){
            const width=WIDTH/STRIPS,sourceX=side==='left'?WIDTH-(i+1)*width:i*width;
            const overlap=sourceX+width<WIDTH?SEAM_OVERLAP:0;
            clipPaths.push(stripClip(side,depth,sourceX,width+overlap,m,state,profile));
          }
        }
      }
      let clipIndex=0;
      for(const [side,page] of [['left',indices[0]],['right',indices[1]]]){
        const image=texture(page);
        // Store each encoded image ONCE, not in 32 separate inline attributes.
        // Besides parsing/compositor pressure, repeated data URLs inflated DOM
        // inspection messages by tens of megabytes at high texture ratios.
        bindTexture(side,image);
        const lighting=Array.from({length:STRIPS+1},(_,i)=>boundaryShade(side,depth,i/STRIPS,m,amount,state));
        for(let i=0;i<STRIPS;i++){
          const u0=i/STRIPS,u1=(i+1)/STRIPS,width=WIDTH/STRIPS;
          const sourceX=side==='left'?WIDTH-(i+1)*width:i*width,node=sides[side][i];
          const values=stripMatrix(side,depth,u0,u1,m,amount,state);
          const first=lighting[side==='left'?i+1:i],end=lighting[side==='left'?i:i+1];
          const overlap=sourceX+width<WIDTH?SEAM_OVERLAP:0;
          // Shared boundary normals make illumination C0-continuous between
          // strips. A 0.38-unit texture bleed closes raster cracks, without
          // changing material endpoints or scaling any letters.
          Object.assign(node.style,{width:fmt(width+overlap)+'px',height:HEIGHT+'px',
            transform:K.matrixCSS(values),clipPath:clipPaths[clipIndex++],
            backgroundImage:`linear-gradient(90deg,rgba(49,39,23,${fmt(first)}) 0px,rgba(49,39,23,${fmt(end)}) ${width}px),var(--bl-image-${side})`,
            backgroundSize:`100% 100%,${WIDTH}px ${HEIGHT}px`,backgroundPosition:`0 0,${fmt(-sourceX)}px 0`});
          node.dataset.sourceX=fmt(sourceX);node.dataset.depth=fmt(depth);
        }
      }
      if(retaining)retireAfterPaint();
      return {active,retaining,strips:owned.length};
    }
    function refreshFonts(){
      if(destroyed)return;fontRevision++;clearTextures();
      if(last&&(active||retaining))update(last.material,last.close,last.state);
    }
    doc.fonts?.ready?.then?.(refreshFonts);
    doc.fonts?.addEventListener?.('loadingdone',refreshFonts);
    function destroy(){
      if(destroyed)return;destroyed=true;cancelHandoff();retaining=false;doc.fonts?.removeEventListener?.('loadingdone',refreshFonts);
      owned.forEach(node=>node.remove());clearTextures();host.hidden=true;host.classList.remove('book-leaves');
      for(const side of ['left','right']){
        if(host.style.removeProperty)host.style.removeProperty('--bl-image-'+side);else delete host.style['--bl-image-'+side];
        delete surfaceImages[side];
      }
    }
    return {setPages,prepare,update,destroy,getStats:()=>({active,retaining,retainFlat:!!retainFlat,activated,strips:owned.length,paintCount,cacheEntries:cache.size,fontRevision,clipBuilds,renderPasses,cacheHits,ratio,objectURLs:!!objectURLs,destroyed})};
  }
  return {create,STRIPS,WIDTH,HEIGHT,MAX_TEXTURES,SEAM_OVERLAP,isActive,stripMatrix,stripClip,edgeProfile,samples,shade,boundaryShade};
});
