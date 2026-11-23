// Run with Portio's bundled Electron runtime and ELECTRON_RUN_AS_NODE=1.
// Standard output is reserved for MCP JSON-RPC. No website content is logged.
const { randomBytes } = require('node:crypto');
const { MCPProtocol } = require('./protocol.cjs');
const { callBridge, defaultConnectionFile, MAX_MESSAGE } = require('./connection.cjs');
const owner = randomBytes(32).toString('hex');
const index = process.argv.indexOf('--connection-file');
const file = index === -1 ? defaultConnectionFile() : process.argv[index + 1];
const protocol = new MCPProtocol(async (name, args) => {
  try { return await callBridge(file, owner, name, args); }
  catch (e) { if (name === 'portio_status' && e.code === 'NOT_CONNECTED') return { enabled: false, available: false, message: e.publicMessage }; throw e; }
});
let buffer = '', queue = Promise.resolve(), pending = 0, exiting = false;
const output = v => { if (v) process.stdout.write(JSON.stringify(v) + '\n'); };
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => {
  buffer += data;
  if (Buffer.byteLength(buffer) > MAX_MESSAGE) { process.stderr.write('MCP request exceeds size limit.\n'); process.exit(1); }
  let end;
  while ((end = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    let request; try { request = JSON.parse(line); } catch { output({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    if (++pending > 32) { process.stderr.write('Too many queued requests.\n'); process.exit(1); }
    queue = queue.then(async () => { try { output(await protocol.handle(request)); } finally { pending--; } }).catch(() => { process.stderr.write('MCP request failed.\n'); });
  }
});
async function shutdown() { if (exiting) return; exiting = true; await queue; await callBridge(file, owner, 'disconnect').catch(() => {}); process.exit(0); }
process.stdin.on('end', shutdown); process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
