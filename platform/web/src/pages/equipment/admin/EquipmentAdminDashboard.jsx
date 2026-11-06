import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../../../components/ui/Button";
import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import EquipmentAdminNav from "../../../components/equipment/EquipmentAdminNav";
import EquipmentLedgerExport from "../../../components/equipment/EquipmentLedgerExport";
import EquipmentStatusChart from "../../../components/equipment/EquipmentStatusChart";
import { equipmentErrorMessage } from "../../../utils/equipment";
import { getEquipmentDashboard, listEquipmentPaperClaims, recordPaperHandover } from "../../../utils/equipmentReporting";
import { useScopedOrganization } from "../../../utils/organizationScope";
import EquipmentShell, { InfoSection } from "../EquipmentShell";

function when(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** /equipment/admin — units, loans, issues, write-offs, service due, and the ledger export. */
export default function EquipmentAdminDashboard() {
  const { activeOrganizationId } = useScopedOrganization();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dash, setDash] = useState(null);
  const [claims, setClaims] = useState([]);
  const [hint, setHint] = useState("");
  const [flash, setFlash] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const [board, paper] = await Promise.all([
      getEquipmentDashboard(from || null, to || null),
      listEquipmentPaperClaims(),
    ]);
    setLoading(false);
    if (board.error) {
      setDash(null);
      setHint(equipmentErrorMessage(board.error, "The equipment overview is not switched on yet. Ask an admin to apply the latest equipment SQL."));
      return;
    }
    setDash(board.data);
    setClaims(paper.error ? [] : paper.data || []);
    setHint("");
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const record = async (id) => {
    setBusy(id);
    const { error } = await recordPaperHandover(id);
    setBusy("");
    if (error) return setFlash(equipmentErrorMessage(error));
    setFlash("Paper hand-over recorded. The ledger says it was recorded later. No charge was created.");
    void load();
  };

  return (
    <EquipmentShell wide title="Equipment overview" subtitle="Who has what, what is overdue, and the ledger for this neighbourhood." backTo="/admin" backLabel="Back to Admin Dashboard">
      <EquipmentAdminNav />
      {hint ? <ErrorState title="Overview unavailable" message={hint} onRetry={load} /> : null}
      {flash ? <p className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-100" role="status">{flash}</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-text-secondary">From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-lg border border-strong bg-surface-input px-3 py-2 text-text-primary" />
        </label>
        <label className="text-sm text-text-secondary">To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-lg border border-strong bg-surface-input px-3 py-2 text-text-primary" />
        </label>
        <Button variant="secondary" onClick={load}>Update</Button>
        <Link to="/equipment/admin/stocktake" className="btn-primary inline-flex min-h-11 items-center px-4">Stocktake</Link>
      </div>
      {loading ? <p className="text-sm text-text-secondary">Loading...</p> : null}
      {dash ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="On loan" value={dash.on_loan} />
            <Tile label="Overdue" value={dash.overdue_count} />
            <Tile label="Open issues" value={dash.open_issues} />
            <Tile label="Write-offs pending" value={dash.write_offs_pending} />
            <Tile label="Service due" value={dash.maintenance_due} />
            <Tile label="Loss rate" value={`${dash.loss_rate_percent ?? 0}%`} />
          </div>
          <InfoSection title="Units by status">
            <EquipmentStatusChart unitsByStatus={dash.units_by_status} />
          </InfoSection>
          <div className="grid gap-4 lg:grid-cols-2">
            <UnitList title="On loan now" rows={dash.holders} empty="Nothing is out." />
            <UnitList title="Overdue" rows={dash.overdue} empty="Nothing is overdue." />
            <SimpleList title="Open issues" empty="No open issues." rows={(dash.issues || []).map((row) => ({
              id: row.id, href: `/equipment/units/${row.unit_id}`, title: `${row.asset_tag} · ${row.item_name}`, meta: `${row.kind} · ${row.reporter_name || "Member"} · ${when(row.created_at)}`,
            }))} />
            <SimpleList title="Write-offs waiting" empty="No write-off is waiting for a second admin." rows={(dash.write_offs || []).map((row) => ({
              id: row.id, href: `/equipment/units/${row.unit_id}`, title: `${row.asset_tag} · ${row.item_name}`, meta: when(row.proposed_at),
            }))} />
            <SimpleList title="Service due within 7 days" empty="Nothing is due for service." rows={(dash.maintenance || []).map((row) => ({
              id: row.unit_id, href: `/equipment/units/${row.unit_id}`, title: `${row.asset_tag} · ${row.item_name}`, meta: `${row.kind} · due ${row.next_due}`,
            }))} />
            <InfoSection title="Use over the period">
              {(dash.utilisation || []).length === 0 ? <EmptyState title="No items to measure" /> : (
                <ul className="space-y-1 text-sm text-text-primary">
                  {dash.utilisation.map((row) => <li key={row.item_id} className="flex justify-between gap-2"><span>{row.item_name}</span><span>{row.percent}%</span></li>)}
                </ul>
              )}
            </InfoSection>
          </div>
          <InfoSection title="Paper hand-overs to confirm">
            {claims.length === 0 ? <p className="text-sm text-text-secondary">None waiting. These are recorded later, when phones were offline.</p> : (
              <ul className="space-y-2">
                {claims.map((claim) => (
                  <li key={claim.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{claim.asset_tag} · {claim.from_name} to {claim.to_name} · {when(claim.occurred_at)}</span>
                    <Button loading={busy === claim.id} onClick={() => record(claim.id)}>Record it</Button>
                  </li>
                ))}
              </ul>
            )}
          </InfoSection>
          <InfoSection title="Ledger export">
            <p className="mb-2 text-sm text-text-secondary">CSV, spreadsheet, and PDF of this neighbourhood's ledger for the dates above. Leave the dates blank for the last year.</p>
            <EquipmentLedgerExport orgId={activeOrganizationId} from={from || null} to={to || null} />
          </InfoSection>
        </>
      ) : null}
    </EquipmentShell>
  );
}

function Tile({ label, value }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text-primary">{value ?? "–"}</p>
    </div>
  );
}

function UnitList({ title, rows, empty }) {
  return (
    <SimpleList title={title} empty={empty} rows={(rows || []).map((row) => ({
      id: row.unit_id, href: `/equipment/units/${row.unit_id}`,
      title: `${row.asset_tag} · ${row.item_name}`,
      meta: [row.holder_name, row.status?.replaceAll("_", " "), row.due_at ? `due ${when(row.due_at)}` : ""].filter(Boolean).join(" · "),
    }))} />
  );
}

function SimpleList({ title, rows, empty }) {
  return (
    <InfoSection title={title}>
      {rows.length === 0 ? <p className="text-sm text-text-secondary">{empty}</p> : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Link to={row.href} className="block text-sm font-medium text-text-link">{row.title}</Link>
              {row.meta ? <p className="text-xs text-text-secondary">{row.meta}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </InfoSection>
  );
}
