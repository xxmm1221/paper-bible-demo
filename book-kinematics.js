/* Bound-book geometry in one world coordinate system.
 * s is an ABSOLUTE position through the paper block, not a UI tab position.
 * At complete closure every point is independent of the chosen opening split.
 * A new split can therefore be selected without moving/replacing the book.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperBookKinematics=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const WIDTH=480,HEIGHT=704,DEFAULT_DEPTH=36;
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const sign=side=>{if(side==='left')return -1;if(side==='right')return 1;throw new TypeError('Book side must be left or right');};
  const taper=u=>u*(2-u);
  function frame(material={},close=0){
    const hasTotal=material&&Number.isFinite(Number(material.totalDepth));
    const inferred=finite(material?.leftDepth)+finite(material?.rightDepth);
    const totalDepth=Math.max(0,hasTotal?Number(material.totalDepth):inferred>0?inferred:DEFAULT_DEPTH);
    const leftDepth=clamp(finite(material?.leftDepth),0,totalDepth),rightDepth=totalDepth-leftDepth;
    const progress=clamp(finite(close),0,1),theta=progress*Math.PI/2;
    // Exact endpoints matter: a 90-degree split change must not introduce even
    // a tiny cos(pi/2)-dependent label displacement or expose a different face.
    const sine=progress===0?0:progress===1?1:Math.sin(theta);
    const cosine=progress===0?1:progress===1?0:Math.cos(theta);
    return {close:progress,theta,sine,cosine,totalDepth,leftDepth,rightDepth,
      hingeX:WIDTH+(leftDepth-totalDepth/2)*sine,
      A:sine+.55*cosine*cosine,B:.85*cosine,C:.55*cosine*sine-cosine};
  }
  function at(side,s,u,y,f){
    const direction=sign(side),layer=clamp(finite(s),0,f.totalDepth);
    const across=clamp(finite(u),0,1),t=taper(across),d=direction*(layer-f.leftDepth);
    // Side is explicit so the active leaf (s === split) has two distinct
    // fore-edges while open. Callers clip a side to its owned layer interval.
    const a=f.sine+.55*f.cosine*f.cosine*t;
    const b=.85*f.cosine*t,c=.55*f.cosine*f.sine*t-f.cosine;
    return {x:f.hingeX+direction*WIDTH*across*f.cosine+(layer-f.leftDepth)*a,
      y:finite(y)+d*b,z:WIDTH*across*f.sine+d*c};
  }
  function pagePoint(side,s,u,y,material,close){return at(side,s,u,y,frame(material,close));}
  function foreedgePoint(side,s,y,material,close){return pagePoint(side,s,1,y,material,close);}
  function layerInterval(side,material){
    const f=frame(material,0);return sign(side)<0?[0,f.leftDepth]:[f.leftDepth,f.totalDepth];
  }
  function affine(origin,xAxis,yAxis,zAxis){
    return [xAxis.x,xAxis.y,xAxis.z,0,yAxis.x,yAxis.y,yAxis.z,0,
      zAxis.x,zAxis.y,zAxis.z,0,origin.x,origin.y,origin.z,1];
  }
  function matrixCSS(values){
    if(!Array.isArray(values)||values.length!==16||values.some(v=>!Number.isFinite(v)))throw new TypeError('A finite 4x4 matrix is required');
    return 'matrix3d('+values.map(v=>Math.abs(v)<1e-12?'0':v.toFixed(12).replace(/\.?0+$/,'')).join(',')+')';
  }
  function transformPoint(values,x,y,z=0){
    return {x:values[0]*x+values[4]*y+values[8]*z+values[12],
      y:values[1]*x+values[5]*y+values[9]*z+values[13],
      z:values[2]*x+values[6]*y+values[10]*z+values[14]};
  }
  function topMatrixValues(side,material,close){
    const f=frame(material,close),direction=sign(side),left=direction<0;
    // Both input pages use local x in [0,480], y in [0,704]. These are world
    // transforms, so their DOM hosts sit at left:0/top:0 with origin:0 0.
    return affine({x:left?f.hingeX-WIDTH*f.cosine:f.hingeX,y:0,z:left?WIDTH*f.sine:0},
      {x:f.cosine,y:0,z:direction*f.sine},{x:0,y:1,z:0},{x:-direction*f.sine,y:0,z:f.cosine});
  }
  function topMatrix(side,material,close){return matrixCSS(topMatrixValues(side,material,close));}
  function foreedgeMatrixValues(side,material,close){
    const f=frame(material,close),direction=sign(side);
    // The plane's local x is absolute layer s; no normalization to an artwork
    // width and no horizontal enlargement of the closed paper block.
    const origin={x:f.hingeX+direction*WIDTH*f.cosine-f.leftDepth*f.A,
      y:-direction*f.leftDepth*f.B,z:WIDTH*f.sine-direction*f.leftDepth*f.C};
    const xAxis={x:f.A,y:direction*f.B,z:direction*f.C};
    const length=Math.hypot(f.C,f.A)||1;
    return affine(origin,xAxis,{x:0,y:1,z:0},{x:-direction*f.C/length,y:0,z:f.A/length});
  }
  function foreedgeMatrix(side,material,close){return matrixCSS(foreedgeMatrixValues(side,material,close));}
  function triangleMatrixValues(a,b,c){
    const x={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},y={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z};
    const z={x:x.y*y.z-x.z*y.y,y:x.z*y.x-x.x*y.z,z:x.x*y.y-x.y*y.x};
    const length=Math.hypot(z.x,z.y,z.z)||1;z.x/=length;z.y/=length;z.z/=length;
    return affine(a,x,y,z);
  }
  function edgeMesh(side,material,close,y=HEIGHT,segments=24){
    const f=frame(material,close),interval=layerInterval(side,material),count=clamp(Math.floor(finite(segments,24)),1,128);
    if(interval[0]===interval[1])return [];
    const result=[];
    for(let i=0;i<count;i++){
      const u0=i/count,u1=(i+1)/count;
      const vertices=[at(side,interval[0],u0,y,f),at(side,interval[0],u1,y,f),
        at(side,interval[1],u1,y,f),at(side,interval[1],u0,y,f)];
      result.push({u0,u1,s0:interval[0],s1:interval[1],vertices,
        triangles:[[vertices[0],vertices[1],vertices[2]],[vertices[0],vertices[2],vertices[3]]]});
    }
    return result;
  }
  function bottomMesh(side,material,close,segments=24){return edgeMesh(side,material,close,HEIGHT,segments);}
  function headMesh(side,material,close,segments=24){return edgeMesh(side,material,close,0,segments);}
  return {WIDTH,HEIGHT,DEFAULT_DEPTH,frame,taper,pagePoint,foreedgePoint,layerInterval,
    topMatrix,topMatrixValues,foreedgeMatrix,foreedgeMatrixValues,matrixCSS,transformPoint,
    triangleMatrixValues,edgeMesh,bottomMesh,headMesh};
});
