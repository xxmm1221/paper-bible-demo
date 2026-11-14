/* Deterministic typography invariants. Browser font rasterization is validated
 * separately; these checks guard glyph geometry and unmodified source content. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const T=require('./paper-typography.js'),C=T.constants;
const context={window:{}};vm.runInNewContext(fs.readFileSync('./bible-data.js','utf8'),context);
const D=context.window.BIBLE_DATA;
let checks=0,bodyGlyphs=0,chapters=0,verses=0;
function check(value,message){assert.ok(value,message);checks++;}
function near(a,b,message){check(Math.abs(a-b)<1e-7,`${message}: ${a} != ${b}`);}
near(C.BODY_SIZE,13,'one body size');near(C.LINE_HEIGHT,18,'increased line spacing');
near(C.FIRST_BASELINE,90,'first body baseline');near(C.FIRST_BASELINE+33*C.LINE_HEIGHT,684,'last line retains bottom margin');
check(C.LINE_HEIGHT/C.BODY_SIZE>1.38,'line spacing is visibly greater than type size');
check(C.CHAPTER_SIZE<C.LINE_HEIGHT,'chapter type fits its line instead of spanning the previous one');
near(T.advanceForCharacter(' '),4.9,'source spaces occupy 0.35 cells');
for(const char of ['神','。','，','？','！','*','.','-'])near(T.advanceForCharacter(char),14,'natural glyph in original full cell');

for(let pageIndex=0;pageIndex<D.pages.length;pageIndex++){
  const page=D.pages[pageIndex],commands=T.layoutBody(page),byRun=new Map();
  for(const cmd of commands){
    for(const key of ['x','y','size','advance','slotWidth'])check(Number.isFinite(cmd[key]),`${pageIndex} finite ${key}`);
    check(!('textLength' in cmd)&&!('scaleX' in cmd)&&!('lengthAdjust' in cmd),'no anisotropic fitting instructions');
    check(cmd.x>=C.COLUMN_X[cmd.column]-1e-8,'left column bound');
    check(cmd.x<=C.COLUMN_X[cmd.column]+C.COLUMN_WIDTH+1e-8,'right column bound');
    check(cmd.y>=C.FIRST_BASELINE-C.VERSE_RISE&&cmd.y<=684,'fixed vertical bounds');
    const key=`${cmd.column}:${cmd.row}:${cmd.run}`;
    if(!byRun.has(key))byRun.set(key,[]);byRun.get(key).push(cmd);
    if(cmd.role==='body'){
      bodyGlyphs++;near(cmd.size,C.BODY_SIZE,'every body glyph has identical size');
      near(cmd.y,C.FIRST_BASELINE+cmd.row*C.LINE_HEIGHT,'body baseline grid');
      check(cmd.text.length>0&&[...cmd.text].length===1,'body glyph is not a stretched text run');
      near(cmd.advance,T.advanceForCharacter(cmd.text),'source-correct advance');
      check(cmd.x+cmd.advance<=C.COLUMN_X[cmd.column]+C.COLUMN_WIDTH+1e-7,'body does not overflow fixed column');
    }else if(cmd.role==='chapter'){
      chapters++;near(cmd.y,C.FIRST_BASELINE+cmd.row*C.LINE_HEIGHT,'chapter stays on its own baseline');
      near(cmd.slotWidth,30.8,'chapter has its own horizontal slot');
      check(cmd.text.length<=3,'chapter number fits the supported three-digit slot');
      // Tabular decimal glyph widths in the chosen 16px number face have ample
      // room in a 30.8px slot; actual browser bounds are a separate render check.
      check(cmd.text.length*cmd.size*.6<cmd.slotWidth,'three decimal digits have a safe width budget');
      const next=page.cols[cmd.column][cmd.row][cmd.run+1];
      if(next)check(cmd.x+cmd.slotWidth<=C.COLUMN_X[cmd.column]+next[2]*C.CELL+1e-8,'chapter never occupies following body slot');
    }else if(cmd.role==='verse'){
      verses++;near(cmd.size,8.5,'verse superscript size');near(cmd.y,C.FIRST_BASELINE+cmd.row*C.LINE_HEIGHT-3,'verse raised by 3px');
      check(cmd.anchor==='middle','verse centered in its own allocated slot');
    }else check(false,'unknown command role');
  }
  for(let col=0;col<2;col++)for(let row=0;row<page.cols[col].length;row++){
    const line=page.cols[col][row];
    for(let run=0;run<line.length;run++){
      const [type,text,offset]=line[run],list=byRun.get(`${col}:${row}:${run}`)||[];
      check(list.map(c=>c.text).join('')===text,'every source character preserved in original page, column, line and run');
      const first=list[0];check(!!first,'every run has output');
      const expected=C.COLUMN_X[col]+offset*C.CELL;
      near(first.x-(type==='v'?first.slotWidth/2:0),expected,'original run start preserved');
      if(type==='t')for(let i=1;i<list.length;i++)near(list[i].x,list[i-1].x+list[i-1].advance,'adjacent glyph geometry has no stretch');
    }
  }
}
check(chapters===1189,'all chapter starts survive');check(D.pages.length===1254,'no repagination');
for(const [code,index] of [['JON',907],['OBA',905]]){
  check(D.books.find(b=>b.code===code).first===index,'reported page remains at its original location');
  const commands=T.layoutBody(D.pages[index]);
  check(commands.filter(c=>c.role==='body').every(c=>c.size===13),'reported page has uniform body type');
  check(commands.some(c=>c.role==='body'&&c.text==='。'),'reported round punctuation is an independent natural glyph');
  if(code==='JON'){
    const chapter2=commands.find(c=>c.role==='chapter'&&c.text==='2');
    check(chapter2&&chapter2.row>0,'Jonah chapter two remains in the original column row');
    check(chapter2.size<=C.LINE_HEIGHT,'Jonah chapter two cannot rise a full row into previous text');
  }
}
const umd={window:{}};vm.runInNewContext(fs.readFileSync('./paper-typography.js','utf8'),umd);
check(typeof umd.window.PaperTypography.layoutBody==='function','browser UMD export works');
check(T.layoutBody({cols:[[],[]]}).length===0,'empty title page supported');
// A rule-generated page owns all runtime coordinates. The renderer consumes
// them exactly instead of fitting strings or deriving a second set of rows.
const ruleLine={kind:'body',y:162,runs:[
  {kind:'chapter',text:'1',x:0,width:36,size:30,y:179.454545},
  {kind:'body',text:'太',x:36,width:12.25,size:12,y:162},
  {kind:'body',text:'。',x:48.25,width:12,size:12,y:162},
  {kind:'verse',text:'2',x:60.25,width:6,size:7.5,y:159},
  {kind:'body',text:'写',x:66.25,width:12,size:12,y:162},
  {kind:'body',text:'　',x:78.25,width:12,size:12,y:162}
]};
const rulePage={layoutVersion:2,columnX:[38,253],cols:[[
  {kind:'heading',y:144,runs:[{kind:'heading',text:'问',x:0,width:12,size:12,y:144},{kind:'heading',text:'候',x:12,width:12,size:12,y:144}]},ruleLine,
  {kind:'body',y:179.454545,runs:[{kind:'body',text:'信',x:36,width:12,size:12,y:179.454545}]}
],[]]};
const ruleCommands=T.layoutBody(rulePage),ruleBody=ruleCommands.filter(c=>c.role==='body');
check(ruleBody.map(c=>c.text).join('')==='太。写　信','rule engine source text and full-width space survive');
check(ruleBody.every(c=>c.size===12),'rule glyphs retain one natural body size');
for(const command of ruleCommands){
  const input=rulePage.cols[command.column][command.row].runs[command.run];
  near(command.x,rulePage.columnX[command.column]+input.x,'rule run x used without renderer justification');
  near(command.y,input.y,'explicit engine baseline preserved');near(command.size,input.size,'explicit engine size preserved');
  near(command.slotWidth,input.width,'slot width records layout, not glyph fitting');
  check(!('textLength' in command)&&!('scaleX' in command),'rule output forbids anisotropic fitting');
}
const ruleChapter=ruleCommands.find(c=>c.role==='chapter'),ruleVerse=ruleCommands.find(c=>c.role==='verse');
check(ruleChapter.y>ruleLine.y,'drop capital spans downwards, not into the previous line');
check(ruleChapter.y-ruleChapter.size>144,'drop-cap em box clears preceding heading baseline');
check(ruleVerse.anchor==='start','verse uses explicit engine left edge');
check(ruleCommands.filter(c=>c.role==='heading').every(c=>c.weight==='600'),'section headings receive distinct blackface weight');
check(T.layoutBody({...rulePage,blank:true}).length===0,'physical blank page contains no hidden text');
check(JSON.stringify(umd.window.PaperTypography.layoutBody(rulePage))===JSON.stringify(ruleCommands),'rule rendering is equal in browser and Node');
const compactRulePage={layoutVersion:2,columnX:[40,255],cols:[[{kind:'body',y:170,runs:[
  {kind:'body',text:'提摩太。',x:36,width:50,size:12,y:170,advances:[12.5,12.5,13,12]},
  {kind:'verse',text:'2',x:86,width:6,size:7.5,y:167}
]}],[]]};
const compactCommands=T.layoutBody(compactRulePage);
check(compactCommands.map(c=>c.text).join('')==='提摩太。2','compacted runs preserve all glyphs');
for(let i=0;i<4;i++){
  near(compactCommands[i].x,76+[0,12.5,25,38][i],'precomputed justification advance used unchanged');
  near(compactCommands[i].size,12,'compaction does not alter glyph size');
}
near(compactCommands[4].x,126,'verse uses engine slot after compacted body run');
console.log(JSON.stringify({typographyChecks:checks,pages:D.pages.length,bodyGlyphs,chapters,verses,bodySize:C.BODY_SIZE,lineHeight:C.LINE_HEIGHT,chapterSize:C.CHAPTER_SIZE,lastBaseline:684,repaginated:false}));
