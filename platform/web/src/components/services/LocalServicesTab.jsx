import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FaPlus } from "react-icons/fa";
import ServiceListingCard from "./ServiceListingCard";
import NeighbouringSuburbsCard from "./NeighbouringSuburbsCard";
import { FALLBACK_SERVICE_CATEGORIES, SEARCH_EXAMPLES } from "../../data/serviceCategories";
import {
  listMyOrgNeighbours,
  listServiceCategories,
  searchLocalServices,
} from "../../utils/localServicesApi";
import {
  LOAD_FALLBACK,
  effectiveIncludeNeighbours,
  friendlyServiceError,
  showNeighboursCheckbox,
  withIncludeNeighbours,
} from "../../utils/localServices";

const DEBOUNCE_MS = 250;

export default function LocalServicesTab({ canAdd = false, canManageNeighbours = false }) {
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState(null);
  const [categories, setCategories] = useState(FALLBACK_SERVICE_CATEGORIES);
  const [neighbours, setNeighbours] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const gen = useRef(0);

  const includeNeighbours = useMemo(() => effectiveIncludeNeighbours(search, neighbours), [search, neighbours]);

  const loadNeighbours = useCallback(async () => {
    try {
      setNeighbours(await listMyOrgNeighbours());
    } catch {
      setNeighbours([]);
    }
  }, []);

  useEffect(() => {
    void loadNeighbours();
    listServiceCategories()
      .then((list) => {
        const top = list.filter((c) => !c.parent_slug);
        if (top.length) setCategories(top);
      })
      .catch(() => {});
  }, [loadNeighbours]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const id = ++gen.current;
    searchLocalServices({ query: debounced, category, includeNeighbours })
      .then((data) => {
        if (id !== gen.current) return;
        setRows(data);
        setError("");
      })
      .catch((err) => {
        if (id !== gen.current) return;
        setRows([]);
        setError(friendlyServiceError(err, LOAD_FALLBACK));
      })
      .finally(() => {
        if (id === gen.current) setLoading(false);
      });
  }, [debounced, category, includeNeighbours]);

  const chip = (active) =>
    `rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${
      active
        ? "bg-teal-600 text-white ring-teal-600"
        : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700"
    }`;

  return (
    <div className="space-y-4">
      {canManageNeighbours ? <NeighbouringSuburbsCard onChanged={loadNeighbours} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search, e.g. ${SEARCH_EXAMPLES.slice(0, 3).join(", ")}`}
          aria-label="Search local services"
          className="input border min-w-0 flex-1"
        />
        {canAdd ? (
          <>
            <Link
              to="/resident/services/mine"
              className="rounded-lg px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-gray-800"
            >
              My listings
            </Link>
            <Link
              to="/resident/services/new"
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700"
            >
              <FaPlus className="h-3 w-3" aria-hidden /> Add your service
            </Link>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
        <button type="button" className={chip(category === null)} onClick={() => setCategory(null)}>
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.slug}
            type="button"
            aria-pressed={category === c.slug}
            className={chip(category === c.slug)}
            onClick={() => setCategory(category === c.slug ? null : c.slug)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {showNeighboursCheckbox(neighbours) ? (
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={includeNeighbours}
            onChange={(e) => setParams(withIncludeNeighbours(params, e.target.checked), { replace: true })}
          />
          Include neighbouring suburbs
        </label>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading local services…</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-300">No services found yet.</p>
          {canAdd ? (
            <Link
              to="/resident/services/new"
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700"
            >
              <FaPlus className="h-3 w-3" aria-hidden /> Add your service
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((row) => (
            <ServiceListingCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
