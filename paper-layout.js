/* Semantic text -> deterministic, viewport-independent paper pages.
 * Only reusable typographic rules live here: no verse-specific coordinates,
 * scanned line breaks, or original-edition page mapping. Missing footnotes
 * and poetic indentation are deliberately not invented in this first pass.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperLayout=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const constants=Object.freeze({
    PAGE_WIDTH:480,PAGE_HEIGHT:704,CELL:12,COLUMN_CELLS:16,COLUMN_WIDTH:192,
    COLUMN_X:Object.freeze([38,253]),BODY_SIZE:12,HEADING_SIZE:12,
    LINE_HEIGHT:60/41.25*12,BODY_FIRST_BASELINE:70,BOOK_HEADING_BASELINE:144,
    BOTTOM_BASELINE:684,CHAPTER_SIZE:30,CHAPTER_LINES:2,CHAPTER_CELLS:3,
    // Georgia's numeral font box extends below its alphabetic baseline. Lift
    // the two-row drop cap by 0.35 body em, preserving its size/aspect ratio,
    // so its lower box cannot intrude on the first unindented (third) row.
    CHAPTER_BASELINE_RISE:12*.35,
    VERSE_SIZE:7.5,VERSE_RISE:3,PARAGRAPH_INDENT:2,SPACE_CELLS:.35,
    HEADING_GAP_LINES:1,CHAPTER_GAP_LINES:1
  });
  const CLOSED=new Set([...',.;:!?，。；：！？、）］｝〉》」』”’％%…']);
  const OPEN=new Set([...'（［｛〈《「『“‘']);
  const EPS=1e-7;
  const ref=(chapter,verse)=>String(chapter)+':'+String(verse);
  function characterWidth(char,C=constants){
    // Glyphs retain their natural aspect ratio. Widths reserve layout slots;
    // they never become a textLength/maxWidth/horizontal scaling instruction.
    if(char===' '||char==='\t')return C.CELL*C.SPACE_CELLS;
    if(char.charCodeAt(0)<127)return C.CELL*.5;
    return C.CELL;
  }
  function boundaryAllowed(tokens,at){
    if(at<=0||at>=tokens.length)return at>0;
    const prev=tokens[at-1],next=tokens[at];
    return prev.kind!=='verse'&&!OPEN.has(prev.text)&&!CLOSED.has(next.text);
  }
  function takeLine(tokens,start,capacity,C=constants){
    let end=start,used=0;
    while(end<tokens.length&&used+tokens[end].width<=capacity+EPS){used+=tokens[end].width;end++;}
    const greedy=end;
    while(end>start&&!boundaryAllowed(tokens,end)){used-=tokens[--end].width;}
    if(end===start){
      // A pathological run of punctuation must still make progress. This is
      // surfaced in validation rather than deleting or altering source text.
      end=Math.max(start+1,greedy);used=0;
      for(let i=start;i<end;i++)used+=tokens[i].width;
    }
    return {end,used,overflow:used>capacity+EPS};
  }
  function token(kind,text,address,C){
    return {kind,text,ref:address,width:kind==='verse'?Math.max(.5,[...text].length*.5)*C.CELL:characterWidth(text,C)};
  }
  function blocksForBook(book,C){
    const blocks=[];
    for(const chapter of book.chapters){
      const number=chapter.chapter,titles=new Map(),paragraphs=new Set((chapter.paragraphs||[]).map(String));
      for(const [verse,text] of chapter.titles||[]){
        const k=String(verse);if(!titles.has(k))titles.set(k,[]);titles.get(k).push(String(text));
      }
      let current=null,first=true;
      const flush=()=>{if(current?.tokens.length)blocks.push(current);current=null;};
      for(const [verse,raw] of chapter.verses){
        const address=ref(number,verse),heads=titles.get(String(verse));
        if(heads){flush();for(const text of heads)blocks.push({kind:'heading',text,ref:address});}
        if(paragraphs.has(String(verse)))flush();
        if(!current)current={kind:'body',chapter:first?number:null,ref:address,tokens:[]};
        // A chapter number represents verse 1; later/exceptional first verse
        // numbers are kept explicitly, and merged labels remain whole.
        if(!first||String(verse)!=='1')current.tokens.push(token('verse',String(verse),address,C));
        for(const ch of String(raw))current.tokens.push(token('body',ch,address,C));
        first=false;
      }
      flush();
    }
    return blocks;
  }
  function layoutRuns(tokens,start,end,indent,capacity,y,lastLine,C){
    let used=0;for(let i=start;i<end;i++)used+=tokens[i].width;
    const gap=lastLine||end-start<2?0:Math.max(0,(capacity-used)/(end-start-1));
    const runs=[];let x=indent,body=null;
    for(let i=start;i<end;i++){
      const t=tokens[i],advance=t.width+(i<end-1?gap:0);
      if(t.kind==='body'){
        if(!body){body={kind:'body',text:'',x,width:0,size:C.BODY_SIZE,y,advances:[]};runs.push(body);}
        body.text+=t.text;body.advances.push(advance);body.width+=advance;
      }else{
        body=null;runs.push({kind:'verse',text:t.text,x,width:advance,size:C.VERSE_SIZE,y:y-C.VERSE_RISE,ref:t.ref});
      }
      x+=advance;
    }
    return {runs,justified:gap>EPS,gap,used,x};
  }
  function headingLines(text,C){
    // A semantic title may itself contain an explicit subtitle separator.
    // Respect that source newline; it is not a transcription of printed lines.
    const result=[];
    for(const part of text.split(/\r\n|\r|\n/)){
      if(!part){result.push([]);continue;}
      const ts=[...part].map(ch=>token('body',ch,'',C));
      for(let at=0;at<ts.length;){const line=takeLine(ts,at,C.COLUMN_WIDTH,C);result.push(ts.slice(at,line.end));at=line.end;}
    }
    return result;
  }
  function paginate(source,options={}){
    if(!source||!Array.isArray(source.books)||!source.books.length)throw new TypeError('A semantic Bible source is required');
    const C=Object.freeze({...constants,...options,COLUMN_X:options.COLUMN_X||constants.COLUMN_X});
    if(!(C.CELL>0&&C.LINE_HEIGHT>0&&C.COLUMN_WIDTH>C.CELL*6&&C.BOTTOM_BASELINE>C.BOOK_HEADING_BASELINE+C.LINE_HEIGHT*4))throw new RangeError('Invalid paper layout rules');
    const pages=[],books=[],warnings=[];
    const stats={books:source.books.length,chapters:0,verses:0,bodyCharacters:0,headings:0,bodyRows:0,headingRows:0};
    let page=null,column=0,y=0,bookIndex=-1,chapterSet=null;
    const addSpecial=(name,blank=false)=>{
      pages.push({b:blank?Math.min(source.books.length-1,Math.max(0,bookIndex)):-1,title:'',frontmatter:blank?'':name,blank,
        layoutVersion:2,columnX:C.COLUMN_X,start:'',end:'',cols:[[],[]],displayPage:''});
    };
    addSpecial('旧约全书');
    function newPage(opening=false){
      page={b:bookIndex,title:opening?source.books[bookIndex].name:'',layoutVersion:2,columnX:C.COLUMN_X,
        start:'',end:'',cols:[[],[]],displayPage:pages.length,opening,bodyTop:opening?C.BOOK_HEADING_BASELINE:C.BODY_FIRST_BASELINE};
      pages.push(page);column=0;y=page.bodyTop;
    }
    function nextColumn(){
      if(column===0){column=1;y=page.bodyTop;}else newPage(false);
    }
    function ensure(extra=0){if(y+extra>C.BOTTOM_BASELINE+EPS)nextColumn();}
    function previousKind(){const rows=page.cols[column];return rows.length?rows[rows.length-1].kind:null;}
    function pushRow(row){
      page.cols[column].push(row);
      if(row.kind==='body'){
        if(!page.start)page.start=row.start;page.end=row.end;
        stats.bodyRows++;
      }else stats.headingRows++;
      y+=C.LINE_HEIGHT;
    }
    for(bookIndex=0;bookIndex<source.books.length;bookIndex++){
      const book=source.books[bookIndex];
      if(book.code==='MAT'){
        // A divider sits on the left, so the New Testament begins on a right
        // page without pretending to reproduce omitted printed appendices.
        if(pages.length%2)addSpecial('',true);
        addSpecial('新约全书');
      }
      const meta={code:book.code,name:book.name,short:book.short,first:pages.length,last:pages.length,chapters:[]};
      books.push(meta);chapterSet=new Set();newPage(true);
      stats.chapters+=book.chapters.length;
      for(const ch of book.chapters)for(const [,text] of ch.verses){stats.verses++;stats.bodyCharacters+=[...String(text)].length;}
      for(const block of blocksForBook(book,C)){
        if(block.kind==='heading'){
          stats.headings++;
          const lines=headingLines(block.text,C);
          let gap=previousKind()?C.HEADING_GAP_LINES*C.LINE_HEIGHT:0;
          // Keep a complete heading and at least two body rows together. If a
          // custom rule makes that impossible, fail instead of silently spill.
          const required=(lines.length+1)*C.LINE_HEIGHT;
          if(required>C.BOTTOM_BASELINE-C.BODY_FIRST_BASELINE)throw new RangeError('Heading too tall for one paper column');
          if(y+gap+required>C.BOTTOM_BASELINE+EPS){nextColumn();gap=0;}
          y+=gap;
          lines.forEach((ts,i)=>{
            let x=0;const text=ts.map(t=>t.text).join(''),advances=ts.map(t=>t.width);
            const width=advances.reduce((a,b)=>a+b,0);
            pushRow({kind:'heading',y,start:block.ref,end:block.ref,titleStart:i===0,
              runs:[{kind:'heading',text,x,width,size:C.HEADING_SIZE,y,weight:'bold',advances}]});
          });
          continue;
        }
        const isChapter=block.chapter!==null;
        let reserve=0;
        if(isChapter){
          if(previousKind()==='body')y+=C.CHAPTER_GAP_LINES*C.LINE_HEIGHT;
          ensure((C.CHAPTER_LINES-1)*C.LINE_HEIGHT);
          reserve=Math.max(C.CHAPTER_CELLS*C.CELL,[...String(block.chapter)].length*C.CHAPTER_SIZE*.62+C.CELL*.5);
          if(reserve>=C.COLUMN_WIDTH-C.CELL*2)throw new RangeError('Chapter number leaves no text width');
          if(!chapterSet.has(block.chapter)){meta.chapters.push({chapter:block.chapter,page:pages.length-1});chapterSet.add(block.chapter);}
        }
        let at=0,rowIndex=0;
        while(at<block.tokens.length){
          ensure();
          const indent=isChapter&&rowIndex<C.CHAPTER_LINES?reserve:rowIndex===0?C.PARAGRAPH_INDENT*C.CELL:0;
          const capacity=C.COLUMN_WIDTH-indent;
          const line=takeLine(block.tokens,at,capacity,C);
          const row=layoutRuns(block.tokens,at,line.end,indent,capacity,y,line.end===block.tokens.length,C);
          if(line.overflow)warnings.push({type:'line-overflow',book:book.code,ref:block.tokens[at].ref,page:pages.length-1,column});
          if(isChapter&&rowIndex===0)row.runs.unshift({kind:'chapter',text:String(block.chapter),x:0,width:reserve-C.CELL*.5,
            size:C.CHAPTER_SIZE,y:y+(C.CHAPTER_LINES-1)*C.LINE_HEIGHT-C.CHAPTER_BASELINE_RISE,ref:block.ref});
          pushRow({kind:'body',y,runs:row.runs,start:block.tokens[at].ref,end:block.tokens[line.end-1].ref,
            indent,justified:row.justified,gap:row.gap});
          at=line.end;rowIndex++;
        }
        // A very short chapter still owns the second drop-cap row; the next
        // heading/paragraph cannot move underneath its oversized numeral.
        if(isChapter&&rowIndex<C.CHAPTER_LINES)y+=(C.CHAPTER_LINES-rowIndex)*C.LINE_HEIGHT;
      }
      meta.last=pages.length-1;
    }
    if(pages.length%2)addSpecial('',true);
    return {edition:source.edition||'rules-1',layoutVersion:2,books,pages,stats,warnings,
      layoutRules:C,notice:'统一规则文本试排；未补齐页底引注与诗行标记，页码不等同纸本。'};
  }
  return {constants,characterWidth,boundaryAllowed,takeLine,headingLines,paginate};
});
