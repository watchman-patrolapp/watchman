import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

export default function AvatarCropModal({
  imagePreviewUrl,
  crop,
  setCrop,
  setCompletedCrop,
  onImageLoad,
  uploadingAvatar,
  onConfirm,
  onCancel,
  completedCrop,
}) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/75 p-4">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4 dark:text-white">Crop Image</h2>
        <div className="flex justify-center items-center min-h-[300px]">
          <ReactCrop
            crop={crop}
            onChange={(_, percentCrop) => setCrop(percentCrop)}
            onComplete={(pixelCrop) => setCompletedCrop(pixelCrop)}
            aspect={1}
            circularCrop
          >
            <img
              src={imagePreviewUrl}
              alt="Crop preview"
              onLoad={onImageLoad}
              className="max-w-full max-h-[60vh] w-auto h-auto object-contain"
            />
          </ReactCrop>
        </div>
        <div className="flex justify-end gap-3 mt-4 sticky bottom-0 bg-white dark:bg-gray-800 pt-2">
          <button
            onClick={onCancel}
            disabled={uploadingAvatar}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!completedCrop || uploadingAvatar}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {uploadingAvatar ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
