import { useEffect, useState } from 'react';
import {
  isCriminalPhotoReference,
  resolveCriminalPhotoUrl,
} from '../../utils/criminalPhotos';
import { MEDIA_UNAVAILABLE, resolveSignedMediaUrl } from '../../utils/privateMedia';
import { resolveMediaRef } from '../../utils/privateMediaPath';

/**
 * Renders a criminal profile photo. Signs criminal-photos URLs for the
 * current user. Incident photos copied onto a profile are signed too.
 * A failure shows fallback text, not the storage error.
 */
export default function CriminalPhotoImg({ src, alt = '', onError, className = '', ...rest }) {
  const [resolved, setResolved] = useState('');
  const [useStored, setUseStored] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const privateRef = !isCriminalPhotoReference(src) && resolveMediaRef(src, null);

  useEffect(() => {
    let cancelled = false;
    setUseStored(false);
    setUnavailable(false);
    if (!src) {
      setResolved('');
      return undefined;
    }
    if (isCriminalPhotoReference(src)) {
      setResolved('');
      resolveCriminalPhotoUrl(src).then((next) => {
        if (!cancelled) setResolved(next || '');
      });
      return () => {
        cancelled = true;
      };
    }
    const ref = resolveMediaRef(src, null);
    if (ref) {
      setResolved('');
      resolveSignedMediaUrl(src).then((next) => {
        if (cancelled) return;
        if (next) setResolved(next);
        else setUnavailable(true);
      });
      return () => {
        cancelled = true;
      };
    }
    setResolved(src);
    return undefined;
  }, [src]);

  if (unavailable) {
    return (
      <span role="img" aria-label={alt || MEDIA_UNAVAILABLE} className={`inline-flex items-center justify-center bg-gray-100 px-2 text-center text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400 ${className}`}>
        {MEDIA_UNAVAILABLE}
      </span>
    );
  }

  const shown = useStored ? src : resolved;

  return (
    <img
      {...rest}
      alt={alt}
      className={className}
      src={shown || undefined}
      onError={(event) => {
        if (privateRef) {
          setUnavailable(true);
          return;
        }
        if (!useStored && src && shown && shown !== src && isCriminalPhotoReference(src)) {
          setUseStored(true);
          return;
        }
        onError?.(event);
      }}
    />
  );
}
