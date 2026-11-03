const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PasswordStore, passwordOrigin } = require('../src/passwords.cjs');
const { PasswordController } = require('../src/password-controller.cjs');
function environment(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portio-vault-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const encryption = {
    isAsyncEncryptionAvailable: async () => true,
    async encryptStringAsync(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    async decryptStringAsync(bytes) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return { result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'), shouldReEncrypt: false };
    }
  };
  return { file: path.join(dir, 'passwords.enc.json'), encryption };
}
test('vault encrypts usernames/passwords and restores only the matching space and exact origin', async t => {
  const { file, encryption } = environment(t), store = new PasswordStore(file, encryption);
  const personal = await store.save('personal', 'https://example.test', 'alice@example.test', 'Synthetic-secret-42!');
  const university = await store.save('university', 'https://example.test', 'teacher@example.test', 'Synthetic-campus-42!');
  const raw = fs.readFileSync(file, 'utf8');
  for (const text of ['alice', 'teacher', 'Synthetic-', 'example.test']) assert.equal(raw.includes(text), false);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const restored = new PasswordStore(file, encryption);
  assert.equal((await restored.get('personal', 'https://example.test', personal)).password, 'Synthetic-secret-42!');
  assert.equal(await restored.get('university', 'https://example.test', personal), null);
  for (const origin of ['https://other.example.test', 'https://example.test:8443', 'http://example.test', null]) assert.equal(await restored.get('personal', origin, personal), null);
  assert.deepEqual(Object.keys((await restored.list('personal'))[0]).sort(), ['id', 'origin', 'username']);
  await restored.remove('personal', university);
  assert.equal((await restored.list('university')).length, 1);
  await restored.remove('personal', personal);
  assert.equal((await new PasswordStore(file, encryption).list('personal')).length, 0);
});
test('vault serializes concurrent changes and updates an account without duplicating it', async t => {
  const { file, encryption } = environment(t), store = new PasswordStore(file, encryption);
  await Promise.all(['a', 'b', 'c'].map(user => store.save('personal', 'https://example.test', user, 'test-only')));
  const original = (await store.list('personal')).find(e => e.username === 'b');
  assert.equal(await store.save('personal', 'https://example.test', 'b', 'replacement'), original.id);
  assert.equal((await store.list('personal')).length, 3);
  assert.equal((await store.get('personal', 'https://example.test', original.id)).password, 'replacement');
  assert.equal(await store.compare('personal', 'https://example.test', 'b', 'replacement'), 'same');
  assert.equal(await store.compare('personal', 'https://example.test', 'b', 'another'), 'changed');
  assert.equal(await store.compare('university', 'https://example.test', 'b', 'replacement'), 'new');
});
test('vault refuses insecure/malformed inputs and an unavailable keychain without plaintext fallback', async t => {
  const { file, encryption } = environment(t), store = new PasswordStore(file, encryption);
  for (const origin of [null, '', 'http://example.test', 'https://name:secret@example.test', 'file:///test', 'https://example.test/path']) await assert.rejects(store.save('personal', origin, 'a', 'b'));
  await assert.rejects(store.save('invalid-space', 'https://example.test', 'a', 'b'));
  for (const user of ['', 'a\nb', 'a'.repeat(321)]) await assert.rejects(store.save('personal', 'https://example.test', user, 'b'));
  assert.equal(passwordOrigin('https://EXAMPLE.test/login?state=secret'), 'https://example.test');
  assert.equal(passwordOrigin('http://localhost:4321/login'), 'http://localhost:4321');
  assert.equal(passwordOrigin('http://localhost.attacker.test'), null);
  encryption.isAsyncEncryptionAvailable = async () => false;
  await assert.rejects(store.save('personal', 'https://example.test', 'a', 'b'));
  assert.equal(fs.existsSync(file), false);
});
test('corruption and failed writes never overwrite an existing vault or a failed deletion', async t => {
  const { file, encryption } = environment(t), store = new PasswordStore(file, encryption);
  const id = await store.save('personal', 'https://example.test', 'a', 'test-only');
  const before = fs.readFileSync(file);
  const failingIO = Object.create(fs); failingIO.renameSync = () => { throw new Error('Synthetic disk failure'); };
  const failing = new PasswordStore(file, encryption, failingIO);
  await assert.rejects(failing.save('personal', 'https://example.test', 'a', 'changed'));
  await assert.rejects(failing.remove('personal', id));
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.readdirSync(path.dirname(file)).length, 1);
  fs.writeFileSync(file, '{broken');
  await assert.rejects(store.list('personal'));
  await assert.rejects(store.save('personal', 'https://example.test', 'new', 'test-only'));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
function controller() {
  const calls = []; let url = 'https://example.test/login', selected;
  const wc = { isDestroyed: () => false, isLoadingMainFrame: () => false, getURL: () => url, mainFrame: {}, isFocused: () => true, focus() {}, executeJavaScriptInIsolatedWorld: async (...args) => calls.push(args) };
  const tab = { wc, space: 'personal', error: '' }; selected = tab;
  const store = { get: async () => ({ username: 'synthetic-user', password: 'synthetic-secret' }) };
  const manager = new PasswordController({ store, Menu: {}, dialog: {}, current: () => selected, window: () => ({}), space: () => 'personal', canSuggest: () => true, changed() {}, authenticate: async () => true });
  return { manager, tab, store, calls, navigate: v => { url = v; }, select: v => { selected = v; } };
}
test('autofill rechecks navigation and tab identity after asynchronous secret retrieval', async () => {
  for (const change of ['origin', 'document', 'tab', 'modal']) {
    const test = controller(), context = test.manager.contextFor();
    test.store.get = async () => {
      if (change === 'origin') test.navigate('https://attacker.test');
      if (change === 'document') test.manager.invalidate(test.tab);
      if (change === 'tab') test.select(null);
      if (change === 'modal') test.manager.settings = {};
      return { username: 'test', password: 'never-send-this' };
    };
    await test.manager.fill(context, { ticket: 'test-ticket' }, 'saved-id');
    assert.equal(test.calls.length, 0, change);
  }
});
test('a selected account is sent only into an isolated world and never submitted', async () => {
  const test = controller();
  await test.manager.fill(test.manager.contextFor(), { ticket: 'test-ticket' }, 'saved-id');
  assert.equal(test.calls.length, 1);
  assert.equal(test.calls[0][0], 1004);
  const code = test.calls[0][1][0].code;
  assert.equal(code.includes('synthetic-secret'), true);
  assert.equal(code.includes('.submit('), false);
});

test('autofill never reads a selected secret or fills after failed, cancelled or absent authentication', async () => {
  for (const outcome of [false, undefined, null, 'true', new Error('OS authentication cancelled')]) {
    const test = controller(); let reads = 0;
    test.store.get = async () => { reads++; return { username: 'x', password: 'secret' }; };
    test.manager.authenticate = async () => { if (outcome instanceof Error) throw outcome; return outcome; };
    await test.manager.fill(test.manager.contextFor(), { ticket: 'ticket' }, 'id');
    assert.equal(reads, 0); assert.equal(test.calls.length, 0); assert.equal(test.manager.authenticating, false);
  }
  const test = controller();
  const manager = new PasswordController({ current: () => test.tab, space: () => 'personal', canSuggest: () => true, store: { get() { assert.fail('Missing authentication must deny'); } } });
  await manager.fill(manager.contextFor(), { ticket: 'ticket' }, 'id');
});

test('one fresh authentication is required per fill; simultaneous selections cannot reuse a pending approval', async () => {
  const test = controller(); let approve, prompts = 0, reads = 0;
  test.manager.authenticate = () => { prompts++; return new Promise(resolve => { approve = resolve; }); };
  test.store.get = async () => { reads++; return { username: 'synthetic', password: 'test' }; };
  const first = test.manager.fill(test.manager.contextFor(), { ticket: 'first' }, 'id');
  await test.manager.fill(test.manager.contextFor(), { ticket: 'second' }, 'id');
  assert.equal(prompts, 1); assert.equal(reads, 0); approve(true); await first;
  assert.equal(reads, 1); assert.equal(test.calls.length, 1);
  const next = test.manager.fill(test.manager.contextFor(), { ticket: 'third' }, 'id');
  assert.equal(prompts, 2); approve(false); await next;
  assert.equal(reads, 1); assert.equal(test.calls.length, 1);
});

test('navigation, a tab round trip, screen lock or a settings dialog during authentication abort the pending fill', async () => {
  for (const change of ['origin', 'document', 'tab-roundtrip', 'lock', 'settings']) {
    const test = controller(); let approve, reads = 0;
    test.manager.authenticate = () => new Promise(resolve => { approve = resolve; });
    test.store.get = async () => { reads++; return { username: 'synthetic', password: 'test' }; };
    const pending = test.manager.fill(test.manager.contextFor(), { ticket: 'ticket' }, 'id');
    if (change === 'origin') test.navigate('https://other.test');
    if (change === 'document') test.manager.invalidate(test.tab);
    if (change === 'tab-roundtrip') { test.select(null); test.manager.revoke(); test.select(test.tab); }
    if (change === 'lock') test.manager.revoke();
    if (change === 'settings') test.manager.settings = {};
    approve(true); await pending;
    assert.equal(reads, 0, change); assert.equal(test.calls.length, 0, change);
  }
});

test('authentication cancellation or lock preserves an existing saved password and prevents deletion', async () => {
  for (const kind of ['password-save', 'password-remove']) for (const outcome of ['cancel', 'lock', 'approve']) {
    const test = controller(); let writes = 0, deletes = 0;
    const entry = { id: 'id', origin: 'https://example.test', username: 'synthetic' };
    test.manager.settings = { space: 'personal', origin: entry.origin, entries: [entry], editor: 'editor', busy: false, error: '' };
    test.manager.context = test.manager.contextFor();
    test.manager.dialog = { showMessageBox: async () => ({ response: 1 }) };
    test.manager.authenticate = async () => { if (outcome === 'lock') test.manager.revoke(); return outcome !== 'cancel'; };
    Object.assign(test.store, { save: async () => { writes++; }, remove: async () => { deletes++; }, list: async () => [entry] });
    await test.manager.act(kind, kind === 'password-save' ? JSON.stringify({ token: 'editor', username: 'synthetic', password: 'test-only' }) : 'id');
    assert.equal(writes + deletes, outcome === 'approve' ? 1 : 0, kind + outcome);
    assert.equal(test.manager.settings.busy, false);
  }
});
test('typing an account prefix filters local suggestions without sending secrets or stealing focus', async () => {
  const f = controller(), shown = [];
  f.manager.popup = { show: async data => shown.push(data), hide() {} }; f.tab.view = { getBounds: () => ({ x: 224, y: 96 }) };
  f.store.list = async () => [{ id: '1', username: 'alice@example.test' }, { id: '2', username: 'bob@example.test' }];
  f.manager.inspect = async () => ({ kind: 'username', prefix: 'Al', rect: { x: 10, y: 20, width: 200, height: 30 } });
  await f.manager.suggest(f.tab);
  assert.deepEqual(shown[0].items.map(e => e.username), ['alice@example.test']); assert.equal(f.calls.length, 0);
});
