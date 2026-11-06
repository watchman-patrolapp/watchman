import { Link } from "react-router-dom";
import AuthShell from "../components/layout/AuthShell";

export default function PrivacyPolicy() {
  const email = (import.meta.env.VITE_PRIVACY_CONTACT_EMAIL || "").trim();
  return (
    <AuthShell>
      <article className="card w-full max-w-2xl space-y-4 p-6 sm:p-8">
        <h2 className="text-2xl font-bold text-text-primary">Privacy policy</h2>
        <p className="rounded-xl bg-warning-light px-3 py-2 text-sm text-warning-foreground" role="note">
          Draft for legal review. Registration details and contact placeholders are not filled in on this page.
        </p>
        <p className="text-sm leading-relaxed text-text-secondary">
          Watchman processes account, patrol, incident, and chat information so a neighbourhood watch can coordinate safety under South Africa’s Protection of Personal Information Act (POPIA). Passwords are stored by the authentication provider. The full draft policy lives with the product documents and still needs an appointed information officer before it is final.
        </p>
        <p className="text-sm leading-relaxed text-text-secondary">
          Location is tracked only while you are signed on to a patrol. On the Android app that includes background location, so the route keeps recording when the screen is off or you switch apps, for as long as the patrol notification is showing. Signing off, or the patrol ending on its own, stops tracking. The browser app records location only while the page is open during a signed-on patrol. Watchman does not track location when you are signed off.
        </p>
        <p className="text-sm leading-relaxed text-text-secondary">
          After you sign in, Profile is where you ask for access, correction, or deletion of your account.
        </p>
        {email ? (
          <p className="text-sm text-text-secondary">
            Privacy contact:{" "}
            <a className="font-medium text-text-link underline" href={`mailto:${email}`}>
              {email}
            </a>
          </p>
        ) : (
          <p className="text-sm text-text-secondary">A privacy contact email has not been published yet.</p>
        )}
        <p className="text-sm">
          <Link to="/terms" className="font-medium text-text-link underline">Terms</Link>
          <span aria-hidden="true"> · </span>
          <Link to="/login" className="font-medium text-text-link underline">Sign in</Link>
        </p>
      </article>
    </AuthShell>
  );
}
