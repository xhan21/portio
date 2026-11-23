// Explicit synthetic-only harness. Never opens the real user profile.
// Install the official test client under .build/mcp-client, then run:
// node_modules/.bin/electron tests/electron-ai-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, webContents, session, dialog } = require('electron');
const { Client } = require('../.build/mcp-client/node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js');
const { StdioClientTransport } = require('../.build/mcp-client/node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'portio-mcp-smoke-'));
const originalSetPath = app.setPath.bind(app), originalSetName = app.setName.bind(app);
app.setPath = (name, value) => originalSetPath(name, name === 'userData' ? profile : value);
app.setName = () => originalSetName('Portio MCP Smoke');
app.getAppPath = () => root;
app.getVersion = () => require('../package.json').version;
// Only the in-app enable confirmation is stubbed, in this empty synthetic profile.
// No OS permission, Keychain or authentication API is approved or mocked.
const originalMessageBox = dialog.showMessageBox.bind(dialog);
let holdPrompt = false, finishPrompt;
dialog.showMessageBox = (window, options) => {
  if (options.message === 'AI連携を有効にしますか？') return Promise.resolve({ response: 1 });
  if (holdPrompt && options.title === 'Portioの使い方') return new Promise(resolve => { finishPrompt = resolve; });
  return originalMessageBox(window, options);
};
const events = [], passed = [], clients = [];
let server, origin, foreign, win, ui;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await delay(30); } throw new Error('condition timeout'); }
const page = () => `<!doctype html><html><head><title>Portio MCP synthetic</title><style>body{font:18px sans-serif;padding:24px}button,input,select{margin:8px;padding:8px}</style></head><body>
<h1>架空の操作テスト</h1><p id="count">クリック 0</p><button id="countButton" onclick="document.querySelector('#count').textContent='クリック '+(++window.count);fetch('/event?count='+window.count)">カウント</button>
<label>検索語<input id="search" type="search" oninput="document.querySelector('#echo').textContent=this.value"></label><p id="echo">未入力</p>
<label>表示期間<select id="period" onchange="document.querySelector('#choice').textContent=this.value"><option value="week">今週</option><option value="month">今月</option></select></label><p id="choice">week</p>
<form><input aria-label="アカウント" value="LOGIN-PRIVATE"><input aria-label="秘密" type="password" value="PASSWORD-PRIVATE"></form>
<input hidden value="HIDDEN-PRIVATE"><p hidden>HIDDEN-TEXT</p><input autocomplete="one-time-code" value="OTP-PRIVATE">
<iframe srcdoc="<p>FRAME-PRIVATE</p>"></iframe><form action="/submit"><button formaction="${foreign}/submit">別サイトへ送信</button></form>
<script>window.count=0</script></body></html>`;
async function makeClient() {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/ai/stdio.cjs'), '--connection-file', path.join(profile, 'ai-connection.json')], env: { ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe' });
  const client = new Client({ name: 'Portio independent SDK validation', version: '1' });
  await client.connect(transport); clients.push(client); return client;
}
async function raw(client, name, args = {}) { return (await client.callTool({ name, arguments: args })).structuredContent; }
async function call(client, name, args = {}) { const value = await raw(client, name, args); assert.ok(!value.error, JSON.stringify(value)); return value; }
async function read(client, work) { return until(async () => { const value = await raw(client, 'portio_read', { work }); if (value.error === 'PAGE_LOADING') return false; assert.ok(!value.error, JSON.stringify(value)); return value; }); }
const act = (kind, value) => ui.executeJavaScript(`window.duo.act(${JSON.stringify(kind)},${JSON.stringify(value)})`);
const contentAt = url => webContents.getAllWebContents().find(w => w.getURL() === url);
async function run() {
  server = http.createServer((req, res) => { if (req.url.startsWith('/event')) { events.push(req.url); res.end('ok'); return; } res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(req.url === '/existing' ? '<h1>UNRELATED-EXISTING-TAB</h1>' : page()); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`; foreign = `http://localhost:${server.address().port}`;
  require('../src/main.cjs');
  win = await until(() => BrowserWindow.getAllWindows()[0]); ui = win.webContents;
  await until(() => !ui.isLoadingMainFrame() && ui.getURL().endsWith('/ui/index.html'));
  await act('new'); await act('navigate', origin + '/existing');
  const old = await until(() => contentAt(origin + '/existing')); await until(() => !old.isLoadingMainFrame());
  const client = await makeClient();
  assert.equal((await call(client, 'portio_status')).enabled, false);
  assert.equal((await client.listTools()).tools.length, 7); passed.push('official MCP SDK initialize and discovery; default off');
  fs.mkdirSync(path.join(root, '.build'), { recursive: true });
  await act('ai'); await until(() => ui.executeJavaScript("document.getElementById('ai-dialog').open"));
  await ui.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(root, '.build/ai-settings.png'), (await ui.capturePage()).toPNG());
  await act('ai'); await act('ai-enable');
  assert.equal((await call(client, 'portio_status')).available, false); await act('ai-close');
  const a = await call(client, 'portio_begin', { space: 'personal', url: origin + '/personal' }); let snapshot = await read(client, a.work);
  const personal = contentAt(origin + '/personal');
  assert.ok(snapshot.text.includes('架空の操作テスト'));
  for (const secret of ['PASSWORD-PRIVATE','LOGIN-PRIVATE','HIDDEN-PRIVATE','HIDDEN-TEXT','OTP-PRIVATE','FRAME-PRIVATE','UNRELATED-EXISTING-TAB']) assert.ok(!JSON.stringify(snapshot).includes(secret), secret);
  assert.equal(snapshot.unsupportedFrames, 1); passed.push('scoped new tab; hidden, password, login and frame values excluded');
  const click = snapshot.elements.find(e => e.name === 'カウント');
  await call(client, 'portio_click', { work: a.work, snapshot: snapshot.snapshot, ref: click.ref });
  await until(() => events.length === 1); snapshot = await read(client, a.work); assert.ok(snapshot.text.includes('クリック 1'));
  const field = snapshot.elements.find(e => e.name === '検索語');
  await call(client, 'portio_fill', { work: a.work, snapshot: snapshot.snapshot, ref: field.ref, text: '架空の検索' });
  snapshot = await read(client, a.work); assert.ok(snapshot.text.includes('架空の検索'));
  const select = snapshot.elements.find(e => e.name === '表示期間');
  await call(client, 'portio_select', { work: a.work, snapshot: snapshot.snapshot, ref: select.ref, value: 'month' });
  snapshot = await read(client, a.work); assert.ok(snapshot.elements.some(e => e.name === '表示期間' && e.value === 'month'));
  passed.push('real Chromium click, input, select; independent HTTP event receipt');
  const oldSnapshot = snapshot;
  await personal.executeJavaScript("document.querySelector('#countButton').textContent='変更されたボタン'");
  assert.equal((await raw(client, 'portio_click', { work: a.work, snapshot: oldSnapshot.snapshot, ref: oldSnapshot.elements.find(e => e.name === 'カウント').ref })).error, 'STALE_SNAPSHOT');
  assert.equal(events.length, 1);
  snapshot = await read(client, a.work);
  holdPrompt = true; await act('help');
  assert.equal((await raw(client, 'portio_read', { work: a.work })).error, 'BUSY');
  finishPrompt({ response: 0 }); holdPrompt = false;
  await until(async () => (await call(client, 'portio_status')).available);
  assert.equal((await raw(client, 'portio_click', { work: a.work, snapshot: snapshot.snapshot, ref: snapshot.elements.find(e => e.name === '変更されたボタン').ref })).error, 'STALE_SNAPSHOT');
  passed.push('native confirmation blocks reads and invalidates pending actions');
  snapshot = await read(client, a.work);
  assert.equal((await raw(client, 'portio_click', { work: a.work, snapshot: snapshot.snapshot, ref: snapshot.elements.find(e => e.name === '別サイトへ送信').ref })).error, 'SITE_CHANGED');
  passed.push('DOM mutation and cross-origin form override reject actions');
  await personal.session.cookies.set({ url: origin, name: 'synthetic-space', value: 'personal' });
  await personal.executeJavaScript("localStorage.setItem('synthetic-space','personal')");
  const b = await call(client, 'portio_begin', { space: 'university', url: origin + '/university' }); await read(client, b.work);
  const university = contentAt(origin + '/university');
  assert.equal((await university.session.cookies.get({ url: origin, name: 'synthetic-space' })).length, 0);
  assert.equal(await university.executeJavaScript("localStorage.getItem('synthetic-space')"), null);
  assert.equal((await raw(client, 'portio_read', { work: a.work })).error, 'TAB_NOT_SELECTED');
  assert.equal(await university.executeJavaScript('typeof require+":"+typeof window.duo'), 'undefined:undefined');
  passed.push('personal/university cookie and storage separation; active-tab guard; sandbox');
  const second = await makeClient(); assert.equal((await raw(second, 'portio_read', { work: b.work })).error, 'WORK_NOT_FOUND');
  await university.loadURL(foreign + '/other');
  assert.equal((await raw(client, 'portio_read', { work: b.work })).error, 'SITE_CHANGED');
  const id = university.id; await call(client, 'portio_end', { work: b.work }); assert.equal(university.id, id); assert.equal(university.isDestroyed(), false);
  assert.equal(old.getURL(), origin + '/existing'); assert.equal(await old.executeJavaScript('document.body.textContent'), 'UNRELATED-EXISTING-TAB');
  passed.push('connection ownership; redirect stops reads; end leaves tabs intact');
  await act('ai'); await act('ai-disable'); await act('ai-close');
  assert.equal((await call(client, 'portio_status')).enabled, false); assert.equal(fs.existsSync(path.join(profile, 'ai-connection.json')), false);
  passed.push('disable removes endpoint and revokes work');
  fs.mkdirSync(path.join(root, '.build'), { recursive: true });
  fs.writeFileSync(path.join(root, '.build/ai-smoke-result.json'), JSON.stringify({ version: require('../package.json').version, electron: process.versions.electron, sdk: require('../.build/mcp-client/node_modules/@modelcontextprotocol/sdk/package.json').version, passed }, null, 2));
  console.log(JSON.stringify({ ok: true, passed }));
}
run().then(async () => { for (const c of clients) await c.close(); server.close(); win.close(); }).catch(async error => { console.error(error.stack); for (const c of clients) await c.close().catch(() => {}); server?.close(); app.exit(1); });
app.on('will-quit', () => { fs.rmSync(profile, { recursive: true, force: true }); });
