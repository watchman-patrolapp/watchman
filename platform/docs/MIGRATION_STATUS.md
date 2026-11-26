# Migration status

Production Supabase migrations are applied by hand in the SQL editor, not through `supabase db push`. This file is the record of what is live. Every new migration must receive a row here when it is run live, as part of the release checklist.

## November 2026 migrations

| File | What it does | Live? | Date run |
|---|---|---|---|
| `20261101010000_patrol_share.sql` | Adds patrol sign-on/sign-off WhatsApp share references and tracking. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261101020000_equipment_catalogue.sql` | Creates the organisation-scoped equipment catalogue, ledger, QR resolution, and member reads. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261101021000_equipment_admin.sql` | Adds equipment item/gallery administration, kit contents, labels, and richer views. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261101030000_equipment_borrowing.sql` | Adds equipment requests, loans, transfers, issues, training, reminders, and notifications. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261101040000_equipment_desk_fixes.sql` | Fixes equipment return/transfer handling and administrator unit-status controls. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261104100000_rls_tenant_isolation_intelligence.sql` | Closes remaining tenant-isolation gaps in intelligence child tables, incident updates, and feedback. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261104120000_leaderboard_patrol_stats.sql` | Adds organisation-scoped leaderboard patrol aggregates and indexes. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261105120000_storage_policies_consolidated.sql` | Restates the surviving Storage object policies after earlier migrations. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106180000_equipment_custody_handover.sql` | Adds equipment hand-over codes and mutual transfer confirmation. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106180100_equipment_custody_desk.sql` | Adds equipment theft cases, write-offs, liability, maintenance, and overdue reminders. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106180200_equipment_custody_cron.sql` | Adds equipment overdue escalation and service-role housekeeping support. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106180300_equipment_custody_reads.sql` | Adds member reads for equipment hand-overs and theft reports. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106190000_equipment_custody_columns.sql` | Repairs missing equipment custody transfer columns and constraints. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106191000_equipment_custody_functions.sql` | Recreates and repairs P3c custody functions, tables, and read policies. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106200000_equipment_reporting_schema.sql` | Adds stocktake, paper hand-over claims, offline idempotency, and ledger-event schema. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106201000_equipment_stocktake.sql` | Adds organisation stocktakes, holder confirmation, discrepancy recording, and finalisation. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106202000_equipment_dashboard_export.sql` | Adds equipment custodian dashboard, member overview, and ledger export. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106203000_equipment_offline_actions.sql` | Makes selected equipment returns, issue reports, and hand-overs offline-idempotent. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106210000_private_media_read_policies_and_copy_registry.sql` | Adds private-media read controls and City Hub copy registry. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106215000_private_media_store_paths.sql` | Rewrites stored media references from URLs to Storage paths. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261106220000_flip_incident_community_city_hub_buckets_private.sql` | Makes incident, community, and City Hub media buckets private after prerequisites. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261107010000_camera_spots_own_area.sql` | Limits camera-spot access to a member's area and authorised partners/staff. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261107020000_private_media_keep_unparsed_entries.sql` | Preserves unparseable media entries during path rewriting. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261111010000_android_auto_car_dashboard.sql` | Adds Android Auto server support and car-dashboard data. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261112010000_android_auto_car_dashboard_polish.sql` | Polishes Android Auto dashboard data and functions. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261112140000_local_services_taxonomy.sql` | Adds local-services taxonomy, categories, synonyms, policies, and seed data. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261112141000_local_services_listings_search.sql` | Adds local-service listings, search, triggers, and RPCs. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261112141500_local_services_fixes.sql` | Fixes local-services search, listing pause, and moderation behavior. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261112142000_local_services_reviews.sql` | Adds local-service reviews, reports, and moderation. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261113010000_home_widgets.sql` | Adds Android home-widget snapshots and SOS support. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261117010000_ugc_reports_posts_chat_users.sql` | Adds in-context reports for City Hub posts, chat messages, and user profiles. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261117020000_criminal_profiles_role_gate.sql` | Restricts criminal-profile reads and creation to intelligence roles. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261117030000_city_hub_suspect_alert_cross_watch.sql` | Shares City Hub suspect alerts between watches in the same city. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261117040000_city_hub_photos_role_lock.sql` | Restricts City Hub photos and PDFs to City Hub post readers. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261118010000_ugc_reports_incidents_suspects.sql` | Adds reports for incidents and suspect profiles. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261118020000_incidents_resident_read_lock.sql` | Prevents residents reading other residents' incidents and incident photos. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261118030000_incident_evidence_profile_incidents_lock.sql` | Locks incident evidence, profile links, and acknowledgements to incident viewers. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261118040000_incident_suspects_lock.sql` | Locks incident-suspect links to watch roles. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261119010000_incident_evidence_keep_submitter.sql` | Preserves original evidence submitters when incidents are edited. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261120010000_user_blocks.sql` | Adds member blocking for chat messages and general City Hub posts. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261121010000_terms_acceptance.sql` | Adds current-version Terms and Privacy acceptance records and gate RPC. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261122010000_app_config_min_version.sql` | Adds server-configured minimum Android version support. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261122020000_analytics_foundation.sql` | Adds global analytics KPIs, watch table, and app-version reporting. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261122030000_analytics_phase3.sql` | Adds distance fixes and analytics Patrols, Safety, People, and Community sections. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261122040000_analytics_names.sql` | Shows full profile names for top patrollers in analytics. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261122050000_analytics_phase4.sql` | Adds resident, local-services, security, and activity-day analytics. | Live (assumed, applied before 2026-11-23) | Before 2026-11-23 (assumed) |
| `20261123010000_signup_admin_gate.sql` | Converts Watch and security sign-ups into reviewed admin requests. | Live | 2026-11-23 |
| `20261123020000_retire_city_admin.sql` | Retires the `city_admin` role and removes its permissions. | Live | 2026-11-23 |
| `20261123030000_sa_places_schema.sql` | Adds South African places schema, aliases, normalised search, and indexes. | Live | 2026-11-23 |
| `20261123040101_sa_places_seed_01.sql` | Loads SA places seed 01 of 07 from GeoNames. | Live | 2026-11-23 |
| `20261123040102_sa_places_seed_02.sql` | Loads SA places seed 02 of 07 from GeoNames. | Live | 2026-11-23 |
| `20261123040103_sa_places_seed_03.sql` | Loads SA places seed 03 of 07 from GeoNames. | Live | 2026-11-23 |
| `20261123040104_sa_places_seed_04.sql` | Loads SA places seed 04 of 07 from GeoNames. | Live | 2026-11-23 |
| `20261123040105_sa_places_seed_05.sql` | Loads SA places seed 05 of 07 from GeoNames. | Live | 2026-11-23 |
| `20261123040106_sa_places_seed_06.sql` | Loads SA places seed 06 of 07 from GeoNames. | Live | 2026-11-23 |
| `20261123040107_sa_places_seed_07.sql` | Loads SA places seed 07 of 07 from GeoNames. | Live | 2026-11-23 |
| `20261126010000_sa_places_search.sql` | Adds city search, the watch list for a city, suburb suggestions, and suburb or watch requests. | Live | 2026-11-26 |
| `20261126020000_sa_places_review.sql` | Extends the approval queue with resident requesters, possible duplicates, merge into an existing watch, and watch join requests. | Live | 2026-11-26 |
| `20261126030000_sa_places_profile.sql` | Adds a saved home city, `my_home_area`, `set_my_home_city`, and `switch_my_watch`. | Live | 2026-11-26 |
| `20261126040000_sa_places_city_defaults.sql` | Makes the default city caller-based, keeps an explicit city, applies the sign-up city, and lists contacts with city and suburb. | Live | 2026-11-26 |

All 7 SA places seed chunks (12,162 places) were verified live as of 2026-11-26.

## Edge functions

- `notify-chat-message` deployed 2026-11-23.
- `delete-my-account` and `admin-delete-user` deployed 2026-11-23 (PR #83).

Older migrations, before November 2026, were applied earlier; see [MIGRATION_VERSION_REPAIR.md](MIGRATION_VERSION_REPAIR.md).
