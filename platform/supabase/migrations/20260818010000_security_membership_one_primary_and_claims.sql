-- One primary security-company membership per resident, company/admin claim queues,
-- transfer history, and insights grouped by neighborhood watch (not empty suburb ids).

ALTER TABLE public.resident_security_memberships
  DROP CONSTRAINT IF EXISTS resident_security_memberships_membership_status_check;

ALTER TABLE public.resident_security_memberships
  ADD CONSTRAINT resident_security_memberships_membership_status_check
  CHECK (membership_status IN (
    'self_reported',
    'verified',
    'rejected',
    'expired',
    'withdrawn',
    'transferred'
  ));

-- Keep the newest verified (else newest) active row; close extras from the old multi-claim bug.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY resident_user_id
      ORDER BY
        CASE WHEN membership_status = 'verified' THEN 0 ELSE 1 END,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST
    ) AS rn
  FROM public.resident_security_memberships
  WHERE membership_status IN ('self_reported', 'verified')
)
UPDATE public.resident_security_memberships m
SET
  membership_status = 'withdrawn',
  notes = nullif(trim(concat_ws(E'\n', nullif(trim(m.notes), ''), 'Auto-withdrawn: only one active company allowed.')), ''),
  updated_at = now()
FROM ranked r
WHERE m.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS resident_one_active_security_membership
  ON public.resident_security_memberships (resident_user_id)
  WHERE membership_status IN ('self_reported', 'verified');

CREATE TABLE IF NOT EXISTS public.security_membership_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  membership_id uuid REFERENCES public.resident_security_memberships (id) ON DELETE SET NULL,
  from_company_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  to_company_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  event_type text NOT NULL
    CHECK (event_type IN (
      'claimed',
      'verified',
      'rejected',
      'withdrawn',
      'transferred',
      'expired',
      'deleted'
    )),
  actor_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_membership_events_resident_idx
  ON public.security_membership_events (resident_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_membership_events_from_idx
  ON public.security_membership_events (from_company_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS security_membership_events_to_idx
  ON public.security_membership_events (to_company_id, event_type, created_at DESC);

ALTER TABLE public.security_membership_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS security_membership_events_select ON public.security_membership_events;
CREATE POLICY security_membership_events_select ON public.security_membership_events
  FOR SELECT TO authenticated
  USING (
    resident_user_id = auth.uid()
    OR public.is_platform_staff()
    OR public.is_global_app_staff()
    OR from_company_id IN (SELECT public.my_security_company_ids())
    OR to_company_id IN (SELECT public.my_security_company_ids())
  );

GRANT SELECT ON public.security_membership_events TO authenticated;

CREATE OR REPLACE FUNCTION public.resident_watch_area_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT u.organization_id
      FROM public.users u
      JOIN public.organizations o ON o.id = u.organization_id AND o.type = 'nw_group'
      WHERE u.id = p_user_id
    ),
    (
      SELECT om.organization_id
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id AND o.type = 'nw_group'
      WHERE om.user_id = p_user_id
        AND om.status = 'active'
      ORDER BY om.joined_at NULLS LAST
      LIMIT 1
    )
  );
$$;

REVOKE ALL ON FUNCTION public.resident_watch_area_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_watch_area_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resident_watch_area_id(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.security_membership_log_event(
  p_resident uuid,
  p_membership uuid,
  p_from uuid,
  p_to uuid,
  p_type text,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.security_membership_events (
    resident_user_id,
    membership_id,
    from_company_id,
    to_company_id,
    event_type,
    actor_user_id,
    notes
  )
  VALUES (p_resident, p_membership, p_from, p_to, p_type, auth.uid(), nullif(trim(p_notes), ''));
END;
$$;

REVOKE ALL ON FUNCTION public.security_membership_log_event(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_membership_log_event(uuid, uuid, uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_security_company(
  p_company_id uuid,
  p_member_reference text DEFAULT NULL
)
RETURNS public.resident_security_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  company uuid;
  existing public.resident_security_memberships;
  active_other public.resident_security_memberships;
  result public.resident_security_memberships;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT o.id INTO company
  FROM public.organizations o
  WHERE o.id = p_company_id
    AND o.type = 'security_company'
    AND o.status <> 'suspended';
  IF company IS NULL THEN
    RAISE EXCEPTION 'unknown security company';
  END IF;

  SELECT * INTO active_other
  FROM public.resident_security_memberships
  WHERE resident_user_id = uid
    AND membership_status IN ('self_reported', 'verified')
    AND security_company_id <> company
  LIMIT 1;

  IF active_other.id IS NOT NULL THEN
    RAISE EXCEPTION 'transfer_required';
  END IF;

  SELECT * INTO existing
  FROM public.resident_security_memberships
  WHERE resident_user_id = uid
    AND security_company_id = company
  LIMIT 1;

  IF existing.id IS NOT NULL THEN
    UPDATE public.resident_security_memberships
    SET
      membership_status = CASE
        WHEN membership_status = 'verified' THEN 'verified'
        ELSE 'self_reported'
      END,
      member_reference = COALESCE(nullif(trim(p_member_reference), ''), member_reference),
      updated_at = now()
    WHERE id = existing.id
    RETURNING * INTO result;
    IF existing.membership_status NOT IN ('self_reported', 'verified') THEN
      PERFORM public.security_membership_log_event(uid, result.id, NULL, company, 'claimed', NULL);
    END IF;
    RETURN result;
  END IF;

  INSERT INTO public.resident_security_memberships (
    resident_user_id,
    security_company_id,
    membership_status,
    member_reference
  )
  VALUES (uid, company, 'self_reported', nullif(trim(p_member_reference), ''))
  RETURNING * INTO result;

  PERFORM public.security_membership_log_event(uid, result.id, NULL, company, 'claimed', NULL);
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_security_company(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_security_company(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_security_company(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.withdraw_security_membership(p_membership_id uuid)
RETURNS public.resident_security_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  result public.resident_security_memberships;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.resident_security_memberships
  SET
    membership_status = 'withdrawn',
    updated_at = now()
  WHERE id = p_membership_id
    AND resident_user_id = uid
    AND membership_status = 'self_reported'
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'cannot withdraw this membership';
  END IF;

  PERFORM public.security_membership_log_event(
    uid,
    result.id,
    result.security_company_id,
    NULL,
    'withdrawn',
    NULL
  );
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_security_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_security_membership(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_security_membership(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.transfer_security_membership(
  p_to_company_id uuid,
  p_member_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.resident_security_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  company uuid;
  current_row public.resident_security_memberships;
  result public.resident_security_memberships;
  last_transfer timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT o.id INTO company
  FROM public.organizations o
  WHERE o.id = p_to_company_id
    AND o.type = 'security_company'
    AND o.status <> 'suspended';
  IF company IS NULL THEN
    RAISE EXCEPTION 'unknown security company';
  END IF;

  SELECT created_at INTO last_transfer
  FROM public.security_membership_events
  WHERE resident_user_id = uid
    AND event_type = 'transferred'
  ORDER BY created_at DESC
  LIMIT 1;

  IF last_transfer IS NOT NULL AND last_transfer > now() - interval '30 days' THEN
    RAISE EXCEPTION 'transfer_cooldown';
  END IF;

  SELECT * INTO current_row
  FROM public.resident_security_memberships
  WHERE resident_user_id = uid
    AND membership_status IN ('self_reported', 'verified')
  ORDER BY CASE WHEN membership_status = 'verified' THEN 0 ELSE 1 END, updated_at DESC
  LIMIT 1;

  IF current_row.id IS NULL THEN
    RETURN public.claim_security_company(company, p_member_reference);
  END IF;

  IF current_row.security_company_id = company THEN
    RAISE EXCEPTION 'already_with_company';
  END IF;

  UPDATE public.resident_security_memberships
  SET
    membership_status = 'transferred',
    notes = nullif(trim(concat_ws(E'\n', nullif(trim(notes), ''), nullif(trim(p_notes), ''))), ''),
    updated_at = now()
  WHERE id = current_row.id;

  SELECT * INTO result
  FROM public.resident_security_memberships
  WHERE resident_user_id = uid
    AND security_company_id = company
  LIMIT 1;

  IF result.id IS NOT NULL THEN
    UPDATE public.resident_security_memberships
    SET
      membership_status = 'self_reported',
      member_reference = COALESCE(nullif(trim(p_member_reference), ''), member_reference),
      verified_by_user_id = NULL,
      verified_at = NULL,
      updated_at = now()
    WHERE id = result.id
    RETURNING * INTO result;
  ELSE
    INSERT INTO public.resident_security_memberships (
      resident_user_id,
      security_company_id,
      membership_status,
      member_reference
    )
    VALUES (uid, company, 'self_reported', nullif(trim(p_member_reference), ''))
    RETURNING * INTO result;
  END IF;

  PERFORM public.security_membership_log_event(
    uid,
    result.id,
    current_row.security_company_id,
    company,
    'transferred',
    p_notes
  );
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_security_membership(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_security_membership(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_security_membership(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.review_security_membership(
  p_membership_id uuid,
  p_status text,
  p_notes text DEFAULT NULL
)
RETURNS public.resident_security_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  result public.resident_security_memberships;
  next_status text := lower(trim(p_status));
  can_review boolean := false;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF next_status NOT IN ('verified', 'rejected', 'expired', 'withdrawn') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  SELECT * INTO result
  FROM public.resident_security_memberships
  WHERE id = p_membership_id;
  IF result.id IS NULL THEN
    RAISE EXCEPTION 'membership not found';
  END IF;

  can_review :=
    public.is_platform_staff()
    OR public.is_global_app_staff()
    OR result.security_company_id IN (SELECT public.my_security_company_ids());

  IF NOT can_review THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF next_status IN ('verified', 'rejected') AND result.membership_status <> 'self_reported'
     AND NOT (public.is_platform_staff() OR public.is_global_app_staff()) THEN
    RAISE EXCEPTION 'only pending claims can be reviewed';
  END IF;

  UPDATE public.resident_security_memberships
  SET
    membership_status = next_status,
    verified_by_user_id = CASE WHEN next_status = 'verified' THEN uid ELSE verified_by_user_id END,
    verified_at = CASE WHEN next_status = 'verified' THEN now() ELSE verified_at END,
    notes = COALESCE(nullif(trim(p_notes), ''), notes),
    updated_at = now()
  WHERE id = result.id
  RETURNING * INTO result;

  PERFORM public.security_membership_log_event(
    result.resident_user_id,
    result.id,
    result.security_company_id,
    CASE WHEN next_status = 'verified' THEN result.security_company_id ELSE NULL END,
    next_status,
    p_notes
  );
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.review_security_membership(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_security_membership(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_security_membership(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_security_membership_claim(p_membership_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.resident_security_memberships;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO row
  FROM public.resident_security_memberships
  WHERE id = p_membership_id;
  IF row.id IS NULL THEN
    RAISE EXCEPTION 'membership not found';
  END IF;

  IF NOT (public.is_platform_staff() OR public.is_global_app_staff()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF row.membership_status = 'verified' THEN
    RAISE EXCEPTION 'expire verified memberships instead of deleting';
  END IF;

  PERFORM public.security_membership_log_event(
    row.resident_user_id,
    row.id,
    row.security_company_id,
    NULL,
    'deleted',
    'Admin deleted mistaken claim'
  );

  DELETE FROM public.resident_security_memberships WHERE id = row.id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_security_membership_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_security_membership_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_security_membership_claim(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.list_security_membership_claims(
  p_queue text DEFAULT 'pending',
  p_mine_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  resident_user_id uuid,
  security_company_id uuid,
  security_company_name text,
  membership_status text,
  member_reference text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  verified_at timestamptz,
  full_name text,
  street_label text,
  neighborhood_name text,
  household_verified boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  queue text := lower(trim(coalesce(p_queue, 'pending')));
  mine boolean := coalesce(p_mine_only, false);
  staff boolean := public.is_platform_staff() OR public.is_global_app_staff();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF mine AND NOT EXISTS (SELECT 1 FROM public.my_security_company_ids()) AND NOT staff THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF NOT mine AND NOT staff THEN
    mine := true;
    IF NOT EXISTS (SELECT 1 FROM public.my_security_company_ids()) THEN
      RAISE EXCEPTION 'not allowed';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.resident_user_id,
    m.security_company_id,
    sc.name,
    m.membership_status,
    m.member_reference,
    m.notes,
    m.created_at,
    m.updated_at,
    m.verified_at,
    u.full_name,
    public.resident_street_label(coalesce(nullif(trim(rp.home_address), ''), u.address)),
    nw.name,
    (rp.verification_date IS NOT NULL OR coalesce(u.verified, false))
  FROM public.resident_security_memberships m
  JOIN public.users u ON u.id = m.resident_user_id
  LEFT JOIN public.resident_profiles rp ON rp.user_id = u.id
  LEFT JOIN public.organizations sc ON sc.id = m.security_company_id
  LEFT JOIN public.organizations nw ON nw.id = public.resident_watch_area_id(u.id)
  WHERE (
      NOT mine
      OR m.security_company_id IN (SELECT public.my_security_company_ids())
    )
    AND (
      (queue = 'pending' AND m.membership_status = 'self_reported')
      OR (queue = 'history' AND m.membership_status <> 'self_reported')
      OR queue = 'all'
    )
  ORDER BY m.updated_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.list_security_membership_claims(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_security_membership_claims(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_security_membership_claims(text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.list_security_membership_events(p_mine_only boolean DEFAULT false)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  event_type text,
  resident_user_id uuid,
  full_name text,
  from_company_id uuid,
  from_company_name text,
  to_company_id uuid,
  to_company_name text,
  notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  mine boolean := coalesce(p_mine_only, false);
  staff boolean := public.is_platform_staff() OR public.is_global_app_staff();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT mine AND NOT staff THEN
    mine := true;
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.created_at,
    e.event_type,
    e.resident_user_id,
    u.full_name,
    e.from_company_id,
    fc.name,
    e.to_company_id,
    tc.name,
    e.notes
  FROM public.security_membership_events e
  LEFT JOIN public.users u ON u.id = e.resident_user_id
  LEFT JOIN public.organizations fc ON fc.id = e.from_company_id
  LEFT JOIN public.organizations tc ON tc.id = e.to_company_id
  WHERE
    (
      NOT mine
      AND staff
    )
    OR (
      mine
      AND (
        e.resident_user_id = auth.uid()
        OR e.from_company_id IN (SELECT public.my_security_company_ids())
        OR e.to_company_id IN (SELECT public.my_security_company_ids())
      )
    )
  ORDER BY e.created_at DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.list_security_membership_events(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_security_membership_events(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_security_membership_events(boolean) TO service_role;

DROP VIEW IF EXISTS public.security_company_resident_metrics;
CREATE VIEW public.security_company_resident_metrics AS
SELECT
  o.id AS security_company_id,
  o.name AS security_company_name,
  count(DISTINCT rsm.resident_user_id) FILTER (
    WHERE rsm.membership_status IN ('self_reported', 'verified')
  ) AS residents_linked_count,
  count(DISTINCT rsm.resident_user_id) FILTER (
    WHERE rsm.membership_status = 'self_reported'
  ) AS residents_pending_count,
  count(DISTINCT rsm.resident_user_id) FILTER (
    WHERE rsm.membership_status = 'verified'
  ) AS residents_verified_count,
  count(DISTINCT public.resident_watch_area_id(rsm.resident_user_id)) FILTER (
    WHERE rsm.membership_status IN ('self_reported', 'verified')
  ) AS watch_areas_count,
  (
    SELECT count(*)::bigint
    FROM public.security_membership_events e
    WHERE e.to_company_id = o.id
      AND e.event_type = 'transferred'
      AND e.created_at >= now() - interval '30 days'
  ) AS clients_won_30d,
  (
    SELECT count(*)::bigint
    FROM public.security_membership_events e
    WHERE e.from_company_id = o.id
      AND e.event_type = 'transferred'
      AND e.created_at >= now() - interval '30 days'
  ) AS clients_lost_30d,
  count(DISTINCT i.id) FILTER (
    WHERE COALESCE(
      (to_jsonb(i)->>'created_at')::timestamptz,
      (to_jsonb(i)->>'submitted_at')::timestamptz,
      (to_jsonb(i)->>'incident_date')::timestamptz
    ) >= now() - interval '30 days'
  ) AS incidents_last_30d
FROM public.organizations o
LEFT JOIN public.resident_security_memberships rsm
  ON rsm.security_company_id = o.id
LEFT JOIN public.users u
  ON u.id = rsm.resident_user_id
LEFT JOIN public.incidents i
  ON i.reporter_id::text = u.id::text
WHERE o.type = 'security_company'
GROUP BY o.id, o.name;

GRANT SELECT ON public.security_company_resident_metrics TO authenticated;

DROP FUNCTION IF EXISTS public.security_partner_residents();
CREATE FUNCTION public.security_partner_residents()
RETURNS TABLE (
  resident_user_id uuid,
  full_name text,
  first_name text,
  last_name text,
  security_company_id uuid,
  security_company_name text,
  membership_status text,
  is_my_client boolean,
  logo_url text,
  primary_color_token text,
  secondary_color_token text,
  card_style text,
  sos_count bigint,
  incident_count bigint,
  suburb_id uuid,
  suburb_name text,
  neighborhood_id uuid,
  neighborhood_name text,
  street_label text,
  household_verified boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH covered AS (
    SELECT DISTINCT
      organization_id,
      suburb_id,
      suburb_name,
      organization_name
    FROM public.security_partner_coverage_areas()
  ),
  matched AS (
    SELECT DISTINCT ON (u.id)
      u.id AS user_id,
      coalesce(c.organization_id, u.organization_id) AS neighborhood_id,
      coalesce(c.organization_name, nw.name) AS neighborhood_name,
      coalesce(u.home_suburb_id, c.suburb_id) AS suburb_id,
      coalesce(s.name, c.suburb_name) AS suburb_name
    FROM public.users u
    LEFT JOIN public.organizations nw
      ON nw.id = u.organization_id AND nw.type = 'nw_group'
    LEFT JOIN public.suburbs s ON s.id = u.home_suburb_id
    LEFT JOIN covered c
      ON c.organization_id = u.organization_id
      OR (
        c.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.organization_members om
          WHERE om.user_id = u.id
            AND om.organization_id = c.organization_id
            AND om.status = 'active'
        )
      )
      OR (
        c.suburb_id IS NOT NULL
        AND u.home_suburb_id = c.suburb_id
      )
    WHERE public.security_partner_can_view()
      AND replace(lower(trim(u.role::text)), '-', '_') IN ('resident', 'user')
      AND (
        u.organization_id IN (SELECT organization_id FROM covered WHERE organization_id IS NOT NULL)
        OR u.home_suburb_id IN (SELECT suburb_id FROM covered WHERE suburb_id IS NOT NULL)
        OR EXISTS (
          SELECT 1
          FROM public.organization_members om
          JOIN covered c2 ON c2.organization_id = om.organization_id
          WHERE om.user_id = u.id
            AND om.status = 'active'
        )
      )
    ORDER BY
      u.id,
      CASE WHEN c.organization_id = u.organization_id THEN 0 ELSE 1 END,
      c.organization_name
  )
  SELECT
    u.id,
    u.full_name,
    nullif(split_part(trim(coalesce(u.full_name, '')), ' ', 1), ''),
    nullif(btrim(substr(trim(coalesce(u.full_name, '')), length(split_part(trim(coalesce(u.full_name, '')), ' ', 1)) + 1)), ''),
    m.security_company_id,
    sc.name,
    CASE
      WHEN m.resident_user_id IS NOT NULL THEN coalesce(nullif(trim(m.membership_status), ''), 'linked')
      ELSE 'registered'
    END,
    coalesce(m.is_mine, false),
    b.logo_url,
    b.primary_color_token,
    b.secondary_color_token,
    b.card_style,
    (
      SELECT count(*)
      FROM public.sos_alerts sos
      WHERE sos.resident_id = u.id
    ),
    (
      SELECT count(*)
      FROM public.incidents i
      WHERE i.reporter_id = u.id
    ),
    matched.suburb_id,
    matched.suburb_name,
    matched.neighborhood_id,
    matched.neighborhood_name,
    public.resident_street_label(coalesce(nullif(trim(rp.home_address), ''), u.address)),
    (rp.verification_date IS NOT NULL OR coalesce(u.verified, false))
  FROM matched
  JOIN public.users u ON u.id = matched.user_id
  LEFT JOIN public.resident_profiles rp ON rp.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT
      mm.*,
      (mm.security_company_id IN (SELECT public.my_security_company_ids())) AS is_mine
    FROM public.resident_security_memberships mm
    JOIN public.organizations sco
      ON sco.id = mm.security_company_id
     AND sco.type = 'security_company'
     AND sco.status <> 'suspended'
    WHERE mm.resident_user_id = u.id
      AND coalesce(mm.membership_status, '') NOT IN ('rejected', 'expired', 'withdrawn', 'transferred')
    ORDER BY
      CASE WHEN mm.security_company_id IN (SELECT public.my_security_company_ids()) THEN 0 ELSE 1 END,
      CASE WHEN mm.membership_status = 'verified' THEN 0 ELSE 1 END,
      mm.created_at DESC NULLS LAST
    LIMIT 1
  ) m ON true
  LEFT JOIN public.organizations sc ON sc.id = m.security_company_id
  LEFT JOIN public.security_company_branding b ON b.security_company_id = m.security_company_id
  ORDER BY
    CASE
      WHEN coalesce(m.is_mine, false) THEN 0
      WHEN m.security_company_id IS NOT NULL THEN 1
      ELSE 2
    END,
    lower(trim(coalesce(sc.name, ''))),
    lower(trim(coalesce(matched.neighborhood_name, ''))),
    lower(trim(coalesce(u.full_name, '')));
$$;

REVOKE ALL ON FUNCTION public.security_partner_residents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_residents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_residents() TO service_role;

-- Signup / legacy upserts must not create a second active company.
CREATE OR REPLACE FUNCTION public.resident_security_memberships_one_primary_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.membership_status IN ('self_reported', 'verified') THEN
    UPDATE public.resident_security_memberships
    SET
      membership_status = 'withdrawn',
      notes = nullif(trim(concat_ws(E'\n', nullif(trim(notes), ''), 'Superseded by a later company claim.')), ''),
      updated_at = now()
    WHERE resident_user_id = NEW.resident_user_id
      AND membership_status IN ('self_reported', 'verified')
      AND id IS DISTINCT FROM NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resident_security_memberships_one_primary_tg ON public.resident_security_memberships;
CREATE TRIGGER resident_security_memberships_one_primary_tg
  BEFORE INSERT OR UPDATE OF membership_status
  ON public.resident_security_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.resident_security_memberships_one_primary_tg();
