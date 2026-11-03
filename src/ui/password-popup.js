let serial = 0;
const choices = document.getElementById('choices');
window.passwordCandidates.onShow(data => {
  serial = data.serial; document.getElementById('origin').textContent = 'Portio · ' + data.origin;
  choices.replaceChildren(...data.usernames.map((username, index) => {
    const button = document.createElement('button'); button.textContent = username; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', 'false');
    if (data.details?.[index]) { const detail = document.createElement('small'); detail.textContent = data.details[index]; button.append(detail); }
    button.onclick = () => window.passwordCandidates.choose(serial, index); return button;
  }));
});
window.passwordCandidates.onHighlight(index => Array.from(choices.children).forEach((button, i) => button.setAttribute('aria-selected', String(i === index))));
