/* The static SVG and the curved-sheet texture must share undistorted glyph commands.
 * Mock-canvas tests validate geometry and text, not browser font rasterisation. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const Page=require('./paper-page.js');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(__dirname+'/bible-data.js','utf8'),context);
const D=context.window.BIBLE_DATA;
const initialDataHash=crypto.createHash('sha256').update(JSON.stringify(D)).digest('hex');
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
function near(actual,expected,label,epsilon=.015){assert.ok(Math.abs(actual-expected)<=epsilon,`${label}: ${actual} != ${expected}`);}
function body(c){return c.role==='body'||c.role==='t';}
function decode(text){return text.replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,hex,decimal)=>String.fromCodePoint(parseInt(hex||decimal,hex?16:10))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&amp;/g,'&');}
function attrs(source){const result={};for(const match of source.matchAll(/([\w:-]+)="([^"]*)"/g))result[match[1]]=decode(match[2]);return result;}
function svgTexts(markup){return [...markup.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map(m=>({attrs:attrs(m[1]),text:decode(m[2])}));}
const sourceBody=page=>page.cols.flatMap(col=>col.flatMap(row=>row.filter(run=>run[0]==='t').map(run=>run[1]))).join('');
const readable=text=>text.replace(/ /g,''); // ASCII layout separators are not verse characters.
const indices=[907,D.books.find(b=>b.code==='OBA').first,1175,D.books.find(b=>b.code==='PSA').chapters.find(c=>c.chapter===119).page,618,0];
function mockCanvas(){
  const calls=[],scales=[],stack=[];
  const ctx={font:'10px serif',fillStyle:'#000',textAlign:'left',textBaseline:'alphabetic',lineWidth:1,
    save(){stack.push({font:this.font,fillStyle:this.fillStyle,textAlign:this.textAlign,textBaseline:this.textBaseline,lineWidth:this.lineWidth});},
    restore(){assert.ok(stack.length,'unbalanced restore');Object.assign(this,stack.pop());},
    scale(x,y){near(x,y,'glyph geometry must never be scaled differently on each axis',1e-12);scales.push([x,y]);},
    transform(){throw Error('static page painter must not transform glyph geometry');},
    setTransform(){throw Error('static page painter must not replace glyph geometry');},
    translate(){throw Error('shared glyph commands must retain explicit page coordinates');},
    createLinearGradient(){return {addColorStop(){}};},fillRect(){},strokeRect(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},
    measureText(text){const size=Number(this.font.match(/([\d.]+)px/)[1]);return {width:[...text].reduce((sum,c)=>sum+(c===' '?size*.25:size*.91),0)};},
    fillText(text,x,y,maxWidth){assert.equal(maxWidth,undefined,'fillText maxWidth could squeeze glyphs');calls.push({text:String(text),x,y,font:this.font,size:Number(this.font.match(/([\d.]+)px/)[1]),align:this.textAlign,color:this.fillStyle});}
  };
  return {canvas:{getContext:type=>{assert.equal(type,'2d');return ctx;}},ctx,calls,scales,stack};
}

test('the page renderer exports the shared commands, SVG and canvas entry points',()=>{
  for(const key of ['commands','svg','paint'])assert.equal(typeof Page[key],'function',key);
});

test('reference pages retain every scripture character and a single body size',()=>{
  for(const i of indices){
    const cmds=Page.commands(D.pages[i],i,D.books),text=cmds.filter(body).map(c=>c.text).join('');
    assert.equal(readable(text),readable(sourceBody(D.pages[i])),`scripture content changed on page ${i}`);
    const sizes=new Set(cmds.filter(body).map(c=>c.size));assert.ok(sizes.size<=1,`mixed body size on page ${i}`);
    for(const c of cmds){assert.equal(typeof c.text,'string');assert.ok(Number.isFinite(c.x)&&Number.isFinite(c.y)&&Number.isFinite(c.size));assert.ok(c.size>0);}
    assert.deepEqual(cmds,Page.commands(D.pages[i],i,D.books),`non-deterministic page ${i}`);
  }
});

test('SVG serialises the same glyph coordinates without textLength or glyph stretching',()=>{
  for(const i of indices){
    const cmds=Page.commands(D.pages[i],i,D.books),svg=Page.svg(D.pages[i],i,D.books),texts=svgTexts(svg);
    assert.doesNotMatch(svg,/textLength|lengthAdjust|spacingAndGlyphs|scaleX\s*\(|scale\s*\(/i);
    assert.equal(texts.length,cmds.length,`SVG command count on page ${i}`);
    cmds.forEach((c,j)=>{const t=texts[j];assert.equal(t.text,c.text);near(Number(t.attrs.x),c.x,'SVG x');near(Number(t.attrs.y),c.y,'SVG y');near(Number(t.attrs['font-size']),c.size,'SVG size');assert.equal(t.attrs['data-role'],c.role);});
  }
});

test('canvas texture body coordinates and sizes match the SVG command source at each DPR',()=>{
  for(const i of indices)for(const ratio of [1,1.5,2]){
    const f=mockCanvas(),cmds=Page.commands(D.pages[i],i,D.books);Page.paint(f.canvas,D.pages[i],i,D.books,ratio);
    assert.deepEqual(f.scales,[[ratio,ratio]],`only equal DPR scaling is allowed on page ${i}`);
    assert.equal(f.stack.length,0,'canvas save/restore balance');
    let callIndex=0;
    for(const c of cmds){
      if(c.spacing){
        const chars=[...c.text],count=chars.length,group=f.calls.slice(callIndex,callIndex+count);assert.equal(group.map(x=>x.text).join(''),c.text,'spaced header text');
        const advance=char=>char===' '?c.size*.25:c.size*.91;
        const width=chars.reduce((sum,char)=>sum+advance(char),0)+c.spacing*(count-1);
        let expectedX=c.x-(c.anchor==='middle'?width/2:c.anchor==='end'?width:0);
        for(const call of group){near(call.x,expectedX,'spaced header x');near(call.y,c.y,'spaced header y');near(call.size,c.size,'spaced header size');assert.equal(call.color,c.color);expectedX+=advance(call.text)+c.spacing;}
        callIndex+=count;
      }else{
        const call=f.calls[callIndex++];assert.ok(call,`missing ${c.role} canvas command`);assert.equal(call.text,c.text);near(call.x,c.x,'canvas x');near(call.y,c.y,'canvas y');near(call.size,c.size,'canvas size');assert.equal(call.color,c.color);assert.equal(call.align,c.anchor==='middle'?'center':c.anchor==='end'?'right':'left');assert.equal(call.font,`${c.weight} ${c.size}px ${c.family}`);
      }
    }
    assert.equal(callIndex,f.calls.length,'unexpected canvas text');
  }
});

test('round punctuation and short runs are not given content-dependent glyph sizes',()=>{
  const p={b:0,title:'',start:'1:1',end:'1:1',cols:[[[['t','。 ？ 。',0]]],[]]};
  const cmds=Page.commands(p,1,D.books).filter(body),glyphs=cmds.filter(c=>!/^\s+$/.test(c.text));
  assert.equal(readable(glyphs.map(c=>c.text).join('')),'。？。');
  assert.equal(new Set(glyphs.map(c=>c.size)).size,1);
  assert.doesNotMatch(Page.svg(p,1,D.books),/textLength|lengthAdjust|spacingAndGlyphs/);
  const f=mockCanvas();Page.paint(f.canvas,p,1,D.books,2);assert.deepEqual(f.scales,[[2,2]]);
});

test('Colossians 1175 keeps Timothy separate from verse 2 and the period before verse 15 natural',()=>{
  // User-reported page, not a synthetic punctuation-only fixture. Pin the
  // source row as well as independent page coordinates: the old whole-run
  // textLength formula overran both of these source slots by 9.1 page units.
  const index=1175,page=D.pages[index];
  assert.equal(D.books[page.b].code,'COL');
  assert.equal(D.books[page.b].first,index,'the reported book must not move');
  assert.equal(JSON.stringify(page.cols[0][1]),JSON.stringify([
    ['t','使徒的保罗和兄弟提摩太 ',0],['v','2',11.35],['t','写',12.25]
  ]));
  assert.equal(JSON.stringify(page.cols[1][0]),JSON.stringify([
    ['t','。 ',0],['v','15',1.35],['t','爱子是那不能看见之　神',2.51]
  ]));
  const cmds=Page.commands(page,index,D.books);
  const tai=cmds.find(c=>c.role==='body'&&c.column===0&&c.row===1&&c.text==='太');
  const verse2=cmds.find(c=>c.role==='verse'&&c.column===0&&c.row===1&&c.text==='2');
  const write=cmds.find(c=>c.role==='body'&&c.column===0&&c.row===1&&c.text==='写');
  assert.ok(tai&&verse2&&write,'each glyph and verse number has its own command');
  near(tai.x,172,'Timothy final character uses its original cell');
  near(verse2.x,197.2,'verse 2 remains centred in its own source slot');
  near(write.x,203.5,'following scripture position remains unchanged');
  near(tai.y,108,'fixed body baseline');near(verse2.y,105,'verse number is raised');
  // This is a conservative em-box/slot budget, not a substitute for checking
  // actual glyph ink in a browser with the loaded font.
  const verse2Left=verse2.x-verse2.slotWidth/2;
  assert.ok(verse2Left-(tai.x+tai.size)>=5.8,'Timothy em-box must clear the verse-number slot');
  assert.ok(verse2.size<verse2.slotWidth,'one verse digit has space inside its own slot');
  near(verse2.x+verse2.slotWidth/2,write.x,'verse slot ends before the next scripture glyph');

  const period=cmds.find(c=>c.role==='body'&&c.column===1&&c.row===0&&c.run===0&&c.text==='。');
  const verse15=cmds.find(c=>c.role==='verse'&&c.column===1&&c.row===0&&c.text==='15');
  assert.ok(period&&verse15,'reported punctuation and verse 15 remain on their fixed row');
  near(period.x,250,'period at original right-column origin');
  near(verse15.x,277.02,'verse 15 centred in original slot');
  assert.equal(period.size,tai.size,'punctuation uses the same natural font size as scripture');
  assert.equal(period.family,tai.family,'punctuation uses the same loaded scripture face');
  assert.ok(verse15.x-verse15.slotWidth/2-(period.x+period.size)>=5.8,'period em-box clears verse 15 slot');

  const svg=Page.svg(page,index,D.books),texts=svgTexts(svg);
  const renderedPeriod=texts.find(t=>t.text==='。'&&Number(t.attrs.x)===250&&Number(t.attrs.y)===90);
  assert.ok(renderedPeriod,'period is rendered as one natural glyph, not in a fitted run');
  assert.doesNotMatch(svg,/textLength|lengthAdjust|spacingAndGlyphs|transform\s*=|font-stretch/i);
  const f=mockCanvas();Page.paint(f.canvas,page,index,D.books,2);
  const paintedPeriod=f.calls.find(c=>c.text==='。'&&c.x===250&&c.y===90);
  assert.ok(paintedPeriod,'curved-sheet texture paints the same standalone period');
  assert.deepEqual(f.scales,[[2,2]],'no extra horizontal scaling of the punctuation texture');
});

test('text escaping is safe and does not alter literal command characters',()=>{
  const p={b:0,title:'',start:'1:1',end:'1:1',cols:[[[['t','<>&"\'',0]]],[]]};
  const cmds=Page.commands(p,1,D.books).filter(body),texts=svgTexts(Page.svg(p,1,D.books)).filter(t=>t.attrs['data-role']==='body'||t.attrs['data-role']==='t');
  assert.equal(texts.map(t=>t.text).join(''),cmds.map(c=>c.text).join(''));
});

test('browser UMD and Node exports produce identical fixed-page commands',()=>{
  const browser={window:{}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/paper-typography.js','utf8'),browser);
  vm.runInNewContext(fs.readFileSync(__dirname+'/paper-page.js','utf8'),browser);
  for(const i of indices){
    assert.equal(JSON.stringify(browser.window.PaperPage.commands(D.pages[i],i,D.books)),JSON.stringify(Page.commands(D.pages[i],i,D.books)));
    assert.equal(browser.window.PaperPage.svg(D.pages[i],i,D.books),Page.svg(D.pages[i],i,D.books));
  }
});

test('rendering all fixed pages leaves pagination, chapters and source text unchanged',()=>{
  assert.equal(D.pages.length,1254);assert.equal(D.books.length,66);assert.equal(D.stats.chapters,1189);
  for(let i=0;i<D.pages.length;i++){
    const cmds=Page.commands(D.pages[i],i,D.books);
    assert.equal(readable(cmds.filter(body).map(c=>c.text).join('')),readable(sourceBody(D.pages[i])),`body order/content on page ${i}`);
    for(const [type,role] of [['c','chapter'],['v','verse']]){
      const markers=D.pages[i].cols.flatMap(col=>col.flatMap(row=>row.filter(run=>run[0]===type).map(run=>run[1])));
      assert.deepEqual(cmds.filter(c=>c.role===role).map(c=>c.text),Array.from(markers),`${role} order/content on page ${i}`);
    }
  }
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(D)).digest('hex'),initialDataHash);
});

const ruleFixture={b:51,title:'歌罗西书',start:'1:1',end:'1:2',layoutVersion:2,displayPage:224,columnX:[38,253],cols:[[
  {kind:'heading',y:144,runs:[{kind:'heading',text:'问',x:0,width:12,size:12,y:144},{kind:'heading',text:'候',x:12,width:12,size:12,y:144}]},
  {kind:'body',y:162,runs:[{kind:'chapter',text:'1',x:0,width:36,size:30,y:179.454545},
    {kind:'body',text:'提',x:36,width:12,size:12,y:162},{kind:'body',text:'摩',x:48,width:12,size:12,y:162},{kind:'body',text:'太',x:60,width:12,size:12,y:162},
    {kind:'body',text:'，',x:72,width:12,size:12,y:162},{kind:'verse',text:'2',x:84,width:6,size:7.5,y:159},{kind:'body',text:'写',x:90,width:12,size:12,y:162}]},
  {kind:'body',y:179.454545,runs:[{kind:'body',text:'。',x:36,width:12,size:12,y:179.454545},{kind:'verse',text:'15',x:48,width:12,size:7.5,y:176.454545},
    {kind:'body',text:'爱',x:60,width:12,size:12,y:179.454545},{kind:'body',text:'　',x:72,width:12,size:12,y:179.454545},{kind:'body',text:'神',x:84,width:12,size:12,y:179.454545}]}
],[]]};
ruleFixture.b=D.books.findIndex(b=>b.code==='COL');

test('rule-generated text shares the exact same coordinates in SVG and canvas without fitting',()=>{
  const p=ruleFixture,cmds=Page.commands(p,1111,D.books),svg=Page.svg(p,1111,D.books),texts=svgTexts(svg);
  assert.equal(cmds.length,texts.length);
  assert.doesNotMatch(svg,/textLength|lengthAdjust|spacingAndGlyphs|scaleX|font-stretch/);
  assert.match(svg,/规则试排第 224 页，非原版页码/);
  cmds.forEach((c,i)=>{assert.equal(texts[i].text,c.text);near(+texts[i].attrs.x,c.x,'rule SVG x');near(+texts[i].attrs.y,c.y,'rule SVG y');near(+texts[i].attrs['font-size'],c.size,'rule SVG size');});
  for(const ratio of [1,2,3]){
    const f=mockCanvas();Page.paint(f.canvas,p,1111,D.books,ratio);
    const paintBody=f.calls.filter(c=>c.size===12&&c.font.includes('PaperSerif'));
    const source=cmds.filter(c=>c.role==='body');
    assert.equal(paintBody.length,source.length);
    source.forEach((c,i)=>{assert.equal(paintBody[i].text,c.text);near(paintBody[i].x,c.x,'rule canvas x');near(paintBody[i].y,c.y,'rule canvas y');near(paintBody[i].size,c.size,'rule canvas size');});
    assert.deepEqual(f.scales,[[ratio,ratio]]);
  }
});

test('rule headers, chapter overlays and verse numbers respect their engine-owned slots',()=>{
  const cmds=Page.commands(ruleFixture,1111,D.books),chapter=cmds.find(c=>c.role==='chapter');
  const title=cmds.find(c=>c.role==='title'),number=cmds.find(c=>c.role==='page-number');
  assert.equal(number.text,'224');assert.equal(title.y,96);assert.equal(title.size,24);
  assert.equal(chapter.y,179.454545);assert.equal(chapter.size,30);
  const tai=cmds.find(c=>c.role==='body'&&c.text==='太'),v2=cmds.find(c=>c.role==='verse'&&c.text==='2');
  assert.ok(v2.x>=tai.x+tai.size+12,'verse 2 clears Timothy and its punctuation cell');
  const period=cmds.find(c=>c.role==='body'&&c.text==='。'),v15=cmds.find(c=>c.role==='verse'&&c.text==='15');
  assert.equal(period.size,tai.size);assert.equal(period.family,tai.family);
  assert.ok(v15.x>=period.x+period.size,'verse 15 never occupies period glyph cell');
  for(const c of cmds.filter(c=>c.role==='body'&&c.row<=2))assert.ok(c.x>=chapter.x+chapter.slotWidth,'drop-cap rows leave the allocated chapter slot');
});

test('New Testament divider and physical blank pages are rendered distinctly',()=>{
  const p={layoutVersion:2,b:-1,frontmatter:'新约全书',title:'新约全书',start:'',end:'',displayPage:'',cols:[[],[]]};
  const commands=Page.commands(p,1000,D.books);
  assert.equal(commands.find(c=>c.role==='title').text,'新约全书');
  assert.equal(commands.find(c=>c.role==='subtitle').text,'THE NEW TESTAMENT');
  assert.match(commands.find(c=>c.role==='edition-note').text,/暂不含页底引注/);
  const blank={...ruleFixture,blank:true};assert.deepEqual(Page.commands(blank,1002,D.books),[]);
  assert.match(Page.svg(blank,1002,D.books),/aria-label="空白纸页"/);
  assert.equal(svgTexts(Page.svg(blank,1002,D.books)).length,0);
  const f=mockCanvas();Page.paint(f.canvas,blank,1002,D.books);assert.equal(f.calls.length,0);
});
console.log(JSON.stringify({pageRendererScenarios:checks,referencePages:indices,fixedPages:D.pages.length,sourceUnchanged:true}));
