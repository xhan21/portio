// Synthetic Chromium regression tests. No real profile, credentials or external sites.
// Run: node_modules/.bin/electron tests/electron-ai-snapshot.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { app, BrowserWindow } = require('electron');
const baseline = process.argv.includes('--baseline');
const { pageOperation } = require(baseline ? '../.build/ai-snapshot-baseline.cjs' : '../src/ai/page.cjs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'portio-snapshot-test-'));
app.setName('Portio snapshot test'); app.setPath('userData', profile); app.enableSandbox();
const html = `<!doctype html><html><head><title>Synthetic editor</title><style>body{padding:24px}button,input,select{margin:12px;padding:12px}</style></head><body>
<div id="toolbar"><button id="share" onclick="window.clicks++;document.querySelector('#panel').hidden=false;fetch('/click')">共有</button></div>
<p id="activity">保存済み</p><div id="noise"></div><div id="panel" hidden>共有メニュー</div>
<label for="query" id="queryLabel">検索語</label><input id="query" value="old">
<select id="period"><option value="week">今週</option><option value="month">今月</option></select>
<form id="editForm" onsubmit="event.preventDefault()"><label>備考<input id="remark" value="before"></label><button type="button">保存</button></form>
<script>window.clicks=0;</script></body></html>`;
let server, win, origin, clicks = 0; const passed = [];
const exec = code => win.webContents.executeJavaScript(code);
const operation = (name, args) => win.webContents.executeJavaScriptInIsolatedWorld(1005, [{code:`(${pageOperation.toString()})(${JSON.stringify(name)},${JSON.stringify({origin,...args})})`}]);
let sequence=0;
const read = () => operation('read', { snapshot:'snapshot-'+(++sequence) });
const act = (s, name='共有', operationName='click', extra={}) => operation(operationName,{snapshot:s.snapshot,ref:s.elements.find(e=>e.name===name).ref,...extra});
async function fresh() { await win.webContents.loadURL(origin); }
async function unchangedNoClick(mutation, expected, name='共有', operationName='click', extra={}) {
 await fresh(); const s=await read(); await exec(mutation); const before=clicks; const result=await act(s,name,operationName,extra);
 assert.equal(result.error,expected,mutation);assert.equal(await exec('window.clicks'),0);assert.equal(clicks,before);
}
(async()=>{
 server=http.createServer((req,res)=>{if(req.url==='/click'){clicks++;res.end('ok');}else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 await app.whenReady(); win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});await fresh();
 const s=await read(); const start=Date.now();
 await exec("document.querySelector('#activity').textContent='自動保存中';document.querySelector('#noise').append(document.createElement('span'))");
 const result=await act(s);
 if(baseline){assert.equal(result.error,'STALE_SNAPSHOT');assert.equal(await exec('window.clicks'),0);console.log(JSON.stringify({baselineReproduced:true,error:result.error,elapsedMs:Date.now()-start,targetUnchanged:true}));return;}
 assert.equal(result.performed,'click');assert.equal(await exec('window.clicks'),1);assert.equal(await exec("document.querySelector('#panel').hidden"),false);
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(clicks,1);passed.push('unrelated text and sibling insertion allow share; independent server confirms one click');
 assert.equal((await act(s)).error,'STALE_SNAPSHOT');passed.push('snapshot is single use');
 await fresh();let editing=await read();await exec("document.querySelector('#activity').textContent='更新'");assert.equal((await act(editing,'検索語','fill',{text:'new'})).performed,'fill');
 editing=await read();await exec("document.querySelector('#activity').textContent='保存'");assert.equal((await act(editing,'SELECT','select',{value:'month'})).performed,'select');passed.push('unrelated updates also allow input and select');
 for(const code of [
  "document.querySelector('#share').textContent='削除'",
  "document.querySelector('#share').textContent='削除';document.querySelector('#share').textContent='共有'",
  "document.querySelector('#share').replaceWith(document.querySelector('#share').cloneNode(true))",
  "let b=document.querySelector('#share');b.remove();document.querySelector('#toolbar').append(b)",
  "document.querySelector('#toolbar').setAttribute('hidden','');document.querySelector('#toolbar').removeAttribute('hidden')"
 ])await unchangedNoClick(code,'STALE_SNAPSHOT');
 passed.push('changed, reverted, replaced, reinserted targets and ancestor transitions fail');
 await unchangedNoClick("document.querySelector('#queryLabel').textContent='別の項目'",'STALE_SNAPSHOT','検索語','fill',{text:'unsafe'});
 await unchangedNoClick("document.querySelector('#query').value='changed'",'STALE_ELEMENT','検索語','fill',{text:'unsafe'});await unchangedNoClick("document.querySelector('#remark').setAttribute('value','other')",'STALE_SNAPSHOT','保存');passed.push('external label, programmatic value and related form changes fail');
 await unchangedNoClick("let d=document.createElement('div');d.style='position:fixed;inset:0;background:white;z-index:9999';document.body.append(d)",'OBSCURED');passed.push('new overlay prevents click');
 await unchangedNoClick("history.pushState({},'', '/other')",'STALE_SNAPSHOT');passed.push('same-origin navigation fails');
 await fresh();const expired=await read();await win.webContents.executeJavaScriptInIsolatedWorld(1005,[{code:'globalThis.__portioAI.at -= 30001'}]);assert.equal((await act(expired)).error,'STALE_SNAPSHOT');passed.push('30 second expiration remains');
 await fresh();const pending=await read();const pendingArgs={origin,snapshot:pending.snapshot,ref:pending.elements.find(e=>e.name==='共有').ref};
 const queued=await win.webContents.executeJavaScriptInIsolatedWorld(1005,[{code:`document.querySelector('#share').textContent='削除';(${pageOperation.toString()})('click',${JSON.stringify(pendingArgs)})`}]);assert.equal(queued.error,'STALE_SNAPSHOT');passed.push('undelivered mutation records checked before action');
 fs.mkdirSync(path.join(__dirname,'../.build'),{recursive:true});
 fs.writeFileSync(path.join(__dirname,'../.build/snapshot-result.json'),JSON.stringify({electron:process.versions.electron,passed},null,2));console.log(JSON.stringify({ok:true,passed}));
})().then(()=>{win?.destroy();server?.close();app.quit();}).catch(e=>{console.error(e.stack);win?.destroy();server?.close();app.exit(1);}).finally(()=>fs.rmSync(profile,{recursive:true,force:true}));
