import { useEffect, useState } from "react";
import { MEDIA_UNAVAILABLE, useSignedMediaSrc } from "../../utils/privateMedia";

/**
 * Shows a signed media URL. Failure renders fallback text, never a storage error.
 */
export default function PrivateMediaImg({
  stored,
  bucket,
  alt = "",
  className = "",
  fallback = MEDIA_UNAVAILABLE,
  ...rest
}) {
  const src = useSignedMediaSrc(stored, bucket);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [stored, bucket]);

  if (!stored) return null;

  if (broken || src === null) {
    return (
      <span
        role="img"
        aria-label={fallback}
        className={`inline-flex items-center justify-center bg-gray-100 px-2 text-center text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400 ${className}`}
      >
        {fallback}
      </span>
    );
  }

  if (!src) {
    return <span className={`inline-block bg-gray-100 dark:bg-gray-800 ${className}`} aria-hidden />;
  }

  return (
    <img
      {...rest}
      alt={alt}
      src={src}
      className={className}
      onError={() => setBroken(true)}
    />
  );
}
