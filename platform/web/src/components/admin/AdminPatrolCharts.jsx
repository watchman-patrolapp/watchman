import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from "recharts";

const tooltipStyle = {
  backgroundColor: "#ffffff",
  color: "#111827",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  fontSize: 12,
};

export function AdminVolunteerHoursChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.5} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} unit="h" />
        <Tooltip
          formatter={(val, key) => [key === "hours" ? `${val} h` : val, key === "hours" ? "Hours" : "Patrols"]}
          labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
          contentStyle={tooltipStyle}
          labelStyle={{ color: "#111827", fontWeight: 600 }}
          itemStyle={{ color: "#0f766e" }}
        />
        <Bar dataKey="hours" fill="#0d9488" radius={[4, 4, 0, 0]} name="hours" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AdminLast7Chart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.5} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} />
        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#111827", fontWeight: 600 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="patrols" stroke="#0d9488" strokeWidth={2} dot={{ r: 3 }} name="Patrols" />
        <Line type="monotone" dataKey="hours" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="Hours" />
      </LineChart>
    </ResponsiveContainer>
  );
}
