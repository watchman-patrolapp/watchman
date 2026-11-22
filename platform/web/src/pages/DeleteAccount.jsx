import { Link } from "react-router-dom";
import AuthShell from "../components/layout/AuthShell";
import { getPrivacyContactEmail, privacyMailto } from "../utils/privacyContact";

const linkClass = "font-medium text-text-link underline";
const bodyClass = "text-sm leading-relaxed text-text-secondary";
const headingClass = "text-lg font-semibold text-text-primary";

export default function DeleteAccount() {
  const email = getPrivacyContactEmail();
  const requestMailto = privacyMailto({
    subject: "Delete my Watchman account",
    body: "Please delete my Watchman: Neighbourhood Watch account.\n\nRegistered email:\nName:\n",
  });

  return (
    <AuthShell wide alignTop>
      <article className="card w-full max-w-2xl space-y-4 p-6 sm:p-8">
        <header className="space-y-1">
          <h2 className="text-2xl font-bold text-text-primary">Delete your account</h2>
          <p className="text-sm font-medium text-text-primary">Watchman: Neighbourhood Watch</p>
          <p className={bodyClass}>
            Operated by Khurshid Dustmurodov, trading as Africuz, Gqeberha, South Africa.
          </p>
        </header>

        <p className={bodyClass}>
          You can delete your Watchman account in the app, or by email if you cannot sign in. This
          page explains both routes, what is removed, and what may be kept. It does not delete the
          account by itself.
        </p>

        <section className="space-y-3">
          <h3 className={headingClass}>Delete in the app</h3>
          <p className={bodyClass}>
            If you can sign in with an email and password, use Watchman on the website or in the
            Android app:
          </p>
          <ol className={`${bodyClass} list-decimal space-y-1 pl-5`}>
            <li>Open Watchman and sign in.</li>
            <li>
              Go to <strong className="font-semibold text-text-primary">Profile</strong>.
            </li>
            <li>
              Open <strong className="font-semibold text-text-primary">Delete account</strong>.
            </li>
            <li>Re-enter your password.</li>
            <li>Confirm that you understand the deletion is permanent.</li>
          </ol>
          <p className={bodyClass}>
            The app then runs our account-deletion process. The change cannot be undone.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className={headingClass}>Delete by email</h3>
          <p className={bodyClass}>
            If you cannot sign in, email us from the address registered on your account so we can
            verify it is you:
          </p>
          <ul className={`${bodyClass} list-disc space-y-1 pl-5`}>
            <li>
              Address:{" "}
              <a className={linkClass} href={requestMailto}>
                {email}
              </a>
            </li>
            <li>
              Subject: <strong className="font-semibold text-text-primary">Delete my Watchman account</strong>
            </li>
            <li>Include your name and the email on your account.</li>
          </ul>
          <p className={bodyClass}>
            We aim to respond within 30 days, or longer if POPIA allows an extension.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className={headingClass}>What is deleted</h3>
          <p className={bodyClass}>The account-deletion process removes:</p>
          <ul className={`${bodyClass} list-disc space-y-1 pl-5`}>
            <li>Your login and profile</li>
            <li>Patrol sign-ups and location history</li>
            <li>Vehicles on file</li>
            <li>Chat messages you sent, including chat images and voice notes</li>
            <li>Your profile photo</li>
            <li>Photos and documents on your own general City Hub posts</li>
            <li>Your local service listings and their photos</li>
            <li>Intelligence profiles you created</li>
            <li>Push notification tokens stored for your devices</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className={headingClass}>What may be kept</h3>
          <ul className={`${bodyClass} list-disc space-y-1 pl-5`}>
            <li>
              Incident reports you submitted may remain, with your name removed from the submitter
              field where the database allows, because the report is a neighbourhood safety record.
            </li>
            <li>
              Photos and evidence attached to incident reports stay with the report. City Hub
              suspect alerts and their photos also stay. Both are neighbourhood safety records.
            </li>
            <li>Text in reports may still mention you.</li>
            <li>
              Copies may remain in encrypted backups until those backups expire. Rolling backups may
              last about 90 days.
            </li>
            <li>
              If there is a legal hold, an investigation, or a law that requires a longer period, we
              may keep specific records longer.
            </li>
          </ul>
          <p className={bodyClass}>
            Email us if you need those remnants reviewed.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className={headingClass}>How long remaining information is kept</h3>
          <p className={bodyClass}>
            After an account is deleted, leftover profile data is intended to be cleared within 90
            days, unless the law requires longer. Other records follow the periods in our privacy
            policy:
          </p>
          <ul className={`${bodyClass} list-disc space-y-1 pl-5`}>
            <li>Patrol location and routes: 90 days</li>
            <li>Chat messages in the member view: 24 hours</li>
            <li>Chat messages in admin logs: up to 6 months (180 days)</li>
            <li>Incident reports and evidence: 5 years (policy target)</li>
            <li>Intelligence or persons-of-interest records: 1 year, with a yearly review (policy target)</li>
            <li>Audit and security logs: 1 year (policy target)</li>
            <li>Feedback and content reports: until reviewed and no longer needed, or until a deletion request is honoured</li>
          </ul>
        </section>

        <p className="text-sm">
          <Link to="/privacy" className={linkClass}>
            Privacy policy
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/terms" className={linkClass}>
            Terms
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/login" className={linkClass}>
            Sign in
          </Link>
        </p>
      </article>
    </AuthShell>
  );
}
