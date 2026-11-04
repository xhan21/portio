const $ = id => document.getElementById(id);
const act = (kind, value) => window.duo.act(kind, value).catch(() => {});
let passwordEditor = null, passwordListKey = '';
let state, drawnServices = '', drawnNotifications = '', shownTab = '', drag = null, scrollFrame = 0, suppressClick = false;
function el(tag, className, text) { const item = document.createElement(tag); item.className = className; if (text !== undefined) item.textContent = text; return item; }
function drawTabs() {
  reconcileTabs($('tabs'), state.tabs, act);
  const selected = state.active + ':' + state.tabs.find(t => t.selected)?.id;
  if (selected !== shownTab) {
    shownTab = selected;
    $('tabs').querySelector('.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
function clearDropMark() { for (const tab of $('tabs').children) tab.classList.remove('drop-before', 'drop-after'); }
function dropBefore(x) {
  return [...$('tabs').children].find(tab => tab.dataset.id !== drag.id && x < tab.getBoundingClientRect().left + tab.offsetWidth / 2)?.dataset.id ?? null;
}
function markDrop() {
  clearDropMark();
  const beforeId = dropBefore(drag.x);
  const target = beforeId === null ? $('tabs').lastElementChild : [...$('tabs').children].find(t => t.dataset.id === beforeId);
  target?.classList.add(beforeId === null ? 'drop-after' : 'drop-before');
}
function insideTabs() {
  const rect = $('tabs').getBoundingClientRect();
  return drag.x >= rect.left && drag.x <= rect.right && drag.y >= rect.top - 10 && drag.y <= rect.bottom + 10;
}
function scrollDrag() {
  if (!drag?.started) return;
  const rect = $('tabs').getBoundingClientRect();
  const speed = !insideTabs() ? 0 : drag.x < rect.left + 36 ? -10 : drag.x > rect.right - 36 ? 10 : 0;
  if (speed) { $('tabs').scrollLeft += speed; markDrop(); }
  scrollFrame = requestAnimationFrame(scrollDrag);
}
function finishDrag(redraw = true) {
  const previous = drag; drag = null;
  cancelAnimationFrame(scrollFrame); scrollFrame = 0;
  if (previous?.element.hasPointerCapture(previous.pointerId)) previous.element.releasePointerCapture(previous.pointerId);
  document.body.classList.remove('tab-dragging'); clearDropMark();
  if (redraw) drawTabs();
}
$('tabs').addEventListener('pointerdown', event => {
  const choose = event.target.closest('.tab-select');
  if (!choose || event.button !== 0 || state.shortcutEditor || state.notificationSettings || state.passwordSettings) return;
  drag = { id: choose.closest('.tab').dataset.id, space: state.active, ids: state.tabs.map(t => t.id).join(','), x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId, element: choose, started: false };
  choose.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.x = event.clientX; drag.y = event.clientY;
  if (!drag.started && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
  event.preventDefault(); drag.started = true;
  document.body.classList.add('tab-dragging'); drag.element.closest('.tab').classList.add('dragging');
  if (insideTabs()) markDrop(); else clearDropMark();
  if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollDrag);
});
document.addEventListener('pointerup', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.x = event.clientX; drag.y = event.clientY;
  const started = drag.started;
  const move = started && insideTabs() && drag.space === state.active ? { space: drag.space, id: drag.id, beforeId: dropBefore(drag.x) } : null;
  if (started) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
  finishDrag(started);
  if (move) act('reorder', JSON.stringify(move));
});
document.addEventListener('click', event => { if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
for (const name of ['pointercancel', 'lostpointercapture']) document.addEventListener(name, event => { if (drag?.pointerId === event.pointerId) finishDrag(); });
window.addEventListener('blur', () => { if (drag) finishDrag(); });
$('tabs').addEventListener('dragstart', event => event.preventDefault());
$('shortcut-add').onclick = () => act('shortcut-add');
$('shortcut-cancel').onclick = () => act('shortcut-cancel');
$('shortcut-remove').onclick = () => act('shortcut-remove');
$('shortcut-dialog').addEventListener('cancel', event => { event.preventDefault(); act('shortcut-cancel'); });
$('notification-dialog').addEventListener('cancel', event => { event.preventDefault(); act('notifications-close'); });
$('shortcut-form').addEventListener('submit', event => {
  event.preventDefault(); act('shortcut-save', JSON.stringify({ name: $('shortcut-name').value, url: $('shortcut-url').value }));
});
document.querySelectorAll('[data-space]').forEach(button => button.addEventListener('click', () => act('space', button.dataset.space)));
for (const id of ['new', 'back', 'forward', 'reload', 'home', 'help', 'dismiss', 'notifications', 'notifications-close', 'passwords', 'passwords-close', 'password-cancel']) $(id).addEventListener('click', () => act(id));
$('passwords-toolbar').onclick = () => act('passwords');
$('password-dialog').addEventListener('cancel', event => { event.preventDefault(); act('passwords-close'); });
$('password-add').onclick = async () => {
  const draft = await act('password-add');
  if (draft && state?.passwordSettings?.editor === draft.token) { $('password-username').value = draft.username; $('password-secret').value = draft.password; $('password-username').focus(); }
};
$('password-form').addEventListener('submit', event => {
  event.preventDefault(); act('password-save', JSON.stringify({ token: passwordEditor, username: $('password-username').value, password: $('password-secret').value }));
});
$('address-form').addEventListener('submit', event => { event.preventDefault(); act('navigate', $('address').value); $('address').blur(); });
function addressSuggestions() {
  const rect = $('address').getBoundingClientRect();
  act('address-suggest', JSON.stringify({ query: $('address').value, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }));
}
$('address').addEventListener('input', event => { if (!event.isComposing) addressSuggestions(); });
$('address').addEventListener('compositionend', addressSuggestions);
document.addEventListener('pointerdown', event => { if (event.target !== $('address')) act('address-hide'); });
$('history-clear').onclick = () => act('history-clear');
window.duo.onAddressChosen(url => { $('address').value = url; $('address').blur(); });
window.duo.onFocusAddress(() => { $('address').focus(); $('address').select(); });
window.duo.onState(next => {
  state = next;
  $('version').textContent = 'Portio ' + next.version;
  document.body.classList.toggle('university', next.active === 'university');
  document.querySelectorAll('[data-space]').forEach(b => { b.classList.toggle('active', b.dataset.space === next.active); b.setAttribute('aria-pressed', String(b.dataset.space === next.active)); });
  $('space-badge').textContent = next.spaceName;
  $('eyebrow').textContent = next.active === 'personal' ? 'PERSONAL SPACE' : 'UNIVERSITY SPACE';
  $('greeting').textContent = next.spaceName + 'の作業を始めましょう。';
  $('home-content').hidden = !next.current?.home;
  $('back').disabled = !next.current?.back;
  $('forward').disabled = !next.current?.forward;
  $('reload').disabled = next.current?.home;
  $('reload').textContent = next.current?.loading ? '×' : '↻';
  $('reload').setAttribute('aria-label', next.current?.loading ? '読み込みを停止' : '再読み込み');
  if (document.activeElement !== $('address')) $('address').value = next.current?.url || '';
  $('notice').hidden = !next.current?.error;
  $('notice').querySelector('span').textContent = next.current?.error || '';
  // Loading/title updates must not replace the element being dragged.
  if (drag && (drag.space !== next.active || drag.ids !== next.tabs.map(t => t.id).join(',') || next.shortcutEditor || next.notificationSettings || next.passwordSettings)) finishDrag();
  if (!drag) drawTabs();
  const serviceKey = JSON.stringify([next.active, next.services]);
  if (drawnServices !== serviceKey) {
    drawnServices = serviceKey;
    $('services').replaceChildren(...next.services.map(s => {
      const row = el('div', 'service-row');
      const b = el('button', 'service-link'); b.append(el('span', 'service-mark', s.mark), el('span', 'service-name', s.name)); b.title = s.name; b.onclick = () => act('service', s.id); row.append(b);
      if (s.custom) { const edit = el('button', 'service-edit', '…'); edit.setAttribute('aria-label', s.name + 'を編集'); edit.title = '編集・削除'; edit.onclick = () => act('shortcut-edit', s.id); row.append(edit); }
      return row;
    }));
    $('cards').replaceChildren(...next.services.map(s => { const b = el('button', 'card'); b.append(el('span', 'card-mark', s.mark), el('span', 'card-title', s.name), el('span', 'card-hint', s.hint)); b.onclick = () => act('service', s.id); return b; }));
  }
  const editor = next.shortcutEditor, modal = $('shortcut-dialog');
  if (editor) {
    $('shortcut-title').textContent = editor.id ? '「すぐに開く」を編集' : '「すぐに開く」に追加';
    $('shortcut-space').textContent = next.spaceName + '用スペースに保存します。';
    $('shortcut-error').textContent = editor.error;
    $('shortcut-remove').hidden = !editor.id;
    if (!modal.open) {
      $('shortcut-name').value = editor.name; $('shortcut-url').value = editor.url;
      modal.showModal(); $('shortcut-name').focus();
    }
  } else if (modal.open) modal.close();
  drawPasswords(next.passwordSettings);
  const settings = next.notificationSettings, notificationDialog = $('notification-dialog');
  if (settings) {
    $('notification-space').textContent = next.spaceName + '用スペース';
    $('notification-error').textContent = settings.error;
    const key = JSON.stringify([next.active, settings.entries]);
    if (key !== drawnNotifications) {
      drawnNotifications = key;
      $('notification-list').replaceChildren(...settings.entries.map(entry => {
        const row = el('div', 'notification-row'), description = el('div', 'notification-site');
        description.append(el('strong', '', entry.origin), el('span', '', entry.allowed ? '許可済み' : 'ブロック中'));
        const reset = el('button', 'notification-reset', 'リセット');
        reset.setAttribute('aria-label', entry.origin + 'の通知設定をリセット');
        reset.onclick = () => act('notifications-reset', entry.origin);
        row.append(description, reset); return row;
      }));
      if (!settings.entries.length) $('notification-list').append(el('p', 'notification-empty', '保存された通知の設定はありません。'));
    }
    if (!notificationDialog.open) notificationDialog.showModal();
  } else if (notificationDialog.open) notificationDialog.close();
});
function drawPasswords(settings) {
  const modal = $('password-dialog');
  if (!settings) {
    if (modal.open) modal.close();
    $('password-username').value = ''; $('password-secret').value = ''; passwordEditor = null; return;
  }
  $('password-space').textContent = state.spaceName + '用スペース';
  $('password-origin').textContent = settings.origin ? '保存先：' + settings.origin : 'ログイン情報を追加するには、保存したいサイトを開いてください。';
  $('password-error').textContent = settings.error || '';
  $('password-add').disabled = !settings.origin || settings.busy;
  $('password-add').hidden = !!settings.editor;
  $('password-form').hidden = !settings.editor;
  $('password-list').hidden = !!settings.editor;
  for (const id of ['password-username', 'password-secret', 'password-save', 'password-cancel', 'passwords-close']) $(id).disabled = settings.busy;
  if (passwordEditor !== settings.editor) {
    passwordEditor = settings.editor; $('password-username').value = ''; $('password-secret').value = '';
  }
  const key = JSON.stringify([settings.space, settings.entries, settings.busy]);
  if (passwordListKey !== key) {
    passwordListKey = key;
    $('password-list').replaceChildren(...settings.entries.map(entry => {
      const row = el('div', 'notification-row'), description = el('div', 'notification-site');
      description.append(el('strong', '', entry.origin), el('span', '', entry.username + '　••••••••'));
      const remove = el('button', 'notification-reset', '削除'); remove.disabled = settings.busy;
      remove.setAttribute('aria-label', entry.origin + 'の' + entry.username + 'を削除'); remove.onclick = () => act('password-remove', entry.id);
      row.append(description, remove); return row;
    }));
    if (!settings.entries.length) $('password-list').append(el('p', 'notification-empty', settings.busy ? '読み込み中…' : '保存したログイン情報はありません。'));
  }
  if (!modal.open) modal.showModal();
}
act('state');
