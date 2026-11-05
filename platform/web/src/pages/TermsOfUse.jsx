import { Link } from "react-router-dom";
import AuthShell from "../components/layout/AuthShell";

export default function TermsOfUse() {
  return (
    <AuthShell>
      <article className="card w-full max-w-2xl space-y-4 p-6 sm:p-8">
        <h2 className="text-2xl font-bold text-text-primary">Terms</h2>
        <p className="rounded-xl bg-warning-light px-3 py-2 text-sm text-warning-foreground" role="note">
          Draft for legal review. Creating an account records the consent version already stored with your profile.
        </p>
        <p className="text-sm leading-relaxed text-text-secondary">
          Using Watchman means you are 18 or older, you follow the community conduct rules for your neighbourhood, and you accept the platform terms shown when you register. Patrollers and security partners also accept the operating rules for their role.
        </p>
        <p className="text-sm leading-relaxed text-text-secondary">
          Incident reports and SOS alerts are for neighbourhood safety. Do not post information you are not allowed to share.
        </p>
        <p className="text-sm">
          <Link to="/privacy" className="font-medium text-text-link underline">Privacy policy</Link>
          <span aria-hidden="true"> · </span>
          <Link to="/register" className="font-medium text-text-link underline">Create an account</Link>
        </p>
      </article>
    </AuthShell>
  );
}
