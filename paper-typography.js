/* Fixed page typography shared by SVG and paper textures.
 * The data already owns page/column/line breaks. We only place its glyphs.
 * No glyph fitting, textLength, horizontal scale, or viewport-driven reflow.
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
  const advanceForCharacter=char=>C.CELL*(char===' '?C.SPACE_CELLS:1);
  const verseCells=text=>Math.max(.9,String(text).length*.58);

  function layoutBody(page){
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
  return {constants,layoutBody,advanceForCharacter,verseCells};
});
