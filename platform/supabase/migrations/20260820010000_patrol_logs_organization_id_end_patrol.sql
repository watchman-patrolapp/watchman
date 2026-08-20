-- Backfill null organization_id on patrol logs / active patrols, and ensure
-- end_patrol always stamps an org UUID (from active patrol, user profile, or Theescombe).
-- Note: patrol_logs.user_id / active_patrols.user_id may be text or uuid — resolve uses text.

CREATE OR REPLACE FUNCTION public.resolve_theescombe_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.organizations
  WHERE type = 'nw_group'
    AND (
      lower(trim(name)) = 'theescombe'
      OR lower(trim(name)) LIKE 'theescombe%neighborhood%watch%'
      OR lower(trim(name)) LIKE 'theescombe%neighbourhood%watch%'
    )
  ORDER BY
    CASE
      WHEN lower(trim(name)) = 'theescombe' THEN 0
      WHEN lower(trim(name)) LIKE 'theescombe%neighborhood%watch%' THEN 1
      ELSE 2
    END,
    created_at ASC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_theescombe_organization_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_theescombe_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_theescombe_organization_id() TO service_role;

-- Drop earlier uuid overload if a partial apply created it.
DROP FUNCTION IF EXISTS public.resolve_patrol_organization_id(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.resolve_patrol_organization_id(uuid, text, text);

CREATE OR REPLACE FUNCTION public.resolve_patrol_organization_id(
  p_organization_id uuid,
  p_user_id text,
  p_zone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid := p_organization_id;
  uid uuid;
  zone_key text;
BEGIN
  IF org_id IS NOT NULL THEN
    RETURN org_id;
  END IF;

  BEGIN
    uid := nullif(trim(p_user_id), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    uid := NULL;
  END;

  IF uid IS NOT NULL THEN
    SELECT u.organization_id INTO org_id
    FROM public.users u
    WHERE u.id = uid;
    IF org_id IS NOT NULL THEN
      RETURN org_id;
    END IF;
  END IF;

  BEGIN
    org_id := public.working_organization_id();
  EXCEPTION WHEN undefined_function THEN
    org_id := NULL;
  END;
  IF org_id IS NOT NULL THEN
    RETURN org_id;
  END IF;

  zone_key := lower(trim(coalesce(p_zone, '')));
  IF zone_key <> '' THEN
    SELECT o.id INTO org_id
    FROM public.organizations o
    WHERE o.type = 'nw_group'
      AND (
        lower(trim(o.name)) = zone_key
        OR lower(trim(o.name)) = regexp_replace(zone_key, '\s+(neighbourhood|neighborhood)\s+watch$', '', 'i')
        OR lower(trim(o.name)) LIKE zone_key || '%'
      )
    ORDER BY
      CASE WHEN lower(trim(o.name)) = zone_key THEN 0 ELSE 1 END,
      length(o.name)
    LIMIT 1;
    IF org_id IS NOT NULL THEN
      RETURN org_id;
    END IF;
  END IF;

  IF zone_key = '' OR zone_key LIKE 'theescombe%' OR zone_key = 'zone a' OR zone_key = 'unknown' THEN
    RETURN public.resolve_theescombe_organization_id();
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_patrol_organization_id(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_patrol_organization_id(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_patrol_organization_id(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Backfill existing nulls (Sven / Hannes and any others)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patrol_logs' AND column_name = 'organization_id'
  ) THEN
    UPDATE public.patrol_logs pl
    SET organization_id = public.resolve_patrol_organization_id(
      pl.organization_id,
      pl.user_id::text,
      pl.zone::text
    )
    WHERE pl.organization_id IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'active_patrols' AND column_name = 'organization_id'
  ) THEN
    UPDATE public.active_patrols ap
    SET organization_id = public.resolve_patrol_organization_id(
      ap.organization_id,
      ap.user_id::text,
      ap.zone::text
    )
    WHERE ap.organization_id IS NULL;
  END IF;
END $$;

-- Stamp org from the patroller when working_organization_id() is unset (service role / auto-end).
CREATE OR REPLACE FUNCTION public.stamp_working_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    BEGIN
      NEW.organization_id := public.working_organization_id();
    EXCEPTION WHEN undefined_function THEN
      NEW.organization_id := NULL;
    END;
  END IF;

  IF NEW.organization_id IS NULL
     AND TG_TABLE_NAME IN ('patrol_logs', 'active_patrols') THEN
    NEW.organization_id := public.resolve_patrol_organization_id(
      NULL,
      NEW.user_id::text,
      NEW.zone::text
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- end_patrol: always copy organization_id into patrol_logs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.end_patrol(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  patrol public.active_patrols%ROWTYPE;
  end_at timestamptz := now();
  duration_mins integer;
  org_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'you can only end your own patrol';
  END IF;

  SELECT * INTO patrol
  FROM public.active_patrols
  WHERE user_id::text = p_user_id::text
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active patrol';
  END IF;

  duration_mins := GREATEST(
    1,
    floor(extract(epoch FROM (end_at - patrol.start_time)) / 60.0)::integer
  );

  org_id := public.resolve_patrol_organization_id(
    patrol.organization_id,
    patrol.user_id::text,
    patrol.zone::text
  );

  INSERT INTO public.patrol_logs (
    user_id,
    user_name,
    start_time,
    end_time,
    duration_minutes,
    zone,
    organization_id,
    auto_closed,
    admin_ended,
    vehicle_make_model,
    vehicle_reg,
    vehicle_color
  )
  VALUES (
    patrol.user_id,
    patrol.user_name,
    patrol.start_time,
    end_at,
    duration_mins,
    coalesce(nullif(trim(patrol.zone), ''), 'Theescombe'),
    org_id,
    false,
    false,
    patrol.vehicle_make_model,
    patrol.vehicle_reg,
    coalesce(nullif(trim(patrol.vehicle_color), ''), 'gray')
  );

  DELETE FROM public.active_patrols
  WHERE user_id::text = p_user_id::text;
END;
$$;

REVOKE ALL ON FUNCTION public.end_patrol(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_patrol(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_patrol(uuid) TO service_role;

COMMENT ON FUNCTION public.end_patrol(uuid) IS
  'End the caller''s active patrol and insert a patrol_logs row with organization_id resolved.';
