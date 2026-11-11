const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const G=require('./gesture-core.js');
let tests=0;
function check(name,input,expected){assert.deepEqual(G.classify(input).type,expected,name);tests++;}
function gesture(o={}){return {start:{x:200,y:200,t:0},end:{x:100,y:205,t:150},vx:-.7,side:'right',fingers:1,...o};}
check('right page left flick',gesture(),'turn');
check('left page left flick forbidden',gesture({side:'left'}),'pan');
check('left page right flick',gesture({side:'left',end:{x:300,y:205,t:150},vx:.7}),'turn');
check('right page right flick forbidden',gesture({end:{x:300,y:205,t:150},vx:.7}),'pan');
check('slow long drag',gesture({end:{x:-100,y:205,t:1600},vx:-.2}),'pan');
check('short fast tremor',gesture({end:{x:185,y:200,t:20},vx:-2}),'pan');
check('vertical fast drag',gesture({end:{x:180,y:30,t:150},vx:-.8}),'pan');
check('diagonal fast drag',gesture({end:{x:100,y:80,t:150}}),'pan');
check('pinch never turns',gesture({fingers:2,pinched:true}),'pan');
check('slow pan remains locked',gesture({slowLocked:true}),'pan');
check('cancel never turns',gesture({cancelled:true}),'pan');
check('outside page never turns',gesture({side:'outside'}),'pan');
check('hold after flick prevents turn',gesture({end:{x:100,y:205,t:800},vx:0}),'pan');
check('two-finger translation',gesture({fingers:2}),'turn');
let b=G.burst(null,100,1,2);assert.equal(b.count,5);tests++;
b=G.burst(b,600,1,2);assert.equal(b.count,10);tests++;
b=G.burst(b,1100,1,2);assert.equal(b.count,20);tests++;
b=G.burst(b,1500,1,2);assert.equal(b.count,20);tests++;
b=G.burst(b,1900,-1,2);assert.equal(b.count,5);tests++;
b=G.burst(b,4000,-1,2);assert.equal(b.count,5);tests++;
b=G.burst(b,4200,-1,1);assert.equal(b.count,1);tests++;
b=G.burst(b,4500,-1,2);assert.equal(b.count,5);tests++;
const ctx={window:{}};vm.runInNewContext(fs.readFileSync('./bible-data.js','utf8'),ctx);const d=ctx.window.BIBLE_DATA;
assert.equal(d.books.length,66);assert.equal(d.stats.chapters,1189);
assert.equal(d.pages.length%2,0);tests+=3;
for(const b of d.books){assert.equal(b.first%2,1);assert.equal(d.books[d.pages[b.first].b].code,b.code);for(const c of b.chapters){assert.ok(c.page>=b.first&&c.page<=b.last);}}
tests+=66;
for(const p of d.pages){for(const col of p.cols){assert.ok(col.length<=34);for(const line of col){for(const [type,text,x] of line){assert.ok(x>=0&&x<14.1);assert.ok(text.length>0);}}}}
tests++;
console.log(JSON.stringify({passed:tests,books:d.books.length,chapters:d.stats.chapters,fixedPages:d.pages.length}));
