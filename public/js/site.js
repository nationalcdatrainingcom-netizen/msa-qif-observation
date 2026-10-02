// Shared by every page of the public marketing site (site/ in the repo).
document.getElementById('year').textContent = new Date().getFullYear();

// Close the mobile menu after picking a link
document.querySelectorAll('#nav-links a').forEach(a =>
  a.addEventListener('click', () => document.getElementById('nav-links').classList.remove('open')));

function showMsg(el, text, kind) {
  el.textContent = text;
  el.className = 'msg ' + kind;
}
