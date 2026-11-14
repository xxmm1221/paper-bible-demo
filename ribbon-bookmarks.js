/* Two independent, explicit ribbon bookmarks. The reader owns navigation. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperRibbons=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const KEYS=Object.freeze(['paper-bible-ribbon-v1-0','paper-bible-ribbon-v1-1']);
  const SVG='http://www.w3.org/2000/svg';
  let instanceId=0;
  const copy=value=>value?JSON.parse(JSON.stringify(value)):null;
  const text=value=>typeof value==='string'?value.slice(0,100):'';
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  function validPose(pose){
    if(!pose||!Number.isFinite(pose.zoom)||pose.zoom<=0||pose.zoom>30||
      !Number.isFinite(pose.cx)||!Number.isFinite(pose.cy)||Math.abs(pose.cx)>4000||Math.abs(pose.cy)>4000)return undefined;
    return {zoom:pose.zoom,cx:pose.cx,cy:pose.cy,focus:['fit','left','right','custom'].includes(pose.focus)?pose.focus:'custom'};
  }
  function normalize(value,pageCount,fromStorage=false){
    if(!value||typeof value!=='object'||(fromStorage&&value.version!==1))return null;
    const page=value.page===undefined?value.spread:value.page;
    if(!Number.isInteger(page)||page<0||page>=pageCount)return null;
    const pose=validPose(value.pose),record={version:1,page,spread:page&~1,
      bookName:text(value.bookName),ref:text(value.ref)};
    if(pose)record.pose=pose;
    return record;
  }
  function createModel({storage,pageCount}){
    const count=Number.isFinite(Number(pageCount))?Math.max(0,Math.floor(Number(pageCount))):0;
    const slots=KEYS.map(key=>{
      try{return normalize(JSON.parse(storage?.getItem(key)||'null'),count,true);}catch(_){return null;}
    });
    function check(index){if(index!==0&&index!==1)throw new RangeError('Ribbon slot must be 0 or 1');}
    function place(index,current){
      check(index);const record=normalize(current,count);if(!record)return {ok:false,persisted:false};
      slots[index]=record;let persisted=false;
      try{if(storage?.setItem){storage.setItem(KEYS[index],JSON.stringify(record));persisted=true;}}catch(_){}
      return {ok:true,persisted,record:copy(record)};
    }
    function clear(index){
      check(index);slots[index]=null;let persisted=false;
      try{if(storage?.removeItem){storage.removeItem(KEYS[index]);persisted=true;}}catch(_){}
      return {ok:true,persisted};
    }
    return {place,clear,get:index=>{check(index);return copy(slots[index]);},getSlots:()=>slots.map(copy)};
  }
  function create({host,panelHost,storage,pageCount,getCurrent,onNavigate}){
    if(!host)throw new TypeError('A ribbon host is required');
    const doc=host.ownerDocument,panelParent=panelHost||host.closest?.('.stage-wrap')||host.parentElement;
    const model=createModel({storage,pageCount}),id=++instanceId;
    let selected=0,reading=true,closeProgress=0,scale=1,destroyed=false,returnFocus=null;
    const disposers=[];
    function listen(node,type,handler,options){node.addEventListener(type,handler,options);disposers.push(()=>node.removeEventListener(type,handler,options));}
    function element(tag,className,parent,label){const el=doc.createElement(tag);el.className=className;if(label!==undefined)el.textContent=label;if(parent)parent.appendChild(el);return el;}
    function svgElement(tag,attrs,parent){const el=doc.createElementNS(SVG,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,String(value));if(parent)parent.appendChild(el);return el;}
    function button(className,parent,label){const el=element('button',className,parent,label);el.type='button';return el;}
    host.classList.add('paper-ribbons');
    host.setAttribute('role','group');
    host.setAttribute('aria-label','两根红色丝带书签');
    const art=svgElement('svg',{viewBox:'0 0 960 780','aria-hidden':'true',class:'pr-art'},host);
    const defs=svgElement('defs',{},art);
    const pattern=svgElement('pattern',{id:`pr-weave-${id}`,patternUnits:'userSpaceOnUse',width:2,height:2},defs);
    svgElement('path',{d:'M0 .4H2 M.4 0V2',stroke:'#ffe0bd','stroke-width':'.22',opacity:'.22'},pattern);
    const paths=[],tips=[];
    for(let i=0;i<2;i++){
      const gradient=svgElement('linearGradient',{id:`pr-silk-${id}-${i}`,x1:'0%',x2:'100%',y1:'0%',y2:'0%'},defs);
      const colors=i?['#702a2b','#ac4a42','#c26853','#91382f','#612422']:['#4d1e2b','#813444','#aa5660','#77303c','#491c29'];
      [0,.2,.46,.77,1].forEach((offset,j)=>svgElement('stop',{offset,'stop-color':colors[j]},gradient));
      const group=svgElement('g',{class:`pr-ribbon pr-ribbon-${i}`},art);
      const shadow=svgElement('path',{fill:'#311515',opacity:'.14',transform:'translate(1.4 2.2)'},group);
      const silk=svgElement('path',{fill:`url(#pr-silk-${id}-${i})`,stroke:i?'#672a25':'#512331','stroke-width':'.45'},group);
      const weave=svgElement('path',{fill:`url(#pr-weave-${id})`,opacity:'.42'},group);
      paths.push({group,shadow,silk,weave});
      const tip=button('pr-tip',host,'');
      tip.setAttribute('aria-controls',`pr-panel-${id}`);tip.setAttribute('aria-expanded','false');
      element('span','pr-tip-mark',tip,i?'Ⅱ':'Ⅰ');
      listen(tip,'click',()=>open(i));tips.push(tip);
    }
    const panel=element('section','pr-panel',panelParent);
    panel.id=`pr-panel-${id}`;panel.hidden=true;panel.setAttribute('aria-label','红色丝带书签操作');
    const header=element('div','pr-panel-header',panel);
    const title=element('h3','pr-title',header,'红色丝带书签');
    const closeButton=button('pr-close',header,'×');closeButton.setAttribute('aria-label','收起书签操作');
    const selector=element('div','pr-slot-selector',panel);selector.setAttribute('role','group');selector.setAttribute('aria-label','选择丝带');
    const slotButtons=[0,1].map(i=>{const b=button(`pr-slot pr-slot-${i}`,selector,i?'第二根 · Ⅱ':'第一根 · Ⅰ');listen(b,'click',()=>{selected=i;paintPanel();});return b;});
    const detail=element('p','pr-detail',panel),hint=element('p','pr-hint',panel);
    const actions=element('div','pr-actions',panel);
    const navigate=button('pr-go',actions,'回到书签');
    const place=button('pr-place',actions,'夹在这一页');
    const remove=button('pr-remove',actions,'取出书签');
    const status=element('p','pr-status',panel);status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    function current(){try{return getCurrent?.()||{};}catch(_){return {};}}
    function description(slot){return `${slot.bookName||'已夹页'}${slot.ref?' '+slot.ref:''} · 第 ${slot.spread} — ${Math.min(slot.spread+1,pageCount-1)} 页`;}
    function paintPanel(){
      const slot=model.get(selected);
      title.textContent=`${selected?'第二':'第一'}根红色丝带`;
      slotButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===selected)));
      if(!panel.hidden)tips.forEach((t,i)=>t.setAttribute('aria-expanded',String(i===selected)));
      detail.textContent=slot?description(slot):'这根丝带还没有夹页。';
      hint.textContent=slot?'换一页阅读，丝带仍会留在这里。':'打开想记住的一页，再把这根丝带夹进去。';
      navigate.hidden=!slot;remove.hidden=!slot;place.textContent=slot?'改夹当前页':'夹在这一页';
      status.textContent='';
    }
    function close(restoreFocus=false){
      if(panel.hidden)return;
      panel.hidden=true;tips.forEach(t=>t.setAttribute('aria-expanded','false'));
      if(restoreFocus&&reading)returnFocus?.focus?.({preventScroll:true});
    }
    function open(index=0){
      if(!reading||destroyed)return;
      selected=index===1?1:0;returnFocus=tips[selected];paintPanel();panel.hidden=false;
      tips.forEach((t,i)=>t.setAttribute('aria-expanded',String(i===selected)));
      (model.get(selected)?navigate:place).focus?.({preventScroll:true});
    }
    function update(options={}){
      if(destroyed)return;
      if(Number.isFinite(options.scale)&&options.scale>0)scale=options.scale;
      const saved=model.getSlots(),now=current();
      // The two silk tails fan apart just enough to keep separate 44px targets
      // when the whole book is small. Their heads stay at the actual spine.
      const spread=Math.max(24,24/scale),hit=Math.max(44,44/scale);
      saved.forEach((slot,i)=>{
        const here=!!slot&&slot.spread===((now.spread||0)&~1);
        const endX=480+(i?spread:-spread),endY=733+i*14,startX=here?(i?489:471):endX+(i?-3:3),startY=here?8:690;
        const bendY=here?648:710,half=5.8;
        const d=`M${startX-half} ${startY} C${startX-half} ${bendY},${endX-half} ${bendY},${endX-half} ${endY} L${endX} ${endY-8} L${endX+half} ${endY} C${endX+half} ${bendY},${startX+half} ${bendY},${startX+half} ${startY}Z`;
        for(const key of ['shadow','silk','weave'])paths[i][key].setAttribute('d',d);
        paths[i].group.setAttribute('data-placed',String(!!slot));paths[i].group.setAttribute('data-current',String(here));
        Object.assign(tips[i].style,{left:`${endX-hit/2}px`,top:`${endY-hit/2-5}px`,width:`${hit}px`,height:`${hit}px`});
        tips[i].setAttribute('aria-label',`打开第${i?'二':'一'}根红色丝带书签${slot?'，'+description(slot):'，尚未夹页'}`);
        tips[i].title=slot?description(slot):`第${i?'二':'一'}根丝带 · 点按夹页`;
        tips[i].dataset.placed=String(!!slot);tips[i].dataset.current=String(here);
      });
      host.style.setProperty('--pr-close',closeProgress.toFixed(4));
      host.dataset.reading=String(reading);
    }
    function setScene(isReading,progress=0){
      reading=!!isReading;closeProgress=clamp(Number(progress)||0,0,1);
      host.inert=!reading;panel.inert=!reading;
      if(!reading)close();update();
    }
    listen(closeButton,'click',()=>close(true));
    listen(place,'click',()=>{
      const result=model.place(selected,current());update();paintPanel();
      status.textContent=result.ok?`已把第${selected?'二':'一'}根丝带夹在当前页。${result.persisted?'':'浏览器未允许保存，仅在本次打开期间保留。'}`:'这一页暂时无法夹入书签。';
    });
    listen(remove,'click',()=>{
      const result=model.clear(selected);update();paintPanel();
      status.textContent=`已取出这根丝带。${result.persisted?'':'未能更新浏览器存档；重新打开后可能恢复旧书签。'}`;
    });
    listen(navigate,'click',()=>{
      const slot=model.get(selected);if(!slot)return;close();onNavigate?.(slot.page,copy(slot.pose));
    });
    for(const node of [host,panel]){
      for(const type of ['pointerdown','pointermove','pointerup','pointercancel','click','dblclick'])listen(node,type,event=>event.stopPropagation());
      listen(node,'keydown',event=>{
        // Keep arrow/space keys on these controls from also turning a page.
        // Tab still reaches the shell's keyboard-focus handling.
        if(event.key!=='Tab')event.stopPropagation();
        if(event.key==='Escape'){event.preventDefault();close(true);}
      });
    }
    listen(doc,'pointerdown',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!host.contains(event.target))close();},true);
    update();
    function destroy(){if(destroyed)return;destroyed=true;disposers.forEach(fn=>fn());panel.remove();art.remove();tips.forEach(t=>t.remove());host.classList.remove('paper-ribbons');}
    return {update,setScene,open,close,destroy,getSlots:model.getSlots};
  }
  return {KEYS,normalize,validPose,createModel,create};
});
