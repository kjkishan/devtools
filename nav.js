'use strict';

/* ================= tool menu (tabs in the header) ================= */

(() => {
  const views = {
    json: document.getElementById('jsonView'),
    compare: document.getElementById('compareView'),
    md: document.getElementById('mdView'),
  };
  const TITLES = { json: 'JSON Formatter', compare: 'JSON Compare', md: 'Markdown to PDF' };

  function showView(name) {
    if (!views[name]) name = 'json';
    for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
    document.querySelectorAll('.tabs [data-view]').forEach((b) => {
      const on = b.dataset.view === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    document.body.dataset.view = name;
    document.title = TITLES[name];
    store.set('tools.view', name);
    if (location.hash !== `#${name}`) {
      try { history.replaceState(null, '', `#${name}`); } catch { /* file:// may refuse */ }
    }
    if (name === 'md') window.MdApp?.updateFit();
  }

  document.querySelectorAll('.tabs [data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
  showView(location.hash.slice(1) || store.get('tools.view') || 'json');
})();
