import { resolveSecurityCardColors } from "../../utils/securityCompanyBranding";

function splitName(fullName) {
  const raw = String(fullName || "").trim();
  if (!raw) return { first: "Unknown", last: "" };
  const [first, ...rest] = raw.split(/\s+/);
  return { first, last: rest.join(" ") };
}

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "verified" || s === "approved") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200";
  if (s === "linked" || s === "active" || s === "self_reported") return "bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-200";
  return "bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300";
}

function isMyClient(row) {
  if (row?.is_my_client === true) return true;
  if (row?.is_my_client === false) return false;
  return Boolean(row?.security_company_id);
}

function groupResidents(rows) {
  const mine = [];
  const unlinked = [];
  const others = new Map();
  for (const row of rows) {
    if (isMyClient(row)) {
      mine.push(row);
      continue;
    }
    if (row.security_company_id) {
      const key = row.security_company_id;
      if (!others.has(key)) {
        others.set(key, {
          id: key,
          name: row.security_company_name || "Other company",
          rows: [],
        });
      }
      others.get(key).rows.push(row);
      continue;
    }
    unlinked.push(row);
  }
  return {
    mine,
    unlinked,
    others: [...others.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function ResidentTable({ rows, empty, showCompany }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left font-mono text-[10px] uppercase tracking-wide text-gray-400 dark:border-gray-700">
            <th className="px-4 py-3">Resident</th>
            <th className="px-4 py-3">Area</th>
            {showCompany ? <th className="px-4 py-3">Security company</th> : null}
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Reports</th>
            <th className="px-4 py-3">SOS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.resident_user_id} className="border-b border-gray-50 dark:border-gray-800">
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900 dark:text-white">{row.full_name || "Resident"}</p>
                <p className="text-xs text-gray-400">{row.street_label || "—"}</p>
              </td>
              <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                {row.neighborhood_name || row.suburb_name || "—"}
              </td>
              {showCompany ? (
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                  {row.security_company_name || "None"}
                </td>
              ) : null}
              <td className="px-4 py-3">
                <span className={`rounded-md px-2 py-0.5 font-mono text-[10px] ${statusClass(row.membership_status)}`}>
                  {row.membership_status || "registered"}
                </span>
              </td>
              <td className="px-4 py-3">{row.incident_count || 0}</td>
              <td className="px-4 py-3">{row.sos_count || 0}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={showCompany ? 6 : 5} className="px-4 py-6 text-sm text-gray-500">
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ClientCard({ row }) {
  const colors = resolveSecurityCardColors({
    primary_color_token: row.primary_color_token,
    secondary_color_token: row.secondary_color_token,
    card_style: row.card_style,
  });
  const names = splitName(row.full_name);
  const place = [row.street_label, row.neighborhood_name || row.suburb_name].filter(Boolean).join(" · ");
  const verified = String(row.membership_status || "").toLowerCase() === "verified";
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{
        background: colors.background,
        borderColor: colors.borderColor,
        color: colors.textColor,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold leading-tight">
          {names.first} {names.last}
        </p>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
          style={{
            background: verified ? "#d1fae5" : "rgba(15, 23, 42, 0.08)",
            color: verified ? "#065f46" : colors.textColor,
          }}
        >
          {row.membership_status || "registered"}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] leading-tight opacity-80">
        <p className="min-w-0 truncate">
          {place || "No address on file"}
          {row.household_verified ? " · household verified" : ""}
        </p>
        <p className="shrink-0 font-medium opacity-90">
          {row.incident_count || 0} rpt · {row.sos_count || 0} SOS
        </p>
      </div>
    </div>
  );
}

export default function PartnerResidentRoster({ residents, loading }) {
  const groups = groupResidents(residents);
  const otherCount = groups.others.reduce((sum, group) => sum + group.rows.length, 0);

  if (!loading && residents.length === 0) {
    return (
      <p className="rounded-2xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
        No residents registered in the selected neighborhoods.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-900 dark:bg-teal-950/40">
          <p className="text-2xl font-bold text-teal-900 dark:text-teal-100">{groups.mine.length}</p>
          <p className="text-xs text-teal-800 dark:text-teal-300">Your clients</p>
        </div>
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/40">
          <p className="text-2xl font-bold text-indigo-900 dark:text-indigo-100">{otherCount}</p>
          <p className="text-xs text-indigo-800 dark:text-indigo-300">With another company</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{groups.unlinked.length}</p>
          <p className="text-xs text-gray-500">No security company</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-teal-200 bg-white dark:border-teal-900 dark:bg-gray-800">
        <div className="border-b border-teal-100 px-4 py-3 dark:border-teal-900">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Your clients</h2>
          <p className="text-xs text-gray-500">Households linked to this security company.</p>
        </div>
        {groups.mine.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No residents are linked to your company in these areas.</p>
        ) : (
          <div className="grid max-h-[32rem] gap-2 overflow-y-auto p-3 sm:grid-cols-2 xl:grid-cols-3">
            {groups.mine.map((row) => (
              <ClientCard key={row.resident_user_id} row={row} />
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white dark:border-indigo-900 dark:bg-gray-800">
        <div className="border-b border-indigo-100 px-4 py-3 dark:border-indigo-900">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Other security companies</h2>
          <p className="text-xs text-gray-500">Residents in these neighborhoods who are already with another company.</p>
        </div>
        {groups.others.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No residents in these areas are linked to another company.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 border-b border-indigo-100 px-4 py-2 dark:border-indigo-900">
              {groups.others.map((company) => (
                <span
                  key={company.id}
                  className="rounded-full bg-indigo-50 px-2.5 py-1 font-mono text-[11px] text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                >
                  {company.name} · {company.rows.length}
                </span>
              ))}
            </div>
            <ResidentTable
              rows={groups.others.flatMap((company) => company.rows)}
              showCompany
              empty=""
            />
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">No security company</h2>
          <p className="text-xs text-gray-500">Registered households that have not linked a company yet.</p>
        </div>
        <ResidentTable
          rows={groups.unlinked}
          showCompany
          empty="Every listed resident is already linked to a security company."
        />
      </section>
    </div>
  );
}
