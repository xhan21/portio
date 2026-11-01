const { app, BrowserWindow, WebContentsView, session, ipcMain, Menu, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { NotificationStore, notificationContext } = require('./notifications.cjs');
const { SPACES, SERVICES, name, webURL, resolveAddress, restorable, readState, preferences, shortcutData, reorderTabs } = require('./core.cjs');

// Keep the original internal name: Chromium uses it for the cookie-encryption Keychain entry.
app.setName('Duo Chromium');
app.setPath('userData', path.join(app.getPath('appData'), 'DuoChromium'));
app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(start);

const uiFile = path.join(__dirname, 'ui', 'index.html');
const uiURL = pathToFileURL(uiFile).href;
const stateFile = path.join(app.getPath('userData'), 'session.json');
const notifications = new NotificationStore(path.join(app.getPath('userData'), 'notifications.json'));
const pendingNotifications = new Map();
const spaces = Object.fromEntries(SPACES.map(s => [s, { tabs: [], selected: null, shortcuts: [] }]));
const sessions = {};
let win, active = 'personal', sequence = 0, saveTimer, closing = false, finishing = false;
let shortcutEditor = null;
let notificationSettings = false, notificationError = '';
const current = () => spaces[active].tabs.find(t => t.id === spaces[active].selected);
const contents = t => t?.wc && !t.wc.isDestroyed() ? t.wc : null;
const partition = s => 'persist:duo-' + s;
const servicesFor = space => [...SERVICES.filter(s => space === 'university' || s.id !== 'classroom'), ...spaces[space].shortcuts.map(s => ({ ...s, custom: true, mark: '↗', hint: new URL(s.url).hostname }))];
function command(value) { try { return JSON.parse(value); } catch { return null; } }

function snapshot() {
  return { version: 1, active, spaces: Object.fromEntries(SPACES.map(s => [s, {
    selected: Math.max(0, spaces[s].tabs.findIndex(t => t.id === spaces[s].selected)),
    shortcuts: spaces[s].shortcuts,
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
    version: app.getVersion(), active, spaceName: name(active), services: servicesFor(active), shortcutEditor,
    notificationSettings: notificationSettings ? { entries: notifications.list(active), error: notificationError } : null,
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
    t.view.setVisible(t === selected && !shortcutEditor && !notificationSettings);
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
  ses.setPermissionCheckHandler((wc, permission, origin, details) => {
    if (permission !== 'notifications') return grants.has(key(origin, permission));
    if (wc?.isDestroyed()) return false;
    const site = notificationContext(origin, wc ? wc.getURL() : null, details.embeddingOrigin);
    if (details.requestingUrl && notificationContext(details.requestingUrl, site) !== site) return false;
    return !!site && notifications.get(space, site) === true;
  });
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const labels = { 'clipboard-read': 'クリップボードの読み取り', 'clipboard-sanitized-write': 'クリップボードへの書き込み', notifications: '通知の表示', fullscreen: '全画面表示', media: 'カメラ・マイクの使用' };
    if (!labels[permission] || !wc || wc.isDestroyed() || !webURL(details.requestingUrl || wc.getURL())) return callback(false);
    const origin = new URL(details.requestingUrl || wc.getURL()).origin;
    if (permission === 'notifications') {
      const site = notificationContext(details.requestingUrl || wc.getURL(), wc.getURL());
      if (!site || !win || win.isDestroyed() || closing) return callback(false);
      const known = notifications.get(space, site);
      if (known !== undefined) return callback(known);
      const requestKey = key(space, site);
      if (!pendingNotifications.has(requestKey)) {
        const decision = (async () => {
          const { response } = await dialog.showMessageBox(win, { type: 'question', message: '通知の表示を許可しますか？', detail: `${name(space)}用スペース\n${site}\nこの選択を保存し、次回の起動後も使います。\n「サイトの通知」からリセットできます。`, buttons: ['許可しない', '許可する'], defaultId: 0, cancelId: 0 });
          if (wc.isDestroyed() || notificationContext(site, wc.getURL()) !== site || closing) return false;
          const allowed = response === 1;
          try { notifications.set(space, site, allowed); }
          catch {
            await dialog.showMessageBox(win, { type: 'warning', message: '通知の設定を保存できませんでした。', detail: '保存先の空き容量を確認してください。今回は通知を許可していません。' });
            return false;
          }
          publish();
          return allowed;
        })().catch(() => false).finally(() => pendingNotifications.delete(requestKey));
        pendingNotifications.set(requestKey, decision);
      }
      const allowed = await pendingNotifications.get(requestKey);
      return callback(allowed && !wc.isDestroyed() && notificationContext(site, wc.getURL()) === site);
    }
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
  dialog.showMessageBox(win, { title: 'Portioの使い方', message: '個人と大学、ふたつの作業場所。', detail: `左側でスペースを選び、最初にそれぞれのアカウントでログインしてください。Canvaなどのログイン状態はスペースごとに保存します。\n\n「すぐに開く」の「＋ 追加」から、名前とURLを登録できます。追加した項目の「…」で編集・削除できます。タブのタイトルを左右にドラッグすると順番を変えられます。\n\nChromeやSafariとは別にログインしてください。Google・大学の認証方式によっては、このアプリからログインできない場合があります。\n\nPortio自体の月額料金はありません。この試作版にブラウザの自動更新はありません。更新版への入れ替えが必要です。\n\nPortio ${app.getVersion()} / Chromium ${process.versions.chrome}` });
}
function focusAddress() { win.webContents.focus(); win.webContents.send('duo:focus-address'); }
function action(kind, value) {
  if (shortcutEditor && !['state', 'shortcut-save', 'shortcut-remove', 'shortcut-cancel', 'help'].includes(kind)) return;
  if (notificationSettings && !['state', 'notifications-reset', 'notifications-close', 'help'].includes(kind)) return;
  const t = current(), wc = contents(t);
  switch (kind) {
    case 'state': publish(); break;
    case 'notifications': notificationSettings = true; notificationError = ''; update(); break;
    case 'notifications-close': notificationSettings = false; update(); break;
    case 'notifications-reset': {
      if (!notificationSettings || notifications.get(active, value) === undefined) break;
      try { notifications.set(active, value, null); notificationError = ''; }
      catch { notificationError = '設定を保存できませんでした。保存先の空き容量を確認してください。'; }
      publish(); break;
    }
    case 'space': if (SPACES.includes(value)) { active = value; update(); } break;
    case 'new': newTab(active); break;
    case 'select': if (spaces[active].tabs.some(t => t.id === value)) { spaces[active].selected = value; update(); } break;
    case 'reorder': {
      const move = command(value);
      if (move?.space !== active) break;
      const next = reorderTabs(spaces[active].tabs, move.id, move.beforeId);
      if (next !== spaces[active].tabs) { spaces[active].tabs = next; update(); }
      break;
    }
    case 'shortcut-add': shortcutEditor = { space: active, id: null, name: '', url: '', error: '' }; update(); break;
    case 'shortcut-edit': {
      const shortcut = spaces[active].shortcuts.find(s => s.id === value);
      if (shortcut) { shortcutEditor = { ...shortcut, space: active, error: '' }; update(); }
      break;
    }
    case 'shortcut-save': {
      if (!shortcutEditor || shortcutEditor.space !== active) break;
      const data = shortcutData(command(value));
      if (!data) { shortcutEditor.error = '名前（40文字以内）と、http:// または https:// で始まるURLを入力してください。'; publish(); break; }
      const list = spaces[active].shortcuts;
      const existing = list.find(s => s.id === shortcutEditor.id);
      if (existing) {
        if (existing.url !== data.url) for (const tab of spaces[active].tabs) if (tab.service === existing.id) tab.service = null;
        Object.assign(existing, data);
      } else if (list.length < 20) list.push({ id: 'custom-' + randomUUID(), ...data });
      else { shortcutEditor.error = '追加できる項目は、各スペース20件までです。'; publish(); break; }
      shortcutEditor = null; update(); break;
    }
    case 'shortcut-remove': {
      if (!shortcutEditor?.id || shortcutEditor.space !== active) break;
      spaces[active].shortcuts = spaces[active].shortcuts.filter(s => s.id !== shortcutEditor.id);
      for (const tab of spaces[active].tabs) if (tab.service === shortcutEditor.id) tab.service = null;
      shortcutEditor = null; update(); break;
    }
    case 'shortcut-cancel': shortcutEditor = null; update(); break;
    case 'close': closeTab(spaces[active].tabs.find(t => t.id === value)); break;
    case 'navigate': { const url = resolveAddress(value); if (url) load(t, url); else { t.error = 'httpまたはhttpsのアドレスを入力してください。'; update(); } break; }
    case 'service': {
      const service = servicesFor(active).find(s => s.id === value);
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
  app.setAboutPanelOptions({
    applicationName: 'Portio',
    applicationVersion: app.getVersion(),
    version: '',
    copyright: 'Copyright © 2026 Xu Han',
    credits: 'MIT License\nhttps://github.com/xhan21/portio'
  });
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
    spaces[s].shortcuts = saved.spaces[s].shortcuts;
    const restored = saved.spaces[s].tabs.map(t => newTab(s, t));
    spaces[s].selected = restored[saved.spaces[s].selected].id;
  }
  ipcMain.handle('duo:action', (event, kind, value) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== uiURL) throw new Error('Untrusted sender');
    if (typeof kind !== 'string' || (value !== undefined && typeof value !== 'string')) return;
    action(kind, value);
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Portio', submenu: [{ label: 'Portioについて', click: () => app.showAboutPanel() }, { label: 'サイトの通知…', click: () => action('notifications') }, { type: 'separator' }, { role: 'hide', label: 'Portioを隠す' }, { role: 'hideOthers', label: 'ほかを隠す' }, { role: 'unhide', label: 'すべてを表示' }, { type: 'separator' }, { label: 'Portioを終了', accelerator: 'CmdOrCtrl+Q', click: () => win.close() }] },
    { label: 'ファイル', submenu: [{ label: '新しいタブ', accelerator: 'CmdOrCtrl+T', click: () => action('new') }, { label: 'タブを閉じる', accelerator: 'CmdOrCtrl+W', click: () => closeTab(current()) }, { label: 'アドレスを入力', accelerator: 'CmdOrCtrl+L', click: focusAddress }] },
    { label: '編集', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '表示', submenu: [{ label: '個人', accelerator: 'CmdOrCtrl+1', click: () => action('space', 'personal') }, { label: '大学', accelerator: 'CmdOrCtrl+2', click: () => action('space', 'university') }, { label: '再読み込み', accelerator: 'CmdOrCtrl+R', click: () => action('reload') }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu', label: 'ウインドウ' },
    { role: 'help', label: 'ヘルプ', submenu: [{ label: 'Portioの使い方', click: help }] }
  ]));
  win.loadFile(uiFile);
}
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.on('before-quit', event => { if (win && !finishing) { event.preventDefault(); win.close(); } });
app.on('window-all-closed', () => { if (!win) app.quit(); });
