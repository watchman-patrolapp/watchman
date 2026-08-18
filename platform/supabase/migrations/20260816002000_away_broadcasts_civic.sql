-- Resident away (patrol-only), area broadcasts, and private household civic streaks.

-- ---------------------------------------------------------------------------
-- Area broadcasts (paste from WhatsApp)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.area_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.users (id) ON DELETE SET NULL,
  headline text NOT NULL DEFAULT '',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS area_broadcasts_org_created_idx
  ON public.area_broadcasts (organization_id, created_at DESC);

ALTER TABLE public.area_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_post_area_broadcast()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_app_staff()
    OR public.is_platform_staff()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND replace(lower(trim(cu.role::text)), '-', '_') IN (
          'admin',
          'technical_support',
          'nw_admin',
          'committee'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_post_area_broadcast() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_post_area_broadcast() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_post_area_broadcast() TO service_role;

DROP POLICY IF EXISTS area_broadcasts_select_org ON public.area_broadcasts;
CREATE POLICY area_broadcasts_select_org ON public.area_broadcasts
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    OR public.is_global_app_staff()
    OR public.is_platform_staff()
  );

DROP POLICY IF EXISTS area_broadcasts_insert_authors ON public.area_broadcasts;
CREATE POLICY area_broadcasts_insert_authors ON public.area_broadcasts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_post_area_broadcast()
    AND author_id = auth.uid()
    AND organization_id IN (SELECT public.current_org_ids())
  );

DROP FUNCTION IF EXISTS public.post_area_broadcast(text);
CREATE OR REPLACE FUNCTION public.post_area_broadcast(p_headline text, p_body text)
RETURNS public.area_broadcasts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
  row_out public.area_broadcasts;
  cleaned_headline text;
  cleaned_body text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.can_post_area_broadcast() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  cleaned_headline := trim(p_headline);
  cleaned_body := trim(p_body);
  IF cleaned_headline = '' THEN
    RAISE EXCEPTION 'headline is required';
  END IF;
  IF char_length(cleaned_headline) > 120 THEN
    RAISE EXCEPTION 'headline is too long';
  END IF;
  IF cleaned_body = '' THEN
    RAISE EXCEPTION 'message is required';
  END IF;
  IF char_length(cleaned_body) > 4000 THEN
    RAISE EXCEPTION 'message is too long';
  END IF;

  SELECT public.working_organization_id() INTO org_id;

  IF org_id IS NULL THEN
    SELECT o.id INTO org_id
    FROM public.organizations o
    WHERE o.id IN (SELECT public.current_org_ids())
    ORDER BY o.name
    LIMIT 1;
  END IF;

  IF org_id IS NULL THEN
    RAISE EXCEPTION 'no neighbourhood selected';
  END IF;

  INSERT INTO public.area_broadcasts (organization_id, author_id, headline, body)
  VALUES (org_id, auth.uid(), cleaned_headline, cleaned_body)
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;

REVOKE ALL ON FUNCTION public.post_area_broadcast(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_area_broadcast(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_area_broadcast(text, text) TO service_role;

DROP FUNCTION IF EXISTS public.list_area_broadcasts(integer);
CREATE OR REPLACE FUNCTION public.list_area_broadcasts(p_limit integer DEFAULT 8)
RETURNS TABLE (
  id uuid,
  headline text,
  body text,
  created_at timestamptz,
  expires_at timestamptz,
  author_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    coalesce(nullif(trim(b.headline), ''), 'Neighbourhood notice'),
    b.body,
    b.created_at,
    b.expires_at,
    coalesce(nullif(trim(u.full_name), ''), 'Neighbourhood watch')
  FROM public.area_broadcasts b
  LEFT JOIN public.users u ON u.id = b.author_id
  WHERE b.organization_id = public.working_organization_id()
    AND b.expires_at > now()
  ORDER BY b.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 8), 30));
$$;

REVOKE ALL ON FUNCTION public.list_area_broadcasts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_area_broadcasts(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_area_broadcasts(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- We're away — visible to patrol / watch staff only
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resident_away_periods (
  user_id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resident_away_periods_range CHECK (ends_on >= starts_on)
);

ALTER TABLE public.resident_away_periods ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_view_households_away()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_app_staff()
    OR public.is_platform_staff()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND replace(lower(trim(cu.role::text)), '-', '_') IN (
          'patroller',
          'volunteer',
          'investigator',
          'committee',
          'nw_admin',
          'admin',
          'technical_support'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_households_away() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_households_away() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_households_away() TO service_role;

DROP POLICY IF EXISTS resident_away_select_self_or_patrol ON public.resident_away_periods;
CREATE POLICY resident_away_select_self_or_patrol ON public.resident_away_periods
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      public.can_view_households_away()
      AND organization_id IN (SELECT public.current_org_ids())
    )
  );

DROP POLICY IF EXISTS resident_away_write_self ON public.resident_away_periods;
CREATE POLICY resident_away_write_self ON public.resident_away_periods
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_resident_away(
  p_starts_on date,
  p_ends_on date,
  p_note text DEFAULT NULL
)
RETURNS public.resident_away_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
  row_out public.resident_away_periods;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_starts_on IS NULL OR p_ends_on IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required';
  END IF;
  IF p_ends_on < p_starts_on THEN
    RAISE EXCEPTION 'end date must be on or after the start date';
  END IF;
  IF p_ends_on < (timezone('Africa/Johannesburg', now()))::date THEN
    RAISE EXCEPTION 'end date cannot be in the past';
  END IF;

  SELECT u.organization_id INTO org_id FROM public.users u WHERE u.id = auth.uid();
  IF org_id IS NULL THEN
    SELECT o.id INTO org_id
    FROM public.organizations o
    WHERE o.id IN (SELECT public.current_org_ids())
    LIMIT 1;
  END IF;

  INSERT INTO public.resident_away_periods (
    user_id, organization_id, starts_on, ends_on, note, updated_at
  )
  VALUES (
    auth.uid(),
    org_id,
    p_starts_on,
    p_ends_on,
    nullif(trim(p_note), ''),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    organization_id = EXCLUDED.organization_id,
    starts_on = EXCLUDED.starts_on,
    ends_on = EXCLUDED.ends_on,
    note = EXCLUDED.note,
    updated_at = now()
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;

REVOKE ALL ON FUNCTION public.set_resident_away(date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_resident_away(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_resident_away(date, date, text) TO service_role;

CREATE OR REPLACE FUNCTION public.clear_resident_away()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  DELETE FROM public.resident_away_periods WHERE user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.clear_resident_away() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_resident_away() TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_resident_away() TO service_role;

CREATE OR REPLACE FUNCTION public.list_households_away()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  street_label text,
  starts_on date,
  ends_on date,
  note text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.can_view_households_away() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    a.user_id,
    u.full_name,
    public.resident_street_label(coalesce(nullif(trim(rp.home_address), ''), u.address)),
    a.starts_on,
    a.ends_on,
    a.note
  FROM public.resident_away_periods a
  JOIN public.users u ON u.id = a.user_id
  LEFT JOIN public.resident_profiles rp ON rp.user_id = a.user_id
  WHERE a.ends_on >= (timezone('Africa/Johannesburg', now()))::date
    AND a.organization_id = public.working_organization_id()
  ORDER BY a.starts_on, u.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_households_away() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_households_away() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_households_away() TO service_role;

-- ---------------------------------------------------------------------------
-- Private household civic (streak + badges). Never exposed to neighbours.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resident_household_stats (
  user_id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  last_open_on date,
  streak_days integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.resident_household_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resident_household_stats_self ON public.resident_household_stats;
CREATE POLICY resident_household_stats_self ON public.resident_household_stats
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.ping_resident_presence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today date;
  prev date;
  streak integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  today := (timezone('Africa/Johannesburg', now()))::date;

  SELECT last_open_on, streak_days
    INTO prev, streak
  FROM public.resident_household_stats
  WHERE user_id = auth.uid();

  IF prev IS NULL THEN
    streak := 1;
  ELSIF prev = today THEN
    streak := coalesce(streak, 1);
  ELSIF prev = today - 1 THEN
    streak := coalesce(streak, 0) + 1;
  ELSE
    streak := 1;
  END IF;

  INSERT INTO public.resident_household_stats (user_id, last_open_on, streak_days, updated_at)
  VALUES (auth.uid(), today, streak, now())
  ON CONFLICT (user_id) DO UPDATE
  SET
    last_open_on = today,
    streak_days = EXCLUDED.streak_days,
    updated_at = now();

  RETURN jsonb_build_object('streak_days', streak, 'last_open_on', today);
END;
$$;

REVOKE ALL ON FUNCTION public.ping_resident_presence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ping_resident_presence() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ping_resident_presence() TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_household_civic()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  streak integer := 0;
  verified boolean := false;
  good_neighbour boolean := false;
  first_report boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT coalesce(s.streak_days, 0)
    INTO streak
  FROM public.resident_household_stats s
  WHERE s.user_id = auth.uid();

  verified := public.is_verified_household(auth.uid());

  SELECT EXISTS (
    SELECT 1
    FROM public.resident_verification_vouchers v
    WHERE v.voucher_user_id = auth.uid()
  ) INTO good_neighbour;

  SELECT EXISTS (
    SELECT 1
    FROM public.incidents i
    WHERE i.reporter_id = auth.uid()
      AND i.status = 'approved'
      AND upper(coalesce(i.type, '')) <> 'SOS'
  ) INTO first_report;

  RETURN jsonb_build_object(
    'streak_days', coalesce(streak, 0),
    'street_watch', coalesce(streak, 0) >= 3,
    'verified', verified,
    'good_neighbour', good_neighbour,
    'first_report', first_report
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_household_civic() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_household_civic() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_household_civic() TO service_role;

GRANT SELECT, INSERT ON public.area_broadcasts TO authenticated;
GRANT ALL ON public.area_broadcasts TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.resident_away_periods TO authenticated;
GRANT ALL ON public.resident_away_periods TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.resident_household_stats TO authenticated;
GRANT ALL ON public.resident_household_stats TO service_role;
