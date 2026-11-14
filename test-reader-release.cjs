const assert=require('node:assert/strict');
const fs=require('node:fs');
const Release=require('./reader-release.js');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
assert.match(html,new RegExp('data-reader-build="'+Release.VERSION+'"'));
assert.match(html,new RegExp('排版版本 · '+Release.VERSION));
let assets=0;
for(const match of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css)(?:\?[^"#]*)?)"/g)){
  const url=new URL(match[1],'https://example.test/paper-bible-demo/');
  assert.equal(url.searchParams.get('v'),Release.VERSION,'mixed-release asset: '+match[1]);
  assets++;
}
assert.ok(assets>=15,'check all local scripts and styles');
const before='https://example.test/paper-bible-demo/?v=type-1&paperRenderer=canvas&_refresh=old#reading';
const after=new URL(Release.refreshURL(before,12345));
assert.equal(after.origin,'https://example.test');
assert.equal(after.pathname,'/paper-bible-demo/');
assert.equal(after.searchParams.get('v'),Release.VERSION);
assert.equal(after.searchParams.get('_refresh'),'12345');
assert.equal(after.searchParams.get('paperRenderer'),'canvas');
assert.equal(after.hash,'#reading');
let click;
const link={href:'untouched',addEventListener:(type,handler)=>{assert.equal(type,'click');click=handler;}};
Release.init({getElementById:id=>{assert.equal(id,'reader-reload');return link;}},{href:before});
assert.equal(link.href,'untouched','initialisation must not trigger a reload');
click();
assert.equal(new URL(link.href).searchParams.get('v'),Release.VERSION);
assert.notEqual(new URL(link.href).searchParams.get('_refresh'),'old');
console.log('PASS release identity, '+assets+' versioned assets, explicit fresh entry, preserved renderer URL');
