(() => {
  'use strict';
  const $=id=>document.getElementById(id), D=window.BIBLE_DATA, G=window.PaperGestures;
  const stage=$('stage'),book=$('book'), papers=[$('left-paper'),$('right-paper')];
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const Physics=window.PaperPhysics, Material=window.PaperBookMaterial;
  let material=null,ribbons=null,lastSceneFrame=null,edgeY=352,edgeDrag=null;
  let fanSide=null,fanAmount=0,fanCamera=0,fanY=352,fanBackPose=null;
  const K=window.PaperBookKinematics;
  let spread=0,scale=1,x=0,y=0,fitScale=1,mode='open',focus='fit',gesture=null;
  let burstState=null,feedbackTimer,demoBusy=false,lastTap=null;
  let fold=null,holdTimer=null,foldFrame=0,queuedTurns=[];
  let view={w:0,h:0},lastSaved=null;
  let sceneProgress=0,digitalProgress=0,focusAmount=0,focusRect=null,sceneState='reading';
  let navEpoch=0,navFrame=0,navCancel=null,readPose=null,demoEpoch=0,tapTimer=null;
  const pointers=new Map();
  try{lastSaved=JSON.parse(localStorage.getItem('paper-bible-position-v1'));spread=clamp((lastSaved?.spread||0)&~1,0,D.pages.length-2);}catch{}

  const Page=window.PaperPage;
  function svgPage(p,index){
    const svg=Page.svg(p,index,D.books),m=Material.compute(index&~1,D.pages.length,D.books);
    const clip=window.PaperBookLeaves.stripClip(index%2?'right':'left',m.leftDepth,0,480,m,{notches});
    if(clip==='none')return svg;
    // Clip the vector paint internally. A CSS clip-path on a whole 3D article
    // creates an extra flattened compositor surface that can retain stale
    // occlusion tiles after returning from a fully closed, edge-on book.
    const points=clip.slice(8,-1).replaceAll('px','').replaceAll(',',' '),id='paper-cut-'+index;
    return svg.replace('</defs>',`<clipPath id="${id}"><polygon points="${points}"/></clipPath></defs><g clip-path="url(#${id})">`).replace('</svg>','</g></svg>');
  }
  function paintPage(canvas,index,ratio){Page.paint(canvas,D.pages[index],index,D.books,ratio);}
  const sheetRenderer=new window.PaperSheetRenderer(book,paintPage);
  sheetRenderer.onContextLoss=()=>{abortFold();feedback('绘图暂时中断，请刷新页面后重试');};
  function clearHold(){clearTimeout(holdTimer);holdTimer=null;}
  function startFold(direction,contact,count=1,source='manual',originSurface=null){
    if(fold)return false;
    const target=clamp(spread+direction*count*2,0,D.pages.length-2);
    if(target===spread){feedback(direction>0?'已经到全书最后了':'已经到全书最前了');return false;}
    const side=direction>0?1:0,front=spread+side,back=direction>0?target:target+1,under=direction>0?target+1:target;
    const f={from:spread,target,direction,count:Math.abs(target-spread)/2,side,source,radius:clamp(Math.abs(contact.x-480),12,476),grabY:clamp(contact.y,0,704),vertical:0,progress:0,velocity:0,samples:[],settling:false,original:papers[side].innerHTML,originSurface};
    fold=f;sheetRenderer.prepare(front,back,direction,f.count);
    // Decode both final faces while the packet moves, not on its last frame.
    leaves.prepare?.(target,target+1);
    papers[side].innerHTML=svgPage(D.pages[under],under);papers[side].classList.add('under-curl');
    leaves.setPages(direction>0?spread:under,direction>0?under:spread+1);
    book.classList.add('curl-active');stage.dataset.foldState=source==='manual'?'held':'automatic';
    // Pointer timestamps may predate texture preparation; begin velocity sampling
    // only with real input samples, rather than mixing input and render clocks.
    updateFold(source==='manual'?.006:0,0);
    return true;
  }
  function updateFold(progress,vertical,t){
    if(!fold)return;const f=fold;f.progress=clamp(progress,0,1);f.vertical=clamp(vertical,-210,210);
    if(t!==undefined){f.samples.push({p:f.progress,t});while(f.samples.length>2&&t-f.samples[0].t>140)f.samples.shift();const first=f.samples[0];f.velocity=(f.progress-first.p)/Math.max(1,t-first.t)*1000;}
    sheetRenderer.draw({progress:f.progress,radius:f.radius,grabY:f.grabY,vertical:f.vertical,originSurface:f.originSurface});
    stage.dataset.foldProgress=f.progress.toFixed(4);
    const turningMaterial=Material.sampleTurn(f.from,f.direction,f.count,f.progress,D.pages.length,D.books);
    if(f.originSurface){const t=f.progress*f.progress*(3-2*f.progress);fanAmount=1-t;fanCamera=1-t;paintScene(turningMaterial);}
    else applyMaterial(turningMaterial);
  }
  function finishFold(commit){
    if(!fold)return;const f=fold;cancelAnimationFrame(foldFrame);foldFrame=0;
    sheetRenderer.hide();book.classList.remove('curl-active');papers[f.side].classList.remove('under-curl');fold=null;
    if(f.originSurface){fanAmount=fanCamera=commit?0:1;if(!commit)readPose=fanBackPose;}
    if(commit){spread=f.target;render();if(f.originSurface){fanSide=null;completeReading();}save();feedback(`${f.direction>0?'向后':'向前'}翻 ${f.count} 页${f.source==='two'?' · 双指快翻':''}`);}
    else{papers[f.side].innerHTML=f.original;leaves.setPages(spread,spread+1);if(f.originSurface){setSceneState('fan');paintScene();}else applyMaterial();feedback('轻轻放回 · 仍在原来这一页');}
    stage.dataset.foldState=commit?'committed':'returned';delete stage.dataset.foldProgress;
    $('touch-ring').style.display='none';$('touch-ring').classList.remove('holding');
    if(queuedTurns.length){const args=queuedTurns.shift();turn(...args);}
    f.afterReturn?.();
  }
  function abortFold(){clearHold();queuedTurns=[];if(fold)finishFold(false);}
  function settleFold(commit,automatic=false){
    if(!fold||fold.settling)return;
    const f=fold;f.settling=true;const target=commit?1:0,start=f.progress,dy=f.vertical,started=performance.now();let last=started,velocity=clamp(f.velocity,-2.4,2.4),packetElapsed=0;
    stage.dataset.foldState=commit?'settling-forward':'settling-back';
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduced&&automatic){finishFold(commit);return;}
    function frame(now){
      if(fold!==f)return;const step=now-last,dt=step/1000;packetElapsed+=Math.min(48,step);const elapsed=f.originSurface?packetElapsed:now-started;last=now;
      let p,done;
      if(automatic){const t=clamp(elapsed/(f.originSurface?1450:f.count>1?360:460),0,1);p=start+(target-start)*(1-Math.cos(t*Math.PI))/2;done=t===1;}
      else{const next=Physics.spring(f.progress,velocity,target,dt);p=next.position;velocity=next.velocity;done=next.done||elapsed>1250;}
      updateFold(p,dy*Math.exp(-elapsed/130));
      if(done){updateFold(target,0);finishFold(commit);}else foldFrame=requestAnimationFrame(frame);
    }
    foldFrame=requestAnimationFrame(frame);
  }
  function currentBook(){return D.books[Math.max(0,D.pages[spread+1].b)];}
  function progress(){return (spread+1)/(D.pages.length-1);}
  function render(){
    papers[0].innerHTML=svgPage(D.pages[spread],spread);
    papers[1].innerHTML=svgPage(D.pages[spread+1],spread+1);
    leaves.setPages(spread,spread+1);
    const b=currentBook(),ref=D.pages[spread+1].start||'1:1';
    $('book-name').textContent=b.name;
    const endRef=D.pages[spread+1].end||ref;
    $('chapter-name').textContent=`${ref.split(':')[0]===endRef.split(':')[0]?'第 '+ref.split(':')[0]:ref.split(':')[0]+'–'+endRef.split(':')[0]} 章`;
    $('page-label').textContent=spread===0?'卷首 — 1':`${spread} — ${spread+1}`;
    $('progress-label').textContent=`${b.short} · 全书 ${Math.round(progress()*100)}%`;
    const p=progress();
    applyMaterial();
    $('read-block').style.width=`${p*100}%`;
    $('position-pin').style.left=`${p*100}%`;

    $('prev').disabled=spread===0;$('next').disabled=spread>=D.pages.length-2;
    document.querySelectorAll('.index-tab').forEach(btn=>{
      const yes=btn.dataset.code===b.code;btn.classList.toggle('current',yes);btn.setAttribute('aria-current',yes?'true':'false');
    });
    stage.dataset.spread=String(spread);stage.dataset.book=b.code;
    ribbons?.update();
  }
  function paintIndexGeometry(f){
    $('index-placement').style.left='0px';
    $('physical-index-host').style.transform='none';
    index.setSurfaceFrame({material,close:f.close,...surfaceState()});
  }
  function surfaceState(){return {fanLeft:fanSide==='left'?fanAmount:0,fanRight:fanSide==='right'?fanAmount:0,notches};}
  function applyMaterial(next,sceneFrame){
    material=next||Material.compute(spread,D.pages.length,D.books);
    const f=sceneFrame||window.PaperBookScene.sample(sceneProgress,readPose||capturePose(),view,fitScale,focusRect,focusAmount,material,{digital:digitalProgress,edgeY});
    const joined=f.close,leftDepth=material.leftDepth,rightDepth=material.rightDepth;
    const lx=leftDepth*.55,rx=rightDepth*.55,ly=leftDepth*.85,ry=rightDepth*.85;
    $('left-stack').style.transform=`translate(${-lx}px,${ly}px)`;
    $('right-stack').style.transform=`translate(${rx}px,${ry}px)`;
    document.querySelector('.cover-left').style.transform=`translate(${-lx}px,${ly+2}px)`;
    document.querySelector('.cover-right').style.transform=`translate(${rx}px,${ry+2}px)`;
    $('left-stack').style.opacity=leftDepth===0?'0':'1';
    $('right-stack').style.opacity=rightDepth===0?'0':'1';
    $('left-reading-edge').style.width=lx+'px';
    const shape=surfaceState();
    const geometryStarted=performance.now();
    solid.update(material,f.close,shape);
    const leavesStarted=performance.now();
    const curved=leaves.update(material,f.close,shape);
    stage.dataset.solidRenderMs=(leavesStarted-geometryStarted).toFixed(2);
    stage.dataset.leafRenderMs=(performance.now()-leavesStarted).toFixed(2);
    book.classList.toggle('has-curved-leaves',curved.active);
    stage.dataset.fanSide=fanSide||'';stage.dataset.fanAmount=fanAmount.toFixed(5);stage.dataset.fanCamera=fanCamera.toFixed(5);
    // Once flat, drop the now-identity 3D layer. Some mobile compositors retain
    // culled SVG tiles after a 90-degree hinge, even after visibility returns.
    $('left-half').style.transform=curved.active?K.topMatrix('left',material,f.close):'none';
    $('right-half').style.transform=curved.active?K.topMatrix('right',material,f.close):'translateX(480px)';
    // Silk is sewn into the binding, not into whichever leaf happens to be
    // open. Keep its attachment depth fixed while the closed split changes.
    const ribbonMatrix=K.topMatrixValues('right',{totalDepth:material.totalDepth,leftDepth:material.totalDepth/2},f.close);
    ribbonMatrix[12]-=480*ribbonMatrix[0];ribbonMatrix[13]-=480*ribbonMatrix[1];ribbonMatrix[14]-=480*ribbonMatrix[2];
    $('ribbon-bookmarks').style.transform=K.matrixCSS(ribbonMatrix);
    book.style.setProperty('--edge-hit-size',Math.max(12,36/Math.max(.18,scale))+'px');
    $('physical-index-host').style.setProperty('--reading-assembly',joined.toFixed(4));
    const indexStarted=performance.now();paintIndexGeometry(f);
    stage.dataset.indexRenderMs=(performance.now()-indexStarted).toFixed(2);
    stage.dataset.materialSpread=material.spread.toFixed(4);
    stage.dataset.leftSheets=material.leftSheets.toFixed(4);stage.dataset.rightSheets=material.rightSheets.toFixed(4);
    stage.dataset.leftDepth=material.leftDepth.toFixed(6);stage.dataset.rightDepth=material.rightDepth.toFixed(6);
    $('left-stack').dataset.paperDepth=leftDepth.toFixed(6);$('right-stack').dataset.paperDepth=rightDepth.toFixed(6);
    $('left-reading-edge').dataset.books=material.leftBooks.map(b=>b.code).join(',');
    $('physical-index-host').dataset.readingBooks=material.rightBooks.map(b=>b.code).join(',');
  }
  function constrain(){
    const bounds=G.bounds(view,scale);
    // The physical object extends beyond the printed 960 x 704 spread.
    // Let readers bring the actual paper edge and both ribbon tails on screen.
    if(960*scale>=view.w){
      bounds.minX-=(2.5+(material?.rightDepth||0)*.55)*scale;
      bounds.maxX+=(2.5+(material?.leftDepth||0)*.55)*scale;
    }
    if(704*scale>=view.h)bounds.minY-=Math.max(72,3+Math.max(material?.leftDepth||0,material?.rightDepth||0)*.85)*scale;
    x=clamp(x,bounds.minX,bounds.maxX);y=clamp(y,bounds.minY,bounds.maxY);
  }
  function transform(){
    book.style.transform=`translate3d(${x}px,${y}px,0) scale(${scale})`;
    $('zoom-value').textContent=Math.round(scale/fitScale*100)+'%';
    $('zoom-in').disabled=scale>=3.2;$('zoom-out').disabled=scale<=fitScale;
    const map=$('viewport-map'),mw=map.clientWidth,mh=map.clientHeight;
    const vx=clamp(-x/(960*scale),0,1),vy=clamp(-y/(704*scale),0,1);
    const ww=Math.min(1-vx,view.w/(960*scale)),hh=Math.min(1-vy,view.h/(704*scale));
    Object.assign($('map-window').style,{left:vx*mw+'px',top:vy*mh+'px',width:ww*mw+'px',height:hh*mh+'px'});
    map.style.opacity=scale>fitScale*1.2?'1':'0';
    $('surface-caption').style.opacity=scale>fitScale*1.2?'0':'1';
    ribbons?.update({scale});
    stage.dataset.scale=scale.toFixed(4);stage.dataset.x=x.toFixed(2);stage.dataset.y=y.toFixed(2);
    ['fit-book','focus-left','focus-right'].forEach((id,i)=>$(id).classList.toggle('active',focus===['fit','left','right'][i]));
  }
  function save(){
    if(mode!=='open')return;
    try{localStorage.setItem('paper-bible-position-v1',JSON.stringify({spread,zoom:scale/fitScale,centerX:(view.w/2-x)/scale,centerY:(view.h/2-y)/scale,focus}));}catch{}
  }
  function fit(){if(mode!=='open')return;abortFold();focus='fit';scale=fitScale;x=(view.w-960*scale)/2;y=(view.h-704*scale)/2-6;constrain();transform();save();}
  function focusPage(side){
    if(mode!=='open')return;
    abortFold();
    const outer=(side==='left'?material?.leftDepth:material?.rightDepth)||0;
    focus=side;scale=clamp((view.w-50)/(480+outer*.55),fitScale,3.2);
    // On a phone, reading view is intentionally closer than whole-page view.
    if(view.w<560)scale=Math.max(scale,fitScale*3.2);
    x=22+(side==='left'?outer*.55:-480)*scale;y=16;constrain();transform();save();
  }
  function zoom(next,at={x:view.w/2,y:view.h/2}){
    if(mode!=='open')return;
    abortFold();
    next=clamp(next,fitScale,3.2);
    const lx=(at.x-x)/scale,ly=(at.y-y)/scale;
    x=at.x-lx*next;y=at.y-ly*next;scale=next;focus='custom';constrain();transform();save();
  }
  function resize(){
    if(demoBusy)cancelDemo();
    if(fold)abortFold();
    const oldFit=fitScale,cx=view.w?(view.w/2-x)/scale:480,cy=view.h?(view.h/2-y)/scale:352;
    view={w:stage.clientWidth,h:stage.clientHeight};if(!view.w||!view.h)return;
    fitScale=Math.min((view.w-66)/990,(view.h-65)/750,1.5);fitScale=Math.max(.18,fitScale);
    if(mode!=='open'){paintScene();return;}
    if(focus==='fit')fit();else{scale=clamp(scale/oldFit*fitScale,fitScale,3.2);x=view.w/2-cx*scale;y=view.h/2-cy*scale;constrain();transform();}
  }
  function feedback(text,timeout=2300){
    clearTimeout(feedbackTimer);$('gesture-feedback').textContent=text;$('gesture-feedback').classList.remove('idle');
    if(timeout)feedbackTimer=setTimeout(()=>$('gesture-feedback').classList.add('idle'),timeout);
  }
  function turn(direction,count=1,source='button'){
    if(mode!=='open')return;
    clearHold();
    if(fold){if(fold.source!=='manual'||fold.settling)queuedTurns.push([direction,count,source]);return;}
    if(startFold(direction,{x:480+direction*392,y:380},count,source))settleFold(true,true);
  }
  const leaves=window.PaperBookLeaves.create({host:$('book-leaves'),paintPage,retainFlat:true});
  const solid=window.PaperBookSolid.create($('paper-solid'),{raster:true});
  const index=window.PaperBookIndex.create({host:$('physical-index-host'),books:D.books,onSelect:i=>selectBook(i),onClose:()=>requestReading(),onPan:panEdge});
  const notches=index.getNotches();
  function panEdge(delta){
    if(sceneState==='fan'&&lastSceneFrame){fanY=clamp(fanY+delta/lastSceneFrame.edgePixelsPerUnit,0,704);paintScene();fanY=lastSceneFrame.edgeCenterY;return;}
    if(sceneState!=='edge'||digitalProgress!==0||!lastSceneFrame)return;
    edgeY=clamp(edgeY+delta/lastSceneFrame.edgePixelsPerUnit,0,704);paintScene();
    edgeY=lastSceneFrame.edgeCenterY;
  }
  let bookmarkStorage;try{bookmarkStorage=window.localStorage;}catch{}
  ribbons=window.PaperRibbons.create({host:$('ribbon-bookmarks'),panelHost:document.querySelector('.stage-wrap'),storage:bookmarkStorage,pageCount:D.pages.length,
    getCurrent:()=>({spread,bookName:currentBook().name,ref:D.pages[spread+1].start||'',pose:capturePose()}),
    onNavigate:(page,pose)=>selectBook(Math.max(0,D.pages[page+1]?.b??D.pages[page]?.b??0),page,pose)});
  window.addEventListener('paper-ribbons-request',()=>{if(mode==='open'){cancelDemo();ribbons.open(0);}});
  ['left-edge-open','right-edge-open'].forEach(id=>{
    $(id).addEventListener('click',e=>{if(e.detail===0){e.preventDefault();requestFan(id.startsWith('left')?'left':'right');}});
  });
  function capturePose(){return {zoom:scale/fitScale,cx:(view.w/2-x)/scale,cy:(view.h/2-y)/scale,focus};}
  function setSceneState(state){
    sceneState=state;stage.dataset.scene=state;
    const reading=state==='reading';mode=reading?'open':'edge';
    document.body.dataset.paperScene=reading?'reading':'directory';
    if(window.PaperImmersion)window.PaperImmersion.setScene(reading?'reading':'directory');
    $('view-open').classList.toggle('selected',reading);$('view-edge').classList.toggle('selected',!reading);
    $('view-open').setAttribute('aria-pressed',String(reading));$('view-edge').setAttribute('aria-pressed',String(!reading));
    ribbons?.setScene(reading,sceneProgress);
    $('left-edge-open').inert=!reading;$('right-edge-open').inert=!reading;
    $('scene-controls').inert=reading;
    $('physical-index-host').inert=reading;
    $('scene-digital').disabled=!['edge','digital'].includes(state);
    $('scene-chapters').disabled=!['edge','digital'].includes(state);
    const fanned=['fan','fanning','fan-turn'].includes(state);
    index.setInteractionSide(reading?null:fanned?(state==='fan'?fanSide:null):'both');
    $('scene-back').textContent=fanned?'← 收回纸页':'← 回到阅读';
    $('scene-digital').disabled=!['edge','digital','fan'].includes(state);
    $('scene-chapters').disabled=!['edge','digital','fan'].includes(state);
    const labels={reading:'',fan:'纸页已拨开 · 点切口直接翻到那一卷',fanning:'沿纸层轻轻拨开', 'fan-turn':'从选中的切口翻开',closing:'合上书，沿着纸边找一找',edge:'沿纸边上下拖动 · 从选中的纸层打开',digital:'同一组标签，展开来找',focusing:'找到切口，再打开这一卷',opening:'从这里，重新打开'};
    $('scene-status').textContent=labels[state]||'';
  }
  function paintScene(nextMaterial){
    const paintStarted=performance.now();
    const pose=readPose||capturePose(),f=window.PaperBookScene.sample(sceneProgress,pose,view,fitScale,focusRect,focusAmount,material||Material.compute(spread,D.pages.length,D.books),{digital:digitalProgress,edgeY});
    if(fanSide&&fanCamera>0){
      const side=fanSide,dir=side==='right'?1:-1,depth=side==='right'?material.totalDepth:0;
      const top=K.pagePoint(side,material.leftDepth,1,352,material,0,{...surfaceState(),fanLeft:side==='left'?1:0,fanRight:side==='right'?1:0});
      const base=K.pagePoint(side,depth,1,352,material,0,{...surfaceState(),fanLeft:side==='left'?1:0,fanRight:side==='right'?1:0});
      const targetScale=view.w<600?2.15:1.65,halfHeight=Math.min(352,Math.max(80,view.h-190)/targetScale/2);
      const cy=clamp(fanY,halfHeight,704-halfHeight),cx=(top.x+base.x)/2-dir*(view.w<600?12:110);
      f.scale+=(targetScale-f.scale)*fanCamera;
      f.x+=(view.w/2-cx*targetScale-f.x)*fanCamera;f.y+=(view.h/2-cy*targetScale-f.y)*fanCamera;
      f.edgeCenterY=cy;f.edgePixelsPerUnit=targetScale;
    }
    lastSceneFrame=f;
    book.style.transform=`translate3d(${f.x}px,${f.y}px,0) scale(${f.scale})`;
    $('book-volume').style.transform='none';

    document.querySelector('.gutter').style.opacity=String(1-f.close);
    ribbons?.setScene(sceneState==='reading',f.close);
    // Keep the silk-tail fan and touch targets continuous with camera zoom,
    // rather than resizing them on the final reading frame only.
    ribbons?.update({scale:f.scale});
    stage.dataset.leftAngle=f.leftAngle.toFixed(3);stage.dataset.rightAngle=f.rightAngle.toFixed(3);
    applyMaterial(nextMaterial||Material.compute(spread,D.pages.length,D.books),f);
    index.setProgress(.3+.7*f.orbit);
    stage.dataset.sceneProgress=sceneProgress.toFixed(4);stage.dataset.digitalProgress=digitalProgress.toFixed(4);
    stage.dataset.sceneRenderMs=(performance.now()-paintStarted).toFixed(2);
  }
  function cancelDemo(){demoEpoch++;demoBusy=false;demoButtons(true);clearTimeout(tapTimer);lastTap=null;interrupt();$('touch-ring').style.display='none';}
  function navigationIntent(){
    const token=++navEpoch;if(navCancel){navCancel(false);navCancel=null;}cancelAnimationFrame(navFrame);
    if(mode==='open'){readPose=capturePose();const at=index.focusBook(D.books.indexOf(currentBook()));if(at)edgeY=at.y;index.clearFocus();}cancelDemo();$('scene-chapter-list').hidden=true;
    return token;
  }
  function animateScene(target,duration,token){
    const initial={p:sceneProgress,d:digitalProgress,f:focusAmount,a:fanAmount,c:fanCamera},start=performance.now();
    let previousFrame=start,largestGap=0,frames=0,animationElapsed=0;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Promise(resolve=>{
      navCancel=resolve;
      function frame(now){
        if(token!==navEpoch){resolve(false);return;}
        const gap=now-previousFrame;largestGap=Math.max(largestGap,gap);previousFrame=now;
        // A cold texture or a slow frame must not skip directly to the end of
        // the physical motion. Keep the material path sampled continuously.
        if(frames)animationElapsed+=Math.min(48,gap);frames++;
        const t=clamp(animationElapsed/(reduced?Math.min(duration,180):duration),0,1),e=t*t*(3-2*t);
        sceneProgress=initial.p+((target.p??initial.p)-initial.p)*e;
        digitalProgress=initial.d+((target.d??initial.d)-initial.d)*e;
        focusAmount=initial.f+((target.f??initial.f)-initial.f)*e;
        fanAmount=initial.a+((target.a??initial.a)-initial.a)*e;fanCamera=initial.c+((target.c??initial.c)-initial.c)*e;
        if(target.d!==undefined)index.setDigital(digitalProgress);
        paintScene();
        stage.dataset.sceneFrames=String(frames);stage.dataset.sceneMaxGapMs=largestGap.toFixed(2);
        if(t===1){navCancel=null;resolve(true);}else navFrame=requestAnimationFrame(frame);
      }
      navFrame=requestAnimationFrame(frame);
    });
  }
  async function requestFan(side){
    if(fanSide){if(side===fanSide)return requestReading();return;}
    if(mode!=='open')return;
    if((side==='left'?material.leftSheets:material.rightSheets)<1){feedback('这一侧已经没有可拨开的纸页');return;}
    const token=navigationIntent();fanSide=side;fanBackPose={...readPose};
    const current=index.focusBook(D.books.indexOf(currentBook()));fanY=current?.y??352;index.clearFocus();
    fanAmount=fanCamera=0;setSceneState('fanning');
    await leaves.prepare?.();if(token!==navEpoch)return;
    if(!await animateScene({a:1,c:1},950,token))return;
    setSceneState('fan');
  }
  async function selectFannedBook(i,page){
    if(sceneState!=='fan'||fold)return;
    const target=clamp(page&~1,0,D.pages.length-2),direction=Math.sign(target-spread);
    if(!direction){requestReading();return;}
    if((direction>0?'right':'left')!==fanSide)return;
    const token=navigationIntent();setSceneState('fanning');
    await leaves.prepare?.(target,target+1);
    if(token!==navEpoch)return;
    const originSurface={side:fanSide,material:{...material},close:0,state:surfaceState()};
    const selectedCut=index.focusBook(i);setSceneState('fan-turn');
    // At full fan-camera amount the destination reading pose has no influence
    // on this frame; it is blended in only while the selected packet opens.
    readPose={zoom:1,cx:480,cy:352,focus:'fit'};
    if(startFold(direction,{x:480+direction*425,y:clamp(selectedCut?.y??fanY,24,680)},Math.abs(target-spread)/2,'index',originSurface))settleFold(true,true);
    else requestReading();
  }
  async function requestDirectory(){
    if(mode!=='open'&&sceneState!=='opening')return;
    const token=navigationIntent();setSceneState('closing');
    await leaves.prepare?.();if(token!==navEpoch)return;
    if(!await animateScene({p:1,f:0},Math.max(450,(1-sceneProgress)*1850),token))return;
    setSceneState(digitalProgress===1?'digital':'edge');
  }
  async function requestReading(){
    if(mode==='open')return;
    if(fold?.originSurface){
      if(fold.afterReturn)return;
      cancelAnimationFrame(foldFrame);foldFrame=0;fold.settling=false;
      fold.afterReturn=()=>requestReading();
      settleFold(false,true);
      return;
    }
    if(fanSide){const token=navigationIntent();setSceneState('fanning');if(!await animateScene({a:0,c:0},750,token))return;fanSide=null;completeReading();return;}
    const token=navigationIntent();setSceneState('opening');
    if(digitalProgress&&!await animateScene({d:0},550,token))return;
    if(!await animateScene({p:0,f:0},Math.max(450,sceneProgress*1650),token))return;
    completeReading();
  }
  function completeReading(){
    $('scene-digital').textContent='展开为数字目录';$('scene-digital').setAttribute('aria-pressed','false');
    const pose=readPose||capturePose();fanAmount=fanCamera=0;fanSide=null;fanBackPose=null;setSceneState('reading');focus=pose.focus;scale=clamp(fitScale*pose.zoom,fitScale,3.2);
    x=view.w/2-pose.cx*scale;y=view.h/2-pose.cy*scale;constrain();transform();save();index.clearFocus();focusRect=null;focusAmount=0;
    // Keep the same physical fore-edge at the outer edge of the open book.
    readPose=null;
  }
  async function toggleDigital(){
    if(sceneState==='fan'){
      const token=navigationIntent();setSceneState('closing');
      if(!await animateScene({a:0,c:0,p:1},1550,token))return;fanSide=null;
      if(!await animateScene({d:1},850,token))return;
      $('scene-digital').textContent='收回纸质索引';$('scene-digital').setAttribute('aria-pressed','true');setSceneState('digital');return;
    }
    if(!['edge','digital'].includes(sceneState))return;
    const target=digitalProgress<.5?1:0,token=navigationIntent();setSceneState('focusing');
    if(!await animateScene({d:target,f:0},850,token))return;
    $('scene-digital').textContent=target?'收回纸质索引':'展开为数字目录';$('scene-digital').setAttribute('aria-pressed',String(!!target));
    setSceneState(target?'digital':'edge');
  }
  async function selectBook(i,page=D.books[i].first,restorePose=null){
    if(!D.books[i])return;
    if(sceneState==='fan')return selectFannedBook(i,page);
    const token=navigationIntent();setSceneState('focusing');
    if(sceneProgress<1&&!await animateScene({p:1,f:0},Math.max(400,(1-sceneProgress)*1600),token))return;
    if(digitalProgress&&!await animateScene({d:0},650,token))return;
    if(focusAmount>0&&!await animateScene({f:0},380,token))return;
    focusRect=index.focusBook(i);
    if(!await animateScene({f:1},560,token))return;
    if(!await animateScene({f:1},160,token))return;
    const destination=clamp(page&~1,0,D.pages.length-2);
    await leaves.prepare?.(destination,destination+1);if(token!==navEpoch)return;
    // Change the opening position only when both halves meet at the closed fore-edge.
    spread=destination;burstState=null;render();
    readPose=restorePose&&Number.isFinite(restorePose.zoom)&&Number.isFinite(restorePose.cx)&&Number.isFinite(restorePose.cy)?{...restorePose}:{zoom:1,cx:480,cy:352,focus:'fit'};
    $('scene-digital').textContent='展开为数字目录';$('scene-digital').setAttribute('aria-pressed','false');
    setSceneState('opening');
    if(!await animateScene({p:0,f:0},1650,token))return;
    completeReading();feedback(`翻到${D.books[i].name} · 仍是固定的纸页`);
  }
  function setMode(next){return next==='open'?requestReading():requestDirectory();}
  function jump(page){const i=Math.max(0,D.pages[page]?.b??0);return selectBook(i,page);}
  $('scene-back').onclick=requestReading;$('scene-digital').onclick=toggleDigital;
  $('scene-chapters').onclick=()=>{
    const b=currentBook(),list=$('scene-chapter-list');
    if(!['edge','digital','fan'].includes(sceneState))return;
    list.innerHTML=b.chapters.map(c=>`<button data-page="${c.page}" aria-label="${b.name}第${c.chapter}章">${c.chapter}</button>`).join('');list.hidden=!list.hidden;
  };
  $('scene-chapter-list').addEventListener('click',e=>{const btn=e.target.closest('button[data-page]');if(btn)jump(Number(btn.dataset.page));});
  $('location-button').onclick=requestDirectory;
  $('view-open').onclick=requestReading;$('view-edge').onclick=requestDirectory;
  window.addEventListener('paper-directory-request',requestDirectory);
  window.addEventListener('paper-interrupt',cancelDemo);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode!=='open'&&!document.querySelector('dialog[open]')){e.preventDefault();requestReading();}});
  $('fit-book').onclick=fit;$('zoom-value').onclick=fit;
  $('focus-left').onclick=()=>focusPage('left');$('focus-right').onclick=()=>focusPage('right');
  $('zoom-in').onclick=()=>zoom(scale*1.3);$('zoom-out').onclick=()=>zoom(scale/1.3);
  $('next').onclick=()=>{if(mode!=='open')return;burstState=null;turn(1);};
  $('prev').onclick=()=>{if(mode!=='open')return;burstState=null;turn(-1);};
  $('about-open').onclick=()=>{cancelDemo();$('about-dialog').showModal();};$('help-open').onclick=()=>{cancelDemo();$('help-dialog').showModal();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  document.querySelector('.brand').onclick=e=>{e.preventDefault();setMode('open');};
  stage.addEventListener('keydown',e=>{
    if(mode!=='open'){if(e.key==='Escape'){e.preventDefault();requestReading();}return;}
    if(e.key==='Escape'){e.preventDefault();interrupt();}else if(e.key==='ArrowRight'){e.preventDefault();turn(1);}else if(e.key==='ArrowLeft'){e.preventDefault();turn(-1);}
    else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(scale*1.2);}else if(e.key==='-'){e.preventDefault();zoom(scale/1.2);}else if(e.key==='0')fit();
  });
  stage.addEventListener('wheel',e=>{
    if(['edge','fan'].includes(sceneState)&&digitalProgress===0){e.preventDefault();panEdge(e.deltaY);return;}
    if(mode!=='open')return;
    e.preventDefault();if(demoBusy||fold)return;
    const r=stage.getBoundingClientRect();
    if(e.ctrlKey||e.metaKey)zoom(scale*Math.exp(-e.deltaY*.003),{x:e.clientX-r.left,y:e.clientY-r.top});
    else{x-=e.deltaX;y-=e.deltaY;constrain();transform();save();}
  },{passive:false});

  function relative(e){const r=stage.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top,t:e.timeStamp};}
  function centroid(){const a=[...pointers.values()];return {x:a.reduce((s,p)=>s+p.x,0)/a.length,y:a.reduce((s,p)=>s+p.y,0)/a.length,t:Math.max(...a.map(p=>p.t))};}
  function distance(){const a=[...pointers.values()];return a.length>1?Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y):0;}
  function begin(gCenter,n){
    const localX=(gCenter.x-x)/scale,localY=(gCenter.y-y)/scale;
    const edge=localY>=0&&localY<=704&&(Math.abs(localX)<18/scale+(material?.leftDepth||0)*.55||Math.abs(localX-960)<18/scale+(material?.rightDepth||0)*.55);
    return {edge,edgeSide:localX<480?'left':'right',start:gCenter,end:gCenter,fingers:n,side:localX>=0&&localX<=960&&localY>=0&&localY<=704?(localX<480?'left':'right'):'outside',baseX:x,baseY:y,baseScale:scale,baseDistance:distance(),pinched:false,slowLocked:false,cancelled:false,samples:[gCenter],vx:0,lifted:false};
  }
  function pointerDown(e){
    if(['edge','fan'].includes(sceneState)&&digitalProgress===0&&e.button===0){edgeDrag={id:e.pointerId,y:e.clientY,startY:e.clientY,startX:e.clientX};try{stage.setPointerCapture(e.pointerId);}catch{}return;}
    if(mode!=='open'||(demoBusy&&!e.demo)||e.button>0)return;
    if(fold&&(fold.settling||fold.source!=='manual'))return;
    clearHold();clearTimeout(tapTimer);
    if(!e.demo)try{stage.setPointerCapture(e.pointerId);}catch{}
    pointers.set(e.pointerId,relative(e));
    if(fold&&pointers.size>1){abortFold();if(gesture)gesture.holding=false;}
    if(pointers.size>2){if(gesture)gesture.cancelled=true;return;}
    if(gesture?.lifted){gesture.cancelled=true;return;}
    // Adding a second finger restarts only the motion baseline, not a page turn.
    const priorPinch=gesture?.pinched,priorSlow=gesture?.slowLocked;
    gesture=begin(centroid(),pointers.size);
    if(priorPinch)gesture.pinched=true;if(priorSlow&&pointers.size===1)gesture.slowLocked=true;
    stage.classList.add('dragging');
    if(pointers.size===1&&gesture.side!=='outside'&&!gesture.edge){
      const g=gesture;
      holdTimer=setTimeout(()=>{
        if(gesture!==g||pointers.size!==1||g.cancelled||g.slowLocked)return;
        const at=centroid();if(Math.hypot(at.x-g.start.x,at.y-g.start.y)>10)return;
        const contact={x:(at.x-x)/scale,y:(at.y-y)/scale};
        if(startFold(g.side==='right'?1:-1,contact,1,'manual')){
          g.holding=true;g.holdOrigin=at;g.holdScale=scale;g.holdRadius=fold.radius;lastTap=null;
          $('touch-ring').classList.add('holding');$('touch-ring').style.display='block';$('touch-ring').style.left=at.x-15+'px';$('touch-ring').style.top=at.y-15+'px';
          feedback('已捏住纸页 · 慢慢掀开，也可以放回',0);if(navigator.vibrate&&!e.demo)navigator.vibrate(9);
        }
      },360);
    }
  }
  function pointerMove(e){
    if(edgeDrag?.id===e.pointerId){const dy=edgeDrag.y-e.clientY;edgeDrag.y=e.clientY;panEdge(dy);return;}
    if(!pointers.has(e.pointerId)||!gesture||gesture.cancelled||gesture.lifted)return;
    pointers.set(e.pointerId,relative(e));const c=centroid(),g=gesture;
    g.end=c;g.samples.push(c);while(g.samples.length>2&&c.t-g.samples[0].t>140)g.samples.shift();
    const elapsed=c.t-g.start.t,dx=c.x-g.start.x,dy=c.y-g.start.y;
    if(g.holding&&fold&&!fold.settling){
      const inward=-(c.x-g.holdOrigin.x)*fold.direction/g.holdScale;
      updateFold(.006+inward/(2*g.holdRadius),(c.y-g.holdOrigin.y)/g.holdScale,c.t);
      $('touch-ring').style.left=c.x-15+'px';$('touch-ring').style.top=c.y-15+'px';return;
    }
    if(Math.hypot(dx,dy)>9)clearHold();
    if(pointers.size===2){
      const dist=distance(),ratio=dist/Math.max(1,g.baseDistance);
      if(Math.abs(dist-g.baseDistance)>Math.max(12,g.baseDistance*.075))g.pinched=true;
      if(g.pinched){
        scale=clamp(g.baseScale*ratio,fitScale,3.2);
        x=c.x-(g.start.x-g.baseX)/g.baseScale*scale;
        y=c.y-(g.start.y-g.baseY)/g.baseScale*scale;
        focus='custom';constrain();transform();feedback('缩放整本书 · 经文位置不变',800);return;
      }
    }
    if(elapsed>220&&Math.hypot(dx,dy)>14&&Math.hypot(dx,dy)/elapsed<.28)g.slowLocked=true;
    x=g.baseX+dx;y=g.baseY+dy;
    if(Math.hypot(dx,dy)>8)focus='custom';
    constrain();transform();
    if(g.slowLocked)feedback('移动纸页 · 不翻页',800);
  }
  function finishGesture(g,cancelled){
    g.cancelled ||= cancelled;
    if(g.holding){
      if(fold){const commit=Physics.release(fold.progress,fold.velocity,g.cancelled);settleFold(commit);}
      stage.dataset.lastGesture='physical-curl';lastTap=null;return;
    }
    const sample=g.samples.find(s=>g.end.t-s.t<=140)||g.start;
    g.vx=(g.end.x-sample.x)/Math.max(1,g.end.t-sample.t);
    const result=G.classify(g);
    if(result.type==='turn'){
      // A flick moves the book only during tracking; snap back to the reading window before turn.
      x=g.baseX;y=g.baseY;scale=g.baseScale;constrain();transform();
      burstState=G.burst(burstState,g.end.t,result.direction,g.fingers);
      turn(result.direction,burstState.count,g.fingers===2?'two':'single');
      lastTap=null;
    }else{
      const travel=Math.hypot(g.end.x-g.start.x,g.end.y-g.start.y);
      if(!g.cancelled&&!g.pinched&&g.fingers===1&&travel<9&&g.end.t-g.start.t<320){
        if(g.edge){x=g.baseX;y=g.baseY;scale=g.baseScale;transform();lastTap=null;requestFan(g.edgeSide);stage.dataset.lastGesture='edge-tap';return;}
        if(lastTap&&g.end.t-lastTap.t<330&&Math.hypot(g.end.x-lastTap.x,g.end.y-lastTap.y)<30){
          if(scale>fitScale*1.3)fit();else zoom(fitScale*3.2,g.end);
          lastTap=null;
        }else {lastTap=g.end;tapTimer=setTimeout(()=>{if(mode==='open'&&!fold&&!demoBusy)window.dispatchEvent(new CustomEvent('paper-reader-tap'));lastTap=null;},335);}
      }else lastTap=null;
      if(result.reason==='direction'&&travel>=42)feedback('这个方向只移动 · 左页向右 / 右页向左才翻页');
      constrain();transform();save();
    }
    stage.dataset.lastGesture=result.type;stage.dataset.lastFingers=String(g.fingers);
  }
  function pointerUp(e,cancelled=false){
    if(edgeDrag?.id===e.pointerId){const tap=!cancelled&&Math.hypot(e.clientY-edgeDrag.startY,e.clientX-edgeDrag.startX)<8;edgeDrag=null;if(tap&&sceneState==='fan')requestReading();return;}
    if(!pointers.has(e.pointerId))return;
    clearHold();
    const g=gesture;
    if(g&&!g.lifted){
      pointerMove(e);
      g.end={...g.end,t:e.timeStamp};
      // One lift freezes a two-finger gesture; the remaining finger cannot turn again.
      if(g.fingers===2)g.lifted=true;
    }
    pointers.delete(e.pointerId);
    if(g&&cancelled)g.cancelled=true;
    if(!pointers.size){
      if(g)finishGesture(g,cancelled);gesture=null;stage.classList.remove('dragging');
    }
  }
  stage.addEventListener('pointerdown',pointerDown);
  stage.addEventListener('pointermove',pointerMove);
  stage.addEventListener('pointerup',e=>pointerUp(e));
  stage.addEventListener('pointercancel',e=>pointerUp(e,true));
  stage.addEventListener('lostpointercapture',e=>{if(pointers.has(e.pointerId))pointerUp(e,true);});
  stage.addEventListener('contextmenu',e=>e.preventDefault());
  function interrupt(){edgeDrag=null;clearHold();pointers.clear();gesture=null;stage.classList.remove('dragging');abortFold();}
  window.addEventListener('blur',cancelDemo);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelDemo();});

  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  async function simulate(dx,dy,duration,fingers=1,token=demoEpoch){
    const r=stage.getBoundingClientRect();
    const startX=clamp(x+scale*740,42,view.w-42),startY=clamp(y+scale*280,45,view.h-65);
    const t=performance.now();
    const e=(id,k,tt)=>({pointerId:id,clientX:r.left+startX+dx*k,clientY:r.top+startY+(id===902?28:0)+dy*k,timeStamp:tt,button:0,demo:true});
    pointerDown(e(901,0,t));if(fingers===2)pointerDown(e(902,0,t+1));
    $('touch-ring').style.display='block';
    for(let i=1;i<=24;i++){
      await wait(duration/24);if(token!==demoEpoch||mode!=='open')return;const k=i/24,tt=performance.now();pointerMove(e(901,k,tt));if(fingers===2)pointerMove(e(902,k,tt));
      $('touch-ring').style.left=startX+dx*k-15+'px';$('touch-ring').style.top=startY+dy*k-15+'px';
    }
    pointerUp(e(901,1,performance.now()));if(fingers===2)pointerUp(e(902,1,performance.now()+1));
    $('touch-ring').style.display='none';
  }
  function demoButtons(enabled){$('demo-pan').disabled=!enabled;$('demo-burst').disabled=!enabled;$('demo-peek').disabled=!enabled;}
  $('demo-pan').onclick=async()=>{
    if(demoBusy||mode!=='open')return;const token=++demoEpoch;demoBusy=true;demoButtons(false);focusPage('right');
    try{await simulate(-100,-70,1300,1,token);if(token!==demoEpoch)return;feedback('慢拖 1.3 秒 · 位置改变，页码不变',3500);}finally{if(token===demoEpoch){demoBusy=false;demoButtons(true);}}
  };
  $('demo-burst').onclick=async()=>{
    if(demoBusy||mode!=='open')return;const token=++demoEpoch;demoBusy=true;demoButtons(false);fit();burstState=null;
    try{for(let i=0;i<3;i++){await simulate(-95,0,125,2,token);if(token!==demoEpoch)return;await wait(470);if(token!==demoEpoch)return;}feedback('双指连续快翻完成：5 → 10 → 20 页',3800);}finally{if(token===demoEpoch){demoBusy=false;demoButtons(true);}}
  };
  $('demo-peek').onclick=async()=>{
    if(demoBusy||mode!=='open')return;const token=++demoEpoch;demoBusy=true;demoButtons(false);fit();
    let dir=spread<D.pages.length-2?1:-1;
    const r=stage.getBoundingClientRect(),sx=x+(480+dir*350)*scale,sy=y+310*scale;
    const event=(p,dy=0)=>({pointerId:903,clientX:r.left+sx-dir*p*700*scale,clientY:r.top+sy+dy*scale,timeStamp:performance.now(),button:0,demo:true});
    async function move(from,to,ms){const start=performance.now();while(true){if(token!==demoEpoch)return;const t=clamp((performance.now()-start)/ms,0,1),p=from+(to-from)*(1-Math.cos(Math.PI*t))/2;pointerMove(event(p,-Math.sin(p*Math.PI)*22));if(t===1)break;await wait(16);}}
    try{
      pointerDown(event(0));await wait(460);if(token!==demoEpoch)return;
      if(!gesture?.holding)throw Error('长按未生效');
      await move(0,.38,1150);if(token!==demoEpoch)return;feedback('下一页已露出 · 页码还没有改变',0);await wait(1550);if(token!==demoEpoch)return;
      await move(.38,.025,1000);if(token!==demoEpoch)return;pointerUp(event(.025));await wait(900);if(token!==demoEpoch)return;
      feedback('掀开、偷看、放回 · 仍是原来的页码',3200);
    }catch{interrupt();feedback('演示被中断，可以重新试一次');}
    finally{if(token===demoEpoch){demoBusy=false;demoButtons(true);$('touch-ring').style.display='none';}}
  };
  setSceneState('reading');render();resize();paintScene();
  if(lastSaved?.zoom>1&&lastSaved.centerX!==undefined){scale=clamp(fitScale*lastSaved.zoom,fitScale,3.2);x=view.w/2-lastSaved.centerX*scale;y=view.h/2-lastSaved.centerY*scale;focus=lastSaved.focus||'custom';constrain();transform();save();}
  new ResizeObserver(resize).observe(stage);
  setTimeout(()=>$('gesture-feedback').classList.add('idle'),5000);
})();
