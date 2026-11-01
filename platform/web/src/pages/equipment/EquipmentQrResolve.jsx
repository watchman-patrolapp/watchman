import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { equipmentErrorMessage, equipmentQrTokenFromText, resolveEquipmentQr } from "../../utils/equipment";
import EquipmentShell, { EquipmentNotice } from "./EquipmentShell";

/** /equipment/u/:qrToken: landing page for a scanned label. Resolves the token, then shows the unit. */
export default function EquipmentQrResolve() {
  const { qrToken } = useParams();
  const [unitId, setUnitId] = useState(null);
  const [hint, setHint] = useState("");

  useEffect(() => {
    let alive = true;
    const token = equipmentQrTokenFromText(qrToken);
    if (!token) {
      setHint("That equipment was not found.");
      return undefined;
    }
    resolveEquipmentQr(token).then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) setHint(equipmentErrorMessage(error || { message: "not found" }));
      else setUnitId(data);
    });
    return () => {
      alive = false;
    };
  }, [qrToken]);

  if (unitId) return <Navigate to={`/equipment/units/${unitId}`} replace />;
  return (
    <EquipmentShell title="Equipment" subtitle="Looking up this label" backTo="/equipment" backLabel="Back to equipment">
      {hint ? <EquipmentNotice>{hint}</EquipmentNotice> : <p className="text-sm text-gray-500 dark:text-gray-400">Looking up...</p>}
    </EquipmentShell>
  );
}
