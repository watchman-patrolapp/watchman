import { useCallback, useEffect, useRef, useState } from "react";
import { FaBoxOpen, FaChevronLeft, FaChevronRight, FaTimes } from "react-icons/fa";
import { wishlistPhotoUrl } from "../../utils/equipmentWishlist";

/** Full-screen viewer (item page). Esc / arrows / swipe via scroll-snap. */
function PhotoLightbox({ urls, start, title, onClose }) {
  const ref = useRef(null);
  const [idx, setIdx] = useState(start);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ left: start * el.clientWidth });
  }, [start]);

  const go = useCallback((i) => {
    const el = ref.current;
    if (!el) return;
    const n = Math.max(0, Math.min(urls.length - 1, i));
    el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
  }, [urls.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(idx + 1);
      if (e.key === "ArrowLeft") go(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [go, idx, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={`${title} photos`}>
      <div className="flex items-center justify-between px-4 py-3 text-sm text-white">
        <span className="truncate pr-3">{title}</span>
        <span className="flex items-center gap-3">
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{idx + 1}/{urls.length}</span>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/15" aria-label="Close">
            <FaTimes />
          </button>
        </span>
      </div>
      <div
        ref={ref}
        onScroll={(e) => setIdx(Math.round(e.currentTarget.scrollLeft / Math.max(e.currentTarget.clientWidth, 1)))}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {urls.map((u, i) => (
          <div key={u} className="flex h-full w-full shrink-0 snap-center items-center justify-center p-2">
            <img src={u} alt={`${title} photo ${i + 1}`} className="max-h-full max-w-full object-contain" />
          </div>
        ))}
      </div>
      {urls.length > 1 ? (
        <>
          <button type="button" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label="Previous photo"
            className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/15 p-3 text-white hover:bg-white/25 disabled:opacity-30 sm:block">
            <FaChevronLeft />
          </button>
          <button type="button" onClick={() => go(idx + 1)} disabled={idx === urls.length - 1} aria-label="Next photo"
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/15 p-3 text-white hover:bg-white/25 disabled:opacity-30 sm:block">
            <FaChevronRight />
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * Swipeable photo gallery (CSS scroll-snap, no packages). 4:3, object-contain,
 * dots + "1/5" counter, prev/next arrows on sm+ screens. fullscreen = tap opens a viewer.
 */
export default function NeedGallery({ paths, title, fullscreen = false }) {
  const urls = (paths || []).map(wishlistPhotoUrl).filter(Boolean);
  const ref = useRef(null);
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);

  const go = (i, e) => {
    e?.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const n = Math.max(0, Math.min(urls.length - 1, i));
    el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
  };

  if (urls.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center border-b border-gray-200 bg-gray-50 text-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-600">
        <FaBoxOpen className="h-12 w-12" aria-hidden />
      </div>
    );
  }

  return (
    <div className="group relative aspect-[4/3] w-full border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
      <div
        ref={ref}
        onScroll={(e) => setIdx(Math.round(e.currentTarget.scrollLeft / Math.max(e.currentTarget.clientWidth, 1)))}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {urls.map((u, i) => (
          <button
            key={u}
            type="button"
            tabIndex={fullscreen ? 0 : -1}
            onClick={(e) => {
              if (!fullscreen) return;
              e.stopPropagation();
              setOpen(true);
            }}
            className={`h-full w-full shrink-0 snap-center ${fullscreen ? "cursor-zoom-in" : "cursor-default"}`}
            aria-label={fullscreen ? `Open photo ${i + 1} full screen` : undefined}
          >
            <img src={u} alt={`${title} photo ${i + 1}`} loading="lazy" draggable={false} className="h-full w-full object-contain p-3" />
          </button>
        ))}
      </div>
      {urls.length > 1 ? (
        <>
          <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
            {idx + 1}/{urls.length}
          </span>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/30 px-2 py-1">
            {urls.map((u, i) => (
              <button
                key={u}
                type="button"
                onClick={(e) => go(i, e)}
                aria-label={`Show photo ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${i === idx ? "w-4 bg-white" : "w-1.5 bg-white/60"}`}
              />
            ))}
          </div>
          <button type="button" onClick={(e) => go(idx - 1, e)} disabled={idx === 0} aria-label="Previous photo"
            className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 p-2 text-gray-700 shadow opacity-0 transition group-hover:opacity-100 disabled:!opacity-0 sm:block dark:bg-gray-800/90 dark:text-gray-200">
            <FaChevronLeft className="h-3 w-3" />
          </button>
          <button type="button" onClick={(e) => go(idx + 1, e)} disabled={idx === urls.length - 1} aria-label="Next photo"
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/90 p-2 text-gray-700 shadow opacity-0 transition group-hover:opacity-100 disabled:!opacity-0 sm:block dark:bg-gray-800/90 dark:text-gray-200">
            <FaChevronRight className="h-3 w-3" />
          </button>
        </>
      ) : null}
      {open ? <PhotoLightbox urls={urls} start={idx} title={title} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
