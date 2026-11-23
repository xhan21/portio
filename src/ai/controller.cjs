const { randomUUID } = require('node:crypto');
const { webURL, SPACES } = require('../core.cjs');
const { pageOperation } = require('./page.cjs');
const { validate } = require('./protocol.cjs');
class AIError extends Error {
  constructor(code, message) { super(code); this.code = code; this.publicMessage = message; }
}
const deny = (code, message) => { throw new AIError(code, message); };
const timeout = (promise, ms = 15000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new AIError('TIMEOUT', '操作結果を確認できませんでした。再実行する前にportio_readで確認してください。')), ms); })]).finally(() => clearTimeout(timer));
};
class AIController {
  constructor({ createTab, canOperate, isSelected, changed = () => {} }) { Object.assign(this, { createTab, canOperate, isSelected, changed }); this.works = new Map(); this.enabled = false; this.epoch = 0; }
  setEnabled(value) { this.enabled = value; if (!value) this.revokeAll(); this.changed(); }
  invalidateSnapshots() { this.epoch++; for (const w of this.works.values()) w.snapshot = null; }
  revokeAll() { this.invalidateSnapshots(); for (const w of [...this.works.values()]) this.release(w); }
  release(w) { w.wc.removeListener('did-start-navigation', w.onNavigation); w.wc.removeListener('destroyed', w.onDestroyed); this.works.delete(w.id); this.changed(); }
  releaseOwner(owner) { for (const w of [...this.works.values()]) if (w.owner === owner) this.release(w); }
  assertReady() { if (!this.enabled) deny('DISABLED', 'Portioの「AI連携」を有効にしてください。'); if (!this.canOperate()) deny('BUSY', 'Portioの設定画面・ダイアログを閉じ、Macが操作できる状態で再試行してください。'); }
  context(owner, id) {
    this.assertReady();
    const w = this.works.get(id);
    if (!w || w.owner !== owner || w.wc.isDestroyed()) deny('WORK_NOT_FOUND', 'この接続の作業がありません。portio_beginで開始してください。');
    if (!this.isSelected(w.wc, w.space)) deny('TAB_NOT_SELECTED', '作業用タブが選択されていません。Portioで対象のスペースとタブを選択してから続けてください。');
    if (w.wc.isLoadingMainFrame()) deny('PAGE_LOADING', 'ページの読み込み中です。完了後にportio_readで確認してください。');
    let url; try { url = new URL(w.wc.getURL()); } catch {}
    if (!url || url.origin !== w.origin || !['http:', 'https:'].includes(url.protocol)) deny('SITE_CHANGED', '目的のサイト以外へ移動したため停止しました。対象サイトを確認して新しい作業を開始してください。');
    return w;
  }
  async invoke(owner, name, args) {
    validate(name, args);
    if (name === 'portio_status') return { enabled: this.enabled, available: this.enabled && this.canOperate(), works: [...this.works.values()].filter(w => w.owner === owner).length };
    if (name === 'portio_end') { const w = this.works.get(args.work); if (!w || w.owner !== owner) deny('WORK_NOT_FOUND', 'この接続の作業がありません。'); this.release(w); return { released: true, tabKeptOpen: true }; }
    this.assertReady();
    if (name === 'portio_begin') {
      const url = webURL(args.url);
      if (!url || !SPACES.includes(args.space)) deny('INVALID_DESTINATION', '正しいスペースとhttp(s)のURLを指定してください。');
      if (this.works.size >= 8) deny('WORK_LIMIT', '同時に開始できる作業は8件です。終了した作業をportio_endで解除してください。');
      const wc = this.createTab(args.space, url);
      const w = { id: randomUUID(), owner, wc, space: args.space, origin: new URL(url).origin, generation: 0, snapshot: null };
      w.onNavigation = (details, _url, _inPlace, main) => { if (details.isMainFrame ?? main) { w.generation++; w.snapshot = null; } };
      w.onDestroyed = () => this.release(w);
      wc.on('did-start-navigation', w.onNavigation); wc.once('destroyed', w.onDestroyed);
      this.works.set(w.id, w); this.changed();
      return { work: w.id, space: w.space, site: w.origin, next: 'portio_read', note: '新しい作業用タブを開きました。読み込み完了後に内容を確認してください。' };
    }
    const w = this.context(owner, args.work), epoch = this.epoch, generation = w.generation;
    const operation = name.slice('portio_'.length);
    if (operation !== 'read' && (!w.snapshot || w.snapshot !== args.snapshot)) deny('STALE_SNAPSHOT', 'portio_readで操作情報を取り直してください。');
    const snapshot = operation === 'read' ? randomUUID() : args.snapshot;
    w.snapshot = null;
    let result;
    try { result = await timeout(w.wc.executeJavaScriptInIsolatedWorld(1005, [{ code: `(${pageOperation.toString()})(${JSON.stringify(operation)},${JSON.stringify({ ...args, origin: w.origin, snapshot })})` }])); }
    catch (e) { if (e instanceof AIError) throw e; deny('PAGE_UNAVAILABLE', 'ページの処理を確認できませんでした。再実行前にportio_readで確認してください。'); }
    if (!this.enabled || this.epoch !== epoch || this.works.get(w.id) !== w) deny('ACCESS_REVOKED', 'AI連携または作業へのアクセスが解除されました。');
    if (result?.error) deny(result.error, result.message);
    if (operation !== 'read') return { work: w.id, ...result };
    // Never return a read which raced with a navigation, close, lock or revoke.
    this.context(owner, args.work);
    if (w.generation !== generation) deny('PAGE_CHANGED', '確認中に画面が移動しました。portio_readで取り直してください。');
    w.snapshot = snapshot;
    const u = new URL(w.wc.getURL());
    const response = { work: w.id, space: w.space, url: u.origin + u.pathname, title: w.wc.getTitle().slice(0, 180), ...result };
    while (Buffer.byteLength(JSON.stringify(response)) > 80000 && response.elements.length) { response.elements.pop(); response.truncated = true; }
    return response;
  }
}
module.exports = { AIController, AIError };
