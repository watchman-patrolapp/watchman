import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { normalizeAppRole, canAccessAdminPanel } from "../auth/staffRoles";
import { isGlobalAppRole, isResidentAppRole, canStaffVerifyResident, canReviewPatrollerRequests } from "../auth/roleMatrix";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import AreaContextBar from "../components/layout/AreaContextBar";
import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import {
  RESIDENT_VOUCH_THRESHOLD,
  fetchResidentVouchers,
  verifyResidentAsStaff,
  assignResidentToNeighborhood,
  vouchSummaryForResident,
  verificationLabel,
  listResidentVerificationLogs,
  groupVerificationLogs,
  formatVerifiedBy,
  listResidentNeighbours,
  reviewPatrollerRoleRequest,
} from "../utils/residentVerification";
import {
  formatAwayRange,
  listHouseholdsAway,
} from "../utils/residentAway";
import toast from "react-hot-toast";
import { FaEnvelope, FaPhone, FaSearch, FaSms, FaTrash } from "react-icons/fa";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";
import { listNeighborhoodNextOfKin, resolveEmergencyContacts } from "../utils/emergencyContact";
import { displayWatchAreaName } from "../config/neighborhoodRegions";

function InlineConfirm({ label, onConfirm, onCancel, disabled }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className="px-2 py-1 text-white text-xs rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50"
      >
        Yes
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={disabled}
        className="px-2 py-1 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs rounded-lg"
      >
        No
      </button>
    </div>
  );
}

function KinBlock({ title, kin }) {
  if (!kin?.label) return null;
  return (
    <span className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </span>
      <span className="block font-medium text-gray-900 dark:text-white">{kin.name || "—"}</span>
      {kin.relationshipLabel ? (
        <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-300">{kin.relationshipLabel}</span>
      ) : null}
      {kin.phone ? (
        <a
          href={`tel:${kin.phone.replace(/\s+/g, "")}`}
          className="mt-0.5 block text-xs text-teal-700 hover:underline dark:text-teal-300"
        >
          {kin.phone}
        </a>
      ) : (
        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">No phone</span>
      )}
    </span>
  );
}

function formatJoined(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function telHref(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  if (digits.startsWith("0") && digits.length === 10) return `tel:+27${digits.slice(1)}`;
  if (digits.startsWith("27") && digits.length >= 11) return `tel:+${digits}`;
  return `tel:${digits}`;
}

function smsHref(phone) {
  const href = telHref(phone);
  return href ? href.replace(/^tel:/, "sms:") : "";
}

function StaffContactLinks({ email, phone }) {
  const mail = String(email || "").trim();
  const call = telHref(phone);
  const sms = smsHref(phone);
  const phoneLabel = String(phone || "").trim();
  if (!mail && !call) {
    return <span className="text-xs text-gray-500 dark:text-gray-400">No contact details on file</span>;
  }
  return (
    <div className="space-y-1.5">
      {mail ? (
        <a
          href={`mailto:${mail}`}
          className="flex items-center gap-1.5 text-sm text-teal-700 hover:underline dark:text-teal-300"
        >
          <FaEnvelope className="h-3 w-3 shrink-0" aria-hidden />
          {mail}
        </a>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">No email</p>
      )}
      {call ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={call}
            className="inline-flex items-center gap-1.5 text-sm text-teal-700 hover:underline dark:text-teal-300"
          >
            <FaPhone className="h-3 w-3 shrink-0" aria-hidden />
            {phoneLabel}
          </a>
          {sms ? (
            <a
              href={sms}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-800 hover:underline dark:text-teal-200"
            >
              <FaSms className="h-3 w-3 shrink-0" aria-hidden />
              SMS
            </a>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">No phone</p>
      )}
    </div>
  );
}

export default function AdminResidents() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { activeOrganizationId, activeOrganization, organizations, isGlobalOperator } =
    useActiveOrganization();
  const [users, setUsers] = useState([]);
  const [profilesByUser, setProfilesByUser] = useState({});
  const [vouchers, setVouchers] = useState([]);
  const [verificationLogs, setVerificationLogs] = useState({});
  const [memberUserIds, setMemberUserIds] = useState(() => new Set());
  const [nearbyUserIds, setNearbyUserIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [pendingDeleteUid, setPendingDeleteUid] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [busyUid, setBusyUid] = useState(null);
  const [assignTargetByUid, setAssignTargetByUid] = useState({});
  const [sortBy, setSortBy] = useState("name");
  const [search, setSearch] = useState("");
  const [awayByUser, setAwayByUser] = useState({});

  const currentRole = normalizeAppRole(currentUser?.role);
  const canDeleteUsers = currentRole === "admin" || currentRole === "technical_support";
  const canPromote = canAccessAdminPanel(currentRole);
  const canVerify = canStaffVerifyResident(currentRole);
  const canReviewPatroller = canReviewPatrollerRequests(currentRole);
  const backTo = canPromote ? "/admin" : "/dashboard";
  const backLabel = canPromote ? "← Back to Admin Dashboard" : "← Back to dashboard";

  const residents = useMemo(() => {
    if (!activeOrganizationId) return [];
    const orgName = String(activeOrganization?.name || "").trim().toLowerCase();
    return users.filter((u) => {
      if (!isResidentAppRole(u.role)) return false;
      if (u.organizationId === activeOrganizationId || memberUserIds.has(u.uid)) return true;
      if (nearbyUserIds.has(u.uid)) return true;
      if (!u.organizationId) return true;
      const notes = String(profilesByUser[u.uid]?.notes || "").toLowerCase();
      return Boolean(orgName && notes.includes(orgName));
    });
  }, [users, activeOrganizationId, activeOrganization?.name, memberUserIds, nearbyUserIds, profilesByUser]);

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.uid, u])), [users]);

  const visibleResidents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return residents;
    return residents.filter((u) => {
      const { primary, backup } = resolveEmergencyContacts(u, usersById);
      const address = profilesByUser[u.uid]?.home_address || u.address || "";
      const hay = [
        u.fullName,
        u.email,
        u.phone,
        address,
        primary.name,
        primary.phone,
        primary.relationshipLabel,
        backup.name,
        backup.phone,
        backup.relationshipLabel,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [residents, search, usersById, profilesByUser]);

  const sortedResidents = useMemo(() => {
    const list = [...visibleResidents];
    const tie = (a, b) => String(a.uid).localeCompare(String(b.uid));
    const requestRank = (uid) =>
      profilesByUser[uid]?.patroller_request_status === "pending" ? 0 : 1;
    list.sort((a, b) => {
      const ra = requestRank(a.uid);
      const rb = requestRank(b.uid);
      if (ra !== rb) return ra - rb;
      if (sortBy === "joined_desc" || sortBy === "joined_asc") {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (ta !== tb) return sortBy === "joined_desc" ? tb - ta : ta - tb;
        return tie(a, b);
      }
      if (sortBy === "email") {
        const va = (a.email || "").trim().toLowerCase() || "\uffff";
        const vb = (b.email || "").trim().toLowerCase() || "\uffff";
        const c = va.localeCompare(vb, undefined, { sensitivity: "base" });
        return c !== 0 ? c : tie(a, b);
      }
      const va = (a.fullName || "").trim().toLowerCase() || "\uffff";
      const vb = (b.fullName || "").trim().toLowerCase() || "\uffff";
      const c = va.localeCompare(vb, undefined, { sensitivity: "base" });
      return c !== 0 ? c : tie(a, b);
    });
    return list;
  }, [visibleResidents, sortBy, profilesByUser]);

  const pendingPatrollerCount = useMemo(
    () =>
      residents.filter((u) => profilesByUser[u.uid]?.patroller_request_status === "pending").length,
    [residents, profilesByUser]
  );

  useEffect(() => {
    let cancelled = false;
    async function fetchResidents() {
      setLoading(true);
      try {
        const { data: rpcRows, error: rpcErr } = await supabase.rpc("list_users_for_staff");
        let raw = [];
        if (!rpcErr && Array.isArray(rpcRows)) {
          raw = rpcRows;
        } else {
          if (rpcErr && !isRpcNotFoundError(rpcErr)) {
            console.warn("AdminResidents: list_users_for_staff", rpcErr.message);
          }
          const { data, error } = await supabase
            .from("users")
            .select("*")
            .order("created_at", { ascending: false });
          if (error) throw error;
          raw = data || [];
        }

        const usersData = raw.map((u) => ({
          uid: u.id,
          fullName: u.full_name,
          email: u.email,
          phone: u.phone || "",
          address: u.address || "",
          role: u.role || "resident",
          createdAt: u.created_at || null,
          organizationId: u.organization_id || null,
          verified: Boolean(u.verified),
          verificationMethod: u.verification_method || "",
          emergencyContactName: u.emergency_contact_name || "",
          emergencyContactPhone: u.emergency_contact_phone || "",
          emergencyContactUserId: u.emergency_contact_user_id || "",
          emergencyContactRelationship:
            u.emergency_contact_relationship || u.emergencyContactRelationship || "",
          emergencyContact2Name: u.emergency_contact_2_name || "",
          emergencyContact2Phone: u.emergency_contact_2_phone || "",
          emergencyContact2UserId: u.emergency_contact_2_user_id || "",
          emergencyContact2Relationship:
            u.emergency_contact_2_relationship || u.emergencyContact2Relationship || "",
        }));

        const [kinResult, neighbourRows] = await Promise.all([
          listNeighborhoodNextOfKin(),
          listResidentNeighbours(),
        ]);
        const { data: kinRows } = kinResult;
        if (Array.isArray(kinRows) && kinRows.length) {
          const kinById = Object.fromEntries(
            kinRows.map((row) => [
              row.user_id || row.userId,
              {
                emergencyContactName: row.emergency_contact_name || row.emergencyContactName || "",
                emergencyContactPhone: row.emergency_contact_phone || row.emergencyContactPhone || "",
                emergencyContactUserId: row.emergency_contact_user_id || row.emergencyContactUserId || "",
                emergencyContactRelationship:
                  row.emergency_contact_relationship || row.emergencyContactRelationship || "",
                emergencyContact2Name: row.emergency_contact_2_name || row.emergencyContact2Name || "",
                emergencyContact2Phone: row.emergency_contact_2_phone || row.emergencyContact2Phone || "",
                emergencyContact2UserId:
                  row.emergency_contact_2_user_id || row.emergencyContact2UserId || "",
                emergencyContact2Relationship:
                  row.emergency_contact_2_relationship || row.emergencyContact2Relationship || "",
              },
            ])
          );
          for (const row of usersData) {
            const kin = kinById[row.uid];
            if (!kin) continue;
            row.emergencyContactName = kin.emergencyContactName || row.emergencyContactName;
            row.emergencyContactPhone = kin.emergencyContactPhone || row.emergencyContactPhone;
            row.emergencyContactUserId = kin.emergencyContactUserId || row.emergencyContactUserId;
            row.emergencyContactRelationship =
              kin.emergencyContactRelationship || row.emergencyContactRelationship;
            row.emergencyContact2Name = kin.emergencyContact2Name || row.emergencyContact2Name;
            row.emergencyContact2Phone = kin.emergencyContact2Phone || row.emergencyContact2Phone;
            row.emergencyContact2UserId = kin.emergencyContact2UserId || row.emergencyContact2UserId;
            row.emergencyContact2Relationship =
              kin.emergencyContact2Relationship || row.emergencyContact2Relationship;
          }
        }

        const { data: memberRows, error: memberErr } = activeOrganizationId
          ? await supabase
              .from("organization_members")
              .select("user_id")
              .eq("organization_id", activeOrganizationId)
              .eq("status", "active")
          : { data: [], error: null };
        if (memberErr) throw memberErr;

        const residentIds = usersData
          .filter((u) => isResidentAppRole(u.role))
          .map((u) => u.uid);
        let profileMap = {};
        if (residentIds.length > 0) {
          const { data: profileRows, error: profileErr } = await supabase
            .from("resident_profiles")
            .select(
              "user_id, home_address, verification_date, verification_method, verification_admin_id, notes, patroller_request_status, patroller_request_at"
            )
            .in("user_id", residentIds);
          if (profileErr && /patroller_request/i.test(profileErr.message || "")) {
            const fallback = await supabase
              .from("resident_profiles")
              .select("user_id, home_address, verification_date, verification_method, verification_admin_id, notes")
              .in("user_id", residentIds);
            for (const row of fallback.data || []) {
              profileMap[row.user_id] = row;
            }
          } else if (profileErr && !isRpcNotFoundError(profileErr)) {
            console.warn("AdminResidents: resident_profiles", profileErr.message);
          } else {
            for (const row of profileRows || []) {
              profileMap[row.user_id] = row;
            }
          }
        }

        const voucherRows = residentIds.length > 0 ? await fetchResidentVouchers(residentIds) : [];
        const logRows = await listResidentVerificationLogs();
        const { data: awayRows, error: awayErr } = await listHouseholdsAway();
        if (awayErr && !isRpcNotFoundError(awayErr) && !/forbidden|schema cache|does not exist/i.test(awayErr.message || "")) {
          console.warn("AdminResidents: households away", awayErr.message);
        }
        const awayMap = {};
        for (const row of awayRows || []) {
          if (row?.user_id) awayMap[row.user_id] = row;
        }

        if (!cancelled) {
          setUsers(usersData);
          setProfilesByUser(profileMap);
          setVouchers(voucherRows);
          setVerificationLogs(groupVerificationLogs(logRows));
          setMemberUserIds(new Set((memberRows || []).map((row) => row.user_id)));
          setNearbyUserIds(
            new Set((neighbourRows || []).map((row) => row.user_id).filter(Boolean))
          );
          setAwayByUser(awayMap);
        }
      } catch (err) {
        console.error("Error fetching residents:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchResidents();
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId]);

  const markLinkedToOrg = (uid, organizationId) => {
    setMemberUserIds((prev) => {
      const next = new Set(prev);
      next.delete(uid);
      if (organizationId === activeOrganizationId) next.add(uid);
      return next;
    });
    setUsers((prev) =>
      prev.map((row) => (row.uid === uid ? { ...row, organizationId } : row))
    );
  };

  const handleAssignToNeighborhood = async (uid, organizationId) => {
    const orgId = organizationId || activeOrganizationId;
    if (!orgId) {
      toast.error("Select a neighborhood at the top first.");
      return;
    }
    setBusyUid(uid);
    try {
      const { data, error } = await assignResidentToNeighborhood(uid, orgId);
      if (error) {
        if (isRpcNotFoundError(error)) {
          toast.error("Apply the assign-resident SQL on Supabase first.");
          return;
        }
        throw error;
      }
      const previousOrgId = users.find((row) => row.uid === uid)?.organizationId || null;
      const linkedId = data?.organization_id || orgId;
      markLinkedToOrg(uid, linkedId);
      const label =
        displayWatchAreaName(data?.organization_name) ||
        displayWatchAreaName(organizations.find((org) => org.id === linkedId)?.name) ||
        "this neighborhood";
      toast.success(
        previousOrgId && previousOrgId !== linkedId ? `Moved to ${label}.` : `Assigned to ${label}.`
      );
    } catch (err) {
      console.error("Assign resident failed:", err);
      toast.error(err.message || "Could not assign this household.");
    } finally {
      setBusyUid(null);
    }
  };

  const handleVerify = async (uid) => {
    setBusyUid(uid);
    try {
      const { data, error } = await verifyResidentAsStaff(uid);
      if (error) {
        if (isRpcNotFoundError(error)) {
          toast.error("Apply the resident verification SQL on Supabase first.");
          return;
        }
        throw error;
      }
      setProfilesByUser((prev) => ({
        ...prev,
        [uid]: {
          ...(prev[uid] || { user_id: uid }),
          verification_date: new Date().toISOString(),
          verification_method: data?.method || "staff",
          verification_admin_id: currentUser?.id,
        },
      }));
      toast.success(data?.already_verified ? "Already verified." : "Resident verified.");
      if (activeOrganizationId) {
        const { data: assigned, error: assignErr } = await assignResidentToNeighborhood(
          uid,
          activeOrganizationId
        );
        if (assignErr) {
          console.warn("AdminResidents: link after verify", assignErr.message);
        } else {
          markLinkedToOrg(uid, assigned?.organization_id || activeOrganizationId);
        }
      }
    } catch (err) {
      console.error("Verify resident failed:", err);
      toast.error(err.message || "Failed to verify resident. Apply the latest SQL if this persists.");
    } finally {
      setBusyUid(null);
    }
  };

  const handleReviewPatroller = async (uid, approve) => {
    setBusyUid(uid);
    try {
      const { error } = await reviewPatrollerRoleRequest(uid, approve);
      if (error) {
        if (isRpcNotFoundError(error)) {
          toast.error("Apply the patroller-request SQL on Supabase first.");
          return;
        }
        throw error;
      }
      if (approve) {
        setUsers((prev) => prev.filter((row) => row.uid !== uid));
        toast.success("Approved — moved to patrollers.");
      } else {
        setProfilesByUser((prev) => ({
          ...prev,
          [uid]: {
            ...(prev[uid] || { user_id: uid }),
            patroller_request_status: "rejected",
          },
        }));
        toast.success("Request declined.");
      }
    } catch (err) {
      console.error("Patroller request review failed:", err);
      toast.error(err.message || "Could not review this request.");
    } finally {
      setBusyUid(null);
    }
  };

  const handleRoleChange = async (uid, newRole) => {
    if (isGlobalAppRole(newRole)) {
      toast.error("Main admin and technical support are global and cannot be assigned here.");
      return;
    }
    if (newRole === "patroller" && canReviewPatroller) {
      await handleReviewPatroller(uid, true);
      return;
    }
    const orgId = assignTargetByUid[uid] || activeOrganizationId;
    try {
      if (!isResidentAppRole(newRole) && orgId) {
        const { error: assignErr } = await assignResidentToNeighborhood(uid, orgId);
        if (assignErr && !isRpcNotFoundError(assignErr)) {
          console.warn("AdminResidents: link before promote", assignErr.message);
        } else if (!assignErr) {
          markLinkedToOrg(uid, orgId);
        }
      }
      const { error } = await supabase.from("users").update({ role: newRole }).eq("id", uid);
      if (error) throw error;
      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, role: newRole } : u)));
      if (!isResidentAppRole(newRole)) {
        if (orgId) {
          const { error: syncErr } = await assignResidentToNeighborhood(uid, orgId);
          if (!syncErr) markLinkedToOrg(uid, orgId);
        }
        toast.success("Moved to User Management for this neighborhood.");
      }
    } catch (err) {
      console.error("Error updating role:", err);
      toast.error("Failed to update role.");
    }
  };

  const handleDeleteUser = async (uid) => {
    setDeleteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-delete-user", {
        body: { userId: uid },
      });

      if (error) {
        let msg = error.message || "Request failed";
        try {
          const ctx = error.context;
          if (ctx && typeof ctx.json === "function") {
            const bodyJson = await ctx.json();
            if (bodyJson?.error) msg = String(bodyJson.error);
          }
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }

      if (data && typeof data === "object" && "error" in data && data.error) {
        throw new Error(String(data.error));
      }

      setUsers((prev) => prev.filter((u) => u.uid !== uid));
      setPendingDeleteUid(null);
      toast.success("Resident deleted.");
    } catch (err) {
      console.error("Delete resident failed:", err);
      toast.error(err.message || "Failed to delete resident.");
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
        <BrandedLoader message="Loading residents…" size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(backTo)}
            className="bg-gray-500 text-white dark:bg-gray-600 px-4 py-2 rounded hover:bg-gray-600 dark:hover:bg-gray-700 transition"
          >
            {backLabel}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <AreaContextBar />
            <ThemeToggle variant="toolbar" />
            <label htmlFor="resident-mgmt-sort" className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
              Sort by
            </label>
            <select
              id="resident-mgmt-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white min-w-[10rem]"
            >
              <option value="name">Name</option>
              <option value="email">Email</option>
              <option value="joined_desc">Date joined (newest)</option>
              <option value="joined_asc">Date joined (oldest)</option>
            </select>
          </div>
        </div>
        <h1 className="text-2xl font-bold dark:text-white">Residents</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Household accounts for this neighborhood, plus unlinked signups and nearby households
          from Verify neighbours. Unlinked rows can be assigned to a suburb with{" "}
          <span className="font-medium">Assign to…</span> — that places them on the watch, it does
          not verify them. Call, SMS, or email from the Contact column.
          The <span className="font-medium">Verified</span> badge appears after
          an admin, NW admin, or patroller verifies them, or after two already-verified neighbours vouch.
          The Away column is for patrol — households that marked dates they will be gone.
          Search by resident name to see next of kin — primary, then backup if they added one.
          Verified households can request to become patrollers from Profile; Approve or Reject
          appears on those rows.
        </p>
        {pendingPatrollerCount > 0 ? (
          <p className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-950 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100">
            {pendingPatrollerCount} resident{pendingPatrollerCount === 1 ? "" : "s"} asked to become
            a patroller. Those rows are listed first.
          </p>
        ) : null}
        {canPromote ? (
          <button
            type="button"
            onClick={() => navigate("/admin/users")}
            className="mt-2 text-sm font-medium text-teal-700 dark:text-teal-400 hover:underline"
          >
            Open User Management →
          </button>
        ) : null}
      </div>

      <div className="bg-white dark:bg-gray-800 p-4 rounded shadow overflow-x-auto">
        <h2 className="text-lg font-semibold dark:text-white mb-3">
          Registered residents{activeOrganization ? ` · ${activeOrganization.name}` : ""}{" "}
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400">({sortedResidents.length})</span>
        </h2>
        <div className="relative mb-3 max-w-md">
          <FaSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search resident name, phone, or next of kin"
            aria-label="Search residents"
            className="w-full rounded-lg border border-gray-200 py-2.5 pl-10 pr-3 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
        </div>
        <table className="min-w-full border dark:border-gray-700">
          <thead className="bg-gray-200 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-2 border dark:border-gray-600 dark:text-white">Name</th>
              <th className="px-4 py-2 border dark:border-gray-600 dark:text-white">Contact</th>
              <th className="px-4 py-2 border dark:border-gray-600 dark:text-white">Address</th>
              <th className="px-4 py-2 border dark:border-gray-600 dark:text-white">Next of kin</th>
              <th className="px-4 py-2 border dark:border-gray-600 dark:text-white">Away</th>
              <th className="px-4 py-2 border dark:border-gray-600 dark:text-white">Status</th>
              {canVerify ? (
                <th className="px-4 py-2 border dark:border-gray-600 dark:text-white">Verify</th>
              ) : null}
              {canPromote ? (
                <th className="px-4 py-2 border dark:border-gray-600 dark:text-white">Promote to watch</th>
              ) : null}
              {canDeleteUsers && (
                <th className="px-4 py-2 border dark:border-gray-600 dark:text-white w-48">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedResidents.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    6 + (canVerify ? 1 : 0) + (canPromote ? 1 : 0) + (canDeleteUsers ? 1 : 0)
                  }
                  className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  {search.trim()
                    ? "No residents match that search."
                    : "No registered residents in this neighborhood."}
                </td>
              </tr>
            ) : null}
            {sortedResidents.map((u) => {
              const profile = profilesByUser[u.uid];
              const address = (profile?.home_address || u.address || "").trim();
              const linkedToArea =
                u.organizationId === activeOrganizationId || memberUserIds.has(u.uid);
              const { primary, backup } = resolveEmergencyContacts(u, usersById);
              const verified = Boolean(profile?.verification_date) || Boolean(u.verified);
              const statusProfile = {
                ...(profile || {}),
                verification_date: profile?.verification_date || (u.verified ? u.createdAt || true : null),
                verification_method:
                  profile?.verification_method ||
                  (u.verificationMethod && u.verificationMethod !== "pending" ? u.verificationMethod : "staff"),
              };
              const vouchInfo = vouchSummaryForResident(vouchers, u.uid, currentUser?.id);
              return (
                <tr key={u.uid} className="border-b hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-700">
                  <td className="px-4 py-2 border dark:border-gray-600 dark:text-gray-300">
                    <p>{u.fullName || "—"}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Joined {formatJoined(u.createdAt)}</p>
                    {!linkedToArea ? (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                          Not linked to this neighborhood
                        </p>
                        {canVerify ? (
                          <>
                            {isGlobalOperator && organizations.length > 1 ? (
                              <select
                                value={assignTargetByUid[u.uid] || activeOrganizationId || ""}
                                onChange={(event) =>
                                  setAssignTargetByUid((prev) => ({
                                    ...prev,
                                    [u.uid]: event.target.value,
                                  }))
                                }
                                className="w-full max-w-[14rem] rounded border px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                aria-label={`Suburb for ${u.fullName || "resident"}`}
                              >
                                {organizations.map((org) => (
                                  <option key={org.id} value={org.id}>
                                    {displayWatchAreaName(org.name)}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                            <button
                              type="button"
                              onClick={() =>
                                void handleAssignToNeighborhood(
                                  u.uid,
                                  assignTargetByUid[u.uid] || activeOrganizationId
                                )
                              }
                              disabled={
                                busyUid === u.uid ||
                                !(assignTargetByUid[u.uid] || activeOrganizationId)
                              }
                              className="rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                            >
                              {busyUid === u.uid
                                ? "Assigning…"
                                : `Assign to ${
                                    displayWatchAreaName(
                                      organizations.find(
                                        (org) =>
                                          org.id ===
                                          (assignTargetByUid[u.uid] || activeOrganizationId)
                                      )?.name
                                    ) || "suburb"
                                  }`}
                            </button>
                          </>
                        ) : null}
                      </div>
                    ) : isGlobalOperator && organizations.length > 1 ? (
                      <div className="mt-2 space-y-1.5">
                        <select
                          value={assignTargetByUid[u.uid] || ""}
                          onChange={(event) =>
                            setAssignTargetByUid((prev) => ({
                              ...prev,
                              [u.uid]: event.target.value,
                            }))
                          }
                          className="w-full max-w-[14rem] rounded border px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                          aria-label={`Move ${u.fullName || "resident"} to suburb`}
                        >
                          <option value="">Move to suburb…</option>
                          {organizations.map((org) => (
                            <option key={org.id} value={org.id}>
                              {displayWatchAreaName(org.name)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void handleAssignToNeighborhood(u.uid, assignTargetByUid[u.uid])}
                          disabled={
                            busyUid === u.uid ||
                            !assignTargetByUid[u.uid] ||
                            assignTargetByUid[u.uid] === u.organizationId
                          }
                          className="rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                        >
                          {busyUid === u.uid
                            ? "Saving…"
                            : `Move to ${
                                displayWatchAreaName(
                                  organizations.find((org) => org.id === assignTargetByUid[u.uid])?.name
                                ) || "suburb"
                              }`}
                        </button>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 border dark:border-gray-600 dark:text-gray-300">
                    <StaffContactLinks email={u.email} phone={u.phone} />
                  </td>
                  <td className="px-4 py-2 border dark:border-gray-600 dark:text-gray-300 text-sm">
                    {address || "—"}
                  </td>
                  <td className="px-4 py-2 border dark:border-gray-600 dark:text-gray-300 text-sm">
                    {primary.label || backup.label ? (
                      <div className="space-y-2">
                        <KinBlock title="Primary" kin={primary} />
                        <KinBlock title="Backup" kin={backup} />
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 border dark:border-gray-600 dark:text-gray-300 text-sm">
                    {awayByUser[u.uid] ? (
                      <span>
                        {formatAwayRange(awayByUser[u.uid])}
                        {awayByUser[u.uid].note ? (
                          <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                            {awayByUser[u.uid].note}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 border dark:border-gray-600">
                    <span
                      className={`px-2 py-1 rounded text-sm ${
                        verified
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                      }`}
                    >
                      {verified ? verificationLabel(statusProfile) : "Pending"}
                    </span>
                    {profile?.patroller_request_status === "pending" ? (
                      <p className="mt-1 text-xs font-medium text-cyan-800 dark:text-cyan-200">
                        Wants to become a patroller
                      </p>
                    ) : profile?.patroller_request_status === "rejected" ? (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Patroller request declined
                      </p>
                    ) : null}
                    {verified && verificationLogs[u.uid]?.length ? (
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                        {formatVerifiedBy(verificationLogs[u.uid])}
                      </p>
                    ) : null}
                    {!verified ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {vouchInfo.count}/{RESIDENT_VOUCH_THRESHOLD} neighbour vouches
                        {verificationLogs[u.uid]?.length
                          ? ` · ${verificationLogs[u.uid]
                              .filter((row) => row.kind === "vouch")
                              .map((row) => row.actor_name)
                              .join(", ")}`
                          : ""}
                      </p>
                    ) : null}
                  </td>
                  {canVerify ? (
                    <td className="px-4 py-2 border dark:border-gray-600">
                      {verified ? (
                        <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleVerify(u.uid)}
                          disabled={busyUid === u.uid}
                          className="px-3 py-1 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {busyUid === u.uid ? "Verifying…" : "Verify"}
                        </button>
                      )}
                    </td>
                  ) : null}
                  {canPromote ? (
                    <td className="px-4 py-2 border dark:border-gray-600">
                    {canReviewPatroller && profile?.patroller_request_status === "pending" ? (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleReviewPatroller(u.uid, true)}
                          disabled={busyUid === u.uid}
                          className="rounded-lg bg-cyan-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-cyan-800 disabled:opacity-50"
                        >
                          {busyUid === u.uid ? "Saving…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReviewPatroller(u.uid, false)}
                          disabled={busyUid === u.uid}
                          className="rounded-lg bg-gray-200 px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-600 dark:text-gray-100 dark:hover:bg-gray-500"
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                    <select
                      value="resident"
                      onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                      className="border rounded px-2 py-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      disabled={u.uid === currentUser?.id}
                    >
                      <option value="resident" className="dark:bg-gray-700">
                        Keep as resident
                      </option>
                      <option value="volunteer" className="dark:bg-gray-700">
                        Volunteer
                      </option>
                      <option value="patroller" className="dark:bg-gray-700">
                        Patroller
                      </option>
                      <option value="investigator" className="dark:bg-gray-700">
                        Investigator
                      </option>
                      <option value="committee" className="dark:bg-gray-700">
                        Committee
                      </option>
                      <option value="nw_admin" className="dark:bg-gray-700">
                        NW Admin
                      </option>
                    </select>
                    </td>
                  ) : null}
                  {canDeleteUsers && (
                    <td className="px-4 py-2 border dark:border-gray-600 align-top">
                      {u.uid === currentUser?.id ? (
                        <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                      ) : pendingDeleteUid === u.uid ? (
                        <InlineConfirm
                          label="Delete this resident?"
                          disabled={deleteLoading}
                          onConfirm={() => handleDeleteUser(u.uid)}
                          onCancel={() => setPendingDeleteUid(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteUid(u.uid)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 transition"
                          title="Remove account (auth + profile)"
                        >
                          <FaTrash className="text-[10px]" />
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
