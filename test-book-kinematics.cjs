/* Physical continuity, rather than an opacity/scale imitation of closure. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const K=require('./book-kinematics.js'),M=require('./book-material.js');
let checks=0;
const check=(v,message)=>{assert.ok(v,message);checks++;};
const near=(a,b,message,epsilon=1e-8)=>check(Math.abs(a-b)<=epsilon,`${message}: ${a} != ${b}`);
function pointNear(a,b,message,epsilon=1e-8){for(const axis of ['x','y','z'])near(a[axis],b[axis],message+' '+axis,epsilon);}
const materials=[0,2,304,626,920,1174,1232,1252].map(s=>M.compute(s,1254));

// The whole physical object, not merely its active paper face, is invariant
// when the closed split is changed from Genesis to Jude or any other leaf.
for(let i=0;i<=72;i++)for(const u of [0,.13,.5,.87,1])for(const y of [0,352,704]){
  const s=36*i/72,expected={x:480+s-18,y,z:480*u};
  for(const material of materials){
    const side=s<material.leftDepth?'left':'right';
    pointNear(K.pagePoint(side,s,u,y,material,1),expected,'closed absolute sheet position');
    if(u===1)pointNear(K.foreedgePoint(side,s,y,material,1),expected,'closed fore-edge position');
  }
}
for(const material of materials){
  const open=K.frame(material,0),closed=K.frame(material,1);
  near(open.hingeX,480,'open split is at the reading spine');
  near(closed.hingeX,480+material.leftDepth-18,'selected layer is the closed opening seam');
  near(closed.cosine,0,'complete closure reaches exact 90 degrees');near(closed.sine,1,'complete closure reaches exact sine');
  near(closed.A,1,'closed depth is not enlarged');near(closed.B,0,'closed leaves have no foot shear');near(closed.C,0,'closed fore-edge is flush');
  pointNear(K.foreedgePoint('left',0,0,material,1),{x:462,y:0,z:480},'closed first leaf');
  pointNear(K.foreedgePoint('right',36,704,material,1),{x:498,y:704,z:480},'closed final leaf');
  for(const side of ['left','right'])for(const close of [0,.001,.2,.5,.85,.999,1]){
    const interval=K.layerInterval(side,material),top=K.topMatrixValues(side,material,close),edge=K.foreedgeMatrixValues(side,material,close);
    check(top.length===16&&edge.length===16,'CSS matrices are 4x4');
    check(top.every(Number.isFinite)&&edge.every(Number.isFinite),'all matrix entries are finite');
    check(/^matrix3d\([-\d.,]+\)$/.test(K.topMatrix(side,material,close)),'top CSS serialisation');
    check(/^matrix3d\([-\d.,]+\)$/.test(K.foreedgeMatrix(side,material,close)),'edge CSS serialisation');
    for(const x of [0,240,480])for(const y of [0,704]){
      const u=side==='left'?1-x/480:x/480;
      pointNear(K.transformPoint(top,x,y),K.pagePoint(side,material.leftDepth,u,y,material,close),'DOM top and paper model coincide');
    }
    for(const s of [interval[0],(interval[0]+interval[1])/2,interval[1]])for(const y of [0,352,704])
      pointNear(K.transformPoint(edge,s,y),K.foreedgePoint(side,s,y,material,close),'DOM edge and absolute sheet model coincide');
    const mesh=K.bottomMesh(side,material,close,24);
    if(interval[0]===interval[1])check(mesh.length===0,'zero paper depth has no foot face');
    else{
      check(mesh.length===24,'foot uses a deterministic mesh');
      for(let i=0;i<mesh.length;i++){
        const strip=mesh[i];
        check(strip.vertices.every(p=>Object.values(p).every(Number.isFinite)),'foot vertices finite');
        if(i){pointNear(strip.vertices[0],mesh[i-1].vertices[1],'adjacent foot first boundary');pointNear(strip.vertices[3],mesh[i-1].vertices[2],'adjacent foot second boundary');}
        for(const triangle of strip.triangles){
          const m=K.triangleMatrixValues(...triangle);
          pointNear(K.transformPoint(m,0,0),triangle[0],'triangle origin');
          pointNear(K.transformPoint(m,1,0),triangle[1],'triangle x');
          pointNear(K.transformPoint(m,0,1),triangle[2],'triangle y');
        }
      }
      pointNear(mesh.at(-1).vertices[1],K.foreedgePoint(side,interval[0],704,material,close),'foot joins fore-edge first corner');
      pointNear(mesh.at(-1).vertices[2],K.foreedgePoint(side,interval[1],704,material,close),'foot joins fore-edge second corner');
    }
  }
}

// Fine sampling detects geometry jumps, mirrored vertices and nondeterministic
// return paths. No renderer may skip the intervening world-space positions.
let largestStep=0;
for(const material of materials)for(const side of ['left','right']){
  const interval=K.layerInterval(side,material),s=(interval[0]+interval[1])/2;
  let previous=K.foreedgePoint(side,s,352,material,0);
  for(let i=0;i<=2000;i++){
    const close=i/2000,p=K.foreedgePoint(side,s,352,material,close);
    check(Object.values(p).every(Number.isFinite),'continuous point is finite');
    const delta=Math.hypot(p.x-previous.x,p.y-previous.y,p.z-previous.z);largestStep=Math.max(largestStep,delta);
    check(delta<.5,'fore-edge trajectory has no frame discontinuity');
    pointNear(p,K.foreedgePoint(side,s,352,material,1-(1-close)),'closing and reverse opening share the same path');
    previous=p;
  }
}

// No hidden special case at the last fraction of closure: the derivative
// approaches the endpoint from the same physical equation.
for(const material of materials)for(const side of ['left','right']){
  const interval=K.layerInterval(side,material),s=(interval[0]+interval[1])/2;
  const a=K.foreedgePoint(side,s,352,material,1-2e-6),b=K.foreedgePoint(side,s,352,material,1-1e-6),c=K.foreedgePoint(side,s,352,material,1);
  for(const axis of ['x','y','z'])near((c[axis]-b[axis])/1e-6,(b[axis]-a[axis])/1e-6,'endpoint derivative '+axis,.003);
}
check(K.frame({leftDepth:Infinity,rightDepth:NaN},NaN).close===0,'bad time degrades to the open endpoint');
check(K.frame({totalDepth:0,leftDepth:4},2).totalDepth===0,'explicit zero paper remains zero');
assert.throws(()=>K.topMatrix('front',materials[0],0),TypeError);checks++;
assert.throws(()=>K.matrixCSS([1,2]),TypeError);checks++;
const browser={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/book-kinematics.js','utf8'),browser);
for(const side of ['left','right'])near(browser.window.PaperBookKinematics.foreedgePoint(side,12,140,materials[3],.46).x,K.foreedgePoint(side,12,140,materials[3],.46).x,'browser and Node exports agree');
console.log(JSON.stringify({bookKinematicsChecks:checks,largestStep,closedDepth:36,closedSplitInvariant:true,closureDegrees:90,geometry:'absolute paper layers and one spine-bound 3D object'}));
