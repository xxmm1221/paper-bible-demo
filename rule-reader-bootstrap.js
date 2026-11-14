/* Shared rule-edition startup. Never silently render old pages as a new edition. */
(() => {
  'use strict';
  try {
    if(!window.BIBLE_DATA||!window.BIBLE_SOURCE||!window.PaperLayout||!window.PaperEdition)throw new Error('Required reader resource is missing');
    const legacy=window.BIBLE_DATA,started=performance.now();
    const data=window.PaperLayout.paginate(window.BIBLE_SOURCE);
    let storage;try{storage=window.localStorage;}catch(_){}
    // A denied store still uses the edition's own in-memory namespace.
    window.PAPER_READER_STORAGE=window.PaperEdition.storageFor(storage,legacy,data);
    const requested=new URL(location.href).searchParams.get('ref');
    if(requested){
      const m=/^([A-Z0-9]{3})\.(\d+):(\d+)$/.exec(requested);
      const page=m&&window.PaperEdition.locate(data,m[1],`${m[2]}:${m[3]}`);
      if(Number.isInteger(page))window.PAPER_INITIAL_SPREAD=page&~1;
    }
    window.BIBLE_DATA=data;
    window.PAPER_RULE_LAYOUT={edition:data.edition,pages:data.pages.length,durationMs:performance.now()-started};
    document.documentElement.dataset.ruleLayout='ready';
  } catch(error) {
    window.PAPER_READER_ERROR=true;
    document.documentElement.dataset.ruleLayout='unavailable';
    const panel=document.getElementById('reader-rule-loading');
    if(panel){panel.setAttribute('role','alert');panel.querySelector('p').textContent='新版阅读资料未能完整载入，请检查网络后重试。未改动你的阅读位置和书签。';}
    console.error('Rule reader failed to initialize:',error);
  }
})();
