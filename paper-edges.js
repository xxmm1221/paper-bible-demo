/* A thin, continuous paper fore-edge, not a translated striped rectangle.
 * Dimensions are in the same 480 x 704 fixed-page coordinates as the text.
 * The independent leather lip is deliberately not included in paper depth.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperEdges=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const WIDTH=480,HEIGHT=704,MAX_DEPTH=36;
  const finite=n=>Number.isFinite(Number(n))?Number(n):0;
  const f=n=>Number(n.toFixed(4)).toString();
  const noise=i=>Math.sin(i*12.9898+4.1414)*.5+Math.sin(i*7.133)*.3;
  function geometry(side,depth){
    if(side!=='left'&&side!=='right')throw new TypeError('Paper edge side must be left or right');
    depth=Math.max(0,Math.min(MAX_DEPTH,finite(depth)));
    const sideExtent=depth*.55,bottomExtent=depth*.85;
    return {side,depth,width:WIDTH,height:HEIGHT,sideExtent,bottomExtent,
      // These are visible groups of leaves, not a fictional exact leaf count.
      lineCount:depth?Math.max(1,Math.ceil(depth*1.12)):0,
      paperBounds:{left:side==='left'?-sideExtent:0,right:side==='right'?WIDTH+sideExtent:WIDTH,
        top:0,bottom:HEIGHT+bottomExtent}};
  }
  // All contour control points remain inside the depth-derived envelope.
  // Side and foot are one rounded contour, with the foot curving gently back
  // towards the binding rather than forming a square, uniformly thick plinth.
  function contour(sx,sy,n=0){
    const bend=noise(n)*.012;
    return `M${f(-sx*.84)} 1 C${f(-sx*.96)} 108 ${f(-sx)} 478 ${f(-sx*.94)} ${f(HEIGHT-8+sy*.53)} Q${f(-sx*.91)} ${f(HEIGHT+sy*.86)} ${f(4-sx*.56)} ${f(HEIGHT+sy)} C${f(115+noise(n)*5)} ${f(HEIGHT+sy*(.95+bend))} 314 ${f(HEIGHT+sy*(.42-bend))} ${WIDTH} ${f(HEIGHT+sy*.16)}`;
  }
  function band(sx,sy){
    return `${contour(sx,sy)} L${WIDTH} ${HEIGHT} C315 ${HEIGHT} 115 ${HEIGHT} 5 ${HEIGHT} Q0 ${HEIGHT} 0 ${HEIGHT-7} L0 0 Z`;
  }
  function render(side,depth){
    const g=geometry(side,depth),sx=g.sideExtent,sy=g.bottomExtent,id='pe-'+side;
    const mirror=side==='right'?` transform="translate(${WIDTH} 0) scale(-1 1)"`:'';
    const defs=`<defs><linearGradient id="${id}-paper" gradientUnits="userSpaceOnUse" x1="0" y1="400" x2="${f(-sx)}" y2="${f(HEIGHT+sy)}"><stop stop-color="#f4f1e7"/><stop offset=".72" stop-color="#eee9dc"/><stop offset="1" stop-color="#dcd4c2"/></linearGradient><linearGradient id="${id}-leather" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#78434a"/><stop offset=".52" stop-color="#66313e"/><stop offset="1" stop-color="#502331"/></linearGradient></defs>`;
    let marks='';
    for(let i=1;i<g.lineCount;i++){
      // A deterministic irregular pitch avoids mechanically repeated striping.
      const q=(i+noise(i)*.19)/g.lineCount;
      const alpha=.11+((noise(i+9)+.8)/1.6)*.10;
      const width=.11+((noise(i+3)+.8)/1.6)*.13;
      const d=contour(sx*q,sy*q,i);
      // Most strata have long soft interruptions; a few entire contours tie
      // the rounded corner together. No solid dark line outlines each sheet.
      const dash=i%4?` stroke-dasharray="${f(40+i%7*18)} ${f(18+i%5*9)} ${f(63+i%4*15)} ${f(9+i%3*11)}" stroke-dashoffset="${f(i*19.3)}"`:'';
      marks+=`<path class="pe-leaf-line" d="${d}" fill="none" stroke="#827763" stroke-opacity="${f(alpha)}" stroke-width="${f(width)}"${dash}/>`;
      if(i%6===2)marks+=`<path class="pe-leaf-light" d="${contour(sx*(q+.006),sy*(q+.006),i)}" fill="none" stroke="#fffdf6" stroke-opacity=".4" stroke-width=".18" stroke-dasharray="77 40 135 22"/>`;
    }
    // The fine leather lip follows exactly the paper contour; it is never a
    // wide rectangle behind it. It remains present even at zero paper depth.
    const leather=`<path class="pe-leather-edge" d="${band(sx+2.1,sy+2.3)}" fill="url(#${id}-leather)"/><path class="pe-leather-highlight" d="${contour(sx+1.7,sy+1.9)}" fill="none" stroke="#b9817d" stroke-opacity=".36" stroke-width=".38"/>`;
    const paper=g.depth?`<path class="pe-paper-mass" d="${band(sx,sy)}" fill="url(#${id}-paper)"/>${marks}<path class="pe-paper-rim" d="M0 2 L0 ${HEIGHT-7} Q0 ${HEIGHT} 5 ${HEIGHT} L${WIDTH} ${HEIGHT}" fill="none" stroke="#fffdf6" stroke-opacity=".72" stroke-width=".3"/>`:'';
    return `<svg class="paper-edge-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" aria-hidden="true" focusable="false" data-paper-depth="${f(g.depth)}" data-side-extent="${f(sx)}" data-bottom-extent="${f(sy)}">${defs}<g${mirror}>${leather}${paper}</g></svg>`;
  }
  function create(host,side){
    geometry(side,0);host.classList.add('paper-edge-host');
    let key=null;
    return {update(depth){
      const g=geometry(side,depth),next=f(g.depth);
      if(key!==next){host.innerHTML=render(side,g.depth);key=next;}
      host.dataset.paperDepth=g.depth.toFixed(6);
      host.dataset.side=side;
      return g;
    },destroy(){host.innerHTML='';key=null;}};
  }
  return {geometry,render,create,WIDTH,HEIGHT,MAX_DEPTH};
});
