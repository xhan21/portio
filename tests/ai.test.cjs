const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { AIController } = require('../src/ai/controller.cjs');
const { LocalBridge, callBridge } = require('../src/ai/connection.cjs');
const { MCPProtocol } = require('../src/ai/protocol.cjs');
function fixture() {
  const tabs = []; let selected, allowed = true, executions = 0;
  const controller = new AIController({
    canOperate: () => allowed, isSelected: wc => wc === selected,
    createTab: (space, url) => {
      const wc = new EventEmitter();
      Object.assign(wc, { space, url, destroyed: false, loading: false, getURL: () => wc.url, getTitle: () => 'Synthetic page', isDestroyed: () => wc.destroyed, isLoadingMainFrame: () => wc.loading });
      // Controller tests don't evaluate page code; browser-level tests exercise it.
      wc.executeJavaScriptInIsolatedWorld = async () => { executions++; return { text: 'Synthetic', elements: [] }; };
      tabs.push(wc); selected = wc; return wc;
    }
  });
  controller.setEnabled(true);
  return { controller, tabs, setSelected: wc => { selected = wc; }, setAllowed: value => { allowed = value; }, executions: () => executions, begin: (owner = 'owner', space = 'personal', url = 'https://example.test/page') => controller.invoke(owner, 'portio_begin', { space, url }) };
}
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code);
test('MCP lifecycle, schema validation and sanitized errors', async () => {
  let calls = 0;
  const p = new MCPProtocol(async () => { calls++; throw new Error('private local details'); });
  const request = (method, params) => p.handle({ jsonrpc: '2.0', id: 1, method, params });
  assert.equal((await request('tools/list')).error.code, -32000);
  assert.equal((await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } })).result.serverInfo.name, 'portio');
  assert.equal((await request('tools/list')).error.code, -32000);
  await p.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal((await request('tools/list')).result.tools.length, 7);
  assert.equal((await request('tools/call', { name: 'portio_begin', arguments: { space: 'other', url: 'https://example.test' } })).error.code, -32602);
  assert.equal((await request('tools/call', { name: 'portio_status', arguments: { tab: 'existing' } })).error.code, -32602);
  assert.equal(calls, 0);
  const failed = await request('tools/call', { name: 'portio_status', arguments: {} });
  assert.equal(failed.result.isError, true); assert.ok(!JSON.stringify(failed).includes('private local details'));
});
test('each begin creates a new space-specific tab and handles belong to one connection', async () => {
  const f = fixture(), a = await f.begin(), b = await f.begin('second', 'university');
  assert.equal(f.tabs.length, 2); assert.notEqual(a.work, b.work);
  assert.deepEqual(f.tabs.map(t => t.space), ['personal', 'university']);
  await rejects(f.controller.invoke('second', 'portio_read', { work: a.work }), 'WORK_NOT_FOUND');
  await rejects(f.controller.invoke('owner', 'portio_read', { work: a.work }), 'TAB_NOT_SELECTED');
  assert.equal(f.executions(), 0);
  await f.controller.invoke('owner', 'portio_end', { work: a.work });
  assert.equal(f.tabs[0].destroyed, false);
  f.controller.releaseOwner('second'); assert.equal(f.controller.works.size, 0);
});
test('invalid destinations, locked UI, loading and changed origins never read page contents', async () => {
  const f = fixture();
  for (const url of ['file:///private/page', 'javascript:alert(1)', 'https://name:secret@example.test']) await rejects(f.begin('owner', 'personal', url), 'INVALID_DESTINATION');
  const { work } = await f.begin();
  f.setAllowed(false); await rejects(f.controller.invoke('owner', 'portio_read', { work }), 'BUSY'); f.setAllowed(true);
  f.tabs[0].loading = true; await rejects(f.controller.invoke('owner', 'portio_read', { work }), 'PAGE_LOADING'); f.tabs[0].loading = false;
  f.tabs[0].url = 'https://unrelated.test'; await rejects(f.controller.invoke('owner', 'portio_read', { work }), 'SITE_CHANGED');
  assert.equal(f.executions(), 0);
});
test('navigation, revocation and user tab switches during reads suppress the result', async () => {
  for (const change of ['navigation', 'revoke', 'selection']) {
    const f = fixture(), { work } = await f.begin(); let finish;
    f.tabs[0].executeJavaScriptInIsolatedWorld = () => new Promise(resolve => { finish = resolve; });
    const pending = f.controller.invoke('owner', 'portio_read', { work });
    if (change === 'navigation') f.tabs[0].emit('did-start-navigation', {}, 'https://example.test/new', false, true);
    if (change === 'revoke') f.controller.revokeAll();
    if (change === 'selection') f.setSelected(null);
    finish({ text: 'must not return', elements: [] });
    await rejects(pending, { navigation: 'PAGE_CHANGED', revoke: 'ACCESS_REVOKED', selection: 'TAB_NOT_SELECTED' }[change]);
  }
});
test('snapshots are invalidated by navigation and consumed by actions', async () => {
  const f = fixture(), { work } = await f.begin();
  await f.controller.invoke('owner', 'portio_read', { work });
  const snapshot = f.controller.works.get(work).snapshot;
  await f.controller.invoke('owner', 'portio_click', { work, snapshot, ref: 'e1' });
  await rejects(f.controller.invoke('owner', 'portio_click', { work, snapshot, ref: 'e1' }), 'STALE_SNAPSHOT');
  await f.controller.invoke('owner', 'portio_read', { work });
  f.tabs[0].emit('did-start-navigation', {}, f.tabs[0].url, true, true);
  await rejects(f.controller.invoke('owner', 'portio_click', { work, snapshot: f.controller.works.get(work).snapshot || 'old', ref: 'e1' }), 'STALE_SNAPSHOT');
});
test('work limits and disabled access fail without creating extra tabs', async () => {
  const f = fixture(); for (let i = 0; i < 8; i++) await f.begin();
  await rejects(f.begin(), 'WORK_LIMIT'); assert.equal(f.tabs.length, 8);
  f.controller.setEnabled(false); await rejects(f.begin(), 'DISABLED'); assert.equal(f.controller.works.size, 0);
});
test('private local bridge rejects malformed authentication and revokes on stop', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portio-test-')), f = fixture();
  const bridge = new LocalBridge({ directory: dir, controller: f.controller });
  t.after(async () => { await bridge.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await bridge.start();
  assert.equal(fs.statSync(bridge.file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(bridge.socketDirectory).mode & 0o777, 0o700);
  const owner = 'a'.repeat(64);
  assert.equal((await callBridge(bridge.file, owner, 'portio_status')).enabled, true);
  for (const bad of [null, [], { token: 'é'.repeat(64), owner }, { token: 'b'.repeat(64), owner }]) {
    const response = await new Promise((resolve, reject) => { let received = ''; const s = net.createConnection(bridge.socketPath, () => s.end(JSON.stringify(bad) + '\n')); s.setTimeout(2000, () => { s.destroy(); reject(new Error('timeout')); }); s.on('data', b => { received += b; }); s.on('error', reject); s.on('close', () => resolve(received)); });
    assert.equal(response, '');
  }
  const { work } = await callBridge(bridge.file, owner, 'portio_begin', { space: 'personal', url: 'https://example.test' });
  await rejects(callBridge(bridge.file, 'b'.repeat(64), 'portio_read', { work }), 'WORK_NOT_FOUND');
  await bridge.stop(); assert.equal(fs.existsSync(bridge.file), false); assert.equal(f.controller.enabled, false); assert.equal(f.controller.works.size, 0);
  await Promise.all([bridge.start(), bridge.stop()]); assert.equal(f.controller.enabled, false); assert.equal(fs.existsSync(bridge.file), false);
});
