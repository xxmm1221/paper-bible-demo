(function (root) {
  'use strict';
  function classify(g) {
    const dx=g.end.x-g.start.x, dy=g.end.y-g.start.y;
    const dt=Math.max(1,g.end.t-g.start.t);
    const horizontal=Math.abs(dx)>=42 && Math.abs(dx)>Math.abs(dy)*1.65;
    const fast=dt<=680 && Math.abs(dx)/dt>=0.48 && Math.abs(g.vx)>=0.34;
    const allowed=(g.side==='left'&&dx>0)||(g.side==='right'&&dx<0);
    if(g.cancelled||g.pinched||g.slowLocked||!horizontal||!fast||!allowed)
      return {type:'pan',reason:g.pinched?'pinch':!allowed&&horizontal?'direction':'slow'};
    return {type:'turn',direction:dx<0?1:-1,fingers:g.fingers};
  }
  function burst(previous, now, direction, fingers) {
    if(fingers!==2)return {count:1,level:0,at:now,direction};
    const level=previous&&previous.level>0&&previous.direction===direction&&now-previous.at<1250
      ?Math.min(3,previous.level+1):1;
    return {count:[0,5,10,20][level],level,at:now,direction};
  }
  function bounds(view, scale) {
    const w=960*scale,h=704*scale,pad=22;
    return {minX:w<view.w?(view.w-w)/2:view.w-w-pad,maxX:w<view.w?(view.w-w)/2:pad,
      minY:h<view.h?(view.h-h)/2:view.h-h-pad,maxY:h<view.h?(view.h-h)/2:pad};
  }
  const api={classify,burst,bounds};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.PaperGestures=api;
})(typeof window!=='undefined'?window:globalThis);
