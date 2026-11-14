(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PaperBookScene=api;})(typeof window!=='undefined'?window:globalThis,()=>{
  'use strict';
  const clamp=n=>Math.max(0,Math.min(1,n)),mix=(a,b,t)=>a+(b-a)*t;
  const smooth=(a,b,p)=>{const t=clamp((p-a)/(b-a));return t*t*(3-2*t);};
  function sample(progress,pose,view,fitScale,rect,focusAmount=0,material={leftDepth:0,rightDepth:36}){
    const p=clamp(progress),reframe=smooth(0,.28,p),close=smooth(.18,.66,p),orbit=smooth(.61,1,p),angle=65*orbit;
    const rs=Math.min(3.2,fitScale*(pose.zoom||1));
    const edgeScale=Math.max(.18,Math.min((view.w-42)/510,(view.h-160)/740,1.18));
    let s=mix(rs,fitScale,reframe),cx=mix(pose.cx,480,reframe),cy=mix(pose.cy,352,reframe);
    const edgeX=720, depthScale=1-260/1800;
    s=mix(s,edgeScale*depthScale,orbit);cx=mix(cx,edgeX,orbit);cy=mix(cy,352,orbit);
    const f=clamp(focusAmount)*smooth(.74,1,p);
    if(rect){s=mix(s,edgeScale*depthScale*1.48,f);cx=mix(cx,edgeX+(rect.x-240)/depthScale,f);cy=mix(cy,352+(rect.y-352)/depthScale,f);}
    // Closing transfers the left stack into the right block. The reading edge
    // is actual remaining paper, never the fixed width of the full-book index.
    const paperEdge=(material.rightDepth+material.leftDepth*close)*.55;
    return {progress:p,close,orbit,angle,edgeX,scale:s,x:view.w/2-cx*s,y:view.h/2-cy*s,
      indexLeft:mix(720+paperEdge/2,480,orbit),indexScale:mix(paperEdge/480,1,orbit),indexZ:260*orbit};
  }
  return {sample,smooth,mix};
});
