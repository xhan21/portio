// Sandboxed, isolated, outbound-only observer. No API is exposed to the site.
const { ipcRenderer } = require('electron');
if (process.isMainFrame) {
  const touched = new WeakSet();
  const visible = e => e instanceof HTMLInputElement && e.isConnected && !e.disabled && !e.readOnly && e.getClientRects().length && getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).display !== 'none' && Number(getComputedStyle(e).opacity) > 0;
  const excluded = e => /new-password|one-time-code/i.test(e.autocomplete) || /otp|verification|one.?time|search/i.test(e.name + ' ' + e.id);
  const username = e => visible(e) && ['email', 'text', 'tel'].includes(e.type) && !excluded(e) && (e.type === 'email' || /username/i.test(e.autocomplete) || /user|login|email|account|identifier/i.test(e.name + ' ' + e.id));
  function capture(form) {
    const fields = Array.from(document.querySelectorAll('input')).slice(0, 1000).filter(e => e.form === form);
    if (form && new URL(form.action || location.href, location.href).origin !== location.origin) return;
    const passwords = fields.filter(e => visible(e) && e.type === 'password');
    if (passwords.length > 1 || passwords.some(excluded)) return;
    const pass = passwords[0], user = fields.find(username);
    if (!fields.some(e => touched.has(e))) return;
    const value = user?.value || '', secret = pass?.value || '';
    if (value.length > 320 || secret.length > 4096 || /[\r\n\0]/.test(value) || /\0/.test(secret)) return;
    if (pass ? !secret : !value.trim()) return;
    ipcRenderer.send('duo:login-submit', { origin: location.origin, username: value, password: secret });
  }
  document.addEventListener('input', event => { if (event.isTrusted && event.target instanceof HTMLInputElement) touched.add(event.target); }, true);
  // Capture before the site's handlers navigate away, including common SPA buttons.
  document.addEventListener('click', event => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const button = event.target.closest('button,input[type=submit],input[type=image],[role=button]');
    if (!button) return;
    const label = (button.innerText || button.value || button.getAttribute('aria-label') || '').trim();
    if ((button.form && button.type === 'submit') || /^(?:log\s*in|sign\s*in|next|continue|ログイン|サインイン|次へ|続行)$/i.test(label)) capture(button.form || document.activeElement?.form || null);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.isTrusted && event.key === 'Enter' && !event.isComposing && event.target instanceof HTMLInputElement) capture(event.target.form);
  }, true);
  document.addEventListener('submit', event => { if (event.isTrusted) capture(event.target); }, true);
}
