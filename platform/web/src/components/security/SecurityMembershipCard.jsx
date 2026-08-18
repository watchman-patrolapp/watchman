import { resolveSecurityCardColors } from "../../utils/securityCompanyBranding";

function statusLabel(status) {
  if (status === "verified") return "Verified client";
  if (status === "rejected") return "Rejected";
  if (status === "expired") return "Expired";
  if (status === "withdrawn") return "Withdrawn";
  if (status === "transferred") return "Transferred";
  return "Pending company verification";
}

export default function SecurityMembershipCard({ membership }) {
  if (!membership) return null;

  const branding = membership.security_company_branding || {};
  const colors = resolveSecurityCardColors(branding);
  const companyName = membership.organizations?.name || "Security company";

  return (
    <div
      className="rounded-xl border p-4 shadow-sm"
      style={{
        background: colors.background,
        borderColor: colors.borderColor,
        color: colors.textColor,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide opacity-80">Security membership</p>
          <h3 className="text-lg font-semibold">{companyName}</h3>
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={{
            background: colors.accent,
            color: membership.membership_status === "verified" ? "#052e16" : colors.textColor,
          }}
        >
          {statusLabel(membership.membership_status)}
        </span>
      </div>

      <div className="mt-3 text-sm space-y-1">
        <p>
          Member ref:{" "}
          <span className="font-medium">{membership.member_reference || "Not provided"}</span>
        </p>
        <p>
          Last updated:{" "}
          <span className="font-medium">
            {membership.updated_at ? new Date(membership.updated_at).toLocaleDateString() : "Unknown"}
          </span>
        </p>
      </div>
    </div>
  );
}
