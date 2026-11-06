import { FaUserSecret } from 'react-icons/fa';
import CriminalPhotoImg from '../../components/intelligence/CriminalPhotoImg';

/** Small profile image for associate rows (uses first photo in `photo_urls` if present). */
export default function AssociateFaceThumb({ profile, className = 'h-10 w-10' }) {
  const url = profile?.photo_urls?.[0];
  return (
    <div
      className={`shrink-0 overflow-hidden rounded-lg bg-gray-200 ring-1 ring-gray-200 dark:bg-gray-600 dark:ring-gray-600 ${className}`}
    >
      {url ? (
        <CriminalPhotoImg
          src={url}
          alt=""
          className="h-full w-full object-cover object-top"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <FaUserSecret className="h-[42%] w-[42%] min-h-[0.875rem] min-w-[0.875rem] text-gray-500 dark:text-gray-400" />
        </div>
      )}
    </div>
  );
}
