import { FaExpand, FaTimes, FaUpload } from 'react-icons/fa';
import CriminalPhotoImg from '../../components/intelligence/CriminalPhotoImg';
import { DETAIL_SECTION } from './profileDetailClasses';

export default function ProfilePhotosSection({
  isEditing,
  displayData,
  photoUploadsPending,
  onSelectPhotos,
  onRemovePhoto,
  onOpenLightbox,
}) {
  return (
    <section className={DETAIL_SECTION}>
      <h2 className="mb-4 text-lg font-semibold text-gray-700 dark:text-gray-200">Photographs</h2>

      {isEditing && (
        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Add photos from device</label>
          <div className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-4 text-center transition-colors hover:border-blue-500 dark:border-gray-600 dark:bg-gray-900/40 dark:hover:border-blue-400">
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              id="edit-profile-photo-upload"
              onChange={onSelectPhotos}
            />
            <label
              htmlFor="edit-profile-photo-upload"
              className="cursor-pointer flex flex-col items-center"
            >
              <FaUpload className="mb-2 h-10 w-10 text-gray-400 dark:text-gray-500" />
              <span className="text-sm text-gray-600 dark:text-gray-400">Click to choose photos</span>
              <span className="mt-1 text-xs text-gray-400 dark:text-gray-500">JPG, PNG, GIF up to 5MB</span>
            </label>
          </div>
          {photoUploadsPending > 0 && (
            <p className="mt-2 text-sm text-blue-600 dark:text-blue-400">Uploading…</p>
          )}
        </div>
      )}

      {displayData.photo_urls && displayData.photo_urls.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {displayData.photo_urls.map((url, index) => {
            const galleryUrls = (displayData.photo_urls || []).filter(Boolean);
            return (
              <div key={`${url}-${index}`} className="relative group">
                <button
                  type="button"
                  onClick={() =>
                    onOpenLightbox({ urls: galleryUrls, index })
                  }
                  className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg border-0 bg-transparent p-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
                  aria-label={`View photograph ${index + 1} full size`}
                >
                  <CriminalPhotoImg
                    src={url}
                    alt={`Profile ${index + 1}`}
                    className="h-32 w-full object-cover object-top transition group-hover:opacity-90"
                  />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 opacity-0 transition group-hover:bg-black/15 group-hover:opacity-100">
                    <FaExpand className="h-6 w-6 text-white drop-shadow-md" aria-hidden />
                  </span>
                </button>
                {isEditing && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemovePhoto(index);
                    }}
                    className="absolute -top-2 -right-2 z-10 rounded-full bg-red-500 p-1 text-white shadow-md"
                    aria-label="Remove photo"
                  >
                    <FaTimes size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !isEditing && (
          <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
            No photos available
          </div>
        )
      )}
    </section>
  );
}
