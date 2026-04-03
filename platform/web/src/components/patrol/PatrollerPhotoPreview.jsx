import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaTimes, FaExpand, FaCompress, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { getInitials } from '../../chat/utils/formatters';

/**
 * Full-screen overlay (default compact height, toggle full) centered on screen.
 * Optional `imageUrls` + `initialIndex` enables prev/next when a group has multiple photos.
 */
export default function PatrollerPhotoPreview({
  open,
  onClose,
  name,
  imageUrl,
  imageUrls,
  initialIndex = 0,
}) {
  const [fullHeight, setFullHeight] = useState(false);
  const safeInitial = Number.isFinite(initialIndex) ? initialIndex : 0;
  const [slideIndex, setSlideIndex] = useState(safeInitial);

  const urls = useMemo(() => {
    if (Array.isArray(imageUrls) && imageUrls.length > 0) {
      return imageUrls.filter(Boolean);
    }
    if (imageUrl) return [imageUrl];
    return [];
  }, [imageUrl, imageUrls]);

  const hasGallery = urls.length > 1;
  const currentUrl = urls[slideIndex];
  const headerLabel =
    hasGallery && name
      ? `${name} · ${slideIndex + 1} / ${urls.length}`
      : hasGallery
        ? `${slideIndex + 1} / ${urls.length}`
        : name || 'Patroller';

  useEffect(() => {
    if (!open) return undefined;
    setFullHeight(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (urls.length === 0) {
      setSlideIndex(0);
      return;
    }
    setSlideIndex((i) => Math.min(i, urls.length - 1));
  }, [urls.length]);

  const goPrev = () => {
    if (urls.length < 2) return;
    setSlideIndex((i) => (i - 1 + urls.length) % urls.length);
  };

  const goNext = () => {
    if (urls.length < 2) return;
    setSlideIndex((i) => (i + 1) % urls.length);
  };

  useEffect(() => {
    if (!open) return undefined;
    const len = urls.length;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (len < 2) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSlideIndex((i) => (i - 1 + len) % len);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSlideIndex((i) => (i + 1) % len);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, urls.length]);

  if (!open) return null;

  const shellClass = fullHeight
    ? 'h-[100dvh] sm:max-h-[min(96dvh,920px)] sm:h-auto sm:w-full sm:max-w-2xl'
    : 'h-[50dvh] sm:max-h-[min(72dvh,720px)] sm:h-auto sm:w-full sm:max-w-xl';

  const content = (
    <div
      className="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="patroller-preview-title"
      onClick={onClose}
    >
      <div
        className={`w-full sm:rounded-2xl bg-gray-950 shadow-2xl overflow-hidden flex flex-col motion-safe:transition-[max-height] motion-safe:duration-200 ${shellClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 shrink-0">
          <h2 id="patroller-preview-title" className="text-lg font-semibold text-white truncate pr-2">
            {headerLabel}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setFullHeight((v) => !v)}
              className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20"
              aria-label={fullHeight ? 'Use smaller view' : 'Use full height'}
            >
              {fullHeight ? <FaCompress className="w-5 h-5" aria-hidden /> : <FaExpand className="w-5 h-5" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20"
              aria-label="Close"
            >
              <FaTimes className="w-5 h-5" aria-hidden />
            </button>
          </div>
        </div>
        <div className="relative flex-1 min-h-0 flex items-center justify-center p-4 sm:p-6 bg-black">
          {hasGallery && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev();
                }}
                className="absolute left-1 sm:left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/15 p-2.5 text-white hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                aria-label="Previous photo"
              >
                <FaChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goNext();
                }}
                className="absolute right-1 sm:right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/15 p-2.5 text-white hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                aria-label="Next photo"
              >
                <FaChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </>
          )}
          {currentUrl ? (
            <img
              key={currentUrl}
              src={currentUrl}
              alt=""
              className="max-w-full max-h-full w-auto h-auto object-contain rounded-lg"
            />
          ) : (
            <div
              className="w-44 h-44 sm:w-52 sm:h-52 rounded-full bg-gradient-to-br from-teal-500 to-purple-600 flex items-center justify-center text-4xl sm:text-5xl font-bold text-white shadow-xl"
              aria-hidden
            >
              {getInitials(name)}
            </div>
          )}
        </div>
        <p className="text-center text-xs text-white/55 pb-3 px-4 shrink-0">
          Tap outside or press Escape to close
          {!fullHeight ? ' · Expand for a larger photo' : ''}
          {hasGallery ? ' · ← → between photos' : ''}
        </p>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
