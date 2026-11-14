const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Leaves=require('./book-leaves.js'),K=require('./book-kinematics.js'),M=require('./book-material.js'),P=require('./paper-physics.js');
let checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++;};
const near=(a,b,m,e=2e-6)=>check(Math.abs(a-b)<=e,`${m}: ${a} != ${b}`);
function pointNear(a,b,m,e){for(const key of ['x','y','z'])near(a[key],b[key],m+' '+key,e);}
function matrix(value){return value.slice(9,-1).split(',').map(Number);}
function fixture({blobs=false}={}){
  let created=0,canvases=0,frameId=0;const paints=[],listeners=new Map(),frames=new Map(),urls=[],revoked=[],blobInputs=[];
  const doc={defaultView:{requestAnimationFrame:fn=>{const id=++frameId;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)},createElement:tag=>{created++;if(tag==='canvas'){canvases++;return {width:0,height:0,toDataURL:()=>blobs?'data:image/png;base64,AQID':`data:image/png;base64,page${paints.at(-1)?.index}font${canvases}`};}return new Element(tag);},fonts:{ready:Promise.resolve(),addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:(n,fn)=>{if(listeners.get(n)===fn)listeners.delete(n);}}};
  if(blobs)Object.assign(doc.defaultView,{URL:{createObjectURL:blob=>{const url=`blob:test/page${paints.at(-1)?.index}/${urls.length}`;blobInputs.push(blob);urls.push(url);return url;},revokeObjectURL:url=>revoked.push(url)},Blob:class{constructor(parts,options){this.parts=parts;this.type=options.type;}},atob:s=>Buffer.from(s,'base64').toString('binary'),Image:class{decode(){return Promise.resolve();}}});
  class Element{
    constructor(tag){this.tagName=tag;this.ownerDocument=doc;this.style={};this.dataset={};this.children=[];this.attributes={};this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c)};}
    appendChild(n){n.parentElement=this;this.children.push(n);return n;}
    setAttribute(k,v){this.attributes[k]=v;}
    remove(){const at=this.parentElement?.children.indexOf(this);if(at>=0)this.parentElement.children.splice(at,1);}
    set innerHTML(value){throw Error('leaf strips must not replace their subtree');}
  }
  const host=new Element('host');return {host,paints,listeners,urls,revoked,blobInputs,created:()=>created,canvases:()=>canvases,paintPage:(canvas,index,ratio)=>paints.push({width:canvas.width,height:canvas.height,index,ratio}),raf:()=>{const ready=[...frames];frames.clear();ready.forEach(([,fn])=>fn());},pendingFrames:()=>frames.size};
}
(async()=>{
  const m=M.compute(626,1254),state={fanRight:1,fanLeft:0,notches:[{depth:m.leftDepth,y:200,radius:13,span:1.6,inset:19}]};
  const f=fixture(),leaves=Leaves.create(f);await Promise.resolve();
  check(f.host.children.length===64,'64 persistent curved print strips');const nodes=[...f.host.children];
  leaves.setPages(626,627);check(!leaves.update(m,0,{}).active,'flat page keeps original crisp SVG');
  check(f.paints.length===0,'flat reading does not allocate page raster textures');
  leaves.update(m,0,state);check(leaves.getStats().active,'fan uses curved printed surfaces');
  check(f.paints.length===2,'each page painted once for all 32 strips');
  check(f.paints.every(p=>p.ratio===2.5&&p.width===1200&&p.height===1760),'single isotropic 2.5x page raster');
  check(f.host.style['--bl-image-left'].includes('page626')&&f.host.style['--bl-image-right'].includes('page627'),'host owns exactly one encoded image per page');
  check(nodes.every(n=>!n.style.backgroundImage.includes('data:')&&n.style.backgroundImage.includes('var(--bl-image-')),'strips reference shared page variables instead of repeating megabytes of base64');
  for(let frame=0;frame<=40;frame++){
    const close=frame/40;leaves.update(m,close,state);
    check(f.host.children.every((n,i)=>n===nodes[i]),'strips retain identity across animation');
    for(const node of nodes){
      const mat=matrix(node.style.transform),i=Number(node.dataset.strip),side=node.dataset.side,u0=i/32,u1=(i+1)/32;
      check(mat.length===16&&mat.every(Number.isFinite),'finite strip basis');
      check(mat[0]*mat[10]-mat[2]*mat[8]>0,'front-facing right-handed basis on both pages');
      const sourceX=Number(node.dataset.sourceX),start=side==='left'?u1:u0,end=side==='left'?u0:u1;
      pointNear(K.transformPoint(mat,0,0),K.pagePoint(side,m.leftDepth,start,0,m,close,state),'ruled surface start');
      pointNear(K.transformPoint(mat,15,704),K.pagePoint(side,m.leftDepth,end,704,m,close,state),'ruled surface end');
      near(sourceX,side==='left'?480-(i+1)*15:i*15,'texture crops remain in natural page order');
      check(node.style.backgroundSize==='100% 100%,480px 704px','texture not individually stretched to strip size');
      check(!/NaN|Infinity/.test(node.style.clipPath),'notch clipping remains finite');
    }
  }
  check(f.paints.length===2,'animation does not re-rasterize the scripture');
  check(leaves.getStats().clipBuilds===1,'bending time does not rebuild or stringify notch polygons');
  for(const side of ['left','right']){
    const readingOrder=nodes.filter(n=>n.dataset.side===side).sort((a,b)=>Number(a.dataset.sourceX)-Number(b.dataset.sourceX));
    for(let i=0;i<readingOrder.length;i++){
      const node=readingOrder[i];
      near(parseFloat(node.style.width),i<31?15+Leaves.SEAM_OVERLAP:15,'raster seam uses bounded unscaled texture bleed');
      if(i<31){
        const current=[...node.style.backgroundImage.matchAll(/rgba\(49,39,23,([\d.]+)\)/g)].map(m=>Number(m[1]));
        const next=[...readingOrder[i+1].style.backgroundImage.matchAll(/rgba\(49,39,23,([\d.]+)\)/g)].map(m=>Number(m[1]));
        near(current[1],next[0],'adjacent strips share identical boundary illumination',1e-10);
      }
    }
  }
  const manyCuts={...state,notches:[...state.notches,...Array.from({length:21},(_,i)=>({depth:2,y:20+i*30,radius:13,span:.5}))]};
  check(Leaves.edgeProfile('right',m.leftDepth,m,manyCuts).edge.length<=35,'only intersecting absolute layers require silhouette samples');
  const notched=nodes.filter(n=>n.style.clipPath!=='none');check(notched.length===4,'19-unit notch only clips the outer two strips per page');
  check(notched.every(n=>n.style.clipPath.startsWith('polygon(')),'outer cut is real clipped geometry, not a pasted dark semicircle');
  for(const page of [628,630,632,634,636])leaves.setPages(page,page+1);
  check(leaves.getStats().cacheEntries===4,'encoded texture LRU is bounded to four pages');
  const count=f.paints.length,revision=leaves.getStats().fontRevision;
  f.listeners.get('loadingdone')();check(f.paints.length===count+2,'font subset completion repaints both active surfaces');
  check(leaves.getStats().fontRevision===revision+1,'font cache revision advances');
  const flat=leaves.update(m,0,{});
  check(flat.active===false&&!f.host.hidden&&flat.retaining,'flat completion restores SVG while retaining flat textures');
  check(f.host.style.transformOrigin==='480px 352px','handoff compensation is centred on the shared book lens');
  check(f.host.style.transform==='translateZ(310px) scale(.827777777778)','handoff lies above isolated SVG ink and below silk');
  for(const x of [0,240,480,720,960])for(const y of [0,352,704]){
    const p=1800,z=310,s=.827777777778;
    near(480+(x-480)*s*p/(p-z),x,'handoff lift leaves projected x unchanged',1e-8);
    near(352+(y-352)*s*p/(p-z),y,'handoff lift leaves projected y unchanged',1e-8);
  }
  for(const node of nodes){
    const mat=matrix(node.style.transform),i=Number(node.dataset.strip),side=node.dataset.side,start=(side==='left'?i+1:i)/32;
    pointNear(K.transformPoint(mat,0,0),K.pagePoint(side,m.leftDepth,start,0,m,0,{}),'handoff renders the new FLAT pose rather than frozen curved pixels');
  }
  f.raf();check(!f.host.hidden,'flat textures cover the first compositor frame');f.raf();check(f.host.hidden&&!leaves.getStats().retaining,'flat textures retire only after two animation frames');
  check(f.host.style.transform==='none'&&f.host.style.transformOrigin==='0 0','retirement removes compositor isolation transform');
  leaves.update(m,0,state);leaves.update(m,0,{});f.raf();leaves.update(m,.2,state);f.raf();
  check(!f.host.hidden&&leaves.getStats().active,'new movement cancels stale handoff retirement');
  check(f.host.style.transform==='none'&&f.host.style.transformOrigin==='0 0','active curved leaves use unmodified world coordinates');
  leaves.update(m,0,{});leaves.setPages(640,641);
  check(f.host.style['--bl-image-left'].includes('page640')&&f.host.style['--bl-image-right'].includes('page641'),'completion renders the committed new page before retiring');
  f.raf();check(!f.host.hidden,'new page handoff still covers first frame');f.raf();check(f.host.hidden,'new page handoff retires after second frame');
  leaves.update(m,.2,state);leaves.update(m,0,{});check(f.pendingFrames()>0,'handoff has a pending retire callback');
  leaves.destroy();check(f.host.children.length===0&&!f.listeners.has('loadingdone'),'destroy removes only owned strips and font listener');
  check(f.pendingFrames()===0,'destroy cancels outstanding frame callbacks');
  leaves.destroy();check(leaves.update(m,.5,state).destroyed,'destroy cannot recreate a curve');
  const bf=fixture({blobs:true}),bl=Leaves.create(bf);await Promise.resolve();bl.setPages(626,627);
  const warmed=bl.prepare();check(bf.paints.length===2,'prepare rasterizes synchronously before the animation clock');
  check((await warmed).ready,'prepare waits for decoded current-font textures');
  check(Object.values(bf.host.style).every(v=>!String(v).includes('data:')),'browser inline styles carry no base64 token stream');
  check(bf.blobInputs.every(b=>b.type==='image/png'&&b.parts[0].length===3),'PNG bytes are materialized in blob storage');
  bl.update(m,0,state);check(bf.paints.length===2,'first animation frame reuses prewarmed images');
  const beforeWarm=bf.host.style['--bl-image-left'];await bl.prepare(628,629);
  check(bf.host.style['--bl-image-left']===beforeWarm,'prewarming destination does not change visible scripture');
  for(const page of [630,632,634])await bl.prepare(page,page+1);
  check(bl.getStats().cacheEntries===4,'blob texture LRU remains bounded');
  check(!bf.revoked.includes(beforeWarm.slice(5,-2)),'destination prewarming does not revoke a visible current page');
  bl.setPages(634,635);const countBeforeFont=bf.urls.length;bf.listeners.get('loadingdone')();
  check(bf.urls.length===countBeforeFont+2,'font completion creates fresh decoded blob pages');
  bl.destroy();check(bf.revoked.length===bf.urls.length&&new Set(bf.revoked).size===bf.revoked.length,'every blob URL revoked exactly once by LRU, font refresh or destroy');
  const rf=fixture({blobs:true}),retained=Leaves.create({...rf,retainFlat:true});await Promise.resolve();retained.setPages(626,627);
  check(!retained.update(m,0,{}).active&&rf.host.hidden,'retainFlat does not delay the initial uncurved SVG reading view');
  await retained.prepare();retained.update(m,.4,state);retained.update(m,0,{});
  check(retained.getStats().active&&!retained.getStats().retaining&&!rf.host.hidden,'retainFlat keeps the SAME printed texture surface when fully flat');
  check(rf.pendingFrames()===0,'persistent flat mode never schedules a handoff to culled SVG');
  for(let i=0;i<4;i++)rf.raf();check(!rf.host.hidden,'persistent flat texture cannot disappear after delayed callbacks');
  const passes=retained.getStats().renderPasses,painted=rf.paints.length;
  for(let i=0;i<20;i++)retained.update({...m},0,{fanLeft:0,fanRight:0});
  check(retained.getStats().renderPasses===passes&&retained.getStats().cacheHits>=20,'camera-only updates skip all 64 strip computations');
  check(rf.paints.length===painted,'camera movement cannot rerasterize unchanged scripture');
  retained.setPages(628,629);check(rf.host.style['--bl-image-left'].includes('page628')&&rf.host.style['--bl-image-right'].includes('page629'),'retained flat pages repaint when the actual scripture changes');
  const afterPage=retained.getStats().renderPasses;rf.listeners.get('loadingdone')();
  check(retained.getStats().renderPasses>afterPage,'font revision invalidates the retained-flat render cache');
  retained.destroy();check(rf.revoked.length===rf.urls.length,'persistent mode retains normal blob cleanup');
  // Replay app.startFold -> updateFold -> finishFold page assignment with the
  // real persistent texture controller. The moving front/back are owned by
  // the separate curl canvas; these textures are only the stationary/under
  // leaves, never an early committed reading destination.
  for(const [from,direction,count] of [[120,1,1],[628,-1,1],[120,1,5],[628,-1,20],[1232,-1,279]]){
    const q=fixture({blobs:true}),r=Leaves.create({...q,retainFlat:true});await Promise.resolve();
    const fromMaterial=M.compute(from,1254),target=from+direction*count*2;
    const visible=()=>['left','right'].map(side=>Number(q.host.style['--bl-image-'+side].match(/page(\d+)/)?.[1]));
    const live=()=>['left','right'].every(side=>!q.revoked.includes(q.host.style['--bl-image-'+side].slice(5,-2)));
    r.setPages(from,from+1);await r.prepare();r.update(fromMaterial,.3,{});r.update(fromMaterial,0,{});
    const oldVisible=visible();await r.prepare(target,target+1);
    check(JSON.stringify(visible())===JSON.stringify(oldVisible),'target pair prewarm cannot advance visible scripture');
    const paintBefore=q.paints.length,under=direction>0?target+1:target;
    const underPair=direction>0?[from,under]:[under,from+1];r.setPages(...underPair);
    check(JSON.stringify(visible())===JSON.stringify(underPair),'startFold replaces only the real underlying side');
    check(q.paints.length===paintBefore,'prewarmed underlying page needs no first-frame rasterization');
    for(const progress of [.006,.2,.7,.4,.05]){
      r.update(M.sampleTurn(from,direction,count,progress,1254),0,{});
      check(JSON.stringify(visible())===JSON.stringify(underPair),'changing bend/material progress cannot silently commit page indices');
      check(live(),'both shown textures survive material motion in the pinned LRU');
    }
    r.setPages(from,from+1);r.update(fromMaterial,0,{});
    check(JSON.stringify(visible())===JSON.stringify(oldVisible)&&live(),'cancel restores both original textures without a revoked URL');
    check(!q.host.hidden&&r.getStats().active,'cancel keeps the persistent paper face present');
    r.setPages(...underPair);r.update(M.sampleTurn(from,direction,count,1,1254),0,{});
    const beforeCommit=q.paints.length;r.setPages(target,target+1);r.update(M.compute(target,1254),0,{});
    check(JSON.stringify(visible())===JSON.stringify([target,target+1])&&live(),'commit replaces both leaves with the exact destination spread');
    check(q.paints.length===beforeCommit,'prewarming the FULL target pair avoids a new Blob at completion');
    r.destroy();check(q.revoked.length===q.urls.length,'curl sequence releases every texture exactly once');
  }
  assert.throws(()=>Leaves.create({}),TypeError);checks++;
  const css=fs.readFileSync(__dirname+'/book-leaves.css','utf8');
  check(/transform-style:preserve-3d/.test(css)&&!/filter\s*:|transition\s*:|opacity\s*:/.test(css),'no CSS flatten or artificial cross-fade');
  const browser={window:{PaperPhysics:P,PaperBookKinematics:K}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/paper-renderer.js','utf8'),browser);
  const Renderer=browser.window.PaperSheetRenderer;
  for(const side of ['left','right'])for(const spread of [120,626,1232]){
    const material=M.compute(spread,1254),direction=side==='left'?-1:1,fan={fanLeft:side==='left'?1:0,fanRight:side==='right'?1:0,notches:[{depth:material.leftDepth,y:176,radius:13,span:1.5}]};
    const surface={side,material,close:0,state:fan},options={progress:0,radius:400,grabY:350,vertical:0,direction,originSurface:surface};
    const shape=P.mesh(options,40,16),profile=Renderer.originProfile(surface,40,16);Renderer.applyOriginSurface(shape,options,direction,profile);
    for(let j=0;j<=16;j++)for(let i=0;i<=40;i++){
      const k=(j*41+i)*8,y=j/16*704,s=Math.min(i/40*480,480-K.edgeInset(side,material.leftDepth,y,material,fan));
      const source=K.pagePoint(side,material.leftDepth,s/480,y,material,0,fan),projected=Renderer.projectBoundPoint(source),a=shape.vertices;
      near(a[k],projected.x,'initial curl starts at fan projected x',8e-5);
      near(a[k+1]-a[k+2]*P.SLOPE,projected.y,'initial curl starts at fan projected y',8e-5);
      near(a[k+3],i/40,'material u unchanged',1e-7);near(a[k+4],j/16,'material v unchanged',1e-7);
      check(Number.isFinite(a[k+5])&&Number.isFinite(a[k+6])&&Number.isFinite(a[k+7]),'deformed normals finite');
    }
    for(const p of [0,.1,.25,.51,.52,.75,1]){
      const opt={...options,progress:p},fresh=P.mesh(opt,40,16),deformed=Renderer.applyOriginSurface(fresh,opt,direction,profile);
      check([...deformed.vertices].every(Number.isFinite),'origin-to-curl is finite through full path');
    }
    const endOptions={...options,progress:1,originSurface:{...surface,state:{...fan,notches:[]}}};
    const expected=P.mesh(endOptions,40,16),end=Renderer.applyOriginSurface(P.mesh(endOptions,40,16),endOptions,direction);
    for(let at=0;at<end.vertices.length;at+=8)for(let k=0;k<5;k++)near(end.vertices[at+k],expected.vertices[at+k],'final position and UV return to regular curl',1e-7);
    const ordinary=P.mesh({progress:.31,direction},20,8),before=ordinary.vertices.slice();
    check(Renderer.applyOriginSurface(ordinary,{progress:.31},direction)===ordinary,'ordinary curl object untouched');
    check(Buffer.from(ordinary.vertices.buffer).equals(Buffer.from(before.buffer)),'ordinary curl bytes unchanged');
  }
  near(Renderer.originWeight(0),1,'initial surface weight');near(Renderer.originWeight(.52),0,'handoff completes smoothly');near(Renderer.originWeight(1),0,'final surface weight');
  console.log(JSON.stringify({bookLeavesChecks:checks,persistentStrips:64,textureRatio:2.5,textureCacheLimit:4,originFanProjection:true,ordinaryCurlUnchanged:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
