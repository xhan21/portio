const $ = id => document.getElementById(id);
const act = (kind, value) => window.duo.act(kind, value).catch(() => {});
let state, drawnServices = '';
function el(tag, className, text) { const item = document.createElement(tag); item.className = className; if (text !== undefined) item.textContent = text; return item; }
document.querySelectorAll('[data-space]').forEach(button => button.addEventListener('click', () => act('space', button.dataset.space)));
for (const id of ['new', 'back', 'forward', 'reload', 'home', 'help', 'dismiss']) $(id).addEventListener('click', () => act(id));
$('address-form').addEventListener('submit', event => { event.preventDefault(); act('navigate', $('address').value); $('address').blur(); });
window.duo.onFocusAddress(() => { $('address').focus(); $('address').select(); });
window.duo.onState(next => {
  state = next;
  $('version').textContent = 'Portio ' + next.version;
  document.body.classList.toggle('university', next.active === 'university');
  document.querySelectorAll('[data-space]').forEach(b => { b.classList.toggle('active', b.dataset.space === next.active); b.setAttribute('aria-pressed', String(b.dataset.space === next.active)); });
  $('space-status').textContent = next.spaceName + '用スペースを表示中';
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
  $('tabs').replaceChildren(...next.tabs.map(t => {
    const tab = el('div', 'tab' + (t.selected ? ' selected' : ''));
    const choose = el('button', 'tab-select', (t.loading ? '◌ ' : '') + t.title);
    choose.title = t.title; choose.setAttribute('role', 'tab'); choose.setAttribute('aria-selected', String(t.selected)); choose.onclick = () => act('select', t.id);
    const close = el('button', 'tab-close', '×'); close.setAttribute('aria-label', t.title + 'を閉じる'); close.onclick = () => act('close', t.id);
    tab.append(choose, close); return tab;
  }));
  if (drawnServices !== next.active) {
    drawnServices = next.active;
    $('services').replaceChildren(...next.services.map(s => { const b = el('button', 'service-link'); b.append(el('span', 'service-mark', s.mark), el('span', '', s.name)); b.onclick = () => act('service', s.id); return b; }));
    $('cards').replaceChildren(...next.services.map(s => { const b = el('button', 'card'); b.append(el('span', 'card-mark', s.mark), el('span', 'card-title', s.name), el('span', 'card-hint', s.hint)); b.onclick = () => act('service', s.id); return b; }));
  }
});
act('state');
