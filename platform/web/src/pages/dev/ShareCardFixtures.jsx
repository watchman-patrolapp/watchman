import { useState } from "react";
import PatrolShareCard from "../../components/patrol/share/PatrolShareCard";
import PatrolShareSheet from "../../components/patrol/share/PatrolShareSheet";
import { buildShareCardModel, buildShareCaption } from "../../utils/patrolFormat";

// Dev-only fixtures (route registered only when import.meta.env.DEV).
const base = {
  user_name: "Thabo Mokoena",
  zone: "Fixture Zone",
  vehicle_type: "car",
  vehicle_make_model: "Toyota Hilux 2.8 GD-6",
  vehicle_reg: "KMD 113 EC",
  share_ref: "PT-7KQ3",
};
const DAY_ON = "2026-10-31T08:15:00+02:00";
const DAY_OFF = "2026-10-31T11:47:00+02:00";
const NIGHT_ON = "2026-10-31T20:31:00+02:00";
const NIGHT_OFF = "2026-10-31T23:03:00+02:00";

const FIXTURES = [
  { label: "Long area · sign-off · dark", kind: "end", patrol: { ...base, zone: "Theescombe Neighbourhood Watch", user_name: "Khurshid", vehicle_make_model: "Suzuki Baleno", vehicle_reg: "KKG 643 EC", start_time: NIGHT_ON, end_time: NIGHT_OFF } },
  { label: "Long area · sign-on · light", kind: "start", patrol: { ...base, zone: "Theescombe Neighbourhood Watch", start_time: DAY_ON } },
  { label: "Area 'Theescombe'", kind: "end", patrol: { ...base, zone: "Theescombe", start_time: DAY_ON, end_time: DAY_OFF } },
  { label: "Sign-on · light", kind: "start", patrol: { ...base, start_time: DAY_ON } },
  { label: "Sign-on · dark", kind: "start", patrol: { ...base, start_time: NIGHT_ON } },
  { label: "Sign-off · light", kind: "end", patrol: { ...base, start_time: DAY_ON, end_time: DAY_OFF } },
  { label: "Sign-off · dark", kind: "end", patrol: { ...base, start_time: NIGHT_ON, end_time: NIGHT_OFF } },
  { label: "No vehicle", kind: "start", patrol: { ...base, vehicle_type: null, vehicle_make_model: null, vehicle_reg: null, start_time: DAY_ON } },
  { label: "Plate only", kind: "end", patrol: { ...base, vehicle_type: null, vehicle_make_model: null, start_time: NIGHT_ON, end_time: NIGHT_OFF } },
  { label: "Type only (bicycle)", kind: "start", patrol: { ...base, vehicle_type: "bicycle", vehicle_make_model: null, vehicle_reg: null, start_time: NIGHT_ON } },
  {
    label: "Long name + long vehicle",
    kind: "end",
    patrol: {
      ...base,
      user_name: "Nomvula Thandiwe Elizabeth van der Westhuizen-Dlamini",
      vehicle_make_model: "Volkswagen Amarok 3.0 TDI V6 Highline Double Cab 4Motion",
      start_time: DAY_ON,
      end_time: DAY_OFF,
    },
  },
];

export default function ShareCardFixtures() {
  const [open, setOpen] = useState(null);
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Share card fixtures</h1>
      <div className="flex flex-wrap gap-6">
        {FIXTURES.map((f) => {
          const model = buildShareCardModel({ kind: f.kind, patrol: f.patrol, organizationName: "Fixture Org" });
          return (
            <div key={f.label} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{f.label}</p>
                <button type="button" className="text-xs text-emerald-700 dark:text-emerald-400 underline" onClick={() => setOpen(f)}>
                  Open sheet
                </button>
              </div>
              <PatrolShareCard model={model} />
              <pre className="text-[11px] w-[400px] whitespace-pre-wrap text-gray-600 dark:text-gray-400">
                {buildShareCaption({ kind: f.kind, patrol: f.patrol, organizationName: "Fixture Org", options: { vehicle: true, phone: true, location: true }, phone: "0821234567", location: { lat: -33.0153, lng: 27.9116 } })}
              </pre>
            </div>
          );
        })}
      </div>
      {open ? (
        <PatrolShareSheet
          kind={open.kind}
          patrol={{ ...open.patrol, share_ref: null }}
          organizationName="Fixture Org"
          phone="0821234567"
          location={{ lat: -33.0153, lng: 27.9116 }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
