'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const C=require('./v25/compare'),H=require('./v25/history'),S=require('./text-selection');
const Source=require('./data/bible-source'),Passages=require('./footnote-passages'),find=require('./v25/search').catalogue;
const window={};vm.runInNewContext(fs.readFileSync(require.resolve('./v25-original-data'),'utf8'),{window,atob});
const db=window.V25OriginalData;
const library=require('./v25/scripture').create(Source,{...db,get(){throw Error('Must not read print ink');}});
const load=n=>{const k=Math.floor(n/32);db.installPack(k,require('./paper-pages/'+db.packs[k]));};
const events=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
const genesis=(ref,page=10)=>({bookCode:'GEN',bookName:'创世记',ref,page});
test('expanded slips use the paper scale on wide screens and a readable floor',()=>{
  assert.equal(C.slipScale(.62,true),.88);
  assert.equal(C.slipScale(1.78,true),1.78);
  assert.equal(C.slipScale(3.2,true),3.2);
  assert.equal(C.slipScale(3.2,false),1);
  assert.equal(C.slipScale(NaN,true),1);
});
test('index opening is shared, defaults to the full page, and survives reload',()=>{
  const {openingPreference}=require('./v25/chapters'),storage=events(),pref=openingPreference(storage),received=[];
  const off=pref.subscribe(value=>received.push(value));
  assert.equal(pref.get(),'page');
  assert.equal(pref.set('unsupported'),'page');
  assert.equal(pref.set('float'),'float');
  assert.equal(openingPreference(storage).get(),'float');
  assert.equal(pref.set('float'),'float');
  pref.set('page');off();pref.set('float');
  assert.deepEqual(received,['page','float','page']);
  const blocked=openingPreference({getItem(){throw Error('read');},setItem(){throw Error('write');}});
  assert.equal(blocked.get(),'page');
  assert.equal(blocked.set('float'),'float');
});
test('the canonical reader resolves by address, not print bytes or split fragments',()=>{
  const locs=[{page:10,ref:'2:1'},{page:9,ref:'1:31'},{page:10,ref:'1:31'}];
  const [a,b]=library.from(locs,true),gene=Source.books.find(b=>b.code==='GEN');
  assert.equal(library.groups([a,b]).length,1);
  assert.deepEqual([a.ref,b.ref],['1:31','2:1']);
  const first=gene.chapters[0].verses.find(([n])=>n===31)[1],second=gene.chapters[1].verses[0][1];
  assert.equal(library.quote(locs),first+'\n( 创世记 1:31 和合本 )\n\n'+second+'\n( 创世记 2:1 和合本 )');
  assert.equal(library.groups(library.from([{page:9,ref:'1:29'},{page:10,ref:'2:1'}],true)).length,2);
});
test('the reported Genesis selection uses four chapters and only two intra-chapter omissions',()=>{
  const input=['45:3','44:19','43:28','42:15','44:7','43:16','43:28'].map(ref=>({code:'GEN',ref}));
  const source=Source.books.find(b=>b.code==='GEN');
  const exact=ref=>{
    const [chapter,verse]=ref.split(':').map(Number);
    return source.chapters.find(ch=>ch.chapter===chapter).verses.find(entry=>entry[0]===verse)[1];
  };
  assert.deepEqual(library.quote(input).split('\n\n'),[
    exact('42:15')+'\n( 创世记 42:15 和合本 )',
    exact('43:16')+'...'+exact('43:28')+'\n( 创世记 43:16,28 和合本 )',
    exact('44:7')+'...'+exact('44:19')+'\n( 创世记 44:7,19 和合本 )',
    exact('45:3')+'\n( 创世记 45:3 和合本 )'
  ]);
  const locs=[{code:'GEN',ref:'1:1'},{code:'GEN',ref:'1:2'},{code:'EXO',ref:'1:1'}];
  assert.match(library.quote(locs),/\( 创世记 1:1-2 和合本 \)\n\n[^\n]+\n\( 出埃及记 1:1 和合本 \)$/);
});
test('pin always uses the earliest continuous run in a single chapter',()=>{
  const refs=['43:16','42:16','42:15','42:18'].map(ref=>({code:'GEN',ref}));
  assert.deepEqual(library.pinSelection(refs).map(r=>r.id),['GEN.42:15','GEN.42:16']);
  const continuous=['2:3','2:1','1:31'].map(ref=>({code:'GEN',ref}));
  assert.deepEqual(library.pinSelection(continuous).map(r=>r.id),['GEN.1:31']);
  assert.deepEqual(library.pinSelection([{code:'GEN',ref:'42:15'},{code:'GEN',ref:'43:16'}]).map(r=>r.id),['GEN.42:15']);
  assert.deepEqual(library.pinSelection([{code:'GEN',ref:'42:15'},{code:'GEN',ref:'42:18'}]).map(r=>r.id),['GEN.42:15']);
  const sameChapter=['1:6','1:3','1:4'].map(ref=>({code:'GEN',ref}));
  assert.deepEqual(library.pinSelection(sameChapter).map(r=>r.id),['GEN.1:3','GEN.1:4']);
  assert.match(library.quote(sameChapter),/\( 创世记 1:3-4,6 和合本 \)$/);
});
test('cross-book pin stops at the boundary; copy still keeps both books',()=>{
  const picks=[{code:'LEV',ref:'1:1'},{code:'EXO',ref:'40:38'},{code:'EXO',ref:'40:37'}];
  assert.deepEqual(library.pinSelection(picks).map(r=>r.id),['EXO.40:37','EXO.40:38']);
  const refs=library.quote(picks).split('\n\n').map(part=>part.split('\n').at(-1));
  assert.deepEqual(refs,['( 出埃及记 40:37-38 和合本 )','( 利未记 1:1 和合本 )']);
});
test('a combined range uses its one real body; direct search by an alias finds it too',()=>{
  const a=library.resolve({code:'GEN',ref:'24:29-30'})[0];
  assert.equal(a,library.resolve({code:'GEN',ref:'24:30'})[0]);
  assert.equal(a.display,'24:29–30');
  assert.equal(library.quote([{code:'GEN',ref:'24:30'}]),a.text+'\n( 创世记 24:29-30 和合本 )');
  const search=find(Source,db.lookup,library);
  assert.equal(search('创 24:30')[0].text,a.text);
});
test('library supplies verse paragraphs, short titles and noncontiguous citation groups',()=>{
  const a=library.resolve({code:'GEN',ref:'1:1'})[0];
  assert.deepEqual(a.titles,['神的创造']);assert.equal(a.paragraph,true);
  const note=Passages.byOrdinal(958,1);
  const groups=library.groups(library.from(Passages.resolve(note.citation,Source)));
  assert.deepEqual(groups.map(g=>g[0].code),['EXO','LEV','DEU']);
  const g=library.index('GEN');
  assert.equal(g.chunks.length,50);
  assert.ok(g.chunks[1].rows.every(r=>r.ch===2&&r.code==='GEN'));
  assert.ok(new Set(g.chunks[2].rows.map(r=>r.page)).size>1,'one chapter may cover multiple printed pages');
  assert.equal(library.index('JUD').chunks.length,1);
});
test('citation choices preserve the printed distinction between separate verses and a range',()=>{
  const split=s=>Passages.resolveParts(s,Source).map(part=>part.map(v=>v.code+'.'+v.chapter+':'+v.verse));
  assert.deepEqual(split('创 1:1、2'),[['GEN.1:1'],['GEN.1:2']]);
  assert.deepEqual(split('赛62:10–11；亚9:9。'),[['ISA.62:10','ISA.62:11'],['ZEC.9:9']]);
  assert.deepEqual(split('创1:1；2'),[]);
});
test('continuous scrolling keeps neighboring chunks and evicts only the far side',()=>{
  assert.deepEqual(C.windowRange(0,0,-1,4),{lo:0,hi:0});
  assert.deepEqual(C.windowRange(0,0,1,4),{lo:0,hi:1});
  assert.deepEqual(C.windowRange(0,1,1,4),{lo:0,hi:2});
  assert.deepEqual(C.windowRange(0,2,1,4),{lo:1,hi:3});
  assert.deepEqual(C.windowRange(1,3,-1,4),{lo:0,hi:2});
  assert.deepEqual(C.windowRange(2,4,1,4),{lo:2,hi:4});
});
test('cross-page copy stitches the selected split verse only once in canonical order',()=>{
  const first=db.lookup('ACT','7:56'),last=first+1;load(first);load(last);
  function face(index,groups){
    const page=db.pages[index],bookName=db.books[page.b].name;
    const {units}=S.indexFace(page,db.get(index)[3].map((w,j)=>({...db.tags(index)[j],text:w[4],physicalInk:true})));
    return {page,index,bookName,units,selected:new Map(units.filter(u=>groups.includes(u.group)).map(u=>[u.id,u]))};
  }
  const a=face(first,['verse:7:55','verse:7:56']),b=face(last,['verse:7:56']);
  const quote=S.pagesClipboardQuote([b,a],db);
  assert.equal(quote,S.physicalClipboardQuote([...a.selected.values()],a.bookName,a.units,db,first));
  assert.match(quote,/7:55-56/);
});
test('a reading trail follows committed turns; jumps reuse only unpinned chapter records',()=>{
  const storage=events(),model=H.createModel({storage,pageCount:1272,byChapter:true,books:db.books});
  const kings=(chapter,page)=>({bookCode:'1KI',bookName:'列王纪上',ref:chapter+':1',page});
  const pinned=model.jump(kings(15,100));model.pin(pinned.id,true);
  for(let chapter=16;chapter<=20;chapter++){
    const next=model.advance(kings(chapter,100+chapter));
    assert.equal(next.id,pinned.id);
    assert.equal(next.anchor.ref,chapter+':1');
  }
  assert.equal(model.list().length,1);
  model.jump(genesis('22:1',55));
  const other=model.jump(kings(20,120));
  assert.notEqual(other.id,pinned.id);
  assert.deepEqual(model.list().filter(r=>r.bookCode==='1KI').map(r=>r.id),[pinned.id,other.id]);
  const genesis22=model.jump(genesis('22:1',55));
  model.jump(kings(18,118));
  assert.equal(model.jump(genesis('22:8',56)).id,genesis22.id);
  assert.equal(model.list().filter(r=>r.bookCode==='GEN'&&r.ref.startsWith('22:')).length,1);
  assert.equal(model.jump(kings(20,120),pinned.id).id,pinned.id);
  assert.equal(model.jump(kings(20,120)).id,other.id);
  assert.equal(model.current(),other.id);
  assert.equal(model.visitFloat(genesis('22:9',56)).id,genesis22.id);
  assert.equal(model.current(),other.id);
  const restored=H.createModel({storage,pageCount:1272,byChapter:true,books:db.books});
  restored.start(kings(20,120));
  assert.equal(restored.current(),other.id);
  assert.equal(restored.get(pinned.id).pinned,true);
  assert.ok(storage.getItem(H.COMPARE_KEY));assert.equal(storage.getItem(H.KEY),null);
});
test('import preserves every physical record, including pinned and ordinary copies at one chapter',()=>{
  const storage=events(),old=H.createModel({storage,pageCount:1272});
  const one=old.jump(genesis('1:1',9));old.pin(one.id,true);const recent=old.jump(genesis('1:3',9));
  const before=storage.getItem(H.KEY);
  const model=H.createModel({storage,pageCount:1272,byChapter:true,books:db.books});
  assert.deepEqual(model.list().map(e=>e.id),[one.id,recent.id]);
  assert.equal(model.list()[0].pinned,true);
  assert.equal(model.list()[1].pinned,false);
  assert.equal(model.jump(genesis('1:9',9)).id,recent.id);
  assert.equal(storage.getItem(H.KEY),before);
});
test('overlapping ordinary bookmarks survive reload; a deliberate jump reactivates the recent copy',()=>{
  const storage=events(),model=H.createModel({storage,pageCount:1272,byChapter:true,books:db.books});
  model.jump(genesis('21:1',50));
  const first=model.jump(genesis('22:1',55));
  model.jump(genesis('20:1',45));
  model.advance(genesis('22:9',56));
  const copy=model.get(model.current());
  assert.notEqual(copy.id,first.id);
  assert.equal(model.list().filter(r=>r.ref.startsWith('22:')).length,2);
  const reopened=H.createModel({storage,pageCount:1272,byChapter:true,books:db.books});
  assert.equal(reopened.list().filter(r=>r.ref.startsWith('22:')).length,2);
  assert.equal(reopened.jump(genesis('22:2',55)).id,copy.id);
  assert.equal(reopened.jump(genesis('22:1',55),first.id).id,first.id);
});
