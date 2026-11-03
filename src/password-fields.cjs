// These functions run in an isolated JavaScript world. They expose no Electron,
// Node, IPC, password list or permanent bridge to the website.
function inspectFields(ticket, capture = false) {
  const visible = e => e instanceof HTMLInputElement && e.isConnected && !e.disabled && !e.readOnly && e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).display !== 'none' && Number(getComputedStyle(e).opacity) > 0 && e.getBoundingClientRect().width > 8 && e.getBoundingClientRect().height > 8;
  const excluded = e => /(?:^|\s)(?:new-password|one-time-code)(?:\s|$)/i.test(e.autocomplete) || /(?:otp|verification|one.?time|search)/i.test(e.name + ' ' + e.id);
  const text = e => visible(e) && ['text', 'email', 'tel'].includes(e.type) && !excluded(e);
  const password = e => visible(e) && e.type === 'password' && !excluded(e);
  const inputs = Array.from(document.querySelectorAll('input')).slice(0, 1000);
  let target = document.activeElement;
  if (capture && !password(target)) {
    const candidates = inputs.filter(password);
    target = candidates.length === 1 ? candidates[0] : target;
  }
  if (!(target instanceof HTMLInputElement) || (!password(target) && !text(target))) return null;
  const group = inputs.filter(e => e.form === target.form);
  const secrets = group.filter(password);
  // Do not put a current password into sign-up/change-password/OTP forms.
  if (group.some(e => visible(e) && e.type === 'password' && excluded(e)) || secrets.length > 1) return null;
  const pass = secrets[0] || null;
  let user = text(target) ? target : group.find(e => text(e) && /(?:^|\s)username(?:\s|$)/i.test(e.autocomplete));
  if (!user && pass) user = group.slice(0, group.indexOf(pass)).filter(text).at(-1) || null;
  const looksLikeUsername = user && (user.type === 'email' || /(?:^|\s)username(?:\s|$)/i.test(user.autocomplete) || /(?:user|login|email|account|identifier)/i.test(user.name + ' ' + user.id));
  if (!pass && !looksLikeUsername) return null;
  const form = target.form;
  if (form && new URL(form.action || location.href, location.href).origin !== location.origin) return null;
  globalThis.__portioPasswordTarget = { ticket, target, user, pass, form, action: form?.action, origin: location.origin };
  return { ticket, origin: location.origin, kind: target.type === 'password' ? 'password' : 'username',
    ...(capture ? { username: user && user.value.length <= 320 ? user.value : '', password: pass && pass.value.length <= 4096 ? pass.value : '' } : {}) };
}
function fillFields(payload) {
  const saved = globalThis.__portioPasswordTarget;
  delete globalThis.__portioPasswordTarget;
  if (!saved || saved.ticket !== payload.ticket || saved.origin !== payload.origin || location.origin !== payload.origin) return false;
  const usable = e => e instanceof HTMLInputElement && e.isConnected && !e.disabled && !e.readOnly && e.getClientRects().length && getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).display !== 'none' && Number(getComputedStyle(e).opacity) > 0 && e.getBoundingClientRect().width > 8 && e.getBoundingClientRect().height > 8;
  if (!usable(saved.target) || saved.target.form !== saved.form || saved.form?.action !== saved.action) return false;
  if (saved.form && new URL(saved.form.action || location.href, location.href).origin !== payload.origin) return false;
  const excluded = e => /(?:^|\s)(?:new-password|one-time-code)(?:\s|$)/i.test(e.autocomplete);
  if (saved.user && (!usable(saved.user) || !['text', 'email', 'tel'].includes(saved.user.type) || saved.user.form !== saved.form || excluded(saved.user))) return false;
  if (saved.pass && (!usable(saved.pass) || saved.pass.type !== 'password' || saved.pass.form !== saved.form || excluded(saved.pass))) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  // Set both fields before dispatching website handlers, then report normal input
  // events. No submit/click/Enter action is performed.
  if (saved.user) setter.call(saved.user, payload.username);
  if (saved.pass) setter.call(saved.pass, payload.password);
  for (const field of [saved.user, saved.pass].filter(Boolean)) {
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}
module.exports = { inspectFields, fillFields };
