const { createHash } = require('node:crypto');
const { passwordOrigin } = require('./passwords.cjs');
const { name } = require('./core.cjs');
class PasswordOffers {
  constructor({ store, dialog, authenticate, current, space, window, available }) {
    Object.assign(this, { store, dialog, authenticate, current, space, window, available });
    this.epoch = 0; this.busy = false; this.seen = new Set(); this.identifiers = new WeakMap();
  }
  revoke() { this.epoch++; this.identifiers = new WeakMap(); }
  async receive(t, event, data) {
    const wc = t.wc;
    // No page-controlled target, file name, space or channel is accepted.
    if (!wc || wc.isDestroyed() || event.senderFrame !== wc.mainFrame || t !== this.current() || t.space !== this.space() || !this.available()) return;
    const origin = passwordOrigin(event.senderFrame.url);
    if (!origin || origin !== passwordOrigin(wc.getURL()) || data?.origin !== origin || typeof data.username !== 'string' || data.username.length > 320 || /[\r\n\0]/.test(data.username) || typeof data.password !== 'string' || data.password.length > 4096 || /\0/.test(data.password)) return;
    let username = data.username.trim();
    if (!data.password) { if (username) this.identifiers.set(t, { origin, username, expires: Date.now() + 120000 }); return; }
    if (!username) { const prior = this.identifiers.get(t); if (prior?.origin === origin && prior.expires > Date.now()) username = prior.username; }
    if (!username || this.busy) return;
    this.identifiers.delete(t);
    const digest = createHash('sha256').update(JSON.stringify([t.space, origin, username, data.password])).digest('hex');
    if (this.seen.has(digest)) return;
    this.seen.add(digest); if (this.seen.size > 100) this.seen.delete(this.seen.values().next().value);
    const epoch = this.epoch;
    const valid = () => epoch === this.epoch && t === this.current() && t.space === this.space() && !wc.isDestroyed() && this.available();
    this.busy = true;
    try {
      const status = await this.store.compare(t.space, origin, username, data.password);
      if (!valid() || status === 'same') return;
      const updating = status === 'changed';
      const result = await this.dialog.showMessageBox(this.window(), {
        type: 'question', message: updating ? 'パスワードを更新しますか？' : 'ログイン情報を保存しますか？',
        detail: `${name(t.space)}用スペース\n${origin}\n${username}\n\nこのMacに暗号化して保存します。入力した内容が正しいことを確認してください。`,
        buttons: ['今回は保存しない', updating ? '更新する' : '保存する'], defaultId: 1, cancelId: 0
      });
      if (result.response !== 1 || !valid()) return;
      if (updating && (await this.authenticate(`Portio：${name(t.space)}用の ${origin} の保存情報を更新`) !== true || !valid())) return;
      await this.store.save(t.space, origin, username, data.password);
    } catch {
      if (valid()) await this.dialog.showMessageBox(this.window(), { type: 'warning', message: 'ログイン情報を保存できませんでした', detail: 'Macのキーチェーンへのアクセスと保存先を確認してください。鍵ボタンから保存し直せます。', buttons: ['閉じる'] });
    } finally { this.busy = false; }
  }
}
module.exports = { PasswordOffers };
