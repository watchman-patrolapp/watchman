/* Vite dev (default port 5173) only: drop stale Workbox so HMR is not fighting an old SW. Preview keeps the PWA. */
(function () {
  var host = location.hostname;
  var loopback =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  if (!loopback || location.port !== '5173') return;
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    regs.forEach(function (registration) {
      registration.unregister();
    });
  });
  if (typeof caches !== 'undefined') {
    caches.keys().then(function (keys) {
      keys.forEach(function (key) {
        if (key.indexOf('workbox') !== -1 || key.indexOf('precache') !== -1) {
          caches.delete(key);
        }
      });
    });
  }
})();
