const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const Edge=require('./paper-edges.js'),Material=require('./book-material.js');
let checks=0;
const check=(v,label)=>{assert.ok(v,label);checks++;};
const near=(a,b,label)=>check(Math.abs(a-b)<1e-9,`${label}: ${a} vs ${b}`);
for(const side of ['left','right']){
  let previous=Edge.geometry(side,0);
  for(let n=0;n<=360;n++){
    const depth=n/10,g=Edge.geometry(side,depth),svg=Edge.render(side,depth);
    near(g.sideExtent,depth*.55,'lateral paper mass');near(g.bottomExtent,depth*.85,'foot paper mass');
    check(g.sideExtent>=previous.sideExtent&&g.bottomExtent>=previous.bottomExtent,'monotonic projection');
    check(!/NaN|Infinity|undefined/.test(svg),'finite vector paths');
    check(!/repeating-|<text|textLength|<image|foreignObject/.test(svg),'no striped bitmap, fake compressed labels or external content');
    check(svg===Edge.render(side,depth),'deterministic material');
    check(!svg.includes('<rect'),'rounded side and bottom are not a translated rectangular slab');
    const count=(svg.match(/class="pe-leaf-line"/g)||[]).length;
    check(count===Math.max(0,g.lineCount-1),'strata follow paper depth');
    if(!depth)check(!svg.includes('class="pe-paper-mass"')&&!svg.includes('class="pe-leaf-line"'),'zero sheets have no paper');
    check(svg.includes('class="pe-leather-edge"'),'leather is independent of paper');
    previous=g;
  }
}
for(const spread of [0,626,920,1232,1252]){
  const mass=Material.compute(spread,1254),left=Edge.geometry('left',mass.leftDepth),right=Edge.geometry('right',mass.rightDepth);
  near(left.depth+right.depth,36,'combined paper conservation');
  near(left.sideExtent+right.sideExtent,36*.55,'combined side projection');
  near(left.bottomExtent+right.bottomExtent,36*.85,'combined foot projection');
}
const jude=Material.compute(1232,1254);
check(Edge.geometry('right',jude.rightDepth).sideExtent<.35,'Jude has a very thin right edge');
check(Edge.geometry('left',0).sideExtent===0,'no left paper at Genesis');
check(Edge.geometry('right',.001).sideExtent<.001,'no minimum artificial paper depth');
for(const n of [NaN,Infinity,-5,'bad'])check(Edge.geometry('left',n).depth===0,'invalid depth safely absent');
assert.throws(()=>Edge.geometry('front',1),/left or right/);
const host={classList:{add(){}},dataset:{},_html:'',writes:0,set innerHTML(v){this._html=v;this.writes++;},get innerHTML(){return this._html;}};
const edge=Edge.create(host,'left');edge.update(18);const markup=host.innerHTML;
edge.update(18);check(host.writes===1,'unchanged depth reuses material');
edge.update(19);check(host.writes===2&&host.innerHTML!==markup,'changed depth redraws material');
check(host.dataset.paperDepth==='19.000000','exact material quantity exposed separately from drawing');
edge.destroy();check(host.innerHTML==='','owned host cleans up');
const browser={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/paper-edges.js','utf8'),browser);
check(browser.window.PaperEdges.render('left',18)===Edge.render('left',18),'browser and Node material agree');
console.log(JSON.stringify({naturalPaperEdgeChecks:checks,geometry:'continuous rounded side and bowed foot',maxPaperDepth:36,bookThicknessConserved:true}));
