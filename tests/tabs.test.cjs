const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconcileTabs } = require('../src/ui/tabs.js');
function fixture() {
  const doc = { activeElement: null, moves: 0, writes: 0, createElement() {
    return { ownerDocument: doc, children: [], dataset: {}, attributes: {}, parent: null, textContent: '',
      classList: { toggle() {} },
      getAttribute(key) { return this.attributes[key] ?? null; },
      setAttribute(key, value) { this.attributes[key] = value; doc.writes++; },
      append(...nodes) { for (const node of nodes) this.insertBefore(node, null); },
      insertBefore(node, before) { node.remove(); const i = before ? this.children.indexOf(before) : this.children.length; this.children.splice(i, 0, node); node.parent = this; doc.moves++; },
      remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; if (doc.activeElement === this) doc.activeElement = null; } },
      focus() { doc.activeElement = this; }
    };
  } };
  const container = doc.createElement(), actions = [];
  return { doc, container, actions, draw: data => reconcileTabs(container, data, (...args) => actions.push(args)) };
}
const a = { id: '1', title: 'Page A', loading: false, selected: true };
const b = { id: '2', title: 'Page B', loading: false, selected: false };
test('loading, title and selection updates preserve button identity, focus and click targets', () => {
  const f = fixture(); f.draw([a, b]); const [first, second] = f.container.children, choose = first.children[0], close = first.children[1];
  choose.focus(); const moves = f.doc.moves;
  f.draw([{ ...a, loading: true, title: 'Loading A', selected: false }, { ...b, selected: true }]);
  assert.equal(f.container.children[0], first); assert.equal(first.children[0], choose); assert.equal(first.children[1], close);
  assert.equal(f.doc.activeElement, choose); assert.equal(f.doc.moves, moves); assert.equal(choose.textContent, '◌ Loading A');
  assert.equal(choose.getAttribute('aria-selected'), 'false'); assert.equal(second.children[0].getAttribute('aria-selected'), 'true');
  choose.onclick(); close.onclick(); assert.deepEqual(f.actions, [['select', '1'], ['close', '1']]);
});
test('unchanged updates leave the tab tree and accessible attributes untouched', () => {
  const f = fixture(); f.draw([a, b]); const moves = f.doc.moves, writes = f.doc.writes;
  for (let i = 0; i < 20; i++) f.draw([{ ...a }, { ...b }]);
  assert.equal(f.doc.moves, moves); assert.equal(f.doc.writes, writes);
});
test('reorder, close, add and space changes keep the surviving tabs and correct actions', () => {
  const f = fixture(); f.draw([a, b]); const [first, second] = f.container.children;
  f.draw([b, a]); assert.deepEqual(f.container.children, [second, first]);
  const c = { id: '3', title: 'University', loading: false, selected: true };
  f.draw([a, c]); assert.equal(f.container.children[0], first); assert.equal(second.parent, null);
  const campus = f.container.children[1]; f.draw([c]); assert.deepEqual(f.container.children, [campus]);
  campus.children[0].onclick(); assert.deepEqual(f.actions, [['select', '3']]);
});
