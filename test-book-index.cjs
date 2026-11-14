/* Geometry / persistent DOM / scroll-continuity tests. Browser visual checks are separate. */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const Index = require('./book-index.js');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(__dirname + '/bible-data.js', 'utf8'), context);
const books = context.window.BIBLE_DATA.books;
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function fixture() {
  const nodes = [];
  const doc = { createElement(tag) { const node = new Element(tag); nodes.push(node); return node; } };
  class Element {
    constructor(tag) {
      this.tagName = tag; this.ownerDocument = doc; this.children = []; this.attrs = {};
      this.style = { setProperty(k,v) { this[k] = v; } }; this.dataset = {}; this.handlers = {}; this.listenerOptions = {};
      this.scrollTop = 0; this.classes = new Set();
      this.classList = { add: n => this.classes.add(n), remove: n => this.classes.delete(n),
        toggle: (n, value) => value ? this.classes.add(n) : this.classes.delete(n) };
    }
    appendChild(n) { this.children.push(n); n.parent = this; }
    setAttribute(k,v) { this.attrs[k] = v; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(k,fn,opts) { this.handlers[k] = fn; this.listenerOptions[k] = opts; }
    removeEventListener(k,fn) { if (this.handlers[k] === fn) { delete this.handlers[k]; delete this.listenerOptions[k]; } }
    getBoundingClientRect() {
      let scroll = 0;
      for (let p = this.parent; p; p = p.parent) scroll += p.scrollTop || 0;
      // A mobile camera projection, deliberately different from logical coords.
      const scale = .68, left = 27 + (parseFloat(this.style.left) || 0) * scale;
      const top = 83 + ((parseFloat(this.style.top) || 0) - scroll) * scale;
      const width = (parseFloat(this.style.width) || 0) * scale;
      const height = (parseFloat(this.style.height) || 0) * scale;
      return { left, top, width, height, right: left + width, bottom: top + height };
    }
    remove() { this.parent.children = this.parent.children.filter(n => n !== this); }
  }
  const host = doc.createElement('div'), selections = [], views = [];
  const index = Index.create({ host, books, onSelect: i => selections.push(i), onViewChange: v => views.push(v) });
  const root = nodes.find(n => n.className === 'pbi-root');
  function clickAt(target, clientX, clientY, detail = 1) {
    const event = { target, clientX, clientY, detail, defaultPrevented: false, stopped: false, immediateStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; this.immediateStopped = true; } };
    assert.equal(root.listenerOptions.click, true, 'geometry correction must run in capture phase');
    root.handlers.click(event);
    if (!event.stopped && target.handlers.click) target.handlers.click(event);
    return event;
  }
  return { host, nodes, selections, views, index, root, clickAt, buttons: nodes.filter(n => n.tagName === 'button'),
    sheet: nodes.find(n => n.className === 'pbi-sheet'), scroll: nodes.find(n => n.className === 'pbi-scroll') };
}
test('66 canonical books occupy exactly 22 three-book thumb cuts', () => {
  const groups = Index.groupBooks(books);
  assert.equal(groups.length, 22);
  assert.deepEqual(groups.flatMap(g => g.indices), Array.from({length: 66}, (_, i) => i));
  assert.equal(groups.filter(g => g.testament === 'old').length, 13);
  assert.equal(groups.filter(g => g.testament === 'new').length, 9);
});
test('physical cuts and labels fit the fixed 480 by 704 surface', () => {
  const model = Index.geometry(books);
  for (const rect of [...model.groups, ...model.slots.map(s => s.physical)]) {
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= 480 && rect.y + rect.height <= 704);
  }
  for (let i = 0; i < model.groups.length; i++) for (let j = i + 1; j < model.groups.length; j++) {
    const a = model.groups[i], b = model.groups[j];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
      `cuts ${i} and ${j} overlap`);
  }
});
test('digital labels have 64px targets with 70px row pitch and finite interpolation', () => {
  const model = Index.geometry(books);
  for (const slot of model.slots) {
    assert.equal(slot.digital.height, 64);
    assert.ok(slot.digital.width >= 210);
    for (let d = 0; d <= 1; d += .01) for (const v of Object.values(Index.layoutAt(slot,d))) assert.ok(Number.isFinite(v));
    assert.deepEqual(Index.layoutAt(slot,0), slot.physical);
    assert.deepEqual(Index.layoutAt(slot,1), slot.digital);
    assert.equal(slot.digital.x, 23 + (slot.index % 2) * 221);
    assert.equal(slot.digital.y, 91 + Math.floor(slot.index / 2) * 70);
  }
});
test('all 66 live button nodes survive both morph directions and retain callbacks', () => {
  const f = fixture(), initial = f.buttons.slice();
  for (const d of [0,.25,.5,.75,1,.75,.5,.25,0]) f.index.setDigital(d);
  assert.equal(f.nodes.filter(n => n.tagName === 'button').length, 66);
  f.buttons.forEach((button,i) => { assert.equal(button, initial[i]); button.handlers.click({stopPropagation(){}}); });
  assert.deepEqual(f.selections, Array.from({length:66},(_,i)=>i));
});
test('a deeply scrolled digital list retracts its actual scroll progressively, including reversal', () => {
  const f = fixture(); f.index.setDigital(1); f.scroll.scrollTop = 820;
  const first = f.index.setDigital(.99); assert.equal(first.scrollTop, 811.8);
  assert.equal(f.index.setDigital(.5).scrollTop, 410);
  assert.equal(f.index.setDigital(.8).scrollTop, 656);
  assert.equal(f.index.setDigital(1).scrollTop, 820);
  f.index.setDigital(.3); assert.equal(f.scroll.scrollTop, 246);
  f.index.setDigital(0); assert.equal(f.scroll.scrollTop,0);
  f.index.setDigital(1); assert.equal(f.scroll.scrollTop,0);
});
test('focus returns stable physical-centre coordinates, independent of digital state', () => {
  const f = fixture();
  const a = f.index.focusBook(65); f.index.setDigital(1); const b = f.index.focusBook(65);
  assert.deepEqual(a,b); assert.equal(a.index,65); assert.equal(a.width,47); assert.equal(a.height,17);
  assert.equal(f.buttons[65].attrs['aria-current'],'true');
  f.index.clearFocus(); assert.equal(f.buttons[65].attrs['aria-current'],undefined);
  assert.equal(f.index.focusBook(-1),null); assert.equal(f.index.focusBook(66),null);
});
test('root capture resolves a visible physical label when native hit testing returns the sheet', () => {
  const f = fixture(), expected = books.findIndex(book => book.code === 'LUK');
  assert.ok(expected >= 0);
  const r = f.buttons[expected].getBoundingClientRect();
  const event = f.clickAt(f.sheet, r.left + r.width / 2, r.top + r.height / 2);
  assert.deepEqual(f.selections, [expected]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.immediateStopped, true);
  // Empty space must not manufacture a nearest-book selection.
  f.clickAt(f.sheet, -100, -100);
  assert.deepEqual(f.selections, [expected]);
});
test('capture selects the visible scrolled label instead of a wrong native neighbouring button', () => {
  const f = fixture(); f.index.setDigital(1); f.scroll.scrollTop = 1735;
  const r = f.buttons[65].getBoundingClientRect();
  const event = f.clickAt(f.buttons[64], r.left + r.width / 2, r.top + r.height / 2);
  assert.deepEqual(f.selections, [65], 'wrong neighbour must not run a second onSelect');
  assert.equal(event.immediateStopped, true);
  // Keyboard clicks have detail=0 and continue through the intended native button.
  const keyboard = f.clickAt(f.buttons[64], r.left + r.width / 2, r.top + r.height / 2, 0);
  assert.deepEqual(f.selections, [65,64]);
  assert.equal(keyboard.defaultPrevented, false);
  assert.equal(keyboard.immediateStopped, false);
});
test('destroy removes only the owned surface and all attached listeners', () => {
  const f = fixture(); f.index.destroy(); f.index.destroy();
  assert.equal(f.host.children.length,0);
  assert.ok(f.nodes.every(n => Object.keys(n.handlers).length === 0));
});
console.log(JSON.stringify({bookIndexScenarios:checks, books:66, groups:22}));
