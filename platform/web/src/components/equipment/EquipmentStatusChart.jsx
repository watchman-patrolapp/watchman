import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { horizontalGridCoordinates, verticalGridCoordinates } from "../charts/gridCoordinates";
import { unitsByStatusChart } from "../../utils/equipmentReportingMeta";

const INITIAL = { width: 640, height: 220 };

/** Units by status for the equipment overview. */
export default function EquipmentStatusChart({ unitsByStatus }) {
  const data = unitsByStatusChart(unitsByStatus);
  if (!data.length) return <p className="text-sm text-text-secondary">No units yet.</p>;
  return (
    <div className="h-56 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220} initialDimension={INITIAL}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#e5e7eb"
            horizontalCoordinatesGenerator={horizontalGridCoordinates}
            verticalCoordinatesGenerator={verticalGridCoordinates}
          />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
          <Tooltip contentStyle={{ borderRadius: 8 }} />
          <Bar dataKey="count" name="Units" fill="#0d9488" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
