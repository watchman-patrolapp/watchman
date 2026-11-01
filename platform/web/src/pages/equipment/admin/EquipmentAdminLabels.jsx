import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { FaPrint } from "react-icons/fa";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { useScopedOrganization } from "../../../utils/organizationScope";
import { displayWatchAreaName } from "../../../config/neighborhoodRegions";
import {
  canManageEquipment,
  equipmentErrorMessage,
  equipmentQrUrl,
  listEquipmentUnitsAdmin,
  paginateLabels,
} from "../../../utils/equipment";
import EquipmentShell, { EquipmentNotice } from "../EquipmentShell";
import EquipmentAdminNav from "../../../components/equipment/EquipmentAdminNav";

const PRINT_CSS = `
@page { size: A4 portrait; margin: 10mm; }
@media print {
  body * { visibility: hidden !important; }
  #equipment-labels, #equipment-labels * { visibility: visible !important; }
  #equipment-labels { position: absolute; left: 0; top: 0; width: 190mm; }
  .label-sheet { page-break-after: always; break-after: page; box-shadow: none !important; border: 0 !important; margin: 0 !important; padding: 0 !important; }
  .label-sheet:last-child { page-break-after: auto; break-after: auto; }
}
`;

/** /equipment/admin/labels: A4 sheets of QR labels (3 x 8). ?item=<id> limits to one item. */
export default function EquipmentAdminLabels() {
  const { user } = useAuth();
  const { activeOrganization } = useScopedOrganization();
  const [searchParams] = useSearchParams();
  const itemId = searchParams.get("item");
  const allowed = canManageEquipment(user?.role, user?.platformRole);
  const [units, setUnits] = useState([]);
  const [qr, setQr] = useState({});
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    if (!allowed) return undefined;
    let alive = true;
    setLoading(true);
    listEquipmentUnitsAdmin(itemId || null).then(async ({ data, error }) => {
      if (!alive) return;
      if (error) {
        setHint(equipmentErrorMessage(error));
        setLoading(false);
        return;
      }
      const rows = data.filter((u) => u.status !== "retired" && u.qr_token);
      setUnits(rows);
      setSelected(new Set(rows.map((u) => u.id)));
      const origin = window.location.origin;
      const entries = await Promise.all(
        rows.map(async (u) => [u.id, await QRCode.toDataURL(equipmentQrUrl(origin, u.qr_token), { margin: 1, width: 240, errorCorrectionLevel: "M" })]),
      );
      if (!alive) return;
      setQr(Object.fromEntries(entries));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [itemId, allowed]);

  const printable = useMemo(() => units.filter((u) => selected.has(u.id)), [units, selected]);
  const pages = useMemo(() => paginateLabels(printable, 24), [printable]);
  const areaName = activeOrganization?.name ? displayWatchAreaName(activeOrganization.name) : "Neighbourhood Watch";

  const toggle = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!allowed) {
    return (
      <EquipmentShell title="QR labels" backTo="/equipment" backLabel="Back to equipment">
        <EquipmentNotice>Only your NW admin can print equipment labels.</EquipmentNotice>
      </EquipmentShell>
    );
  }

  return (
    <EquipmentShell
      wide
      title="QR labels"
      subtitle="Print on A4 (3 x 8 labels). Scanning a label opens the unit in the app."
      backTo="/equipment/admin/items"
      backLabel="Back to manage equipment"
      rightSlot={
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!printable.length || loading}
          className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
        >
          <FaPrint aria-hidden /> Print
        </button>
      }
    >
      <style>{PRINT_CSS}</style>
      <EquipmentAdminNav />
      {hint ? <EquipmentNotice>{hint}</EquipmentNotice> : null}
      {loading && !hint ? <p className="text-sm text-gray-500 dark:text-gray-400">Making QR codes...</p> : null}
      {!loading && !units.length && !hint ? <EquipmentNotice>No units to label yet. Add units first.</EquipmentNotice> : null}
      {units.length ? (
        <details className="rounded-2xl border border-gray-200 bg-white p-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <summary className="cursor-pointer font-medium text-gray-800 dark:text-gray-100">
            Choose labels ({printable.length} of {units.length})
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400" onClick={() => setSelected(new Set(units.map((u) => u.id)))}>
              All
            </button>
            <button type="button" className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400" onClick={() => setSelected(new Set())}>
              None
            </button>
          </div>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            {units.map((u) => (
              <li key={u.id}>
                <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                  <span className="font-mono">{u.asset_tag}</span> <span className="truncate text-gray-500 dark:text-gray-400">{u.item_name}</span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div id="equipment-labels" className="space-y-4 overflow-x-auto">
        {pages.map((page, pi) => (
          <div key={pi} className="label-sheet mx-auto w-[190mm] min-w-[190mm] rounded-lg bg-white p-[2mm] text-black shadow">
            <div className="grid grid-cols-3 gap-[2mm]">
              {page.map((u) => (
                <div key={u.id} className="flex h-[33mm] items-center gap-[2mm] overflow-hidden rounded border border-dashed border-gray-400 p-[1.5mm]">
                  {qr[u.id] ? <img src={qr[u.id]} alt={`QR for ${u.asset_tag}`} className="h-[29mm] w-[29mm] shrink-0" /> : null}
                  <div className="min-w-0 leading-tight">
                    <p className="font-mono text-[11pt] font-bold">{u.asset_tag}</p>
                    <p className="line-clamp-2 text-[8pt]">{u.item_name}</p>
                    <p className="mt-[1mm] line-clamp-2 text-[6.5pt] text-gray-600">{areaName}</p>
                    <p className="text-[6pt] text-gray-500">Scan to view</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </EquipmentShell>
  );
}
