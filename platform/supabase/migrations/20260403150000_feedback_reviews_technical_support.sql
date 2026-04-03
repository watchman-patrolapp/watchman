-- Feedback reviews (staff UI) + technical_support role parity in SECURITY DEFINER helpers.
-- Set role in Supabase: UPDATE public.users SET role = 'technical_support' WHERE id = '<your-auth-uuid>';

-- ── public.feedback ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS submitter_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_unreviewed ON public.feedback (created_at DESC)
  WHERE reviewed_at IS NULL;

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_insert_authenticated" ON public.feedback;
CREATE POLICY "feedback_insert_authenticated" ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "feedback_select_staff" ON public.feedback;
CREATE POLICY "feedback_select_staff" ON public.feedback
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(cu.role::text)) IN ('admin', 'committee', 'technical_support')
    )
  );

DROP POLICY IF EXISTS "feedback_update_staff" ON public.feedback;
CREATE POLICY "feedback_update_staff" ON public.feedback
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(cu.role::text)) IN ('admin', 'committee', 'technical_support')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(cu.role::text)) IN ('admin', 'committee', 'technical_support')
    )
  );

-- Realtime: Supabase Dashboard → Database → Publications → supabase_realtime → add table `feedback`
-- (CLI push environments may vary; adding here can error if already published.)

-- ── Staff directory: include technical_support ────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_users_for_staff()
RETURNS SETOF public.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.*
  FROM public.users u
  WHERE EXISTS (
    SELECT 1
    FROM public.users cu
    WHERE cu.id = auth.uid()
      AND lower(trim(cu.role::text)) IN ('admin', 'committee', 'technical_support')
  )
  ORDER BY u.created_at DESC;
$$;

COMMENT ON FUNCTION public.list_users_for_staff() IS
  'Returns all member rows for admin/committee/technical_support callers; bypasses RLS for staff directory UIs.';

-- ── Patrol slot delete: allow technical_support ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_patrol_slot(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ok boolean;
  deleted_count int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = uid
      AND lower(trim(role::text)) IN ('admin', 'committee', 'technical_support')
  ) INTO ok;

  IF NOT ok THEN
    RAISE EXCEPTION 'forbidden: admin, committee, or technical_support role required';
  END IF;

  DELETE FROM public.patrol_slots WHERE id = p_slot_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count = 0 THEN
    RAISE EXCEPTION 'patrol slot not found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_delete_patrol_slot(uuid) IS
  'Delete one patrol_slots row; caller must be users.role admin, committee, or technical_support';

-- ── Incident hard-delete: allow technical_support (and committee for ops parity) ──
CREATE OR REPLACE FUNCTION public.admin_delete_incident(p_incident_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ok boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = uid
      AND lower(trim(role::text)) IN ('admin', 'committee', 'technical_support')
  ) INTO ok;

  IF NOT ok THEN
    RAISE EXCEPTION 'forbidden: admin, committee, or technical_support role required';
  END IF;

  DELETE FROM public.profile_match_queue
  WHERE source_incident_id = p_incident_id
     OR source_evidence_id IN (
       SELECT id FROM public.incident_evidence WHERE incident_id = p_incident_id
     );

  DELETE FROM public.incident_evidence WHERE incident_id = p_incident_id;
  DELETE FROM public.incident_suspects WHERE incident_id = p_incident_id;
  DELETE FROM public.profile_incidents WHERE incident_id = p_incident_id;
  DELETE FROM public.incidents WHERE id = p_incident_id;
END;
$$;

COMMENT ON FUNCTION public.admin_delete_incident(uuid) IS
  'Hard-delete one incident and related rows; caller must be admin, committee, or technical_support';
