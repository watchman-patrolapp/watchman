import { formatLastUpdated } from "./policy";

export default function LastUpdatedNote({ savedAt, now }) {
  if (!savedAt) return null;
  return (
    <p className="text-xs text-text-tertiary" role="status">
      {formatLastUpdated(savedAt, now)}
    </p>
  );
}
