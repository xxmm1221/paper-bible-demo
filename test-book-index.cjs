/* Fixed-depth anchor / true fore-edge projection / persistent-label tests.
 * Browser compositing and touch-device behaviour are separate visual checks. */
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Index=require('./book-index.js'),Material=require('./book-material.js'),K=require('./book-kinematics.js');
const context={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/bible-data.js','utf8'),context);
const books=context.window.BIBLE_DATA.books,pageCount=context.window.BIBLE_DATA.pages.length;
let checks=0;const test=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const near=(a,b,msg,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${msg}: ${a} != ${b}`);
const parse=s=>s?.startsWith('matrix3d(')?s.slice(9,-1).split(',').map(Number):Index.translation(0,0,0);
function point(m,x,y,z=0){return{x:m[0]*x+m[4]*y+m[8]*z+m[12],y:m[1]*x+m[5]*y+m[9]*z+m[13],z:m[2]*x+m[6]*y+m[10]*z+m[14]};}
function fixture(){
 const nodes=[],doc={createElement(tag){const n=new Element(tag);nodes.push(n);return n;}};
 class Element{
  constructor(tag){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attrs={};this.dataset={};this.style={setProperty(k,v){this[k]=v;}};this.handlers={};this.listenerOptions={};this.scrollTop=0;this.classes=new Set();this.classList={add:n=>this.classes.add(n),remove:n=>this.classes.delete(n),toggle:(n,v)=>v?this.classes.add(n):this.classes.delete(n)};}
  appendChild(n){if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(k=>k!==n);this.children.push(n);n.parentElement=this;n.parent=this;return n;}
  setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,fn,opts){this.handlers[k]=fn;this.listenerOptions[k]=opts;}removeEventListener(k,fn){if(this.handlers[k]===fn)delete this.handlers[k];}
  getBoundingClientRect(){let x=parseFloat(this.style.left)||0,y=parseFloat(this.style.top)||0,m=parse(this.style.transform),corners=[[x,y],[x+(parseFloat(this.style.width)||0),y],[x,y+(parseFloat(this.style.height)||0)],[x+(parseFloat(this.style.width)||0),y+(parseFloat(this.style.height)||0)]].map(p=>point(m,...p));
   for(let p=this.parentElement;p;p=p.parentElement){const tr=p.style.transform||'',t=tr.startsWith('translate3d(')?tr.slice(12,-1).split(',').map(v=>parseFloat(v)):null;corners=corners.map(c=>{c.y-=p.scrollTop||0;if(t){c.x+=t[0];c.y+=t[1];c.z+=t[2];}return c;});}
   const xs=corners.map(c=>27+c.x*.68),ys=corners.map(c=>83+c.y*.68),left=Math.min(...xs),top=Math.min(...ys),right=Math.max(...xs),bottom=Math.max(...ys);return{left,top,right,bottom,width:right-left,height:bottom-top};}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);}
 }
 const host=doc.createElement('div'),selections=[],views=[],pans=[];
 const index=Index.create({host,books,pageCount,onSelect:i=>selections.push(i),onViewChange:v=>views.push(v),onPan:p=>pans.push(p)});
 const root=nodes.find(n=>n.className==='pbi-root'),buttons=nodes.filter(n=>n.tagName==='button'),scroll=nodes.find(n=>n.className==='pbi-scroll');
 function clickAt(target,x,y,detail=1){const e={target,clientX:x,clientY:y,detail,defaultPrevented:false,stopped:false,immediateStopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;this.immediateStopped=true;}};assert.equal(root.listenerOptions.click,true);root.handlers.click(e);if(!e.stopped)target.handlers.click?.(e);return e;}
 return{host,nodes,root,index,buttons,scroll,selections,views,pans,clickAt,sheet:nodes.find(n=>n.className==='pbi-sheet')};
}
function material(spread){return Material.compute(spread,pageCount,books);}
function frame(m,close){return{leftMatrix:K.foreedgeMatrix('left',m,close),rightMatrix:K.foreedgeMatrix('right',m,close),splitDepth:m.leftDepth,totalDepth:m.totalDepth};}
test('66 books occupy 22 groups and their exact absolute physical sheet depths',()=>{
 const model=Index.geometry(books,pageCount);assert.equal(model.groups.length,22);assert.equal(Index.WIDTH,36);assert.equal(model.totalSheets,627);
 assert.deepEqual(model.groups.flatMap(g=>g.indices),Array.from({length:66},(_,i)=>i));
 model.slots.forEach((s,i)=>{const expected=Math.floor(books[i].first/2)/627*36;near(s.anchorDepth,expected,books[i].code+' depth');assert.ok(s.physical.x>=0&&s.physical.x+s.physical.width<=36);assert.ok(s.physical.y>=0&&s.physical.y+s.physical.height<=704);});
});
test('the physical index contains no independent replacement book slab or photograph',()=>{
 const f=fixture();assert.ok(!f.nodes.some(n=>/pbi-leather|pbi-paper-block|pbi-lower-edge/.test(n.className||'')));assert.equal(f.buttons.length,66);assert.equal(f.nodes.filter(n=>n.className==='pbi-fragment').length,132);
});
test('digital targets interpolate individually without stretching a whole physical index',()=>{
 const model=Index.geometry(books,pageCount);for(const slot of model.slots){assert.equal(slot.digital.height,64);assert.equal(slot.digital.width,212);assert.deepEqual(Index.layoutAt(slot,0),slot.physical);assert.deepEqual(Index.layoutAt(slot,1),slot.digital);for(let d=0;d<=1;d+=.01)Object.values(Index.layoutAt(slot,d)).forEach(v=>assert.ok(Number.isFinite(v)));}
});
test('all original buttons and two glyph fragments survive digital expansion and retraction',()=>{
 const f=fixture(),initial=f.buttons.slice(),count=f.nodes.length;
 for(const d of [0,.25,.5,.75,1,.75,.5,.25,0])f.index.setDigital(d);
 assert.equal(f.nodes.length,count);assert.equal(f.root.children.filter(n=>n.tagName==='button').length,66);assert.equal(f.sheet.children.filter(n=>n.tagName==='button').length,0);
 f.buttons.forEach((b,i)=>{assert.equal(b,initial[i]);b.handlers.click({stopPropagation(){}});});assert.deepEqual(f.selections,Array.from({length:66},(_,i)=>i));
});
test('deep digital scroll retracts continuously and preserves exact original node identity',()=>{
 const f=fixture();f.index.setDigital(1);f.scroll.scrollTop=820;const before=f.buttons[40].getBoundingClientRect();
 assert.equal(f.index.setDigital(.999).scrollTop,819.18);const after=f.buttons[40].getBoundingClientRect();assert.ok(Math.abs(before.top-after.top)<3,'reparent caused a visible jump');
 assert.equal(f.index.setDigital(.5).scrollTop,410);assert.equal(f.index.setDigital(.8).scrollTop,656);assert.equal(f.index.setDigital(1).scrollTop,820);f.index.setDigital(.3);assert.equal(f.scroll.scrollTop,246);f.index.setDigital(0);assert.equal(f.scroll.scrollTop,0);f.index.setDigital(1);assert.equal(f.scroll.scrollTop,0);
});
test('focus reports the true selected sheet depth and a stable closed world position',()=>{
 const f=fixture(),a=f.index.focusBook(65);f.index.setDigital(1);const b=f.index.focusBook(65);assert.deepEqual(a,b);near(a.depth,Math.floor(books[65].first/2)/627*36,'exact focus depth');near(a.x,480+a.depth-18,'closed world x');assert.equal(a.width,18);assert.equal(a.height,8);assert.equal(f.buttons[65].attrs['aria-current'],'true');f.index.clearFocus();assert.equal(f.buttons[65].attrs['aria-current'],undefined);assert.equal(f.index.focusBook(-1),null);
});
test('reading ownership uses both physical halves without opacity replacement',()=>{
 const f=fixture(),m=material(1232);f.index.setReadingMaterial(m,0);f.index.setPhysicalFrame(frame(m,0));
 f.buttons.forEach((b,i)=>{assert.equal(b.style.opacity,'1');assert.equal(b.dataset.paperSide,i<64?'left':'right');near(Number(b.dataset.anchorDepth),Math.floor(books[i].first/2)/627*36,'DOM sheet anchor',1e-7);});
 assert.equal(f.root.dataset.rightSheets,'11');assert.equal(f.root.dataset.leftSheets,'616');
});
test('closed split changes cannot move any label or replace its two continuous ink pieces',()=>{
 const f=fixture();let reference;
 for(const spread of [0,2,626,916,1232,1252,0]){const m=material(spread);f.index.setReadingMaterial(m,1);f.index.setPhysicalFrame(frame(m,1));
  const positions=f.buttons.map(b=>{const m=parse(b.style.transform);return point(m,0,0);});
  if(reference)positions.forEach((p,i)=>{near(p.x,reference[i].x,'closed x');near(p.y,reference[i].y,'closed y');near(p.z,reference[i].z,'closed z');});else reference=positions;
  f.buttons.forEach(b=>{const fragments=b.children.filter(n=>n.className==='pbi-fragment');assert.equal(fragments.length,2);fragments.forEach(n=>{const m=parse(n.style.transform);near(m[12],0,'piece x');near(m[13],0,'piece y');near(m[14],0,'piece z');});});
 }
});
test('continuous intermediate matrices are finite and invertible, with no physical fade',()=>{
 const f=fixture(),m=material(916);f.index.setReadingMaterial(m,0);for(let n=0;n<=100;n++){f.index.setPhysicalFrame(frame(m,n/100));for(const b of f.buttons){assert.equal(b.style.opacity,'1');parse(b.style.transform).forEach(v=>assert.ok(Number.isFinite(v)));for(const fragment of b.children)parse(fragment.style.transform).forEach(v=>assert.ok(Number.isFinite(v)));}}
});
test('projected capture chooses exact physical/digital labels rather than wrong native neighbours',()=>{
 const f=fixture(),m=material(916);f.index.setReadingMaterial(m,1);f.index.setPhysicalFrame(frame(m,1));let r=f.buttons[42].getBoundingClientRect();let e=f.clickAt(f.sheet,r.left+r.width/2,r.top+r.height/2);assert.deepEqual(f.selections,[42]);assert.ok(e.immediateStopped);
 f.index.setDigital(1);f.scroll.scrollTop=1735;r=f.buttons[65].getBoundingClientRect();e=f.clickAt(f.buttons[64],r.left+r.width/2,r.top+r.height/2);assert.deepEqual(f.selections,[42,65]);assert.ok(e.immediateStopped);f.clickAt(f.buttons[64],r.left,r.top,0);assert.deepEqual(f.selections,[42,65,64]);f.clickAt(f.sheet,-100,-100);assert.equal(f.selections.length,3);
});
test('physical wheel/drag pans the real edge while moved pointers cannot accidentally select a book',()=>{
 const f=fixture(),e=(type,y)=>({pointerId:7,button:0,clientY:y,stopPropagation(){},preventDefault(){}});
 f.root.handlers.wheel({deltaY:60,stopPropagation(){},preventDefault(){}});assert.deepEqual(f.pans,[60]);f.root.handlers.pointerdown(e('down',100));f.root.handlers.pointermove(e('move',120));f.root.handlers.pointerup(e('up',120));assert.deepEqual(f.pans,[60,-20]);let r=f.buttons[3].getBoundingClientRect();const click=f.clickAt(f.buttons[3],r.left+r.width/2,r.top+r.height/2);assert.ok(click.immediateStopped);assert.equal(f.selections.length,0);
 f.index.setDigital(1);f.root.handlers.wheel({deltaY:80,stopPropagation(){},preventDefault(){throw Error('digital scroll must stay native');}});assert.equal(f.pans.length,2);
});
test('22 thumb recesses retain fixed absolute paper-depth and three inset label rows',()=>{
 const f=fixture(),model=Index.geometry(books,pageCount),notches=f.index.getNotches();assert.equal(notches.length,22);
 model.groups.forEach((group,g)=>{const cut=notches[g];assert.equal(cut.y,34+g*30);assert.equal(cut.radius,13);assert.ok(cut.span>=4.5);
  group.indices.forEach(i=>{const slot=model.slots[i];assert.ok(Math.abs(slot.anchorDepth-cut.depth)<cut.span);assert.ok(Math.abs(slot.physical.y+slot.physical.height/2-cut.y)<=8);});
 });
 notches[0].depth=900;assert.notEqual(f.index.getNotches()[0].depth,900);assert.equal(f.nodes.filter(n=>n.className==='pbi-recess-shadow').length,22);
});
test('curved ink stays at its own recessed material point with unit axes and natural glyph size',()=>{
 const f=fixture(),model=Index.geometry(books,pageCount),m=material(620),state={fanLeft:.35,fanRight:1,notches:f.index.getNotches()};
 for(const close of [0,.18,.5,.85,1]){f.index.setSurfaceFrame({material:m,close,...state});f.buttons.forEach((b,i)=>{
  const slot=model.slots[i],side=slot.anchorDepth<m.leftDepth?'left':'right',matrix=parse(b.style.transform),center=point(matrix,9,4),p=K.foreedgePoint(side,slot.anchorDepth,slot.physical.y+4,m,close,state);
  assert.ok(matrix[0]>0,'ink must never mirror backwards on a curved notch lip');near(Math.hypot(matrix[0],matrix[1],matrix[2]),1,'unit width');near(Math.hypot(matrix[4],matrix[5],matrix[6]),1,'unit height');
  const expectedLift=.18+2.1*(side==='left'?state.fanLeft:state.fanRight)*(1-close)*(1-close);near(Math.hypot(center.x-p.x,center.y-p.y,center.z-p.z),expectedLift,'ink surface lift',1e-5);
  assert.equal(b.dataset.paperSide,side);assert.equal(b.style.opacity,'1');b.children.forEach(part=>assert.equal(part.children[0].style.fontSize,'5.9px'));
 });}
});
test('closed recessed index cannot jump when the selected opening layer changes',()=>{
 const f=fixture();let reference;
 for(const spread of [0,570,1232,398,0]){f.index.setSurfaceFrame({material:material(spread),close:1,fanLeft:1,fanRight:1});const matrices=f.buttons.map(b=>parse(b.style.transform));
  if(reference)matrices.forEach((m,i)=>m.forEach((v,k)=>near(v,reference[i][k],'recessed closed matrix')));else reference=matrices;
 }
});
test('only the fanned side accepts physical clicks while digital retains all 66 books',()=>{
 const f=fixture(),m=material(1232);f.index.setSurfaceFrame({material:m,close:0,fanRight:1});f.index.setInteractionSide('right');
 f.buttons.forEach((b,i)=>{assert.equal(b.disabled,i<64);assert.equal(b.tabIndex,i<64?-1:0);b.handlers.click({detail:0,stopPropagation(){}});});assert.deepEqual(f.selections,[64,65]);
 f.index.setInteractionSide(null);f.buttons[64].handlers.click({detail:0,stopPropagation(){}});assert.deepEqual(f.selections,[64,65]);
 f.index.setDigital(1);assert.ok(f.buttons.every(b=>!b.disabled));f.buttons[0].handlers.click({detail:0,stopPropagation(){}});assert.deepEqual(f.selections,[64,65,0]);
 f.index.setDigital(0);assert.ok(f.buttons.every(b=>b.disabled));f.index.setInteractionSide('left');assert.equal(f.buttons[0].disabled,false);assert.equal(f.buttons[65].disabled,true);
});
test('recessed fan and digital round trips retain all original ink nodes and finite invertible geometry',()=>{
 const f=fixture(),nodes=f.nodes.length,m=material(570),buttons=f.buttons.slice();
 for(let step=0;step<=40;step++){f.index.setSurfaceFrame({material:m,close:Math.sin(step/40*Math.PI),fanLeft:step/40,fanRight:1-step/40});f.index.setDigital(step/40);f.buttons.forEach(b=>{const a=parse(b.style.transform);a.forEach(v=>assert.ok(Number.isFinite(v)));Index.inverse(a);});}
 f.index.setDigital(0);assert.equal(f.nodes.length,nodes);f.buttons.forEach((b,i)=>assert.equal(b,buttons[i]));
});
test('camera-only pan does not recompute unchanged recessed ink geometry',()=>{
 const f=fixture(),m=material(1232);f.index.setSurfaceFrame({material:m,close:0,fanLeft:1,fanRight:0});let paints=0;
 const original=f.root.style.setProperty;f.root.style.setProperty=function(...args){paints++;return original.apply(this,args);};
 for(let i=0;i<30;i++)f.index.setSurfaceFrame({material:{...m},close:0,fanLeft:1,fanRight:0});assert.equal(paints,0);
 f.index.setSurfaceFrame({material:m,close:0,fanLeft:.9,fanRight:0});assert.ok(paints>0);
});
test('closed ink is six persistent natural-glyph strips, with no triangles cutting through its text',()=>{
 const f=fixture(),initialNodes=f.nodes.length,model=Index.geometry(books,pageCount);
 assert.equal(f.nodes.filter(n=>n.className==='pbi-ink-strip').length,66*6);
 for(const spread of [0,570,1232]){
  const m=material(spread),state={fanLeft:0,fanRight:0,notches:f.index.getNotches()},sample=Index.facetSampler(m,1,state);
  f.index.setSurfaceFrame({material:m,close:1});
  for(const slot of model.slots){
   const side=slot.anchorDepth<m.leftDepth?'left':'right',y=slot.physical.y+4;
   for(let j=0;j<Index.INK_STRIPS;j++){
    const start=j*3-9,matrix=Index.inkStripMatrix(sample,side,slot.anchorDepth,y,1,start,3,8);
    near(matrix[0],1,'closed ink keeps natural horizontal glyph spacing');near(matrix[5],1,'closed ink keeps natural vertical glyph spacing');
    for(let x=0;x<=3;x+=.25)for(let yy=0;yy<=8;yy+=.5){const ink=K.transformPoint(matrix,x,yy),paper=sample(side,slot.anchorDepth+start+x,y-4+yy);assert.ok(ink.z>=paper.z+.299999,'solid triangle crosses printed ink');}
   }
  }
 }
 assert.equal(f.nodes.length,initialNodes);assert.ok(f.nodes.filter(n=>n.className==='pbi-ink-strip').every(n=>!n.hidden));
 f.index.setDigital(.2);assert.ok(f.nodes.filter(n=>n.className==='pbi-ink-strip').every(n=>n.hidden));
 f.index.setDigital(0);f.index.setSurfaceFrame({material:material(1232),close:0,fanLeft:1});assert.ok(f.nodes.filter(n=>n.className==='pbi-ink-strip').every(n=>n.hidden));
});
test('destroy removes only the owned index surface and event listeners',()=>{
 const f=fixture();f.index.destroy();assert.equal(f.host.children.length,0);assert.equal(Object.keys(f.root.handlers).length,0);assert.equal(f.index.setDigital(.5).destroyed,true);
});
console.log(JSON.stringify({bookIndexScenarios:checks,books:66,groups:22,physicalDepth:36,persistentFragments:132,closedSplitInvariant:true,recessedGroups:22,sideSpecificInteraction:true}));
