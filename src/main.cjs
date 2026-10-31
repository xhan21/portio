const { app, BrowserWindow, WebContentsView, session, ipcMain, Menu, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { SPACES, SERVICES, name, webURL, resolveAddress, restorable, readState, preferences } = require('./core.cjs');

// Keep the original internal name: Chromium uses it for the cookie-encryption Keychain entry.
app.setName('Duo Chromium');
app.setPath('userData', path.join(app.getPath('appData'), 'DuoChromium'));
app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(start);

const uiFile = path.join(__dirname, 'ui', 'index.html');
const uiURL = pathToFileURL(uiFile).href;
const stateFile = path.join(app.getPath('userData'), 'session.json');
const spaces = Object.fromEntries(SPACES.map(s => [s, { tabs: [], selected: null }]));
const sessions = {};
let win, active = 'personal', sequence = 0, saveTimer, closing = false, finishing = false;
const current = () => spaces[active].tabs.find(t => t.id === spaces[active].selected);
const contents = t => t?.wc && !t.wc.isDestroyed() ? t.wc : null;
const partition = s => 'persist:duo-' + s;

function snapshot() {
  return { version: 1, active, spaces: Object.fromEntries(SPACES.map(s => [s, {
    selected: Math.max(0, spaces[s].tabs.findIndex(t => t.id === spaces[s].selected)),
    tabs: spaces[s].tabs.map(t => ({ url: restorable(t.url), service: t.service }))
  }])) };
}
function saveNow() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(snapshot()), { mode: 0o600 });
    fs.renameSync(stateFile + '.tmp', stateFile);
  } catch { if (current()) current().error = 'タブの保存に失敗しました。保存先の空き容量を確認してください。'; }
}
function publish() {
  if (!win || win.isDestroyed() || closing) return;
  const tab = current();
  win.setTitle(`${name(active)} — Portio`);
  win.webContents.send('duo:state', {
    version: app.getVersion(), active, spaceName: name(active), services: SERVICES.filter(s => active === 'university' || s.id !== 'classroom'),
    tabs: spaces[active].tabs.map(t => ({ id: t.id, title: t.title, selected: t.id === tab?.id, loading: t.loading })),
    current: tab ? { id: tab.id, url: tab.url, home: !tab.view, loading: tab.loading, error: tab.error, back: contents(tab)?.navigationHistory.canGoBack() || false, forward: contents(tab)?.navigationHistory.canGoForward() || false } : null
  });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
}
function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const selected = current();
  for (const s of SPACES) for (const t of spaces[s].tabs) if (contents(t)) {
    t.view.setVisible(t === selected);
    t.view.setBounds({ x: 224, y: t.error ? 138 : 96, width: Math.max(1, width - 224), height: Math.max(1, height - (t.error ? 138 : 96)) });
  }
}
function update() { layout(); publish(); }
function newTab(space, options = {}) {
  const t = { id: String(++sequence), space, title: 'スタート', url: '', service: options.service || null, loading: false, error: '', view: null, wc: null };
  spaces[space].tabs.push(t);
  spaces[space].selected = t.id;
  if (options.windowOptions) makeView(t, options.windowOptions);
  if (options.url) load(t, options.url);
  update();
  return t;
}
function makeView(t, windowOptions = {}) {
  if (contents(t)) return;
  // Electron supplies an existing webContents for window.open. Adopt that exact
  // instance so the opener, redirects and OAuth response target remain connected.
  t.view = new WebContentsView({ ...windowOptions, webPreferences: { ...windowOptions.webPreferences, ...preferences(partition(t.space)), session: sessions[t.space], preload: undefined } });
  t.view.setBackgroundColor('#ffffff');
  const wc = t.view.webContents;
  t.wc = wc;
  win.contentView.addChildView(t.view);
  const refreshURL = () => { t.url = wc.getURL(); t.error = ''; update(); };
  wc.on('did-start-loading', () => { t.loading = true; update(); });
  wc.on('did-stop-loading', () => { t.loading = false; update(); });
  wc.on('did-navigate', refreshURL);
  wc.on('did-navigate-in-page', (_e, _url, main) => { if (main) refreshURL(); });
  wc.on('page-title-updated', (_e, title) => { t.title = title || 'ページ'; publish(); });
  wc.on('did-fail-load', (_e, code, _description, _url, main) => {
    if (main && code !== -3) { t.error = `ページを開けませんでした（${code}）。アドレスと通信状態を確認してください。`; t.loading = false; update(); }
  });
  wc.on('render-process-gone', () => { t.error = 'ページの処理が停止しました。再読み込みしてください。'; update(); });
  // Keep protocol boundaries and the privileged local UI separate from all web pages.
  const allowed = url => url === 'about:blank' || !!webURL(url);
  wc.on('will-navigate', (event, url) => { if (!allowed(url)) { event.preventDefault(); t.error = 'この種類のリンクはPortioでは開けません。'; update(); } });
  wc.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  wc.on('will-frame-navigate', event => { if (/^(file|javascript|devtools|chrome):/i.test(event.url)) event.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => {
    if (!allowed(url)) return { action: 'deny' };
    return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: preferences(partition(t.space)) }, createWindow: options => {
      const popup = newTab(t.space, { windowOptions: options });
      active = t.space; update();
      return popup.view.webContents;
    } };
  });
  wc.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(win, { type: 'question', message: 'このページを閉じますか？', detail: '編集中の内容が保存されていない可能性があります。', buttons: ['編集を続ける', '閉じる'], defaultId: 0, cancelId: 0 });
    if (response === 1) event.preventDefault();
    else if (closing) {
      closing = false;
      // Reopen only pages already closed during this quit attempt; the cancelling page stays intact.
      for (const s of SPACES) for (const previous of spaces[s].tabs) if (previous.view && !contents(previous)) {
        previous.view = null; if (previous.url) load(previous, previous.url);
      }
      update();
    }
  });
  wc.on('destroyed', () => {
    t.wc = null;
    if (win && !win.isDestroyed()) win.contentView.removeChildView(t.view);
    if (closing) { finishClose(); return; }
    const list = spaces[t.space].tabs;
    const index = list.indexOf(t);
    if (index !== -1) list.splice(index, 1);
    if (!list.length) newTab(t.space);
    else if (spaces[t.space].selected === t.id) spaces[t.space].selected = list[Math.max(0, index - 1)].id;
    update();
  });
  wc.on('context-menu', (_e, params) => {
    const items = [];
    if (params.linkURL && webURL(params.linkURL)) items.push({ label: 'このスペースの新しいタブで開く', click: () => newTab(t.space, { url: params.linkURL }) });
    if (params.selectionText) items.push({ role: 'copy', label: 'コピー' });
    if (params.isEditable) items.push({ role: 'cut', label: '切り取り' }, { role: 'paste', label: '貼り付け' }, { role: 'selectAll', label: 'すべて選択' });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}
function load(t, input) {
  const url = webURL(input);
  if (!url) return;
  makeView(t); t.url = url; t.error = ''; t.title = new URL(url).hostname;
  contents(t).loadURL(url).catch(() => {});
  update();
}
function closeTab(t) {
  if (!t) return;
  if (contents(t)) contents(t).close({ waitForBeforeUnload: true });
  else {
    spaces[t.space].tabs = spaces[t.space].tabs.filter(other => other !== t);
    if (!spaces[t.space].tabs.length) newTab(t.space);
    else if (spaces[t.space].selected === t.id) spaces[t.space].selected = spaces[t.space].tabs.at(-1).id;
    update();
  }
}
function setupSession(space) {
  const ses = session.fromPartition(partition(space));
  sessions[space] = ses;
  const grants = new Set();
  const key = (origin, permission) => `${origin}|${permission}`;
  ses.setPermissionCheckHandler((_wc, permission, origin) => grants.has(key(origin, permission)));
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const labels = { 'clipboard-read': 'クリップボードの読み取り', 'clipboard-sanitized-write': 'クリップボードへの書き込み', notifications: '通知の表示', fullscreen: '全画面表示', media: 'カメラ・マイクの使用' };
    if (!labels[permission] || !wc || wc.isDestroyed() || !webURL(details.requestingUrl || wc.getURL())) return callback(false);
    const origin = new URL(details.requestingUrl || wc.getURL()).origin;
    if (grants.has(key(origin, permission))) return callback(true);
    const { response } = await dialog.showMessageBox(win, { type: 'question', message: `${labels[permission]}を許可しますか？`, detail: `${name(space)}用スペース\n${origin}\n許可はPortioの終了まで有効です。`, buttons: ['許可しない', '許可する'], defaultId: 0, cancelId: 0 });
    if (response === 1) grants.add(key(origin, permission));
    callback(response === 1);
  });
  ses.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: `${name(space)} — ファイルを保存`, defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
    item.once('done', (_event, state) => {
      if (state === 'interrupted' && win) dialog.showMessageBox(win, { message: 'ダウンロードが中断されました。もう一度お試しください。' });
    });
  });
}
function help() {
  dialog.showMessageBox(win, { title: 'Portioについて', message: '個人と大学、ふたつの作業場所。', detail: `左側でスペースを選び、最初にそれぞれのアカウントでログインしてください。Canvaなどのログイン状態はスペースごとに保存します。\n\n旧Duo Chromiumのログイン状態と設定は引き継ぎます。ChromeやSafariとは別にログインしてください。Google・大学の認証方式によっては、このアプリからログインできない場合があります。\n\nPortio自体の月額料金はありません。この試作版にブラウザの自動更新はありません。更新版への入れ替えが必要です。\n\nPortio ${app.getVersion()} / Chromium ${process.versions.chrome}` });
}
function focusAddress() { win.webContents.focus(); win.webContents.send('duo:focus-address'); }
function action(kind, value) {
  const t = current(), wc = contents(t);
  switch (kind) {
    case 'state': publish(); break;
    case 'space': if (SPACES.includes(value)) { active = value; update(); } break;
    case 'new': newTab(active); break;
    case 'select': if (spaces[active].tabs.some(t => t.id === value)) { spaces[active].selected = value; update(); } break;
    case 'close': closeTab(spaces[active].tabs.find(t => t.id === value)); break;
    case 'navigate': { const url = resolveAddress(value); if (url) load(t, url); else { t.error = 'httpまたはhttpsのアドレスを入力してください。'; update(); } break; }
    case 'service': {
      const service = SERVICES.find(s => s.id === value && (active === 'university' || s.id !== 'classroom'));
      if (!service) break;
      const existing = spaces[active].tabs.find(t => t.service === value);
      if (existing) { spaces[active].selected = existing.id; if (!existing.view) load(existing, service.url); update(); }
      else if (t && !t.view) { t.service = value; load(t, service.url); }
      else newTab(active, { url: service.url, service: value });
      break;
    }
    case 'back': if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
    case 'forward': if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
    case 'reload': if (wc) t.loading ? wc.stop() : wc.reload(); break;
    case 'home': { const home = spaces[active].tabs.find(t => !t.view); if (home) { spaces[active].selected = home.id; update(); } else newTab(active); break; }
    case 'dismiss': if (t) { t.error = ''; update(); } break;
    case 'help': help(); break;
  }
}
async function finishClose() {
  if (!closing || finishing || SPACES.some(s => spaces[s].tabs.some(t => contents(t)))) return;
  finishing = true;
  try { await Promise.race([Promise.all(Object.values(sessions).map(s => s.cookies.flushStore())), new Promise(resolve => setTimeout(resolve, 3000))]); } catch { /* OS also persists the partition. */ }
  for (const s of Object.values(sessions)) s.flushStorageData();
  win.destroy(); win = null; app.quit();
}
function start() {
  SPACES.forEach(setupSession);
  win = new BrowserWindow({ width: 1240, height: 820, minWidth: 960, minHeight: 640, title: 'Portio', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 20 }, backgroundColor: '#f8faf9', show: false, webPreferences: { ...preferences('duo-ui'), preload: path.join(__dirname, 'preload.cjs') } });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('did-finish-load', update);
  win.on('resize', layout);
  win.once('ready-to-show', () => { win.show(); update(); });
  win.on('close', event => {
    if (finishing) return;
    event.preventDefault();
    if (closing) return;
    saveNow(); closing = true;
    for (const s of SPACES) for (const t of spaces[s].tabs) { if (!closing) return; contents(t)?.close({ waitForBeforeUnload: true }); }
    finishClose();
  });
  let saved;
  try { saved = readState(JSON.parse(fs.readFileSync(stateFile, 'utf8'))); } catch { saved = readState(null); }
  active = saved.active;
  for (const s of SPACES) {
    const restored = saved.spaces[s].tabs.map(t => newTab(s, t));
    spaces[s].selected = restored[saved.spaces[s].selected].id;
  }
  ipcMain.handle('duo:action', (event, kind, value) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== uiURL) throw new Error('Untrusted sender');
    if (typeof kind !== 'string' || (value !== undefined && typeof value !== 'string')) return;
    action(kind, value);
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Portio', submenu: [{ label: 'Portioについて', click: help }, { type: 'separator' }, { role: 'hide', label: 'Portioを隠す' }, { role: 'hideOthers', label: 'ほかを隠す' }, { role: 'unhide', label: 'すべてを表示' }, { type: 'separator' }, { label: 'Portioを終了', accelerator: 'CmdOrCtrl+Q', click: () => win.close() }] },
    { label: 'ファイル', submenu: [{ label: '新しいタブ', accelerator: 'CmdOrCtrl+T', click: () => action('new') }, { label: 'タブを閉じる', accelerator: 'CmdOrCtrl+W', click: () => closeTab(current()) }, { label: 'アドレスを入力', accelerator: 'CmdOrCtrl+L', click: focusAddress }] },
    { label: '編集', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '表示', submenu: [{ label: '個人', accelerator: 'CmdOrCtrl+1', click: () => action('space', 'personal') }, { label: '大学', accelerator: 'CmdOrCtrl+2', click: () => action('space', 'university') }, { label: '再読み込み', accelerator: 'CmdOrCtrl+R', click: () => action('reload') }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }
  ]));
  win.loadFile(uiFile);
}
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.on('before-quit', event => { if (win && !finishing) { event.preventDefault(); win.close(); } });
app.on('window-all-closed', () => { if (!win) app.quit(); });
