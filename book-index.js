/* One index, physically bound to absolute sheet depths. Its two clipped ink
 * fragments share the actual left/right fore-edge planes; closing at any
 * reading split yields the identical closed index, not a replacement picture. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PaperBookIndex=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const WIDTH=36,HEIGHT=704,DIGITAL_WIDTH=480,ROW=70;
  const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,Number(n)||0));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const smooth=(a,b,t)=>{const q=clamp((t-a)/(b-a));return q*q*(3-2*q);};
  const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const translation=(x,y,z=0)=>{const m=identity();m[12]=x;m[13]=y;m[14]=z;return m;};
  function multiply(a,b){const r=Array(16).fill(0);for(let c=0;c<4;c++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)r[c*4+row]+=a[k*4+row]*b[c*4+k];return r;}
  function inverse(m){
    const a=Array.from({length:4},(_,r)=>Array.from({length:8},(_,c)=>c<4?m[c*4+r]:+(c-4===r)));
    for(let c=0;c<4;c++){let pivot=c;for(let r=c+1;r<4;r++)if(Math.abs(a[r][c])>Math.abs(a[pivot][c]))pivot=r;
      if(Math.abs(a[pivot][c])<1e-10)throw new TypeError('Singular fore-edge matrix');
      [a[c],a[pivot]]=[a[pivot],a[c]];const div=a[c][c];for(let k=0;k<8;k++)a[c][k]/=div;
      for(let r=0;r<4;r++)if(r!==c){const factor=a[r][c];for(let k=0;k<8;k++)a[r][k]-=factor*a[c][k];}}
    return Array.from({length:16},(_,i)=>a[i%4][4+Math.floor(i/4)]);
  }
  function matrix(value,fallback){const a=Array.isArray(value)?value:typeof value==='string'?value.replace(/^matrix3d\(|\)$/g,'').split(',').map(Number):null;return a?.length===16&&a.every(Number.isFinite)?a.slice():fallback.slice();}
  const css=m=>'matrix3d('+m.map(n=>Math.abs(n)<1e-11?'0':n.toFixed(8)).join(',')+')';
  const mixMatrix=(a,b,t)=>a.map((v,i)=>lerp(v,b[i],t));
  function sourceCount(books){return Math.max(2,...books.map(b=>(Number(b.last)||Number(b.first)||0)+1));}
  function geometry(books,pageCount=sourceCount(books),totalDepth=WIDTH){
    const sheets=Math.ceil(pageCount/2),depth=Math.max(.001,Number(totalDepth)||WIDTH),labelWidth=Math.min(18,depth);
    const slots=books.map((book,i)=>{const sheet=Math.max(0,Math.min(sheets-1,Math.floor((Number(book.first)||0)/2))),anchorDepth=sheet/sheets*depth;
      return {index:i,group:Math.floor(i/3),testament:i<39?'old':'new',sheet,anchorDepth,
        physical:{x:clamp(anchorDepth-labelWidth/2,0,depth-labelWidth),y:20+i*10,width:labelWidth,height:9},
        digital:{x:23+(i%2)*221,y:91+Math.floor(i/2)*ROW,width:212,height:64}};});
    const groups=[];for(let i=0;i<slots.length;i+=3){const first=slots[i];groups.push({index:i/3,first:i,indices:slots.slice(i,i+3).map(s=>s.index),testament:first.testament,x:first.physical.x,y:first.physical.y,width:labelWidth,height:29,anchorDepth:first.anchorDepth,fraction:first.anchorDepth/depth});}
    return {groups,slots,totalDepth:depth,pageCount,totalSheets:sheets,digitalHeight:91+Math.ceil(books.length/2)*ROW+38};
  }
  const groupBooks=(books,pageCount,totalDepth)=>geometry(books,pageCount,totalDepth).groups;
  function layoutAt(slot,amount){const d=clamp(amount),a=slot.physical,b=slot.digital;return {x:lerp(a.x,b.x,d),y:lerp(a.y,b.y,d),width:lerp(a.width,b.width,d),height:lerp(a.height,b.height,d)};}
  function create(options){
    const {host,books,onSelect,onClose,onViewChange,onPan}=options;
    if(!host?.ownerDocument||!Array.isArray(books)||!books.length)throw new TypeError('Index requires a DOM host and books');
    const doc=host.ownerDocument,disposers=[];let model=geometry(books,options.pageCount),digital=0,focused=-1,scrollAnchor=0,lastView='physical',destroyed=false;
    let frame={leftMatrix:translation(480-WIDTH/2,0,480),rightMatrix:translation(480-WIDTH/2,0,480),splitDepth:0,totalDepth:WIDTH};
    let drag=null,suppressClick=false;
    function el(tag,className,parent,text){const n=doc.createElement(tag);n.className=className;if(text!=null)n.textContent=text;if(parent)parent.appendChild(n);return n;}
    function listen(n,type,fn,opts){n.addEventListener(type,fn,opts);disposers.push(()=>n.removeEventListener(type,fn,opts));}
    function parent(n,target){if(n.parentElement!==target&&n.parent!==target)target.appendChild(n);}
    const root=el('div','pbi-root',host);root.setAttribute('role','group');root.setAttribute('aria-label','圣经书侧拇指索引');
    const panSurfaces=[el('div','pbi-pan-surface pbi-pan-left',root),el('div','pbi-pan-surface pbi-pan-right',root)];
    panSurfaces.forEach(n=>n.setAttribute('aria-hidden','true'));
    const viewport=el('div','pbi-scroll',root),sheet=el('div','pbi-sheet',viewport);
    const buttons=books.map((book,i)=>{
      const button=el('button','pbi-book pbi-'+(i<39?'old':'new'),root);button.type='button';button.dataset.bookIndex=String(i);button.title=book.name;button.setAttribute('aria-label','打开'+book.name);
      const fragments=[0,1].map(side=>{const fragment=el('span','pbi-fragment',button);fragment.setAttribute('aria-hidden','true');fragment.dataset.side=side?'right':'left';
        const abbr=el('span','pbi-abbr',fragment,book.short||book.name.slice(0,2)),name=el('span','pbi-name',fragment,book.name),order=el('span','pbi-order',fragment,String(i+1).padStart(2,'0')),tick=el('span','pbi-depth-tick',fragment);return{fragment,abbr,name,order,tick};});
      listen(button,'click',e=>{e.stopPropagation();if(!suppressClick||e.detail===0)onSelect?.(i);});return{button,fragments};
    });
    const heading=el('div','pbi-heading',root);heading.setAttribute('aria-hidden','true');el('span','pbi-heading-kicker',heading,'同一纸层 · 展开索引');el('strong','pbi-heading-title',heading,'按书卷找到那一页');
    const note=el('div','pbi-digital-note',sheet,'旧约墨黑 · 新约朱红　／　上下滑动查看全部书卷');note.setAttribute('aria-hidden','true');note.style.top=(model.digitalHeight-32)+'px';
    // Native hit testing of a 3D surface may choose its neighbour. Resolve the
    // current projected button rectangles, not source order or guessed depth.
    listen(root,'click',e=>{
      if(e.detail!==0&&suppressClick){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();return;}
      if(e.detail===0||!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY))return;
      let nearest=null,distance=Infinity;buttons.forEach(({button},i)=>{const r=button.getBoundingClientRect();if(!r.width||!r.height)return;
        if(e.clientX<r.left-2||e.clientX>r.right+2||e.clientY<r.top-2||e.clientY>r.bottom+2)return;
        const delta=Math.hypot(e.clientX-r.left-r.width/2,e.clientY-r.top-r.height/2);if(delta<distance){distance=delta;nearest=i;}});
      if(nearest!==null){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();onSelect?.(nearest);}
    },true);
    listen(root,'pointerdown',e=>{e.stopPropagation();if(digital!==0||e.button>0)return;suppressClick=false;drag={id:e.pointerId,start:e.clientY,last:e.clientY,moved:false};try{root.setPointerCapture?.(e.pointerId);}catch{}});
    listen(root,'pointermove',e=>{e.stopPropagation();if(digital!==0||!drag||e.pointerId!==drag.id)return;const dy=e.clientY-drag.last;drag.last=e.clientY;if(Math.abs(e.clientY-drag.start)>8)drag.moved=true;if(drag.moved){suppressClick=true;e.preventDefault?.();onPan?.(-dy);}});
    function endDrag(e){e.stopPropagation();if(drag&&e.pointerId===drag.id){suppressClick=drag.moved;try{root.releasePointerCapture?.(e.pointerId);}catch{}drag=null;}}
    listen(root,'pointerup',endDrag);listen(root,'pointercancel',endDrag);
    listen(root,'wheel',e=>{e.stopPropagation();if(digital===0){e.preventDefault();onPan?.(Number(e.deltaY)||0);}},{passive:false});
    for(const type of ['dblclick','contextmenu'])listen(root,type,e=>{e.stopPropagation();e.preventDefault();});
    listen(root,'keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();onClose?.();}});
    function paint(){
      const d=digital,w=model.totalDepth,split=clamp(frame.splitDepth,0,w),labelProgress=smooth(.25,.9,d);
      root.style.setProperty('--pbi-digital',d.toFixed(4));root.dataset.splitDepth=split.toFixed(6);root.dataset.totalDepth=w.toFixed(6);
      viewport.style.transform='translate3d(240px,0px,482px)';viewport.style.overflowY=d===1?'auto':'hidden';viewport.style.pointerEvents=d===1?'auto':'none';viewport.style.opacity='1';
      sheet.style.height=lerp(HEIGHT,model.digitalHeight,d)+'px';heading.style.transform='translate3d(240px,0px,482.5px)';heading.style.opacity=String(labelProgress);note.style.opacity=String(labelProgress);
      root.classList.toggle('pbi-is-digital',d===1);root.classList.toggle('pbi-is-morphing',d>0&&d<1);
      panSurfaces.forEach((surface,i)=>{surface.style.width=w+'px';surface.style.height=HEIGHT+'px';surface.style.transform=css(multiply(i?frame.rightMatrix:frame.leftMatrix,translation(0,0,.06)));surface.style.clipPath=i?`inset(0 0 0 ${split}px)`:`inset(0 ${w-split}px 0 0)`;surface.style.pointerEvents=d===0?'auto':'none';});
      buttons.forEach((nodes,i)=>{
        const slot=model.slots[i],a=slot.physical,b=slot.digital,box=layoutAt(slot,d),ratio=clamp((split-a.x)/a.width),side=slot.anchorDepth+1e-8<split?0:1;
        const physical=[frame.leftMatrix,frame.rightMatrix].map(m=>multiply(m,translation(a.x,a.y,.08)));
        const target=translation(240+b.x,b.y-scrollAnchor,482.2),matrices=physical.map(m=>mixMatrix(m,target,d)),base=matrices[side];
        const style=nodes.button.style;style.width=box.width+'px';style.height=box.height+'px';style.transformOrigin='0 0';style.opacity='1';
        nodes.button.dataset.anchorDepth=slot.anchorDepth.toFixed(8);nodes.button.dataset.sheet=String(slot.sheet);nodes.button.dataset.paperSide=side?'right':'left';
        if(d===1){parent(nodes.button,sheet);style.left=b.x+'px';style.top=b.y+'px';style.transform='none';}
        else{parent(nodes.button,root);style.left='0px';style.top='0px';style.transform=css(base);}
        const inv=d===1?null:inverse(base);
        nodes.fragments.forEach((part,k)=>{
          const ps=part.fragment.style;ps.width=box.width+'px';ps.height=box.height+'px';ps.transformOrigin='0 0';ps.transform=d===1?'none':css(multiply(inv,matrices[k]));
          ps.clipPath=k?`inset(0 0 0 ${ratio*100}%)`:`inset(0 ${(1-ratio)*100}% 0 0)`;
          ps.visibility=(k?ratio===1:ratio===0)?'hidden':'visible';
          part.abbr.style.width=lerp(a.width,38,d)+'px';part.abbr.style.height=lerp(a.height,35,d)+'px';part.abbr.style.left=lerp(0,7,d)+'px';part.abbr.style.fontSize=lerp(5.8,16,d)+'px';
          part.name.style.opacity=String(labelProgress);part.order.style.opacity=String(labelProgress*.65);
          part.tick.style.left=clamp((slot.anchorDepth-a.x)/a.width)*box.width+'px';part.tick.style.opacity=String(1-d);
        });
      });
    }
    function setPhysicalFrame(next){
      if(destroyed)return;frame={leftMatrix:matrix(next?.leftMatrix,frame.leftMatrix),rightMatrix:matrix(next?.rightMatrix,frame.rightMatrix),splitDepth:Number.isFinite(next?.splitDepth)?next.splitDepth:frame.splitDepth,totalDepth:Number.isFinite(next?.totalDepth)?next.totalDepth:frame.totalDepth};
      if(frame.totalDepth!==model.totalDepth)model=geometry(books,model.pageCount,frame.totalDepth);paint();
    }
    function setReadingMaterial(material){
      if(!material)return;frame.splitDepth=Number(material.leftDepth)||0;
      if(material.totalDepth&&material.totalDepth!==model.totalDepth){model=geometry(books,material.pageCount||model.pageCount,material.totalDepth);frame.totalDepth=material.totalDepth;}
      root.dataset.rightSheets=String(material.rightSheets);root.dataset.leftSheets=String(material.leftSheets);paint();
    }
    function setProgress(value){root.style.setProperty('--pbi-present',clamp(value).toFixed(4));return clamp(value);}
    function setDigital(value){
      if(destroyed)return{amount:digital,view:lastView,destroyed:true};const next=clamp(value);
      if(digital===1&&next<1)scrollAnchor=viewport.scrollTop;if(digital===0&&next>0)scrollAnchor=0;
      digital=next;paint();if(digital<1||scrollAnchor>0)viewport.scrollTop=scrollAnchor*digital;
      const currentScroll=viewport.scrollTop;if(digital===0||digital===1)scrollAnchor=0;
      const view=digital===0?'physical':digital===1?'digital':'transition';if(view!==lastView){lastView=view;onViewChange?.(view);}
      return{amount:digital,view,scrollTop:currentScroll,height:lerp(HEIGHT,model.digitalHeight,digital)};
    }
    function clearFocus(){if(focused>=0){buttons[focused].button.classList.remove('pbi-focused');buttons[focused].button.removeAttribute('aria-current');}focused=-1;}
    function focusBook(index){const i=Number(index);if(!Number.isInteger(i)||i<0||i>=books.length)return null;clearFocus();focused=i;buttons[i].button.classList.add('pbi-focused');buttons[i].button.setAttribute('aria-current','true');
      const slot=model.slots[i],a=slot.physical;return{index:i,group:slot.group,depth:slot.anchorDepth,anchorDepth:slot.anchorDepth,sheet:slot.sheet,x:480+slot.anchorDepth-model.totalDepth/2,y:a.y+a.height/2,width:a.width,height:a.height,left:a.x,top:a.y,name:books[i].name};}
    function destroy(){if(destroyed)return;destroyed=true;disposers.forEach(fn=>fn());root.remove();}
    setProgress(1);setDigital(0);
    return{setReadingMaterial,setPhysicalFrame,setProgress,setDigital,focusBook,clearFocus,resize:()=>paint(),destroy};
  }
  return{create,geometry,groupBooks,layoutAt,WIDTH,HEIGHT,DIGITAL_WIDTH,multiply,inverse,translation,css};
});
