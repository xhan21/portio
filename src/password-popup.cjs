const path = require('node:path');
const { pathToFileURL } = require('node:url');
// A separate trusted surface keeps usernames out of the site's DOM. It never
// receives passwords and does not take keyboard focus from the input field.
class PasswordPopup {
  constructor({ WebContentsView, parent }) { this.WebContentsView = WebContentsView; this.parent = parent; this.items = []; this.selected = -1; this.serial = 0; }
  ensure() {
    if (this.view && !this.view.webContents.isDestroyed()) return;
    const file = path.join(__dirname, 'ui', 'password-popup.html');
    const url = pathToFileURL(file).href;
    this.view = new this.WebContentsView({ webPreferences: { partition: 'duo-password-popup', preload: path.join(__dirname, 'password-popup-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    this.view.setVisible(false);
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.view.webContents.on('will-navigate', e => e.preventDefault());
    this.view.webContents.on('ipc-message', (event, channel, payload) => {
      if (channel !== 'duo:password-choice' || event.senderFrame !== this.view.webContents.mainFrame || event.senderFrame.url !== url || payload?.serial !== this.serial) return;
      this.choose(payload.index);
    });
    this.ready = this.view.webContents.loadFile(file);
  }
  async show({ items, origin, rect, viewBounds, onChoose, source }) {
    this.ensure(); this.items = items; this.onChoose = onChoose; this.selected = -1;
    const serial = ++this.serial;
    await this.ready;
    if (serial !== this.serial || !this.items.length || this.view.webContents.isDestroyed()) return;
    const [parentWidth, parentHeight] = this.parent().getContentSize();
    const parent = { x: 0, y: 0, width: parentWidth, height: parentHeight };
    const width = Math.min(420, Math.max(280, parent.width - viewBounds.x));
    const height = 44 + items.length * 42;
    const x = Math.round(Math.max(parent.x, Math.min(parent.x + parent.width - width, parent.x + viewBounds.x + rect.x)));
    let y = parent.y + viewBounds.y + rect.y + rect.height + 4;
    if (y + height > parent.y + parent.height) y = Math.max(parent.y, parent.y + viewBounds.y + rect.y - height - 4);
    this.view.setBounds({ x, y: Math.round(y), width, height });
    this.view.webContents.send('duo:password-candidates', { serial, origin, usernames: items.map(e => e.username), details: items.map(e => e.detail || ''), selected: -1 });
    const contentView = this.parent().contentView;
    if (!contentView.children.includes(this.view)) contentView.addChildView(this.view);
    this.view.setVisible(true);
    if (source && !source.isDestroyed()) source.focus();
  }
  choose(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) return;
    const entry = this.items[index], choose = this.onChoose; this.hide(); choose?.(entry.id);
  }
  key(input) {
    if (!this.items.length || input.type !== 'keyDown') return false;
    if (input.key === 'Escape') { this.hide(); return true; }
    if (input.key === 'ArrowDown' || input.key === 'ArrowUp') {
      this.selected = this.selected < 0 ? (input.key === 'ArrowDown' ? 0 : this.items.length - 1) : (this.selected + (input.key === 'ArrowDown' ? 1 : this.items.length - 1)) % this.items.length;
      this.view?.webContents.send('duo:password-highlight', this.selected); return true;
    }
    if (input.key === 'Enter' && this.selected >= 0) { this.choose(this.selected); return true; }
    if (input.key === 'Tab') this.hide();
    return false;
  }
  hide() {
    this.serial++; this.items = []; this.onChoose = null;
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.webContents.send('duo:password-candidates', { serial: this.serial, origin: '', usernames: [], details: [] });
      this.view.setVisible(false);
      this.parent().contentView.removeChildView(this.view);
    }
  }
  destroy() { this.hide(); this.view?.webContents.close(); }
}
module.exports = { PasswordPopup };
