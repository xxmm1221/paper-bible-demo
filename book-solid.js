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
  const SEGMENTS=12,TILE=100,SKIN=.7,MAX_TEXTURES=48;
  const finite=n=>Number.isFinite(n),fmt=n=>Number(n.toFixed(6)).toString();
  const noise=n=>Math.sin(n*12.9898+1.177)*.45+Math.sin(n*4.433+.7)*.25;
  const keyOf=(...values)=>values.map(v=>typeof v==='number'?v.toPrecision(12):v).join(':');
  function colour(depth,total){
    const t=total>0?Math.max(0,Math.min(1,depth/total)):0;
    const a=t<.5?[238,233,220]:[247,243,233],b=t<.5?[247,243,233]:[237,231,217],u=t<.5?t*2:(t-.5)*2;
    return '#'+a.map((v,i)=>Math.round(v+(b[i]-v)*u).toString(16).padStart(2,'0')).join('');
  }
  function gradientStops(total,from,to){
    const stops=[[0,colour(from,total)]];
    if(from<total/2&&to>total/2)stops.push([(total/2-from)/(to-from),colour(total/2,total)]);
    stops.push([1,colour(to,total)]);
    return stops.map(([at,color])=>`<stop offset="${fmt(at)}" stop-color="${color}"/>`).join('');
  }
  function strata(total){
    const result=[];
    // These are visible, irregular groups of thin leaves, not thick dark bars
    // pretending to be the exact 627 individual sheets at every zoom level.
    for(let i=1;i<Math.ceil(total/.39);i++){
      const depth=i*.39+noise(i)*.07;
      if(depth<=0||depth>=total)continue;
      result.push({depth,width:.036+(noise(i+3)+.7)*.018,alpha:.10+(noise(i+7)+.7)*.045,index:i});
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
  function create(host){
    if(!host||!host.ownerDocument||typeof host.ownerDocument.createElement!=='function')throw new TypeError('PaperBookSolid.create requires a DOM host with ownerDocument');
    const doc=host.ownerDocument,owned=[],sides={},cache=new Map();
    let destroyed=false,textureBuilds=0,updates=0;
    host.classList.add('book-solid');host.setAttribute('aria-hidden','true');
    function node(className,kind,side){
      const item=doc.createElement('div');item.className=className;item.dataset.kind=kind;item.dataset.side=side;
      item.setAttribute('aria-hidden','true');item.hidden=true;host.appendChild(item);owned.push(item);return item;
    }
    for(const side of ['left','right']){
      const edge=node('bs-face bs-foreedge','foreedge',side),skin=node('bs-face bs-leather-edge','leather',side),ends={};
      for(const end of ['head','foot'])ends[end]=Array.from({length:SEGMENTS},(_,segment)=>[0,1].map(triangle=>{
        const item=node('bs-face bs-paper-triangle',end,side);item.dataset.segment=String(segment);item.dataset.triangle=String(triangle);return item;
      }));
      sides[side]={edge,skin,ends};
    }
    function cached(total,from,to,kind){
      const key=keyOf(total,from,to,kind);
      if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
      const value=texture(total,from,to,kind);textureBuilds++;cache.set(key,value);
      if(cache.size>MAX_TEXTURES)cache.delete(cache.keys().next().value);
      return value;
    }
    function paint(item,image){if(item.style.backgroundImage!==image)item.style.backgroundImage=image;}
    function update(material,close){
      if(destroyed)return null;
      const f=K.frame(material,close),total=f.totalDepth;updates++;
      host.dataset.close=fmt(f.close);host.dataset.paperDepth=fmt(total);host.dataset.splitDepth=fmt(f.leftDepth);
      const foreTexture=total?cached(total,0,total,'foreedge'):'';
      for(const side of ['left','right']){
        const {edge,skin,ends}=sides[side],interval=K.layerInterval(side,f),[from,to]=interval,hasPaper=to>from;
        edge.hidden=!hasPaper;
        Object.assign(edge.style,{width:fmt(total)+'px',height:K.HEIGHT+'px',transform:K.foreedgeMatrix(side,f,f.close),
          clipPath:`polygon(${fmt(from)}px 0px,${fmt(to)}px 0px,${fmt(to)}px ${K.HEIGHT}px,${fmt(from)}px ${K.HEIGHT}px)`});
        edge.dataset.firstDepth=fmt(from);edge.dataset.lastDepth=fmt(to);
        if(total)paint(edge,foreTexture);
        // A separate submillimetre skin lip, never a front-cover rectangle.
        skin.hidden=total===0;
        Object.assign(skin.style,{width:SKIN+'px',height:K.HEIGHT+'px',transform:shiftedEdge(side,f,f.close,side==='left'?-SKIN:total)});
        const images=hasPaper?[cached(total,from,to,'triangle-1'),cached(total,from,to,'triangle-2')]:[];
        for(const end of ['head','foot']){
          const mesh=hasPaper?K.edgeMesh(side,f,f.close,end==='head'?0:K.HEIGHT,SEGMENTS):[];
          for(let segment=0;segment<SEGMENTS;segment++)for(let triangle=0;triangle<2;triangle++){
            const item=ends[end][segment][triangle];item.hidden=!hasPaper;
            if(!hasPaper)continue;
            item.style.transform=tileMatrix(mesh[segment].triangles[triangle]);paint(item,images[triangle]);
            item.dataset.firstDepth=fmt(from);item.dataset.lastDepth=fmt(to);
          }
        }
      }
      return f;
    }
    function destroy(){if(destroyed)return;destroyed=true;owned.forEach(item=>item.remove());cache.clear();host.classList.remove('book-solid');}
    return {update,destroy,getStats:()=>({nodes:owned.length,textureBuilds,cacheEntries:cache.size,updates,destroyed})};
  }
  return {create,texture,strata,tileMatrix,SEGMENTS,TILE,SKIN};
});
