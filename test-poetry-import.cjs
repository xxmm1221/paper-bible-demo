/* Independent regression gate: semantic poetry may change, canonical scripture may not. */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const source = require(path.resolve(__dirname, process.argv[2] || 'data/bible-source.js'));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const verses = source.books.flatMap(b => b.chapters.flatMap(c => c.verses.map(([v,t]) => [b.code,c.chapter,v,t])));
const titles = source.books.flatMap(b => b.chapters.flatMap(c => (c.titles || []).map(x => [b.code,c.chapter,...x])));
const body = verses.map(v => v[3]).join('');
assert.equal(source.books.length,66);
assert.equal(source.books.reduce((n,b) => n+b.chapters.length,0),1189);
assert.equal(verses.length,31102);
assert.equal([...body].length,1073197);
assert.equal([...body].filter(c => c === '　').length,4115);
assert.equal(sha(body),'c58c99e4d877c5fb7ce06d2312f615f6a3198e91ea3184e2b0b5c53fadde01a3','poetry must not replace, add or delete any scripture character');
assert.equal(sha(JSON.stringify(verses)),'45fa20ad3cfc5accb2ae7f5c060731edf86bd0708fef618a989144041688fd34','book, chapter, verse order and canonical strings must stay exact');
assert.equal(titles.length,2652);
assert.equal(sha(JSON.stringify(titles)),'4efd66abe480d9408ea19df7193790e7a7f56c4998075e8385d5d014d4b49225','section headings must not change');

// Independently counted from all original EPUB div.q nodes, not from imported output.
const expected = {REV:138,'1TI':7,'1SA':44,'2TI':5,PRO:1866,HOS:587,MRK:32,MAT:104,ZEP:174,JDG:108,ECC:137,ISA:3779,DEU:241,JAS:2,SNG:379,JOL:218,LAM:434,EXO:47,HAB:173,JER:2045,DAN:57,HEB:86,'2CH':18,ACT:86,JOB:2092,'1CH':67,NEH:1,NUM:104,'2PE':3,'1KI':8,JHN:13,ROM:79,JON:27,'1CO':14,JOS:6,GEN:140,EPH:5,'2SA':158,AMO:395,EZR:2,PSA:5412,'1JN':14,EZK:327,GAL:3,LUK:116,'2KI':28,PHP:15,ZEC:140,'1PE':24,'2CO':14,NAM:149,MIC:375,OBA:80};
const allLines = new Set();
let annotatedVerses=0,poetrySegments=0,poetryBooks=0;
for(const book of source.books){
  const lines=new Set();
  let previousLine=null;
  for(const chapter of book.chapters){
    const original=new Map(chapter.verses), seenVerses=new Set();
    for(const item of chapter.poetry || []){
      annotatedVerses++;
      assert(!seenVerses.has(item.verse),`${book.code}.${chapter.chapter}:${item.verse}: duplicate annotations`);
      seenVerses.add(item.verse);
      assert(original.has(item.verse),'annotation must reference an existing canonical verse');
      assert(Array.isArray(item.segments) && item.segments.length>0);
      assert.equal(item.segments.map(s=>s.text).join(''),original.get(item.verse),`${book.code}.${chapter.chapter}:${item.verse}: semantic slices must reconstruct exact original text`);
      assert(item.segments.some(s=>s.kind==='poetry'),'only verses touched by poetry need annotations');
      // Textual notes contain repeated body words that must not attract a
      // false alignment anchor. Parenthesized scripture, unlike editorial
      // "original text/or translated" notes, may legitimately span q lines.
      const exactText=original.get(item.verse), noteSpans=[];
      for(const match of exactText.matchAll(/（[^（）]*(?:原文|或作)[^（）]*）/gu))
        noteSpans.push([match.index,match.index+match[0].length]);
      let boundary=0;
      for(const segment of item.segments.slice(0,-1)){
        boundary+=segment.text.length;
        assert(!noteSpans.some(([start,end])=>start<boundary&&boundary<end),`${book.code}.${chapter.chapter}:${item.verse}: never split a source note using repeated words as body anchors`);
      }
      for(const seg of item.segments){
        assert(['prose','poetry'].includes(seg.kind));
        assert.equal(typeof seg.text,'string');
        assert(seg.text.length>0,'no empty semantic segments');
        if(seg.kind==='poetry'){
          poetrySegments++;
          assert.equal(typeof seg.line,'string');
          assert(seg.line.length>0);
          assert(/[\u3400-\u9fffA-Za-z]/u.test(seg.text),'a mapped poetic line must contain words, not merely a placeholder/punctuation');
          if(lines.has(seg.line)) assert.equal(previousLine,seg.line,'shared source q must remain contiguous, never reappear elsewhere');
          else assert(!allLines.has(seg.line),'line identifiers must be globally unique across books');
          lines.add(seg.line);allLines.add(seg.line);previousLine=seg.line;
        }else previousLine=null;
      }
    }
  }
  assert.equal(lines.size,expected[book.code] || 0,`${book.code}: restore every available source q, not a few hand-picked verses`);
  if(lines.size)poetryBooks++;
}
assert.equal(poetryBooks,53);
assert.equal(allLines.size,20578);
const ch=(code,n)=>source.books.find(b=>b.code===code).chapters.find(c=>c.chapter===n);
const entry=(code,n,v)=>ch(code,n).poetry.find(x=>x.verse===v);
const poem=(code,n,v)=>entry(code,n,v).segments.filter(s=>s.kind==='poetry');
const words=s=>s.replace(/[^\u3400-\u9fffA-Za-z0-9]/gu,'');
assert.equal(entry('GEN',2,23).segments[0].kind,'prose','Adam speech introduction remains prose');
assert.equal(words(entry('GEN',2,23).segments[0].text),'那人说');
assert.deepEqual(poem('GEN',2,23).map(s=>words(s.text)),['这是我骨中的骨','肉中的肉','可以称她为女人','因为她是从男人身上取出来的']);
assert.deepEqual(poem('GEN',3,14).map(s=>words(s.text)),['耶和华神对蛇说','你既作了这事就必受咒诅','比一切的牲畜野兽更甚','你必用肚子行走','终身吃土']);
assert.deepEqual(poem('GEN',3,15).map(s=>words(s.text)),['我又要叫你和女人彼此为仇','你的后裔和女人的后裔也彼此为仇','女人的后裔要伤你的头','你要伤他的脚跟']);
assert.deepEqual(poem('GEN',3,16).map(s=>words(s.text)),['又对女人说','我必多多加增你怀胎的苦楚','你生产儿女必多受苦楚','你必恋慕你丈夫','你丈夫必管辖你']);
assert.equal(entry('PSA',23,1).segments[0].kind,'prose','the canonical psalm superscription must not become an invented poetic line');
assert.equal(entry('PSA',23,1).segments[0].text,'（大卫的诗。）');
assert.deepEqual(ch('PSA',23).poetry.flatMap(e=>e.segments.filter(s=>s.kind==='poetry').map(s=>words(s.text))),[
  '耶和华是我的牧者','我必不至缺乏','他使我躺卧在青草地上','领我在可安歇的水边','他使我的灵魂苏醒','为自己的名引导我走义路',
  '我虽然行过死荫的幽谷','也不怕遭害','因为你与我同在','你的杖你的竿都安慰我','在我敌人面前你为我摆设筵席','你用油膏了我的头使我的福杯满溢','我一生一世必有恩惠慈爱随着我','我且要住在耶和华的殿中直到永远'
]);
assert.equal(poem('PSA',87,1).at(-1).line,poem('PSA',87,2)[0].line,'PSA 87:1–2 share one original q, preserve its continuity');
assert.equal(poem('EZK',28,20)[0].line,poem('EZK',28,21)[0].line);
assert.equal(poem('EZK',28,21)[0].line,poem('EZK',28,22)[0].line,'EZK 28:20–22 share one original q');
assert.deepEqual(ch('PSA',8).verses.filter(v=>[7,8].includes(v[0])),[[7,'-'],[8,'-']],'merged-verse placeholders remain exactly as in canonical source');
assert(!ch('PSA',8).poetry.some(v=>[7,8].includes(v.verse)),'do not map poetry onto placeholder-only verses');
assert.equal(poem('ISA',26,19)[1].text,'尸首（原文作“我的尸首”）要兴起。','align to body 尸首, not repeated 尸首 inside the inline note');
assert.equal(poem('JOB',8,9).length,2,'genuine parenthesized scripture is still poetry, not a textual note');
console.log(JSON.stringify({passed:true,books:66,poetryBooks,poeticLines:allLines.size,annotatedVerses,poetrySegments,bodyCharacters:[...body].length,bodySha256:sha(body),samples:['GEN 2:23','GEN 3:14–16','PSA 23','PSA 87:1–2','EZK 28:20–22','PSA 8:6–8','ISA 26:19','JOB 8:9']}));
