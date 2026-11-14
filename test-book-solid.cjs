const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Solid=require('./book-solid.js'),K=require('./book-kinematics.js'),M=require('./book-material.js');
let checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++;};
const near=(a,b,m,e=1e-8)=>check(Math.abs(a-b)<=e,`${m}: ${a} != ${b}`);
function pointNear(a,b,m){for(const k of ['x','y','z'])near(a[k],b[k],m+' '+k,2e-7);}
function matrix(value){check(/^matrix3d\([-\d.,]+\)$/.test(value),'valid CSS matrix');const m=value.slice(9,-1).split(',').map(Number);check(m.length===16&&m.every(Number.isFinite),'finite 4x4 values');return m;}
function fixture(){
  let created=0;
  const doc={createElement:tag=>{created++;return new Element(tag);}};
  class Element{
    constructor(tag){this.tagName=tag;this.ownerDocument=doc;this.style={};this.dataset={};this.children=[];this.attributes={};this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c)};}
    appendChild(child){child.parentElement=this;this.children.push(child);return child;}
    setAttribute(name,value){this.attributes[name]=value;}
    remove(){const i=this.parentElement?.children.indexOf(this);if(i>=0)this.parentElement.children.splice(i,1);}
    set innerHTML(value){throw Error('solid must not replace a face subtree');}
  }
  const host=new Element('host');return {host,created:()=>created};
}
const f=fixture(),solid=Solid.create(f.host);
check(f.host.attributes['aria-hidden']==='true','decorative solid does not enter accessibility navigation');
const materials=[0,626,920,1174,1232,1252].map(s=>M.compute(s,1254));
const notches=Array.from({length:22},(_,i)=>({depth:.2+i*35.4/21,y:34+i*30,radius:13,span:1.2}));
const state={fanLeft:.7,fanRight:1,notches};
let identities=new Set(),maxNodes=0;
for(const material of materials){
  let builds;
  for(const close of [0,.1,.33,.5,.8,.999,1,.6,.2,0]){
    const frame=solid.update(material,close,state);
    check(frame.close===close,'update returns exact model time');
    if(builds!==undefined)check(solid.getStats().textureBuilds===builds,'changing close does not rebuild depth textures');
    builds=solid.getStats().textureBuilds;
    for(const old of identities)check(f.host.children.includes(old),'existing faces are never replaced during movement');
    identities=new Set(f.host.children);maxNodes=Math.max(maxNodes,f.host.children.length);
    for(const n of f.host.children){
      check(n.style.opacity===undefined,'no per-frame opacity morph');
      check(!/NaN|Infinity/.test(JSON.stringify(n.style)),'no invalid face style');
      if(!n.hidden){
        const m=matrix(n.style.transform),side=n.dataset.side,from=Number(n.dataset.firstDepth),to=Number(n.dataset.lastDepth);
        if(n.dataset.kind==='head'||n.dataset.kind==='foot'){
          const y=n.dataset.kind==='head'?0:704,candidates=[];
          for(const depth of [from,to])for(let j=0;j<=Solid.SEGMENTS;j++)candidates.push(K.pagePoint(side,depth,j/Solid.SEGMENTS,y,material,close,state));
          for(const [x,z]of [[0,0],[100,0],[0,100]]){
            const p=K.transformPoint(m,x,z);
            check(candidates.some(q=>Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z)<2e-5),'head/foot mesh joins actual depth-bowed leaves');
          }
        }
      }
    }
  }
}
check(maxNodes<1000,'narrow-cut stress fixture stays within a bounded pool');
check(solid.getStats().cacheEntries<=160,'texture cache is bounded');
const beforeCount=f.created();solid.update(materials.at(-1),.7,state);
check(f.created()===beforeCount,'another animated frame reuses all face nodes');
const visiblyMilled=f.host.children.filter(n=>!n.hidden&&n.dataset.kind==='foreedge').some(n=>{
  const m=matrix(n.style.transform);return Number(m[14])!==0;
});
check(visiblyMilled,'fore-edge has real recessed geometry rather than a flat decal');
solid.update({totalDepth:0,leftDepth:0,rightDepth:0},1,state);
check(f.host.children.every(n=>n.hidden),'zero total paper leaves no residual slab');
solid.update(materials[1],.5,state);check(f.host.children.some(n=>!n.hidden),'same faces are reusable after zero depth');
solid.update({totalDepth:36,leftDepth:Infinity,rightDepth:NaN},NaN,state);
check(f.host.children.every(n=>!JSON.stringify(n.style).match(/NaN|Infinity/)),'invalid numeric inputs do not leak into geometry');
assert.throws(()=>Solid.create(null),TypeError);assert.throws(()=>Solid.create({ownerDocument:{}}),TypeError);checks+=2;

// Camera-only panning must not rewrite hundreds of static CSS surfaces.
const sameMaterial=materials[2];solid.update(sameMaterial,0,state);
const beforeSkip=solid.getStats();solid.update(sameMaterial,0,state);
check(solid.getStats().skipped===beforeSkip.skipped+1,'identical geometry updates short circuit');
check(solid.getStats().textureBuilds===beforeSkip.textureBuilds,'camera-only update paints no textures');

// Fanning only the right side leaves every left face byte-for-byte intact.
const movingMaterial=materials[2];solid.update(movingMaterial,0,{fanLeft:0,fanRight:.2,notches});
const leftBefore=f.host.children.filter(n=>!n.hidden&&n.dataset.side==='left').map(n=>[n,JSON.stringify(n.style)]);
const sidesBefore=solid.getStats().skippedSides;
solid.update(movingMaterial,0,{fanLeft:0,fanRight:.8,notches});
check(solid.getStats().skippedSides>sidesBefore,'unchanged side skips its entire geometry pass');
for(const [node,style]of leftBefore)check(!node.hidden&&JSON.stringify(node.style)===style,'unchanged side preserves exact DOM identity and styles');
// A zero-volume frame invalidates side visibility caches before reuse.
solid.update({totalDepth:0,leftDepth:0,rightDepth:0},0,state);
solid.update(movingMaterial,0,{fanLeft:0,fanRight:.8,notches});
check(f.host.children.some(n=>!n.hidden),'side skip cannot leave restored paper faces hidden');

// Test the actual 66-book distribution: short NT books cluster many recesses
// close together, unlike a synthetic evenly-spaced depth fixture.
const source={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/bible-data.js','utf8'),source);
const Index=require('./book-index.js'),actual=source.window.BIBLE_DATA;
const actualNotches=Index.geometry(actual.books,actual.pages.length).groups.map(group=>group.notch);
let maxActualFaces=0;
for(const spread of [0,398,570,920,1232])for(const close of [0,.3,.7,1]){
  solid.update(M.compute(spread,actual.pages.length,actual.books),close,{fanLeft:1,fanRight:1,notches:actualNotches});
  maxActualFaces=Math.max(maxActualFaces,solid.getStats().activeFaces);
}
check(maxActualFaces<=800,'real dense NT rounded cuts remain within 800 active faces');

// Compare the optimised renderer with the same tessellator forced through
// the original public point APIs and without per-side skipping.
const DirectK={...K,prepare:(material,close,state)=>({frame:K.frame(material,close,state),
  pagePoint:(side,s,u,y)=>K.pagePoint(side,s,u,y,material,close,state),
  foreedgePoint:(side,s,y)=>K.foreedgePoint(side,s,y,material,close,state),
  edgeInset:(side,s,y)=>K.edgeInset(side,s,y,material,state)})};
const directBrowser={window:{PaperBookKinematics:DirectK}};
const directSource=fs.readFileSync(__dirname+'/book-solid.js','utf8').replace('if(cachedSide&&cachedSide.key===sideKey&&cachedSide.start===start)','if(false&&cachedSide&&cachedSide.key===sideKey&&cachedSide.start===start)');
vm.runInNewContext(directSource,directBrowser);
const directFixture=fixture(),fastFixture=fixture(),direct=directBrowser.window.PaperBookSolid.create(directFixture.host),fast=Solid.create(fastFixture.host);
const visibleSnapshot=host=>host.children.filter(n=>!n.hidden).map(n=>({className:n.className,style:{...n.style},dataset:{...n.dataset}}));
for(const spread of [0,570,1232])for(const close of [0,.3,1])for(const fan of [0,.4,1]){
  const m=M.compute(spread,actual.pages.length,actual.books),shape={fanLeft:0,fanRight:fan,notches:actualNotches};
  direct.update(m,close,shape);fast.update(m,close,shape);
  assert.deepEqual(visibleSnapshot(fastFixture.host),visibleSnapshot(directFixture.host));checks++;
}

// Regression for the exact digital COL -> closed sheet commit -> PSA ->
// reading journey. A skipped side must never retain a closed-book face.
const col=M.compute(1174,actual.pages.length,actual.books),psalm=M.compute(570,actual.pages.length,actual.books);
const journey=[];
for(let i=0;i<=24;i++)journey.push({m:col,close:i/24});
for(let i=0;i<4;i++)journey.push({m:col,close:1});
journey.push({m:psalm,close:1});
for(let i=24;i>=0;i--)journey.push({m:psalm,close:i/24});
for(const step of journey){
  const shape={fanLeft:0,fanRight:0,notches:actualNotches};
  direct.update(step.m,step.close,shape);fast.update(step.m,step.close,shape);
  assert.deepEqual(visibleSnapshot(fastFixture.host),visibleSnapshot(directFixture.host));checks++;
}
for(const node of fastFixture.host.children.filter(n=>!n.hidden)){
  const m=matrix(node.style.transform);
  for(const [x,y]of [[0,0],[100,0],[0,100]])check(K.transformPoint(m,x,y).z<=1e-8,'all final paper-block vertices remain behind the flat printed face');
}

// Texture depth is a physical scalar, not the side's fraction stretched to fit.
const fore=decodeURIComponent(Solid.texture(36,0,36,'foreedge'));
check(/viewBox="0 0 36 704"/.test(fore),'fore-edge artwork is genuinely 36 units wide');
check(!/filter=|opacity="0"|scale\(/.test(fore),'texture does not hide replacement geometry');
const tri1=decodeURIComponent(Solid.texture(36,8,24,'triangle-1')),tri2=decodeURIComponent(Solid.texture(36,8,24,'triangle-2'));
check(tri1.includes('x2="0" y2="100"'),'first triangle depth gradient follows y');
check(tri2.includes('x2="50" y2="50"'),'second triangle depth gradient follows x+y');
check(Solid.strata(36).every(s=>s.depth>0&&s.depth<36&&s.width<.1&&s.alpha<.2),'fine low-contrast strata stay inside the paper');
for(let i=1,s=Solid.strata(36);i<s.length;i++)check(s[i].depth>s[i-1].depth,'paper lines remain ordered');
check(Solid.strata(36).length===626,'paper texture has one boundary for every physical leaf, not coarse seven-sheet groups');
const colMaterial=M.compute(1174,1254),thinLines=Solid.strata(36).filter(line=>line.depth>=colMaterial.leftDepth);
check(thinLines.length>=35&&thinLines.length<=42,'fanned Colossians tail retains fine remaining-leaf detail');
check(thinLines.every(line=>line.width<.012&&line.alpha<.13),'thin tail is not painted as thick dark rails');
check(fore.includes(Solid.PAPER),'SVG paper stock matches the shared flat fallback');
for(const node of fastFixture.host.children.filter(n=>!n.hidden&&n.dataset.kind!=='leather')){
  check(node.style.backgroundColor===Solid.PAPER,'face fallback cannot expose a darker rectangular grid');
  check(/^var\(--bs-texture-\d+\)$/.test(node.style.backgroundImage),'fine texture is referenced once rather than duplicated in each face');
}
check(fast.getStats().textureSlots<=160,'shared texture-variable slots remain bounded');


// Optional raster keeps the same material geometry but owns ONE DOM canvas.
function rasterFixture(){
  let draws=0,canvases=0,doc;
  const context=()=>({fillRect(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},stroke(){},save(){},restore(){},setTransform(){},transform(){},drawImage(){draws++;}});
  class Node{
    constructor(tag){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.style={};this.dataset={};this.hidden=false;this.classList={add(){},remove(){}};if(tag==='canvas')canvases++;}
    appendChild(child){this.children.push(child);child.parent=this;return child;}
    setAttribute(){}
    getContext(){return this.context||(this.context=context());}
    remove(){const i=this.parent?.children.indexOf(this);if(i>=0)this.parent.children.splice(i,1);}
  }
  doc={defaultView:{devicePixelRatio:1},createElement:tag=>new Node(tag)};
  return {host:new Node('host'),draws:()=>draws,canvases:()=>canvases};
}
const rf=rasterFixture(),raster=Solid.create(rf.host,{raster:true});
check(rf.host.children.length===1&&rf.host.children[0].tagName==='canvas','raster path has one real DOM surface, not virtual face nodes');
for(const step of journey){
  const shape={fanLeft:0,fanRight:0,notches:actualNotches},result=raster.update(step.m,step.close,shape);
  near(result.close,step.close,'raster shares exactly the same closure amount');
  check(rf.host.children.length===1,'navigation never appends paper triangles to the real DOM');
}
check(raster.getStats().raster&&raster.getStats().virtualFaces>100,'raster reuses detailed virtual tessellation');
check(raster.getStats().activeFaces===fast.getStats().activeFaces,'raster and DOM finish with the same actual paper faces');
check(rf.draws()>0,'raster paints the fine paper textures');
const beforeRasterDraw=raster.getStats().draws;raster.update(psalm,0,{fanLeft:0,fanRight:0,notches:actualNotches});
check(raster.getStats().draws===beforeRasterDraw,'camera-only updates do not repaint the canvas');
check(raster.getStats().textureCanvases<=160,'canvas texture cache is bounded');
for(const point of [{x:0,y:0,z:0},{x:480,y:352,z:480},{x:498,y:704,z:480},{x:0,y:704,z:-36}]){
  const projected=Solid.project(point),r=Solid.RASTER,scale=1-r.BACK/r.PERSPECTIVE;
  const backed={x:r.CX+(projected.x-r.CX)*scale,y:r.CY+(projected.y-r.CY)*scale,z:r.BACK};
  pointNear(Solid.project(backed),{...projected,z:r.BACK},'back-plane inverse perspective preserves screen x/y');
  check(projected.x+r.LEFT>=0&&projected.x+r.LEFT<=r.WIDTH&&projected.y+r.TOP>=0&&projected.y+r.TOP<=r.HEIGHT,'canvas margins include open and closed outer corners');
}
raster.destroy();check(rf.host.children.length===0,'raster destroy removes only its canvas');check(raster.update(psalm,0)===null,'destroyed raster cannot redraw');

const css=fs.readFileSync(__dirname+'/book-solid.css','utf8');
check(!/transition|animation|filter\s*:/.test(css),'solid does not flatten or fade its 3D subtree');
check(/transform-style:preserve-3d/.test(css),'solid retains shared 3D depth');
const browser={window:{PaperBookKinematics:K}};vm.runInNewContext(fs.readFileSync(__dirname+'/book-solid.js','utf8'),browser);
check(browser.window.PaperBookSolid.texture(36,0,36,'foreedge')===Solid.texture(36,0,36,'foreedge'),'browser and Node texture exports agree');
solid.destroy();check(f.host.children.length===0,'destroy only removes owned faces');solid.destroy();check(solid.update(materials[0],0)===null,'destroyed solid cannot recreate itself');
console.log(JSON.stringify({bookSolidChecks:checks,stableFaceNodes:maxNodes,maxActualFaces,meshSegments:Solid.SEGMENTS,closedSplitInvariant:true,noOpacityMorph:true}));
