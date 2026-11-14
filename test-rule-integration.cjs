/* Integration checks use the same sanitized semantic source as the public reader. */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const sourcePath=__dirname+'/data/bible-source.js';
if(!fs.existsSync(sourcePath)){console.log('SKIP rule integration: semantic source is absent.');process.exit(0);}
const L=require('./paper-layout.js'),Page=require('./paper-page.js'),M=require('./book-material.js');
const source=require(sourcePath),started=performance.now(),D=L.paginate(source),C=L.constants;
let glyphs=0,rows=0,chapterRuns=0,verseRuns=0;
const near=(a,b,label,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance,`${label}: ${a} != ${b}`);
assert.equal(D.books.length,66);assert.equal(D.stats.chapters,1189);
assert.equal(D.pages.length%2,0);assert.deepEqual(D.warnings,[],'no silently ignored layout warning');
for(let pageIndex=0;pageIndex<D.pages.length;pageIndex++){
  const page=D.pages[pageIndex],commands=Page.commands(page,pageIndex,D.books);
  for(const command of commands){
    for(const k of ['x','y','size'])assert.ok(Number.isFinite(command[k]),`page ${pageIndex}: ${k}`);
    assert.ok(command.x>=0&&command.x<=480&&command.y>=0&&command.y<=704);
    assert.ok(command.size>0);assert.equal(typeof command.text,'string');
    assert.ok(!('scaleX' in command)&&!('textLength' in command));
    if(command.column!==undefined){
      glyphs++;assert.ok(command.x>=page.columnX[command.column]-1e-6);
      assert.ok(command.x+command.slotWidth<=page.columnX[command.column]+C.COLUMN_WIDTH+1e-6);
      if(command.role==='body')assert.equal(command.size,C.BODY_SIZE);
    }
  }
  if(page.blank){assert.equal(commands.length,0);continue;}
  for(const column of page.cols){
    for(let ri=0;ri<column.length;ri++){
      rows++;const row=column[ri];let previousEnd=0;
      for(const run of row.runs){
        if(run.advances){
          assert.equal(run.advances.length,[...run.text].length);
          near(run.advances.reduce((a,b)=>a+b,0),run.width,'group width equals its engine advances');
        }
        if(run.kind==='chapter'){
          chapterRuns++;assert.ok(run.text.length*run.size*.62<=run.width+1e-6,'chapter digit budget');
          assert.ok(row.indent>=run.x+run.width,'first row reserves drop-cap slot');
          const second=column[ri+1];
          if(second&&second.y<=row.y+C.LINE_HEIGHT+1e-6)assert.ok(second.indent>=run.x+run.width,'second row reserves drop-cap slot');
          continue;
        }
        assert.ok(run.x>=previousEnd-1e-6,'body/verse slots do not overlap');previousEnd=run.x+run.width;
        if(run.kind==='verse'){
          verseRuns++;assert.ok(run.width>=run.text.length*run.size*.5,'verse digit width budget');
          near(run.y,row.y-C.VERSE_RISE,'verse raised baseline');
        }
      }
    }
  }
}
assert.equal(chapterRuns,1189);
for(let bi=0;bi<D.books.length;bi++){
  const b=D.books[bi];assert.equal(D.pages[b.first].b,bi);assert.equal(D.pages[b.last].b,bi);
  for(const chapter of b.chapters){
    assert.ok(Number.isInteger(chapter.page)&&chapter.page>=b.first&&chapter.page<=b.last);
    assert.ok(D.pages[chapter.page].cols.flat().some(r=>r.runs.some(t=>t.kind==='chapter'&&t.text===String(chapter.chapter))),'chapter jump reaches its actual number');
  }
}
const jude=D.books.find(b=>b.code==='JUD'),judeMass=M.compute(jude.first&~1,D.pages.length,D.books);
assert.ok(judeMass.rightRatio<.04,'Jude must leave only the final few percent of paper on the right');
near(judeMass.leftDepth+judeMass.rightDepth,M.TOTAL_DEPTH,'paper mass conserved');
const app=fs.readFileSync(__dirname+'/app.js','utf8');
const readingFunction=app.match(/  function readingPage\(\)\{[^\n]+\}/)?.[0];
const bookFunction=app.match(/  function currentBook\(\)\{[^\n]+\}/)?.[0];
assert.ok(readingFunction&&bookFunction,'app supplies reading-page-aware current book');
const context={D,spread:D.pages.length-2};
vm.runInNewContext(readingFunction+'\n'+bookFunction+'\nresult=currentBook().code;',context);
assert.equal(context.result,'REV','final spread and padding must never announce Genesis');

function mockCanvas(){
  const calls=[],stack=[],scales=[];
  const ctx={font:'12px serif',fillStyle:'#000',textAlign:'left',textBaseline:'alphabetic',lineWidth:1,
    scale(x,y){near(x,y,'equal raster scaling');scales.push([x,y]);},
    save(){stack.push({font:this.font,fillStyle:this.fillStyle,textAlign:this.textAlign,textBaseline:this.textBaseline});},
    restore(){Object.assign(this,stack.pop());},createLinearGradient(){return {addColorStop(){}};},
    fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},
    measureText(t){return {width:[...t].length*Number(this.font.match(/([\d.]+)px/)[1])*.9};},
    fillText(text,x,y,maxWidth){assert.equal(maxWidth,undefined);calls.push({text,x,y,size:Number(this.font.match(/([\d.]+)px/)[1])});}
  };
  return {canvas:{getContext:()=>ctx},calls,stack,scales};
}
const E=require('./paper-edition.js');
const sampleIndices=[...new Set([0,...['GEN','PSA','COL','JUD','REV'].map(code=>D.books.find(b=>b.code===code).first),
  ...[['GEN','2:23'],['GEN','3:14'],['PSA','23:1'],['PSA','87:1']].map(([book,ref])=>E.locate(D,book,ref)),D.pages.length-1])];
for(const pageIndex of sampleIndices){
  const page=D.pages[pageIndex],commands=Page.commands(page,pageIndex,D.books),svg=Page.svg(page,pageIndex,D.books);
  assert.doesNotMatch(svg,/textLength|lengthAdjust|spacingAndGlyphs|scaleX/);
  const svgGlyphs=[...svg.matchAll(/<text\b[^>]*x="([^"]+)" y="([^"]+)" font-size="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g)];
  assert.equal(svgGlyphs.length,commands.length);
  commands.forEach((c,i)=>{near(+svgGlyphs[i][1],c.x,'SVG shared x',.001);near(+svgGlyphs[i][2],c.y,'SVG shared y',.001);near(+svgGlyphs[i][3],c.size,'SVG shared size');});
  const f=mockCanvas();Page.paint(f.canvas,page,pageIndex,D.books,2);
  const expected=[];
  for(const c of commands){
    if(c.spacing){
      const chars=[...c.text],width=chars.length*c.size*.9+c.spacing*(chars.length-1);
      let x=c.x-(c.anchor==='middle'?width/2:c.anchor==='end'?width:0);
      for(const text of chars){expected.push({text,x,y:c.y,size:c.size});x+=c.size*.9+c.spacing;}
    }else expected.push({text:c.text,x:c.x,y:c.y,size:c.size});
  }
  assert.equal(f.calls.length,expected.length);assert.equal(f.stack.length,0);
  expected.forEach((c,i)=>{assert.equal(f.calls[i].text,c.text);near(f.calls[i].x,c.x,'Canvas shared x');near(f.calls[i].y,c.y,'Canvas shared y');near(f.calls[i].size,c.size,'Canvas shared size');});
}
console.log(JSON.stringify({ruleIntegration:'passed',pages:D.pages.length,rows,glyphs,chapters:chapterRuns,verseMarkers:verseRuns,warnings:D.warnings.length,samples:sampleIndices,judeRightSheets:judeMass.rightSheets,judeRightPercent:100*judeMass.rightRatio,milliseconds:Math.round(performance.now()-started)}));
