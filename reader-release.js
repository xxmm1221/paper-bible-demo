/* Explicit refresh only: never interrupt reading or erase the saved paper position. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else api.init(root.document,root.location);
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const VERSION='rules-2';
  function refreshURL(href,nonce){
    const url=new URL(href);
    url.searchParams.set('v',VERSION);
    url.searchParams.set('_refresh',String(nonce));
    return url.href;
  }
  function init(document,location){
    const link=document.getElementById('reader-reload');
    // A unique entry URL obtains fresh HTML; its versioned scripts/styles then
    // load as one release. Keep renderer options, hash and localStorage intact.
    link?.addEventListener('click',()=>{
      link.href=refreshURL(location.href,Date.now());
    });
  }
  return {VERSION,refreshURL,init};
});
