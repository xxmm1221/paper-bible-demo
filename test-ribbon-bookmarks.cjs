const assert=require('node:assert/strict');
const R=require('./ribbon-bookmarks.js');
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
function storage(initial={}){const values=new Map(Object.entries(initial)),writes=[];return {values,writes,getItem:k=>values.get(k)||null,setItem:(k,v)=>{writes.push(['set',k]);values.set(k,v);},removeItem:k=>{writes.push(['remove',k]);values.delete(k);}};}
const here={spread:1174,page:1175,bookName:'歌罗西书',ref:'1:1',pose:{zoom:2.4,cx:710,cy:230,focus:'right'}};
test('two ribbons start empty and do not write or automatically mark a page',()=>{
  const s=storage(),m=R.createModel({storage:s,pageCount:1254});
  assert.deepEqual(m.getSlots(),[null,null]);assert.equal(s.writes.length,0);
});
test('each explicit placement is independently persisted with page and reading pose',()=>{
  const s=storage(),m=R.createModel({storage:s,pageCount:1254});
  assert.equal(m.place(0,here).persisted,true);
  assert.equal(s.values.size,1);assert.ok(s.values.has(R.KEYS[0]));assert.equal(m.get(1),null);
  m.place(1,{spread:920,bookName:'哈巴谷书',ref:'1:1'});
  assert.equal(m.get(0).page,1175);assert.equal(m.get(1).spread,920);
  const loaded=R.createModel({storage:s,pageCount:1254});
  assert.deepEqual(loaded.getSlots(),m.getSlots());assert.deepEqual(loaded.get(0).pose,here.pose);
  const detached=loaded.get(0);detached.pose.zoom=999;assert.equal(loaded.get(0).pose.zoom,2.4);
});
test('moving or removing one ribbon leaves the other untouched',()=>{
  const s=storage(),m=R.createModel({storage:s,pageCount:1254});m.place(0,here);m.place(1,{spread:920});
  const second=s.values.get(R.KEYS[1]);m.place(0,{spread:100});assert.equal(m.get(0).spread,100);assert.equal(s.values.get(R.KEYS[1]),second);
  m.clear(0);assert.equal(m.get(0),null);assert.equal(m.get(1).spread,920);assert.equal(s.values.get(R.KEYS[1]),second);
});
test('malformed, obsolete, out-of-range and noninteger storage records are ignored independently',()=>{
  for(const bad of ['{','null','"bad"',JSON.stringify({version:9,page:2}),JSON.stringify({version:1,page:-1}),JSON.stringify({version:1,page:1254}),JSON.stringify({version:1,page:3.5})]){
    const s=storage({[R.KEYS[0]]:bad,[R.KEYS[1]]:JSON.stringify({version:1,page:1175,bookName:'歌罗西书'})});
    const m=R.createModel({storage:s,pageCount:1254});assert.equal(m.get(0),null);assert.equal(m.get(1).page,1175);assert.equal(s.writes.length,0);
  }
});
test('invalid placement is non-destructive and unsafe poses are discarded',()=>{
  const m=R.createModel({pageCount:1254});m.place(0,here);
  for(const spread of [-1,1254,NaN,Infinity,'3',3.1]){assert.equal(m.place(0,{spread}).ok,false);assert.equal(m.get(0).page,1175);}
  m.place(1,{spread:920,pose:{zoom:Infinity,cx:0,cy:0}});assert.equal(m.get(1).pose,undefined);
  assert.throws(()=>m.place(2,here),RangeError);
  assert.equal(R.createModel({pageCount:Infinity}).place(0,here).ok,false);
});
test('unavailable or throwing local storage degrades to in-memory bookmarks',()=>{
  const denied={getItem(){throw Error('denied');},setItem(){throw Error('quota');},removeItem(){throw Error('denied');}};
  for(const s of [undefined,denied]){
    const m=R.createModel({storage:s,pageCount:1254});assert.equal(m.place(0,here).persisted,false);assert.equal(m.get(0).page,1175);
    assert.equal(m.clear(0).persisted,false);assert.equal(m.get(0),null);
  }
});

// Small DOM adapter tests the real UI controller without pretending to test
// browser paint or real mobile input. The root's browser QA owns those checks.
class Element{
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.style={setProperty:(k,v)=>{this.style[k]=v;}};this.hidden=false;this.className='';this.classList={add:c=>{this.className+=' '+c;},remove:c=>{this.className=this.className.split(' ').filter(x=>x!==c).join(' ');}};}
  appendChild(el){el.parentElement=this;this.children.push(el);return el;}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k]??null;}
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
  removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(x=>x!==fn);}
  contains(el){return el===this||this.children.some(c=>c.contains(el));}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
  focus(){this.ownerDocument.activeElement=this;}
  fire(type,extra={}){const event={target:this,stopped:false,prevented:false,stopPropagation(){this.stopped=true;},preventDefault(){this.prevented=true;},...extra};for(const fn of this.listeners[type]||[])fn(event);return event;}
}
function fixture(){
  const doc=new Element('document',null);doc.ownerDocument=doc;doc.createElement=t=>new Element(t,doc);doc.createElementNS=(_,t)=>new Element(t,doc);
  const stage=doc.appendChild(doc.createElement('div')),host=stage.appendChild(doc.createElement('div')),s=storage(),calls=[];
  let now={...here};
  const api=R.create({host,panelHost:stage,storage:s,pageCount:1254,getCurrent:()=>now,onNavigate:(...args)=>calls.push(args)});
  const all=()=>{const out=[];function walk(n){out.push(n);n.children.forEach(walk);}walk(stage);return out;};
  const find=c=>all().find(n=>n.className.split(' ').includes(c));
  return {doc,stage,host,s,calls,api,find,setCurrent:v=>{now=v;}};
}
test('real ribbon controller opens an empty slot and places only on explicit button click',()=>{
  const f=fixture();assert.equal(f.find('pr-panel').hidden,true);assert.equal(f.s.writes.length,0);
  f.api.open(0);assert.equal(f.find('pr-panel').hidden,false);assert.equal(f.find('pr-go').hidden,true);assert.equal(f.s.writes.length,0);
  f.find('pr-place').fire('click');assert.equal(f.api.getSlots()[0].page,1175);assert.equal(f.api.getSlots()[1],null);assert.equal(f.find('pr-go').hidden,false);
  f.setCurrent({spread:920,bookName:'哈巴谷书'});f.api.update();assert.equal(f.api.getSlots()[0].page,1175,'turning pages must not move a ribbon');
  f.find('pr-go').fire('click');assert.deepEqual(f.calls,[[1175,here.pose]]);assert.equal(f.find('pr-panel').hidden,true);
});
test('two UI slots remain independent and explicit replacement/clear affect only selected ribbon',()=>{
  const f=fixture();f.api.open(0);f.find('pr-place').fire('click');f.setCurrent({spread:920,bookName:'哈巴谷书'});
  f.find('pr-slot-1').fire('click');f.find('pr-place').fire('click');assert.deepEqual(f.api.getSlots().map(s=>s.spread),[1174,920]);
  f.setCurrent({spread:0,bookName:'创世记'});f.api.update();assert.deepEqual(f.api.getSlots().map(s=>s.spread),[1174,920]);
  f.find('pr-place').fire('click');assert.deepEqual(f.api.getSlots().map(s=>s.spread),[1174,0]);
  f.find('pr-remove').fire('click');assert.equal(f.api.getSlots()[1],null);assert.equal(f.api.getSlots()[0].spread,1174);
});
test('directory closure hides controls continuously without losing either bookmark',()=>{
  const f=fixture();f.api.open(0);f.find('pr-place').fire('click');const before=f.api.getSlots();
  f.api.setScene(false,.5);assert.equal(f.find('pr-panel').hidden,true);assert.equal(f.host.inert,true);assert.equal(f.host.style['--pr-close'],'0.5000');
  f.api.open(1);assert.equal(f.find('pr-panel').hidden,true);assert.deepEqual(f.api.getSlots(),before);
  f.api.setScene(true,0);assert.equal(f.host.inert,false);f.api.open(0);assert.equal(f.find('pr-panel').hidden,false);assert.deepEqual(f.api.getSlots(),before);
});
test('silk tips keep independent 44 screen-pixel touch areas across reader scales',()=>{
  const f=fixture();
  for(const scale of [.18,.4,1,2,3.2]){
    f.api.update({scale});const tips=f.host.children.filter(n=>n.className==='pr-tip');
    assert.ok(parseFloat(tips[0].style.width)*scale>=44-1e-9);
    assert.ok(parseFloat(tips[1].style.left)>=parseFloat(tips[0].style.left)+parseFloat(tips[0].style.width),'targets must not overlap');
  }
});
test('ribbon pointer and keyboard input stays local; Escape and outside click dismiss; destroy cleans listeners',()=>{
  const f=fixture();f.api.open(0);
  assert.equal(f.host.fire('pointerdown').stopped,true);assert.equal(f.find('pr-panel').fire('keydown',{key:'ArrowRight'}).stopped,true);
  const escape=f.find('pr-panel').fire('keydown',{key:'Escape'});assert.equal(escape.prevented,true);assert.equal(f.find('pr-panel').hidden,true);
  f.api.open(1);f.doc.fire('pointerdown',{target:f.stage});assert.equal(f.find('pr-panel').hidden,true);
  assert.equal(f.doc.listeners.pointerdown.length,1);f.api.destroy();assert.equal(f.doc.listeners.pointerdown.length,0);assert.equal(f.find('pr-panel'),undefined);
});
console.log(JSON.stringify({ribbonBookmarkScenarios:checks,slots:2,automaticPlacement:false}));
