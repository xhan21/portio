const { test } = require('node:test');
const assert = require('node:assert/strict');
const { touchIDAuthenticator } = require('../src/password-auth.cjs');

test('Touch ID adapter fails closed on unsupported devices, missing APIs, OS errors and cancellation', async () => {
  for (const mode of ['unsupported-platform', 'unavailable', 'missing-api', 'cancel', 'exception']) {
    let prompts = 0;
    const systemPreferences = mode === 'missing-api' ? {} : {
      canPromptTouchID() { if (mode === 'exception') throw new Error('OS error'); return mode !== 'unavailable'; },
      async promptTouchID() { prompts++; throw new Error('Cancelled'); }
    };
    const authenticate = touchIDAuthenticator({ platform: mode === 'unsupported-platform' ? 'linux' : 'darwin', systemPreferences, window: () => ({}), dialog: { showMessageBox: async () => ({ response: 0 }) } });
    assert.equal(await authenticate('Synthetic test'), false, mode);
    assert.equal(prompts, mode === 'cancel' ? 1 : 0, mode);
  }
});

test('Touch ID adapter waits for OS success and never caches or shares it', async () => {
  let approve, prompts = 0;
  const authenticate = touchIDAuthenticator({ platform: 'darwin', systemPreferences: { canPromptTouchID: () => true, promptTouchID(reason) { assert.equal(reason, 'Synthetic test'); prompts++; return new Promise(resolve => { approve = resolve; }); } } });
  const first = authenticate('Synthetic test');
  assert.equal(await authenticate('Synthetic test'), false); assert.equal(prompts, 1);
  approve(); assert.equal(await first, true);
  const second = authenticate('Synthetic test'); assert.equal(prompts, 2);
  approve(); assert.equal(await second, true);
});
