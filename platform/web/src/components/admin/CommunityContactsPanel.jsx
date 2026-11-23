import { useEffect, useMemo, useState } from "react";
import { FaAddressBook, FaPhone } from "react-icons/fa";
import { listCommunityAdminContacts } from "../../utils/communityContacts";
import { contactRoleLabel, filterContacts, groupContacts } from "../../utils/communityContactsView";

/**
 * Admin contact for every neighbourhood watch and security company.
 * Platform staff, global admins and technical support only (the list is empty for anyone else).
 * Replaces the contact list on the retired /city-admin dashboard.
 */
export default function CommunityContactsPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    listCommunityAdminContacts()
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setMessage("");
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setMessage(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const groups = useMemo(() => groupContacts(filterContacts(rows, query)), [rows, query]);

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <span>
          <span className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <FaAddressBook className="text-teal-600" /> Community admin contacts
          </span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            Who to call for each watch and security company.
          </span>
        </span>
        <span className="text-sm text-teal-700 dark:text-teal-300">{open ? "Hide" : "Show"}</span>
      </button>

      {open ? (
        <div className="mt-4 space-y-4">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by organisation, name, email or phone"
            className="input border w-full"
          />
          {loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading contacts…</p>
          ) : message ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">{message}</p>
          ) : (
            groups.map((group) => (
              <div key={group.type}>
                <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {group.label} ({group.rows.length})
                </h3>
                {group.rows.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">None listed.</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {group.rows.map((row) => (
                      <article key={row.organization_id} className="rounded-lg border p-3 dark:border-gray-700">
                        <p className="font-medium text-gray-900 dark:text-white">{row.organization_name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {row.status} · {row.member_count || 0} active members
                        </p>
                        <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                          <p className="font-medium">{row.admin_name || "No admin listed"}</p>
                          {row.admin_role ? (
                            <p className="text-xs text-gray-500">{contactRoleLabel(row.admin_role)}</p>
                          ) : null}
                          {row.admin_email ? (
                            <a className="block text-teal-700 dark:text-teal-300" href={`mailto:${row.admin_email}`}>
                              {row.admin_email}
                            </a>
                          ) : null}
                          {row.admin_phone ? (
                            <a
                              className="mt-1 inline-flex items-center gap-1 text-teal-700 dark:text-teal-300"
                              href={`tel:${row.admin_phone}`}
                            >
                              <FaPhone className="h-3 w-3" /> {row.admin_phone}
                            </a>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
