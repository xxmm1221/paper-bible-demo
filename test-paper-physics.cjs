const assert=require('node:assert/strict');
const P=require('./paper-physics.js');let checks=0;
function near(a,b,message,tol=.001){assert.ok(Math.abs(a-b)<tol,`${message}: ${a} vs ${b}`);checks++;}
for(const dir of [-1,1])for(const radius of [12,80,240,390,476]){
  for(const p of [0,.02,.15,.35,.5,.7,.9,.99,1]){
    const opts={direction:dir,radius,progress:p,grabY:242,vertical:0};
    const start=P.point(opts,0,242);near(start.x,480,'spine x');near(start.y,242,'spine y');near(start.z,0,'spine z');
    const contact=P.point(opts,radius,242);near(contact.x,480+dir*radius*(1-2*p),'contact follows horizontal finger',.002);
    near(contact.y-contact.z*P.SLOPE,242,'contact stays under finger vertically',.002);
    let length=0,prev=start;
    for(let i=1;i<=100;i++){const pt=P.point(opts,radius*i/100,242);length+=Math.hypot(pt.x-prev.x,pt.z-prev.z);assert.ok(pt.z>=0);prev=pt;}
    near(length,radius,'material row length is preserved',radius*.001+.001);
  }
  for(const s of [0,80,240,480])for(const p of [0,1]){
    const pt=P.point({direction:dir,radius,progress:p,grabY:230},s,230);
    near(pt.x,480+dir*s*(p===0?1:-1),'flat end x');near(pt.z,0,'flat end z');near(pt.nz,p===0?1:-1,'front/back normal');
  }
}
for(const dy of [-180,-60,60,180]){
  const o={progress:.42,radius:320,grabY:190,vertical:dy};const pt=P.point(o,320,190);
  near(pt.y-pt.z*P.SLOPE,190+dy,'vertical contact tracking',.002);
}
for(const p of [.01,.1,.3,.5,.8,.99]){
  const shape=P.mesh({progress:p,radius:340,grabY:300,vertical:45});
  assert.ok([...shape.vertices].every(Number.isFinite));assert.ok(shape.maxZ>0);assert.equal(shape.vertices.length,41*17*8);checks+=3;
}
for(const [p,v,cancel,commit] of [[.1,0,false,false],[.36,0,false,false],[.6,0,false,true],[.36,1,false,true],[.8,-1,false,false],[.8,1,true,false],[.01,2,false,false],[.49,.1,false,false]]){
  assert.equal(P.release(p,v,cancel),commit);checks++;
}
for(const target of [0,1]){
  let p=.38,v=0,done=false;
  for(let i=0;i<200&&!done;i++){const next=P.spring(p,v,target,1/60);p=next.position;v=next.velocity;done=next.done;assert.ok(p>=0&&p<=1);}
  near(p,target,'settles to the chosen side',.002);assert.ok(done);checks++;
}
assert.equal(P.indices().length,40*16*6);checks++;
console.log(JSON.stringify({paperPhysicsChecks:checks,geometry:'spine-bound arc with finger contact tracking',release:'reversible'}));
