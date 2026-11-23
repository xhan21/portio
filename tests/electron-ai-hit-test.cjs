// Real Chromium hit testing with synthetic pages and a separate HTTP click log.
// No real profiles, course data or account information are used.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { app, BrowserWindow } = require('electron');
const baseline = process.argv.includes('--baseline');
const { pageOperation } = require(baseline ? '../.build/ai-hit-baseline.cjs' : '../src/ai/page.cjs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'portio-hit-test-'));
app.setName('Portio hit test'); app.setPath('userData', profile); app.enableSandbox();
const html = `<!doctype html><html><head><title>Synthetic cards</title><style>
body{margin:0;padding:30px}#row{position:relative;height:60px;margin-top:900px}
#target{position:absolute;inset:0 0 1px;background:#cdf}
#label{position:absolute;inset:0 56px 1px 76px;background:#eee}
</style></head><body><div id="row"><div id="target" role="button" aria-label="Open assignment" tabindex="0"></div><div id="label">Synthetic assignment</div></div>
<div id="panel" hidden>Assignment opened</div><script>
window.clicks=0;target.onclick=()=>{window.clicks++;panel.hidden=false;fetch('/click')};
</script></body></html>`;
let server, win, origin, requests = 0, sequence = 0;
const passed = [];
const exec = code => win.webContents.executeJavaScript(code);
const op = (name, args) => win.webContents.executeJavaScriptInIsolatedWorld(1005, [{code:`(${pageOperation.toString()})(${JSON.stringify(name)},${JSON.stringify({origin,...args})})`}]);
const read = () => op('read', {snapshot:'hit-'+(++sequence)});
const click = s => op('click', {snapshot:s.snapshot,ref:s.elements.find(e=>e.name==='Open assignment').ref});
async function fresh(setup = '') { await win.webContents.loadURL(origin); if (setup) await exec(setup); }
async function check(name, setup, expected, afterRead='') {
  await fresh(setup); const before=requests, s=await read();
  if(afterRead) await exec(afterRead);
  const result=await click(s);
  assert.equal(result.performed || result.error, expected, name);
  const clicks=expected==='click'?1:0;
  assert.equal(await exec('window.clicks'),clicks,name);
  assert.equal(await exec('panel.hidden'),!clicks,name);
  // Independently confirm the click reached the page's HTTP receiver once.
  for(let i=0;i<20 && requests<before+clicks;i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(requests,before+clicks,name);
  assert.equal((await click(s)).error,'STALE_SNAPSHOT',name+' consumes snapshot');
  passed.push(name);
}
(async()=>{
  server=http.createServer((req,res)=>{if(req.url==='/click'){requests++;res.end('ok');}else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  await app.whenReady();win=new BrowserWindow({show:false,width:1016,height:724,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await fresh();
  const geometry=await exec(`(()=>{target.scrollIntoView({block:'center'});const r=target.getBoundingClientRect();return {centreHitsSibling:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===label,edgeHitsTarget:document.elementFromPoint(r.x+2,r.y+r.height/2)===target}})()`);
  assert.deepEqual(geometry,{centreHitsSibling:true,edgeHitsTarget:true});
  if(baseline){const r=await click(await read());assert.equal(r.error,'OBSCURED');assert.equal(await exec('window.clicks'),0);console.log(JSON.stringify({baselineReproduced:true,...geometry,error:r.error}));return;}
  await check('card sibling covers centre but exposed control can open','', 'click');
  win.setSize(480,560);
  await check('narrow viewport and scroll retain an exposed point','', 'click');
  win.setSize(1016,724);
  await check('fully covering sibling is rejected despite same parent',"label.style.inset='0'",'OBSCURED');
  await check('unrelated overlay added after read blocks all points','', 'OBSCURED',"let o=document.createElement('div');o.style='position:fixed;inset:0;background:white;z-index:99';document.body.append(o)");
  await check('pointer-events none does not authorize parent or sibling',"target.style.pointerEvents='none'",'OBSCURED');
  await check('zero width target never borrows a neighbouring point',"target.style.width='0'",'OBSCURED');
  await check('fully clipped target is rejected',"row.style.cssText='height:0;overflow:clip';target.style.cssText='top:0;bottom:auto;height:60px'",'OBSCURED');
  await check('descendant labels remain valid hits',"target.append(label)",'click');
  await check('small exposed controls remain clickable',"label.remove();target.style.cssText='width:1px;height:1px'",'click');
  await check('partially clipped control uses the visible fragment',"label.remove();row.style.cssText='width:40px;overflow:clip';target.style.cssText='left:-900px;right:auto;width:940px;height:60px'",'click');
  await check('target replacement after read still fails','', 'STALE_SNAPSHOT',"target.replaceWith(target.cloneNode(true))");
  await check('same-origin URL change still fails','', 'STALE_SNAPSHOT',"history.pushState({},'', '/changed')");
  fs.mkdirSync(path.join(__dirname,'../.build'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'../.build/hit-test-result.json'),JSON.stringify({electron:process.versions.electron,passed,requests},null,2));
  console.log(JSON.stringify({ok:true,passed,requests}));
})().then(()=>{win?.destroy();server?.close();app.quit();}).catch(e=>{console.error(e.stack);win?.destroy();server?.close();app.exit(1);}).finally(()=>fs.rmSync(profile,{recursive:true,force:true}));
