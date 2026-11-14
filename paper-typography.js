/* Glyph placement shared by SVG and paper textures.
 * Version 2 consumes the rule engine's runtime layout, not authored line breaks.
 * Legacy pages retain their previous geometry. Neither path fits or stretches
 * glyphs, and viewport changes never cause a second, renderer-owned layout.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperTypography=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const constants=Object.freeze({
    PAGE_WIDTH:480,PAGE_HEIGHT:704,COLUMN_X:Object.freeze([32,250]),
    CELL:14,COLUMN_CELLS:14,COLUMN_WIDTH:196,MAX_ROWS:34,
    FIRST_BASELINE:90,LINE_HEIGHT:18,BODY_SIZE:13,
    CHAPTER_SIZE:16,CHAPTER_CELLS:2.2,
    VERSE_SIZE:8.5,VERSE_RISE:3,SPACE_CELLS:.35,
    BODY_FAMILY:'PaperSerif,"Noto Serif CJK SC","Songti SC",SimSun,serif',
    NUMBER_FAMILY:'Georgia,"Times New Roman",serif'
  });
  const C=constants;
  const ruleConstants=Object.freeze({
    COLUMN_X:Object.freeze([38,253]),BODY_SIZE:12,CHAPTER_SIZE:30,
    VERSE_SIZE:7.5,VERSE_RISE:3,LINE_HEIGHT:60/41.25*12,
    HEADING_SIZE:12,HEADING_FAMILY:'"Microsoft YaHei","PingFang SC",sans-serif'
  });
  const advanceForCharacter=char=>C.CELL*(char===' '?C.SPACE_CELLS:1);
  const verseCells=text=>Math.max(.9,String(text).length*.58);

  function layoutRuleBody(page){
    const result=[],R=ruleConstants,origins=page.columnX||R.COLUMN_X;
    if(page.blank)return result;
    for(let column=0;column<2;column++){
      const lines=page?.cols?.[column]||[];
      for(let row=0;row<lines.length;row++){
        const line=lines[row];
        for(let run=0;run<line.runs.length;run++){
          const item=line.runs[run],kind=item.kind,text=String(item.text);
          if(!['body','verse','chapter','heading'].includes(kind))throw new TypeError('Unknown rule-layout run: '+kind);
          const size=item.size??(kind==='verse'?R.VERSE_SIZE:kind==='chapter'?R.CHAPTER_SIZE:kind==='heading'?R.HEADING_SIZE:R.BODY_SIZE);
          const y=item.y??(line.y+(kind==='verse'?-R.VERSE_RISE:kind==='chapter'?R.LINE_HEIGHT:0));
          const width=item.width??size;
          // Width is a reserved slot, never a request to squeeze its ink.
          // The engine already includes justification in the next run's x.
          const command={column,row,run,sourceIndex:0,text,
            x:origins[column]+item.x,y,size,
            family:kind==='verse'||kind==='chapter'?C.NUMBER_FAMILY:kind==='heading'?R.HEADING_FAMILY:C.BODY_FAMILY,
            weight:kind==='heading'?'600':'normal',anchor:'start',role:kind,
            advance:width,slotWidth:width};
          if(item.advances){
            const chars=[...text];
            if(item.advances.length!==chars.length)throw new TypeError('Rule glyph advance count does not match text');
            let x=command.x;
            for(let sourceIndex=0;sourceIndex<chars.length;sourceIndex++){
              const advance=item.advances[sourceIndex];
              if(!Number.isFinite(advance)||advance<0)throw new TypeError('Invalid rule glyph advance');
              result.push({...command,text:chars[sourceIndex],sourceIndex,x,advance,slotWidth:advance});
              x+=advance;
            }
          }else result.push(command);
        }
      }
    }
    return result;
  }

  function layoutBody(page){
    if(page?.layoutVersion===2)return layoutRuleBody(page);
    const commands=[];
    for(let column=0;column<2;column++){
      const lines=page?.cols?.[column]||[];
      for(let row=0;row<lines.length;row++){
        const line=lines[row],baseline=C.FIRST_BASELINE+row*C.LINE_HEIGHT;
        for(let run=0;run<line.length;run++){
          const [type,raw,offset]=line[run],text=String(raw);
          const start=C.COLUMN_X[column]+Number(offset)*C.CELL;
          const source={column,row,run};
          if(type==='t'){
            let at=start,sourceIndex=0;
            for(const char of text){
              const advance=advanceForCharacter(char);
              commands.push({...source,sourceIndex,text:char,x:at,y:baseline,
                size:C.BODY_SIZE,family:C.BODY_FAMILY,weight:'normal',anchor:'start',
                role:'body',advance,slotWidth:advance});
              at+=advance;sourceIndex++;
            }
          }else if(type==='c'){
            // The source reserves 2.2 body cells even for three-digit chapters.
            // A modest 16px number stays in its own row rather than dropping up
            // into the preceding text; the first body glyph is not moved.
            commands.push({...source,sourceIndex:0,text,x:start,y:baseline,
              size:C.CHAPTER_SIZE,family:C.NUMBER_FAMILY,weight:'normal',anchor:'start',
              role:'chapter',advance:C.CHAPTER_CELLS*C.CELL,slotWidth:C.CHAPTER_CELLS*C.CELL});
          }else if(type==='v'){
            const slotWidth=verseCells(text)*C.CELL;
            commands.push({...source,sourceIndex:0,text,x:start+slotWidth/2,y:baseline-C.VERSE_RISE,
              size:C.VERSE_SIZE,family:C.NUMBER_FAMILY,weight:'normal',anchor:'middle',
              role:'verse',advance:slotWidth,slotWidth});
          }else{
            throw new TypeError('Unknown fixed-page text run: '+type);
          }
        }
      }
    }
    return commands;
  }
  return {constants,ruleConstants,layoutBody,layoutRuleBody,advanceForCharacter,verseCells};
});
