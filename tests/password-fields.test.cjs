const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { inspectFields, fillFields } = require('../src/password-fields.cjs');
// A DOM unit harness for mutations between inspection and the user's selection.
// Actual renderer behavior is also checked separately in the Mac app.
function page({ usernameOnly = false, origin = 'https://example.test' } = {}) {
  class Input {
    constructor(type, name, autocomplete) { Object.assign(this, { type, name, id: name, autocomplete, isConnected: true, disabled: false, readOnly: false, hidden: false, events: [], form: null, _value: '' }); }
    get value() { return this._value; } set value(v) { this._value = v; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    getBoundingClientRect() { return { width: 200, height: 32 }; }
    dispatchEvent(e) { this.events.push(e.type); }
  }
  const form = { action: origin + '/session' };
  const user = new Input('email', 'email', 'username'), pass = new Input('password', 'password', 'current-password');
  user.form = pass.form = form;
  const fields = usernameOnly ? [user] : [user, pass];
  const location = { origin, href: origin + '/login' };
  const context = vm.createContext({ HTMLInputElement: Input, document: { activeElement: user, querySelectorAll: () => fields }, location, URL, getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }), Event: class { constructor(type) { this.type = type; } } });
  const inspect = (capture = false) => vm.runInContext(`(${inspectFields})('ticket', ${capture})`, context);
  const fill = () => vm.runInContext(`(${fillFields})(${JSON.stringify({ ticket: 'ticket', origin, username: 'saved-user', password: 'saved-secret' })})`, context);
  return { context, user, pass, fields, form, location, inspect, fill };
}
test('login fields fill after selection without submitting and the ticket is single use', () => {
  const p = page(); assert.equal(p.inspect().kind, 'username');
  assert.equal(p.fill(), true); assert.equal(p.user.value, 'saved-user'); assert.equal(p.pass.value, 'saved-secret');
  assert.deepEqual(p.pass.events, ['input', 'change']); assert.equal(p.fill(), false);
});
test('identifier-first screens work without exposing the password on that step', () => {
  const p = page({ usernameOnly: true }); assert.ok(p.inspect()); assert.equal(p.fill(), true);
  assert.equal(p.user.value, 'saved-user'); assert.equal(p.pass.value, '');
});
test('save capture is explicit and ordinary field inspection does not return secrets', () => {
  const p = page(); p.user.value = 'typed-user'; p.pass.value = 'typed-secret';
  assert.equal('password' in p.inspect(), false);
  const captured = p.inspect(true); assert.equal(captured.password, 'typed-secret'); assert.equal(captured.username, 'typed-user');
});
test('sign-up, OTP, hidden and cross-origin form targets are excluded', () => {
  for (const change of ['signup', 'otp', 'hidden', 'cross-origin', 'multiple']) {
    const p = page();
    if (change === 'signup') p.pass.autocomplete = 'new-password';
    if (change === 'otp') { p.user.autocomplete = 'one-time-code'; p.context.document.activeElement = p.user; }
    if (change === 'hidden') { p.user.hidden = true; p.pass.hidden = true; }
    if (change === 'cross-origin') p.form.action = 'https://attacker.test/login';
    if (change === 'multiple') p.fields.push(p.pass);
    assert.equal(p.inspect(), null, change);
  }
});
test('navigation, removed/retyped fields and form-action swaps after selection reject filling', () => {
  for (const change of ['origin', 'removed', 'password-type', 'action', 'hidden', 'otp', 'form', 'route', 'focus', 'name', 'autocomplete']) {
    const p = page(); assert.ok(p.inspect());
    if (change === 'origin') p.location.origin = 'https://attacker.test';
    if (change === 'removed') p.pass.isConnected = false;
    if (change === 'password-type') p.pass.type = 'text';
    if (change === 'action') p.form.action = 'https://attacker.test/login';
    if (change === 'hidden') p.pass.hidden = true;
    if (change === 'otp') p.user.autocomplete = 'one-time-code';
    if (change === 'form') p.user.form = null;
    if (change === 'route') p.location.href = 'https://example.test/another-form';
    if (change === 'focus') p.context.document.activeElement = p.pass;
    if (change === 'name') p.pass.name = 'verification';
    if (change === 'autocomplete') p.pass.autocomplete = 'new-password';
    assert.equal(p.fill(), false, change); assert.equal(p.user.value, ''); assert.equal(p.pass.value, '');
  }
});
