import PageHeader from "../components/layout/PageHeader";
import { ROLE_MATRIX } from "../auth/roleMatrix";

const CAPABILITY_LABELS = [
  { key: "adminPanel", label: "Admin panel" },
  { key: "patrolSchedule", label: "Patrol schedule" },
  { key: "patrolStartStop", label: "Start/End patrol" },
  { key: "intelligenceView", label: "Intelligence view" },
  { key: "intelligenceModerate", label: "Intelligence moderation" },
  { key: "hotspotManage", label: "Hotspot edit" },
  { key: "incidentReport", label: "Report incidents" },
  { key: "incidentModerate", label: "Incident moderation/edit" },
  { key: "feedbackReview", label: "Feedback review" },
];

const PLATFORM_ROLE_EXPLANATION = [
  {
    role: "platform_owner",
    description: "Global business owner role. Can govern billing, organization allocations, pilot readiness, and platform role assignment.",
  },
  {
    role: "platform_ops",
    description: "Trusted IT/operations role. Can manage platform console functions except owner-only actions.",
  },
  {
    role: "platform_support",
    description: "Platform support staff role. Can access platform console tooling required for operational support.",
  },
  {
    role: "none",
    description: "Default state for normal neighborhood users and admins without global platform scope.",
  },
];

export default function RoleAccessGuide() {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <PageHeader
          title="Role Access Guide"
          subtitle="Read-only role matrix for neighborhood operations and platform governance."
          backTo="/admin"
          backLabel="Back to admin"
        />

        <section className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Global vs neighborhood roles</h2>
          <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
            <p>
              <span className="font-medium">Main admin</span> and{" "}
              <span className="font-medium">technical support</span> are global. They are not members of a
              neighborhood and do not count toward that area&apos;s user fee.
            </p>
            <p>
              <span className="font-medium">NW admin</span> is local. Each organization assigns its own
              neighborhood admin.
            </p>
            <p>
              Public self-signup is limited to <span className="font-medium">resident</span>,{" "}
              <span className="font-medium">patroller</span>,{" "}
              <span className="font-medium">security company</span>, and{" "}
              <span className="font-medium">neighborhood watch admin</span>. Investigator, committee,
              city admin, main admin, and technical support remain invite-only.
            </p>
            <p>
              Registered <span className="font-medium">residents</span> are a separate household group
              under Admin → Residents. User Management and Member profiles list watch and operational
              accounts only.
            </p>
            <p>
              A resident stays <span className="font-medium">Pending</span> until an admin, NW admin, or
              patroller verifies them, or two already-verified neighbours vouch. The{" "}
              <span className="font-medium">Verified</span> badge then appears.
            </p>
            <p>
              Local watch members (patroller, volunteer, investigator, committee, NW admin) keep one
              account. Login still opens the patrol dashboard. <span className="font-medium">Resident Portal</span>{" "}
              opens the resident screens using the same name, email, phone, and address. They only need
              to set a home pin and, if they want, their armed-response company. They are not demoted
              to resident.
            </p>
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">App role matrix</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b dark:border-gray-700">
                  <th className="py-2 pr-4">Role</th>
                  {CAPABILITY_LABELS.map((capability) => (
                    <th key={capability.key} className="py-2 pr-4 whitespace-nowrap">
                      {capability.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(ROLE_MATRIX).map(([role, permissions]) => (
                  <tr key={role} className="border-b dark:border-gray-700/60">
                    <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">{role}</td>
                    {CAPABILITY_LABELS.map((capability) => (
                      <td key={capability.key} className="py-2 pr-4">
                        {permissions[capability.key] ? "Yes" : "No"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Platform role meanings</h2>
          <div className="space-y-2">
            {PLATFORM_ROLE_EXPLANATION.map((item) => (
              <div key={item.role} className="rounded-lg border dark:border-gray-700 p-3">
                <p className="font-medium text-gray-900 dark:text-white">{item.role}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{item.description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
