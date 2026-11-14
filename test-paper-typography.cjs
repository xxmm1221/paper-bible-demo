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
console.log(JSON.stringify({typographyChecks:checks,pages:D.pages.length,bodyGlyphs,chapters,verses,bodySize:C.BODY_SIZE,lineHeight:C.LINE_HEIGHT,chapterSize:C.CHAPTER_SIZE,lastBaseline:684,repaginated:false}));
