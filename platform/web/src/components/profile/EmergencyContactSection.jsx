import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FaPhone, FaSearch, FaTimes, FaUserFriends } from "react-icons/fa";
import { isRpcNotFoundError } from "../../utils/isRpcNotFound";
import {
  EMERGENCY_CONTACT_RELATIONSHIPS,
  formatEmergencyContact,
  listEmergencyContactCandidates,
  setMyEmergencyContact,
} from "../../utils/emergencyContact";

function fieldsFromUser(user, slot) {
  if (Number(slot) === 2) {
    return {
      linkedUserId: user?.emergencyContact2UserId || "",
      name: user?.emergencyContact2Name || "",
      phone: user?.emergencyContact2Phone || "",
      relationship: user?.emergencyContact2Relationship || "",
    };
  }
  return {
    linkedUserId: user?.emergencyContactUserId || "",
    name: user?.emergencyContactName || "",
    phone: user?.emergencyContactPhone || "",
    relationship: user?.emergencyContactRelationship || "",
  };
}

export default function EmergencyContactSection({ user, onSaved, slot = 1 }) {
  const isBackup = Number(slot) === 2;
  const initial = fieldsFromUser(user, slot);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [linkedUserId, setLinkedUserId] = useState(initial.linkedUserId);
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [relationship, setRelationship] = useState(initial.relationship);
  const [busy, setBusy] = useState(false);
  const excludeUserId = isBackup
    ? user?.emergencyContactUserId || ""
    : user?.emergencyContact2UserId || "";

  useEffect(() => {
    const next = fieldsFromUser(user, slot);
    setLinkedUserId(next.linkedUserId);
    setName(next.name);
    setPhone(next.phone);
    setRelationship(next.relationship);
  }, [
    slot,
    user?.emergencyContactUserId,
    user?.emergencyContactName,
    user?.emergencyContactPhone,
    user?.emergencyContactRelationship,
    user?.emergencyContact2UserId,
    user?.emergencyContact2Name,
    user?.emergencyContact2Phone,
    user?.emergencyContact2Relationship,
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await listEmergencyContactCandidates();
      if (!cancelled) setCandidates(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const q = query.trim().toLowerCase();
  const available = useMemo(
    () => candidates.filter((row) => row.user_id !== excludeUserId),
    [candidates, excludeUserId]
  );
  const matches = useMemo(() => {
    if (!q) return available;
    return available.filter((row) => {
      const hay = `${row.full_name || ""} ${row.street_label || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [available, q]);

  const persist = async (payload) => {
    const { data, error } = await setMyEmergencyContact({ ...payload, slot: isBackup ? 2 : 1 });
    if (error) {
      if (isRpcNotFoundError(error)) {
        toast.error("Apply the emergency-contact SQL on Supabase first.");
        return null;
      }
      throw error;
    }
    return data;
  };

  const pickNeighbour = async (row) => {
    const nextRelationship = relationship || "neighbour";
    setLinkedUserId(row.user_id);
    setName(row.full_name || "");
    setPhone(row.phone || "");
    setRelationship(nextRelationship);
    setQuery("");
    setBusy(true);
    try {
      const data = await persist({
        contactUserId: row.user_id,
        relationship: nextRelationship,
      });
      if (!data) return;
      toast.success(isBackup ? "Backup contact saved." : "Emergency contact saved.");
      onSaved?.(data);
    } catch (err) {
      toast.error(err.message || "Could not save emergency contact.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const data = await persist({
        contactUserId: linkedUserId || null,
        name,
        phone,
        relationship,
      });
      if (!data) return;
      toast.success(isBackup ? "Backup contact saved." : "Emergency contact saved.");
      onSaved?.(data);
    } catch (err) {
      toast.error(err.message || "Could not save emergency contact.");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const data = await persist({ clear: true });
      if (!data) return;
      setLinkedUserId("");
      setName("");
      setPhone("");
      setRelationship("");
      toast.success(isBackup ? "Backup contact cleared." : "Emergency contact cleared.");
      onSaved?.(data);
    } catch (err) {
      toast.error(err.message || "Could not clear emergency contact.");
    } finally {
      setBusy(false);
    }
  };

  const summary = formatEmergencyContact(name, phone, relationship);
  const currentBox = isBackup
    ? "border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40"
    : "border-teal-200 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/40";
  const currentKicker = isBackup
    ? "text-sky-800 dark:text-sky-300"
    : "text-teal-800 dark:text-teal-300";
  const currentName = isBackup
    ? "text-sky-950 dark:text-sky-50"
    : "text-teal-950 dark:text-teal-50";
  const currentMeta = isBackup
    ? "text-sky-700 dark:text-sky-300"
    : "text-teal-700 dark:text-teal-300";

  return (
    <section
      id={isBackup ? "emergency-contact-backup" : "emergency-contact"}
      className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
    >
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
        {isBackup ? "Backup emergency contact" : "Your emergency contact"}
      </h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        {isBackup
          ? "Optional. Patrol calls this number if the first contact does not answer."
          : "Next of kin for patrol if you send SOS. Optional. Pick a registered neighbour, or type a name and number that is not on the app."}
      </p>

      {summary ? (
        <div className={`mt-3 rounded-lg border px-3 py-2.5 ${currentBox}`}>
          <p className={`text-[11px] font-semibold uppercase tracking-wide ${currentKicker}`}>
            {isBackup ? "Current backup" : "Current next of kin"}
          </p>
          <p className={`mt-0.5 text-sm font-semibold ${currentName}`}>{summary}</p>
          {linkedUserId ? (
            <p className={`mt-0.5 text-xs font-medium ${currentMeta}`}>Registered neighbour</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">None saved yet.</p>
      )}

      <label className="mt-4 block text-sm font-medium dark:text-gray-300">Pick a registered neighbour</label>
      <div className="relative mt-1">
        <FaSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or street"
          className="w-full rounded-lg border border-gray-200 py-2.5 pl-10 pr-3 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
        />
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {q
          ? `${matches.length} match${matches.length === 1 ? "" : "es"}`
          : `${available.length} neighbour${available.length === 1 ? "" : "s"} · scroll or type a name`}
      </p>
      {available.length > 0 || q ? (
        <ul className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">No matching neighbours.</li>
          ) : (
            matches.map((row) => (
              <li key={row.user_id}>
                <button
                  type="button"
                  onClick={() => void pickNeighbour(row)}
                  disabled={busy}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-teal-50 dark:hover:bg-teal-950/40 ${
                    linkedUserId === row.user_id ? "bg-teal-50 dark:bg-teal-950/40" : ""
                  }`}
                >
                  <FaUserFriends className="h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
                  <span className="min-w-0">
                    <span className="block font-medium text-gray-900 dark:text-white">
                      {row.full_name || "Resident"}
                    </span>
                    {row.street_label ? (
                      <span className="block text-xs text-gray-500">{row.street_label}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-300">Name</label>
          <input
            type="text"
            value={name}
            onChange={(event) => {
              setLinkedUserId("");
              setName(event.target.value);
            }}
            placeholder={isBackup ? "Backup contact" : "Next of kin"}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
        </div>
        <div>
          <label
            htmlFor={`emergency-relationship-${slot}`}
            className="block text-sm font-medium mb-1 dark:text-gray-300"
          >
            Relationship
          </label>
          <select
            id={`emergency-relationship-${slot}`}
            value={relationship}
            onChange={(event) => setRelationship(event.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          >
            <option value="">Prefer not to say</option>
            {EMERGENCY_CONTACT_RELATIONSHIPS.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium mb-1 dark:text-gray-300">Phone</label>
          <div className="flex items-center rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-600">
            <FaPhone className="mr-2 h-3.5 w-3.5 shrink-0 text-gray-400" />
            <input
              type="tel"
              value={phone}
              onChange={(event) => {
                setLinkedUserId("");
                setPhone(event.target.value);
              }}
              placeholder="e.g. 082 123 4567"
              className="w-full text-sm focus:outline-none dark:bg-gray-900 dark:text-white"
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || (!name.trim() && !phone.trim() && !linkedUserId)}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
            isBackup ? "bg-sky-600 hover:bg-sky-700" : "bg-teal-600 hover:bg-teal-700"
          }`}
        >
          {busy ? "Saving…" : isBackup ? "Save backup contact" : "Save emergency contact"}
        </button>
        {summary ? (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-gray-600 underline dark:text-gray-300"
          >
            <FaTimes className="h-3 w-3" aria-hidden />
            Remove
          </button>
        ) : null}
      </div>
    </section>
  );
}
