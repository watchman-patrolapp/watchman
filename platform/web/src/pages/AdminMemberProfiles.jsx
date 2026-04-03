import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase/client";
import { FaUser, FaMapMarkerAlt, FaEnvelope, FaPhone, FaArrowLeft, FaCalendarAlt } from "react-icons/fa";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";
import { normalizeVehicleType, ProfileVehicleGlyph } from "../components/VehicleIcon";
import { isLightMobilityVehicleType, getVehicleTypePublicLabel } from "../utils/vehicleTypeConstants";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";

function initialsFromRow(row) {
  const name = row?.full_name?.trim();
  if (name) {
    return name
      .split(/\s+/)
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  }
  return row?.email?.charAt(0)?.toUpperCase() || "?";
}

function formatDateJoined(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function roleBadgeClass(role) {
  const r = String(role || "volunteer").toLowerCase();
  if (r === "admin")
    return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
  if (r === "committee")
    return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
  if (r === "technical_support")
    return "bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200";
  if (r === "patroller" || r === "investigator")
    return "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200";
  return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
}

function ProfileCardBody({ row, vehicles }) {
  const primary =
    vehicles?.length > 0 ? vehicles.find((v) => v.is_primary) || vehicles[0] : null;

  const showLegacyVehicle = !primary && (row.car_type || row.registration_number);

  return (
    <div className="p-5 space-y-3 flex-1">
      <div className="flex items-center space-x-3">
        <FaUser className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
        <span className="text-gray-700 dark:text-gray-300 text-sm">
          <span className="font-medium">Name:</span> {row.full_name?.trim() || "Not provided"}
        </span>
      </div>
      <div className="flex items-center space-x-3">
        <FaCalendarAlt className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
        <span className="text-gray-700 dark:text-gray-300 text-sm">
          <span className="font-medium">Date joined:</span> {formatDateJoined(row.created_at)}
        </span>
      </div>
      <div className="flex items-center space-x-3">
        <FaMapMarkerAlt className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
        <span className="text-gray-700 dark:text-gray-300 text-sm">
          <span className="font-medium">Address:</span> {row.address?.trim() || "Not provided"}
        </span>
      </div>
      {primary ? (
        <div className="flex items-center space-x-3 min-w-0">
          <ProfileVehicleGlyph
            type={primary.vehicle_type}
            carType={primary.car_type || row.car_type}
          />
          <span className="text-gray-700 dark:text-gray-300 text-sm min-w-0">
            <span className="font-medium">Primary vehicle:</span>{" "}
            {(() => {
              const norm = normalizeVehicleType(
                primary.vehicle_type,
                primary.car_type || row.car_type
              );
              return isLightMobilityVehicleType(norm)
                ? getVehicleTypePublicLabel(norm)
                : `${primary.make_model || "—"}${
                    primary.registration ? ` (${primary.registration})` : ""
                  }`;
            })()}
          </span>
        </div>
      ) : showLegacyVehicle ? (
        <div className="flex items-center space-x-3 min-w-0">
          <ProfileVehicleGlyph
            type={row.car_type}
            carType={row.registration_number ? "car" : null}
          />
          <span className="text-gray-700 dark:text-gray-300 text-sm min-w-0">
            <span className="font-medium">Vehicle:</span>{" "}
            {row.car_type && row.registration_number
              ? `${row.car_type} (${row.registration_number})`
              : row.car_type || row.registration_number}
          </span>
        </div>
      ) : null}
      <div className="flex items-center space-x-3">
        <FaEnvelope className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
        <span className="text-gray-700 dark:text-gray-300 text-sm break-all">
          <span className="font-medium">Email:</span> {row.email || "—"}
        </span>
      </div>
      <div className="flex items-center space-x-3">
        <FaPhone className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
        <span className="text-gray-700 dark:text-gray-300 text-sm">
          <span className="font-medium">Phone:</span>{" "}
          {row.phone?.trim() ? row.phone : "Not provided"}
        </span>
      </div>
    </div>
  );
}

export default function AdminMemberProfiles() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [vehiclesByUser, setVehiclesByUser] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState("name");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: rpcRows, error: rpcErr } = await supabase.rpc("list_users_for_staff");
        let users = [];
        if (!rpcErr && Array.isArray(rpcRows)) {
          users = rpcRows;
        } else {
          if (rpcErr && !isRpcNotFoundError(rpcErr)) {
            console.warn("AdminMemberProfiles: list_users_for_staff", rpcErr.message);
          }
          const { data, error: uErr } = await supabase.from("users").select("*");
          if (uErr) throw uErr;
          users = data || [];
        }

        const { data: vehicles, error: vErr } = await supabase.from("user_vehicles").select("*");
        if (vErr) throw vErr;
        if (cancelled) return;
        const map = {};
        for (const v of vehicles || []) {
          if (!map[v.user_id]) map[v.user_id] = [];
          map[v.user_id].push(v);
        }
        setRows(users);
        setVehiclesByUser(map);
      } catch (e) {
        if (!cancelled) setError(e?.message || "Failed to load members");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    const tie = (a, b) => String(a.id).localeCompare(String(b.id));
    list.sort((a, b) => {
      if (sortBy === "name") {
        const va = (a.full_name || "").trim().toLowerCase() || "\uffff";
        const vb = (b.full_name || "").trim().toLowerCase() || "\uffff";
        const c = va.localeCompare(vb, undefined, { sensitivity: "base" });
        return c !== 0 ? c : tie(a, b);
      }
      if (sortBy === "joined") {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (tb !== ta) return tb - ta;
        return tie(a, b);
      }
      const va = (a.role || "volunteer").toLowerCase();
      const vb = (b.role || "volunteer").toLowerCase();
      const c = va.localeCompare(vb, undefined, { sensitivity: "base" });
      return c !== 0 ? c : tie(a, b);
    });
    return list;
  }, [rows, sortBy]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <BrandedLoader message="Loading member profiles…" size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 dark:bg-gray-900 px-4">
        <p className="text-red-600 dark:text-red-400 text-center">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mb-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate("/admin")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
            >
              <FaArrowLeft className="w-3 h-3" aria-hidden />
              Back to Admin Dashboard
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <ThemeToggle variant="toolbar" />
              <label htmlFor="member-sort" className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                Sort by
              </label>
              <select
                id="member-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white min-w-[10rem]"
              >
                <option value="name">Name</option>
                <option value="joined">Date joined</option>
                <option value="role">Role</option>
              </select>
            </div>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Member profiles</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedRows.map((row) => {
            const vehicles = vehiclesByUser[row.id] || [];
            return (
              <div
                key={row.id}
                className="bento-tile overflow-hidden flex flex-col min-h-[12rem] border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-card"
              >
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0 flex items-start gap-3">
                  <div className="shrink-0">
                    {row.avatar_url ? (
                      <img
                        src={row.avatar_url}
                        alt=""
                        className="h-12 w-12 rounded-full object-cover ring-2 ring-teal-200 dark:ring-teal-800"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-full bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-200 flex items-center justify-center text-sm font-bold">
                        {initialsFromRow(row)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                      {row.full_name?.trim() || row.email || "Member"}
                    </h2>
                    <span
                      className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full capitalize ${roleBadgeClass(row.role)}`}
                    >
                      {row.role || "volunteer"}
                    </span>
                  </div>
                </div>
                <ProfileCardBody row={row} vehicles={vehicles} />
              </div>
            );
          })}
        </div>

        {sortedRows.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12">No members found.</p>
        ) : null}
      </div>
    </div>
  );
}
