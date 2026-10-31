const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webURL, resolveAddress, restorable, readState, preferences, shortcutData, reorderTabs } = require('../src/core.cjs');
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
test('moving tabs preserves page objects and rejects unknown or foreign tab IDs', () => {
  const tabs = [{ id: 'a', page: {} }, { id: 'b', page: {} }, { id: 'c', page: {} }];
  const selected = tabs[1];
  const left = reorderTabs(tabs, 'c', 'a');
  assert.deepEqual(left.map(t => t.id), ['c', 'a', 'b']);
  assert.equal(left[2], selected);
  assert.equal(left[0], tabs[2]);
  assert.deepEqual(reorderTabs(left, 'c', null).map(t => t.id), ['a', 'b', 'c']);
  for (const [id, before] of [['other-space', 'a'], ['a', 'missing'], ['a', 'a'], ['a', undefined], [null, 'a'], ['a', {}]]) assert.equal(reorderTabs(tabs, id, before), tabs);
  assert.equal(reorderTabs(tabs, 'c', null), tabs);
  assert.deepEqual(tabs.map(t => t.id), ['a', 'b', 'c']);
});
test('custom shortcuts require bounded names and ordinary credential-free web URLs', () => {
  assert.deepEqual(shortcutData({ name: '  研究室  ', url: 'https://example.org' }), { name: '研究室', url: 'https://example.org/' });
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'https://user:pass@example.org', 'https://example.org/\nsecret', 'not a URL']) assert.equal(shortcutData({ name: 'Test', url }), null);
  for (const name of ['', ' ', 'x'.repeat(41), 'line\nbreak', 42]) assert.equal(shortcutData({ name, url: 'https://example.org' }), null);
});
test('saved shortcuts stay in their space and malformed entries cannot become services', () => {
  const valid = { id: 'custom-lab', name: 'Lab', url: 'https://example.org/' };
  const state = readState({ spaces: { personal: { shortcuts: [valid, valid, { ...valid, id: 'mail' }, { ...valid, id: 'custom-invalid', url: 'file:///tmp/secret' }], tabs: [{ url: valid.url, service: valid.id }] }, university: { tabs: [{ url: valid.url, service: valid.id }] } } });
  assert.deepEqual(state.spaces.personal.shortcuts, [valid]);
  assert.equal(state.spaces.personal.tabs[0].service, valid.id);
  assert.deepEqual(state.spaces.university.shortcuts, []);
  assert.equal(state.spaces.university.tabs[0].service, null);
  assert.equal(readState(null).spaces.personal.shortcuts.length, 0);
  assert.equal(readState({ spaces: { personal: { shortcuts: Array.from({ length: 30 }, (_, i) => ({ ...valid, id: 'custom-' + i })) } } }).spaces.personal.shortcuts.length, 20);
});
test('saved reordered tabs restore the selected page at its new position', () => {
  const tabs = [{ id: 'a', url: 'https://a.example/' }, { id: 'b', url: 'https://b.example/' }, { id: 'c', url: 'https://c.example/' }];
  const next = reorderTabs(tabs, 'b', null);
  const state = readState(JSON.parse(JSON.stringify({ spaces: { personal: { tabs: next, selected: next.findIndex(t => t.id === 'b') } } })));
  assert.deepEqual(state.spaces.personal.tabs.map(t => t.url), ['https://a.example/', 'https://c.example/', 'https://b.example/']);
  assert.equal(state.spaces.personal.tabs[state.spaces.personal.selected].url, 'https://b.example/');
});
