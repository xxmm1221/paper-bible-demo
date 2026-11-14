/* Paper mass, independent of camera zoom, index artwork and leather covers.
 * A spread is expressed in fixed paper-face page numbers. Its left stack owns
 * spread / 2 sheets; the right stack retains the active recto sheet at the end.
 * Fractional spreads are intentional while a leaf (or bundle) is turning.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperBookMaterial=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const TOTAL_DEPTH=36;
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

  function compute(spread,pageCount,books=[]){
    const faces=Math.max(0,Math.floor(finite(pageCount)));
    const totalSheets=Math.ceil(faces/2),maxSpread=Math.max(0,(totalSheets-1)*2);
    const at=clamp(finite(spread),0,maxSpread),leftSheets=at/2,rightSheets=totalSheets-leftSheets;
    const sheetDepth=totalSheets?TOTAL_DEPTH/totalSheets:0;
    const leftRatio=totalSheets?leftSheets/totalSheets:0,rightRatio=totalSheets?rightSheets/totalSheets:0;
    const leftBooks=[],rightBooks=[],leftBookIndices=[],rightBookIndices=[];
    const source=Array.isArray(books)?books:[];
    const bookStates=source.map((book,index)=>{
      const sheet=clamp(Math.floor(finite(book?.first)/2),0,Math.max(0,totalSheets-1));
      // Half-open ownership makes a book starting on the open recto remain on
      // the right. The fractional shares are available for labels on a leaf
      // that is in flight; categorical arrays remain mutually exclusive.
      const leftShare=totalSheets?clamp(leftSheets-sheet,0,1):0,rightShare=totalSheets?1-leftShare:0;
      const side=sheet<leftSheets?'left':'right';
      if(side==='left'){leftBooks.push(book);leftBookIndices.push(index);}
      else{rightBooks.push(book);rightBookIndices.push(index);}
      return {index,sheet,side,leftShare,rightShare,depth:sheet*sheetDepth};
    });
    return {spread:at,pageCount:faces,maxSpread,totalSheets,leftSheets,rightSheets,
      leftRatio,rightRatio,leftDepth:leftSheets*sheetDepth,rightDepth:rightSheets*sheetDepth,
      totalDepth:totalSheets?TOTAL_DEPTH:0,sheetDepth,
      leftBooks,rightBooks,leftBookIndices,rightBookIndices,bookStates};
  }

  function sampleTurn(fromSpread,direction,count,progress,pageCount,books=[]){
    const start=compute(fromSpread,pageCount,books);
    const sign=finite(direction)<0?-1:finite(direction)>0?1:0;
    const sheets=Math.max(0,finite(count,1));
    const target=clamp(start.spread+sign*sheets*2,0,start.maxSpread);
    const t=clamp(finite(progress),0,1);
    const result=compute(start.spread+(target-start.spread)*t,pageCount,books);
    return Object.assign(result,{fromSpread:start.spread,targetSpread:target,turnProgress:t,
      turnedSheets:(target-start.spread)/2*t,turnSheets:Math.abs(target-start.spread)/2});
  }
  return {compute,sampleTurn,TOTAL_DEPTH};
});
