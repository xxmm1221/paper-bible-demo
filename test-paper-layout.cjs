'use strict';
const assert=require('node:assert/strict');
const L=require('./paper-layout.js');
const C=L.constants;
const sourceFor=(verses,extra={})=>({edition:'rules-test',books:[{code:'COL',name:'歌罗西书',short:'西',chapters:[{chapter:1,verses,titles:[],paragraphs:[],...extra}]}]});
const opening=[
  [1,'奉　神旨意，作基督耶稣使徒的保罗和兄弟提摩太，'],
  [2,'写信给歌罗西的圣徒，在基督里有忠心的弟兄。愿恩惠、平安从　神我们的父归与你们！']
];
const sample=L.paginate(sourceFor(opening));
const textOf=row=>row.runs.filter(r=>r.kind!=='chapter').map(r=>r.text).join('');
assert.deepEqual(sample.pages[1].cols[0].map(textOf),[
  '奉　神旨意，作基督耶稣使徒','的保罗和兄弟提摩太，2写信','给歌罗西的圣徒，在基督里有忠心的','弟兄。愿恩惠、平安从　神我们的父','归与你们！'
]);
assert.equal(sample.pages[1].cols[0][0].indent,36);
assert.equal(sample.pages[1].cols[0][1].indent,36);
assert.equal(sample.pages[1].cols[0][2].indent,0);
assert.equal(sample.pages[1].cols[0][0].runs[0].y,sample.pages[1].cols[0][0].y+C.LINE_HEIGHT-C.CHAPTER_BASELINE_RISE);
assert.equal(C.CHAPTER_BASELINE_RISE,C.BODY_SIZE*.35,'global drop-cap lift reserves font descent clearance');
assert(sample.pages[1].cols[0][2].y-sample.pages[1].cols[0][0].runs[0].y>=C.LINE_HEIGHT+C.CHAPTER_BASELINE_RISE-1e-6,
  'third-row baseline retains a line plus drop-cap descent clearance');
assert.deepEqual(L.paginate(sourceFor(opening)),sample,'layout must be deterministic');

function verify(data,source){
  assert.equal(data.pages.length%2,0,'complete physical sheets');
  let rendered='',expected='',headings=0;
  for(const b of source.books)for(const ch of b.chapters)for(const [,t] of ch.verses)expected+=t;
  for(const page of data.pages){
    for(const rows of page.cols){
      let previous=-Infinity;
      for(let index=0;index<rows.length;index++){
        const row=rows[index];assert(row.y>previous,'strictly monotonic rows');previous=row.y;
        assert(row.y<=C.BOTTOM_BASELINE+1e-6);
        let maxEnd=0;
        for(const run of row.runs){
          assert(Number.isFinite(run.x)&&Number.isFinite(run.y)&&Number.isFinite(run.width));
          assert(run.x>=-1e-6&&run.x+run.width<=C.COLUMN_WIDTH+1e-6,'runs stay in their column');
          if(run.advances){assert.equal([...run.text].length,run.advances.length);assert(run.advances.every(n=>n>0));}
          if(run.kind==='body')rendered+=run.text;
          if(run.kind!=='chapter'){assert(run.x>=maxEnd-1e-6,'inline slots never overlap');maxEnd=run.x+run.width;}
        }
        if(row.kind==='heading'){
          headings++;
          if(rows[index+1]?.kind!=='heading')assert(rows.slice(index+1).filter(r=>r.kind==='body').length>=2,'heading stays with body');
        }else{
          const nonChapter=row.runs.filter(r=>r.kind!=='chapter');
          assert.notEqual(nonChapter.at(-1)?.kind,'verse','verse label cannot be orphaned at end of row');
          const s=nonChapter.map(r=>r.text).join('');
          assert(!'，。；：！？、）］｝〉》」』”’'.includes([...s][0]),'no closing punctuation at line start');
          assert(!'（［｛〈《「『“‘'.includes([...s].at(-1)),'no opening punctuation at line end');
        }
      }
    }
  }
  assert.equal(rendered,expected,'every scripture character must survive in original order');
  assert.equal(data.warnings.length,0,'no layout overflow');
  for(let i=0;i<data.books.length;i++){
    const b=data.books[i];assert.equal(data.pages[b.first].b,i);assert.equal(data.pages[b.last].b,i);
    assert.equal(b.chapters.length,source.books[i].chapters.length);
    for(const c of b.chapters){assert.equal(data.pages[c.page].b,i);assert(data.pages[c.page].cols.flat().some(r=>r.runs.some(t=>t.kind==='chapter'&&t.text===String(c.chapter))));}
  }
  return {pages:data.pages.length,bodyRows:data.stats.bodyRows,headingRows:headings,bodyCharacters:[...rendered].length};
}
verify(sample,sourceFor(opening));
const synthetic=sourceFor(Array.from({length:100},(_,i)=>[i+1,'他说：“平安。愿　神赐福！”（原文作“喜乐”）'.repeat(5)]),{titles:[[1,'一个测试标题'],[20,'上层标题\r\n下一层标题'],[55,'另一个标题']],paragraphs:[6,40]});
verify(L.paginate(synthetic),synthetic);
const triple=sourceFor([[1,'甲乙丙丁戊己庚辛壬癸'.repeat(8)]],{chapter:150});
const tripleData=L.paginate(triple);verify(tripleData,triple);
assert(tripleData.pages[1].cols[0][0].indent>36,'three-digit chapter has its own sufficient slot');

// Full source is deliberately local-only. CI can exercise the rule engine
// using the above fixtures without publishing app-derived source material.
const fs=require('node:fs');
if(fs.existsSync(__dirname+'/data/bible-source.js')){
  const full=require('./data/bible-source.js'),started=performance.now(),data=L.paginate(full);
  const report=verify(data,full);
  assert.equal(data.books.length,66);assert.equal(data.stats.chapters,1189);
  assert.equal(data.pages[data.books.find(b=>b.code==='MAT').first].displayPage%2,1,'Matthew starts on the right');
  console.log('Full-source rule layout:',JSON.stringify({...report,milliseconds:Math.round(performance.now()-started)}));
}
console.log('Rule typesetting, source conservation, drop caps, headings, punctuation and page bounds passed.');
