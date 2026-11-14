(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PaperBookScene=api;})(typeof window!=='undefined'?window:globalThis,()=>{
  'use strict';
  const clamp=n=>Math.max(0,Math.min(1,n)),mix=(a,b,t)=>a+(b-a)*t;
  const smooth=(a,b,p)=>{const t=clamp((p-a)/(b-a));return t*t*(3-2*t);};
  function sample(progress,pose,view,fitScale,rect,focusAmount=0,material={leftDepth:0,rightDepth:36}){
    // Both halves hinge at x=480. Neither half crosses 90 degrees, so the
    // reader never travels over a front cover. `orbit` is retained as the
    // fore-edge presentation progress for existing consumers, not a rotation.
    const p=clamp(progress),reframe=smooth(0,.30,p),close=smooth(.16,.82,p),orbit=smooth(.58,1,p);
    const leftAngle=88*close,rightAngle=-leftAngle,angle=0;
    const radians=leftAngle*Math.PI/180;
    const tipX=480+480*Math.cos(radians),tipZ=480*Math.sin(radians);
    // This plane follows the rising page tips, then opens into a readable
    // close-up of the SAME index. A two-unit lift avoids z-fighting at closure.
    const indexZ=tipZ+2*orbit,depthScale=1-indexZ/1800,edgeX=480;
    const rs=Math.min(3.2,fitScale*(pose.zoom||1));
    const edgeScale=Math.max(.18,Math.min((view.w-42)/510,(view.h-160)/740,1.18));
    let s=mix(rs,fitScale,reframe),cx=mix(pose.cx,480,reframe),cy=mix(pose.cy,352,reframe);
    s=mix(s,edgeScale*depthScale,orbit);cx=mix(cx,edgeX,orbit);cy=mix(cy,352,orbit);
    const f=clamp(focusAmount)*smooth(.78,1,p);
    if(rect){s=mix(s,edgeScale*depthScale*1.48,f);cx=mix(cx,edgeX+(rect.x-240)/depthScale,f);cy=mix(cy,352+(rect.y-352)/depthScale,f);}
    // This is the projected width of the two adjoining fore-edges, not a
    // transfer of sheets from one paper block into the other. The caller keeps
    // leftDepth/rightDepth intact while rotating their respective halves.
    const paperEdge=(material.rightDepth+material.leftDepth*close)*.55;
    const indexCenter=mix(tipX+paperEdge/2,edgeX,orbit);
    return {progress:p,close,orbit,angle,leftAngle,rightAngle,edgeX,scale:s,x:view.w/2-cx*s,y:view.h/2-cy*s,
      indexLeft:indexCenter-240,indexScale:mix(paperEdge/480,1,orbit),indexZ,
      indexOpacity:smooth(.38,.76,p),readingEdgeOpacity:1-smooth(.60,.82,p)};
  }
  return {sample,smooth,mix};
});
