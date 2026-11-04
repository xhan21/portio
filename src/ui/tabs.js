function reconcileTabs(container, tabs, act) {
  const existing = new Map([...container.children].map(node => [node.dataset.id, node]));
  const wanted = new Set(tabs.map(tab => tab.id));
  for (const [id, node] of existing) if (!wanted.has(id)) node.remove();
  const attribute = (node, key, value) => { if (node.getAttribute(key) !== value) node.setAttribute(key, value); };
  tabs.forEach((data, index) => {
    let tab = existing.get(data.id);
    if (!tab) {
      tab = container.ownerDocument.createElement('div');
      tab.className = 'tab'; tab.dataset.id = data.id;
      const choose = container.ownerDocument.createElement('button');
      choose.className = 'tab-select'; choose.setAttribute('role', 'tab');
      choose.onclick = () => act('select', data.id);
      const close = container.ownerDocument.createElement('button');
      close.className = 'tab-close'; close.textContent = '×';
      close.onclick = () => act('close', data.id);
      tab.append(choose, close);
    }
    const [choose, close] = tab.children;
    const label = (data.loading ? '◌ ' : '') + data.title;
    if (choose.textContent !== label) choose.textContent = label;
    attribute(choose, 'title', data.title + '\nドラッグして並べ替え');
    attribute(choose, 'aria-selected', String(data.selected));
    attribute(close, 'aria-label', data.title + 'を閉じる');
    tab.classList.toggle('selected', data.selected);
    // Leave unchanged nodes in place so focus and accessibility identity survive.
    if (container.children[index] !== tab) container.insertBefore(tab, container.children[index] || null);
  });
}
if (typeof module !== 'undefined') module.exports = { reconcileTabs };
