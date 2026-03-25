import React, { useState } from 'react';
import { FaExpand } from 'react-icons/fa';

export const ImageMessage = React.memo(function ImageMessage({ url, alt }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className="max-w-[250px] h-32 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 text-sm">
        Image unavailable
      </div>
    );
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block relative group">
      {!isLoaded && <div className="max-w-[250px] h-32 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />}
      <img
        src={url}
        alt={alt || 'Shared image'}
        className={`max-w-[250px] max-h-[250px] rounded-lg object-cover hover:opacity-90 transition ${
          isLoaded ? 'opacity-100' : 'opacity-0 absolute inset-0'
        }`}
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
        loading="lazy"
      />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100">
        <FaExpand className="w-6 h-6 text-white drop-shadow-lg" />
      </div>
    </a>
  );
});

export default ImageMessage;