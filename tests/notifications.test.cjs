const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { NotificationStore, notificationOrigin, notificationContext } = require('../src/notifications.cjs');

function profile(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portio-notifications-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('notification choices survive reload and remain separate by space and exact origin', t => {
  const file = path.join(profile(t), 'notifications.json');
  const store = new NotificationStore(file);
  assert.equal(store.get('personal', 'https://example.org'), undefined);
  store.set('personal', 'https://example.org', true);
  store.set('university', 'https://example.org', false);
  const restored = new NotificationStore(file);
  assert.equal(restored.get('personal', 'https://example.org'), true);
  assert.equal(restored.get('university', 'https://example.org'), false);
  for (const origin of ['https://other.example.org', 'https://example.org:8443', 'http://example.org']) assert.equal(restored.get('personal', origin), undefined);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  restored.set('personal', 'https://example.org', null);
  assert.equal(new NotificationStore(file).get('personal', 'https://example.org'), undefined);
  assert.equal(new NotificationStore(file).get('university', 'https://example.org'), false);
});

test('malformed saved permissions and unsupported origins cannot grant notifications', t => {
  const file = path.join(profile(t), 'notifications.json');
  for (const content of ['broken', 'null', JSON.stringify({ version: 2, spaces: { personal: [{ origin: 'https://example.org', allowed: true }] } })]) {
    fs.writeFileSync(file, content);
    assert.deepEqual(new NotificationStore(file).list('personal'), []);
  }
  const entries = [null, {}, { origin: null, allowed: true }, ...['file:///tmp', 'javascript:alert(1)', 'https://user:pass@example.org', 'http://example.org', 'https://example.org/path', 'https://example.org/'].map(origin => ({ origin, allowed: true })), { origin: 'https://example.org', allowed: 'true' }];
  fs.writeFileSync(file, JSON.stringify({ version: 1, spaces: { personal: entries } }));
  assert.deepEqual(new NotificationStore(file).list('personal'), []);
  assert.equal(notificationOrigin('https://example.org/path?query=value'), 'https://example.org');
  assert.equal(notificationOrigin('http://localhost:49199/test'), 'http://localhost:49199');
  assert.equal(notificationContext('https://example.org', 'https://other.example.org'), null);
  assert.equal(notificationContext('https://example.org', null, 'https://other.example.org'), null);
  assert.equal(notificationContext('https://example.org', null), 'https://example.org');
});

test('failed writes leave the prior choice intact, including failed revocation', t => {
  const root = profile(t), file = path.join(root, 'notifications.json');
  const store = new NotificationStore(file);
  store.set('personal', 'https://example.org', false);
  fs.mkdirSync(file + '.tmp');
  assert.throws(() => store.set('personal', 'https://example.org', true));
  assert.equal(store.get('personal', 'https://example.org'), false);
  assert.throws(() => store.set('personal', 'https://example.org', null));
  assert.equal(store.get('personal', 'https://example.org'), false);
});

// Exercise the real session handlers without opening accounts or granting OS access.
function handlers(root, prompt) {
  const sessions = {}, paths = { appData: root };
  const electron = {
    app: { setName() {}, setPath(k, v) { paths[k] = v; }, getPath(k) { return paths[k]; }, enableSandbox() {}, requestSingleInstanceLock() { return false; }, quit() {}, on() {}, getVersion() { return 'test'; } },
    session: { fromPartition(partition) { return sessions[partition] = { setPermissionCheckHandler(fn) { this.check = fn; }, setPermissionRequestHandler(fn) { this.request = fn; }, on() {} }; } },
    dialog: { showMessageBox: prompt }
  };
  const context = vm.createContext({ URL, require(id) { return id === 'electron' ? electron : id.startsWith('./') ? require('../src/' + id.slice(2)) : require(id); }, __dirname: path.resolve(__dirname, '../src'), setTimeout() { return 1; }, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8'), context);
  vm.runInContext("win = { isDestroyed: () => false, setTitle() {}, webContents: { send() {} } }; SPACES.forEach(setupSession);", context);
  return { personal: sessions['persist:duo-personal'], university: sessions['persist:duo-university'] };
}
function page(url = 'https://example.org/page') { return { isDestroyed: () => false, getURL: () => url }; }
function request(session, wc = page(), permission = 'notifications', requestingUrl = wc.getURL()) {
  return new Promise((resolve, reject) => Promise.resolve(session.request(wc, permission, resolve, { requestingUrl, isMainFrame: true })).catch(reject));
}

test('real permission handlers remember allow and deny across restarts without repeat prompts', async t => {
  const root = profile(t); let prompts = 0;
  let sessions = handlers(root, async () => ({ response: ++prompts === 1 ? 1 : 0 }));
  assert.equal(await request(sessions.personal), true);
  assert.equal(await request(sessions.personal), true);
  assert.equal(await request(sessions.university), false);
  sessions = handlers(root, async () => { throw new Error('Unexpected repeat prompt'); });
  assert.equal(await request(sessions.personal), true);
  assert.equal(await request(sessions.university), false);
  assert.equal(prompts, 2);
  assert.equal(sessions.personal.check(null, 'notifications', 'https://example.org', {}), true);
  assert.equal(sessions.personal.check(page(), 'notifications', 'https://example.org', { requestingUrl: 'https://evil.example.org' }), false);
  assert.equal(sessions.personal.check(page('https://evil.example.org'), 'notifications', 'https://example.org', {}), false);
  assert.equal(sessions.personal.check(null, 'notifications', 'https://example.org', { embeddingOrigin: 'https://evil.example.org' }), false);
  assert.equal(await request(sessions.personal, page('https://evil.example.org'), 'notifications', 'https://example.org'), false);
  assert.equal(sessions.personal.check(page(), 'media', 'https://example.org', {}), false);
  assert.equal(await request(sessions.personal, page(), 'geolocation'), false);
});

test('simultaneous requests share one prompt and navigation does not inherit a pending grant', async t => {
  let resolvePrompt, prompts = 0, url = 'https://example.org/page';
  const sessions = handlers(profile(t), () => { prompts++; return new Promise(resolve => { resolvePrompt = resolve; }); });
  const first = request(sessions.personal), second = request(sessions.personal);
  assert.equal(prompts, 1);
  resolvePrompt({ response: 1 });
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  const pending = request(sessions.university, { isDestroyed: () => false, getURL: () => url });
  url = 'https://other.example.org';
  resolvePrompt({ response: 1 });
  assert.equal(await pending, false);
  assert.equal(sessions.university.check(null, 'notifications', 'https://example.org', {}), false);
});
