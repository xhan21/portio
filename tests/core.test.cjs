const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webURL, resolveAddress, restorable, readState, preferences } = require('../src/core.cjs');
test('addresses accept web pages and reject executable, local and credential-bearing URLs', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'https://name:pass@example.com/', 'chrome://settings']) assert.equal(resolveAddress(value), null);
  assert.equal(resolveAddress('canva.com'), 'https://canva.com/');
  assert.equal(resolveAddress('http://127.0.0.1:49387/'), 'http://127.0.0.1:49387/');
  assert.equal(resolveAddress('日本語 検索'), 'https://www.google.com/search?q=' + encodeURIComponent('日本語 検索'));
  assert.equal(webURL('https://good.example@evil.example/'), null);
});
test('authentication callbacks are never replayed from saved sessions', () => {
  for (const value of ['https://accounts.google.com/ServiceLogin', 'https://sso.example.org/', 'https://example.org/oauth2/callback', 'https://example.org/?CoDe=secret', 'https://example.org/#access_token=secret', 'https://example.org/?state=secret']) assert.equal(restorable(value), null);
  assert.equal(restorable('https://www.canva.com/'), 'https://www.canva.com/');
});
test('corrupt or excessive saved tabs cannot inject privileged URLs or arbitrary spaces', () => {
  const state = readState({active:'injected', spaces:{personal:{selected:999,tabs:Array.from({length:35},()=>({url:'file:///tmp/page',service:'injected'}))}}});
  assert.equal(state.active, 'personal'); assert.equal(state.spaces.personal.tabs.length, 20); assert.equal(state.spaces.personal.selected, 19);
  assert.ok(state.spaces.personal.tabs.every(t => t.url === null && t.service === null));
  assert.equal(state.spaces.university.tabs.length, 1);
});
test('web pages in distinct persistent partitions have no privileged preload or Node access', () => {
  const personal = preferences('persist:duo-personal'), university = preferences('persist:duo-university');
  assert.notEqual(personal.partition, university.partition);
  assert.equal(personal.sandbox, true); assert.equal(personal.nodeIntegration, false); assert.equal(personal.nodeIntegrationInSubFrames, false);
  assert.equal(personal.contextIsolation, true); assert.equal(personal.webSecurity, true); assert.equal(personal.webviewTag, false); assert.equal(personal.preload, undefined);
});
