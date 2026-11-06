export default function Skeleton({ lines = 3, className = "" }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">Loading</span>
      <div className="space-y-3">
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className={`skeleton h-4 ${index === lines - 1 ? "w-2/3" : "w-full"}`}
          />
        ))}
      </div>
    </div>
  );
}
