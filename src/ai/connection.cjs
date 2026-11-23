const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { AIError } = require('./controller.cjs');
const MAX_MESSAGE = 128 * 1024;
const defaultConnectionFile = () => path.join(os.homedir(), 'Library', 'Application Support', 'DuoChromium', 'ai-connection.json');
class LocalBridge {
  constructor({ directory, controller }) { this.directory = directory; this.controller = controller; this.clients = new Set(); this.server = null; this.queue = Promise.resolve(); this.lifecycle = Promise.resolve(); }
  start() { const next = this.lifecycle.then(() => this.startNow()); this.lifecycle = next.catch(() => {}); return next; }
  stop() { const next = this.lifecycle.then(() => this.stopNow()); this.lifecycle = next.catch(() => {}); return next; }
  async startNow() {
    if (this.server) return;
    fs.mkdirSync(this.directory, { recursive: true });
    this.file = path.join(this.directory, 'ai-connection.json');
    // Short private socket path avoids macOS's sockaddr_un path-length limit.
    this.socketDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'portio-ai-')); fs.chmodSync(this.socketDirectory, 0o700);
    this.socketPath = path.join(this.socketDirectory, 'bridge.sock');
    this.token = randomBytes(32).toString('hex');
    const token = this.token;
    this.server = net.createServer(socket => {
      if (this.clients.size >= 16) return socket.destroy();
      this.clients.add(socket); let buffer = '', consumed = false;
      socket.setEncoding('utf8'); socket.setTimeout(20000, () => socket.destroy());
      socket.on('error', () => {}); socket.on('close', () => this.clients.delete(socket));
      socket.on('data', data => {
        if (consumed) return;
        buffer += data;
        if (Buffer.byteLength(buffer) > MAX_MESSAGE) return socket.destroy();
        const end = buffer.indexOf('\n'); if (end === -1) return;
        consumed = true;
        let request; try { request = JSON.parse(buffer.slice(0, end)); } catch { return socket.destroy(); }
        if (!request || typeof request !== 'object' || Array.isArray(request)) return socket.destroy();
        if (typeof request.token !== 'string' || !/^[a-f0-9]{64}$/.test(request.token) || !timingSafeEqual(Buffer.from(request.token), Buffer.from(token)) || typeof request.owner !== 'string' || !/^[a-f0-9]{64}$/.test(request.owner)) return socket.destroy();
        const run = async () => {
          if (this.token !== token || socket.destroyed) return;
          try {
            if (request.name === 'disconnect') { this.controller.releaseOwner(request.owner); socket.end(JSON.stringify({ result: { released: true } }) + '\n'); return; }
            const result = await this.controller.invoke(request.owner, request.name, request.args);
            if (!socket.destroyed) socket.end(JSON.stringify({ result }) + '\n');
          } catch (e) { if (!socket.destroyed) socket.end(JSON.stringify({ error: { code: e instanceof AIError ? e.code : 'INVALID_REQUEST', message: e instanceof AIError ? e.publicMessage : '操作の指定を確認してください。' } }) + '\n'); }
        };
        this.queue = this.queue.then(run, run);
      });
    });
    try {
      await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.socketPath, resolve); });
      fs.chmodSync(this.socketPath, 0o600);
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ socket: this.socketPath, token }), { mode: 0o600 });
      fs.chmodSync(this.file + '.tmp', 0o600); fs.renameSync(this.file + '.tmp', this.file);
      this.controller.setEnabled(true);
    } catch (e) { await this.stopNow(); throw e; }
  }
  async stopNow() {
    this.controller.setEnabled(false); this.token = null;
    for (const socket of this.clients) socket.destroy();
    const server = this.server; this.server = null;
    if (server) await new Promise(resolve => server.close(resolve));
    if (this.file) { try { fs.unlinkSync(this.file); } catch {} }
    if (this.socketDirectory) { try { fs.rmSync(this.socketDirectory, { recursive: true, force: true }); } catch {} }
  }
}
function callBridge(file, owner, name, args = {}) {
  let endpoint;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new Error();
    endpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof endpoint.socket !== 'string' || typeof endpoint.token !== 'string' || !/^[a-f0-9]{64}$/.test(endpoint.token)) throw new Error();
  } catch { return Promise.reject(new AIError('NOT_CONNECTED', 'Portioを起動し、設定の「AI連携」を有効にしてください。')); }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint.socket); let buffer = '', done = false;
    const finish = (err, result) => { if (done) return; done = true; socket.destroy(); err ? reject(err) : resolve(result); };
    socket.setEncoding('utf8'); socket.setTimeout(20000, () => finish(new AIError('TIMEOUT', '応答を確認できませんでした。再操作前に状態を確認してください。')));
    socket.on('connect', () => socket.write(JSON.stringify({ token: endpoint.token, owner, name, args }) + '\n'));
    socket.on('error', () => finish(new AIError('NOT_CONNECTED', 'Portioとの接続を確認してください。')));
    socket.on('end', () => { if (!done) finish(new AIError('NOT_CONNECTED', 'Portioとの接続が終了しました。')); });
    socket.on('data', data => {
      buffer += data;
      if (Buffer.byteLength(buffer) > MAX_MESSAGE) return finish(new AIError('RESPONSE_LIMIT', '応答が大きすぎます。'));
      const end = buffer.indexOf('\n'); if (end === -1) return;
      try { const v = JSON.parse(buffer.slice(0, end)); finish(v.error ? new AIError(v.error.code, v.error.message) : null, v.result); }
      catch { finish(new AIError('INVALID_RESPONSE', 'Portioからの応答を確認できませんでした。')); }
    });
  });
}
module.exports = { LocalBridge, callBridge, defaultConnectionFile, MAX_MESSAGE };
