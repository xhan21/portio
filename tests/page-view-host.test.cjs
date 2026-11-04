const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PageViewHost } = require('../src/page-view-host.cjs');
const bounds = { x: 224, y: 96, width: 800, height: 600 };
function fixture() {
  const parent = { children: [], adds: 0, removes: 0,
    addChildView(view) { this.children.push(view); this.adds++; },
    removeChildView(view) { this.children = this.children.filter(v => v !== view); this.removes++; }
  };
  const view = () => ({ visible: false, boundsCalls: 0, webContents: { input: 'unsaved', cookie: 'synthetic' },
    setVisible(value) { this.visible = value; }, setBounds(value) { this.bounds = value; this.boundsCalls++; }
  });
  return { parent, host: new PageViewHost(() => parent), a: view(), b: view() };
}
test('only the selected page is attached while detached pages preserve their contents', () => {
  const f = fixture(), original = f.a.webContents;
  f.host.show(f.a, bounds); f.host.show(f.b, bounds);
  assert.deepEqual(f.parent.children, [f.b]); assert.equal(f.a.visible, false);
  assert.equal(f.a.webContents, original); assert.equal(original.input, 'unsaved');
  f.host.show(null, bounds); assert.deepEqual(f.parent.children, []);
  f.host.show(f.a, bounds); assert.deepEqual(f.parent.children, [f.a]); assert.equal(f.a.webContents, original);
});
test('background updates do not detach, reattach, resize or cover a visible popup', () => {
  const f = fixture(), popup = {};
  f.host.show(f.a, bounds); f.parent.addChildView(popup);
  for (let i = 0; i < 20; i++) f.host.show(f.a, { ...bounds });
  assert.deepEqual(f.parent.children, [f.a, popup]); assert.equal(f.parent.adds, 2); assert.equal(f.parent.removes, 0); assert.equal(f.a.boundsCalls, 1);
  f.host.show(f.a, { ...bounds, width: 900 }); assert.equal(f.a.boundsCalls, 2); assert.deepEqual(f.parent.children, [f.a, popup]);
});
test('destroying a page releases its view without touching destroyed contents', () => {
  const f = fixture(); f.host.show(f.a, bounds);
  f.host.forget(f.b); assert.equal(f.host.current, f.a);
  f.a.setVisible = () => { throw Error('destroyed'); };
  f.host.forget(f.a); assert.equal(f.host.current, null); assert.deepEqual(f.parent.children, []);
  f.host.show(f.b, bounds); assert.deepEqual(f.parent.children, [f.b]);
});
