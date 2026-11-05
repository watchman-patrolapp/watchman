/* vite-plugin-pwa's generateBundle write of this file is ignored by Rolldown (Vite 8).
   Keep the same script the plugin injects into index.html for non-Vercel builds. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' });
  });
}
