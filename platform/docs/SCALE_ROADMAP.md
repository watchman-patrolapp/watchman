# Neighborhood Watch Platform — Scale Roadmap

*Last updated: 19 August 2026 (leaderboard fuel calculator, home pin/sector, area broadcasts, next of kin)*

Living status for scaling from **one live neighborhood (Theescombe)** to a multi-neighborhood product with residents, partners, and billing.

Canonical app: `platform/web`  
Canonical backend: `platform/supabase`

---

## Where we are

The original patroller app is still the production core (patrols, incidents, chat, intelligence, Android). Since **14–15 August 2026** we added the **scale foundation**: organizations, platform vs neighborhood roles, working-area isolation, resident surfaces, City Hub, hotspots, billing *records*, role-based public signup, and **role-specific homes** for security companies and city admin / police.

This is **close to code-complete for a second-area pilot**, not a finished commercial SaaS. Remaining pilot work is proof and plumbing (isolation test, Theescombe fallbacks, suburb/invite UI, SOS resolve-after-acknowledge). Home pin/sector and the fuel calculator are in. Commercial work (Stripe, feature gates, partner review, ID upload, front/back sectors) is still open.

| Layer | Status |
|---|---|
| Layer 1 — NHW operations (patrol / incidents / chat) | **Live** in Theescombe |
| Multi-tenant org + working-area isolation | **Shipped** — one parent city (Gqeberha / Port Elizabeth); every operational page is org-scoped except City Hub and Hotspots (city-wide). |
| Platform Console vs neighborhood admin | **Shipped** |
| Role-based register forms | **Shipped in code** — apply `20260815031000_role_based_signup.sql` + `20260815033000` (do not demote staff on login) |
| Layer 2 — Resident app | **Household home shipped** — SOS hold, reports, neighbour directory, staff + two-neighbour verification with **who verified**, **home pin + closest-10 sector**, next-of-kin, area broadcasts, away notices. ID/proof queue and SOS resolve-after-acknowledge still open |
| City Hub | **Share + manage + photos/PDFs + author contacts + feed styling + premium banner with live counts** — pre-publish moderation, legal waiver, and radius targeting still incomplete |
| Role-specific dashboards | **Security command + city admin/police + resident home shipped** — partner SOS is multi-area (`/security/sos`), not the watch `/sos` board |
| Revenue (NW annual fee) | **Manual records + suggested fees + admin list-price override** — no payment provider, no hard feature gates |
| Security-company commercialization | **Command home + roster (view-only) + cover/logo profile + public directory cards** — signup still creates a `pending` org; review queue not built; not a paid product yet |
| 2–5 neighborhood pilots | **Not started operationally** |

---

## Progress snapshot

Two different finish lines. Do not mix them.

| Finish line | Estimate | What “done” means |
|---|---|---|
| **Theescombe live ops** (Layer 1) | **~96%** | Patrol, incidents, chat, intel, Android live. Chat 180-day purge cron is on. Leaderboard fuel calculator + weather/mileage facts shipped. Remaining: SOS timers, after-action KPIs, legal go-live. |
| **Second-neighborhood pilot** | **~78%** | Another Gqeberha suburb (e.g. Lorraine) can run isolated with residents, SOS, City Hub, Hotspots; home pins and sector lists exist |
| **Commercial scale product** | **~50%** | Paid NW subscriptions, gated features, partner review, 2–5 live neighborhoods, compliance |

**Pilot (~78%).** Resident, partner, and City Hub *screens* exist, including a public emergency directory, partner command SOS, home pins, and closest-10 sectors. The remaining ~22% is proving isolation vs a second org, dropping leftover Theescombe fallbacks, placing signups into a suburb from the app, finishing SOS after “I’m responding”, and a pending-org review queue.

**Commercial (~50%).** Billing still does not collect money or cut features (list price can be overridden by hand). Security companies can log in on a `pending` org with no activate/merge queue. City Hub has no legal waiver or radius RLS. There is no ID / proof-of-residence queue, no full front/back smart sectors, and no second neighborhood is live.

Weighted against the original phase map: Phases 0–3 and 5b are the bulk of what shipped this weekend. Phases 4–5 (money + partner product) and **Pilots** are the long pole.

---

## Done since 14–15 August 2026

### Multi-tenant foundation
- Organizations, members, cities, suburbs, subscriptions, resident/patroller profiles.
- Migration: `20260815010000_scale_multitenant_foundation.sql`.
- Org-aware query helper (`useScopedOrganization`) on patrol, incidents, chat, intelligence, admin, resident, and SOS screens.
- Working-area lock: global Main admin / Technical support pick one neighborhood (`/choose-area`); local users stay in their home org (`20260815027000`).
- Intelligence RLS (`20260815028000`).
- **Page isolation:** all neighborhood data is per working org. **Only City Hub and Hotspots are city-wide** (`20260815029000`).
- **Parent city:** one city — **Gqeberha (Port Elizabeth)** — sits above every neighborhood and partner org. Areas stay isolated from each other. Apply `20260815055000_gqeberha_city_parent.sql`.
- Legacy Theescombe rows backfilled onto the first org.

### Platform vs neighborhood authority
- `platform_role`: `platform_owner` / `platform_ops` / `platform_support` / `none`.
- Platform-only: Organizations, Billing, Security memberships, Security insights, Pilot readiness.
- Neighborhood staff keep patrol/incident/user/moderation tools.
- Global app roles: **Main admin** and **Technical support** are platform-wide (not billed as local members). **NW admin** is local per organization.
- Migrations: `20260815021000`, `20260815023000`, `20260815024000`, `20260815026000`.
- In-app Role Access Guide: `/admin/roles`.

### Resident MVP (pages exist)
- Resident home is the **default landing after login for households only** (`/resident`): hold-to-SOS, activity reports, neighbourhood activity feed, verified badge / unverified notice, neighbour vouch, My sector, security membership.
- **Not a watch-home tile.** Patrollers, volunteers, committee, and NW admin do not get a Resident home button. Main admin and Technical support open **View resident home** from the Admin panel (preview / moderate), with **Back to admin**.
- SOS trigger, activity report/list with acknowledgement timeline.
- Optional security-company membership on profile + self-report from signup.
- Migrations: `20260815025000`, `20260815041000` … `20260815042000`, `20260815049000`, `20260815051000`, `20260815052000`, `20260815057000`.

### Resident verification + neighbour directory (15 Aug night)
- Staff (admin / NW admin / patroller) verify in one click from `/admin/residents`.
- Two already-verified neighbours can vouch from **Verify neighbours** (`/resident/neighbours`). Unverified / verified tabs, street labels only (no house number, email, or phone).
- **Who verified** shows on the household card: staff role + name, or the neighbour names who vouched. Same line on **My sector** (`/resident/sector`) and on the admin Residents table.
- Live: `20260815041000`, `20260815042000`, `20260815049000`, and **`20260815057000` applied 16 Aug**.
- Still open: ID / proof-of-residence upload and reject / resubmit.

### Production housekeeping (16 Aug)
- Chat 180-day hard delete: `run_chat_messages_retention_purge()` (`20260401141000`) **applied**.
- **pg_cron job confirmed** on live: `jobid 3`, `chat_messages_retention_6mo`, `25 5 * * *` (05:25 UTC / 07:25 SAST) → `SELECT public.run_chat_messages_retention_purge();`.
- SOS auto-timers are **not** scheduled. `tick_sos_escalations()` does not exist yet; hang it on the same pg_cron extension when built. Do not put a countdown in the patrol app.

### Chat (two rooms)
- **Patrol ops** (`visibility: patrol`) — watch only; default Chat for admins/patrollers. SOS and critical alerts stay here.
- **Neighbours** (`visibility: resident`) — household ↔ patrol. Neighbour chat is muted for ops unless SOS/critical.
- Dual unread cursors + notification filter. Apply `20260815053000_chat_visibility_channels.sql`.

### City Hub
- Feed for watch / security / city staff (view vs publish by role).
- **Share incident to City Hub** from incident detail / post-approve moderation: sanitized summary (no reporter, witnesses, street address, photos, or SAPS numbers), review checkbox, one published post per incident.
- Global staff can publish even though they are not org members (`20260815031000_city_hub_share_rls.sql`).
- **Edit / Archive / Delete** on the City Hub feed (`20260815032000_city_hub_post_manage.sql`):
  - Main admin and Technical support: any post.
  - NW admin: only posts they authored or shared.
  - Archive hides the post and allows the incident to be shared again; delete is permanent. The source incident stays in the neighborhood.
- **Unread badges** on dashboard / admin City Hub tiles (last-seen in localStorage; no push). Opening City Hub highlights new posts, then marks them read.
- **Photo + PDF attachments** on publish (`20260815034000`, `20260815035000`): up to 6 images and 4 PDFs. Thumbnails show the **full original aspect ratio** (`object-contain`); click opens a lightbox. Vertical images are not cropped to width.
- **Author name next to the time**, clickable contact card (role, neighbourhood, email, phone) so another area can reach the publisher (`20260815036000`, `20260815037000`). Visible to City Hub viewers including **NW admin and patrollers**, not only global admin / tech support.
- **System vs author copy:** Neighborhood / Date / Type sit in a muted metadata box **above** the title; the write-up is the main text; the briefing note is a small italic footer.
- **Feed cards:** stronger light-mode separation — grey surface, light shadow, type-coloured left bar, more gap between posts.
- **Premium banner (16 Aug):** HTML title + coloured capability chips; map artwork is atmosphere only (no baked stats or fake suburb names). Live counts on the banner: **neighborhoods** (active watch groups), **active alerts** (published suspect + pattern posts), **shared reports** (all published hub posts — same source for every role). Back control sits *above* the card as a real button (security partners: **Back to command**).
- **Back-nav:** City Hub and Hotspots use `homeBackNav` — security command, city admin, global admin, resident, or watch home — never send a partner to `/admin`.
- Migrations: `20260815030000`, `20260815031000_city_hub_share_rls.sql`, `20260815032000`, `20260815034000`, `20260815035000`, `20260815036000`, `20260815037000`.

### Hotspots
- Pins for **break-in**, **attempted break-in**, **cable theft**, and **attempted cable theft**. Theft from a shop/office after entry stays **break-in**; cable kinds are copper / street / telecom / municipal only (`20260815054000_hotspot_cable_theft_kinds.sql`).
- **Edit pin** from the map overlay, Leaflet popup, selected-pin card, and Pins-in-range list. Staff can change kind, address, map location, date/time, and notes. Save keeps the pin selected. Write roles: committee, NW admin, main admin, technical support, security admin, city admin (`hotspotManage` / `is_hotspot_staff`). Patrollers view only.
- **Transparent threaded hot zone:** two or more pins within ~3 km form a see-through hull; a dashed purple **thread** joins them in date order (date-only pins still thread; clock time is no longer required). Travel-thread toggle shows/hides the corridor + dashed line.
- Address search: Nominatim + Photon, Gqeberha retry, house-number drop, Theescombe bias, and intersection (“corner of X and Y”) pin at the road join.
- Camera registry + rule-based footage suggestions (no live AI).
- **City-wide on purpose** (same as City Hub), not locked to the working area.
- Migrations: `20260815000000_hotspot_events_and_camera_spots.sql` (isolation reverted in `20260815029000`), `20260815038000` (partner/city write), `20260815054000` (cable kinds).

### Billing (manual)
- Platform billing page with org picker, trial/waived/paid/overdue labels, suggested annual fee by local member count.
- **Not** Stripe. **Not** automatic feature cut-off.

### Role-based public signup
- `/register` starts with four buttons: **Resident**, **Patroller**, **Security company**, **Neighborhood Watch**.
- Form fields change by role (residents skip vehicle/car details; security companies collect PSIRA/coverage; watches collect group name/area).
- Privileged roles stay invite-only: investigator, committee, **city admin**, main admin, technical support.
- Security-company signup creates a **`pending` org** and grants `security_admin` immediately — **login is not blocked** on admin verification. Review/activate queue is still pending.
- City admin **cannot** self-register; an existing admin must assign the role.
- Guard so login does not overwrite staff roles to `resident` (`20260815033000_preserve_privileged_roles_on_signup.sql`). If someone is stuck as resident, restore `users.role` (same class of bug as the earlier admin / tech-support demotion).
- Server whitelist + pending org creation: `20260815031000_role_based_signup.sql`.

### Role-specific dashboards (15 Aug evening)
- **Watch home** `/dashboard` tile order: Patrol schedule → View incidents → Hotspots → Leaderboard → SOS board → Vehicles → Guide → About (Admin panel and City Hub stay full-width below).
- **Security company** `/security` — see **Security command (16 Aug)** below (registered watch areas, view-only roster, multi-area SOS, company profile). The 15 Aug partner RPCs remain the base (`20260815038000`).
- **Security insights** `/admin/security-insights` — platform snapshot of **counts only** (residents linked, verified, suburbs, incidents 30d). No resident names. Empty until households link a membership. Used later for partner commercialization, not live patrol ops.
- **City admin / police** `/city-admin` — intelligence, reports, hotspots, City Hub, admin contacts per community.
- Those roles redirect off the patroller dashboard after login. **Residents** land on `/resident`.
- Partner data RPCs: `20260815038000_partner_city_dashboards.sql`. Areas/live patrols need suburb **security assignments**; residents appear when memberships are linked.

### Residents vs watch users
- Registered residents are **not** in User Management or Member profiles.
- Staff list household accounts on `/admin/residents` (contact, address, verification, promote into a watch role).
- User Management is watch / operational accounts only. Demoting someone to resident moves them to the Residents page.
- Watch dashboards do **not** deep-link into resident home except Main admin / Technical support preview from Admin.

### Leaderboard (15 Aug night)
Existing hours ranking, charts, heatmap, and personal stats stay. Enrichment is **client-computed** from `patrol_logs` / `patrol_routes` — no new badge tables or RPCs.
- **This week / This month / All time** tabs (all-time remains the default). Podium is silver–gold–bronze with avatars; **Your standing** shows hours behind the person above.
- Tap a name (or podium card) for that volunteer’s achievements: rank, hours, streak, personality, fun facts, earned badges. Same sheet for yourself.
- **100 badges**: levelled patrols / hours / km / streaks, plus unique awards (Friday the 13th, leap day, 10 fixed-date SA public holidays, before-dawn, double-header, every weekday, winter/summer, Champion for #1). Easter is omitted (movable). Distance badges need a GPS track; other volunteers’ km only show if the viewer can read `patrol_routes`.
- **Did you know:** 101 unique templates, up to 10 shown, **rotating every 2 days** (seeded per volunteer). Other profiles lead with personal habits, not the same distance metaphors. Copy is approximate. Constants are sourced (swift 40 / 112 km/h, FIFA pitch 105 m, JNB–PLZ ~105 min, Addo Main Camp 72 km, Jeffreys Bay ~82 km, East London ~290 km, Cape Town ~752 km). Small landmarks do not crowd out Cape Town-scale totals.
- **Weather facts (18 Aug):** rainy / foggy nights, heat ≥28°C, storms from Open-Meteo hourly history (Johannesburg timezone) plus live area conditions.
- **Mileage facts (18 Aug):** typical loop, week/month km, long/short loops, night km — from GPS tracks (`patrol_routes` + GeoJSON + `patrol_locations`).
- **Fuel calculator (18–19 Aug):** sits under **Patrol Preferences**. Auto estimate = GPS kilometres × typical burn for the volunteer’s vehicle class (signup / Vehicles make-model keyword list; unknown car → average passenger car) × neighbourhood pump price. Week / month / all-time switchers are on the card. **Edit manually** lets the volunteer type km, L/100 km, and R/L (stored on this device). Committee / NW admin / tech can save the area petrol price. Apply `20260818070000` + `20260818071000` on live or save falls back to this device.
- Podium cards on mobile: 2nd/3rd place names wrap; patrol counts are no longer clipped.
- Audit scripts: `platform/web/scripts/audit-leaderboard-achievements.mjs`, `platform/web/scripts/audit-patrol-fuel.mjs`.
- Files: `utils/leaderboardBadges.js`, `utils/leaderboardFunFacts.js`, `utils/volunteerStats.js`, `utils/patrolFuelEstimate.js`, `utils/patrolHistoryRoute.js`, `utils/patrolWeather.js`, `components/leaderboard/VolunteerProfileSheet.jsx`, `components/leaderboard/PatrolFuelCard.jsx`.

### Security command (16 Aug)
Partners **see** neighborhood data; they do not change watch internals. Zones on command are registered `nw_group` orgs, not the security company itself.
- Command home `/security`: assigned **registered watch areas**, area counts, neighborhood residents, approved incidents (same rule as the watch Incident reports page), resident-client list.
- **Roster is view-only** after a short signup experiment — partners can look at scheduled patrols, not rewrite the watch grid (`64000`, `65000`).
- **SOS is multi-area.** The single-neighborhood `/sos` board and `ActiveSosBanner` are the wrong tool for a company that covers several watches. Command has a compact SOS strip in the sidebar and a dedicated **`/security/sos`** (Summary = last 24 hours; pick a neighborhood for full history). `security_admin` hitting `/sos` redirects to `/security/sos`. Apply `20260815073000_security_partner_sos_board.sql`.
- **Company profile** `/security/profile` (cover + logo, Facebook 820×312, control room / email / person in charge). Last name + logo are cached so returning from City Hub does not flash “Security company”.
- Signup: typed company name, city-wide or multi-neighborhood coverage, sample Gqeberha companies plus admin-created companies share one resident dropdown (`59000`–`61000`, `69000`, `70000`).
- Theescombe live coverage + registered-watch-area RPCs so command is not empty when `security_assignments` rows are missing (`62000`, `63000`).
- Migrations: `20260815058000` … `20260815073000` (see apply table).

### Emergency directory (16 Aug)
Shared contacts page for **residents**, **intelligence**, and **admin**:
- Civic numbers (SAPS 10111, ambulance 10177, NMBM fire / electrical / contact centre) plus **every registered security company** as a cover card.
- Routes: `/resident/contacts`, `/intelligence/contacts`, `/admin/contacts`.
- **Create / edit** (main admin, technical support, NW admin): local doctor/clinic as **Medical / doctor**, system icon tiles (Police, Fire, …), or upload logo + cover. Hide without delete.
- Apply `20260815074000_branding_banner_and_emergency_directory.sql`, `20260815075000_emergency_directory_manage.sql`, `20260815076000_emergency_directory_media.sql`.

### Billing (manual, continued)
- Admin can set a **list-price override** per organization (`20260815071000_admin_set_list_price.sql`). Still not Stripe; still no feature cut-off.

### Area broadcasts, away, and household civic (16 Aug)
Neighbourhood notices and household presence — not a second City Hub.
- **Area broadcasts:** paste from WhatsApp; headline + body; 12 hours pinned on Home, then 12 hours in activity, then gone. Realtime insert so the home strip updates without refresh (`20260816002000`, `03000`, `04000`, `20260818030000`).
- **Away:** residents mark the household away; patrol sees who is away (civic / patrol-only).
- **Household civic streaks:** presence ping + compact civic row on resident home and Profile.

### Home pin, My sector, household mode (18 Aug)
Closest-neighbour grouping from a map pin — not yet the full “front / back / left / right” geometry in item 10.
- Every user can set **home_lat / home_lng**. My sector lists the **closest 10** households by pin-to-pin distance. Other people never receive exact coordinates (`20260818040000`, radius `20260818050000`).
- **Household mode** for local watch members (patroller, volunteer, investigator, committee, NW admin): same account, same watch role; their pin is on the sector map. Neighbour vouch lists stay household-only (`20260818060000`).
- Patroller **Verify residents** now treats `users.verified` as verified (fixes Pending when the profile join was hidden) (`20260818061000`).

### Next of kin (18 Aug)
Optional emergency contact: pick a registered neighbour or type a name and phone. Patrollers can load neighbourhood next-of-kin for SOS (`20260818062000` … `20260818068000`).

### Security membership claims (18 Aug)
One primary company per resident; admin/company claim queues; transfer history; insights grouped by neighborhood watch (`20260818001000`, `10000`, `20000`).

### Fuel calculator (18–19 Aug)
See **Leaderboard** above. Neighbourhood petrol price table + RPC so committee can save today’s pump price for the working area. Global admin/tech may save for the selected org (`20260818070000`, `20260818071000`). Apply on live or the slider stays on-device.

---

## Apply on Supabase (ops, not new features)

These files must be applied on the live project if they are not already. The app degrades if they are missing (RPC 404s, old policies, register metadata unused, missing authors / partner dashboards).

| Migration | Purpose |
|---|---|
| `20260815000000_hotspot_events_and_camera_spots.sql` | Hotspots + cameras |
| `20260815010000_scale_multitenant_foundation.sql` | Orgs / residents / hub / billing tables |
| `20260815021000` … `20260815029000` | Platform roles, city hub access, isolation (Hotspots + City Hub stay global) |
| `20260815030000_incident_city_hub_share.sql` | Incident → City Hub share columns |
| `20260815031000_city_hub_share_rls.sql` | Global staff can insert City Hub posts; share RPC |
| `20260815031000_role_based_signup.sql` | Role whitelist, signup profiles, pending partner/watch orgs |
| `20260815032000_city_hub_post_manage.sql` | Edit / archive / delete City Hub posts |
| `20260815033000_preserve_privileged_roles_on_signup.sql` | Do not demote admin / tech / NW admin / etc. on login |
| `20260815034000_city_hub_photos.sql` | City Hub image attachments |
| `20260815035000_city_hub_pdf_attachments.sql` | City Hub PDF attachments |
| `20260815036000_city_hub_author_profiles.sql` | Author contact RPC (first version) |
| `20260815037000_city_hub_authors_for_watch_roles.sql` | Authors visible to NW admin + patrollers |
| `20260815038000_partner_city_dashboards.sql` | Security/city dashboard RPCs + hotspot staff for those roles |
| `20260815039000_resident_signup_area_and_company_lists.sql` | Resident signup area + company pickers |
| `20260815040000_fix_resident_signup_auth_error.sql` | Resident signup auth error fix |
| `20260815041000_resident_verification_vouch.sql` | Staff verify + two-neighbour vouch |
| `20260815042000_resident_neighbour_activity_and_verification_log.sql` | Neighbourhood resident activity feed + verification actor log |
| `20260815043000_sos_patrol_responders.sql` | SOS board access for patrollers; acknowledge / respond |
| `20260815044000_sos_board_list_and_skip_moderation.sql` | SOS board listing RPC; SOS skips incident moderation; still counted |
| `20260815045000_sos_active_means_unresolved.sql` | Active SOS = unresolved on the board (not incident moderation status) |
| `20260815046000_sos_responder_names.sql` | SOS board shows who acknowledged / resolved |
| `20260815047000_sos_neighborhood_name.sql` | SOS board / banner includes neighborhood name after address |
| `20260815048000_sos_history_delete.sql` | Admin / tech / NW admin can delete accidental SOS history |
| `20260815049000_list_resident_neighbours.sql` | Resident neighbour directory (My sector + verify tabs) |
| `20260815050000_incidents_anonymous_tip_column.sql` | incidents.is_anonymous_tip + legal_acknowledged_at |
| `20260815051000_resident_activity_list_access.sql` | Residents can load their own activity reports |
| `20260815052000_resident_report_timeline_events.sql` | Acknowledgement timeline insert + backfill |
| `20260815053000_chat_visibility_channels.sql` | Patrol ops vs neighbour chat rooms, dual unread cursors, SOS stays on patrol |
| `20260815054000_hotspot_cable_theft_kinds.sql` | Hotspot pins: confirmed/attempted cable and infrastructure theft |
| `20260815055000_gqeberha_city_parent.sql` | Seed city Gqeberha (Port Elizabeth); attach all orgs/suburbs under it |
| `20260815056000_sos_board_working_area.sql` | SOS board/banner limited to the working neighborhood (not all orgs) |
| `20260815057000_neighbour_verified_by.sql` | Neighbour directory returns who verified — **applied 16 Aug** |
| `20260815058000_security_partner_command_dashboard.sql` | Partner command: assigned-area incidents + resident labels |
| `20260815059000_sample_gqeberha_security_companies.sql` | Sample Gqeberha security companies for signup / directory |
| `20260815060000_security_signup_typed_company_name.sql` | Security signup: typed company name |
| `20260815061000_security_signup_city_or_multi_coverage.sql` | Security signup: whole-city or selected neighborhoods |
| `20260815062000_security_partner_theescombe_live_coverage.sql` | Partner command can load Theescombe live coverage |
| `20260815063000_security_partner_registered_watch_areas.sql` | Command areas = registered watches, not only assignment rows |
| `20260815064000_security_partner_roster_signup.sql` | Partner roster / scheduled patrols |
| `20260815065000_security_partner_roster_readonly.sql` | Roster view-only for partners |
| `20260815066000_security_partner_area_counts.sql` | Area counts on command |
| `20260815067000_security_partner_neighborhood_residents.sql` | Neighborhood residents on command |
| `20260815068000_security_partner_resident_clients.sql` | Resident clients linked to the partner |
| `20260815069000_signup_lists_include_created_companies.sql` | Resident company dropdown includes admin-created companies |
| `20260815070000_security_company_list_alpha_and_verify.sql` | Company list A–Z + verify |
| `20260815071000_admin_set_list_price.sql` | Admin list-price override (`organizations.annual_fee_zar`) |
| `20260815072000_security_partner_incidents_approved.sql` | Partner incidents = approved only (watch report rule) |
| `20260815073000_security_partner_sos_board.sql` | Multi-area partner SOS board + update RPC |
| `20260815074000_branding_banner_and_emergency_directory.sql` | Company cover/logo/contacts + civic directory + storage |
| `20260815075000_emergency_directory_manage.sql` | Admin / tech / NW admin create-edit contacts (incl. medical) |
| `20260815076000_emergency_directory_media.sql` | Contact logo/cover columns + `emergency-directory` bucket |
| `20260816002000_away_broadcasts_civic.sql` | Away notices + area broadcasts + household civic |
| `20260816003000_area_broadcast_headline.sql` | Broadcast headline + body |
| `20260816004000_area_broadcasts_realtime.sql` | Realtime for area broadcasts |
| `20260818001000_security_membership_review_access.sql` | Admin membership review select |
| `20260818010000_security_membership_one_primary_and_claims.sql` | One primary membership + claim queues |
| `20260818020000_app_notifications_membership.sql` | Membership notification hooks |
| `20260818030000_area_broadcast_home_windows.sql` | 12h home pin / 12h activity / 24h life |
| `20260818040000_home_pin_and_sector.sql` | Home pin + closest-10 sector |
| `20260818050000_sector_radius_1200m.sql` | Sector search radius |
| `20260818060000_household_mode_watch_members.sql` | Watch members can use household/sector |
| `20260818061000_resident_verify_status_for_patrollers.sql` | Patroller verify list shows true verified status |
| `20260818062000` … `20260818068000` | Next-of-kin / emergency contact |
| `20260818070000_organization_petrol_price.sql` | Neighbourhood petrol price for fuel calculator |
| `20260818071000_petrol_price_save_fix.sql` | Idempotent petrol-price save + global staff for selected org |
| `20260401141000_chat_messages_retention_purge.sql` | `run_chat_messages_retention_purge()` — **applied** |
| `sql/schedule_chat_retention_cron.sql` | pg_cron `chat_messages_retention_6mo` jobid **3**, `25 5 * * *` — **confirmed 16 Aug** |

**Note:** two files share the timestamp `20260815031000`. Apply **both** in the SQL editor (they are independent). If you later use `supabase db push` / CLI migrate, rename one timestamp so they do not collide.

After apply: confirm your user has `platform_role = 'platform_owner'` and that Theescombe is the active working organization. Feature screens that already work (SOS board, verify neighbours, City Hub) mean those `20260815*` files are on live. A missing RPC does not take Theescombe offline — the app falls back or toasts “apply SQL”.

---

## Pending (needed before a real second-neighborhood pilot)

Priority is top-down.

### 1. Isolation proof (highest)
- [ ] Two-org test matrix: user in Org A must never read/write Org B **incidents, patrols, chat, intelligence, admin lists, SOS**. City Hub published posts and Hotspots **should** be visible in both. SOS board is already working-area scoped in code (`56000`); still prove it with Lorraine.
- [ ] Finish leftover `DEFAULT_PATROL_ZONE` / Theescombe header fallbacks (`neighborhoodRegions.js`, Dashboard, PatrolSchedule, Leaderboard).
- [ ] City/suburb create UI on Organizations (today suburbs often need SQL seed).
- [ ] Invite/join a neighborhood from the app (residents/patrollers currently wait for staff assignment).

### 2. Resident verification
- [x] Staff verify from Residents (`/admin/residents`): admin, NW admin, or patroller (one click). Apply `20260815041000_resident_verification_vouch.sql`.
- [x] Neighbour vouching: two already-verified households can vouch from **Verify neighbours** (`/resident/neighbours`). The second vouch sets Verified.
- [x] **Who verified** on the neighbour card (staff role + name, or the neighbours who vouched). Same on My sector and admin Residents. Live: `20260815042000` + `20260815057000` (16 Aug).
- [x] Home map pin + **closest 10** sector (`20260818040000`). Exact coordinates are not shared with other households.
- [x] Optional next-of-kin (registered neighbour or typed name/phone). Apply `62000`–`68000`.
- [ ] Proof-of-residence / ID upload and reject / resubmit queue.
- [ ] Do not treat self-reported security membership as verified.

### 3. SOS operational completeness
- [x] SOS is not admin-only: patrollers/volunteers see `/sos`, a live banner on the watch home, and the alert is posted to duty chat. Apply `20260815043000_sos_patrol_responders.sql`.
- [x] SOS board is **working-area only** (Theescombe while that is selected). Global admin/tech no longer see every organization’s alerts. Apply `20260815056000_sos_board_working_area.sql`.
- [x] Split chat into **Patrol ops** (watch only) and **Neighbours** (household ↔ patrol). SOS still lands in patrol ops as critical. Apply `20260815053000_chat_visibility_channels.sql`.
- [x] Patrol can tap **I'm responding** (acknowledge). Admin can still escalate.
- [x] Security partners use **command SOS** (`/security/sos` + sidebar strip), not the single-area `/sos` board. Apply `20260815073000`.
- [x] Optional next-of-kin on the household (neighbour pick or typed contact) for patrol lookup. Apply `20260818062000`+.
- [ ] Full responder lifecycle after acknowledge (responding → resolved) and auto timers.
- [ ] Trusted-contact *confirmation* / notify beyond the stored next-of-kin fields.
- [ ] Post-incident feedback and response-time KPIs.

### 4. City Hub governance
- [x] Sanitized incident share (review before publish).
- [x] One published share per incident; archive/delete frees the lock.
- [x] Edit / archive / delete with Main admin + Technical support full access; NW admin own posts only.
- [x] Photo + PDF attachments; full-image thumbnails; author contact card (including NW admin / patroller).
- [x] System metadata separated from author text; stronger post-card separation.
- [x] Premium banner with live neighborhood / active-alert / published-post counts (same numbers for every role).
- [x] Role-aware back-nav (command / city admin / admin / resident / dashboard).
- [ ] Moderation before publish for high-risk alerts.
- [ ] Legal waiver captured at publish time.
- [ ] Radius / selected-suburb visibility UI **and** RLS enforcement (schema has fields; UI is still mostly city-wide).
- [ ] Second-review for suspect alerts.

### 5. Billing that actually gates
- [ ] Entitlement checks in UI + backend (grace / overdue).
- [ ] Invoice artifacts (PDF/link), not only a status row.
- [ ] Payment provider (Stripe or SA equivalent) — **not started**.
- [ ] Audit trail of fee changes.

### 6. Security-company maturity
- [x] Partner dashboard (areas, live/scheduled patrols, branded resident cards, SOS/incident counts, hotspots).
- [x] Platform **Security insights** snapshot (aggregate counts, no personal data). Empty until memberships are linked.
- [x] Command areas from **registered neighborhood watches** (not only `security_assignments`). Apply `62000` / `63000`.
- [x] Roster **view-only**. Apply `65000`.
- [x] Multi-area SOS board. Apply `73000`.
- [x] Company profile: cover + logo + control-room / email / person in charge (`/security/profile`). Cards on the public emergency directory.
- [x] Admin emergency directory (`/admin/contacts`) for civic + local medical contacts.
- [ ] Proof-of-membership upload + evidence review.
- [ ] Extra colour / card-style packs beyond cover + logo.
- [ ] Consent before any resident-level partner visibility.
- [ ] Time-series KPIs (insights page is a snapshot).
- [ ] Activate/merge **pending** companies created at signup (login is **not** blocked today).

### 7. Signup / onboarding follow-through
- [ ] After register, place residents/patrollers into the requested suburb/org (today neighborhood is stored as text/notes).
- [ ] Platform queue for pending security companies and new watch groups.
- [ ] Update user-facing role guide (`USER_GUIDE_ROLES_AND_ACCESS.md`) — it still says members cannot pick a role at signup.

### 8. Compliance / hardening
- [x] Chat 180-day purge scheduled on live pg_cron (`chat_messages_retention_6mo`, jobid 3, 05:25 UTC).
- [ ] Org-scoped storage paths for media and resident documents.
- [ ] Structured audit log for high-risk admin actions (delete user, role change, share to hub, hub delete).
- [ ] Retention jobs for SOS, memberships, city hub artifacts (chat only so far).
- [ ] Tenant-isolation regression checklist before every production deploy.

### 9. Role-specific dashboards
Each of these should land on its own home, not a trimmed copy of the patroller dashboard.
- [x] **Security company dashboard** (`/security`) — assigned registered watch areas, live patrols (map when GPS exists) + patroller details, view-only roster, residents, approved incidents, **multi-area SOS** (`/security/sos`), hotspots, company profile. Apply `20260815038000` plus `58000`–`73000`.
- [x] **City admin / police dashboard** (`/city-admin`) — intelligence, reports, hotspots, City Hub, and admin contacts for each community.
- [x] **Resident dashboard** (`/resident`) — **households only** after login: hold-to-SOS, activity reports, neighbourhood feed, verified badge vs unverified notice, Verify neighbours, My sector (**home pin + closest 10**), security membership, **Emergency contacts**, area broadcasts, away. Main admin / Technical support may preview from Admin (**View resident home** + **Back to admin**). Full front/back/left/right packing (8–10 houses) is not in this home yet.
- [x] Keep **residents out of User Management**. Registered residents are on `/admin/residents`. User Management and Member profiles list watch / operational accounts only.

### 10. Smart resident sectors (no paid AI)
Group nearby households into a **sector** from a home pin (not typed house numbers). **Possible without paid AI**.

Shipped (18 Aug):
- [x] Store `home_lat` / `home_lng` when the household drops a pin.
- [x] My sector = closest 10 by pin distance (other households never get exact coordinates). Apply `20260818040000` / `50000`.
- [x] Watch members can join household/sector mode without dropping their patrol role (`20260818060000`).

Still later:
- [ ] Infer **front** as the direction toward the nearest street centreline; **left/right** perpendicular; **back** opposite. Building footprints (OSM) improve this.
- [ ] Pack to 8–10 with merge/split and admin override for a wrong plot.
- [ ] POPIA: keep sectors operational only; do not expose other residents’ exact addresses (already true for the closest-10 list).

---

## Later (after 2–3 neighborhoods are stable)

- Paid security-company product (SLA dashboards, contracted suburb assignments).
- Adoption dashboards (WAU residents vs patrollers, SOS SLA, verification conversion).
- Resident adoption metrics (WAU, verification conversion) once more neighborhoods are live.
- Smart resident sectors (8–10 households from geocoded address + street heading; no paid AI).
- Operational runbooks (false SOS, support, new-NW checklist).
- iOS Capacitor spike (Android APK is the current native path).
- Duplicate-root cleanup if any leftover `src/` / `web/` trees still confuse deploys.

---

## Suggested next sprint (concrete order)

Housekeeping for who-verified + chat purge cron is **done** (16 Aug). Command SOS, branding, emergency directory, City Hub banner, area broadcasts, home pin/sector, next of kin, and the leaderboard **fuel calculator** are **in code**. Apply `58000`–`76000` plus `20260816*` / `20260818*` on live if those screens toast missing SQL (petrol price save needs `70000`/`71000`).

Next:

1. Two-org isolation test (Theescombe vs Lorraine): neighborhood pages empty in Lorraine; City Hub + Hotspots still shared.
2. Remove remaining hardcoded Theescombe display/map fallbacks.
3. Place new residents/patrollers into the requested suburb/org from signup (not notes-only).
4. Pending-org review queue for security-company and watch signups (activate `pending` companies; optionally gate partner dashboard until approved).
5. SOS Theescombe polish: optional On scene stamp, server `tick_sos_escalations()` on the **same** pg_cron (L1/L2/L3), board SLA strip. Do not use a client countdown.

Proof-of-residence / ID upload is **not** on this sprint — verification by staff or two neighbours is enough for a second-area pilot.

Do **not** turn on paid security-company access until isolation tests pass and at least two neighborhoods are running.

---

## Original phase map (for reference)

| Phase | Original intent | Status now | ~Done |
|---|---|---|---|
| 0 Stabilize architecture | Canonical `platform/web` + `platform/supabase` | Done enough to keep building here | **95%** |
| 1 Multi-neighborhood foundation | Orgs, RLS, onboarding | **Mostly done** — isolation test + suburb UI still open | **80%** |
| 2 Resident MVP | Home, SOS, report, verification | **Household home + vouch + who-verified + pin/sector + next of kin shipped** — SOS resolve lifecycle + ID upload still open | **82%** |
| 3 City Hub MVP | Cross-NW intel | **Share + manage + attachments + authors + feed styling + banner done** — pre-publish governance open | **75%** |
| 4 NW subscription | Annual fee + entitlements | **Manual billing + list-price override done** — payments/gates open | **30%** |
| 5 Security-company layer | Membership + partner analytics | **Command + branding + directory + multi-area SOS done** — pending-org review + commercial product open | **55%** |
| 5b City admin / police | City-wide briefing home | **Dashboard shipped** (`/city-admin`) | **80%** |
| Pilots | 2–5 neighborhoods | **Not started** | **0%** |

---

## Role cheat sheet (current product)

**Public self-signup:** resident, patroller, security company (`security_admin` + **pending** org; can log in immediately), neighborhood watch (`nw_admin` + pending org).

**Invite / assign only:** investigator, committee, **city admin**, main admin, technical support.

**Platform (your business):** `platform_owner`, `platform_ops`, `platform_support` — not the same as neighborhood `admin`.

**City Hub manage:** Main admin / Technical support = any post. NW admin = only posts they published or shared.

**City Hub authors:** name + contact card for City Hub viewers (including NW admin and patrollers). Apply `36000` + `37000`.

**Homes:** resident → `/resident` (households only). security company → `/security` (SOS → `/security/sos`; profile → `/security/profile`). City admin / police → `/city-admin`. Watch members → `/dashboard`. Main admin / Technical support may preview `/resident` from Admin. Emergency contacts: `/resident/contacts`, `/intelligence/contacts`, `/admin/contacts`.

**Security vs city admin:** security admin = private security partner (no patrols; view intel; hotspot write). City admin = municipal / police coordination (no patrols; moderate incidents + intel; city-wide briefing home).
