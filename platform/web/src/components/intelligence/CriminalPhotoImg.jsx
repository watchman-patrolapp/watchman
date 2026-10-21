import { useEffect, useState } from 'react';
import {
  isCriminalPhotoReference,
  resolveCriminalPhotoUrl,
} from '../../utils/criminalPhotos';

/**
 * Renders a criminal profile photo. Signs criminal-photos URLs for the
 * current user and, if that fails, falls back to the stored URL.
 */
export default function CriminalPhotoImg({ src, alt = '', onError, ...rest }) {
  const [resolved, setResolved] = useState('');
  const [useStored, setUseStored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUseStored(false);
    if (!src) {
      setResolved('');
      return undefined;
    }
    if (!isCriminalPhotoReference(src)) {
      setResolved(src);
      return undefined;
    }
    setResolved('');
    resolveCriminalPhotoUrl(src).then((next) => {
      if (!cancelled) setResolved(next || '');
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  const shown = useStored ? src : resolved;

  return (
    <img
      {...rest}
      alt={alt}
      src={shown || undefined}
      onError={(event) => {
        if (!useStored && src && shown && shown !== src && isCriminalPhotoReference(src)) {
          setUseStored(true);
          return;
        }
        onError?.(event);
      }}
    />
  );
}
