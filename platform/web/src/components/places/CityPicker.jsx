import { useEffect, useId, useRef, useState } from "react";
import { FaMapMarkerAlt, FaTimes } from "react-icons/fa";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { searchCities } from "../../utils/places";
import { cityOptionLabel, cityOptionNote, PLACES_DEBOUNCE_MS, shouldSearchPlaces } from "../../utils/placesView";

/**
 * "Where do you live?" city / town search. Typing an old name shows the current one,
 * e.g. "Grahamstown" -> "Makhanda, Eastern Cape (formerly Grahamstown)".
 */
export default function CityPicker({ id = "city-picker", label = "City or town", value, onChange, required = false, hint }) {
  const listId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const query = useDebouncedValue(text, PLACES_DEBOUNCE_MS);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open || !shouldSearchPlaces(query)) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    let ignore = false;
    setLoading(true);
    setError("");
    searchCities(query, 8)
      .then((rows) => {
        if (ignore) return;
        setResults(rows);
        setHighlight(0);
      })
      .catch((err) => {
        if (ignore) return;
        setResults([]);
        setError(err?.friendly || "Couldn't search cities. Please try again.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [query, open]);

  const choose = (city) => {
    onChange?.(city);
    setText("");
    setOpen(false);
    setResults([]);
  };

  const onKeyDown = (e) => {
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  if (value?.id) {
    const note = cityOptionNote(value);
    return (
      <div>
        <p className="mb-1 block text-sm font-medium text-text-primary">
          {label}
          {required ? <span className="text-danger" aria-hidden> *</span> : null}
        </p>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
          <p className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
            <FaMapMarkerAlt className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" aria-hidden />
            <span>
              {cityOptionLabel(value)}
              {note ? <span className="text-text-tertiary"> {note}</span> : null}
            </span>
          </p>
          <button
            type="button"
            onClick={() => {
              onChange?.(null);
              setOpen(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 dark:text-teal-400 hover:underline"
          >
            <FaTimes className="h-3 w-3" aria-hidden />
            Change
          </button>
        </div>
        {hint ? <p className="mt-1 text-sm text-text-tertiary">{hint}</p> : null}
      </div>
    );
  }

  const showList = open && shouldSearchPlaces(text);
  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-text-primary">
        {label}
        {required ? <span className="text-danger" aria-hidden> *</span> : null}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[highlight] ? `${listId}-${highlight}` : undefined}
        autoComplete="off"
        placeholder="Start typing your city or town"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        className="input border w-full"
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          {loading && !results.length ? (
            <li className="px-3 py-2 text-sm text-text-tertiary">Searching…</li>
          ) : error ? (
            <li className="px-3 py-2 text-sm text-danger">{error}</li>
          ) : !results.length ? (
            <li className="px-3 py-2 text-sm text-text-tertiary">No South African city or town by that name. Check the spelling.</li>
          ) : (
            results.map((city, i) => {
              const note = cityOptionNote(city);
              return (
                <li
                  key={city.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(city);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`cursor-pointer px-3 py-2 text-sm ${
                    i === highlight ? "bg-teal-50 dark:bg-teal-900/30" : ""
                  } text-gray-900 dark:text-white`}
                >
                  {cityOptionLabel(city)}
                  {note ? <span className="text-text-tertiary"> {note}</span> : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
      <p className="mt-1 text-sm text-text-tertiary">
        {hint || "South Africa only. Old names work too, e.g. Port Elizabeth or Grahamstown."}
      </p>
    </div>
  );
}
