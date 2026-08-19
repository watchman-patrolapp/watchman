import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase/client";
import { FaUser, FaMapMarkerAlt, FaEnvelope, FaPhone, FaArrowLeft, FaCalendarAlt } from "react-icons/fa";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";
import { normalizeVehicleType, ProfileVehicleGlyph } from "../components/VehicleIcon";
import { isLightMobilityVehicleType, getVehicleTypePublicLabel } from "../utils/vehicleTypeConstants";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import { filterUsersForOrganization } from "../utils/organizationUsers";
import { isResidentAppRole, normalizeAppRole } from "../auth/roleMatrix";
import AreaContextBar from "../components/layout/AreaContextBar";
import { displayWatchAreaName } from "../config/neighborhoodRegions";

const THEMES = {
  patroller: {
    title: "Patroller member profiles",
    loader: "Loading patroller profiles…",
    empty: "No verified patrollers in this suburb.",
    icon: "text-cyan-600 dark:text-cyan-400",
    ring: "ring-cyan-200 dark:ring-cyan-800",
    avatar: "bg-cyan-100 dark:bg-cyan-900/50 text-cyan-800 dark:text-cyan-200",
    link: "text-cyan-700 hover:underline dark:text-cyan-300",
    card: "border-cyan-200/80 dark:border-cyan-900/50 border-l-4 border-l-cyan-500",
    badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200",
    otherTo: "/admin/resident-profiles",
    otherLabel: "Verified resident profiles",
  },
  resident: {
    title: "Verified resident profiles",
    loader: "Loading resident profiles…",
    empty: "No verified residents in this suburb.",
    icon: "text-emerald-600 dark:text-emerald-400",
    ring: "ring-emerald-200 dark:ring-emerald-800",
    avatar: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200",
    link: "text-emerald-700 hover:underline dark:text-emerald-300",
    card: "border-emerald-200/80 dark:border-emerald-900/50 border-l-4 border-l-emerald-500",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    otherTo: "/admin/members",
    otherLabel: "Patroller member profiles",
  },
};

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

function isVerifiedRow(user, profile) {
  return Boolean(user?.verified) || Boolean(profile?.verification_date);
}

function matchesDirectoryVariant(user, variant) {
  const role = normalizeAppRole(user?.role);
  if (variant === "patroller") return role === "patroller";
  return isResidentAppRole(role);
}

function telHref(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  if (digits.startsWith("0") && digits.length === 10) return `tel:+27${digits.slice(1)}`;
  if (digits.startsWith("27") && digits.length >= 11) return `tel:+${digits}`;
  return `tel:${digits}`;
}

function ProfileCardBody({ row, vehicles, theme, showVehicles }) {
  const primary =
    vehicles?.length > 0 ? vehicles.find((v) => v.is_primary) || vehicles[0] : null;
  const showLegacyVehicle = showVehicles && !primary && (row.car_type || row.registration_number);
  const mail = String(row.email || "").trim();
  const call = telHref(row.phone);

  return (
    <div className="p-5 space-y-3 flex-1">
      <div className="flex items-center space-x-3">
        <FaUser className={`${theme.icon} w-5 h-5 shrink-0`} />
        <span className="text-gray-700 dark:text-gray-300 text-sm">
          <span className="font-medium">Name:</span> {row.full_name?.trim() || "Not provided"}
        </span>
      </div>
      <div className="flex items-center space-x-3">
        <FaCalendarAlt className={`${theme.icon} w-5 h-5 shrink-0`} />
        <span className="text-gray-700 dark:text-gray-300 text-sm">
          <span className="font-medium">Date joined:</span> {formatDateJoined(row.created_at)}
        </span>
      </div>
      <div className="flex items-center space-x-3">
        <FaMapMarkerAlt className={`${theme.icon} w-5 h-5 shrink-0`} />
        <span className="text-gray-700 dark:text-gray-300 text-sm">
          <span className="font-medium">Address:</span> {row.address?.trim() || "Not provided"}
        </span>
      </div>
      {showVehicles && primary ? (
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
      ) : null}
      {showVehicles && showLegacyVehicle ? (
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
        <FaEnvelope className={`${theme.icon} w-5 h-5 shrink-0`} />
        <span className="text-gray-700 dark:text-gray-300 text-sm break-all">
          <span className="font-medium">Email:</span>{" "}
          {mail ? (
            <a href={`mailto:${mail}`} className={theme.link}>
              {mail}
            </a>
          ) : (
            "—"
          )}
        </span>
      </div>
      <div className="flex items-center space-x-3">
        <FaPhone className={`${theme.icon} w-5 h-5 shrink-0`} />
        <span className="text-gray-700 dark:text-gray-300 text-sm">
          <span className="font-medium">Phone:</span>{" "}
          {call ? (
            <a href={call} className={theme.link}>
              {row.phone.trim()}
            </a>
          ) : (
            "Not provided"
          )}
        </span>
      </div>
    </div>
  );
}

export default function AdminDirectoryProfiles({ variant = "patroller" }) {
  const navigate = useNavigate();
  const { activeOrganizationId, activeOrganization, isGlobalOperator } = useActiveOrganization();
  const theme = THEMES[variant] || THEMES.patroller;
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
            console.warn("AdminDirectoryProfiles: list_users_for_staff", rpcErr.message);
          }
          const { data, error: uErr } = await supabase.from("users").select("*");
          if (uErr) throw uErr;
          users = data || [];
        }

        const { data: memberRows, error: memberErr } = activeOrganizationId
          ? await supabase
              .from("organization_members")
              .select("user_id")
              .eq("organization_id", activeOrganizationId)
              .eq("status", "active")
          : { data: [], error: null };
        if (memberErr) throw memberErr;

        const scopedUsers = activeOrganizationId
          ? filterUsersForOrganization(
              users,
              activeOrganizationId,
              new Set((memberRows || []).map((row) => row.user_id)),
              { includeUnlinked: isGlobalOperator }
            ).filter((user) => matchesDirectoryVariant(user, variant))
          : [];

        const ids = scopedUsers.map((user) => user.id).filter(Boolean);
        let profileByUser = {};
        if (ids.length) {
          const { data: profileRows, error: profileErr } = await supabase
            .from("resident_profiles")
            .select("user_id, verification_date, verification_method")
            .in("user_id", ids);
          if (profileErr && !isRpcNotFoundError(profileErr)) {
            console.warn("AdminDirectoryProfiles: resident_profiles", profileErr.message);
          }
          for (const row of profileRows || []) {
            profileByUser[row.user_id] = row;
          }
        }

        const directoryUsers =
          variant === "patroller"
            ? scopedUsers
            : scopedUsers.filter((user) => isVerifiedRow(user, profileByUser[user.id]));

        const { data: vehicles, error: vErr } = await supabase.from("user_vehicles").select("*");
        if (vErr) throw vErr;
        if (cancelled) return;
        const map = {};
        for (const v of vehicles || []) {
          if (!map[v.user_id]) map[v.user_id] = [];
          map[v.user_id].push(v);
        }
        setRows(directoryUsers);
        setVehiclesByUser(map);
      } catch (e) {
        if (!cancelled) setError(e?.message || "Failed to load profiles");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId, isGlobalOperator, variant]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    const tie = (a, b) => String(a.id).localeCompare(String(b.id));
    list.sort((a, b) => {
      if (sortBy === "joined") {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (tb !== ta) return tb - ta;
        return tie(a, b);
      }
      const va = (a.full_name || "").trim().toLowerCase() || "\uffff";
      const vb = (b.full_name || "").trim().toLowerCase() || "\uffff";
      const c = va.localeCompare(vb, undefined, { sensitivity: "base" });
      return c !== 0 ? c : tie(a, b);
    });
    return list;
  }, [rows, sortBy]);

  const suburbLabel = displayWatchAreaName(activeOrganization?.name) || activeOrganization?.name || "";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <BrandedLoader message={theme.loader} size="lg" />
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
              <AreaContextBar />
              <ThemeToggle variant="toolbar" />
              <label htmlFor={`${variant}-sort`} className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                Sort by
              </label>
              <select
                id={`${variant}-sort`}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white min-w-[10rem]"
              >
                <option value="name">Name</option>
                <option value="joined">Date joined</option>
              </select>
            </div>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{theme.title}</h1>
          {suburbLabel ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {suburbLabel}
              {activeOrganization?.name && displayWatchAreaName(activeOrganization.name) !== activeOrganization.name
                ? ` · ${activeOrganization.name}`
                : ""}
            </p>
          ) : null}
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {variant === "patroller"
              ? "Patrollers assigned to the selected suburb only."
              : "Verified households for the selected suburb / neighborhood only."}{" "}
            See{" "}
            <button
              type="button"
              onClick={() => navigate(theme.otherTo)}
              className={`font-medium ${theme.link}`}
            >
              {theme.otherLabel}
            </button>
            {variant === "resident" ? (
              <>
                {" "}
                or manage accounts on{" "}
                <button
                  type="button"
                  onClick={() => navigate("/admin/residents")}
                  className={`font-medium ${theme.link}`}
                >
                  Residents
                </button>
              </>
            ) : null}
            .
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedRows.map((row) => {
            const vehicles = vehiclesByUser[row.id] || [];
            return (
              <div
                key={row.id}
                className={`bento-tile overflow-hidden flex flex-col min-h-[12rem] border bg-white dark:bg-gray-800 shadow-card ${theme.card}`}
              >
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0 flex items-start gap-3">
                  <div className="shrink-0">
                    {row.avatar_url ? (
                      <img
                        src={row.avatar_url}
                        alt=""
                        className={`h-12 w-12 rounded-full object-cover ring-2 ${theme.ring}`}
                      />
                    ) : (
                      <div
                        className={`h-12 w-12 rounded-full flex items-center justify-center text-sm font-bold ${theme.avatar}`}
                      >
                        {initialsFromRow(row)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                      {row.full_name?.trim() || row.email || (variant === "patroller" ? "Patroller" : "Resident")}
                    </h2>
                    <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${theme.badge}`}>
                      {variant === "patroller" ? "Patroller" : "Verified resident"}
                    </span>
                    {activeOrganizationId && row.organization_id !== activeOrganizationId ? (
                      <p className="mt-1 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                        Not linked to this neighborhood
                      </p>
                    ) : null}
                  </div>
                </div>
                <ProfileCardBody
                  row={row}
                  vehicles={vehicles}
                  theme={theme}
                  showVehicles={variant === "patroller"}
                />
              </div>
            );
          })}
        </div>

        {sortedRows.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12">{theme.empty}</p>
        ) : null}
      </div>
    </div>
  );
}
