-- P1 (2/2) - Auto-revoke capability grants when a member leaves a neighbourhood.
-- NEW_FEATURES_BLUEPRINT section 6.8 ("Resident moves neighbourhood").
--
-- Purely additive: one new internal function + two new triggers. It only stamps
-- revoked_at / revoked_by / revoke_reason on grants for an org the user is no
-- longer in (it never deletes rows), and only when users.organization_id changes
-- or an organization_members row is removed / deactivated. Existing grants for
-- users who stay in their org are untouched.
--
-- has_org_capability already ignores grants outside current_org_ids(), so this
-- is belt-and-braces: it stops a lapsed grant coming back if the person returns.

CREATE OR REPLACE FUNCTION public.revoke_capabilities_outside_org(p_user_id uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
  n integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;
  FOR g IN
    SELECT cg.id, cg.organization_id, cg.capability
    FROM public.org_capability_grants cg
    WHERE cg.user_id = p_user_id
      AND cg.revoked_at IS NULL
      AND NOT public.user_in_org(p_user_id, cg.organization_id)
    FOR UPDATE
  LOOP
    UPDATE public.org_capability_grants
    SET revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason
    WHERE id = g.id;
    n := n + 1;

    PERFORM public.write_staff_activity(
      'capability_revoked',
      jsonb_build_object('grant_id', g.id, 'target_user_id', p_user_id,
                         'capability', g.capability, 'reason', p_reason, 'automatic', true),
      coalesce(auth.uid(), p_user_id),
      g.organization_id
    );
  END LOOP;

  IF n > 0 THEN
    PERFORM public.notify_app_user(p_user_id, 'capability', 'A responsibility was removed',
      'You moved neighbourhood, so your street rep / moderator role in the old one ended.', '/profile');
  END IF;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_users_capability_auto_revoke()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    PERFORM public.revoke_capabilities_outside_org(NEW.id, 'moved neighbourhood');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_org_members_capability_auto_revoke()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.revoke_capabilities_outside_org(OLD.user_id, 'moved neighbourhood');
    RETURN OLD;
  END IF;
  IF OLD.status = 'active' AND NEW.status IS DISTINCT FROM 'active' THEN
    PERFORM public.revoke_capabilities_outside_org(NEW.user_id, 'moved neighbourhood');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_capability_auto_revoke_on_move ON public.users;
CREATE TRIGGER zzz_capability_auto_revoke_on_move
  AFTER UPDATE OF organization_id ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_users_capability_auto_revoke();

DROP TRIGGER IF EXISTS zzz_capability_auto_revoke_on_leave ON public.organization_members;
CREATE TRIGGER zzz_capability_auto_revoke_on_leave
  AFTER DELETE OR UPDATE OF status ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_org_members_capability_auto_revoke();

-- Internal only.
REVOKE ALL ON FUNCTION public.revoke_capabilities_outside_org(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_capabilities_outside_org(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.trg_users_capability_auto_revoke() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_users_capability_auto_revoke() TO service_role;
REVOKE ALL ON FUNCTION public.trg_org_members_capability_auto_revoke() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_org_members_capability_auto_revoke() TO service_role;

-- Verification (read-only):
--   SELECT tgname FROM pg_trigger WHERE tgname LIKE 'zzz_capability_auto_revoke%';  -- 2 rows
--   SELECT count(*) FROM public.org_capability_grants WHERE revoked_at IS NULL;      -- unchanged by applying