'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const E=require('./paper-edition.js'),script=fs.readFileSync(__dirname+'/rule-reader-bootstrap.js','utf8');
function setup({missing,fail,denied=false}={}){
  const message={textContent:''},panel={setAttribute(k,v){this[k]=v;},querySelector(){return message;}};
  const document={documentElement:{dataset:{requiresRules:'true'}},getElementById:()=>panel};
  const old={books:[{name:'创世记'}],pages:[{}, {b:0,start:'1:1'}]};
  const data={edition:'rules-1',books:[{name:'创世记',code:'GEN',first:1,last:1}],pages:[{}, {b:0,start:'1:1',end:'1:31'}]};
  const window={BIBLE_DATA:old,BIBLE_SOURCE:{},PaperLayout:{paginate(){if(fail)throw Error('bad data');return data;}},PaperEdition:E};
  if(denied)Object.defineProperty(window,'localStorage',{get(){throw Error('denied');}});
  if(missing)delete window[missing];
  vm.runInNewContext(script,{window,document,URL,location:{href:'https://example.test/?ref=GEN.1:1'},performance:{now:()=>1},console:{error(){}}});
  return {window,document,old,data,panel,message};
}
for(const missing of ['BIBLE_DATA','BIBLE_SOURCE','PaperLayout','PaperEdition']){
  const r=setup({missing});assert.equal(r.document.documentElement.dataset.ruleLayout,'unavailable');assert.equal(r.panel.role,'alert');assert.ok(r.message.textContent.includes('未能完整载入'));
}
const failed=setup({fail:true});assert.equal(failed.window.BIBLE_DATA,failed.old);assert.equal(failed.window.PAPER_READER_ERROR,true);
const ok=setup({denied:true});assert.equal(ok.document.documentElement.dataset.ruleLayout,'ready');assert.equal(ok.window.BIBLE_DATA,ok.data);assert.equal(ok.window.PAPER_INITIAL_SPREAD,0);
ok.window.PAPER_READER_STORAGE.setItem('paper-bible-position-v1','test');assert.equal(ok.window.PAPER_READER_STORAGE.getItem('paper-bible-position-v1'),'test');
assert.match(fs.readFileSync(__dirname+'/app.js','utf8'),/requiresRules==='true'.*ruleLayout!=='ready'/,'app also blocks when bootstrap itself fails to load');
console.log('PASS required-resource failures, pagination failure, denied storage isolation, deep link, missing-bootstrap guard');
