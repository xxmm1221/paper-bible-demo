/* Pure scene geometry checks. Visual texture quality and browser compositing
 * still require browser/phone inspection; these tests protect continuity only. */
const assert=require('node:assert/strict');
const {sample}=require('./book-scene.js');
let checks=0;
function check(value,message){assert.ok(value,message);checks++;}
function near(actual,expected,message,epsilon=1e-8){check(Math.abs(actual-expected)<=epsilon,`${message}: ${actual} != ${expected}`);}
const fitFor=view=>Math.max(.18,Math.min((view.w-66)/990,(view.h-65)/750,1.5));
const views=[{w:320,h:568},{w:390,h:844},{w:844,h:390},{w:1024,h:768},{w:1366,h:1024},{w:2560,h:1440}];
const poses=[{zoom:1,cx:480,cy:352,focus:'fit'},{zoom:3.2,cx:710,cy:590,focus:'custom'},{zoom:20,cx:-1200,cy:1800,focus:'custom'},{zoom:.5,cx:1100,cy:-700,focus:'custom'}];
const rects=[null,{x:100,y:70},{x:410,y:650}];
const keys=['progress','close','orbit','angle','edgeX','scale','x','y','indexLeft','indexScale','indexZ'];

for(const view of views){
  const fit=fitFor(view);
  for(const pose of poses){
    const reading=sample(0,pose,view,fit),scale=Math.min(3.2,fit*pose.zoom);
    near(reading.scale,scale,'p0 preserves reading scale');
    near(reading.x,view.w/2-pose.cx*scale,'p0 preserves reading x');
    near(reading.y,view.h/2-pose.cy*scale,'p0 preserves reading y');
    near(reading.close,0,'p0 is open');near(reading.orbit,0,'p0 has no orbit');
    const focusedAtStart=sample(0,pose,view,fit,{x:10,y:690},1);
    for(const key of keys)near(focusedAtStart[key],reading[key],`old focus cannot leak into p0 ${key}`);
    for(const rect of rects){
      const end=sample(1,pose,view,fit,rect,rect?1:0),other=sample(1,poses[0],view,fit,rect,rect?1:0);
      for(const key of keys)near(end[key],other[key],`p1 ${key} is independent of previous reading pose`);
      near(end.close,1,'p1 closes the book');near(end.orbit,1,'p1 presents the edge');
      near(end.indexLeft,480,'p1 places the persistent edge surface');near(end.indexScale,1,'p1 restores physical index width');
    }
  }
}

// Phases overlap slightly to avoid stop/start motion. Retreat begins first,
// closing begins next, and the orbit waits until the leaves are nearly closed.
{
  const view=views[1],fit=fitFor(view),pose=poses[1],start=sample(0,pose,view,fit),retreat=sample(.12,pose,view,fit);
  check(retreat.scale<start.scale,'camera retreats before closing');near(retreat.close,0,'retreat does not fold the page early');near(retreat.orbit,0,'retreat does not orbit early');
  const closedBeforeOrbit=sample(.61,pose,view,fit);
  check(closedBeforeOrbit.close>.96,'leaves are nearly closed before orbit begins');near(closedBeforeOrbit.orbit,0,'orbit waits for closing');
  const fullyClosed=sample(.66,pose,view,fit);
  near(fullyClosed.close,1,'cover closes completely');check(fullyClosed.orbit<.06,'only a small overlap precedes complete closure');
  let previous=sample(0,pose,view,fit);
  for(let i=1;i<=1000;i++){
    const frame=sample(i/1000,pose,view,fit);
    check(frame.close>=previous.close&&frame.orbit>=previous.orbit,'close and orbit remain monotonic');
    if(frame.orbit>0)check(frame.close>.96,'orbit never exposes an open book as a closed side');
    previous=frame;
  }
}

let maxCameraStep=0;
for(const view of views)for(const pose of poses)for(const rect of rects){
  const fit=fitFor(view),focus=rect?1:0,span=Math.max(view.w,view.h,960,Math.abs(pose.cx)*3.2,Math.abs(pose.cy)*3.2);
  let previous=sample(0,pose,view,fit,rect,focus);
  for(let i=0;i<=2000;i++){
    const frame=sample(i/2000,pose,view,fit,rect,focus);
    for(const key of keys)check(Number.isFinite(frame[key]),`${view.w}x${view.h} p=${i/2000} ${key} is finite`);
    check(frame.scale>0&&frame.indexScale>0,'camera and index never collapse to zero');
    const step=Math.hypot(frame.x-previous.x,frame.y-previous.y);maxCameraStep=Math.max(maxCameraStep,step);
    check(step<span*.01,'even extreme reading zoom has no position discontinuity');
    check(Math.abs(frame.scale-previous.scale)<.02,'scale remains continuous');
    previous=frame;
  }
  for(const boundary of [0,.18,.28,.61,.66,.74,1]){
    const a=sample(boundary-1e-7,pose,view,fit,rect,focus),b=sample(boundary+1e-7,pose,view,fit,rect,focus);
    for(const key of keys)check(Math.abs(a[key]-b[key])<.02,`no jump in ${key} across phase boundary ${boundary}`);
  }
  const lo=sample(-1,pose,view,fit,rect,focus),start=sample(0,pose,view,fit,rect,focus),hi=sample(2,pose,view,fit,rect,focus),end=sample(1,pose,view,fit,rect,focus);
  for(const key of keys){near(lo[key],start[key],`negative progress clamps ${key}`);near(hi[key],end[key],`overshoot clamps ${key}`);}
}

// Transient zero/tiny viewports occur while mobile browser chrome and fullscreen
// change the visual viewport; they must not produce invalid transform strings.
for(const view of [{w:0,h:0},{w:1,h:1},{w:240,h:100}])for(const p of [0,.2,.6,.8,1]){
  const frame=sample(p,poses[2],view,.18,rects[1],.5);
  for(const key of keys)check(Number.isFinite(frame[key]),`temporary viewport ${key} stays finite`);
  check(frame.scale>0,'temporary viewport scale stays positive');
}
console.log(JSON.stringify({sceneGeometryChecks:checks,trajectories:views.length*poses.length*rects.length,samplesPerTrajectory:2001,views:views.length,readingPoses:poses.length,maxCameraStep:Number(maxCameraStep.toFixed(6)),model:'continuous single-book camera'}));
