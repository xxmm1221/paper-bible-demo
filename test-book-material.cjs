const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Material=require('./book-material.js');
const sandbox={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('./bible-data.js'),'utf8'),sandbox);
const D=sandbox.window.BIBLE_DATA;
let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
const near=(actual,expected,message)=>check(Math.abs(actual-expected)<1e-10,`${message}: ${actual} != ${expected}`);
function invariant(model,label){
  near(model.leftSheets+model.rightSheets,model.totalSheets,`${label}: sheet mass`);
  near(model.leftDepth+model.rightDepth,model.totalDepth,`${label}: paper depth`);
  near(model.leftRatio+model.rightRatio,model.totalSheets?1:0,`${label}: ratios`);
  for(const key of ['spread','maxSpread','totalSheets','leftSheets','rightSheets','leftDepth','rightDepth','totalDepth','sheetDepth','leftRatio','rightRatio'])check(Number.isFinite(model[key])&&model[key]>=0,`${label}: finite nonnegative ${key}`);
  const owners=[...model.leftBookIndices,...model.rightBookIndices];
  check(owners.length===D.books.length,`${label}: every book assigned`);
  check(new Set(owners).size===D.books.length,`${label}: no duplicated book label`);
  model.bookStates.forEach(book=>near(book.leftShare+book.rightShare,model.totalSheets?1:0,`${label}: label mass ${book.index}`));
}
check(D.pages.length===1254,'test uses actual 1254-page edition');
const genesis=Material.compute(0,D.pages.length,D.books);
invariant(genesis,'Genesis');near(genesis.totalSheets,627,'physical sheets');
near(genesis.leftSheets,0,'no artificial left stack');near(genesis.leftDepth,0,'zero pages have zero thickness');
near(genesis.rightDepth,36,'full right block');check(genesis.leftBooks.length===0,'no pre-Genesis label on left');
const middle=Material.compute(627,D.pages.length,D.books);
invariant(middle,'halfway in a leaf');near(middle.leftDepth,18,'midpoint left');near(middle.rightDepth,18,'midpoint right');
const judeBook=D.books.find(b=>b.code==='JUD'),jude=Material.compute(judeBook.first&~1,D.pages.length,D.books);
check(jude.spread===1232,'Jude actual fixed spread');invariant(jude,'Jude');
near(jude.leftSheets,616,'Jude left sheet count');near(jude.rightSheets,11,'Jude right sheet count');
near(jude.rightDepth,36*11/627,'Jude actual remaining thickness');
check(jude.rightDepth<.64,'Jude must not show a full-width side block');
check(jude.rightBooks.map(b=>b.code).join(',')==='JUD,REV','only Jude and Revelation labels remain on the right');
check(jude.leftBooks.length===64,'previous 64 labels have moved left');
const end=Material.compute(1252,D.pages.length,D.books);invariant(end,'last spread');
near(end.rightSheets,1,'last spread retains one physical active sheet');near(end.rightDepth,36/627,'last sheet has true thickness, not an arbitrary minimum');
check(end.rightBooks.length===0,'no previous-book labels survive at the right of the final leaf');

for(let spread=0;spread<=1252;spread+=2){
  const model=Material.compute(spread,D.pages.length,D.books);invariant(model,`spread ${spread}`);
  model.bookStates.forEach(b=>check(b.side===(b.sheet<model.leftSheets?'left':'right'),'book ownership follows physical sheet'));
}
for(const start of [0,2,626,1232,1252])for(const direction of [-1,1])for(const count of [1,5,10,20]){
  let previous=Material.sampleTurn(start,direction,count,0,D.pages.length,D.books);
  for(let step=0;step<=100;step++){
    const model=Material.sampleTurn(start,direction,count,step/100,D.pages.length,D.books);
    invariant(model,`turn ${start}/${direction}/${count}/${step}`);
    check((model.leftSheets-previous.leftSheets)*direction>=-1e-12,'turn transfers mass in the intended direction');
    check(Math.abs(model.leftSheets-previous.leftSheets)<=count/100+1e-10,'turn has no thickness discontinuity');
    previous=model;
  }
  near(previous.spread,previous.targetSpread,'a completed turn reaches the clamped target');
}
const partial=Material.sampleTurn(1232,1,1,.5,D.pages.length,D.books);
near(partial.leftSheets,616.5,'half-turned paper transfers half its mass');
near(partial.bookStates.find(b=>D.books[b.index].code==='JUD').leftShare,.5,'index label on turning Jude leaf has fractional left ownership');
near(Material.sampleTurn(1232,1,1,0,D.pages.length,D.books).spread,1232,'returning a leaf restores material');
for(const value of [NaN,Infinity,-Infinity,-100,1e12,undefined]){
  const model=Material.compute(value,D.pages.length,D.books);invariant(model,'invalid or clamped input');
  for(const key of ['progress','count','direction']){
    const args={progress:.5,count:5,direction:1};args[key]=value;
    invariant(Material.sampleTurn(1232,args.direction,args.count,args.progress,D.pages.length,D.books),'invalid turn input');
  }
}
const empty=Material.compute(0,0,D.books);invariant(empty,'empty edition');near(empty.totalDepth,0,'no paper means no paper block');
const umd={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('./book-material.js'),'utf8'),umd);
check(typeof umd.window.PaperBookMaterial.compute==='function','browser UMD API available');
console.log(JSON.stringify({materialChecks:checks,totalSheets:627,totalDepth:36,judeRightSheets:jude.rightSheets,judeRightDepth:jude.rightDepth,finalRightDepth:end.rightDepth}));
