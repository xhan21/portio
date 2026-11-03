const { randomUUID } = require('node:crypto');
const { passwordOrigin } = require('./passwords.cjs');
const { inspectFields, fillFields } = require('./password-fields.cjs');
const { name } = require('./core.cjs');
const WORLD = 1004;
class PasswordController {
  constructor({ store, Menu, dialog, current, window, space, canSuggest, changed }) {
    Object.assign(this, { store, Menu, dialog, current, window, space, canSuggest, changed });
    this.settings = null; this.context = null; this.menu = null; this.pending = false;
  }
  contextFor(t = this.current()) {
    const wc = t?.wc;
    if (!wc || wc.isDestroyed() || t.error || wc.isLoadingMainFrame()) return null;
    const origin = passwordOrigin(wc.getURL());
    return origin ? { t, wc, origin, frame: wc.mainFrame, generation: t.passwordGeneration || 0 } : null;
  }
  same(c) {
    return c && c.t === this.current() && c.t.space === this.space() && c.wc === c.t.wc && !c.wc.isDestroyed() && !c.wc.isLoadingMainFrame() &&
      c.generation === (c.t.passwordGeneration || 0) && c.frame === c.wc.mainFrame && passwordOrigin(c.wc.getURL()) === c.origin && !c.t.error;
  }
  cancelMenu() { if (this.menu) { this.menu.closePopup(this.window()); this.menu = null; } }
  invalidate(t) {
    t.passwordGeneration = (t.passwordGeneration || 0) + 1;
    clearTimeout(t.passwordTimer); this.cancelMenu();
    if (this.context?.t === t && this.settings) {
      this.context = null; this.settings.origin = null; this.settings.editor = null;
      this.settings.error = 'ページが移動しました。保存するサイトを開いてから、もう一度「パスワード」を開いてください。';
      this.changed();
    }
  }
  attach(t) {
    const wc = t.wc;
    const schedule = () => {
      clearTimeout(t.passwordTimer);
      t.passwordTimer = setTimeout(() => this.suggest(t), 70);
    };
    wc.on('before-mouse-event', (_event, mouse) => { if (mouse.type === 'mouseUp' && mouse.button === 'left') schedule(); });
    wc.on('before-input-event', (_event, input) => { if (input.type === 'keyUp' && input.key === 'Tab') schedule(); });
    wc.on('did-start-navigation', details => { if (details.isMainFrame) this.invalidate(t); });
    wc.on('destroyed', () => this.invalidate(t));
  }
  async inspect(c, capture) {
    if (!this.same(c)) return null;
    const ticket = randomUUID();
    const result = await c.wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${inspectFields.toString()})(${JSON.stringify(ticket)}, ${capture ? 'true' : 'false'})` }]);
    return this.same(c) && result?.origin === c.origin && result.ticket === ticket ? result : null;
  }
  async suggest(t) {
    if (this.pending || this.settings || this.menu || !this.canSuggest() || t !== this.current() || !t.wc?.isFocused()) return;
    const c = this.contextFor(t);
    if (!c) return;
    this.pending = true;
    try {
      const entries = await this.store.list(t.space, c.origin);
      if (!entries.length || !this.same(c) || !t.wc.isFocused()) return;
      const target = await this.inspect(c, false);
      if (!target || !this.same(c) || !this.canSuggest() || this.settings) return;
      const menu = this.Menu.buildFromTemplate([
        { label: `Portio · ${name(t.space)} · ${c.origin}`, enabled: false },
        ...entries.map(entry => ({ label: entry.username + '  ••••••••', click: () => this.fill(c, target, entry.id) })),
        { type: 'separator' }, { label: '保存したログイン情報を管理…', click: () => this.open() }
      ]);
      this.menu = menu;
      menu.popup({ window: this.window(), callback: () => { if (this.menu === menu) this.menu = null; } });
    } catch { /* A locked/damaged vault never discloses or fills a secret. Open settings for a message. */ }
    finally { this.pending = false; }
  }
  async fill(c, target, id) {
    try {
      if (!this.same(c) || this.settings || !this.canSuggest()) return;
      const saved = await this.store.get(c.t.space, c.origin, id);
      if (!saved || !this.same(c) || this.settings || !this.canSuggest()) return;
      const payload = { ticket: target.ticket, origin: c.origin, username: saved.username, password: saved.password };
      await c.wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${fillFields.toString()})(${JSON.stringify(payload)})` }]);
      if (this.same(c)) c.wc.focus();
    } catch { /* Navigation or removed input: leave the page unchanged. */ }
  }
  async open() {
    this.cancelMenu();
    const settings = { space: this.space(), origin: null, entries: [], editor: null, busy: true, error: '' };
    this.context = this.contextFor(); settings.origin = this.context?.origin || null;
    this.settings = settings; this.changed();
    try { settings.entries = await this.store.list(settings.space); }
    catch { settings.error = '保存したログイン情報を開けませんでした。Macのキーチェーンへのアクセスと保存先を確認してください。'; }
    finally { settings.busy = false; if (this.settings === settings) this.changed(); }
  }
  async act(kind, value) {
    if (kind === 'passwords') { if (!this.settings) await this.open(); return; }
    const settings = this.settings;
    if (!settings || settings.space !== this.space() || settings.busy) return;
    if (kind === 'passwords-close') { this.settings = null; this.context = null; this.changed(); return; }
    if (kind === 'password-cancel') { settings.editor = null; settings.error = ''; this.changed(); return; }
    if (kind === 'password-add') {
      const c = this.context;
      if (!this.same(c)) { settings.error = '保存するサイトを開いてから、もう一度「パスワード」を開いてください。'; this.changed(); return; }
      settings.busy = true; this.changed();
      let draft;
      try { draft = await this.inspect(c, true); } catch { /* Manual entry remains available. */ }
      settings.busy = false;
      if (!this.same(c) || this.settings !== settings) { if (this.settings === settings) this.changed(); return; }
      const token = randomUUID(); settings.editor = token; settings.error = ''; this.changed();
      // The draft goes once to the trusted app UI, never to general state or disk.
      return { token, username: draft?.username || '', password: draft?.password || '' };
    }
    if (kind === 'password-save') {
      const c = this.context;
      let data; try { data = JSON.parse(value); } catch { return; }
      if (!settings.editor || data?.token !== settings.editor || !this.same(c)) return;
      if (typeof data.username !== 'string' || !data.username.trim() || data.username.length > 320 || /[\r\n\0]/.test(data.username) || typeof data.password !== 'string' || !data.password || data.password.length > 4096 || /\0/.test(data.password)) {
        settings.error = 'アカウント名とパスワードを入力してください。'; this.changed(); return;
      }
      settings.busy = true; settings.error = ''; this.changed();
      try {
        const previous = settings.entries.find(e => e.origin === c.origin && e.username === data.username.trim());
        if (previous) {
          const result = await this.dialog.showMessageBox(this.window(), { type: 'question', message: '保存したパスワードを更新しますか？', detail: `${name(settings.space)}用スペース\n${c.origin}\n${previous.username}`, buttons: ['キャンセル', '更新する'], defaultId: 0, cancelId: 0 });
          if (result.response !== 1) return;
        }
        if (!this.same(c) || this.settings !== settings) return;
        await this.store.save(settings.space, c.origin, data.username, data.password);
        settings.entries = await this.store.list(settings.space); settings.editor = null;
      } catch { settings.error = '保存できませんでした。Macのキーチェーンへのアクセスと保存先の空き容量を確認してください。'; }
      finally { settings.busy = false; if (this.settings === settings) this.changed(); }
      return;
    }
    if (kind === 'password-remove') {
      const entry = settings.entries.find(e => e.id === value);
      if (!entry) return;
      settings.busy = true; this.changed();
      try {
        const result = await this.dialog.showMessageBox(this.window(), { type: 'question', message: '保存したログイン情報を削除しますか？', detail: `${name(settings.space)}用スペース\n${entry.origin}\n${entry.username}`, buttons: ['キャンセル', '削除する'], defaultId: 0, cancelId: 0 });
        if (result.response !== 1 || this.settings !== settings) return;
        await this.store.remove(settings.space, entry.id);
        settings.entries = await this.store.list(settings.space); settings.error = '';
      } catch { settings.error = '削除できませんでした。保存先を確認してください。'; }
      finally { settings.busy = false; if (this.settings === settings) this.changed(); }
    }
  }
}
module.exports = { PasswordController };
