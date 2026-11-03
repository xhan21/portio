const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PasswordPopup } = require('../src/password-popup.cjs');
function fixture() {
  let view; const sent = [], chosen = [];
  class View {
    constructor(options) { view = this; this.options = options; this.webContents = { isDestroyed: () => false, setWindowOpenHandler() {}, on() {}, loadFile: async () => {}, send: (...args) => sent.push(args) }; }
    setVisible(value) { this.visible = value; } setBounds(value) { this.bounds = value; }
  }
  const popup = new PasswordPopup({ WebContentsView: View, parent: () => ({ getContentSize: () => [1000, 700], contentView: { addChildView() {} } }) });
  return { popup, sent, chosen, view: () => view, show: () => popup.show({ items: [{ id: 'a', username: 'A', password: 'never-send' }, { id: 'b', username: 'B' }], origin: 'https://example.test', rect: { x: 600, y: 550, height: 35 }, viewBounds: { x: 224, y: 96 }, onChoose: id => chosen.push(id) }) };
}
test('suggestions use an isolated local view, exclude passwords, and fit inside the parent', async () => {
  const f = fixture(); await f.show();
  assert.equal(f.view().options.webPreferences.sandbox, true); assert.equal(f.view().options.webPreferences.contextIsolation, true); assert.equal(f.view().options.webPreferences.nodeIntegration, false);
  assert.equal(f.view().visible, true); assert.equal(JSON.stringify(f.sent).includes('never-send'), false);
  const b = f.view().bounds; assert.ok(b.x + b.width <= 1000); assert.ok(b.y + b.height <= 700);
  f.popup.key({ type: 'keyDown', key: 'ArrowUp' }); f.popup.key({ type: 'keyDown', key: 'Enter' }); assert.deepEqual(f.chosen, ['b']); assert.equal(f.view().visible, false);
});
test('closing a suggestion during initial load prevents stale display or selection', async () => {
  const f = fixture(); const pending = f.show(); f.popup.hide(); await pending;
  assert.equal(f.view().visible, false); assert.ok(f.sent.every(([, data]) => data.usernames.length === 0)); f.popup.choose(0); assert.equal(f.chosen.length, 0);
});
