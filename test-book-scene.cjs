/* Camera geometry, not browser rasterisation or a full materials simulation. */
const assert=require('node:assert/strict');
const {sample}=require('./book-scene.js'),Material=require('./book-material.js');
let checks=0;
function check(value,message){assert.ok(value,message);checks++;}
function near(a,b,message,epsilon=1e-8){check(Math.abs(a-b)<=epsilon,`${message}: ${a} != ${b}`);}
const fitFor=v=>Math.max(.18,Math.min((v.w-66)/990,(v.h-65)/750,1.5));
const views=[{w:320,h:568},{w:390,h:844},{w:844,h:390},{w:1024,h:768},{w:1366,h:1024},{w:2560,h:1440}];
const poses=[{zoom:1,cx:480,cy:352},{zoom:3.2,cx:710,cy:590},{zoom:20,cx:-1200,cy:1800},{zoom:.5,cx:1100,cy:-700}];
const materials=[0,626,1232,1252].map(s=>Material.compute(s,1254));
const rects=[null,{depth:.1,x:462.1,y:30},{depth:35.8,x:497.8,y:670}];
const keys=['progress','close','orbit','angle','edgeX','scale','x','y','indexLeft','indexScale','indexZ','leftAngle','rightAngle','indexOpacity','readingEdgeOpacity','cameraCenterX','cameraCenterY','foreedgeZ','depthScale','edgeCenterX','edgeCenterY','edgePixelsPerUnit'];
function project(frame,point){const q=1-point.z/1800;return {x:frame.x+frame.scale*(480+(point.x-480)/q),y:frame.y+frame.scale*(352+(point.y-352)/q)};}
for(const view of views)for(const pose of poses){
  const fit=fitFor(view),reading=sample(0,pose,view,fit),scale=Math.min(3.2,fit*pose.zoom);
  near(reading.scale,scale,'reading scale');near(reading.x,view.w/2-pose.cx*scale,'reading x');near(reading.y,view.h/2-pose.cy*scale,'reading y');near(reading.close,0,'open at reading');
  const old=sample(0,pose,view,fit,rects[2],1,materials[3],{digital:1,edgeY:690});
  for(const key of ['x','y','scale','leftAngle','rightAngle','close','angle'])near(old[key],reading[key],`stale directory cannot alter reading ${key}`);
  const closed=sample(1,pose,view,fit,null,0,materials[0],{edgeY:300}),canonical=sample(1,poses[0],view,fit,null,0,materials[0],{edgeY:300});
  for(const key of keys)near(closed[key],canonical[key],`closed ignores former pose ${key}`);
  near(closed.leftAngle,90,'exact left closure');near(closed.rightAngle,-90,'exact right closure');
}
// Change the opening split behind a closed book: a known paper point and the
// camera must stay fixed, not merely approximately hidden behind a new image.
for(const view of views)for(const digital of [0,.25,.6,1]){
  const frames=materials.map(m=>sample(1,poses[0],view,fitFor(view),null,0,m,{digital,edgeY:280}));
  for(const frame of frames)for(const key of keys)near(frame[key],frames[0][key],`closed split independent ${key}`);
  for(const depth of [0,9,18,35.4,36]){
    const point={x:480+depth-18,y:280,z:480},screen=project(frames[0],point);
    for(const frame of frames){const p=project(frame,point);near(p.x,screen.x,'same layer x at commit');near(p.y,screen.y,'same layer y at commit');}
  }
}
for(const view of views){
  const frame=sample(1,poses[1],view,fitFor(view),null,0,materials[2],{edgeY:352});
  const a=project(frame,{x:462,y:352,z:480}),b=project(frame,{x:498,y:352,z:480});
  near(b.x-a.x,36*(view.w<600?2.6:2.4),'true 36-unit thickness is uniformly magnified');near(frame.edgePixelsPerUnit,view.w<600?2.6:2.4,'physical drag unit');
  const d=sample(1,poses[1],view,fitFor(view),null,0,materials[2],{digital:1,edgeY:30}),centre=project(d,{x:480,y:352,z:480});
  near(centre.x,view.w/2,'digital centre x');near(centre.y,view.h/2,'digital centre y');
  check(480*d.edgePixelsPerUnit<=Math.max(86.4,view.w-30),'digital plane fits width');check(704*d.edgePixelsPerUnit<=Math.max(126.72,view.h-140),'digital plane fits height');
}
// Focus a true absolute-depth seam instead of the generic middle of a card.
for(const view of views)for(const depth of [0,.7,9,18,33,36]){
  const frame=sample(1,poses[0],view,fitFor(view),{depth,x:480+depth-18,y:352},1,materials[1],{edgeY:210}),point=project(frame,{x:480+depth-18,y:352,z:480});
  near(point.x,view.w/2,'selected seam x');near(point.y,view.h/2,'selected seam y');
  const alias=sample(1,poses[0],view,fitFor(view),{anchorDepth:depth,y:352},1,materials[1],{edgeY:210});
  const world=sample(1,poses[0],view,fitFor(view),{x:480+depth-18,y:352},1,materials[1],{edgeY:210});
  near(alias.x,frame.x,'anchorDepth alias');near(world.x,frame.x,'world x alias');
}
for(const view of views){
  const fit=fitFor(view),top=sample(1,poses[0],view,fit,null,0,materials[1],{edgeY:-1000}),bottom=sample(1,poses[0],view,fit,null,0,materials[1],{edgeY:2000});
  near(top.edgeCenterY+bottom.edgeCenterY,704,'symmetric edge pan clamps');
  check(project(top,{x:480,y:0,z:480}).y>=70,'top labels can be brought onscreen');check(project(bottom,{x:480,y:704,z:480}).y<=view.h-70,'bottom labels can be brought onscreen');
}
let maxCameraStep=0;
for(const view of views)for(const pose of poses)for(const rect of rects){
  const fit=fitFor(view),span=Math.max(view.w,view.h,960,Math.abs(pose.cx)*3.2,Math.abs(pose.cy)*3.2);
  let previous=sample(0,pose,view,fit,rect,rect?1:0,materials[2],{edgeY:rect?.y||352});
  for(let i=0;i<=1600;i++){
    const p=i/1600,frame=sample(p,pose,view,fit,rect,rect?1:0,materials[2],{edgeY:rect?.y||352});
    for(const key of keys)check(Number.isFinite(frame[key]),`finite ${key} at ${p}`);
    near(frame.indexScale,1,'no index dilation');near(frame.indexOpacity,1,'no index crossfade');near(frame.readingEdgeOpacity,1,'no disappearing paper edge');near(frame.indexLeft,0,'identity host x');near(frame.indexZ,0,'identity host z');
    near(frame.leftAngle,-frame.rightAngle,'symmetrical hinge angles');near(frame.angle,0,'no whole book orbit');check(frame.leftAngle>=0&&frame.leftAngle<=90,'never show front cover');check(frame.close>=previous.close,'monotone closure');
    const step=Math.hypot(frame.x-previous.x,frame.y-previous.y);maxCameraStep=Math.max(maxCameraStep,step);check(step<span*.016,'connected camera frames');check(Math.abs(frame.scale-previous.scale)<.025,'continuous uniform scale');previous=frame;
  }
  for(const boundary of [0,.12,.30,.66,.86,1]){
    const a=sample(boundary-1e-7,pose,view,fit,rect,1,materials[2]),b=sample(boundary+1e-7,pose,view,fit,rect,1,materials[2]);
    for(const key of keys)check(Math.abs(a[key]-b[key])<.03,`continuous ${key} at phase ${boundary}`);
  }
  for(const axis of ['digital','focus']){
    let last=null;
    for(let i=0;i<=500;i++){
      const t=i/500,frame=sample(1,pose,view,fit,rect,axis==='focus'?t:0,materials[2],{digital:axis==='digital'?t:0,edgeY:rect?.y||352});
      const reverse=sample(1,pose,view,fit,rect,axis==='focus'?1-(500-i)/500:0,materials[2],{digital:axis==='digital'?1-(500-i)/500:0,edgeY:rect?.y||352});
      for(const key of keys)near(frame[key],reverse[key],`reversible ${axis} ${key}`,1e-6);
      if(last){check(Math.abs(frame.scale-last.scale)<.03,`continuous ${axis} scale`);check(Math.hypot(frame.x-last.x,frame.y-last.y)<span*.03,`continuous ${axis} camera`);}last=frame;
    }
  }
}
for(const view of [{w:0,h:0},{w:1,h:1},{w:240,h:100}])for(const p of [0,.2,.6,.8,1]){
  const frame=sample(p,poses[2],view,.18,rects[1],.5,materials[0],{digital:.5,edgeY:0});for(const key of keys)check(Number.isFinite(frame[key]),`tiny viewport ${key}`);check(frame.scale>0,'positive tiny scale');
}
for(const material of materials){const before=JSON.stringify(material);for(const p of [0,.2,.5,.8,1])sample(p,poses[0],views[0],fitFor(views[0]),null,0,material);check(JSON.stringify(material)===before,'camera never mutates paper mass');}
console.log(JSON.stringify({sceneGeometryChecks:checks,trajectories:views.length*poses.length*rects.length,samplesPerTrajectory:1601,maxCameraStep:Number(maxCameraStep.toFixed(6)),model:'uniform camera on true bound fore-edge and absolute-depth focus'}));
