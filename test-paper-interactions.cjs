/* Runs the actual input controller with deterministic time and a renderer spy.
 * Does not substitute for touch-device/browser rendering tests. */
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const Physics=require('./paper-physics.js'),Gestures=require('./gesture-core.js');
let checks=0;
function fixture(startSpread=2){
  let now=0,nextId=1;const timers=new Map(),elements=new Map(),events={};let observer;
  class Element{
    constructor(id){this.id=id;this.style={};this.dataset={};this.innerHTML='';this.textContent='';this.handlers={};this.clientWidth=id==='stage'?980:65;this.clientHeight=id==='stage'?600:46;this.hidden=false;this.disabled=false;this.classes=new Set();this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:(...xs)=>xs.forEach(x=>this.classes.delete(x)),toggle:(x,b)=>{if(b===undefined)b=!this.classes.has(x);b?this.classes.add(x):this.classes.delete(x);}};}
    addEventListener(name,fn){this.handlers[name]=fn;}
    setAttribute(name,value){this[name]=value;}
    getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
    setPointerCapture(){}
    showModal(){}close(){}
  }
  const el=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const doc={getElementById:el,querySelector:s=>el(s),querySelectorAll:()=>[],addEventListener:(name,fn)=>events['document:'+name]=fn,hidden:false};
  const rendered=[];
  class Renderer{
    constructor(){this.last=null;}
    prepare(front,back,direction,count){rendered.push({front,back,direction,count});}
    draw(o){this.last=o;el('book').dataset.curlProgress=String(o.progress);}
    hide(){delete el('book').dataset.curlProgress;}
  }
  const context={console,document:doc,PaperPhysics:Physics,PaperGestures:Gestures,PaperSheetRenderer:Renderer,
    performance:{now:()=>now},navigator:{},matchMedia:()=>({matches:false}),
    localStorage:{getItem:()=>JSON.stringify({spread:startSpread}),setItem:()=>{}},
    setTimeout:(fn,ms=0)=>{const id=nextId++;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:fn=>{const id=nextId++;timers.set(id,{fn:()=>fn(now),at:now+16});return id;},cancelAnimationFrame:id=>timers.delete(id),
    ResizeObserver:class{constructor(fn){observer=fn;}observe(){}},addEventListener:(name,fn)=>events[name]=fn};
  context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('bible-data.js','utf8'),context);vm.runInContext(fs.readFileSync('app.js','utf8'),context);
  function advance(ms){const end=now+ms;let loops=0;while(true){const upcoming=[...timers].filter(([id,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!upcoming)break;if(++loops>10000)throw Error('timer loop');now=upcoming[1].at;timers.delete(upcoming[0]);upcoming[1].fn();}now=end;}
  function emit(type,x,y,id=1){el('stage').handlers[type]({clientX:x,clientY:y,pointerId:id,timeStamp:now,button:0,preventDefault(){}});}
  function at(side='right',radius=350){const scale=Number(el('stage').dataset.scale);return {x:Number(el('stage').dataset.x)+(480+(side==='right'?radius:-radius))*scale,y:Number(el('stage').dataset.y)+310*scale,scale,radius};}
  function held(side='right',radius=350){const p=at(side,radius);emit('pointerdown',p.x,p.y);advance(380);return p;}
  function drag(p,progress,side='right',id=1){emit('pointermove',p.x-(side==='right'?1:-1)*progress*2*p.radius*p.scale,p.y,id);}
  function up(p,progress,side='right',cancel=false){emit(cancel?'pointercancel':'pointerup',p.x-(side==='right'?1:-1)*progress*2*p.radius*p.scale,p.y);advance(1500);}
  return {el,advance,emit,at,held,drag,up,rendered,events,resize:()=>observer(),context};
}
function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('long press exposes true next recto while spread is unchanged; cancel restores original',()=>{
  const f=fixture(),original=f.el('right-paper').innerHTML,p=f.held();assert.equal(f.el('stage').dataset.foldState,'held');
  assert.deepEqual(f.rendered[0],{front:3,back:4,direction:1,count:1});assert.ok(f.el('right-paper').innerHTML.includes('第 5 页'));
  f.advance(180);f.drag(p,.34);f.advance(300);assert.equal(f.el('stage').dataset.spread,'2');f.up(p,.34);
  assert.equal(f.el('stage').dataset.spread,'2');assert.equal(f.el('stage').dataset.foldState,'returned');assert.equal(f.el('right-paper').innerHTML,original);
});
test('release after crossing midpoint commits exactly one sheet',()=>{const f=fixture(),p=f.held();f.advance(300);f.drag(p,.65);f.advance(200);f.up(p,.65);assert.equal(f.el('stage').dataset.spread,'4');assert.equal(f.el('stage').dataset.foldState,'committed');});
test('moving back reverses the fold and cancels even after midpoint',()=>{const f=fixture(),p=f.held();f.advance(300);f.drag(p,.8);f.advance(240);f.drag(p,.7);f.advance(45);f.drag(p,.6);f.up(p,.6);assert.equal(f.el('stage').dataset.spread,'2');});
test('left page mirrors front/back texture selection and commit',()=>{const f=fixture(20),p=f.held('left');assert.deepEqual(f.rendered[0],{front:20,back:19,direction:-1,count:1});f.advance(300);f.drag(p,.7,'left');f.advance(200);f.up(p,.7,'left');assert.equal(f.el('stage').dataset.spread,'18');});
test('hold without movement returns without accidental double tap or turn',()=>{const f=fixture(),p=f.held();f.advance(700);f.up(p,0);assert.equal(f.el('stage').dataset.spread,'2');assert.equal(f.el('stage').dataset.foldState,'returned');});
test('moving before hold threshold stays panning',()=>{const f=fixture(),p=f.at();f.emit('pointerdown',p.x,p.y);f.advance(120);f.emit('pointermove',p.x-20,p.y-15);f.advance(500);assert.equal(f.rendered.length,0);f.emit('pointerup',p.x-80,p.y-30);f.advance(1000);assert.equal(f.el('stage').dataset.spread,'2');});
test('pointer cancel rolls back a nearly completed sheet',()=>{const f=fixture(),p=f.held();f.advance(300);f.drag(p,.92);f.up(p,.92,'right',true);assert.equal(f.el('stage').dataset.spread,'2');});
test('second finger immediately releases held paper before pinch',()=>{const f=fixture(),p=f.held();f.drag(p,.25);f.emit('pointerdown',p.x+50,p.y+60,2);assert.equal(f.el('stage').dataset.foldState,'returned');f.emit('pointercancel',p.x,p.y,1);f.emit('pointercancel',p.x+50,p.y+60,2);f.advance(700);assert.equal(f.el('stage').dataset.spread,'2');});
test('window blur rolls back without committing',()=>{const f=fixture(),p=f.held();f.drag(p,.8);f.events.blur();f.advance(1000);assert.equal(f.el('stage').dataset.spread,'2');assert.equal(f.el('stage').dataset.foldState,'returned');});
test('resize during curl rolls back safely',()=>{const f=fixture(),p=f.held();f.drag(p,.6);f.el('stage').clientWidth=390;f.resize();f.advance(1000);assert.equal(f.el('stage').dataset.spread,'2');assert.equal(f.el('stage').dataset.foldState,'returned');});
test('automatic next uses the same curved mesh and completes',()=>{const f=fixture();f.el('next').onclick();assert.equal(f.el('stage').dataset.spread,'2');assert.equal(f.el('stage').dataset.foldState,'settling-forward');f.advance(600);assert.equal(f.el('stage').dataset.spread,'4');});
test('rapid next buttons are queued rather than losing pages',()=>{const f=fixture();f.el('next').onclick();f.el('next').onclick();f.el('next').onclick();f.advance(1800);assert.equal(f.el('stage').dataset.spread,'8');});
test('first and final pages cannot turn beyond the book',()=>{for(const [start,side] of [[0,'left'],[1252,'right']]){const f=fixture(start),p=f.held(side);assert.equal(f.rendered.length,0);f.up(p,.8,side);assert.equal(f.el('stage').dataset.spread,String(start));}});
test('near-spine and extreme-height contact does not create NaN',()=>{const f=fixture(),p=f.held('right',14);f.advance(300);f.drag(p,.65);f.advance(200);f.up(p,.65);assert.equal(f.el('stage').dataset.spread,'4');});
test('quick single finger remains a quick turn, not a long-press mode',()=>{const f=fixture(),p=f.at();f.emit('pointerdown',p.x,p.y);f.advance(80);f.emit('pointermove',p.x-70,p.y);f.advance(35);f.emit('pointerup',p.x-100,p.y);f.advance(650);assert.equal(f.el('stage').dataset.spread,'4');});
test('wrong-direction fast swipe still does not turn',()=>{const f=fixture(),p=f.at('left');f.emit('pointerdown',p.x,p.y);f.advance(80);f.emit('pointermove',p.x-70,p.y);f.advance(35);f.emit('pointerup',p.x-100,p.y);f.advance(650);assert.equal(f.el('stage').dataset.spread,'2');});
test('two-finger bursts still turn 5, 10, 20 sheets with curved transitions',()=>{
  const f=fixture();
  for(let k=0;k<3;k++){
    const p=f.at();f.emit('pointerdown',p.x,p.y,1);f.advance(2);f.emit('pointerdown',p.x,p.y+50,2);
    for(let i=1;i<=12;i++){f.advance(10);f.emit('pointermove',p.x-i*10,p.y,1);f.emit('pointermove',p.x-i*10,p.y+50,2);}
    f.emit('pointerup',p.x-120,p.y,1);f.emit('pointerup',p.x-120,p.y+50,2);f.advance(420);
  }
  assert.deepEqual(f.rendered.map(x=>x.count),[5,10,20]);assert.equal(f.el('stage').dataset.spread,'72');
});
test('changing finger spacing cancels any hold timer and only zooms',()=>{
  const f=fixture(),p=f.at();f.emit('pointerdown',p.x,p.y,1);f.advance(100);f.emit('pointerdown',p.x,p.y+60,2);
  f.advance(100);f.emit('pointermove',p.x-30,p.y-30,1);f.emit('pointermove',p.x+30,p.y+100,2);f.advance(500);
  f.emit('pointerup',p.x-30,p.y-30,1);f.emit('pointerup',p.x+30,p.y+100,2);f.advance(600);
  assert.equal(f.rendered.length,0);assert.equal(f.el('stage').dataset.spread,'2');assert.ok(Number(f.el('stage').dataset.scale)>p.scale);
});
test('opening the book edge cancels a half-turned paper and keeps its page',()=>{
  const f=fixture(),p=f.held();f.drag(p,.55);f.el('view-edge').onclick();f.advance(1000);
  assert.equal(f.el('stage').dataset.spread,'2');assert.equal(f.el('stage').style.visibility,'hidden');assert.equal(f.el('stage').dataset.foldState,'returned');
});
console.log(JSON.stringify({inputControllerScenarios:checks}));
