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
  const manager = new PasswordController({ store, Menu: {}, dialog: {}, current: () => selected, window: () => ({}), space: () => 'personal', canSuggest: () => true, changed() {} });
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
