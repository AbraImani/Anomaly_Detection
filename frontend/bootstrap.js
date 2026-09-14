// Keep navigation usable even when an ES module or the model cannot load.
// A classic script also runs when someone opens index.html with file://.
(() => {
  'use strict';
  const base = new URL('./', document.currentScript.src);
  const $ = selector => document.querySelector(selector);
  const titles = { dashboard: 'Dashboard', tester: 'Tester le modèle', anomalies: 'Anomalies', model: 'Edge Model', about: 'À propos' };

  function switchView(focus = false) {
    const requested = location.hash.slice(1);
    const name = Object.prototype.hasOwnProperty.call(titles, requested) ? requested : 'dashboard';
    document.querySelectorAll('.view').forEach(view => { view.hidden = view.id !== `view-${name}`; });
    document.querySelectorAll('[data-view]').forEach(link => {
      if (link.dataset.view === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    $('#pageTitle').textContent = titles[name];
    document.title = `${titles[name]} · EdgePulse`;
    window.dispatchEvent(new CustomEvent('edgepulse:viewchange', { detail: { view: name } }));
    if (focus) { $(`#heading-${name}`).focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }
  window.addEventListener('hashchange', () => switchView(true));
  document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', event => {
    // Clicking the current destination should still focus its heading.
    if (Object.prototype.hasOwnProperty.call(titles, link.hash.slice(1)) && location.hash === link.hash) {
      event.preventDefault(); switchView(true);
    }
  }));
  $('.skip-link').addEventListener('click', event => { event.preventDefault(); $('#main').focus(); });
  $('#sensorForm').addEventListener('submit', event => { if ($('#analyzeButton').disabled) event.preventDefault(); });
  $('#retryStartup').addEventListener('click', () => location.reload());
  switchView();

  function startupError(message) {
    $('#modelError').textContent = message;
    $('#modelError').hidden = false;
    $('#retryStartup').hidden = false;
    $('#modelStatus').textContent = 'Indisponible';
    $('#modelStatus').classList.add('anomaly-text');
    $('#modelMeta').textContent = 'Inférence désactivée';
    $('#sideModelStatus').textContent = 'Chargement impossible';
    $('#modelReadyMessage').textContent = 'Le modèle n’a pas pu démarrer. Consultez le message en haut de la page.';
    $('#analyzeButton').disabled = true;
  }
  if (location.protocol === 'file:') {
    $('#fileWarning').hidden = false;
    startupError('Ce fichier a été ouvert directement. Depuis le dossier contenant index.html, lancez python -m http.server 8080, puis ouvrez http://localhost:8080/#tester. Vous pouvez aussi utiliser le site HTTPS publié.');
    $('#retryStartup').hidden = true;
    $('#pwaStatus').textContent = 'Le mode hors ligne se prépare depuis HTTPS ou localhost.';
    return;
  }

  // Independent imports: a PWA failure must not disable inference, or vice versa.
  import(new URL('./app.js', base).href).catch(error => {
    startupError(`Le script de l’application n’a pas pu démarrer : ${error.message}. Reconnectez-vous puis rechargez. Si le problème persiste, vérifiez que tous les fichiers du frontend ont été publiés.`);
  });
  import(new URL('./pwa.js', base).href).then(({ initPWA }) => initPWA()).catch(error => {
    $('#pwaStatus').textContent = `Cache hors ligne indisponible : ${error.message}. Rechargez après reconnexion.`;
  });
})();
