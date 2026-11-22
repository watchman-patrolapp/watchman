import { Link } from "react-router-dom";
import AuthShell from "../components/layout/AuthShell";
import { getPrivacyContactEmail, privacyMailto } from "../utils/privacyContact";

const linkClass = "font-medium text-text-link underline";
const bodyClass = "text-sm leading-relaxed text-text-secondary";
const headingClass = "text-lg font-semibold text-text-primary";
const subheadingClass = "text-base font-semibold text-text-primary";

function MailLink({ subject, children }) {
  const email = getPrivacyContactEmail();
  return (
    <a className={linkClass} href={privacyMailto({ subject })}>
      {children || email}
    </a>
  );
}

function PolicyTable({ columns, rows }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-subtle">
      <table className="w-full min-w-[20rem] border-collapse text-left text-sm text-text-secondary">
        <thead className="bg-surface-secondary">
          <tr>
            {columns.map((col) => (
              <th key={col} scope="col" className="border-b border-subtle px-3 py-2 font-semibold text-text-primary">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="align-top">
              {row.map((cell, i) => (
                <td key={`${row[0]}-${i}`} className="border-t border-subtle px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const toc = [
  ["#who", "Who we are"],
  ["#scope", "Who this policy applies to"],
  ["#collect", "What personal information we collect"],
  ["#why", "Why we use this information"],
  ["#retention", "How long we keep information"],
  ["#share", "Who can see your information"],
  ["#transfer", "Transfers outside South Africa"],
  ["#security", "Security"],
  ["#rights", "Your rights under POPIA"],
  ["#delete", "Deleting your account"],
  ["#children", "Children"],
  ["#automated", "Automated decisions"],
  ["#changes", "Changes"],
  ["#contact", "Contact"],
];

export default function PrivacyPolicy() {
  const email = getPrivacyContactEmail();

  return (
    <AuthShell wide alignTop>
      <article className="card w-full max-w-2xl space-y-4 p-6 sm:p-8">
        <header className="space-y-1">
          <h2 className="text-2xl font-bold text-text-primary">Privacy policy</h2>
          <p className="text-sm font-medium text-text-primary">Watchman: Neighbourhood Watch</p>
          <p className="text-sm text-text-secondary">
            Effective date: 15 November 2026 (Africa/Johannesburg)
          </p>
          <p className="text-sm text-text-secondary">
            Last updated: 17 November 2026. Android package:{" "}
            <code className="font-mono text-xs text-text-primary">za.co.africuz.watchman</code>
          </p>
        </header>

        <p className={bodyClass}>
          This policy explains what personal information Watchman collects, why we collect it, who
          sees it, how long we keep it, and your rights under South Africa&apos;s Protection of
          Personal Information Act, 2013 (POPIA). It is written in plain English.
        </p>

        <nav className="rounded-xl border border-subtle bg-surface-inset px-4 py-3" aria-label="Contents">
          <p className="text-sm font-semibold text-text-primary">Contents</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {toc.map(([href, label]) => (
              <li key={href}>
                <a className={linkClass} href={href}>
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <section className="space-y-3" id="who">
          <h3 className={headingClass}>1. Who we are</h3>
          <p className={bodyClass}>
            Watchman is operated by <strong className="font-semibold text-text-primary">Khurshid Dustmurodov, trading as Africuz</strong>, based in Gqeberha, South Africa.
          </p>
          <ul className={`${bodyClass} list-disc space-y-1 pl-5`}>
            <li>
              Privacy and data requests: <MailLink subject="Privacy / POPIA">{email}</MailLink> (subject
              line: “Privacy / POPIA”)
            </li>
            <li>
              Website:{" "}
              <a className={linkClass} href="https://africuz.co.za">
                https://africuz.co.za
              </a>
            </li>
          </ul>
          <p className={bodyClass}>
            Under POPIA, Africuz is the responsible party (controller) for personal information
            processed in Watchman, unless a written agreement says another organisation is the
            responsible party for a particular neighbourhood.
          </p>
          {/* Responsible party stays Khurshid Dustmurodov t/a Africuz for now. KYZN (Pty) Ltd is
              incorporated; operation moves to KYZN after monetisation. Update this policy, the
              Terms, Play Console and the Information Regulator registration together then. */}
          <p className={bodyClass}>
            <strong className="font-semibold text-text-primary">Information Officer:</strong>{" "}
            Khurshid Dustmurodov. Registration details with the Information Regulator will be
            published here once confirmed. Until then, send privacy requests to the email above.
          </p>
        </section>

        <section className="space-y-3" id="scope">
          <h3 className={headingClass}>2. Who this policy applies to</h3>
          <p className={bodyClass}>
            Watchman is a neighbourhood-watch coordination app for approved members of a suburb or
            watch, offered primarily in South Africa. It is for people{" "}
            <strong className="font-semibold text-text-primary">aged 18 or over</strong>. We do not
            knowingly collect personal information from anyone under 18.
          </p>
          <p className={bodyClass}>
            An administrator must approve your sign-up before you can use neighbourhood features.
            The app has no advertisements and no in-app payments or purchases.
          </p>
        </section>

        <section className="space-y-3" id="collect">
          <h3 className={headingClass}>3. What personal information we collect</h3>
          <p className={bodyClass}>
            We aim to collect only what is needed to run the watch. What we process depends on your
            role (resident, patroller, admin, or a linked security partner) and the features you use.
          </p>

          <h4 className={subheadingClass}>3.1 Account and profile</h4>
          <ul className={`${bodyClass} list-disc space-y-1 pl-5`}>
            <li>Name, email address, phone number, and home address</li>
            <li>A confirmation that you are 18 or older</li>
            <li>The suburb or organisation you join</li>
            <li>Optional profile photo (avatar)</li>
            <li>Optional home map pin (precise coordinates that you set yourself)</li>
            <li>
              Emergency contact name, phone number, and relationship that you type in. Watchman does
              not read your phone&apos;s address book.
            </li>
            <li>Optional vehicle details you add (make and model, colour, registration or number plate)</li>
            <li>Your role, and whether an admin has approved or verified you</li>
            <li>
              Your password, stored in hashed form by our sign-in provider (Supabase Auth). We do not
              see your password in plain text.
            </li>
          </ul>

          <h4 className={subheadingClass}>3.2 Location</h4>
          <p className={bodyClass}>We collect precise location in these cases:</p>
          <ol className={`${bodyClass} list-decimal space-y-2 pl-5`}>
            <li>
              <strong className="font-semibold text-text-primary">Patrols, including background location on Android.</strong>{" "}
              While you are signed on to a patrol, Watchman records your route so coordinators and
              authorised members can see it on the live map. A persistent notification titled
              “Watchman: patrol in progress” stays visible for as long as tracking runs. On Android,
              if you grant “Allow all the time”, recording can continue when the screen is off or you
              switch apps. If you only allow location while the app is open, the route is recorded
              only while Watchman is in the foreground. Tracking stops when you sign off, or when the
              patrol ends on its own. Watchman does not record a patrol route in the background when
              you are signed off.
            </li>
            <li>
              <strong className="font-semibold text-text-primary">SOS.</strong> When you send an SOS,
              the app tries to read your current position and stores it with the alert, together with
              your name, phone number, and home address, and posts a message to patrol chat so
              neighbours can respond. If a location fix is not available, the SOS can still be sent
              with the address on your profile.
            </li>
            <li>
              <strong className="font-semibold text-text-primary">Optional shares and pins.</strong> You
              may share your current position in chat, place a pin on an incident report, or set a
              home pin on your profile.
            </li>
            <li>
              <strong className="font-semibold text-text-primary">On-device nearby alerts.</strong>{" "}
              While the patroller dashboard is open, the app may read approximate location on the
              device to highlight nearby threat notices. That comparison is done on the device; those
              banner coordinates are not uploaded for that purpose. The watch pauses when the app is
              in the background, unless a patrol is signed on.
            </li>
          </ol>
          <p className={bodyClass}>
            The browser (web) app records patrol location only while the page is open during a
            signed-on patrol.
          </p>
          <p className={bodyClass}>
            Opening maps also sends some location-related data to map and weather providers. See
            section 6.
          </p>

          <h4 className={subheadingClass}>3.3 Messages and community content</h4>
          <ul className={`${bodyClass} list-disc space-y-1 pl-5`}>
            <li>
              Neighbourhood chat: text, optional photos, optional voice notes, and optional shared
              locations. Messages are set to expire from the ordinary member view after 24 hours. A
              copy may remain available to administrators for up to six months (180 days). A purge
              function exists in the system; operators should confirm it is actually scheduled in
              production.
            </li>
            <li>Announcements (area broadcasts)</li>
            <li>
              Incident reports: descriptions, time, place, people involved as you enter them, and
              photos. Resident activity reports may also include video. Voice notes are a chat
              feature; the incident form uploads photos, not voice recordings.
            </li>
            <li>Feedback you send us (name, email, and message)</li>
            <li>Reports you file about an announcement, a local-services listing, or a review</li>
            <li>
              Local services listings you publish (business name, description, the contact details
              you choose to show, photos, and an optional price range)
            </li>
            <li>Reviews of local services</li>
            <li>
              Needs-board and equipment records if your watch uses those tools, including photos
              and, for managers, invoice or PDF files
            </li>
          </ul>

          <h4 className={subheadingClass}>3.4 Safety and intelligence records</h4>
          <p className={bodyClass}>
            Authorised staff may create persons-of-interest or criminal-intelligence profiles. Those
            records can include names, aliases, descriptions, dates of birth, identity numbers,
            photographs, locations, sightings, and notes. This may be special personal information
            under POPIA (information relating to alleged criminal behaviour). It must be used
            lawfully, sparingly, and only for neighbourhood safety. If you enter information about
            someone else, you are responsible for having a lawful reason to do so.
          </p>
          <p className={bodyClass}>
            SOS alerts, live patrol positions, and incident reports are visible to authorised
            members of your neighbourhood and, where your watch has set this up, to linked security
            partners — not to the general public.
          </p>

          <h4 className={subheadingClass}>3.5 Notifications and on-device identifiers</h4>
          <p className={bodyClass}>
            If you allow notifications, we store a Firebase Cloud Messaging (FCM) device token so we
            can send push alerts for chat, incidents, SOS, and similar events. Tokens are removed
            when you sign out, and should be removed when the account is deleted.
          </p>
          <p className={bodyClass}>
            Android Auto and home-screen widgets use the signed-in session on your phone. The car
            session keeps access tokens in encrypted storage on the device. Widgets store only
            limited display fields (for example first name and organisation name), not tokens or
            phone numbers.
          </p>

          <h4 className={subheadingClass}>3.6 Technical data</h4>
          <ul className={`${bodyClass} list-disc space-y-1 pl-5`}>
            <li>
              The Android app talks to our servers over HTTPS only (unencrypted cleartext traffic is
              turned off).
            </li>
            <li>
              Our hosts may log standard technical data such as IP address, device or browser
              information, and security logs, in order to operate and protect the service.
            </li>
            <li>
              Error and performance monitoring (Sentry). This only runs in builds where a Sentry
              project key is configured. When it runs, the app sends error reports and a small
              sample of performance traces to Sentry (Functional Software, Inc.). A report can
              include your IP address, your device, operating system and browser type, the app
              version, the screen or web address where the error happened, a short trail of recent
              technical events, and an internal user ID. Before a report is sent, the app removes
              email addresses, phone numbers, locations and sign-in tokens. We do not use session
              replay or screen recording.
            </li>
          </ul>

          <h4 className={subheadingClass}>3.7 What we do not collect</h4>
          <ul className={`${bodyClass} list-disc space-y-1 pl-5`}>
            <li>We do not show ads, and we do not use an advertising identifier.</li>
            <li>
              We do not take in-app payments or store card numbers. Organisation billing in the admin
              tools is a manual subscription record, not a checkout in the app.
            </li>
            <li>We do not read your device contacts, SMS, or calendar app.</li>
            <li>
              We do not collect your date of birth, identity number, gender, race, political
              opinions, or similar details as part of registration. Those kinds of fields exist only
              on optional intelligence profiles about third parties, entered by authorised staff.
            </li>
          </ul>
        </section>

        <section className="space-y-3" id="why">
          <h3 className={headingClass}>4. Why we use this information</h3>
          <p className={bodyClass}>We use personal information to:</p>
          <ul className={`${bodyClass} list-disc space-y-1 pl-5`}>
            <li>Create and manage your account, and let an administrator approve members of a suburb</li>
            <li>
              Run patrols, the live map, SOS, incident reporting, chat, announcements, and local
              services
            </li>
            <li>Deliver alerts and keep the service secure</li>
            <li>Meet legal duties and handle access, correction, or deletion requests</li>
            <li>Investigate abuse or safety incidents</li>
          </ul>
          <p className={bodyClass}>
            We rely on these POPIA grounds, as they apply in each case: consent (for example, you
            confirm you are 18, you accept this policy, and you grant location or notification
            permission); performance of a contract with you or your watch; legitimate interests in
            running a secure neighbourhood-watch service, balanced against your rights; and legal
            obligation where the law requires us to keep or disclose information.
          </p>
          <p className={bodyClass}>
            Special personal information, including information relating to alleged criminal
            behaviour, is processed only where a lawful ground exists under POPIA.
          </p>
        </section>

        <section className="space-y-3" id="retention">
          <h3 className={headingClass}>5. How long we keep information</h3>
          <p className={bodyClass}>
            These are the intended periods. Cleanup jobs exist in the product; we should confirm they
            are scheduled in production.
          </p>
          <PolicyTable
            columns={["Information", "Intended period"]}
            rows={[
              ["Account and profile", "Until you delete your account, then up to 90 days (unless the law requires longer)"],
              ["Raw patrol GPS points", "1 year, then permanently deleted (including archived copies)"],
              ["Patrol route summaries (route line, distance, duration)", "Kept for patrol history while your watch uses Watchman"],
              ["Chat messages (member view)", "24 hours"],
              ["Chat messages (admin logs)", "6 months (180 days), after which a purge function can delete them"],
              ["Incident reports and evidence", "5 years (policy target)"],
              ["Intelligence / persons-of-interest records", "1 year, with a yearly review (policy target)"],
              ["Audit and security logs", "Up to 5 years"],
              ["Backups", "Rolling backups may last about 90 days"],
              ["Feedback and content reports", "Until reviewed and no longer needed, or until a deletion request is honoured"],
            ]}
          />
          <p className={bodyClass}>
            If there is a legal hold, an investigation, or a law that requires a longer period, we
            may keep specific records longer.
          </p>
        </section>

        <section className="space-y-3" id="share">
          <h3 className={headingClass}>6. Who can see your information</h3>
          <p className={bodyClass}>We do not sell personal information.</p>
          <p className={bodyClass}>
            <strong className="font-semibold text-text-primary">Your neighbourhood.</strong> Approved
            members and administrators of your suburb — and, where your watch has configured this,
            linked security partners — can see the information needed to run the watch. That can
            include your name and profile photo, your location while you are signed on to a patrol,
            SOS alerts, incident reports, chat, and any listing you choose to publish.
          </p>
          <p className={bodyClass}>
            <strong className="font-semibold text-text-primary">Service providers (operators under POPIA)</strong>{" "}
            who process information on our instructions:
          </p>
          <PolicyTable
            columns={["Provider", "What they do", "Where (typical)"]}
            rows={[
              ["Supabase", "Database, sign-in, file storage, and server functions", "Documented as Ireland (EU). Confirm the live project region in the Supabase dashboard."],
              ["Google (Firebase Cloud Messaging)", "Push notifications", "Per Google’s infrastructure"],
              ["Vercel", "Hosts the web app, if the website is served from Vercel", "Per Vercel"],
              ["Resend", "Transactional email, such as a “password changed” notice, when that function is configured", "United States"],
              ["Sentry (Functional Software, Inc.)", "Error reports and performance samples (IP address, device and app data, technical event trail), only if enabled in that build", "United States or EU, per the Sentry project's data region"],
            ]}
          />
          <p className={bodyClass}>
            <strong className="font-semibold text-text-primary">Other third parties</strong> (map and
            weather services):
          </p>
          <ul className={`${bodyClass} list-disc space-y-1 pl-5`}>
            <li>OpenStreetMap tile servers receive your IP address and the map area you are viewing.</li>
            <li>
              OpenStreetMap Nominatim receives precise coordinates or a search address when the app
              looks up or reverse-geocodes a place (for example a chat location or an incident pin).
            </li>
            <li>CARTO basemap tiles may be used on the live patrol map (IP address and map area).</li>
            <li>
              Esri (ArcGIS World Imagery) satellite tiles, used when you choose the satellite view
              while setting your home pin, receive your IP address and the map area you are viewing.
            </li>
            <li>
              Photon (Komoot GmbH, Germany) receives your search text or coordinates when the app
              looks up an address.
            </li>
            <li>Open-Meteo receives area coordinates so the app can show local weather.</li>
          </ul>
          <p className={bodyClass}>
            Those requests are needed for the features to work. We do not use them for advertising.
          </p>
          <p className={bodyClass}>
            We may also disclose information if the law or a valid legal process requires it, or to
            protect someone&apos;s vital interests in a serious emergency. We are not in a routine
            data-sharing arrangement with the South African Police Service.
          </p>
          <p className={bodyClass}>
            Some files are stored in private buckets and shown with short-lived signed links
            (incident photos, community media, city-hub photos, and criminal-intelligence photos).
            Other files, including avatars, chat images and voice notes, emergency-directory logos,
            and security-company branding, are still used with public URL patterns in the app. Anyone
            who has those URLs may be able to open the file. This is a known limitation.
          </p>
        </section>

        <section className="space-y-3" id="transfer">
          <h3 className={headingClass}>7. Transfers outside South Africa</h3>
          <p className={bodyClass}>
            Core application data is intended to be hosted with Supabase in the European Union
            (Ireland), but the live project region should be confirmed. Some providers process data
            in the United States or other countries (Google FCM, Resend, and possibly Vercel or
            Sentry).
          </p>
          <p className={bodyClass}>
            We transfer personal information outside South Africa only where POPIA section 72
            allows it, in particular where the recipient is bound by a law, binding corporate rules
            or a binding agreement (such as the provider&apos;s data processing agreement) that gives
            protection substantially similar to POPIA, including rules on onward transfer, or where
            the transfer is needed to provide the service you asked for.
          </p>
          <p className={bodyClass}>
            We do not rely on your consent as the main basis for these transfers. You can ask our
            Information Officer for details of the safeguards.
          </p>
        </section>

        <section className="space-y-3" id="security">
          <h3 className={headingClass}>8. Security</h3>
          <p className={bodyClass}>
            We use HTTPS for all network traffic in the Android app. Private media buckets use signed
            URLs. Android Auto session tokens are stored in encrypted on-device storage. Android
            backups of the app data are disabled. Access to neighbourhood data is limited by sign-in
            and role-based rules.
          </p>
          <p className={bodyClass}>
            No system is perfectly secure. Please choose a strong password and only upload
            information you are allowed to share.
          </p>
          <p className={bodyClass}>
            If a security compromise affects your personal information, we will notify the
            Information Regulator and you as soon as reasonably possible, as POPIA section 22
            requires.
          </p>
        </section>

        <section className="space-y-3" id="rights">
          <h3 className={headingClass}>9. Your rights under POPIA</h3>
          <p className={bodyClass}>
            Subject to POPIA and reasonable proof of identity, you may ask us to:
          </p>
          <ul className={`${bodyClass} list-disc space-y-1 pl-5`}>
            <li>Access the personal information we hold about you</li>
            <li>Correct information that is wrong or incomplete</li>
            <li>Delete information, where the law allows</li>
            <li>Object to certain processing</li>
            <li>
              Lodge a complaint with the Information Regulator (South Africa) at{" "}
              <a className={linkClass} href="https://inforegulator.org.za">
                https://inforegulator.org.za
              </a>
            </li>
          </ul>
          <p className={bodyClass}>
            To make a request, email <MailLink subject="Data request — access / correction / deletion">{email}</MailLink>{" "}
            with the subject “Data request — access / correction / deletion”, your name, the email on
            your account, a short description of what you need, and proof of identity. We aim to
            respond within 30 days, or longer if POPIA allows an extension.
          </p>
        </section>

        <section className="space-y-3" id="delete">
          <h3 className={headingClass}>10. Deleting your account</h3>
          <p className={bodyClass}>
            If you can sign in with an email and password, open{" "}
            <strong className="font-semibold text-text-primary">Profile → Delete account</strong> in
            Watchman (on the website or in the Android app). You re-enter your password, confirm that
            you understand the deletion is permanent, and the app runs our account-deletion process.
          </p>
          <p className={bodyClass}>
            That process deletes your login, profile, patrol sign-ups and location history, vehicles
            on file, chat messages you sent, and intelligence profiles you created. Incident reports
            you submitted may remain, with your name removed from the submitter field where the
            database allows, because the report is a neighbourhood safety record.
          </p>
          <p className={bodyClass}>
            It also permanently deletes your personal files: your profile photo, chat images and voice
            notes you sent, photos and documents on your own general City Hub posts, and photos on your
            own local service listings. Photos and evidence attached to incident reports are kept with
            the report, and so are City Hub suspect alerts and their photos, because they are
            neighbourhood safety records. Text in reports may still mention you. Email us if you need
            those remnants reviewed.
          </p>
          <p className={bodyClass}>
            If you cannot sign in, email <MailLink subject="Delete my Watchman account">{email}</MailLink>{" "}
            and we will handle the request after verifying your identity. Step-by-step instructions,
            including what is deleted and what may be kept, are on the public{" "}
            <Link to="/delete-account" className={linkClass}>
              Delete your account
            </Link>{" "}
            page.
          </p>
          <p className={bodyClass}>
            Copies may remain in encrypted backups until those backups expire.
          </p>
        </section>

        <section className="space-y-3" id="children">
          <h3 className={headingClass}>11. Children</h3>
          <p className={bodyClass}>
            Watchman is for users aged 18 and over. Registration requires you to confirm this. If you
            think we have collected information about a person under 18, email us and we will take
            steps to delete it. Members must not upload photos or details that identify children (see
            the Terms of Use).
          </p>
        </section>

        <section className="space-y-3" id="automated">
          <h3 className={headingClass}>12. Automated decisions</h3>
          <p className={bodyClass}>
            We do not use solely automated decision-making that produces legal or similarly
            significant effects about you.
          </p>
        </section>

        <section className="space-y-3" id="changes">
          <h3 className={headingClass}>13. Changes</h3>
          <p className={bodyClass}>
            We may update this policy. The new version will be published with a new effective date.
            If a change is material, we will ask for consent again or give notice as required.
          </p>
        </section>

        <section className="space-y-3" id="contact">
          <h3 className={headingClass}>14. Contact</h3>
          <p className={bodyClass}>
            Africuz (Khurshid Dustmurodov)
            <br />
            Gqeberha, South Africa
            <br />
            Email: <MailLink>{email}</MailLink>
            <br />
            Website:{" "}
            <a className={linkClass} href="https://africuz.co.za">
              https://africuz.co.za
            </a>
          </p>
          <p className={bodyClass}>
            Information Regulator (South Africa):{" "}
            <a className={linkClass} href="https://inforegulator.org.za">
              https://inforegulator.org.za
            </a>
          </p>
        </section>

        <p className="text-sm">
          <Link to="/delete-account" className={linkClass}>
            Delete your account
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
