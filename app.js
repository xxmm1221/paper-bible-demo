(() => {
  'use strict';
  const $=id=>document.getElementById(id), D=window.BIBLE_DATA, G=window.PaperGestures;
  const stage=$('stage'),book=$('book'), papers=[$('left-paper'),$('right-paper')];
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const NS='http://www.w3.org/2000/svg';
  let spread=0,scale=1,x=0,y=0,fitScale=1,mode='open',focus='fit',gesture=null;
  let burstState=null,feedbackTimer,animTimer,demoBusy=false,lastTap=null;
  let view={w:0,h:0},lastSaved=null;
  const pointers=new Map();
  try{lastSaved=JSON.parse(localStorage.getItem('paper-bible-position-v1'));spread=clamp((lastSaved?.spread||0)&~1,0,D.pages.length-2);}catch{}

  function svgPage(p,index){
    const name=p.b<0?'旧约全书':D.books[p.b].name;
    let s=`<svg viewBox="0 0 480 704" role="img" aria-label="${esc(name)}，体验版第 ${index} 页，${esc(p.start)} 至 ${esc(p.end)}"><text x="240" y="29" text-anchor="middle" font-size="10">${index||''}</text><text x="${index%2?447:32}" y="29" text-anchor="${index%2?'end':'start'}" font-size="9">${esc(name)} ${esc(p.start)}</text>`;
    if(p.b===-1){
      return s+'<text x="240" y="280" text-anchor="middle" font-size="29" letter-spacing="10">旧约全书</text><text x="240" y="312" text-anchor="middle" font-size="10" letter-spacing="2" font-family="Georgia,serif">THE OLD TESTAMENT</text><path d="M180 338 H300" stroke="#b2a78c" stroke-width=".6"/><text x="240" y="378" text-anchor="middle" font-size="11">和合本 · 神版</text><text x="240" y="644" text-anchor="middle" font-size="8" fill="#8f846c">固定版面阅读体验 · 原型排版</text></svg>';
    }
    if(p.title)s+=`<text x="240" y="64" text-anchor="middle" font-size="22" letter-spacing="8">${esc(name)}</text>`;
    for(let c=0;c<2;c++)for(let row=0;row<p.cols[c].length;row++){
      for(const [type,text,offset] of p.cols[c][row]){
        const tx=32+c*218+offset*14,ty=96+row*17.35;
        const size=type==='c'?27:type==='v'?10:14;
        s+=`<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" font-size="${size}"${type==='v'?' font-family="Georgia,serif" font-weight="bold"':''}${type==='t'&&text.length>1?` textLength="${text.length*14}" lengthAdjust="spacingAndGlyphs"`:''}>${esc(text)}</text>`;
      }
    }
    if(!p.cols.some(c=>c.length))s+='<text x="240" y="350" text-anchor="middle" font-size="10" fill="#a5977b">·</text>';
    return s+'</svg>';
  }
  function currentBook(){return D.books[Math.max(0,D.pages[spread+1].b)];}
  function progress(){return (spread+1)/(D.pages.length-1);}
  function render(){
    papers[0].innerHTML=svgPage(D.pages[spread],spread);
    papers[1].innerHTML=svgPage(D.pages[spread+1],spread+1);
    const b=currentBook(),ref=D.pages[spread+1].start||'1:1';
    $('book-name').textContent=b.name;
    const endRef=D.pages[spread+1].end||ref;
    $('chapter-name').textContent=`${ref.split(':')[0]===endRef.split(':')[0]?'第 '+ref.split(':')[0]:ref.split(':')[0]+'–'+endRef.split(':')[0]} 章`;
    $('page-label').textContent=spread===0?'卷首 — 1':`${spread} — ${spread+1}`;
    $('progress-label').textContent=`${b.short} · 全书 ${Math.round(progress()*100)}%`;
    const p=progress();
    $('left-stack').style.transform=`translate(${-p*13}px,${3+p*30}px)`;
    $('right-stack').style.transform=`translate(${(1-p)*13}px,${3+(1-p)*30}px)`;
    document.querySelector('.cover-left').style.transform=`translate(${-p*13}px,${p*30}px) skewY(1deg)`;
    document.querySelector('.cover-right').style.transform=`translate(${(1-p)*13}px,${(1-p)*30}px) skewY(-1deg)`;
    $('read-block').style.width=`${p*100}%`;
    $('position-pin').style.left=`${p*100}%`;
    $('cut-marker').style.top=`${p*100}%`;
    $('prev').disabled=spread===0;$('next').disabled=spread>=D.pages.length-2;
    document.querySelectorAll('.index-tab').forEach(btn=>{
      const yes=btn.dataset.code===b.code;btn.classList.toggle('current',yes);btn.setAttribute('aria-current',yes?'true':'false');
    });
    stage.dataset.spread=String(spread);stage.dataset.book=b.code;
  }
  function constrain(){
    const bounds=G.bounds(view,scale);
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
    stage.dataset.scale=scale.toFixed(4);stage.dataset.x=x.toFixed(2);stage.dataset.y=y.toFixed(2);
    ['fit-book','focus-left','focus-right'].forEach((id,i)=>$(id).classList.toggle('active',focus===['fit','left','right'][i]));
  }
  function save(){
    try{localStorage.setItem('paper-bible-position-v1',JSON.stringify({spread,zoom:scale/fitScale,centerX:(view.w/2-x)/scale,centerY:(view.h/2-y)/scale,focus}));}catch{}
  }
  function fit(){focus='fit';scale=fitScale;x=(view.w-960*scale)/2;y=(view.h-704*scale)/2-6;constrain();transform();save();}
  function focusPage(side){
    focus=side;scale=clamp((view.w-50)/480,fitScale,3.2);
    // On a phone, reading view is intentionally closer than whole-page view.
    if(view.w<560)scale=Math.max(scale,fitScale*3.2);
    x=22-(side==='left'?0:480)*scale;y=16;constrain();transform();save();
  }
  function zoom(next,at={x:view.w/2,y:view.h/2}){
    next=clamp(next,fitScale,3.2);
    const lx=(at.x-x)/scale,ly=(at.y-y)/scale;
    x=at.x-lx*next;y=at.y-ly*next;scale=next;focus='custom';constrain();transform();save();
  }
  function resize(){
    const oldFit=fitScale,cx=view.w?(view.w/2-x)/scale:480,cy=view.h?(view.h/2-y)/scale:352;
    view={w:stage.clientWidth,h:stage.clientHeight};if(!view.w||!view.h)return;
    fitScale=Math.min((view.w-66)/990,(view.h-65)/750,1.5);fitScale=Math.max(.18,fitScale);
    if(focus==='fit')fit();else{scale=clamp(scale/oldFit*fitScale,fitScale,3.2);x=view.w/2-cx*scale;y=view.h/2-cy*scale;constrain();transform();}
  }
  function feedback(text,timeout=2300){
    clearTimeout(feedbackTimer);$('gesture-feedback').textContent=text;$('gesture-feedback').classList.remove('idle');
    if(timeout)feedbackTimer=setTimeout(()=>$('gesture-feedback').classList.add('idle'),timeout);
  }
  function turn(direction,count=1,source='button'){
    const old=spread;spread=clamp(spread+direction*count*2,0,D.pages.length-2);
    const actual=Math.abs(spread-old)/2;
    if(!actual){feedback(direction>0?'已经到全书最后了':'已经到全书最前了');return;}
    const sheet=$('turn-sheet');sheet.className='turn-sheet';void sheet.offsetWidth;
    sheet.classList.add(direction>0?'forward':'backward');
    clearTimeout(animTimer);animTimer=setTimeout(()=>sheet.className='turn-sheet',470);
    render();
    // Preserve the reading window in book coordinates when turning.
    constrain();transform();save();
    feedback(`${direction>0?'向后':'向前'}翻 ${actual} 页${source==='two'?' · 双指快翻':''}`,source==='two'?2900:1800);
    if(navigator.vibrate&&source!=='demo')navigator.vibrate(8);
  }
  function setMode(next){
    if(gesture){gesture.cancelled=true;pointers.clear();gesture=null;stage.classList.remove('dragging');}
    mode=next;$('edge-view').hidden=next!=='edge';stage.style.visibility=next==='edge'?'hidden':'visible';
    $('reading-tools').style.visibility=next==='edge'?'hidden':'visible';$('viewport-map').style.display=next==='edge'?'none':'';
    $('view-open').classList.toggle('selected',next==='open');$('view-edge').classList.toggle('selected',next==='edge');
    $('view-open').setAttribute('aria-pressed',String(next==='open'));$('view-edge').setAttribute('aria-pressed',String(next==='edge'));
    feedback(next==='edge'?'沿着书侧点标签，翻到那一卷':'回到刚才那一页');
  }
  function jump(page){spread=clamp(page&~1,0,D.pages.length-2);burstState=null;render();setMode('open');fit();feedback(`翻到${currentBook().name} · 位置始终固定`);save();}
  $('index-tabs').innerHTML=D.books.map(b=>`<button class="index-tab ${D.books.indexOf(b)>=39?'nt':''}" data-code="${b.code}" data-page="${b.first}" title="${b.name}" aria-label="翻到${b.name}">${b.short}</button>`).join('');
  $('index-tabs').addEventListener('click',e=>{const btn=e.target.closest('button[data-page]');if(btn)jump(Number(btn.dataset.page));});
  function openChapters(){
    const b=currentBook();$('chapter-title').textContent=b.name;
    $('chapter-list').innerHTML=b.chapters.map(c=>`<button data-page="${c.page}" aria-label="第 ${c.chapter} 章" class="${(c.page&~1)===spread?'current':''}">${c.chapter}</button>`).join('');
    $('chapter-dialog').showModal();
  }
  $('chapter-list').addEventListener('click',e=>{const b=e.target.closest('button');if(b){$('chapter-dialog').close();jump(Number(b.dataset.page));}});
  $('chapter-to-edge').onclick=()=>{$('chapter-dialog').close();setMode('edge');};
  $('location-button').onclick=openChapters;
  $('view-open').onclick=()=>setMode('open');$('view-edge').onclick=()=>setMode('edge');
  $('fit-book').onclick=fit;$('zoom-value').onclick=fit;
  $('focus-left').onclick=()=>focusPage('left');$('focus-right').onclick=()=>focusPage('right');
  $('zoom-in').onclick=()=>zoom(scale*1.3);$('zoom-out').onclick=()=>zoom(scale/1.3);
  $('next').onclick=()=>{if(mode==='edge')setMode('open');burstState=null;turn(1);};
  $('prev').onclick=()=>{if(mode==='edge')setMode('open');burstState=null;turn(-1);};
  $('about-open').onclick=()=>$('about-dialog').showModal();$('help-open').onclick=()=>$('help-dialog').showModal();
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  document.querySelector('.brand').onclick=e=>{e.preventDefault();setMode('open');};
  stage.addEventListener('keydown',e=>{
    if(e.key==='ArrowRight'){e.preventDefault();turn(1);}else if(e.key==='ArrowLeft'){e.preventDefault();turn(-1);}
    else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(scale*1.2);}else if(e.key==='-'){e.preventDefault();zoom(scale/1.2);}else if(e.key==='0')fit();
  });
  stage.addEventListener('wheel',e=>{
    e.preventDefault();if(demoBusy)return;
    const r=stage.getBoundingClientRect();
    if(e.ctrlKey||e.metaKey)zoom(scale*Math.exp(-e.deltaY*.003),{x:e.clientX-r.left,y:e.clientY-r.top});
    else{x-=e.deltaX;y-=e.deltaY;constrain();transform();save();}
  },{passive:false});

  function relative(e){const r=stage.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top,t:e.timeStamp};}
  function centroid(){const a=[...pointers.values()];return {x:a.reduce((s,p)=>s+p.x,0)/a.length,y:a.reduce((s,p)=>s+p.y,0)/a.length,t:Math.max(...a.map(p=>p.t))};}
  function distance(){const a=[...pointers.values()];return a.length>1?Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y):0;}
  function begin(gCenter,n){
    const localX=(gCenter.x-x)/scale,localY=(gCenter.y-y)/scale;
    return {start:gCenter,end:gCenter,fingers:n,side:localX>=0&&localX<=960&&localY>=0&&localY<=704?(localX<480?'left':'right'):'outside',baseX:x,baseY:y,baseScale:scale,baseDistance:distance(),pinched:false,slowLocked:false,cancelled:false,samples:[gCenter],vx:0,lifted:false};
  }
  function pointerDown(e){
    if(mode!=='open'||(demoBusy&&!e.demo)||e.button>0)return;
    if(!e.demo)try{stage.setPointerCapture(e.pointerId);}catch{}
    pointers.set(e.pointerId,relative(e));
    if(pointers.size>2){if(gesture)gesture.cancelled=true;return;}
    if(gesture?.lifted){gesture.cancelled=true;return;}
    // Adding a second finger restarts only the motion baseline, not a page turn.
    const priorPinch=gesture?.pinched,priorSlow=gesture?.slowLocked;
    gesture=begin(centroid(),pointers.size);
    if(priorPinch)gesture.pinched=true;if(priorSlow&&pointers.size===1)gesture.slowLocked=true;
    stage.classList.add('dragging');
  }
  function pointerMove(e){
    if(!pointers.has(e.pointerId)||!gesture||gesture.cancelled||gesture.lifted)return;
    pointers.set(e.pointerId,relative(e));const c=centroid(),g=gesture;
    g.end=c;g.samples.push(c);while(g.samples.length>2&&c.t-g.samples[0].t>140)g.samples.shift();
    const elapsed=c.t-g.start.t,dx=c.x-g.start.x,dy=c.y-g.start.y;
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
        if(lastTap&&g.end.t-lastTap.t<330&&Math.hypot(g.end.x-lastTap.x,g.end.y-lastTap.y)<30){
          if(scale>fitScale*1.3)fit();else zoom(fitScale*3.2,g.end);
          lastTap=null;
        }else lastTap=g.end;
      }else lastTap=null;
      if(result.reason==='direction'&&travel>=42)feedback('这个方向只移动 · 左页向右 / 右页向左才翻页');
      constrain();transform();save();
    }
    stage.dataset.lastGesture=result.type;stage.dataset.lastFingers=String(g.fingers);
  }
  function pointerUp(e,cancelled=false){
    if(!pointers.has(e.pointerId))return;
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
  window.addEventListener('blur',()=>{pointers.clear();gesture=null;stage.classList.remove('dragging');});

  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  async function simulate(dx,dy,duration,fingers=1){
    const r=stage.getBoundingClientRect();
    const startX=clamp(x+scale*740,42,view.w-42),startY=clamp(y+scale*280,45,view.h-65);
    const t=performance.now();
    const e=(id,k,tt)=>({pointerId:id,clientX:r.left+startX+dx*k,clientY:r.top+startY+(id===902?28:0)+dy*k,timeStamp:tt,button:0,demo:true});
    pointerDown(e(901,0,t));if(fingers===2)pointerDown(e(902,0,t+1));
    $('touch-ring').style.display='block';
    for(let i=1;i<=24;i++){
      await wait(duration/24);const k=i/24,tt=performance.now();pointerMove(e(901,k,tt));if(fingers===2)pointerMove(e(902,k,tt));
      $('touch-ring').style.left=startX+dx*k-15+'px';$('touch-ring').style.top=startY+dy*k-15+'px';
    }
    pointerUp(e(901,1,performance.now()));if(fingers===2)pointerUp(e(902,1,performance.now()+1));
    $('touch-ring').style.display='none';
  }
  function demoButtons(enabled){$('demo-pan').disabled=!enabled;$('demo-burst').disabled=!enabled;}
  $('demo-pan').onclick=async()=>{
    if(demoBusy)return;demoBusy=true;demoButtons(false);setMode('open');focusPage('right');
    try{await simulate(-100,-70,1300);feedback('慢拖 1.3 秒 · 位置改变，页码不变',3500);}finally{demoBusy=false;demoButtons(true);}
  };
  $('demo-burst').onclick=async()=>{
    if(demoBusy)return;demoBusy=true;demoButtons(false);setMode('open');fit();burstState=null;
    try{for(let i=0;i<3;i++){await simulate(-95,0,125,2);await wait(470);}feedback('双指连续快翻完成：5 → 10 → 20 页',3800);}finally{demoBusy=false;demoButtons(true);}
  };
  render();resize();
  if(lastSaved?.zoom>1&&lastSaved.centerX!==undefined){scale=clamp(fitScale*lastSaved.zoom,fitScale,3.2);x=view.w/2-lastSaved.centerX*scale;y=view.h/2-lastSaved.centerY*scale;focus=lastSaved.focus||'custom';constrain();transform();}
  new ResizeObserver(resize).observe(stage);
  setTimeout(()=>$('gesture-feedback').classList.add('idle'),5000);
})();
