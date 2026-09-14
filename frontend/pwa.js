// Installation is always user initiated. PWA support is independent of ML loading.
export function initPWA() {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#installDialog');
  const displayQuery = matchMedia('(display-mode: standalone)');
  let deferredPrompt = null, requestedUpdate = false;
  const standalone = () => displayQuery.matches || navigator.standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function installUI() {
    const installed = standalone();
    $('#displayMode').textContent = installed ? 'Application installée · standalone' : 'Mode navigateur';
    $('#installTop').hidden = installed;
    $('#installTop span').textContent = deferredPrompt ? 'Installer' : 'Installation';
    $('#installPrimary').hidden = installed || !deferredPrompt;
    $('#installHelp').textContent = deferredPrompt ? 'Le navigateur vous demandera de confirmer l’installation.' : ios ? 'Dans Safari : Partager, puis « Sur l’écran d’accueil ». Si cette option est absente, ouvrez cette page directement dans Safari.' : 'Si votre navigateur le propose : menu, puis « Installer l’application » ou « Ajouter à l’écran d’accueil ». Cette option dépend du navigateur.';
    if (installed && dialog.open) dialog.close();
  }
  $('#installTop').addEventListener('click', () => { if (!standalone()) { installUI(); dialog.showModal(); } });
  $('#installSecondary').addEventListener('click', () => dialog.close());
  $('#installPrimary').addEventListener('click', async () => {
    const prompt = deferredPrompt;
    if (!prompt || standalone()) return;
    deferredPrompt = null; $('#installPrimary').disabled = true;
    try { await prompt.prompt(); const choice = await prompt.userChoice; if (choice.outcome === 'accepted') dialog.close(); }
    catch { $('#installHelp').textContent = 'L’installation n’a pas abouti. Vous pouvez continuer dans le navigateur.'; }
    finally { $('#installPrimary').disabled = false; installUI(); }
  });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event; installUI(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; dialog.close(); $('#installTop').hidden = true; $('#displayMode').textContent = 'Installation terminée'; });
  displayQuery.addEventListener('change', installUI);
  installUI();
  const status = message => { $('#pwaStatus').textContent = message; };
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !['http:', 'https:'].includes(location.protocol)) {
    status('Cache hors ligne indisponible : utilisez HTTPS ou localhost.'); return;
  }
  async function cacheStatus() {
    if (!navigator.serviceWorker.controller) return;
    const channel = new MessageChannel();
    const timer = setTimeout(() => { status('État du cache non confirmé. Rechargez la page.'); channel.port1.close(); }, 5000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      status(event.data?.ready ? 'Disponible hors ligne' : 'Cache incomplet. Reconnectez-vous et rechargez.');
    };
    navigator.serviceWorker.controller.postMessage({ type: 'CACHE_STATUS' }, [channel.port2]);
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (requestedUpdate) { location.reload(); return; }
    cacheStatus();
  });
  navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { updateViaCache: 'none' }).then(registration => {
    function updateAvailable() { if (registration.waiting) $('#updateNotice').hidden = false; }
    updateAvailable();
    $('#updateApp').addEventListener('click', () => {
      if (registration.waiting) { requestedUpdate = true; registration.waiting.postMessage({ type: 'SKIP_WAITING' }); }
    });
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') updateAvailable();
        if (worker.state === 'redundant') status('Installation du cache interrompue. Reconnectez-vous et rechargez.');
      });
    });
    // A cold first install may claim this page through controllerchange.
    if (navigator.serviceWorker.controller) cacheStatus();
    else status('Préparation du cache hors ligne…');
  }).catch(error => status(`Cache hors ligne indisponible : ${error.message}`));
}
