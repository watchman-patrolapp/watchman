import { supabase } from '../supabase/client';

async function waitForImages(container) {
  const imgs = container.querySelectorAll('img');
  await Promise.all(
    [...imgs].map(
      (img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise((resolve) => {
              const done = () => resolve();
              img.addEventListener('load', done, { once: true });
              img.addEventListener('error', done, { once: true });
              setTimeout(done, 12000);
            })
    )
  );
}

/**
 * Client-side PDF download from a DOM node (html2pdf). Call after auth lock no-op is configured.
 * @param {HTMLElement} element
 * @param {string} filename
 * @param {{ waitForImages?: boolean }} [options]
 */
export async function downloadDomAsPdf(element, filename, options = {}) {
  const { waitForImages: shouldWait = false } = options;
  if (!element) throw new Error('Nothing to export');
  await supabase.auth.getSession();
  await new Promise((r) => setTimeout(r, 50));
  if (shouldWait) await waitForImages(element);

  const html2pdf = (await import('html2pdf.js')).default;
  const safeName = String(filename).replace(/[/\\?%*:|"<>]/g, '-');

  await html2pdf()
    .set({
      margin: [10, 10, 10, 10],
      filename: safeName,
      image: { type: 'jpeg', quality: 0.92 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        letterRendering: true,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    })
    .from(element)
    .save();
}
