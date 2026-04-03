import appMark from '../../assets/app-mark.png';

const sizeMap = {
  sm: 'h-14 w-14',
  md: 'h-20 w-20',
  lg: 'h-28 w-28',
};

/**
 * Static app mark with a soft teal glow / scale pulse. Respects prefers-reduced-motion via CSS.
 * Asset is PNG with alpha; object-contain keeps the full mark inside the rounded frame.
 */
export default function BrandedLoader({ message, size = 'md', className = '' }) {
  const box = sizeMap[size] ?? sizeMap.md;
  return (
    <div className={`flex flex-col items-center gap-4 ${className}`}>
      <div
        className={`branded-loader-glow ${box} shrink-0 overflow-hidden rounded-2xl ring-1 ring-teal-500/25 dark:ring-teal-400/20`}
      >
        <img
          src={appMark}
          alt=""
          width={128}
          height={128}
          decoding="async"
          className="h-full w-full object-contain"
        />
      </div>
      {message ? (
        <p className="max-w-xs text-center text-sm text-gray-500 dark:text-gray-400">{message}</p>
      ) : null}
    </div>
  );
}
