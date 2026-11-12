import { clampRating } from "../../utils/localServices";

/** Read-only stars when `onChange` is omitted; otherwise a 1–5 picker. */
export default function StarRating({ value = 0, onChange, size = "text-xl", label = "Rating" }) {
  const current = clampRating(value);
  const stars = [1, 2, 3, 4, 5];
  if (!onChange) {
    return (
      <span className={`${size} leading-none text-amber-500`} role="img" aria-label={`${current} out of 5 stars`}>
        {stars.map((n) => (n <= current ? "★" : "☆")).join("")}
      </span>
    );
  }
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex gap-1 ${size} leading-none`}>
      {stars.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={current === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          onClick={() => onChange(n)}
          className={n <= current ? "text-amber-500" : "text-gray-300 dark:text-gray-600"}
        >
          ★
        </button>
      ))}
    </div>
  );
}
