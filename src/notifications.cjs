const fs = require('node:fs');
const path = require('node:path');
const { SPACES, webURL } = require('./core.cjs');

// Remember notifications only. Camera, microphone and clipboard remain session-only.
function notificationOrigin(input) {
  if (typeof input !== 'string' || input.length > 8192 || /[\r\n\0]/.test(input)) return null;
  const valid = webURL(input);
  if (!valid) return null;
  const url = new URL(valid);
  return url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? url.origin : null;
}
function notificationContext(requestingURL, topURL, embeddingOrigin) {
  const origin = notificationOrigin(requestingURL);
  if (!origin || (topURL != null && notificationOrigin(topURL) !== origin) || (embeddingOrigin != null && notificationOrigin(embeddingOrigin) !== origin)) return null;
  return origin;
}
class NotificationStore {
  constructor(file) {
    this.file = file;
    this.spaces = Object.fromEntries(SPACES.map(space => [space, new Map()]));
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== 1) return;
      for (const space of SPACES) {
        for (const entry of Array.isArray(data.spaces?.[space]) ? data.spaces[space].slice(0, 200) : []) {
          if (typeof entry?.origin === 'string' && notificationOrigin(entry.origin) === entry.origin && typeof entry.allowed === 'boolean') this.spaces[space].set(entry.origin, entry.allowed);
        }
      }
    } catch { /* Missing or malformed files do not grant any permissions. */ }
  }
  get(space, origin) { return this.spaces[space]?.get(origin); }
  list(space) { return [...(this.spaces[space] || [])].map(([origin, allowed]) => ({ origin, allowed })).sort((a, b) => a.origin.localeCompare(b.origin)); }
  set(space, origin, allowed) {
    if (!SPACES.includes(space) || !origin || notificationOrigin(origin) !== origin || ![true, false, null].includes(allowed)) throw new Error('Invalid notification setting');
    const next = new Map(this.spaces[space]);
    if (allowed === null) next.delete(origin); else next.set(origin, allowed);
    if (next.size > 200) throw new Error('Too many notification settings');
    const data = { version: 1, spaces: Object.fromEntries(SPACES.map(s => [s, [...(s === space ? next : this.spaces[s])].map(([origin, allowed]) => ({ origin, allowed }))])) };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
    this.spaces[space] = next;
  }
}
module.exports = { NotificationStore, notificationOrigin, notificationContext };
