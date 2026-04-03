# Privacy Policy & Terms of Service

**Document version:** 1.0 (draft for legal review)  
**Effective date:** [INSERT DATE WHEN PUBLISHED]  
**Last updated:** 2026-04-01  

> **Important:** This document is a draft. Kyzn (Pty) Ltd is not yet incorporated; the Information Officer must be appointed before go-live. A South African attorney should review and approve this text before you rely on it or link it from the app.

---

## Parties and contact details

| Item | Detail |
|------|--------|
| **Operator (“we”, “us”)** | **Kyzn (Pty) Ltd** — incorporation/registration **pending**. Upon registration, insert: registration number, registered address. Until incorporation, pre-launch enquiries may be directed to the founder at the contact below (your lawyer may add interim wording). |
| **Trading / product** | Neighbourhood Watch Platform (the **“Platform”**). |
| **General contact** | [INSERT EMAIL] |
| **Website / app URL** | [INSERT URL] |
| **Information Officer (POPIA)** | **To be appointed** before production launch. Interim privacy and data requests: [INSERT EMAIL] (subject: “POPIA / privacy”). |

**Responsible party:** When Kyzn (Pty) Ltd is registered, it will be the **responsible party** (controller) for personal information processed in connection with the Platform, unless a separate written agreement states that another organisation is the responsible party for specific processing.

---

# Part A — Privacy Policy

## 1. Introduction and scope

This Privacy Policy explains what personal information we collect, why we collect it, where it is stored, how long we keep it, who we share it with, and your rights under South Africa’s **Protection of Personal Information Act, 2013 (POPIA)**.

The Platform is offered **primarily to users in South Africa**. We do not currently market the service to the European Economic Area or United Kingdom. If we expand internationally, we will update this Policy and, where required, provide additional notices and mechanisms (for example, where the **GDPR** applies).

## 2. Personal information we collect

Depending on your role and use of the Platform, we may process:

- **Account and profile:** name, email, phone number, address, authentication data (passwords are stored in hashed form by our authentication provider), vehicle or patrol-related details you provide, and consent/version timestamps.
- **Patrol and location data:** scheduling, routes, and location information associated with patrol activity.
- **Chat (volunteers):** message content and related metadata. **Volunteer chat messages are retained for 24 hours** (then deleted per our technical configuration).
- **Chat (admin view):** where an administrative view or logs exist, we may retain related data for **6 months**.
- **Incidents:** descriptions, locations, times, people involved as you enter them, witness references, linked records, and **photos or files** you upload.
- **Push notifications:** device tokens (e.g. via Firebase Cloud Messaging) to deliver notifications.
- **Criminal intelligence / persons of interest:** profiles and related records may include names, aliases, descriptions, dates of birth, identity-related references, photographs, risk/status fields, associations, sightings, locations, free-text notes, and links to incidents. This category may include **special personal information** under POPIA and must be used lawfully and proportionately.
- **Technical and security data:** IP addresses, device/browser information, and **audit/security logs** (see retention below).
- **Payments (when enabled):** billing identifiers and transaction records processed by our payment provider (**Stripe**, when integrated).
- **Error monitoring (when enabled):** limited technical and diagnostic data via **Sentry** or similar tools.

We aim to collect only what is necessary (**minimality**). Avoid uploading unnecessary personal information, especially about third parties.

## 3. Purposes and lawful bases (POPIA)

We process personal information to:

- Provide, secure, and improve the Platform (account management, authentication, hosting, maps, email, push).
- Support neighbourhood watch coordination (patrols, incidents, communications within authorised groups).
- Maintain records required for security, abuse prevention, and legal compliance.
- Process subscriptions and payments when billing is active.
- Evidence consent and policy acceptance.

We rely on appropriate grounds under POPIA, which may include **consent** (where we ask for it), **performance of a contract** with you or your organisation, **legitimate interests** (balanced against your rights), and **legal obligation** where applicable.

**Special personal information** (including information relating to criminal behaviour, and certain biometric uses if ever introduced) is processed only where a lawful ground exists under POPIA (for example **explicit consent** or another permitted basis). Users who create or maintain intelligence records about third parties are responsible for ensuring they have a **lawful basis** and do not misuse the Platform.

## 4. Cross-border transfer of personal information

Our primary database and core processing for the application are hosted with **Supabase** in **West EU (Ireland)**. Some subprocessors process data in the **United States** or other countries (see section 6).

For transfers from South Africa, we comply with **POPIA section 72** (for example, your **consent** to cross-border transfer where that is the applicable mechanism, or another lawful mechanism as advised by our legal counsel). By using the Platform and accepting this Policy, you **acknowledge** that your personal information may be processed in **Ireland** and other jurisdictions where our processors operate, subject to our agreements and safeguards.

## 5. Retention

We retain personal information only as long as needed for the purposes above, legal requirements, or the periods below (whichever applies). When retention ends, we delete or anonymise data where technically feasible; **backup copies** may persist for a short further period (see below).

| Category | Retention period |
|----------|------------------|
| Account / profile data | Until account deletion, then up to **90 days** (unless law requires longer) |
| Patrol / location data | **90 days** |
| Chat messages (volunteers) | **24 hours** |
| Chat logs (admin view) | **6 months** |
| Incident reports & evidence | **5 years** |
| Criminal intelligence / POI records | **1 year**, with **mandatory annual review** (update, minimise, or delete as appropriate; extend only where justified and documented) |
| Audit / security logs | **1 year** |
| Backups | **90 days** rolling |
| Payment records | **5 years** (tax/accounting and legal obligations; processed via Stripe when enabled) |

If a period conflicts with a **legal hold**, investigation, or statutory requirement, we may retain specific data longer.

## 6. Sub-processors (recipients)

We use the following categories of service providers as **operators** under POPIA (processors). We enter into **data processing** or similar terms where available. You should review their privacy notices and DPAs.

| Sub-processor | Purpose | Location (primary / noted) | DPA |
|---------------|---------|----------------------------|-----|
| **Supabase** | Database, authentication, storage | Ireland (EU); subprocessors per Supabase | Yes — via Supabase dashboard / agreement |
| **Resend** | Transactional email | United States | Yes — available from Resend |
| **Vercel** | Frontend hosting | United States (and global CDN) | Yes — available from Vercel |
| **Google (Firebase / FCM)** | Push notifications | United States / per Google | Yes — Google’s DPA |
| **OpenStreetMap** | Map tiles (and related OSM infrastructure) | Various global | No separate DPA; open data / tile usage — we disclose this reliance |

**Planned / later stage:** **Stripe** (payments; DPA available), **Sentry** (error monitoring; DPA available). This Policy will be updated when they are enabled.

We do **not** sell personal information.

## 7. Law enforcement and legal requests

We are **not** in a routine data-sharing relationship with the South African Police Service (SAPS) or other authorities. We may disclose personal information when we believe in good faith that disclosure is **required by law**, by **valid legal process**, or is necessary to protect **vital interests** (for example, serious harm), after assessment and, where appropriate, legal advice. Community operators may have their own policies for reporting to police; this section describes **our** role as platform provider.

## 8. Security

We implement appropriate **technical and organisational measures** having regard to the nature of the data (including access controls, encryption in transit where supported, and least-privilege design). No system is perfectly secure; you use the Platform understanding residual risk.

## 9. Your rights (POPIA)

Subject to POPIA and reasonable verification, you may have the right to:

- **Access** personal information we hold about you  
- **Correct** inaccurate or incomplete information  
- **Delete** information where applicable (subject to legal exceptions)  
- **Object** to processing in prescribed circumstances  
- **Complain** to the **Information Regulator (South Africa)**  

**How to submit a request:** Email **[INSERT PRIVACY EMAIL]** with subject **“Data request — [access / correction / deletion]”**, your name, account email, brief description, and proof of identity. We aim to respond within **30 days** (extensions permitted under POPIA where applicable).

**Account deletion:** [DESCRIBE: e.g. email request or in-app flow when available.] Some data may remain in backups until overwritten or in anonymised aggregates.

## 10. Minors

The Platform is intended for users aged **18 and over**. We do not knowingly collect personal information from anyone under 18. If you become aware that we have, contact us and we will take steps to delete it.

## 11. Automated decision-making

[UPDATE WHEN TRUE:] We do not use solely automated decision-making that produces legal or similarly significant effects concerning you without human involvement. If that changes (for example, automated matching tools), we will update this section and your rights.

## 12. Changes to this Policy

We may update this Policy. We will publish the new version with an updated effective date. **Material changes** may require renewed consent or notice under POPIA or your contract. We maintain **consent version** identifiers in the application where users sign up or re-accept.

---

# Part B — Terms of Service

## 1. Agreement

By registering or using the Platform, you agree to these Terms and our Privacy Policy (Part A). You also agree to comply with the **Standard Operating Procedures (SOP)** and community rules communicated to you. If you do not agree, do not use the Platform.

## 2. The service

We provide software for **authorised neighbourhood watch and community safety coordination**. We are **not** SAPS, an emergency service, or a government body. We do **not** guarantee any particular safety outcome, response time, or prevention of crime.

## 3. Eligibility

You must be at least **18** years old and capable of entering a binding agreement. You must provide accurate registration information and keep your login credentials secure.

## 4. Subscriptions and fees

Subscription fees are billed as agreed with your community or organisation (**currently in the range of R200–R600 per month** depending on community size, subject to change with notice). Non-payment may result in suspension or termination of access. Payment processing will be described at checkout when **Stripe** is enabled.

## 5. Acceptable use

You agree to:

- Use the Platform **lawfully** and in accordance with the SOP and instructions of authorised coordinators.  
- Protect others’ personal information and use it **only** for legitimate watch purposes.  
- Not harass, threaten, unlawfully discriminate, or endanger others.  
- Not post false, misleading, or defamatory information.  
- Not use the Platform for vigilantism, unlawful surveillance, stalking, or doxxing.

## 6. Prohibited conduct

You must not:

- Bypass security, access data without authorisation, or interfere with the service.  
- Upload malware or misuse APIs.  
- Impersonate others or misrepresent your role.  
- Use the Platform to collect personal information for unrelated marketing or unlawful purposes.  
- Upload illegal content (including child sexual abuse material).  
- Misuse intelligence or profiling features to harm individuals without lawful justification.

We may **suspend or terminate** your account for breach or risk.

## 7. User content and licence

You retain ownership of content you submit. You grant Kyzn (Pty) Ltd a **non-exclusive, worldwide licence** to host, process, display, and share your content **as necessary to operate the Platform** and as permitted by your organisation’s settings and these Terms.

## 8. Criminal intelligence and third parties

Where you create or maintain information about **third parties**, you warrant that you have a **lawful basis** and that you do not knowingly submit false information. Misuse may result in termination and may expose you to civil or criminal liability.

## 9. Third-party services

The Platform relies on third-party infrastructure (Supabase, Vercel, maps, email, push, etc.). Their use may be subject to **third-party terms** and availability outside our control.

## 10. Intellectual property

Our software, branding, and documentation are protected. Except for the limited rights in section 7, no rights are granted.

## 11. Disclaimers

To the fullest extent permitted by **South African law**, the Platform is provided **“as is”**. We disclaim warranties including merchantability, fitness for a particular purpose, and non-infringement, except any **non-excludable** warranty implied by the **Consumer Protection Act, 2008 (CPA)** or other law.

## 12. Limitation of liability

To the fullest extent permitted by law:

- We are not liable for **indirect**, **consequential**, **special**, or **punitive** damages, or for loss of profits, goodwill, or data, **except** where such exclusion is **not permitted** by the CPA or other non-waivable law.  
- Our **total aggregate liability** for all claims arising out of or relating to the Platform in any **12-month period** is limited to the **greater of (i) the subscription fees actually paid by you (or your organisation on your behalf) to us in the 12 months before the event giving rise to the claim** and **(ii) R1,000 (one thousand Rand)**.

Nothing in these Terms limits or excludes liability that **cannot** lawfully be limited or excluded, including under the **CPA** where you qualify as a **consumer** (as defined in the CPA), or for **gross negligence**, **fraud**, **death or personal injury** caused by our negligence where applicable, or other categories that South African law does not allow to be capped or waived.

## 13. Indemnity

You agree to indemnify and hold harmless Kyzn (Pty) Ltd and its directors, employees, and contractors against **third-party claims** and reasonable losses arising from your **misuse** of the Platform, **unlawful** content you submit, or **breach** of these Terms, **to the extent permitted by law** and subject to the same **CPA** and public-policy limits that apply to indemnities under South African law.

## 14. Suspension and termination

We may suspend or terminate access for breach, non-payment (where applicable), legal requirement, or end-of-life of features. You may stop using the Platform at any time. Sections that should survive (including liability, indemnity, governing law) survive termination.

## 15. Governing law and jurisdiction

These Terms are governed by the laws of **South Africa**. Subject to **mandatory provisions** of the CPA and other laws, you submit to the **non-exclusive jurisdiction** of the South African courts. [Optional: specify a venue, e.g. **Gqeberha (Port Elizabeth)** or **Johannesburg** — confirm with your attorney.]

## 16. Consumer Protection Act

If you are a **consumer** under the CPA, you have rights that **cannot** be waived or restricted by these Terms to the extent prohibited by the CPA. If any part of these Terms is invalid or unenforceable under the CPA, it will be read down or severed to the minimum extent necessary.

---

# Part C — Sign-up acknowledgment (combined)

Use this text (or a shortened UI version) alongside links to this document. Keep `consent_version` in the app in sync when you change the document.

By creating an account, I confirm that:

1. I have read and accept the **Privacy Policy** and **Terms of Service** published at **[INSERT STABLE URL]**, version **[INSERT]** dated **[INSERT]**.  
2. I have read and accept the **Standard Operating Procedures** applicable to my watch.  
3. I understand that **personal information** — including contact details, addresses, photographs, patrol data, incident information, chat content (subject to stated retention), and where used **intelligence / POI records** — is processed for neighbourhood watch purposes as described in the Privacy Policy.  
4. I **consent** to the **cross-border transfer** and processing of my personal information in **Ireland**, the **United States**, and **other jurisdictions** where our subprocessors operate, as described in the Privacy Policy.  
5. I am **18 years of age or older**.  
6. Where I work with information that may be **special personal information** under POPIA, I will process it only for **lawful** purposes and in line with **lawfulness, minimality, security, purpose limitation, and accountability**.

---

## Pre-launch checklist (non-exhaustive)

- [ ] Incorporate **Kyzn (Pty) Ltd** and insert registration number and registered address.  
- [ ] Appoint an **Information Officer** and register as required with the Information Regulator.  
- [ ] Publish this document at a **stable URL**; link it from registration; align checkbox wording.  
- [ ] Sign **DPAs** (Supabase, Resend, Vercel, Google, and later Stripe/Sentry).  
- [ ] Confirm **technical retention** matches the table (chat 24h, backups 90d, etc.).  
- [ ] Legal review of **intelligence/POI** processing and **annual review** process documentation.
