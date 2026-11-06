import EquipmentAdminNav from "../../../components/equipment/EquipmentAdminNav";
import EquipmentMaintenanceLog from "../../../components/equipment/EquipmentMaintenanceLog";
import EquipmentShell from "../EquipmentShell";

/** /equipment/admin/maintenance — repairs and servicing for this neighbourhood. */
export default function EquipmentAdminMaintenance() {
  return (
    <EquipmentShell wide title="Service log" subtitle="Repairs and servicing for each unit." backTo="/admin" backLabel="Back to Admin Dashboard">
      <EquipmentAdminNav />
      <EquipmentMaintenanceLog canManage />
    </EquipmentShell>
  );
}
