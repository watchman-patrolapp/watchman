import CapabilityBadge from "../../community/CapabilityBadge";
import { resolveEmergencyContacts } from "../../../utils/emergencyContact";
import {
  RESIDENT_VOUCH_THRESHOLD,
  vouchSummaryForResident,
  verificationLabel,
  formatVerifiedBy,
} from "../../../utils/residentVerification";
import { formatAwayRange } from "../../../utils/residentAway";
import { displayWatchAreaName } from "../../../config/neighborhoodRegions";
import { FaTrash } from "react-icons/fa";
import { InlineConfirm, KinBlock, formatJoined, StaffContactLinks } from "./residentWidgets";

export default function ResidentCard({
  u,
  profilesByUser,
  activeOrganizationId,
  memberUserIds,
  usersById,
  vouchers,
  currentUser,
  badgesByUser,
  canManageCaps,
  setCapTarget,
  isGlobalOperator,
  organizations,
  assignTargetByUid,
  setAssignTargetByUid,
  handleAssignToNeighborhood,
  busyUid,
  awayByUser,
  verificationLogs,
  canVerify,
  canPromote,
  handleVerify,
  canReviewPatroller,
  handleReviewPatroller,
  handleRoleChange,
  canDeleteUsers,
  pendingDeleteUid,
  setPendingDeleteUid,
  deleteLoading,
  handleDeleteUser,
}) {
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
    <tr className="border-b hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-700">
      <td className="px-4 py-2 border dark:border-gray-600 dark:text-gray-300">
        <p>{u.fullName || "—"}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">Joined {formatJoined(u.createdAt)}</p>
        {(badgesByUser.get(u.uid) || []).length ? (
          <p className="mt-1 flex flex-wrap gap-1">
            {badgesByUser.get(u.uid).map((b) => (
              <CapabilityBadge key={b.capability} capability={b.capability} title={b.title} />
            ))}
          </p>
        ) : null}
        {canManageCaps && linkedToArea && verified ? (
          <button
            type="button"
            onClick={() => setCapTarget(u)}
            className="mt-1 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            Resident roles
          </button>
        ) : null}
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
          disabled={busyUid === u.uid || u.uid === currentUser?.id}
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
}
