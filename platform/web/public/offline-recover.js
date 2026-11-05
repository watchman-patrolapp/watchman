(function () {
  var host = location.hostname;
  var loopback =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  var viteDev = loopback && location.port === '5173';
  var attemptedKey = 'nw-offline-recover';

  var retry = document.querySelector('[data-offline-retry]');
  if (retry) {
    retry.addEventListener('click', function () {
      window.location.reload();
    });
  }

  function registerDevKillSwitch() {
    if (!('serviceWorker' in navigator)) return;
    var paths = { '/sw.js': true, '/dev-sw.js': true };
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) {
        var script =
          (reg.active && reg.active.scriptURL) ||
          (reg.waiting && reg.waiting.scriptURL) ||
          (reg.installing && reg.installing.scriptURL) ||
          '';
        if (!script || script.indexOf('firebase-messaging') !== -1) return;
        paths[new URL(script).pathname] = true;
      });
      Object.keys(paths).forEach(function (swPath) {
        navigator.serviceWorker.register(swPath).catch(function () {});
      });
    });
  }

  function recoverOnlineOnce() {
    if (sessionStorage.getItem(attemptedKey)) return;
    sessionStorage.setItem(attemptedKey, '1');
    var tasks = [];
    if ('serviceWorker' in navigator) {
      tasks.push(
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (reg) { return reg.unregister(); }));
        })
      );
    }
    if (typeof caches !== 'undefined') {
      tasks.push(
        caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (key) { return caches.delete(key); }));
        })
      );
    }
    Promise.all(tasks).then(function () {
      location.reload();
    });
  }

  if (viteDev) {
    registerDevKillSwitch();
    return;
  }
  if (navigator.onLine) recoverOnlineOnce();
})();
