const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { SPACES } = require('./core.cjs');
const LIMIT = 500;
function passwordOrigin(input) {
  try {
    const u = new URL(input);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    return !u.username && !u.password && (u.protocol === 'https:' || (u.protocol === 'http:' && local)) ? u.origin : null;
  } catch { return null; }
}
function validEntry(e) {
  return e && typeof e.id === 'string' && /^[\w-]{1,64}$/.test(e.id) && SPACES.includes(e.space) && typeof e.origin === 'string' && passwordOrigin(e.origin) === e.origin &&
    typeof e.username === 'string' && !!e.username.trim() && e.username.length <= 320 && !/[\r\n\0]/.test(e.username) &&
    typeof e.password === 'string' && e.password.length > 0 && e.password.length <= 4096 && !/\0/.test(e.password);
}
// Keep all metadata and secrets inside one encrypted payload. Never recover a
// damaged or locked vault by overwriting it with an empty one.
class PasswordStore {
  constructor(file, encryption, io = fs) { this.file = file; this.encryption = encryption; this.io = io; this.queue = Promise.resolve(); }
  run(fn) {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => {});
    return task;
  }
  async available() {
    if (!this.encryption || !await this.encryption.isAsyncEncryptionAvailable()) throw new Error('Password encryption unavailable');
  }
  async read() {
    let raw;
    try {
      const stat = this.io.lstatSync(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('Invalid password vault');
      raw = this.io.readFileSync(this.file, 'utf8');
    } catch (e) { if (e.code === 'ENOENT') return []; throw new Error('Password vault unavailable'); }
    await this.available();
    const envelope = JSON.parse(raw);
    if (envelope.version !== 1 || typeof envelope.ciphertext !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext)) throw new Error('Invalid password vault');
    const decrypted = await this.encryption.decryptStringAsync(Buffer.from(envelope.ciphertext, 'base64'));
    const data = JSON.parse(decrypted.result);
    if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > LIMIT || !data.entries.every(validEntry)) throw new Error('Invalid password vault');
    const ids = new Set(), accounts = new Set();
    for (const e of data.entries) {
      const key = JSON.stringify([e.space, e.origin, e.username]);
      if (ids.has(e.id) || accounts.has(key)) throw new Error('Duplicate password entry');
      ids.add(e.id); accounts.add(key);
    }
    return data.entries;
  }
  async write(entries) {
    await this.available();
    const cipher = await this.encryption.encryptStringAsync(JSON.stringify({ version: 1, entries }));
    if (!Buffer.isBuffer(cipher) || !cipher.length) throw new Error('Password encryption failed');
    const temp = this.file + '.' + randomUUID() + '.tmp';
    let fd;
    try {
      this.io.mkdirSync(path.dirname(this.file), { recursive: true });
      fd = this.io.openSync(temp, 'wx', 0o600);
      this.io.writeFileSync(fd, JSON.stringify({ version: 1, ciphertext: cipher.toString('base64') }));
      this.io.fsyncSync(fd); this.io.closeSync(fd); fd = undefined;
      this.io.renameSync(temp, this.file);
    } finally {
      if (fd !== undefined) this.io.closeSync(fd);
      try { this.io.unlinkSync(temp); } catch { /* Only this operation's temporary file. */ }
    }
  }
  list(space, origin) {
    return this.run(async () => (await this.read()).filter(e => e.space === space && (origin === undefined || e.origin === origin))
      .map(({ id, origin, username }) => ({ id, origin, username })));
  }
  get(space, origin, id) {
    return this.run(async () => {
      if (!SPACES.includes(space) || typeof origin !== 'string' || passwordOrigin(origin) !== origin) return null;
      const e = (await this.read()).find(e => e.space === space && e.origin === origin && e.id === id);
      return e ? { ...e } : null;
    });
  }
  compare(space, origin, username, password) {
    return this.run(async () => {
      const entry = (await this.read()).find(e => e.space === space && e.origin === origin && e.username === username);
      return !entry ? 'new' : entry.password === password ? 'same' : 'changed';
    });
  }
  save(space, origin, username, password) {
    return this.run(async () => {
      const entry = { id: randomUUID(), space, origin, username: typeof username === 'string' ? username.trim() : username, password };
      if (!validEntry(entry)) throw new Error('Invalid password entry');
      const entries = await this.read();
      const index = entries.findIndex(e => e.space === space && e.origin === origin && e.username === entry.username);
      if (index >= 0) { entry.id = entries[index].id; entries[index] = entry; }
      else { if (entries.filter(e => e.space === space && e.origin === origin).length >= 20) throw new Error('Too many accounts for site'); if (entries.length >= LIMIT) throw new Error('Password vault full'); entries.push(entry); }
      await this.write(entries);
      return entry.id;
    });
  }
  remove(space, id) {
    return this.run(async () => {
      const entries = await this.read(), next = entries.filter(e => !(e.space === space && e.id === id));
      if (next.length !== entries.length) await this.write(next);
    });
  }
}
module.exports = { PasswordStore, passwordOrigin };
