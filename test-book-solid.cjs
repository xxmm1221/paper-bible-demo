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
const f=fixture(),solid=Solid.create(f.host),nodes=[...f.host.children],identities=new Set(nodes);
check(nodes.length===100,'bounded solid has 100 persistent faces');check(nodes.length<150,'face budget remains below 150');
check(f.host.attributes['aria-hidden']==='true','decorative solid does not enter accessibility navigation');
const materials=[0,626,920,1174,1232,1252].map(s=>M.compute(s,1254));
for(const material of materials){
  let builds;
  for(const close of [0,.1,.33,.5,.8,.999,1,.6,.2,0]){
    const frame=solid.update(material,close);
    check(frame.close===close,'update returns exact model time');
    if(builds!==undefined)check(solid.getStats().textureBuilds===builds,'changing close does not rebuild depth textures');
    builds=solid.getStats().textureBuilds;
    check(f.host.children.length===nodes.length&&f.host.children.every(n=>identities.has(n)),'no face nodes replaced during movement');
    for(const n of f.host.children){
      check(n.style.opacity===undefined,'no per-frame opacity morph');
      check(!/NaN|Infinity/.test(JSON.stringify(n.style)),'no invalid face style');
      if(!n.hidden){
        const m=matrix(n.style.transform);
        if(n.dataset.kind==='foreedge'){
          near(parseFloat(n.style.width),36,'no 480-wide replacement edge');
          const [s0,s1]=K.layerInterval(n.dataset.side,material);
          for(const s of [s0,s1])for(const y of [0,704])pointNear(K.transformPoint(m,s,y),K.foreedgePoint(n.dataset.side,s,y,material,close),'edge shares world corners');
        }
        if(n.dataset.kind==='head'||n.dataset.kind==='foot'){
          const segment=Number(n.dataset.segment),t=Number(n.dataset.triangle),mesh=K.edgeMesh(n.dataset.side,material,close,n.dataset.kind==='head'?0:704,Solid.SEGMENTS),triangle=mesh[segment].triangles[t];
          pointNear(K.transformPoint(m,0,0),triangle[0],'tile triangle origin');
          pointNear(K.transformPoint(m,100,0),triangle[1],'tile triangle x');
          pointNear(K.transformPoint(m,0,100),triangle[2],'tile triangle y');
        }
      }
    }
  }
}
check(f.created()===100,'update never allocates new elements');

// Changing only the closed opening split must not move outer skin or edge
// coordinates. Both sides also share the exact same absolute-depth texture.
let baseline;
for(const material of materials){
  solid.update(material,1);
  const edgeNodes=nodes.filter(n=>n.dataset.kind==='foreedge');
  check(edgeNodes[0].style.backgroundImage===edgeNodes[1].style.backgroundImage,'both halves share absolute edge texture');
  const shapes=nodes.filter(n=>n.dataset.kind==='foreedge'||n.dataset.kind==='leather').map(n=>n.style.transform);
  if(baseline)check(JSON.stringify(shapes)===JSON.stringify(baseline),'closed split does not move a visible outer surface');
  baseline=shapes;
}
solid.update({totalDepth:0,leftDepth:0,rightDepth:0},1);
check(nodes.every(n=>n.hidden),'zero total paper leaves no residual slab');
solid.update(materials[1],.5);check(nodes.some(n=>!n.hidden),'same faces are reusable after zero depth');
solid.update({totalDepth:36,leftDepth:Infinity,rightDepth:NaN},NaN);
check(nodes.every(n=>!JSON.stringify(n.style).match(/NaN|Infinity/)),'invalid numeric inputs do not leak into geometry');
assert.throws(()=>Solid.create(null),TypeError);assert.throws(()=>Solid.create({ownerDocument:{}}),TypeError);checks+=2;

// Texture depth is a physical scalar, not the side's fraction stretched to fit.
const fore=decodeURIComponent(Solid.texture(36,0,36,'foreedge'));
check(/viewBox="0 0 36 704"/.test(fore),'fore-edge artwork is genuinely 36 units wide');
check(!/filter=|opacity="0"|scale\(/.test(fore),'texture does not hide replacement geometry');
const tri1=decodeURIComponent(Solid.texture(36,8,24,'triangle-1')),tri2=decodeURIComponent(Solid.texture(36,8,24,'triangle-2'));
check(tri1.includes('x2="0" y2="100"'),'first triangle depth gradient follows y');
check(tri2.includes('x2="50" y2="50"'),'second triangle depth gradient follows x+y');
check(Solid.strata(36).every(s=>s.depth>0&&s.depth<36&&s.width<.1&&s.alpha<.2),'fine low-contrast strata stay inside the paper');
for(let i=1,s=Solid.strata(36);i<s.length;i++)check(s[i].depth>s[i-1].depth,'paper lines remain ordered');

const css=fs.readFileSync(__dirname+'/book-solid.css','utf8');
check(!/transition|animation|filter\s*:/.test(css),'solid does not flatten or fade its 3D subtree');
check(/transform-style:preserve-3d/.test(css),'solid retains shared 3D depth');
const browser={window:{PaperBookKinematics:K}};vm.runInNewContext(fs.readFileSync(__dirname+'/book-solid.js','utf8'),browser);
check(browser.window.PaperBookSolid.texture(36,0,36,'foreedge')===Solid.texture(36,0,36,'foreedge'),'browser and Node texture exports agree');
solid.destroy();check(f.host.children.length===0,'destroy only removes owned faces');solid.destroy();check(solid.update(materials[0],0)===null,'destroyed solid cannot recreate itself');
console.log(JSON.stringify({bookSolidChecks:checks,stableFaceNodes:nodes.length,meshSegments:Solid.SEGMENTS,closedSplitInvariant:true,noOpacityMorph:true}));
