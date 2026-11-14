/* Keep experimental pagination separate from the released reader's bookmarks.
 * Migration follows scripture anchors, never an old physical page number.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PaperEdition=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const POSITION='paper-bible-position-v1';
  // Pagination changes when semantic poetry is restored. Prefer the latest
  // published edition's scripture anchor, never reinterpret its page number.
  const PREVIOUS_EDITIONS={'rules-2':['rules-1']};
  const reference=value=>{const m=/^(\d+):(\d+)/.exec(String(value||''));return m?[Number(m[1]),Number(m[2])]:null;};
  const order=ref=>ref[0]*1000+ref[1];
  function locate(data,bookName,ref){
    const book=data.books.find(b=>b.name===bookName||b.code===bookName),target=reference(ref);
    if(!book||!target)return null;
    let fallback=null;
    for(let i=book.first;i<=book.last;i++){
      const p=data.pages[i];if(p.b<0||data.books[p.b]!==book)continue;
      const start=reference(p.start),end=reference(p.end);
      if(!start||!end)continue;
      if(order(start)<=order(target)&&order(target)<=order(end))return i;
      if(order(start)<=order(target))fallback=i;
    }
    return fallback;
  }
  function migratePosition(value,legacy,data){
    if(!value||!Number.isInteger(value.spread))return null;
    const right=legacy?.pages?.[value.spread+1],left=legacy?.pages?.[value.spread];
    const oldPage=right?.start?right:left,oldBook=legacy?.books?.[oldPage?.b];
    const bookName=value.bookName||oldBook?.name,ref=value.ref||oldPage?.start;
    const page=locate(data,bookName,ref);
    if(page===null)return null;
    // A newly typeset page need not share the old on-page zoom location.
    return {spread:page&~1,zoom:1,focus:'fit',bookName,ref,edition:data.edition};
  }
  function migrateRibbon(value,data){
    if(!value||value.version!==1)return null;
    const page=locate(data,value.bookName,value.ref);
    if(page===null)return null;
    return {version:1,page,spread:page&~1,bookName:value.bookName,ref:value.ref};
  }
  function storageFor(storage,legacy,data){
    const suffix=':'+String(data.edition),cache=new Map();
    return {
      getItem(key){
        try{
          const stored=storage?.getItem(key+suffix);
          if(stored!==null&&stored!==undefined)return stored;
          if(cache.has(key))return cache.get(key);
          for(const edition of PREVIOUS_EDITIONS[data.edition]||[]){
            const previous=storage?.getItem(key+':'+edition);
            if(previous===null||previous===undefined)continue;
            const old=JSON.parse(previous);
            // A deletion in a newer edition must not resurrect a legacy ribbon.
            const migrated=key===POSITION
              ?(old?.bookName&&old?.ref?migratePosition(old,null,data):null)
              :/^paper-bible-ribbon-v1-[01]$/.test(key)?migrateRibbon(old,data):null;
            const result=migrated?JSON.stringify(migrated):'null';
            cache.set(key,result);return result;
          }
          const old=JSON.parse(storage?.getItem(key)||'null');
          const migrated=key===POSITION?migratePosition(old,legacy,data):/^paper-bible-ribbon-v1-[01]$/.test(key)?migrateRibbon(old,data):null;
          const result=migrated?JSON.stringify(migrated):null;cache.set(key,result);return result;
        }catch(_){return null;}
      },
      setItem(key,value){cache.set(key,value);storage?.setItem(key+suffix,value);},
      removeItem(key){
        // A tombstone prevents an explicitly removed ribbon reappearing from
        // the legacy slot on the next visit. The legacy slot is never touched.
        cache.set(key,'null');storage?.setItem(key+suffix,'null');
      }
    };
  }
  return {locate,migratePosition,migrateRibbon,storageFor,POSITION};
});
