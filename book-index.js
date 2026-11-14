/* The fore-edge and its digital expansion are one persistent set of labels.
 * No timers, scene changes or replacement DOM: the parent owns the camera.
 * Logical coordinate space: 480 × 704; x/y returned by focusBook are centres.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PaperBookIndex = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const WIDTH = 480, HEIGHT = 704, ROW = 70;
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, Number(n) || 0));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, t) => { const u = clamp((t - a) / (b - a)); return u * u * (3 - 2 * u); };

  function groupBooks(books) {
    const total = Math.max(1, ...books.map(b => Number(b.last || b.first) || 1));
    const result = [];
    for (let i = 0; i < books.length; i += 3) {
      const g = i / 3, lane = Math.floor(g / 11), row = g % 11;
      const fraction = clamp((Number(books[i].first) || i + 1) / total);
      // A stepped path through the paper block, not an array of book buttons.
      const x = lane === 0 ? 82 + fraction * 208 : 292 + clamp((fraction - .6) / .4) * 98;
      result.push({ index: g, first: i, indices: books.slice(i, i + 3).map((_, n) => i + n),
        testament: i < 39 ? 'old' : 'new', x, y: 29 + row * 59 + lane * 7,
        width: 78, height: 57, fraction });
    }
    return result;
  }

  function geometry(books) {
    const groups = groupBooks(books);
    const slots = books.map((book, i) => {
      const group = groups[Math.floor(i / 3)], slot = i % 3;
      const column = i % 2;
      const row = Math.floor(i / 2);
      return { index: i, group: group.index, testament: i < 39 ? 'old' : 'new',
        physical: { x: group.x + 29, y: group.y + 3 + slot * 17, width: 47, height: 17 },
        digital: { x: 23 + column * 221, y: 91 + row * ROW, width: 212, height: 64 } };
    });
    return { groups, slots, digitalHeight: 91 + Math.ceil(books.length / 2) * ROW + 38 };
  }

  function layoutAt(slot, amount) {
    const d = clamp(amount), a = slot.physical, b = slot.digital;
    return { x: lerp(a.x, b.x, d), y: lerp(a.y, b.y, d),
      width: lerp(a.width, b.width, d), height: lerp(a.height, b.height, d) };
  }

  function create(options) {
    const { host, books, onSelect, onClose, onViewChange } = options;
    if (!host || !host.ownerDocument) throw new TypeError('PaperBookIndex.create requires a DOM host.');
    if (!Array.isArray(books) || !books.length) throw new TypeError('PaperBookIndex.create requires books.');
    const doc = host.ownerDocument, model = geometry(books), disposers = [];
    let digital = 0, progress = 1, focused = -1, scrollAnchor = 0, lastView = 'physical', destroyed = false;

    function el(tag, className, parent, text) {
      const item = doc.createElement(tag); item.className = className;
      if (text != null) item.textContent = text;
      if (parent) parent.appendChild(item);
      return item;
    }
    function listen(node, event, fn, opts) {
      node.addEventListener(event, fn, opts);
      disposers.push(() => node.removeEventListener(event, fn, opts));
    }
    const root = el('div', 'pbi-root', host);
    root.setAttribute('role', 'group'); root.setAttribute('aria-label', '圣经书侧拇指索引');
    const leather = el('div', 'pbi-leather', root);
    const block = el('div', 'pbi-paper-block', root);
    const grain = el('div', 'pbi-grain', block);
    const lowerEdge = el('div', 'pbi-lower-edge', root);
    const marks = el('div', 'pbi-edge-marks', root);
    el('span', 'pbi-edge-mark pbi-edge-mark-old', marks, '旧　约');
    el('span', 'pbi-edge-mark pbi-edge-mark-new', marks, '新　约');
    [leather, block, grain, lowerEdge, marks].forEach(n => n.setAttribute('aria-hidden', 'true'));
    const viewport = el('div', 'pbi-scroll', root);
    const sheet = el('div', 'pbi-sheet', viewport);
    const cuts = model.groups.map(group => {
      const cut = el('div', 'pbi-cut pbi-' + group.testament, sheet);
      cut.style.left = group.x + 'px'; cut.style.top = group.y + 'px';
      cut.setAttribute('aria-hidden', 'true');
      el('div', 'pbi-cut-layers', cut);
      el('div', 'pbi-cut-well', cut);
      const inset = el('div', 'pbi-cut-label', cut);
      el('i', 'pbi-cut-line pbi-cut-line-one', inset);
      el('i', 'pbi-cut-line pbi-cut-line-two', inset);
      return cut;
    });
    const buttons = books.map((book, index) => {
      const button = el('button', 'pbi-book pbi-' + (index < 39 ? 'old' : 'new'), sheet);
      button.type = 'button'; button.dataset.bookIndex = String(index);
      button.setAttribute('aria-label', '打开' + book.name);
      button.title = book.name;
      const abbr = el('span', 'pbi-abbr', button, book.short || book.name.slice(0, 2));
      const name = el('span', 'pbi-name', button, book.name);
      const order = el('span', 'pbi-order', button, String(index + 1).padStart(2, '0'));
      [abbr, name, order].forEach(n => n.setAttribute('aria-hidden', 'true'));
      listen(button, 'click', e => { e.stopPropagation(); if (onSelect) onSelect(index); });
      return { button, abbr, name, order };
    });
    // Some mobile/composited browsers hit the clipped sheet rather than a
    // descendant of a 3D-transformed surface. Resolve the *visible* label bounds
    // on that same surface in capture phase, before a misplaced native target can
    // choose its neighbour. Keyboard activation still uses the native button.
    listen(root, 'click', e => {
      if (e.detail === 0 || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
      let nearest = null, distance = Infinity;
      buttons.forEach(({button}, i) => {
        const r = button.getBoundingClientRect();
        if (e.clientX < r.left - 3 || e.clientX > r.right + 3 || e.clientY < r.top - 3 || e.clientY > r.bottom + 3) return;
        const d = Math.hypot(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
        if (d < distance) { nearest = i; distance = d; }
      });
      if (nearest !== null && onSelect) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); onSelect(nearest); }
    }, true);
    const heading = el('div', 'pbi-heading', root);
    heading.setAttribute('aria-hidden', 'true');
    el('span', 'pbi-heading-kicker', heading, '同一本书 · 同一处索引');
    el('strong', 'pbi-heading-title', heading, '按书卷找回那一页');
    const note = el('div', 'pbi-digital-note', sheet, '旧约墨黑 · 新约朱红　／　上下滑动查看全部书卷');
    note.style.top = (model.digitalHeight - 32) + 'px';
    note.setAttribute('aria-hidden', 'true');

    // Keep reading gestures out of the closed-book surface, without cancelling
    // native scrolling. The parent should allow touch-action: pan-y in this view.
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick', 'contextmenu'].forEach(event =>
      listen(root, event, e => { e.stopPropagation(); if (event === 'contextmenu') e.preventDefault(); }));
    listen(root, 'wheel', e => e.stopPropagation(), { passive: true });
    listen(root, 'keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape' && onClose) { e.preventDefault(); onClose(); }
    });

    function setProgress(value) {
      progress = clamp(value);
      root.style.setProperty('--pbi-present', progress.toFixed(4));
      return progress;
    }

    function setDigital(value) {
      if (destroyed) return { amount: digital, view: lastView, destroyed: true };
      const next = clamp(value);
      // Capture the user's scroll once. Reducing both scrollTop and content
      // height proportionally preserves the first frame and every frame after.
      if (digital === 1 && next < 1) scrollAnchor = viewport.scrollTop;
      if (digital === 0 && next > 0) scrollAnchor = 0;
      digital = next;
      const height = lerp(HEIGHT, model.digitalHeight, digital);
      const labelProgress = smooth(.32, .92, digital);
      root.style.setProperty('--pbi-digital', digital.toFixed(4));
      root.style.setProperty('--pbi-label-progress', labelProgress.toFixed(4));
      root.style.setProperty('--pbi-physical-opacity', (1 - smooth(.03, .46, digital)).toFixed(4));
      root.style.setProperty('--pbi-heading-opacity', smooth(.65, 1, digital).toFixed(4));
      root.classList.toggle('pbi-is-digital', digital === 1);
      root.classList.toggle('pbi-is-morphing', digital > 0 && digital < 1);
      viewport.style.overflowY = digital === 1 ? 'auto' : 'hidden';
      sheet.style.height = height + 'px';
      heading.style.transform = 'translateY(' + ((1 - digital) * -18) + 'px)';
      buttons.forEach((nodes, i) => {
        const box = layoutAt(model.slots[i], digital), style = nodes.button.style;
        // Keep the interactive layer flat inside the rotated, clipped fore-edge.
        // Nested translate3d labels can paint correctly but lose hit testing in Chromium.
        style.left = box.x.toFixed(3) + 'px'; style.top = box.y.toFixed(3) + 'px';
        style.width = box.width.toFixed(3) + 'px'; style.height = box.height.toFixed(3) + 'px';
        nodes.abbr.style.width = lerp(47, 38, digital).toFixed(3) + 'px';
        nodes.abbr.style.height = lerp(17, 35, digital).toFixed(3) + 'px';
        nodes.abbr.style.left = lerp(0, 7, digital).toFixed(3) + 'px';
        nodes.abbr.style.fontSize = lerp(14.3, 16, digital).toFixed(3) + 'px';
        nodes.name.style.opacity = labelProgress.toFixed(4);
        nodes.order.style.opacity = (labelProgress * .65).toFixed(4);
      });
      // CSS overflow:hidden permits programmatic scroll; unlike display:none it
      // never removes the physical object, and maximum scroll shrinks with us.
      if (digital < 1 || scrollAnchor > 0) viewport.scrollTop = scrollAnchor * digital;
      if (digital === 0) scrollAnchor = 0;
      if (digital === 1) scrollAnchor = 0;
      const view = digital === 0 ? 'physical' : digital === 1 ? 'digital' : 'transition';
      if (view !== lastView) { lastView = view; if (onViewChange) onViewChange(view); }
      return { amount: digital, view, scrollTop: viewport.scrollTop, height };
    }

    function clearFocus() {
      if (focused >= 0) {
        buttons[focused].button.classList.remove('pbi-focused');
        buttons[focused].button.removeAttribute('aria-current');
        cuts[model.slots[focused].group].classList.remove('pbi-focused-cut');
      }
      focused = -1;
    }
    function focusBook(index) {
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0 || i >= books.length) return null;
      clearFocus(); focused = i;
      buttons[i].button.classList.add('pbi-focused');
      buttons[i].button.setAttribute('aria-current', 'true');
      const slot = model.slots[i], group = model.groups[slot.group], rect = slot.physical;
      cuts[slot.group].classList.add('pbi-focused-cut');
      return { index: i, group: slot.group, x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2, width: rect.width, height: rect.height,
        left: rect.x, top: rect.y, groupX: group.x, groupY: group.y,
        groupWidth: group.width, groupHeight: group.height, name: books[i].name };
    }
    function resize() { return setDigital(digital); }
    function destroy() { if (destroyed) return; destroyed = true; disposers.forEach(fn => fn()); root.remove(); }

    setProgress(1); setDigital(0);
    return { setProgress, setDigital, focusBook, clearFocus, resize, destroy };
  }
  return { create, groupBooks, geometry, layoutAt, WIDTH, HEIGHT };
});
