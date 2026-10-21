# SQL conventions

Rules for every new migration in `platform/supabase/migrations`. The grant rules and the SECURITY DEFINER checklist come from `NEW_FEATURES_BLUEPRINT.md` §4.5 and §12.7. Copy the checklist into the PR description when a migration adds or replaces a SECURITY DEFINER function.

`20260820080000_advisor_rpc_harden.sql` revoked `PUBLIC` and `anon` once. New functions receive `EXECUTE` for `PUBLIC` again, so each migration repeats the grants below.

## Grant convention

1. Every new or replaced function: `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon`.
2. Client-callable RPCs: `GRANT EXECUTE ON FUNCTION … TO authenticated, service_role`.
3. Internal helpers (trigger functions, cron jobs, recompute, `notify_*`, `user_has_org_capability`, `user_in_org`, and the same kind of helper): `REVOKE ALL … FROM authenticated` and `GRANT EXECUTE … TO service_role` only.
4. Tables whose writes go through RPCs: `REVOKE INSERT, UPDATE, DELETE ON … FROM anon, authenticated`. Leave RLS enabled. Do not add a client write policy for those tables.
5. Every SECURITY DEFINER function has `SET search_path = public` (add `extensions` only when it calls `digest` or `gen_random_bytes`). It starts with `IF auth.uid() IS NULL THEN RAISE EXCEPTION …`. It takes the organisation from the **row being acted on**, not from a client parameter alone, and checks that id `IN (SELECT public.current_org_ids())`.
6. Never trust a client-supplied `organization_id`, `user_id`, an amount that is already confirmed, or a storage path. Re-derive them, or validate the path prefix.

`public.users` is not covered by rule 4. Profile, avatar, SOP acceptance, and staff role changes are still direct client updates. `20261022001000_users_privilege_guard.sql` is the control. Do not revoke `UPDATE` on `public.users` until those writes move to RPCs.

## Triggers that branch on `current_user`

`current_user` inside a SECURITY DEFINER function is the function owner, not the session role. A guard that must treat `authenticated` and `anon` differently from `service_role` or the migration role has to be **SECURITY INVOKER** with `SET search_path = public`. SECURITY DEFINER RPCs then show up as their owner and pass through. Checks that read past RLS (`user_in_org` and the same kind of helper) stay SECURITY DEFINER and are called from the invoker trigger. Do not grant `user_in_org` back to `authenticated`.

Put that helper call in its own `IF`. In PL/pgSQL a function written in the same `AND` list can run even when an earlier comparison is false, so a profile save would call it on every update.

## Org isolation

Derive `organization_id` from the row. Check it with `IN (SELECT public.current_org_ids())`. A cross-org failure raises `not found`. It does not raise `forbidden`, so a caller cannot tell a hidden row from a missing one.

Role values stay `text` plus `CHECK`. Normalise with `replace(lower(trim(role::text)), '-', '_')`. `DROP POLICY IF EXISTS` before `CREATE POLICY`. Store South African civil time with `timezone('Africa/Johannesburg', now())`.

## SECURITY DEFINER checklist

- [ ] `SET search_path = public` (plus `extensions` only if needed). No dynamic SQL built from parameters.
- [ ] `auth.uid() IS NULL` raises.
- [ ] The org comes from the row being acted on, and it is checked `IN (SELECT public.current_org_ids())`.
- [ ] The capability check passes that org explicitly (`has_org_capability(cap, org)`, `can_manage_*(org)`).
- [ ] Separation of duties where custody is involved (not your own loan, return, or write-off).
- [ ] `REVOKE ALL … FROM PUBLIC, anon`, then grant only what is needed.
- [ ] Cross-org failure message is `not found`.
- [ ] An audit row is written for high-risk actions.
