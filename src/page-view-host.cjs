// Keep only the selected page in the native view tree. Detached pages retain
// their WebContents and session, but cannot expose hidden controls to macOS.
class PageViewHost {
  constructor(parent) { this.parent = parent; this.current = null; this.bounds = null; }
  show(view, bounds) {
    const parent = this.parent();
    if (this.current !== view) {
      if (this.current) {
        this.current.setVisible(false);
        parent.removeChildView(this.current);
      }
      this.current = view;
      this.bounds = null;
      if (view) {
        view.setBounds(bounds);
        this.bounds = { ...bounds };
        parent.addChildView(view);
        view.setVisible(true);
      }
    } else if (view && ['x', 'y', 'width', 'height'].some(key => bounds[key] !== this.bounds[key])) {
      view.setBounds(bounds);
      this.bounds = { ...bounds };
    }
  }
  forget(view) {
    // Called after WebContents destruction: do not read or change the dead page.
    if (this.current !== view) return;
    this.parent().removeChildView(view);
    this.current = null;
    this.bounds = null;
  }
}
module.exports = { PageViewHost };
