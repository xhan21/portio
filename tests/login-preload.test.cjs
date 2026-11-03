const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/login-preload.cjs'), 'utf8');
function fixture(main = true) {
  class Element {}
  class Input extends Element { constructor(type, name) { super(); Object.assign(this, { type, name, id: name, autocomplete: type === 'password' ? 'current-password' : 'username', value: type === 'password' ? 'fake-only' : 'fake@example.test', isConnected: true, disabled: false, readOnly: false }); } getClientRects() { return [{}]; } }
  const form = { action: 'https://example.test/session' }, user = new Input('email', 'email'), pass = new Input('password', 'password'); user.form = pass.form = form;
  const fields = [user, pass], handlers = {}, sent = [];
  const context = { require: id => { assert.equal(id, 'electron'); return { ipcRenderer: { send: (...v) => sent.push(v) } }; }, process: { isMainFrame: main }, Element, HTMLInputElement: Input, URL, location: { origin: 'https://example.test', href: 'https://example.test/login' }, getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }), document: { querySelectorAll: () => fields, addEventListener: (name, handler) => { handlers[name] = handler; }, activeElement: pass } };
  vm.runInNewContext(source, context);
  return { user, pass, form, fields, handlers, sent };
}
test('observer emits only after trusted input and login intent, with no API exposed to the page', () => {
  const f = fixture(); f.handlers.submit({ isTrusted: true, target: f.form }); assert.equal(f.sent.length, 0);
  f.handlers.input({ isTrusted: false, target: f.pass }); f.handlers.submit({ isTrusted: true, target: f.form }); assert.equal(f.sent.length, 0);
  f.handlers.input({ isTrusted: true, target: f.pass }); f.handlers.submit({ isTrusted: false, target: f.form }); assert.equal(f.sent.length, 0);
  f.handlers.submit({ isTrusted: true, target: f.form }); assert.equal(f.sent.length, 1); assert.equal(f.sent[0][0], 'duo:login-submit');
  assert.equal(source.includes('contextBridge'), false); assert.deepEqual(Object.keys(fixture(false).handlers), []);
});
test('observer rejects sign-up, multiple-password, OTP, cross-origin, hidden and oversized forms', () => {
  for (const kind of ['new-password', 'multiple', 'otp', 'origin', 'hidden', 'oversize']) {
    const f = fixture(); f.handlers.input({ isTrusted: true, target: f.pass });
    if (kind === 'new-password') f.pass.autocomplete = 'new-password';
    if (kind === 'multiple') f.fields.push(f.pass);
    if (kind === 'otp') f.pass.name = 'verification';
    if (kind === 'origin') f.form.action = 'https://other.test/';
    if (kind === 'hidden') { f.pass.getClientRects = () => []; f.user.getClientRects = () => []; }
    if (kind === 'oversize') f.pass.value = 'x'.repeat(4097);
    f.handlers.submit({ isTrusted: true, target: f.form }); assert.equal(f.sent.length, 0, kind);
  }
});
