/* One persistent paper solid. Every visible face uses BookKinematics vertices.
 * Textures describe absolute layer depth, so a closed-book split change cannot
 * move the stripes, relight a half, or replace the fore-edge with a wider image.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./book-kinematics.js'));
  else root.PaperBookSolid=factory(root.PaperBookKinematics);
})(typeof window!=='undefined'?window:globalThis,function(K){
  'use strict';
  if(!K)throw new TypeError('PaperBookSolid requires PaperBookKinematics');
  const SEGMENTS=8,DEPTH_BANDS=5,END_BANDS=2,TILE=100,SKIN=.7,MAX_TEXTURES=160,PAPER='#f4f0e6',SHEETS=627;
  const finite=n=>Number.isFinite(n),fmt=n=>Number(n.toFixed(6)).toString();
  const noise=n=>Math.sin(n*12.9898+1.177)*.45+Math.sin(n*4.433+.7)*.25;
  const keyOf=(...values)=>values.map(v=>typeof v==='number'?v.toPrecision(12):v).join(':');
  function colour(depth,total){
    // The thin cut edge has the same stock colour through the whole block.
    // Lighting is supplied by the continuous recess and page shadows, not
    // separate colours on every tessellation triangle.
    return PAPER;
  }
  function gradientStops(total,from,to){
    const stops=[[0,colour(from,total)]];
    if(from<total/2&&to>total/2)stops.push([(total/2-from)/(to-from),colour(total/2,total)]);
    stops.push([1,colour(to,total)]);
    return stops.map(([at,color])=>`<stop offset="${fmt(at)}" stop-color="${color}"/>`).join('');
  }
  function strata(total){
    const result=[];if(!(total>0))return result;
    const pitch=total/SHEETS;
    // One fine boundary per physical sheet. Grouping seven sheets into each
    // old .39-unit stripe became five thick rails when a thin NT stack fanned.
    for(let i=1;i<SHEETS;i++){
      const depth=(i+noise(i)*.12)*pitch;
      result.push({depth,width:pitch*(.09+(noise(i+3)+.7)*.04),alpha:.07+(noise(i+7)+.7)*.035,index:i});
    }
    return result;
  }
  const uri=svg=>'url("data:image/svg+xml,'+encodeURIComponent(svg)+'")';
  function texture(total,from,to,kind){
    const span=to-from,fore=kind==='foreedge',diagonal=kind==='triangle-2';
    const width=fore?total:TILE,height=fore?K.HEIGHT:TILE;
    const axis=fore?`x1="0" y1="0" x2="${fmt(total)}" y2="0"`:diagonal?'x1="0" y1="0" x2="50" y2="50"':'x1="0" y1="0" x2="0" y2="100"';
    let paths='';
    for(const line of strata(total)){
      if(line.depth<from||line.depth>to||span<=0)continue;
      const q=(line.depth-from)/span*TILE;
      const d=fore?`M${fmt(line.depth)} 0V${K.HEIGHT}`:diagonal?`M0 ${fmt(q)}L${fmt(q)} 0`:`M0 ${fmt(q)}H100`;
      // Keep line width constant in physical layer units. The diagonal normal
      // is sqrt(2) longer in the unit artwork and needs the matching divisor.
      const strokeWidth=fore?line.width:line.width*TILE/span/(diagonal?Math.SQRT2:1);
      const dash=fore&&line.index%4?` stroke-dasharray="${19+line.index%5*9} ${7+line.index%7*5} ${51+line.index%3*17} ${11+line.index%4*7}" stroke-dashoffset="${fmt(line.index*6.7)}"`:'';
      paths+=`<path d="${d}" stroke="#8a7e68" stroke-opacity="${fmt(line.alpha)}" stroke-width="${fmt(strokeWidth)}" fill="none"${dash}/>`;
    }
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}" viewBox="0 0 ${fmt(width)} ${fmt(height)}"><defs><linearGradient id="paper" gradientUnits="userSpaceOnUse" ${axis}>${gradientStops(total,from,to)}</linearGradient></defs><rect width="100%" height="100%" fill="url(#paper)"/>${paths}</svg>`;
    return uri(svg);
  }
  function tileMatrix(triangle){
    const values=K.triangleMatrixValues(...triangle);
    for(const index of [0,1,2,4,5,6])values[index]/=TILE;
    return K.matrixCSS(values);
  }
  function shiftedEdge(side,material,close,depth){
    const m=K.foreedgeMatrixValues(side,material,close);
    m[12]+=m[0]*depth;m[13]+=m[1]*depth;m[14]+=m[2]*depth;
    return K.matrixCSS(m);
  }
  const RASTER={WIDTH:1080,HEIGHT:1080,LEFT:60,TOP:180,PERSPECTIVE:1800,CX:480,CY:352,BACK:-700};
  function project(point){
    const scale=RASTER.PERSPECTIVE/(RASTER.PERSPECTIVE-point.z);
    return {x:RASTER.CX+(point.x-RASTER.CX)*scale,y:RASTER.CY+(point.y-RASTER.CY)*scale,z:point.z};
  }
  function createRaster(host,options){
    const doc=host.ownerDocument,canvas=doc.createElement('canvas'),ctx=canvas.getContext('2d',{alpha:true});
    if(!ctx)throw new Error('A 2D canvas is required for the paper solid');
    const ratio=Math.max(1,Math.min(1.75,Number(options.pixelRatio)||Number(doc.defaultView?.devicePixelRatio)||1));
    canvas.width=Math.round(RASTER.WIDTH*ratio);canvas.height=Math.round(RASTER.HEIGHT*ratio);
    canvas.className='bs-raster';canvas.setAttribute('aria-hidden','true');
    Object.assign(canvas.style,{left:-RASTER.LEFT+'px',top:-RASTER.TOP+'px',width:RASTER.WIDTH+'px',height:RASTER.HEIGHT+'px',
      transformOrigin:(RASTER.CX+RASTER.LEFT)+'px '+(RASTER.CY+RASTER.TOP)+'px',
      transform:`translateZ(${RASTER.BACK}px) scale(${1-RASTER.BACK/RASTER.PERSPECTIVE})`});
    host.classList.add('book-solid');host.classList.add('book-solid-raster');host.setAttribute('aria-hidden','true');host.dataset.renderer='canvas-solid';host.appendChild(canvas);
    // Reuse the exact tessellator, but its persistent faces are plain records.
    // None of the hundreds of triangles enter the browser's CSS 3D scene.
    const records=[],specs=new Map(),virtualDoc={createElement(){return {_raster:true,style:{},dataset:{},hidden:true,className:'',setAttribute(){},remove(){const i=records.indexOf(this);if(i>=0)records.splice(i,1);}};}};
    const virtualHost={_raster:true,_textureSpecs:specs,ownerDocument:virtualDoc,style:{},dataset:{},children:records,
      classList:{add(){},remove(){}},setAttribute(){},appendChild(n){records.push(n);return n;}};
    const engine=create(virtualHost),textures=new Map();let destroyed=false,draws=0,lastTriangles=0,lastFaces=0;
    const tileSize=192;
    function paintedTexture(spec){
      const key=keyOf(spec.total,spec.from,spec.to,spec.kind);
      if(textures.has(key)){const t=textures.get(key);textures.delete(key);textures.set(key,t);return t;}
      const tile=doc.createElement('canvas');tile.width=tile.height=tileSize;const paint=tile.getContext('2d');
      paint.fillStyle=PAPER;paint.fillRect(0,0,tileSize,tileSize);
      const span=spec.to-spec.from,diagonal=spec.kind==='triangle-2';
      for(const line of strata(spec.total)){
        if(line.depth<spec.from||line.depth>spec.to||span<=0)continue;
        const q=(line.depth-spec.from)/span*tileSize;
        paint.strokeStyle=`rgba(138,126,104,${line.alpha})`;
        paint.lineWidth=line.width*tileSize/span/(diagonal?Math.SQRT2:1);
        paint.beginPath();paint.moveTo(0,q);if(diagonal)paint.lineTo(q,0);else paint.lineTo(tileSize,q);paint.stroke();
      }
      textures.set(key,tile);
      if(textures.size>MAX_TEXTURES){const oldest=textures.keys().next().value,text=textures.get(oldest);text.width=text.height=1;textures.delete(oldest);}
      return tile;
    }
    function affine(source,dest){
      const [p,q,r]=source,[a,b,c]=dest,det=p.x*(q.y-r.y)+q.x*(r.y-p.y)+r.x*(p.y-q.y);
      if(Math.abs(det)<1e-10)return null;
      const solve=(u,v,w)=>[(u*(q.y-r.y)+v*(r.y-p.y)+w*(p.y-q.y))/det,(u*(r.x-q.x)+v*(p.x-r.x)+w*(q.x-p.x))/det,(u*(q.x*r.y-r.x*q.y)+v*(r.x*p.y-p.x*r.y)+w*(p.x*q.y-q.x*p.y))/det];
      return {x:solve(a.x,b.x,c.x),y:solve(a.y,b.y,c.y)};
    }
    function paintTriangle(item){
      const points=item.points.map(p=>({x:p.x+RASTER.LEFT,y:p.y+RASTER.TOP}));
      const area=(points[1].x-points[0].x)*(points[2].y-points[0].y)-(points[1].y-points[0].y)*(points[2].x-points[0].x);
      if(Math.abs(area)<.00001)return;
      const cx=(points[0].x+points[1].x+points[2].x)/3,cy=(points[0].y+points[1].y+points[2].y)/3;
      // A subpixel bleed closes raster AA seams, without moving model points.
      const outline=points.map(p=>{const dx=p.x-cx,dy=p.y-cy,length=Math.hypot(dx,dy)||1;return{x:p.x+dx/length*.2,y:p.y+dy/length*.2};});
      ctx.save();ctx.setTransform(ratio,0,0,ratio,0,0);ctx.beginPath();outline.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.clip();
      if(item.kind==='leather'){
        ctx.fillStyle='#713b45';ctx.fillRect(0,0,RASTER.WIDTH,RASTER.HEIGHT);
      }else{
        ctx.fillStyle=PAPER;ctx.fillRect(0,0,RASTER.WIDTH,RASTER.HEIGHT);
        const transform=affine(item.uv,points);
        if(transform){ctx.transform(transform.x[0],transform.y[0],transform.x[1],transform.y[1],transform.x[2],transform.y[2]);ctx.drawImage(paintedTexture(item.spec),0,0);}
      }
      ctx.restore();
    }
    function render(){
      const triangles=[];lastFaces=0;
      for(const item of records){
        if(item.hidden||!item._vertices)continue;lastFaces++;
        const [a,b,d]=item._vertices,name=item.style.backgroundImage?.match(/^var\((.+)\)$/)?.[1],spec=specs.get(name),kind=item.dataset.kind;
        if(kind!=='leather'&&!spec)continue;
        const add=(vertices,uv)=>triangles.push({points:vertices.map(project),uv,spec,kind,z:vertices.reduce((sum,p)=>sum+p.z,0)/3});
        if(item._rectangle){
          const c={x:b.x+d.x-a.x,y:b.y+d.y-a.y,z:b.z+d.z-a.z};
          add([a,b,c],[{x:0,y:0},{x:tileSize,y:0},{x:tileSize,y:tileSize}]);
          add([a,c,d],[{x:0,y:0},{x:tileSize,y:tileSize},{x:0,y:tileSize}]);
        }else add([a,b,d],[{x:0,y:0},{x:tileSize,y:0},{x:0,y:tileSize}]);
      }
      triangles.sort((a,b)=>a.z-b.z);ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
      for(const item of triangles)paintTriangle(item);
      draws++;lastTriangles=triangles.length;canvas.hidden=!triangles.length;
      host.dataset.faces=String(lastFaces);host.dataset.rasterTriangles=String(lastTriangles);host.dataset.rasterDraws=String(draws);
    }
    function update(material,close,state={}){
      if(destroyed)return null;const before=engine.getStats().skipped,frame=engine.update(material,close,state);
      for(const key of ['close','paperDepth','splitDepth','fanLeft','fanRight'])host.dataset[key]=virtualHost.dataset[key];
      if(engine.getStats().skipped===before)render();return frame;
    }
    function destroy(){
      if(destroyed)return;destroyed=true;engine.destroy();for(const tile of textures.values())tile.width=tile.height=1;textures.clear();specs.clear();canvas.width=canvas.height=1;canvas.remove();host.classList.remove('book-solid-raster');host.classList.remove('book-solid');
    }
    return {update,destroy,getStats:()=>({...engine.getStats(),nodes:destroyed?0:1,virtualFaces:records.length,activeFaces:lastFaces,rasterTriangles:lastTriangles,draws,raster:true,textureCanvases:textures.size,destroyed})};
  }
  function create(host,options={}){
    if(!host||!host.ownerDocument||typeof host.ownerDocument.createElement!=='function')throw new TypeError('PaperBookSolid.create requires a DOM host with ownerDocument');
    if(options.raster)return createRaster(host,options);
    const doc=host.ownerDocument,owned=[],pool=[],paintCache=[],sideCache={},cache=new Map(),textureNames=new Set();
    let destroyed=false,textureBuilds=0,updates=0,used=0,topologyKey='',topology=[],endBands=[],lastKey='',lastFrame=null,skipped=0,skippedSides=0,textureSlots=0;
    host.classList.add('book-solid');host.setAttribute('aria-hidden','true');
    function node(){
      const item=doc.createElement('div');item.className='bs-face bs-paper-triangle';
      item.setAttribute('aria-hidden','true');item.hidden=true;host.appendChild(item);owned.push(item);return item;
    }
    function cached(total,from,to,kind){
      const key=keyOf(total,from,to,kind);
      if(cache.has(key)){const hit=cache.get(key);cache.delete(key);cache.set(key,hit);return hit.reference;}
      const image=host._raster?null:texture(total,from,to,kind);textureBuilds++;let name;
      if(cache.size>=MAX_TEXTURES){const oldest=cache.keys().next().value;name=cache.get(oldest).name;cache.delete(oldest);}
      else{name='--bs-texture-'+textureSlots++;textureNames.add(name);}
      // Each fine-line SVG is parsed/stored once on the shared host. Faces
      // contain only a short reference rather than repeating the encoded SVG.
      if(host._raster)host._textureSpecs.set(name,{total,from,to,kind});
      else if(host.style.setProperty)host.style.setProperty(name,image);else host.style[name]=image;
      const entry={name,reference:'var('+name+')'};cache.set(key,entry);return entry.reference;
    }
    function face(triangle,kind,side,from,to,image,shade=1,rectangle=false){
      let item=pool[used],paint=paintCache[used];
      if(!item){item=node();pool.push(item);paint={};paintCache.push(paint);}used++;
      if(paint.hidden!==false){item.hidden=false;paint.hidden=false;}
      const className=rectangle?'bs-face bs-paper-quad':'bs-face bs-paper-triangle';
      if(paint.className!==className){item.className=className;paint.className=className;}
      if(paint.kind!==kind){item.dataset.kind=kind;paint.kind=kind;}if(paint.side!==side){item.dataset.side=side;paint.side=side;}
      const first=String(from),last=String(to);
      if(paint.from!==first){item.dataset.firstDepth=first;paint.from=first;}if(paint.to!==last){item.dataset.lastDepth=last;paint.to=last;}
      if(item._raster){item._vertices=triangle;item._rectangle=rectangle;}
      else{const transform=tileMatrix(triangle);if(paint.transform!==transform){item.style.transform=transform;paint.transform=transform;}}
      if(paint.image!==image){item.style.backgroundImage=image;paint.image=image;}
      const color=kind==='leather'?'#713b45':PAPER;
      if(paint.color!==color){item.style.backgroundColor=color;paint.color=color;}
      if(paint.shadow!=='none'){item.style.boxShadow='none';paint.shadow='none';}
    }
    function quad(vertices,kind,side,from,to,images,shade=1){
      // Straight intervals between recesses are exact parallelograms. Keep
      // them as one rectangle, avoiding a redundant CSS layer and a seam.
      const parallelogram=(kind==='foreedge'||kind==='leather')&&['x','y','z'].every(axis=>Math.abs(vertices[2][axis]-vertices[1][axis]-vertices[3][axis]+vertices[0][axis])<1e-7);
      if(parallelogram){face([vertices[0],vertices[1],vertices[3]],kind,side,from,to,images[0],shade,true);return;}
      face([vertices[0],vertices[1],vertices[2]],kind,side,from,to,images[0],shade);
      face([vertices[0],vertices[2],vertices[3]],kind,side,from,to,images[1],shade);
    }
    function rebuildTopology(total,notches){
      const key=JSON.stringify([total,notches]);if(key===topologyKey)return;
      topologyKey=key;topology=[];endBands=[];
      const depths=Array.from({length:DEPTH_BANDS+1},(_,i)=>total*i/DEPTH_BANDS);
      for(let i=0;i<END_BANDS;i++)endBands.push({s0:total*i/END_BANDS,s1:total*(i+1)/END_BANDS,end:true});
      // Include each milled recess's deepest material layer even when its
      // absolute depth falls between the regular edge tessellation samples.
      for(const n of notches)if(n.span<total/DEPTH_BANDS*.4)depths.push(Math.max(0,Math.min(total,n.depth)));
      const sorted=[...new Set(depths)].sort((a,b)=>a-b);
      for(let band=0;band<sorted.length-1;band++){
        const s0=sorted[band],s1=sorted[band+1],ys=[0,K.HEIGHT];
        for(const n of notches){
          if(n.depth+n.span<s0||n.depth-n.span>s1)continue;
          // A visible recess has curved shoulders and a shaded inset centre.
          for(const q of [-1,-.8660254038,-.5,0,.5,.8660254038,1])ys.push(Math.max(0,Math.min(K.HEIGHT,n.y+n.radius*q)));
        }
        topology.push({s0,s1,ys:[...new Set(ys)].sort((a,b)=>a-b)});
      }
    }
    function update(material,close,state={}){
      if(destroyed)return null;
      const f=K.frame(material,close,state),total=f.totalDepth;updates++;
      rebuildTopology(total,f.notches);
      const key=[total,f.leftDepth,f.close,f.fanLeft,f.fanRight,topologyKey].join('|');
      // Pan / camera-only updates must not re-tessellate a stationary book.
      if(key===lastKey){skipped++;return lastFrame;}lastKey=key;lastFrame=f;used=0;
      host.dataset.close=fmt(f.close);host.dataset.paperDepth=fmt(total);host.dataset.splitDepth=fmt(f.leftDepth);
      host.dataset.fanLeft=fmt(f.fanLeft);host.dataset.fanRight=fmt(f.fanRight);
      rebuildTopology(total,f.notches);
      const points=K.prepare(f,close,state);
      if(total>0)for(const side of ['left','right']){
        const sideKey=[total,f.leftDepth,f.close,side==='left'?f.fanLeft:f.fanRight,topologyKey].join('|'),start=used,cachedSide=sideCache[side];
        if(cachedSide&&cachedSide.key===sideKey&&cachedSide.start===start){used+=cachedSide.count;skippedSides++;continue;}
        const [first,last]=K.layerInterval(side,f);
        for(const band of [...endBands,...topology]){
          const from=Math.max(first,band.s0),to=Math.min(last,band.s1);if(to-from<1e-9)continue;
          const images=[cached(total,from,to,'triangle-1'),cached(total,from,to,'triangle-2')];
          // Depth bands are actual different curved leaves, not one flat
          // trapezoid carrying an image of lines. Top/foot share their vertices.
          if(band.end)for(const end of ['head','foot']){
            const y=end==='head'?0:K.HEIGHT;
            for(let j=0;j<SEGMENTS;j++){
              const u0=j/SEGMENTS,u1=(j+1)/SEGMENTS;
              const v=[points.pagePoint(side,from,u0,y),points.pagePoint(side,from,u1,y),
                points.pagePoint(side,to,u1,y),points.pagePoint(side,to,u0,y)];
              const shade=.985-.045*Math.sin(Math.PI*u0)*Math.sin(Math.PI*f.close);
              quad(v,end,side,from,to,images,shade);
            }
          }
          // These vertices are the actual milled boundary of every depth
          // band. A cut reveals its curved paper wall rather than a black decal.
          if(!band.end)for(let j=0;j<band.ys.length-1;j++){
            const y0=band.ys[j],y1=band.ys[j+1];
            const v=[points.foreedgePoint(side,from,y0),points.foreedgePoint(side,from,y1),
              points.foreedgePoint(side,to,y1),points.foreedgePoint(side,to,y0)];
            const inset=points.edgeInset(side,(from+to)/2,(y0+y1)/2);
            quad(v,'foreedge',side,from,to,images,.985-Math.min(.13,inset*.006));
          }
        }
        // Leather remains a separate thin edge at the outermost actual leaf.
        const depth=side==='left'?0:total,normal=side==='left'?-1:1;
        const a=points.foreedgePoint(side,depth,0),b=points.foreedgePoint(side,depth,K.HEIGHT);
        const edge=K.foreedgeMatrixValues(side,material,close,state),shift={x:edge[0]*normal*SKIN,y:edge[1]*normal*SKIN,z:edge[2]*normal*SKIN};
        const moved=p=>({x:p.x+shift.x,y:p.y+shift.y,z:p.z+shift.z});
        quad([a,b,moved(b),moved(a)],'leather',side,depth,depth+normal*SKIN,['linear-gradient(135deg,#824550,#5b2a37)','linear-gradient(135deg,#824550,#5b2a37)']);
        sideCache[side]={key:sideKey,start,count:used-start};
      }
      if(total===0){sideCache.left=null;sideCache.right=null;}
      for(let i=used;i<pool.length;i++)if(paintCache[i].hidden!==true){pool[i].hidden=true;paintCache[i].hidden=true;}
      host.dataset.faces=String(used);return f;
    }
    function destroy(){if(destroyed)return;destroyed=true;owned.forEach(item=>item.remove());cache.clear();for(const name of textureNames){if(host.style.removeProperty)host.style.removeProperty(name);else delete host.style[name];}textureNames.clear();host.classList.remove('book-solid');}
    return {update,destroy,getStats:()=>({nodes:owned.length,activeFaces:used,textureBuilds,cacheEntries:cache.size,textureSlots,updates,skipped,skippedSides,destroyed})};
  }
  return {create,texture,strata,tileMatrix,SEGMENTS,DEPTH_BANDS,END_BANDS,TILE,SKIN,PAPER,SHEETS,RASTER,project};
});
