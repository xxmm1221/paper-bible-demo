/* Camera only. Paper and labels retain their own 3D geometry.
 * The closed fore-edge keeps its true thickness; no widened directory card. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PaperBookScene=api;})(typeof window!=='undefined'?window:globalThis,()=>{
  'use strict';
  const clamp=n=>Math.max(0,Math.min(1,Number(n)||0)),mix=(a,b,t)=>a+(b-a)*t;
  const finite=(n,fallback)=>Number.isFinite(Number(n))?Number(n):fallback;
  const smooth=(a,b,p)=>{const t=clamp((p-a)/(b-a));return t*t*(3-2*t);};
  const WIDTH=480,HEIGHT=704,PERSPECTIVE=1800;
  function sample(progress,pose,view,fitScale,rect,focusAmount=0,material={leftDepth:0,rightDepth:36},options={}){
    const p=clamp(progress),reframe=smooth(0,.30,p),close=smooth(.12,.86,p),approach=smooth(.66,1,p);
    const leftAngle=90*close,rightAngle=-leftAngle;
    const foreedgeZ=WIDTH*Math.sin(leftAngle*Math.PI/180),depthScale=1-foreedgeZ/PERSPECTIVE;
    const w=Math.max(0,finite(view?.w,0)),h=Math.max(0,finite(view?.h,0));
    const fit=Math.max(.01,finite(fitScale,.18));
    const readingScale=Math.min(3.2,fit*Math.max(.01,finite(pose?.zoom,1)));
    const digital=clamp(options.digital),focus=clamp(focusAmount)*smooth(.86,1,p)*(1-digital);
    const totalDepth=Math.max(.001,finite(material.totalDepth,finite(material.leftDepth,0)+finite(material.rightDepth,36)));
    // Accept an absolute paper depth or its closed-book world x coordinate.
    const fallbackDepth=finite(rect?.x,totalDepth/2);
    const rawDepth=finite(rect?.depth,finite(rect?.anchorDepth,
      fallbackDepth>=0&&fallbackDepth<=totalDepth?fallbackDepth:fallbackDepth-WIDTH+totalDepth/2));
    const selectedDepth=Math.max(0,Math.min(totalDepth,rawDepth));
    const physicalScale=(w<600?2.6:2.4)*(1+.18*focus);
    const digitalScale=Math.max(.18,Math.min((w-42)/510,(h-160)/740,1.18));
    const visibleHeight=Math.max(64,h-160)/physicalScale;
    const halfHeight=Math.min(HEIGHT/2,visibleHeight/2);
    const requestedY=mix(finite(options.edgeY,HEIGHT/2),finite(rect?.y,finite(options.edgeY,HEIGHT/2)),focus);
    const physicalY=Math.max(halfHeight,Math.min(HEIGHT-halfHeight,requestedY));
    const edgeCenterY=mix(physicalY,HEIGHT/2,digital);
    const edgeCenterX=WIDTH+(selectedDepth-totalDepth/2)*focus;
    const projectedCenterX=WIDTH+(edgeCenterX-WIDTH)/depthScale;
    const projectedCenterY=HEIGHT/2+(edgeCenterY-HEIGHT/2)/depthScale;
    const presentedScale=mix(physicalScale,digitalScale,digital)*depthScale;
    let scale=mix(readingScale,fit,reframe);
    let cameraCenterX=mix(finite(pose?.cx,WIDTH),WIDTH,reframe);
    let cameraCenterY=mix(finite(pose?.cy,HEIGHT/2),HEIGHT/2,reframe);
    scale=mix(scale,presentedScale,approach);
    cameraCenterX=mix(cameraCenterX,projectedCenterX,approach);
    cameraCenterY=mix(cameraCenterY,projectedCenterY,approach);
    return {progress:p,close,orbit:approach,angle:0,leftAngle,rightAngle,edgeX:WIDTH,
      scale,x:w/2-cameraCenterX*scale,y:h/2-cameraCenterY*scale,cameraCenterX,cameraCenterY,
      // Labels already carry their real world matrix. The parent stays identity.
      indexLeft:0,indexScale:1,indexZ:0,indexOpacity:1,readingEdgeOpacity:1,
      foreedgeZ,depthScale,edgeCenterX,edgeCenterY,edgePixelsPerUnit:scale/depthScale,
      physicalScale,digitalScale,digital,selectedDepth};
  }
  return {sample,smooth,mix,WIDTH,HEIGHT,PERSPECTIVE};
});
