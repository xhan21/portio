const SPACES = ['personal', 'university'];
const SERVICES = [
  { id: 'mail', name: 'Gmail', hint: 'メールを確認', mark: 'M', url: 'https://mail.google.com/' },
  { id: 'drive', name: 'Drive', hint: 'ファイルを開く', mark: 'D', url: 'https://drive.google.com/drive/my-drive' },
  { id: 'calendar', name: 'カレンダー', hint: '予定を確認', mark: '31', url: 'https://calendar.google.com/' },
  { id: 'canva', name: 'Canva', hint: 'デザインを始める', mark: 'C', url: 'https://www.canva.com/' },
  { id: 'classroom', name: 'Classroom', hint: '授業・課題を確認', mark: '授', url: 'https://classroom.google.com/' }
];
const name = space => space === 'university' ? '大学' : '個人';
function webURL(input) {
  try {
    const url = new URL(input);
    return ['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function resolveAddress(input) {
  if (typeof input !== 'string' || input.length > 8192 || /[\r\n\0]/.test(input)) return null;
  const text = input.trim();
  if (!text) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(text) && !/^localhost:\d/.test(text)) return webURL(text);
  if (!/\s/.test(text) && (text.includes('.') || /^localhost(?::\d+)?(?:\/|$)/.test(text))) {
    return webURL((/^localhost(?:[:/]|$)|^127\.0\.0\.1(?:[:/]|$)/.test(text) ? 'http://' : 'https://') + text);
  }
  return 'https://www.google.com/search?q=' + encodeURIComponent(text);
}
function restorable(input) {
  const valid = webURL(input);
  if (!valid) return null;
  const url = new URL(valid);
  if (url.hostname === 'accounts.google.com' || /^(login|auth|sso)\./i.test(url.hostname)) return null;
  if (/(?:^|\/)(?:oauth2?|callback|signin|login|saml)(?:\/|$)/i.test(url.pathname)) return null;
  const sensitive = /^(?:code|state|token|access_token|id_token|refresh_token|samlresponse|samlrequest|ticket|assertion)$/i;
  if ([...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()].some(k => sensitive.test(k))) return null;
  return valid;
}
function readState(value) {
  const result = { version: 1, active: SPACES.includes(value?.active) ? value.active : 'personal', spaces: {} };
  for (const space of SPACES) {
    const raw = value?.spaces?.[space];
    const tabs = Array.isArray(raw?.tabs) ? raw.tabs.slice(0, 20).map(t => ({ url: restorable(t?.url), service: SERVICES.some(s => s.id === t?.service) ? t.service : null })) : [];
    result.spaces[space] = { tabs: tabs.length ? tabs : [{ url: null, service: null }], selected: Number.isInteger(raw?.selected) ? Math.max(0, Math.min(raw.selected, Math.max(0, tabs.length - 1))) : 0 };
  }
  return result;
}
function preferences(partition) {
  return { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, safeDialogs: true, navigateOnDragDrop: false };
}
module.exports = { SPACES, SERVICES, name, webURL, resolveAddress, restorable, readState, preferences };
