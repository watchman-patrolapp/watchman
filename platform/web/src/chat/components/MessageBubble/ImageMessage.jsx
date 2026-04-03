import React, { useState } from 'react';
import { FaExpand } from 'react-icons/fa';
import PatrollerPhotoPreview from '../../../components/patrol/PatrollerPhotoPreview';

export const ImageMessage = React.memo(function ImageMessage({ url, alt }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  if (hasError) {
    return (
      <div className="max-w-[250px] h-32 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 text-sm">
        Image unavailable
      </div>
    );
  }

  const title = alt?.trim() || 'Shared image';

  return (
    <>
      <button
        type="button"
        onClick={() => setPreviewOpen(true)}
        className="group relative block max-w-[250px] cursor-zoom-in rounded-lg border-0 bg-transparent p-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
        aria-label={`View ${title}`}
      >
        {!isLoaded && <div className="max-w-[250px] h-32 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />}
        <img
          src={url}
          alt={title}
          className={`max-w-[250px] max-h-[250px] rounded-lg object-cover transition group-hover:opacity-90 ${
            isLoaded ? 'opacity-100' : 'opacity-0 absolute inset-0'
          }`}
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
          loading="lazy"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 opacity-0 transition group-hover:bg-black/10 group-hover:opacity-100">
          <FaExpand className="h-6 w-6 text-white drop-shadow-lg" aria-hidden />
        </div>
      </button>

      <PatrollerPhotoPreview
        key={previewOpen ? `chat-img-${url}` : 'chat-img-closed'}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        name={title}
        imageUrls={[url]}
        initialIndex={0}
      />
    </>
  );
});

export default ImageMessage;