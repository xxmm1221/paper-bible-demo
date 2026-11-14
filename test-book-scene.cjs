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
const keys=['progress','close','orbit','angle','edgeX','scale','x','y','indexLeft','indexScale','indexZ','leftAngle','rightAngle','indexOpacity','readingEdgeOpacity'];

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
      near(end.indexLeft,240,'p1 centres the persistent edge surface on the spine');near(end.indexScale,1,'p1 restores physical index width');
    }
  }
}

// There is no cover/orbit phase: the two halves rise together, and their
// outer page tips approach the middle while the same index widens into view.
{
  const view=views[1],fit=fitFor(view),pose=poses[1],start=sample(0,pose,view,fit),retreat=sample(.12,pose,view,fit);
  check(retreat.scale<start.scale,'camera retreats before closing');near(retreat.close,0,'retreat does not fold the page early');near(retreat.orbit,0,'retreat does not present the index early');
  near(start.indexOpacity,0,'reading never shows horizontally crushed index labels');
  near(start.readingEdgeOpacity,1,'reading has its natural thin paper edges');
  const middle=sample(.5,pose,view,fit),late=sample(.82,pose,view,fit),end=sample(1,pose,view,fit);
  check(middle.close>0&&middle.close<1,'both halves are partially raised midway');
  near(middle.leftAngle,-middle.rightAngle,'halves share the spine with mirror angles');
  near(middle.angle,0,'the entire book never orbits past its cover');
  near(late.close,1,'both halves meet before the directory is fully presented');
  near(end.leftAngle,88,'left half stops before its back face is visible');
  near(end.rightAngle,-88,'right half stops before its back face is visible');
  near(end.indexLeft+240,480,'directory finishes over the middle of the book');
  near(end.indexOpacity,1,'closed index is fully available');
  near(end.readingEdgeOpacity,0,'closed close-up replaces only the reading edge detail');
  let previous=sample(0,pose,view,fit);
  for(let i=1;i<=1000;i++){
    const frame=sample(i/1000,pose,view,fit);
    check(frame.close>=previous.close&&frame.orbit>=previous.orbit,'close and presentation remain monotonic');
    near(frame.leftAngle,-frame.rightAngle,'left and right always close together');
    check(frame.leftAngle>=0&&frame.leftAngle<90&&frame.rightAngle<=0&&frame.rightAngle>-90,'neither cover front turns toward the reader');
    near(frame.angle,0,'no whole-book rotation during any phase');
    check(frame.indexOpacity>=0&&frame.indexOpacity<=1&&frame.readingEdgeOpacity>=0&&frame.readingEdgeOpacity<=1,'surface blending stays bounded');
    check(frame.indexOpacity+frame.readingEdgeOpacity>=1,'natural edge and directory have no blank transition gap');
    if(i/1000<=.58){
      const expectedTip=480+480*Math.cos(frame.leftAngle*Math.PI/180);
      const expectedDepth=480*Math.sin(frame.leftAngle*Math.PI/180);
      near(frame.indexLeft+240-frame.indexScale*240,expectedTip,'early index starts at the actual rising outer page tip');
      near(frame.indexZ,expectedDepth,'early index follows the page tip depth');
    }
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
  for(const boundary of [0,.16,.30,.38,.58,.60,.76,.78,.82,1]){
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
// The same camera can look at different paper masses without inventing thickness.
{
  const M=require('./book-material.js'),view=views[1],fit=fitFor(view),pose=poses[0];
  for(const spread of [0,626,1232,1252]){
    const material=M.compute(spread,1254),open=sample(0,pose,view,fit,null,0,material),closed=sample(1,pose,view,fit,null,0,material);
    near(open.indexScale*480,material.rightDepth*.55,'open edge follows remaining paper mass');
    near(open.indexLeft+240-open.indexScale*240,960,'open edge starts at the paper boundary');
    near(closed.indexScale,1,'closed full index can expose all labels');
    const combined=sample(.5,pose,view,fit,null,0,material);
    near(combined.indexScale*480,(material.rightDepth+material.leftDepth*combined.close)*.55,'adjoining fore-edges form one projected closed block');
    near(combined.leftAngle,-combined.rightAngle,'paper mass never changes symmetrical hinge angles');
    const materialBefore=JSON.stringify(material);
    for(const p of [0,.2,.5,.8,1])sample(p,pose,view,fit,null,0,material);
    check(JSON.stringify(material)===materialBefore,'scene geometry must never transfer or mutate stored sheet quantities');
  }
}

// Closed index framing compensates for its true forward Z position; changing
// the old reading zoom cannot change the directory's projected size/centre.
for(const view of views){
  const frame=sample(1,poses[2],view,fitFor(view));
  const depthScale=1-frame.indexZ/1800;
  const edgeScale=Math.max(.18,Math.min((view.w-42)/510,(view.h-160)/740,1.18));
  near(frame.scale/depthScale,edgeScale,'closed perspective is compensated');
  near(frame.x+480*frame.scale,view.w/2,'closed middle is at viewport centre');
  near(frame.y+352*frame.scale,view.h/2,'closed vertical centre is preserved');
}
console.log(JSON.stringify({sceneGeometryChecks:checks,trajectories:views.length*poses.length*rects.length,samplesPerTrajectory:2001,views:views.length,readingPoses:poses.length,maxCameraStep:Number(maxCameraStep.toFixed(6)),model:'symmetric spine hinges with continuous fore-edge close-up'}));
