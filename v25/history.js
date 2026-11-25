/* Each deliberate jump starts (or resumes) a trail. Only committed turns
 * advance its endpoint; ordinary viewing, zoom and speculative animations do not. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PaperReadingHistory=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const LEGACY='paper-bible-reading-history-v1',KEY='paper-bible-v25-trails-v1',COMPARE_KEY='paper-bible-v25-compare-trails-v1',MAX_RECENT=24;
  const clean=(s,max)=>typeof s==='string'?s.trim().slice(0,max):'';
  const copy=e=>e?{...e,...(e.anchor?{anchor:{...e.anchor}}:{})}:null;
  function location(v,pageCount){
    if(!v||!Number.isSafeInteger(v.page)||v.page<0||v.page>=pageCount)return null;
    const bookName=clean(v.bookName,60),bookCode=clean(v.bookCode,12),ref=clean(v.ref,32);
    return {page:v.page,bookName,bookCode,ref};
  }
  const same=(a,b)=>a.page===b.page&&a.ref===b.ref&&(a.bookCode&&b.bookCode?a.bookCode===b.bookCode:a.bookName===b.bookName);
  const validId=id=>typeof id==='string'&&/^r[0-9]+$/.test(id)&&Number.isSafeInteger(Number(id.slice(1)));
  const fresh=()=>({version:1,activeId:null,serial:0,pinSerial:0,items:[]});
  function decode(raw,pageCount){
    let data;try{data=JSON.parse(raw);}catch{return fresh();}
    if(data?.version!==1||!Array.isArray(data.items))return fresh();
    const s=fresh(),seen=new Set();
    for(const item of data.items){
      const loc=location(item,pageCount);if(!loc||!validId(item.id)||seen.has(item.id))continue;
      seen.add(item.id);
      const pinned=item.pinned===true, pinOrder=pinned&&Number.isSafeInteger(item.pinOrder)&&item.pinOrder>0?item.pinOrder:0;
      s.items.push({...loc,anchor:location(item.anchor,pageCount)||{...loc},id:item.id,pinned,...(pinOrder?{pinOrder}:{})});
      s.pinSerial=Math.max(s.pinSerial,pinOrder);
      s.serial=Math.max(s.serial,Number(item.id.slice(1)));
    }
    if(Number.isSafeInteger(data.serial)&&data.serial>=s.serial)s.serial=data.serial;
    if(Number.isSafeInteger(data.pinSerial)&&data.pinSerial>=s.pinSerial)s.pinSerial=data.pinSerial;
    if(seen.has(data.activeId))s.activeId=data.activeId;
    return s;
  }
  function createModel({storage,pageCount,byChapter=false,books=[]}){
    const key=byChapter?COMPARE_KEY:KEY,codeByName=new Map(books.map(b=>[b.name,b.code]));
    const identity=loc=>{
      const book=loc.bookCode||codeByName.get(loc.bookName)||loc.bookName,chapter=/^(\d+):/.exec(loc.ref)?.[1];
      return book&&chapter?book+':'+Number(chapter):'';
    };
    const matches=(a,b)=>byChapter&&identity(a)&&identity(b)?identity(a)===identity(b):same(a,b);
    let raw=null,state=fresh(),current=null,removed=null;
    const find=id=>state.items.find(e=>e.id===id);
    // A pin is an independent physical copy, even when its bookmark happens
    // to land on the same chapter as an ordinary recent record.
    const findChapter=loc=>state.items.find(e=>!e.pinned&&matches(e,loc));
    function restoreBookmarks(){
      for(const e of state.items){
        // Older trails kept their starting point in `anchor`. The visible
        // bookmark is always the last committed page, not that old start.
        e.anchor={page:e.page,bookName:e.bookName,bookCode:e.bookCode,ref:e.ref};
      }
    }
    function pull(){
      let next;try{next=storage?.getItem(key)??null;}catch{return;}
      if(next===raw)return;
      raw=next;state=decode(next,pageCount);
      if(byChapter)restoreBookmarks();
      if(current&&!find(current))current=null;
    }
    function save(){
      const encoded=JSON.stringify(state);if(encoded===raw)return;
      try{if(storage?.setItem){storage.setItem(key,encoded);raw=encoded;}}catch{/* private/locked stores still work for this session */}
    }
    function trim(keep){
      const retained=new Set([current,keep].filter(id=>{const e=find(id);return e&&!e.pinned;}));
      for(const e of state.items)if(!e.pinned&&retained.size<MAX_RECENT)retained.add(e.id);
      state.items=state.items.filter(e=>e.pinned||retained.has(e.id));
    }
    function list(){pull();return [...state.items.filter(e=>e.pinned).sort((a,b)=>(b.pinOrder||0)-(a.pinOrder||0)),...state.items.filter(e=>!e.pinned)].map(copy);}
    // Import once without writing into the production reader's storage.
    try{if(storage?.getItem(key)==null){
      const old=(byChapter&&storage?.getItem(KEY))||storage?.getItem(LEGACY);
      if(old){state=decode(old,pageCount);if(byChapter)restoreBookmarks();save();}
    }}catch{}
    pull();
    function start(loc){
      pull();loc=location(loc,pageCount);if(!loc)return;
      // Refreshes often supply the first verse on a physical page, not the
      // selected chapter on that page. Do not overwrite its more exact anchor.
      const active=find(state.activeId);
      if(byChapter){
        const found=(active&&active.page===loc.page?active:findChapter(loc));
        if(!found)return visit(loc,true);
        current=state.activeId=found.id;save();return copy(found);
      }
      current=active?(active.page===loc.page?active.id:state.items.find(e=>same(e,loc))?.id||null):null;
      return copy(find(current));
    }
    function advance(loc){
      pull();loc=location(loc,pageCount);const e=find(current);if(!loc)return null;
      if(byChapter&&!e)return visit(loc,true);
      if(!e)return null;
      if(same(e,loc)&&state.activeId===current)return copy(e);
      Object.assign(e,loc);if(byChapter)e.anchor={...loc};
      state.activeId=e.id;save();return copy(e);
    }
    function visit(loc,main,known){
      const e=known||findChapter(loc)||{id:'r'+(++state.serial),pinned:false};
      Object.assign(e,loc,{anchor:{...loc}});
      state.items=[e,...state.items.filter(item=>item!==e)];
      if(main)current=state.activeId=e.id;
      trim(e.id);save();return copy(e);
    }
    function visitFloat(loc){
      pull();loc=location(loc,pageCount);
      return byChapter&&loc?visit(loc,false):null;
    }
    function jump(loc,requestedId){
      pull();loc=location(loc,pageCount);if(!loc)return null;
      if(byChapter){
        const requested=requestedId==null?null:find(requestedId);
        if(requestedId!=null&&!requested)return null;
        return visit(loc,true,requested);
      }
      let e;
      if(requestedId!=null){
        e=find(requestedId);
        // Removing a line while its page-turn animation is pending must not
        // recreate it, or start moving the line that we just navigated away from.
        if(!e){current=null;state.activeId=null;save();return null;}
      }else e=state.items.find(record=>same(record.anchor||record,loc));
      if(!e){e={...loc,anchor:{...loc},id:'r'+(++state.serial),pinned:false};state.items.unshift(e);}
      else {
        Object.assign(e,loc);
        // Store access order separately from the pinned display order. When a
        // pin is removed the record rejoins the recent list in its proper place.
        state.items.splice(state.items.indexOf(e),1);state.items.unshift(e);
      }
      current=state.activeId=e.id;trim();save();return copy(e);
    }
    function pickVerse(loc){
      pull();loc=location(loc,pageCount);if(!loc)return null;
      if(byChapter){
        const e=find(current);
        return e?visit(loc,true,e):visit(loc,true);
      }
      const e=find(current);if(!e)return jump(loc);
      Object.assign(e,loc);e.anchor={...loc};state.activeId=e.id;save();return copy(e);
    }
    function pin(id,on){
      pull();const e=find(id);if(!e)return false;
      const next=on===undefined?!e.pinned:!!on;
      if(e.pinned===next)return true;
      e.pinned=next;
      if(next)e.pinOrder=++state.pinSerial;else delete e.pinOrder;
      trim(id);save();return true;
    }
    function remove(id){
      pull();const index=state.items.findIndex(e=>e.id===id);if(index<0)return false;
      const [e]=state.items.splice(index,1);
      removed={entry:copy(e),index};if(current===id)current=null;
      if(state.activeId===id)state.activeId=null;
      save();return true;
    }
    function undo(){
      pull();if(!removed)return false;const {entry,index}=removed;removed=null;
      if(find(entry.id))return false;
      state.items.splice(Math.min(index,state.items.length),0,entry);trim(entry.id);save();
      return true; // Restore the record, not the reading position.
    }
    return {start,advance,jump,pickVerse,visitFloat,list,pin,remove,undo,get:id=>{pull();return copy(find(id));},
      current:()=>{pull();return current;},canUndo:()=>Boolean(removed)};
  }
  function label(e){return (e.bookName||e.bookCode||'书页')+(e.ref?' '+e.ref:(!e.bookName&&!e.bookCode?' '+(e.page+1):''));}
  function create({host,storage,pageCount,onNavigate,onFloat,onSettings,byChapter=false,books=[]}){
    if(!host?.ownerDocument||typeof onNavigate!=='function')throw TypeError('History needs a shelf host and navigation callback');
    const doc=host.ownerDocument,model=createModel({storage,pageCount,byChapter,books}),win=doc.defaultView;
    const key=byChapter?COMPARE_KEY:KEY;
    const shorts=new Map(books.map(b=>[b.code,b.short]));
    const shell=host.closest('.reader');
    const el=(tag,cls,txt)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(txt)n.textContent=txt;return n;};
    const button=(cls,txt,title,fn)=>{const b=el('button',cls,txt);b.type='button';b.setAttribute('aria-label',title);b.title=title;b.addEventListener('click',fn);return b;};
    const shelf=el('div','rh-rail'),track=el('div','rh-track');
    const compact=doc.documentElement.dataset?.readerBuild==='index-25';
    const caption=compact?button('rh-toggle','','浏览历史',()=>setHistoryOpen(track.hidden)):
      el('span','rh-caption','最近跳转');
    if(compact){
      caption.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 4v5h5M3.7 9a8.5 8.5 0 1 1 .8 7M12 7v5l3 2"/></svg>';
      track.id='rh-recent';track.hidden=false;
      caption.setAttribute('aria-controls',track.id);caption.setAttribute('aria-expanded','true');
    }
    track.setAttribute('role','group');track.setAttribute('aria-label','最近阅读位置');
    const status=el('span','rh-sr');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    let controls=new Map(),removedId=null,shown=null,via=null,modality=null,pending=null,blocked=null;
    const HOLD_MS=420,DRIFT=8,contacts=new Set(),listeners=[];
    const listen=(n,type,fn,opts)=>{if(!n?.addEventListener)return;n.addEventListener(type,fn,opts);listeners.push(()=>n.removeEventListener?.(type,fn,opts));};
    const rowOf=node=>node?.closest?.('.rh-item')?.dataset.id;
    function cancelHold(){if(pending){win.clearTimeout(pending.timer);pending=null;}}
    function placeTools(row){
      const box=row.item.getBoundingClientRect?.(),rail=track.getBoundingClientRect?.();
      if(!box||!rail||!rail.width)return;
      const w=row.del.getBoundingClientRect().width||26,extra=w*((row.item.dataset.pinned?1:2)+(onFloat?1:0));
      // Place the tools directly ABOVE this chip, never in the navigation
      // strip. No reflow: even the original centre of the next short label
      // remains a navigation target when a pointer arrives from its neighbour.
      const at=Math.max(rail.left,Math.min(rail.right-extra,(box.left+box.right-extra)/2));
      row.item.style?.setProperty('--rh-tools-left',at+'px');
      row.item.style?.setProperty('--rh-tools-bottom',(box.top+1)+'px');
    }
    function reveal(id,reason){
      if(id===shown&&reason===via)return;
      const prev=controls.get(shown);if(prev){delete prev.item.dataset.reveal;prev.pin.tabIndex=prev.item.dataset.pinned?0:-1;prev.del.tabIndex=-1;if(prev.float)prev.float.tabIndex=-1;}
      const row=controls.get(id);shown=row?id:null;via=row?reason:null;
      if(row){row.item.dataset.reveal=reason;row.pin.tabIndex=row.del.tabIndex=0;if(row.float)row.float.tabIndex=0;placeTools(row);}
    }
    function clearShown(){reveal(null,null);}
    const touch=e=>e.pointerType==='touch'||e.pointerType==='pen';
    listen(track,'pointerover',e=>{if(e.pointerType==='mouse'){const id=rowOf(e.target);if(id)reveal(id,'mouse');}});
    listen(track,'pointerout',e=>{if(e.pointerType==='mouse'&&via==='mouse'&&rowOf(e.relatedTarget)!==shown)clearShown();});
    // Actual pointer type matters: a Windows touchscreen laptop can also have
    // a mouse. Touch-generated hover must not briefly expose another label.
    listen(doc,'pointerdown',e=>{
      modality='pointer';blocked=null;
      if(touch(e)){contacts.add(e.pointerId);if(contacts.size>1&&pending){blocked=pending.id;cancelHold();}}
      if(via!=='mouse'||e.pointerType!=='mouse'||rowOf(e.target)!==shown){
        if(!(via==='touch'&&rowOf(e.target)===shown))clearShown();
      }
    },true);
    listen(track,'pointerdown',e=>{
      if(!touch(e)||contacts.size>1||e.button>0)return;
      const target=e.target?.closest?.('.rh-chip')||e.target?.closest?.('.rh-pin'),id=rowOf(target);if(!id)return;
      cancelHold();
      const p=pending={id,pointer:e.pointerId,x:e.clientX,y:e.clientY};
      p.timer=win.setTimeout(()=>{
        if(pending!==p)return;pending=null;blocked=id;reveal(id,'touch');
      },HOLD_MS);
    });
    listen(track,'pointermove',e=>{
      if(e.pointerType==='mouse'){const id=rowOf(e.target);if(id)reveal(id,'mouse');return;}
      if(pending?.pointer===e.pointerId&&Math.hypot(e.clientX-pending.x,e.clientY-pending.y)>=DRIFT){blocked=pending.id;cancelHold();}
    });
    const finishPointer=(e,cancelled)=>{contacts.delete(e.pointerId);if(pending?.pointer===e.pointerId){if(cancelled)blocked=pending.id;cancelHold();}};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(doc,type,e=>finishPointer(e,type!=='pointerup'),true);
    listen(track,'scroll',()=>{if(pending){blocked=pending.id;cancelHold();}if(via==='touch')clearShown();else if(shown)placeTools(controls.get(shown));},{passive:true});
    listen(track,'contextmenu',e=>{if(pending||via==='touch')e.preventDefault();});
    listen(doc,'keydown',e=>{
      if(e.key==='Escape'){clearShown();cancelHold();return;}
      if(e.key==='Tab'||e.key?.startsWith('Arrow')){
        modality='keyboard';blocked=null;const id=rowOf(e.target);if(id)reveal(id,'keyboard');
      }
    },true);
    listen(track,'focusin',e=>{const id=rowOf(e.target);if(id&&(modality==='keyboard'||(!modality&&e.target.matches?.(':focus-visible'))))reveal(id,'keyboard');});
    listen(track,'focusout',e=>{if(via==='keyboard'&&rowOf(e.relatedTarget)!==shown)clearShown();});
    listen(win,'resize',()=>{if(shown)placeTools(controls.get(shown));});
    listen(win,'blur',()=>{clearShown();cancelHold();contacts.clear();blocked=null;});
    const undoButton=button('rh-undo','撤销','撤销上一次删除',()=>{
      const id=removedId;removedId=null;const ok=model.undo();render();
      if(ok){status.textContent='已恢复记录';focusControl(id,'chip');}
    });
    function setHistoryOpen(open){
      track.hidden=!open;caption.setAttribute('aria-expanded',String(open));
      undoButton.hidden=!open||!model.canUndo();
      if(!open){clearShown();cancelHold();}
    }
    if(compact)listen(win,'paper-reader-chrome-hidden',()=>{clearShown();cancelHold();});
    shelf.append(caption,track,undoButton,status);
    if(compact&&onSettings){
      const gear=button('rh-toggle rh-settings','','阅读设置',onSettings);
      gear.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.4 4.3 10 2.8h4l.6 1.5 1.5.9 1.6-.3 2 3.5-1 1.2v1.8l1 1.2-2 3.5-1.6-.3-1.5.9-.6 1.5h-4l-.6-1.5-1.5-.9-1.6.3-2-3.5 1-1.2V9.6l-1-1.2 2-3.5 1.6.3 1.5-.9Z" transform="translate(0 1.5)"/><circle cx="12" cy="12" r="3"/></svg>';
      shelf.append(gear);
    }
    host.append(shelf);shell?.classList.add('has-history-shelf');doc.documentElement.classList.add('paper-history-on');
    function navigate(id){
      const e=model.get(id);if(!e){render();return;}
      const a=e.anchor||e;onNavigate(a.page,e.id,a);
    }
    function consumed(id,event){
      if(blocked!==id||event.detail===0&&!touch(event))return false;
      blocked=null;event.preventDefault();event.stopPropagation();return true;
    }
    function focusControl(id,action){
      const ctl=controls.get(id)?.[action];if(!ctl)return;
      ctl.focus({preventScroll:true});
      revealInTrack(id);
    }
    function revealInTrack(id){
      // Scroll this track only, not the stage or the document. Include both
      // action slots even for the end item when focus moves after reordering.
      const box=controls.get(id)?.item.getBoundingClientRect?.(),viewport=track.getBoundingClientRect?.();
      if(!box||!viewport?.width||track.hidden)return;
      if(box.right>viewport.right)track.scrollLeft+=box.right-viewport.right+2;
      else if(box.left<viewport.left)track.scrollLeft+=box.left-viewport.left-2;
    }
    function render(){
      const items=model.list(),active=model.current(),scroll=track.scrollLeft,keep=via==='mouse'?null:shown,how=via;
      const prev=doc.activeElement;let restore=null;
      if(prev)for(const [id,row] of controls)for(const key of ['chip','pin','del','float'])if(prev===row[key])restore=[id,key];
      cancelHold();clearShown();track.replaceChildren();controls=new Map();
      if(!items.length)track.appendChild(el('span','rh-empty','暂无记录'));
      for(const e of items){
        const a=e.anchor||e,name=label(a),chapter=/^\d+/.exec(a.ref)?.[0],short=shorts.get(a.bookCode)||a.bookName||a.bookCode||'书页',chipText=short+(chapter?' '+chapter:''),item=el('div','rh-item');item.dataset.id=e.id;
        item.setAttribute('role','group');item.setAttribute('aria-label',name);
        const chip=button('rh-chip',chipText,'返回 '+name,event=>{
          if(consumed(e.id,event))return;
          navigate(e.id);
        });chip.dataset.id=e.id;
        if(e.pinned){item.dataset.pinned='true';chip.title='已置顶 · '+name;}
        if(e.id===active){item.dataset.current='true';chip.setAttribute('aria-current','page');}
        const pin=button('rh-action rh-pin','',(e.pinned?'取消置顶 ':'置顶 ')+name,event=>{
          if(consumed(e.id,event))return;
          if(!model.pin(e.id,!e.pinned)){render();return;}
          status.textContent=(e.pinned?'已取消置顶 ':'已置顶 ')+name;render();focusControl(e.id,'pin');
        });
        // Icons are fixed local markup, never interpolated scripture/storage.
        pin.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><g transform="rotate(32 8 8)"><path class="rh-pin-head" d="M5 2.1h6l-1 1.4v3.2l1.8 2H4.2l1.8-2V3.5z"/><path d="M8 8.9v5.2"/></g></svg>';
        pin.setAttribute('aria-pressed',String(e.pinned));
        pin.tabIndex=e.pinned?0:-1;
        const del=button('rh-action rh-delete','','删除 '+name,event=>{
          if(consumed(e.id,event))return;
          if(model.remove(e.id)){
            removedId=e.id;status.textContent='已删除 '+name+'，可撤销';render();undoButton.focus({preventScroll:true});
          }
        });
        del.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4.3 4.3 7.4 7.4m0-7.4-7.4 7.4"/></svg>';
        del.tabIndex=-1;
        const float=onFloat&&button('rh-action rh-float','','在浮窗打开 '+name,event=>{
          if(consumed(e.id,event))return;
          const latest=model.get(e.id);if(!latest)return;
          clearShown();onFloat(latest.anchor||latest);
        });
        if(float){
          item.dataset.hasFloat='';float.tabIndex=-1;
          float.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5.5 5.5h9v8.5h-9zM11 5.5V2H1.5v8.5h4m4-3v4m-2-2h4"/></svg>';
        }
        item.append(chip,pin,del,...(float?[float]:[]));track.appendChild(item);controls.set(e.id,{item,chip,pin,del,float});
      }
      track.scrollLeft=scroll;undoButton.hidden=track.hidden||!model.canUndo();
      if(restore)focusControl(...restore);
      if(keep)reveal(keep,how);
    }
    const sync=e=>{if(!e.key||e.key===key||e.key.startsWith(key+':'))render();};
    win?.addEventListener('storage',sync);listen(win,'paper-account-data',e=>sync(e.detail||{}));render();
    const apply=(name,...args)=>{const result=model[name](...args);render();if(name==='jump'&&result)revealInTrack(result.id);return result;};
    return {start:loc=>apply('start',loc),advance:loc=>apply('advance',loc),pickVerse:loc=>apply('pickVerse',loc),jump:(loc,id)=>apply('jump',loc,id),visitFloat:loc=>apply('visitFloat',loc),
      list:model.list,element:host,
      destroy(){cancelHold();contacts.clear();for(const off of listeners)off();win?.removeEventListener('storage',sync);host.replaceChildren();controls.clear();shell?.classList.remove('has-history-shelf');doc.documentElement.classList.remove('paper-history-on');}};
  }
  return {KEY,COMPARE_KEY,MAX_RECENT,createModel,create,label};
});
