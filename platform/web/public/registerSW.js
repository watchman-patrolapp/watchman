/* vite-plugin-pwa's generateBundle write of this file is ignored by Rolldown (Vite 8).
   index.html loads this copy. It registers the app-shell worker and reloads
   only when a new worker replaces one that was already in control. */
if ('serviceWorker' in navigator) {
  var hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController) {
      hadController = true;
      return;
    }
    window.location.reload();
  });
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' });
  });
}
