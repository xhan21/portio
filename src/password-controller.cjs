const { randomUUID } = require('node:crypto');
const { passwordOrigin } = require('./passwords.cjs');
const { inspectFields, fillFields } = require('./password-fields.cjs');
const { name } = require('./core.cjs');
const { PasswordOffers } = require('./password-offers.cjs');
const WORLD = 1004;
class PasswordController {
  constructor({ store, Menu, popup, dialog, current, window, space, canSuggest, changed, authenticate = async () => false }) {
    Object.assign(this, { store, Menu, popup, dialog, current, window, space, canSuggest, changed, authenticate });
    this.settings = null; this.context = null; this.menu = null; this.pending = false;
    this.operation = 0; this.authenticating = false;
    this.suggestionEpoch = 0;
    this.offers = new PasswordOffers({ store, dialog, authenticate, current, space, window, available: () => !this.settings && !this.authenticating && this.canSuggest() });
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
  cancelMenu() { this.suggestionEpoch++; this.popup?.hide(); if (this.menu) { this.menu.closePopup(this.window()); this.menu = null; } }
  revoke(clearOffers = true) { this.operation++; this.cancelMenu(); if (clearOffers) this.offers.revoke(); }
  invalidate(t) {
    t.passwordGeneration = (t.passwordGeneration || 0) + 1;
    clearTimeout(t.passwordTimer); this.revoke(false);
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
      t.passwordTimer = setTimeout(() => this.suggest(t), 180);
    };
    wc.on('before-mouse-event', (_event, mouse) => { if (mouse.type === 'mouseDown') this.cancelMenu(); if (mouse.type === 'mouseUp' && mouse.button === 'left') schedule(); });
    wc.on('before-input-event', (event, input) => {
      if (this.popup?.key(input)) { event.preventDefault(); return; }
      if (input.type === 'keyDown' && !['ArrowDown', 'ArrowUp', 'Enter'].includes(input.key)) this.cancelMenu();
      if (input.type === 'keyUp' && !input.isComposing && !['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Meta', 'Control', 'Shift', 'Alt'].includes(input.key)) schedule();
    });
    wc.on('ipc-message', (event, channel, data) => { if (channel === 'duo:login-submit') { this.cancelMenu(); void this.offers.receive(t, event, data); } });
    wc.on('did-start-navigation', details => { if (details.isMainFrame) this.invalidate(t); });
    wc.on('destroyed', () => { this.invalidate(t); this.offers.revoke(); });
  }
  async inspect(c, capture) {
    if (!this.same(c)) return null;
    const ticket = randomUUID();
    const result = await c.wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${inspectFields.toString()})(${JSON.stringify(ticket)}, ${capture ? 'true' : 'false'})` }]);
    return this.same(c) && result?.origin === c.origin && result.ticket === ticket ? result : null;
  }
  async suggest(t) {
    if (this.pending || this.authenticating || this.offers.busy || this.settings || this.menu || !this.canSuggest() || t !== this.current() || !t.wc?.isFocused()) return;
    const c = this.contextFor(t);
    if (!c) return;
    this.pending = true;
    const epoch = this.suggestionEpoch;
    try {
      let entries = await this.store.list(t.space, c.origin);
      if (!entries.length || !this.same(c) || !t.wc.isFocused()) return;
      const target = await this.inspect(c, false);
      if (!target || epoch !== this.suggestionEpoch || !this.same(c) || !this.canSuggest() || this.settings) return;
      if (target.kind === 'username' && target.prefix) entries = entries.filter(entry => entry.username.toLocaleLowerCase().startsWith(target.prefix.toLocaleLowerCase()));
      entries = entries.slice(0, 5);
      if (!entries.length) { this.popup?.hide(); return; }
      if (this.popup) {
        await this.popup.show({ items: entries, origin: `${name(t.space)} · ${c.origin}`, rect: target.rect, viewBounds: t.view.getBounds(), source: c.wc, onChoose: id => this.fill(c, target, id) });
        return;
      }
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
    if (this.authenticating || !this.same(c) || this.settings || !this.canSuggest()) return;
    const operation = ++this.operation;
    const valid = () => operation === this.operation && this.same(c) && !this.settings && this.canSuggest();
    this.authenticating = true;
    try {
      if (await this.authenticate(`Portio：${name(c.t.space)}用の ${c.origin} にログイン情報を入力`) !== true || !valid()) return;
      const saved = await this.store.get(c.t.space, c.origin, id);
      if (!saved || !valid()) return;
      const payload = { ticket: target.ticket, origin: c.origin, username: saved.username, password: saved.password };
      await c.wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${fillFields.toString()})(${JSON.stringify(payload)})` }]);
      if (this.same(c)) c.wc.focus();
    } catch { /* Navigation or removed input: leave the page unchanged. */ }
    finally { this.authenticating = false; }
  }
  async open() {
    this.revoke();
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
    if (kind === 'passwords-close') { this.revoke(); this.settings = null; this.context = null; this.changed(); return; }
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
      const operation = ++this.operation;
      try {
        const previous = settings.entries.find(e => e.origin === c.origin && e.username === data.username.trim());
        if (previous) {
          const result = await this.dialog.showMessageBox(this.window(), { type: 'question', message: '保存したパスワードを更新しますか？', detail: `${name(settings.space)}用スペース\n${c.origin}\n${previous.username}`, buttons: ['キャンセル', '更新する'], defaultId: 0, cancelId: 0 });
          if (result.response !== 1) return;
          if (await this.authenticate(`Portio：${name(settings.space)}用の ${c.origin} の保存情報を更新`) !== true) {
            settings.error = '本人確認が完了しなかったため、更新していません。'; return;
          }
        }
        if (operation !== this.operation || !this.same(c) || this.settings !== settings) return;
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
      const operation = ++this.operation;
      try {
        const result = await this.dialog.showMessageBox(this.window(), { type: 'question', message: '保存したログイン情報を削除しますか？', detail: `${name(settings.space)}用スペース\n${entry.origin}\n${entry.username}`, buttons: ['キャンセル', '削除する'], defaultId: 0, cancelId: 0 });
        if (result.response !== 1 || this.settings !== settings) return;
        if (await this.authenticate(`Portio：${name(settings.space)}用の ${entry.origin} の保存情報を削除`) !== true) {
          settings.error = '本人確認が完了しなかったため、削除していません。'; return;
        }
        if (operation !== this.operation || this.settings !== settings) return;
        await this.store.remove(settings.space, entry.id);
        settings.entries = await this.store.list(settings.space); settings.error = '';
      } catch { settings.error = '削除できませんでした。保存先を確認してください。'; }
      finally { settings.busy = false; if (this.settings === settings) this.changed(); }
    }
  }
}
module.exports = { PasswordController };
