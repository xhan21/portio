const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readState, rememberSite, matchingSites } = require('../src/core.cjs');
test('address candidates survive restart, match titles and URLs, and stay in their own space', () => {
  let history = [];
  history = rememberSite(history, 'https://example.test/articles?view=1#top', '大学のお知らせ');
  history = rememberSite(history, 'https://example.test/articles?view=2', '大学のニュース');
  history = rememberSite(history, 'https://second.test/', '別のページ');
  const restored = readState(JSON.parse(JSON.stringify({ spaces: { personal: { history } } })));
  assert.equal(restored.spaces.personal.history.length, 2);
  assert.equal(matchingSites(restored.spaces.personal.history, 'example')[0].url, 'https://example.test/articles');
  assert.equal(matchingSites(restored.spaces.personal.history, '大学')[0].title, '大学のニュース');
  assert.deepEqual(matchingSites(restored.spaces.university.history, 'example'), []);
  assert.deepEqual(matchingSites(history, ''), []);
});
test('address history excludes auth callbacks, credentials and executable URLs; bounds storage and suggestions', () => {
  let history = [];
  for (const url of ['https://accounts.google.com/', 'https://example.test/login', 'https://example.test/?token=secret', 'https://user:secret@example.test/', 'file:///private', 'javascript:alert(1)']) history = rememberSite(history, url, 'blocked');
  assert.equal(history.length, 0);
  for (let i = 0; i < 220; i++) history = rememberSite(history, `https://example.test/page/${i}`, 'Example ' + i);
  assert.equal(history.length, 200); assert.equal(history[0].title, 'Example 219');
  assert.equal(matchingSites(history, 'EXAMPLE').length, 6);
});
