'use strict';
const assert=require('node:assert/strict');
const L=require('./paper-layout.js'),Page=require('./paper-page.js');
const C=L.constants;
const q=(text,line)=>({kind:'poetry',text,line});
const p=text=>({kind:'prose',text});
const entry=(verse,segments)=>({verse,segments});
const chapter=(n,verses,poetry=[])=>({chapter:n,verses,poetry,titles:[],paragraphs:[]});
const source=chapters=>({edition:'rules-2',books:[{code:'GEN',name:'创世记',short:'创',chapters}]});
const bodyText=row=>row.runs.filter(r=>r.kind==='body').map(r=>r.text).join('');
const rowsOf=d=>d.pages.flatMap(page=>page.cols.flat());
const sourceText=s=>s.books.flatMap(b=>b.chapters.flatMap(c=>c.verses.map(v=>v[1]))).join('');
const gen223=[p('那人说：'),q('“这是我骨中的骨，','GEN.q1'),q('肉中的肉，','GEN.q2'),
  q('可以称她为女人，','GEN.q3'),q('因为她是从男人身上取出来的。”','GEN.q4')];
const gen314=[q('耶和华　神对蛇说：','GEN.q5'),q('“你既作了这事，就必受咒诅，','GEN.q6'),
  q('比一切的牲畜野兽更甚。','GEN.q7'),q('你必用肚子行走，','GEN.q8'),q('终身吃土。','GEN.q9')];
const gen315=[q('我又要叫你和女人彼此为仇；','GEN.q10'),q('你的后裔和女人的后裔也彼此为仇。','GEN.q11'),
  q('女人的后裔要伤你的头，','GEN.q12'),q('你要伤他的脚跟。”','GEN.q13')];
const gen316=[q('又对女人说：','GEN.q14'),q('“我必多多加增你怀胎的苦楚，','GEN.q15'),
  q('你生产儿女必多受苦楚。','GEN.q16'),q('你必恋慕你丈夫；','GEN.q17'),q('你丈夫必管辖你。”','GEN.q18')];
const join=segments=>segments.map(s=>s.text).join('');
const fixture=source([
  chapter(2,[[1,'天地万物都造齐了。'],[23,join(gen223)],[24,'因此，人要离开父母，与妻子连合，二人成为一体。']],
    [entry(23,gen223)]),
  chapter(3,[[1,'耶和华　神所造的，惟有蛇比田野一切的活物更狡猾。'],[14,join(gen314)],
    [15,join(gen315)],[16,join(gen316)]],[entry(14,gen314),entry(15,gen315),entry(16,gen316)])
]);
const data=L.paginate(fixture),rows=rowsOf(data);
assert.equal(rows.map(bodyText).join(''),sourceText(fixture),'poetry does not rewrite, omit or repeat any scripture character');
assert.equal(data.stats.poetryLines,18);assert.equal(data.stats.poetryVerses,4);assert.equal(data.stats.poetryBooks,1);
assert.deepEqual(L.paginate(fixture),data,'poetry layout remains deterministic');
for(const [address,expected] of [['2:23',4],['3:14',5],['3:15',4],['3:16',5]]){
  const matching=rows.filter(r=>r.poetry&&r.start===address);
  assert.equal(new Set(matching.map(r=>r.poetryLine)).size,expected,address+' retains each semantic line');
  assert.equal(rows.flatMap(r=>r.runs).filter(r=>r.kind==='verse'&&r.ref===address).length,1,
    address+' gets one verse marker, not one marker per poem line');
}
assert(rows.filter(r=>!r.poetry).map(bodyText).join('').includes('那人说：'),'mixed prose introduction is not turned into a poem');
for(const row of rows.filter(r=>r.poetry)){
  assert.equal(row.justified,false,'a poem line is never justified');assert.equal(row.gap,0);
  assert.equal(row.indent,(row.poetryContinuation?C.POETRY_CONTINUATION_INDENT:C.POETRY_INDENT)*C.CELL);
  for(const run of row.runs.filter(r=>r.kind==='body')){
    assert.deepEqual(run.advances,[...run.text].map(ch=>L.characterWidth(ch)), 'poetry keeps natural character advances');
  }
}

// Two short semantic lines at a chapter opening share the drop-cap exclusion
// zone. There must be no extra blank row between them or overlap with its ink.
const psalm=source([chapter(23,[[1,'耶和华是我的牧者，我必不致缺乏。'],[2,'他使我躺卧在青草地上，领我在可安歇的水边。']],
  [entry(1,[q('耶和华是我的牧者，','PSA.q1'),q('我必不致缺乏。','PSA.q2')]),
    entry(2,[q('他使我躺卧在青草地上，','PSA.q3'),q('领我在可安歇的水边。','PSA.q4')])])]);
const psalmData=L.paginate(psalm),psalmRows=rowsOf(psalmData).filter(r=>r.kind==='body');
assert(Math.abs(psalmRows[1].y-psalmRows[0].y-C.LINE_HEIGHT)<1e-7,'short first poetic line leaves no artificial empty row');
const cap=psalmRows[0].runs.find(r=>r.kind==='chapter');
assert(cap);assert(psalmRows[0].indent>=cap.width);assert(psalmRows[1].indent>=cap.width);
assert.equal(psalmRows[2].indent,C.POETRY_INDENT*C.CELL,'drop-cap reservation ends after the second physical row');
assert.equal(psalmRows.flatMap(r=>r.runs).filter(r=>r.kind==='chapter').length,1);
assert.equal(psalmRows.map(bodyText).join(''),sourceText(psalm));

// A source q may contain more than one verse. Verse boundaries are not poem
// boundaries: one semantic line remains one block and is only wrapped to fit.
const multi=source([chapter(1,[[1,'甲乙，'],[2,'丙丁。'],[3,'戊己。']],
  [entry(1,[q('甲乙，','GEN.same')]),entry(2,[q('丙丁。','GEN.same')]),entry(3,[q('戊己。','GEN.next')])])]);
const multiData=L.paginate(multi),multiRows=rowsOf(multiData);
assert.equal(multiData.stats.poetryLines,2);assert.equal(multiRows[0].start,'1:1');assert.equal(multiRows[0].end,'1:2');
assert.equal(bodyText(multiRows[0]),'甲乙，丙丁。');
assert.equal(multiRows[0].runs.filter(r=>r.kind==='verse'&&r.text==='2').length,1);

// Long semantic phrases wrap by reusable rules, not punctuation splitting or
// recorded positions. They remain the same q and get hanging continuation.
const longText='甲乙丙丁戊己庚辛壬癸'.repeat(10)+'。';
const long=source([chapter(1,[[1,'开头。'],[2,longText]], [entry(2,[q(longText,'GEN.long')])])]);
const longRows=rowsOf(L.paginate(long)).filter(r=>r.poetry);
assert(longRows.length>3);assert(longRows.every(r=>r.poetryLine==='GEN.long'));
assert(longRows.slice(1).every(r=>r.indent===C.POETRY_CONTINUATION_INDENT*C.CELL));
assert(longRows.every(r=>!r.justified&&r.gap===0));
assert.equal(longRows.map(bodyText).join(''),longText);

// Renderer paths consume identical explicit glyph geometry; no typography
// renderer changes, text squeezing or image-only poem overlay are permitted.
for(let i=0;i<psalmData.pages.length;i++){
  const pg=psalmData.pages[i],svg=Page.svg(pg,i,psalmData.books),commands=Page.commands(pg,i,psalmData.books);
  assert.doesNotMatch(svg,/textLength|lengthAdjust|scaleX/);
  assert.equal([...svg.matchAll(/<text\b/g)].length,commands.length);
  assert(commands.filter(c=>c.role==='body').every(c=>c.size===C.BODY_SIZE));
}

// Source structures fail loudly if a boundary import ever mutates the body.
const invalid=structuredClone(fixture);invalid.books[0].chapters[0].poetry[0].segments[1].text='错误';
assert.throws(()=>L.paginate(invalid),/must preserve scripture text/);
const invalidLine=structuredClone(fixture);delete invalidLine.books[0].chapters[0].poetry[0].segments[1].line;
assert.throws(()=>L.paginate(invalidLine),/Invalid poetry segment/);

// When the full release source includes poetry, validate every imported q,
// every verse marker and every rendered character, not only sample passages.
const full=require(process.env.PAPER_SOURCE_PATH||__dirname+'/data/bible-source.js');
if(full.books.some(b=>b.chapters.some(c=>c.poetry?.length))){
  const all=L.paginate(full),allRows=rowsOf(all),semanticIds=new Set(),renderedIds=new Set();
  let annotatedVerses=0,poetryBooks=0;
  for(const book of full.books){
    let hasPoetry=false;
    for(const ch of book.chapters){
      const expected=new Map(ch.verses.map(([v,t])=>[String(v),t]));
      for(const item of ch.poetry||[]){
        annotatedVerses++;hasPoetry=true;
        assert.equal(join(item.segments),expected.get(String(item.verse)),book.code+' '+ch.chapter+':'+item.verse);
        for(const seg of item.segments)if(seg.kind==='poetry')semanticIds.add(book.code+':'+seg.line);
      }
    }
    if(hasPoetry)poetryBooks++;
  }
  for(const pg of all.pages)for(const row of pg.cols.flat())if(row.poetry){
    renderedIds.add(full.books[pg.b].code+':'+row.poetryLine);assert.equal(row.justified,false);assert.equal(row.gap,0);
  }
  assert.deepEqual(renderedIds,semanticIds,'all imported semantic lines are rendered');
  assert.equal(semanticIds.size,20578,'all q lines in the audited complete donor are present');
  assert.equal(poetryBooks,53,'all 53 books carrying q structure are covered');
  assert.equal(all.stats.poetryLines,semanticIds.size);assert.equal(all.stats.poetryVerses,annotatedVerses);
  assert.equal(all.stats.poetryBooks,poetryBooks);assert.equal(allRows.map(bodyText).join(''),sourceText(full));
  assert.equal(allRows.flatMap(r=>r.runs).filter(r=>r.kind==='verse').length,
    full.books.reduce((n,b)=>n+b.chapters.reduce((k,c)=>k+c.verses.length-(String(c.verses[0][0])==='1'?1:0),0),0),
    'every non-drop-cap verse marker appears exactly once');
  const actualMarkers=new Map();
  for(const pg of all.pages)for(const run of pg.cols.flat().flatMap(r=>r.runs))if(run.kind==='verse'){
    const key=full.books[pg.b].code+'.'+run.ref;
    actualMarkers.set(key,(actualMarkers.get(key)||0)+1);
  }
  for(const book of full.books)for(const ch of book.chapters)for(let i=0;i<ch.verses.length;i++){
    const [verse]=ch.verses[i],key=book.code+'.'+ch.chapter+':'+verse;
    assert.equal(actualMarkers.get(key)||0,i===0&&String(verse)==='1'?0:1,'verse marker count: '+key);
  }
  assert.equal(allRows.flatMap(r=>r.runs).filter(r=>r.kind==='chapter').length,1189);
  console.log(JSON.stringify({fullPoetry:'passed',poetryLines:semanticIds.size,poetryBooks,annotatedVerses,pages:all.pages.length}));
}
console.log('Poetry semantics, mixed prose, shared q, wrapping, natural glyph widths and cross-block chapter clearance passed.');
