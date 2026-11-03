const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PasswordOffers } = require('../src/password-offers.cjs');
function fixture() {
  let selected, space = 'personal';
  const frame = { url: 'https://example.test/login' }, wc = { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url };
  const tab = { wc, space }; selected = tab;
  const saves = [], prompts = []; let status = 'new', response = 1, auth = true, authentications = 0;
  const store = { compare: async () => status, save: async (...args) => saves.push(args) };
  const dialog = { showMessageBox: async (_win, data) => { prompts.push(data); return { response }; } };
  const offers = new PasswordOffers({ store, dialog, authenticate: async () => { authentications++; return auth; }, current: () => selected, space: () => space, window: () => ({}), available: () => true });
  const data = { origin: 'https://example.test', username: 'fake@example.test', password: 'synthetic-only' };
  return { offers, tab, frame, store, dialog, saves, prompts, data, submit: value => offers.receive(tab, { senderFrame: frame }, value || data), setStatus: v => { status = v; }, setResponse: v => { response = v; }, setAuth: v => { auth = v; }, countAuth: () => authentications, switchSpace: () => { space = 'university'; }, switchTab: () => { selected = {}; } };
}
test('login attempt offers a native save prompt, saves only with consent, and suppresses repeated attempts', async () => {
  for (const response of [0, 1]) {
    const f = fixture(); f.setResponse(response); await f.submit(); await f.submit();
    assert.equal(f.prompts.length, 1); assert.equal(f.saves.length, response); assert.equal(f.countAuth(), 0);
    assert.equal(JSON.stringify(f.prompts).includes('synthetic-only'), false);
    if (response) assert.deepEqual(f.saves[0], ['personal', 'https://example.test', 'fake@example.test', 'synthetic-only']);
  }
});
test('unchanged saved credentials are quiet; changed credentials require confirmation and fresh authentication', async () => {
  const same = fixture(); same.setStatus('same'); await same.submit(); assert.equal(same.prompts.length, 0); assert.equal(same.saves.length, 0);
  for (const auth of [false, true]) {
    const f = fixture(); f.setStatus('changed'); f.setAuth(auth); await f.submit();
    assert.equal(f.countAuth(), 1); assert.equal(f.saves.length, auth ? 1 : 0); assert.match(f.prompts[0].message, /更新/);
  }
});
test('save observer rejects foreign frames, origins, background tabs, spaces, insecure URLs and malformed data', async () => {
  for (const kind of ['frame', 'origin', 'tab', 'space', 'http', 'oversize', 'newline']) {
    const f = fixture(), event = { senderFrame: f.frame }, data = { ...f.data };
    if (kind === 'frame') event.senderFrame = { ...f.frame };
    if (kind === 'origin') data.origin = 'https://other.test';
    if (kind === 'tab') f.switchTab();
    if (kind === 'space') f.switchSpace();
    if (kind === 'http') { f.frame.url = 'http://example.test/login'; data.origin = 'http://example.test'; }
    if (kind === 'oversize') data.password = 'a'.repeat(4097);
    if (kind === 'newline') data.username = 'a\nb';
    await f.offers.receive(f.tab, event, data); assert.equal(f.prompts.length, 0, kind); assert.equal(f.saves.length, 0, kind);
  }
});
test('identifier-first flow is short-lived and isolated to the same tab and origin', async () => {
  for (const kind of ['match', 'expired', 'origin', 'lock']) {
    const f = fixture(); await f.submit({ ...f.data, password: '' }); assert.equal(f.prompts.length, 0);
    if (kind === 'expired') f.offers.identifiers.get(f.tab).expires = 0;
    if (kind === 'origin') f.frame.url = 'https://other.test/password';
    if (kind === 'lock') f.offers.revoke();
    await f.submit({ ...f.data, username: '', origin: new URL(f.frame.url).origin });
    assert.equal(f.saves.length, kind === 'match' ? 1 : 0, kind);
  }
});
test('redirected login saves the captured origin; tab switches and screen lock cancel a pending save', async () => {
  for (const kind of ['redirect', 'tab', 'lock']) {
    const f = fixture(); f.dialog.showMessageBox = async () => {
      if (kind === 'redirect') f.frame.url = 'https://service.test/home';
      if (kind === 'tab') f.switchTab();
      if (kind === 'lock') f.offers.revoke();
      return { response: 1 };
    };
    await f.submit(); assert.equal(f.saves.length, kind === 'redirect' ? 1 : 0, kind);
    if (kind === 'redirect') assert.equal(f.saves[0][1], 'https://example.test');
  }
});
