/* The static SVG and both curl renderers consume exactly the same glyph list. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./paper-typography.js'));
  else root.PaperPage=factory(root.PaperTypography);
})(typeof window!=='undefined'?window:globalThis,function(T){
  'use strict';
  const FAMILY='PaperSerif,"Noto Serif CJK SC","Songti SC",SimSun,serif';
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function commands(page,index,books){
    const name=page.b<0?'旧约全书':books[page.b].name,items=[];
    const add=c=>items.push({family:FAMILY,weight:'normal',anchor:'start',color:'#2d2920',...c});
    add({role:'page-number',text:index?String(index):'',x:240,y:29,size:10,anchor:'middle'});
    add({role:'running-header',text:`${name} ${page.start}`,x:index%2?447:32,y:29,size:9,anchor:index%2?'end':'start',color:'#a46453'});
    if(page.b===-1){
      add({role:'title',text:'旧约全书',x:240,y:280,size:29,spacing:10,anchor:'middle'});
      add({role:'subtitle',text:'THE OLD TESTAMENT',x:240,y:312,size:10,spacing:2,anchor:'middle',family:'Georgia,serif'});
      add({role:'edition',text:'和合本 · 神版',x:240,y:378,size:11,anchor:'middle'});
      add({role:'edition-note',text:'固定版面阅读体验 · 原型排版',x:240,y:644,size:8,anchor:'middle',color:'#8f846c'});
    }else{
      if(page.title)add({role:'title',text:name,x:240,y:64,size:22,spacing:8,anchor:'middle'});
      for(const c of T.layoutBody(page))add(c);
      if(!page.cols.some(c=>c.length))add({role:'blank-mark',text:'·',x:240,y:350,size:10,anchor:'middle',color:'#a5977b'});
    }
    return items;
  }
  function svg(page,index,books){
    const name=page.b<0?'旧约全书':books[page.b].name;
    const glyphs=commands(page,index,books).map(c=>`<text data-role="${esc(c.role)}" x="${c.x.toFixed(3)}" y="${c.y.toFixed(3)}" font-size="${c.size}" font-family="${esc(c.family)}" font-weight="${esc(c.weight)}" text-anchor="${c.anchor}" fill="${c.color}" style="fill:${c.color}"${c.spacing?` letter-spacing="${c.spacing}"`:''}>${esc(c.text)}</text>`).join('');
    return `<svg viewBox="0 0 480 704" role="img" aria-label="${esc(name)}，体验版第 ${index} 页，${esc(page.start)} 至 ${esc(page.end)}">${glyphs}${page.b===-1?'<path d="M180 338 H300" stroke="#b2a78c" stroke-width=".6"/>':''}</svg>`;
  }
  function paint(canvas,page,index,books,ratio=2){
    const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);
    const gradient=ctx.createLinearGradient(0,0,480,0),right=index%2===1;
    (right?[[0,'#dcd5bf'],[.09,'#fffdf1'],[.9,'#fffef5'],[1,'#f9f6eb']]:[[0,'#f9f6eb'],[.1,'#fffef5'],[.91,'#fffdf1'],[1,'#dcd5bf']]).forEach(([stop,color])=>gradient.addColorStop(stop,color));
    ctx.fillStyle=gradient;ctx.fillRect(0,0,480,704);
    for(const c of commands(page,index,books)){
      ctx.save();ctx.font=`${c.weight} ${c.size}px ${c.family}`;ctx.fillStyle=c.color;ctx.textBaseline='alphabetic';
      if(c.spacing){
        const chars=[...c.text],width=chars.reduce((sum,char)=>sum+ctx.measureText(char).width,0)+c.spacing*(chars.length-1);
        ctx.textAlign='left';let at=c.x-(c.anchor==='middle'?width/2:c.anchor==='end'?width:0);
        for(const char of chars){ctx.fillText(char,at,c.y);at+=ctx.measureText(char).width+c.spacing;}
      }else{ctx.textAlign=c.anchor==='middle'?'center':c.anchor==='end'?'right':'left';ctx.fillText(c.text,c.x,c.y);}
      ctx.restore();
    }
    if(page.b===-1){ctx.strokeStyle='#b2a78c';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(180,338);ctx.lineTo(300,338);ctx.stroke();}
  }
  return {commands,svg,paint,FAMILY};
});
