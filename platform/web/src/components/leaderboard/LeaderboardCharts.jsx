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
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import { FaClock } from "react-icons/fa";
import { TIME_RANGES } from "../../utils/volunteerStats";

const CHART_INITIAL = { width: 800, height: 256 };
const CHART_INITIAL_SHORT = { width: 800, height: 224 };

function chartAxisName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "Volunteer";
  return raw.split(/\s+/)[0];
}

function formatHoursMinutes(totalMinutes) {
  const mins = Math.max(0, Math.round(totalMinutes || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function minutesToChartHours(totalMinutes) {
  return Math.round((Math.max(0, Number(totalMinutes) || 0) / 60) * 10) / 10;
}

export function TopVolunteersBarChart({ leaderboard }) {
  return (
    <div className="h-64 w-full min-w-0 min-h-[16rem]">
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={256}
        initialDimension={CHART_INITIAL_SHORT}
      >
        <BarChart
          data={(leaderboard || []).slice(0, 10).map((entry) => ({
            ...entry,
            hours: minutesToChartHours(entry.totalMinutes),
          }))}
          margin={{ top: 8, right: 20, left: 12, bottom: 56 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="name"
            type="category"
            tick={{ fontSize: 11 }}
            interval={0}
            minTickGap={0}
            angle={-40}
            textAnchor="end"
            height={80}
            tickMargin={8}
            tickFormatter={chartAxisName}
          />
          <YAxis tick={{ fontSize: 11 }} unit="h" />
          <Tooltip
            formatter={(val, _name, item) => [
              formatHoursMinutes(item?.payload?.totalMinutes ?? val * 60),
              "Hours",
            ]}
            contentStyle={{ borderRadius: 8 }}
          />
          <Bar dataKey="hours" fill="#0d9488" radius={[4, 4, 0, 0]} name="Hours" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeeklyTrendChart({ weeklyTrend }) {
  return (
    <div className="h-64 w-full min-w-0 min-h-[16rem]">
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={200}
        initialDimension={CHART_INITIAL}
      >
        <LineChart data={weeklyTrend || []}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="week" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} unit="h" />
          <Tooltip contentStyle={{ borderRadius: 8 }} formatter={(val) => [`${val}h`, "Hours"]} />
          <Line
            type="monotone"
            dataKey="hours"
            stroke="#10b981"
            strokeWidth={3}
            dot={{ fill: "#10b981", r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RadarPeriodTick({ x, y, payload, textAnchor }) {
  const lines = String(payload?.value || "").split(/\s+/).filter(Boolean);
  return (
    <text x={x} y={y} textAnchor={textAnchor || "middle"} fill="#6b7280" fontSize={11}>
      {lines.map((line, i) => (
        <tspan
          key={`${line}-${i}`}
          x={x}
          dy={i === 0 ? (lines.length > 1 ? "-0.45em" : "0.35em") : "1.15em"}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

export function FavoriteTimeRadar({ timeDistribution }) {
  const distribution = timeDistribution || {};
  const data = Object.entries(distribution).map(([period, count]) => ({
    period: TIME_RANGES[period]?.label || period,
    count: count || 0,
    fullMark: Math.max(...Object.values(distribution), 1),
  }));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 min-w-0">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <FaClock className="text-violet-500" />
        Patrol Preferences
      </h3>
      <div className="h-72 w-full min-w-0 min-h-[18rem] overflow-visible">
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          minHeight={200}
          initialDimension={CHART_INITIAL}
        >
          <RadarChart
            data={data}
            cx="50%"
            cy="50%"
            outerRadius="45%"
            margin={{ top: 24, right: 36, bottom: 24, left: 36 }}
          >
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis dataKey="period" tickLine={false} tick={(props) => <RadarPeriodTick {...props} />} />
            <PolarRadiusAxis angle={90} domain={[0, "auto"]} tick={false} />
            <Radar name="Your Patrols" dataKey="count" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.3} />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
              formatter={(val) => [val, "Patrols"]}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
