import { Link } from "react-router-dom";
import AuthShell from "../components/layout/AuthShell";
import { getPrivacyContactEmail, privacyMailto } from "../utils/privacyContact";

// Terms of Use. Source: compliance/TERMS_DRAFT.md (17 Nov 2026).
// DRAFT pending review by a South African attorney. Before publishing as final:
// remove the draft note, set the version and effective date, and bump the
// consent/terms version used at registration (see FIX_PLAN.md item 6).
// Responsible party stays Khurshid Dustmurodov t/a Africuz for now. KYZN (Pty) Ltd
// is incorporated; operation moves to KYZN after monetisation.
// Clause 9.6 (blocking) is kept out of the page until blocking ships.

const TERMS_VERSION_LABEL = "Draft of 17 November 2026";

const linkClass = "font-medium text-text-link underline";
const bodyClass = "text-sm leading-relaxed text-text-secondary";
const headingClass = "text-lg font-semibold text-text-primary";

function MailLink() {
  const email = getPrivacyContactEmail();
  return (
    <a className={linkClass} href={privacyMailto({ subject: "Watchman Terms" })}>
      {email}
    </a>
  );
}

const toc = [
  ["#t1", "Who we are and what these Terms cover"],
  ["#t2", "What Watchman is, and what it is not"],
  ["#t3", "Eligibility and accounts"],
  ["#t4", "Roles"],
  ["#t5", "Acceptable use"],
  ["#t6", "False accusations, defamation and unverified allegations"],
  ["#t7", "Standards for incident reports and suspect / intelligence content"],
  ["#t8", "Your content"],
  ["#t9", "Reporting content and takedown"],
  ["#t10", "Location, patrols and personal safety"],
  ["#t11", "Third-party services"],
  ["#t12", "Fees"],
  ["#t13", "Responsibility and indemnity"],
  ["#t14", "Disclaimers and limitation of liability"],
  ["#t15", "Suspension and termination"],
  ["#t16", "Changes"],
  ["#t17", "Governing law and disputes"],
  ["#t18", "Contact"],
];

export default function TermsOfUse() {
  return (
    <AuthShell wide alignTop>
      <article className="card w-full max-w-2xl space-y-4 p-6 sm:p-8">
        <header className="space-y-1">
          <h2 className="text-2xl font-bold text-text-primary">Terms of Use</h2>
          <p className="text-sm font-medium text-text-primary">Watchman: Neighbourhood Watch</p>
          <p className="text-sm text-text-secondary">Version: {TERMS_VERSION_LABEL} (Africa/Johannesburg)</p>
        </header>

        <p className="rounded-xl bg-warning-light px-3 py-2 text-sm text-warning-foreground" role="note">
          Draft pending legal review. These Terms are being reviewed by a South African attorney and
          may change before they take effect. Until then, the terms you accepted when you registered
          continue to apply.
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

        <section className="space-y-3" id="t1">
          <h3 className={headingClass}>1. Who we are and what these Terms cover</h3>
          <p className={bodyClass}>
            1.1 Watchman (&quot;the App&quot;, &quot;the Service&quot;) is a neighbourhood-watch coordination app on the web and on Android (package <code className="font-mono text-xs text-text-primary">za.co.africuz.watchman</code>). It is operated by <strong className="font-semibold text-text-primary">Khurshid Dustmurodov, trading as Africuz</strong>, Gqeberha, South Africa (&quot;we&quot;, &quot;us&quot;). Contact: <MailLink />.
          </p>
          <p className={bodyClass}>
            1.2 These Terms are an agreement between you and us. You accept them when you register, or when you tap &quot;I accept&quot; after we change them. If you do not accept them, do not use the Service.
          </p>
          <p className={bodyClass}>
            1.3 These Terms work together with:
          </p>
          <ul className={`${bodyClass} list-none pl-5 space-y-1`}>
            <li>(a) our <strong className="font-semibold text-text-primary">Privacy Policy</strong> at <Link to="/privacy" className={linkClass}>/privacy</Link>;</li>
            <li>(b) the <strong className="font-semibold text-text-primary">Standard Operating Procedures (SOP)</strong> and community rules of the watch you join;</li>
            <li>(c) any written agreement between us and your watch, security company or organisation.</li>
          </ul>
          <p className={bodyClass}>
            If those documents conflict, the written agreement wins first, then these Terms, then the SOP.
          </p>
        </section>

        <section className="space-y-3" id="t2">
          <h3 className={headingClass}>2. What Watchman is, and what it is not</h3>
          <p className={bodyClass}>
            2.1 Watchman helps approved members of a neighbourhood watch to coordinate patrols, send SOS alerts, report incidents, chat, and share safety information with their watch and with linked security partners.
          </p>
          <p className={bodyClass}>
            2.2 <strong className="font-semibold text-text-primary">Watchman is not an emergency service.</strong> It is not the South African Police Service (SAPS), an ambulance or fire service, or a private security company. Nobody is guaranteed to see an alert, a message, or an SOS, or to respond within any time.
          </p>
          <ul className={`${bodyClass} list-disc pl-5 space-y-1`}>
            <li><strong className="font-semibold text-text-primary">In an emergency, call SAPS on 10111, emergency services on 112 from a mobile phone, or your armed-response provider first.</strong> Then use Watchman.</li>
            <li>An SOS in Watchman is an extra alert to your neighbours. It does not replace those calls.</li>
          </ul>
          <p className={bodyClass}>
            2.3 Watchman depends on mobile networks, internet access, GPS, battery, push-notification services and third-party hosting. Any of these can fail or be delayed.
          </p>
          <p className={bodyClass}>
            2.4 Watchman does not give legal, policing or security advice. Members and coordinators are volunteers or private persons, not officials.
          </p>
        </section>

        <section className="space-y-3" id="t3">
          <h3 className={headingClass}>3. Eligibility and accounts</h3>
          <p className={bodyClass}>
            3.1 You must be <strong className="font-semibold text-text-primary">18 years or older</strong> and able to enter into a binding agreement. We do not knowingly allow anyone under 18 to register.
          </p>
          <p className={bodyClass}>
            3.2 A watch administrator must approve your account before you can use neighbourhood features. Administrators may decline or revoke approval.
          </p>
          <p className={bodyClass}>
            3.3 You must:
          </p>
          <ul className={`${bodyClass} list-none pl-5 space-y-1`}>
            <li>(a) give true, current information (name, phone, address) and keep it up to date;</li>
            <li>(b) use only your own account. Do not share your login, and do not let another person use your session or device while you are signed in;</li>
            <li>(c) keep your password secret, and tell us or your administrator straight away if you think your account has been misused;</li>
            <li>(d) not create an account for someone else, impersonate anyone, or misrepresent your role (for example claiming to be a patroller, committee member, police officer or security officer when you are not).</li>
          </ul>
          <p className={bodyClass}>
            3.4 You are responsible for everything done through your account, unless it happened because of our breach of these Terms.
          </p>
        </section>

        <section className="space-y-3" id="t4">
          <h3 className={headingClass}>4. Roles</h3>
          <p className={bodyClass}>
            4.1 Watchman has roles such as resident, volunteer/patroller, investigator, committee, watch administrator, city administrator and security partner. Your role decides what you can see and do.
          </p>
          <p className={bodyClass}>
            4.2 Patrollers and security partners must also accept and follow the SOP and partner operating rules for their role. A role is a permission inside the App. It gives you no legal authority over anyone.
          </p>
        </section>

        <section className="space-y-3" id="t5">
          <h3 className={headingClass}>5. Acceptable use</h3>
          <p className={bodyClass}>
            5.1 You may use Watchman only for lawful neighbourhood-safety purposes and in line with the SOP.
          </p>
          <p className={bodyClass}>
            5.2 You must not:
          </p>
          <ul className={`${bodyClass} list-none pl-5 space-y-1`}>
            <li>(a) break any law, including POPIA, the Cybercrimes Act 19 of 2020, the Protection from Harassment Act 17 of 2011, and the Criminal Procedure Act 51 of 1977;</li>
            <li>(b) harass, threaten, intimidate, stalk, dox or unfairly discriminate against anyone, or encourage anyone else to do so;</li>
            <li>(c) encourage, plan or take part in <strong className="font-semibold text-text-primary">vigilantism</strong>, violence, &quot;mob justice&quot;, unlawful arrest, unlawful search, or the unlawful use of force;</li>
            <li>(d) post hate speech, sexual content, graphic violence that is not needed to describe an incident, or any content that sexualises or exploits children;</li>
            <li>(e) post spam, advertising (outside the local-services directory), scams, chain messages or misleading links;</li>
            <li>(f) upload malware, try to get around security or access controls, scrape data, reverse-engineer the App, or use automated tools against it;</li>
            <li>(g) use information from Watchman for anything other than the watch&apos;s safety purpose. That includes marketing, debt collection, personal disputes, employment screening, or selling or publishing it elsewhere;</li>
            <li>(h) copy, screenshot or forward other members&apos; personal information, incident details or intelligence records outside Watchman, unless the law requires it or the person concerned has consented. A lawful report to SAPS is allowed.</li>
          </ul>
        </section>

        <section className="space-y-3" id="t6">
          <h3 className={headingClass}>6. False accusations, defamation and unverified allegations</h3>
          <p className={bodyClass}>
            6.1 <strong className="font-semibold text-text-primary">You must not post false, misleading or defamatory content about any person.</strong> That includes words, photos, video, voice notes, profile entries and City Hub posts. Under South African law, publishing a statement that harms someone&apos;s reputation can make you personally liable for damages, even if you only repeated what someone else said.
          </p>
          <p className={bodyClass}>
            6.2 You must not say or suggest that an identifiable person has committed a crime or is a &quot;suspect&quot;, &quot;criminal&quot; or &quot;known offender&quot; unless:
          </p>
          <ul className={`${bodyClass} list-none pl-5 space-y-1`}>
            <li>(a) you personally saw what you describe, or have reliable evidence of it (for example, video you recorded or a SAPS case number); and</li>
            <li>(b) you describe the facts and do not draw conclusions. For example, write &quot;A man in a red jacket tried the gate at no. 12 at 02:10&quot;. Do not write &quot;John from no. 14 is a thief&quot;.</li>
          </ul>
          <p className={bodyClass}>
            6.3 You must not:
          </p>
          <ul className={`${bodyClass} list-none pl-5 space-y-1`}>
            <li>(a) name, photograph or describe a person as a suspect based on race, ethnicity, nationality, religion, gender, language, disability, poverty, homelessness, appearance or &quot;looking suspicious&quot; alone;</li>
            <li>(b) guess at or &quot;crowd-source&quot; the identity of a person in a photo or video, or ask other members to identify them. The exception is a request that goes through the watch&apos;s authorised investigator or administrator and stays within the App;</li>
            <li>(c) post rumours, second-hand stories presented as fact, or allegations from social media or WhatsApp groups that you cannot verify;</li>
            <li>(d) keep posting an allegation after a moderator, administrator, SAPS or a court has found it untrue, or after the person has been cleared;</li>
            <li>(e) use Watchman to punish, shame or take revenge on anyone.</li>
          </ul>
          <p className={bodyClass}>
            6.4 If you are unsure, report only what you saw, mark it as unconfirmed, and leave identification to SAPS or the watch&apos;s authorised investigator.
          </p>
        </section>

        <section className="space-y-3" id="t7">
          <h3 className={headingClass}>7. Standards for incident reports and suspect / intelligence content</h3>
          <p className={bodyClass}>
            7.1 <strong className="font-semibold text-text-primary">Incident reports</strong> must be:
          </p>
          <ul className={`${bodyClass} list-none pl-5 space-y-1`}>
            <li>(a) <strong className="font-semibold text-text-primary">factual</strong>: what happened, when, and where;</li>
            <li>(b) <strong className="font-semibold text-text-primary">first-hand</strong>, or clearly marked with the source (for example &quot;reported to me by the resident at no. 5&quot;);</li>
            <li>(c) <strong className="font-semibold text-text-primary">free of speculation about identity</strong>. Describe clothing, vehicles, direction of travel and behaviour, and do not guess at names;</li>
            <li>(d) <strong className="font-semibold text-text-primary">proportionate</strong>: include only the personal information needed for the watch to respond.</li>
          </ul>
          <p className={bodyClass}>
            7.2 <strong className="font-semibold text-text-primary">No minors.</strong> Do not upload photos or video in which a child (anyone under 18) can be identified. Do not record a child&apos;s name, school or other identifying details in an incident, a profile or chat. If a child is involved in an incident, describe them only in general terms and report it to SAPS. Moderators will remove content that identifies a child.
          </p>
          <p className={bodyClass}>
            7.3 <strong className="font-semibold text-text-primary">Persons-of-interest and intelligence profiles</strong> may be created only by users whose role allows it, and only:
          </p>
          <ul className={`${bodyClass} list-none pl-5 space-y-1`}>
            <li>(a) for the watch&apos;s lawful safety purpose;</li>
            <li>(b) where there is a factual basis, such as a linked incident, a SAPS case number, or direct observation by a member;</li>
            <li>(c) with accurate, up-to-date information. The person who created a profile, and the watch&apos;s administrators, must correct or close it promptly when it becomes out of date, when the person is cleared, or when there is no longer a reason to keep it;</li>
            <li>(d) without identity numbers, home addresses, family members or other details that the safety purpose does not need.</li>
          </ul>
          <p className={bodyClass}>
            7.4 Information about alleged criminal behaviour is <strong className="font-semibold text-text-primary">special personal information</strong> under POPIA (section 26). Processing it is restricted by law. By creating or editing such content, you confirm that you understand this and will follow the SOP, these Terms and the instructions of your watch&apos;s Information Officer.{/* ATTORNEY: confirm the lawful basis under POPIA ss 27, 31–33 and whether prior authorisation under s 57(1)(b) is needed. Adjust clauses 7.3–7.5 to match. */}
          </p>
          <p className={bodyClass}>
            7.5 Profiles are reviewed at least once a year. Profiles that are not renewed may be archived or deleted.{/* Align with the retention schedule in the Privacy Policy. */}
          </p>
          <p className={bodyClass}>
            7.6 Sharing to City Hub (other watches) must use the sanitised share flow. It must not include the reporter&apos;s name, witnesses, street addresses, SAPS numbers or photos of identifiable people, unless the watch administrator has approved this and has a lawful basis.
          </p>
        </section>

        <section className="space-y-3" id="t8">
          <h3 className={headingClass}>8. Your content</h3>
          <p className={bodyClass}>
            8.1 &quot;Your content&quot; is anything you post: text, photos, video, voice notes, locations, reports, reviews, listings and profiles.
          </p>
          <p className={bodyClass}>
            8.2 You keep ownership of your content. You give Khurshid Dustmurodov, trading as Africuz a non-exclusive, royalty-free licence to host, store, copy, process, display and send your content, only as needed to run the Service for your watch and for the people your settings and role allow. That includes linked security partners and, for City Hub posts, other watches. The licence ends when the content is deleted, except for copies kept for the reasons in the Privacy Policy (for example legal holds or backups).
          </p>
          <p className={bodyClass}>
            8.3 You confirm that:
          </p>
          <ul className={`${bodyClass} list-none pl-5 space-y-1`}>
            <li>(a) you have the right to post your content;</li>
            <li>(b) it is accurate as far as you know; and</li>
            <li>(c) posting it does not infringe anyone&apos;s rights or break the law.</li>
          </ul>
          <p className={bodyClass}>
            8.4 We do not check content before it is posted. The exceptions are steps the App takes for some content types, such as approval of incident reports by a moderator. Content is the responsibility of the person who posted it.
          </p>
        </section>

        <section className="space-y-3" id="t9">
          <h3 className={headingClass}>9. Reporting content and takedown</h3>
          <p className={bodyClass}>
            9.1 <strong className="font-semibold text-text-primary">Report.</strong> You can report a post, message, listing, review, profile or user with the <strong className="font-semibold text-text-primary">Report</strong> option (in the ⋯ menu, or by long-pressing a chat message). Choose a reason and add details if you want to. Your report is sent to the moderators of that watch. The reported person is not told who reported them.
          </p>
          <p className={bodyClass}>
            9.2 <strong className="font-semibold text-text-primary">What happens next (target timelines):</strong>
          </p>
          <ul className={`${bodyClass} list-none pl-5 space-y-1`}>
            <li>(a) <strong className="font-semibold text-text-primary">Immediate risk to life or safety, or child sexual abuse material:</strong> contact SAPS (10111) first. We aim to restrict the content <strong className="font-semibold text-text-primary">within 24 hours</strong> of a report reaching us, and we will cooperate with SAPS where the law requires it.</li>
            <li>(b) <strong className="font-semibold text-text-primary">Possible defamation, harassment, privacy breaches, doxxing, or content that identifies a child:</strong> we aim to review it and, where appropriate, hide it <strong className="font-semibold text-text-primary">within 48 hours</strong> while it is looked at.</li>
            <li>(c) <strong className="font-semibold text-text-primary">Other reports (spam, scams, off-topic posts):</strong> we aim to review them <strong className="font-semibold text-text-primary">within 7 days</strong>.{/* ATTORNEY/OPERATOR: confirm the timelines can be resourced. */}</li>
          </ul>
          <p className={bodyClass}>
            9.3 Moderators may hide, edit (only to remove personal or unlawful information), restore or delete content. They may also warn, suspend or remove users. Wherever we can, we keep a record of what was done and why.
          </p>
          <p className={bodyClass}>
            9.4 <strong className="font-semibold text-text-primary">Takedown requests from non-members.</strong> If you are not a member and believe Watchman contains false, defamatory or unlawful content about you, or personal information about you, email <MailLink /> with the subject &quot;Takedown request&quot;. Say what the content is, which watch or area it is in (if you know), and why it should be removed. We will acknowledge the request <strong className="font-semibold text-text-primary">within 5 business days</strong> and aim to decide <strong className="font-semibold text-text-primary">within 30 days</strong>, sooner for serious harm. You may also have rights under POPIA (see the Privacy Policy).
          </p>
          <p className={bodyClass}>
            9.5 <strong className="font-semibold text-text-primary">Appeals.</strong> If your content is removed or your account is restricted, you may ask for a review by emailing us within 30 days.{/* Note: clause 9.6 (blocking) is held back until blocking ships. See TERMS_DRAFT.md. */}
          </p>
        </section>

        <section className="space-y-3" id="t10">
          <h3 className={headingClass}>10. Location, patrols and personal safety</h3>
          <p className={bodyClass}>
            10.1 When you sign on to a patrol, Watchman records your location, including in the background on Android if you allow it, until you sign off or the patrol ends. Your watch&apos;s coordinators and authorised members can see it. You can stop tracking by signing off.
          </p>
          <p className={bodyClass}>
            10.2 <strong className="font-semibold text-text-primary">Your safety comes first.</strong>
          </p>
          <ul className={`${bodyClass} list-disc pl-5 space-y-1`}>
            <li>Do not confront, chase, detain or follow suspects.</li>
            <li>Observe, record and report. Do not intervene.</li>
            <li>Follow the SOP, obey traffic laws, and do not use the App while driving except through Android Auto or other hands-free features where the law allows it.</li>
          </ul>
          <p className={bodyClass}>
            10.3 Location, maps, routes and &quot;nearby&quot; alerts can be inaccurate. Do not rely on them to navigate into danger or to identify a person.
          </p>
          <p className={bodyClass}>
            10.4 Sharing your location in chat, SOS or on an incident is your choice. Think before you share your home location.
          </p>
        </section>

        <section className="space-y-3" id="t11">
          <h3 className={headingClass}>11. Third-party services</h3>
          <p className={bodyClass}>
            The Service relies on third parties, including Supabase, Vercel, Google (Firebase Cloud Messaging, Play, Android Auto), Sentry (if enabled), Resend, and map and weather providers (OpenStreetMap, CARTO, Esri, Photon, Open-Meteo). Their availability and terms are outside our control. The Privacy Policy lists them.
          </p>
        </section>

        <section className="space-y-3" id="t12">
          <h3 className={headingClass}>12. Fees</h3>
          <p className={bodyClass}>
            Watchman is currently free to use and has no in-app payments. If that changes, we will give notice in the App before any charges apply.{/* ATTORNEY/OPERATOR: replace with fee terms (who pays, how much, notice of changes) if and when the Service is charged for. */}
          </p>
        </section>

        <section className="space-y-3" id="t13">
          <h3 className={headingClass}>13. Responsibility and indemnity</h3>
          <p className={bodyClass}>
            13.1 You are responsible for your content and your conduct, on the App and offline (for example on patrol).
          </p>
          <p className={bodyClass}>
            13.2 To the extent the law allows, you indemnify Khurshid Dustmurodov, trading as Africuz and its directors, employees and contractors against third-party claims and reasonable costs arising from:
          </p>
          <ul className={`${bodyClass} list-none pl-5 space-y-1`}>
            <li>(a) content you posted that is false, defamatory, infringing or unlawful;</li>
            <li>(b) your breach of these Terms or the SOP; or</li>
            <li>(c) your unlawful conduct, including any vigilante action.</li>
          </ul>
          <p className={bodyClass}>
            This does not apply to the extent that the loss was caused by our own breach, negligence or wrongdoing.{/* ATTORNEY: check enforceability against consumers under the CPA, s 48–51. */}
          </p>
        </section>

        <section className="space-y-3" id="t14">
          <h3 className={headingClass}>14. Disclaimers and limitation of liability</h3>
          <p className={bodyClass}>
            14.1 The Service is provided &quot;as is&quot; and &quot;as available&quot;. To the extent the law allows, we give no guarantee that it will be uninterrupted, error-free or secure, or that it will prevent crime, injury or loss.
          </p>
          <p className={bodyClass}>
            14.2 To the extent the law allows, we are not liable for:
          </p>
          <ul className={`${bodyClass} list-none pl-5 space-y-1`}>
            <li>(a) any failure, delay or inaccuracy of alerts, SOS, chat, location or notifications;</li>
            <li>(b) the acts or omissions of members, patrollers, watches, security partners, SAPS or other third parties;</li>
            <li>(c) indirect or consequential loss, loss of profit, or loss of data.</li>
          </ul>
          <p className={bodyClass}>
            14.3 Our total liability for all claims in any 12-month period is limited to the greater of (a) the fees you or your organisation paid us in that period, or (b) R1,000.{/* ATTORNEY: confirm the cap. */}
          </p>
          <p className={bodyClass}>
            14.4 Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or limited, including under the Consumer Protection Act 68 of 2008 where it applies, or liability for gross negligence, fraud, or death or personal injury caused by our negligence. If you are a &quot;consumer&quot; under the CPA, your non-waivable CPA rights are not affected.
          </p>
        </section>

        <section className="space-y-3" id="t15">
          <h3 className={headingClass}>15. Suspension and termination</h3>
          <p className={bodyClass}>
            15.1 You may stop using Watchman and delete your account at any time in <strong className="font-semibold text-text-primary">Profile → Delete account</strong>, or by following the instructions at <Link to="/delete-account" className={linkClass}>/delete-account</Link>.
          </p>
          <p className={bodyClass}>
            15.2 We or your watch administrator may restrict, suspend or remove your account or content, with or without notice, if:
          </p>
          <ul className={`${bodyClass} list-none pl-5 space-y-1`}>
            <li>(a) you breach these Terms or the SOP;</li>
            <li>(b) you put anyone at risk;</li>
            <li>(c) the law requires it; or</li>
            <li>(d) your watch ends its use of Watchman.</li>
          </ul>
          <p className={bodyClass}>
            Where it is safe and lawful, we will tell you why.
          </p>
          <p className={bodyClass}>
            15.3 Clauses 6, 8.3, 13, 14, 16 and 17 survive termination.
          </p>
        </section>

        <section className="space-y-3" id="t16">
          <h3 className={headingClass}>16. Changes</h3>
          <p className={bodyClass}>
            We may change these Terms. For material changes we will give notice in the App, and you may be asked to accept the new version before you can keep posting content. The version and effective date are shown at the top.
          </p>
        </section>

        <section className="space-y-3" id="t17">
          <h3 className={headingClass}>17. Governing law and disputes</h3>
          <p className={bodyClass}>
            These Terms are governed by the law of the Republic of South Africa. Subject to your non-waivable rights (including under the CPA), you agree to the non-exclusive jurisdiction of the South African courts.{/* ATTORNEY: e.g. the Eastern Cape Division of the High Court, Gqeberha, or the relevant Magistrate's Court */} Before going to court, please contact us so we can try to resolve the issue.
          </p>
        </section>

        <section className="space-y-3" id="t18">
          <h3 className={headingClass}>18. Contact</h3>
          <p className={bodyClass}>
            Khurshid Dustmurodov, trading as Africuz, Gqeberha, South Africa
            <br />
            Email: <MailLink /> (subject &quot;Watchman Terms&quot;)
            <br />
            Information Officer: Khurshid Dustmurodov (registration details with the Information
            Regulator to follow)
            <br />
            Website: <a className={linkClass} href="https://africuz.co.za">https://africuz.co.za</a>
          </p>
        </section>

        <p className="text-sm">
          <Link to="/privacy" className={linkClass}>
            Privacy policy
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/delete-account" className={linkClass}>
            Delete your account
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/register" className={linkClass}>
            Create an account
          </Link>
        </p>
      </article>
    </AuthShell>
  );
}
