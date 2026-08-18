-- Scale foundation: multi-neighborhood tenancy, resident app entities,
-- city hub, subscriptions, and security-company readiness.
-- This migration is additive and defensive to avoid breaking existing live data.

-- ---------------------------------------------------------------------------
-- Core reference tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  province text,
  country text NOT NULL DEFAULT 'South Africa',
  center_lat double precision,
  center_lng double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.suburbs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid REFERENCES public.cities (id) ON DELETE SET NULL,
  name text NOT NULL,
  boundary_geojson jsonb,
  center_lat double precision,
  center_lng double precision,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, name)
);

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  type text NOT NULL DEFAULT 'nw_group'
    CHECK (type IN ('nw_group', 'security_company', 'city_admin')),
  primary_suburb_id uuid REFERENCES public.suburbs (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended')),
  subscription_tier text NOT NULL DEFAULT 'beta'
    CHECK (subscription_tier IN ('beta', 'standard', 'premium')),
  subscription_expires_at timestamptz,
  annual_fee_status text NOT NULL DEFAULT 'pending'
    CHECK (annual_fee_status IN ('pending', 'paid', 'overdue', 'waived')),
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  member_role text NOT NULL
    CHECK (member_role IN (
      'resident',
      'patroller',
      'nw_admin',
      'committee',
      'security_admin',
      'technical_support',
      'city_admin'
    )),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  invited_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.organization_suburbs (
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  suburb_id uuid NOT NULL REFERENCES public.suburbs (id) ON DELETE CASCADE,
  assignment_type text NOT NULL DEFAULT 'primary'
    CHECK (assignment_type IN ('primary', 'secondary', 'backup')),
  active boolean NOT NULL DEFAULT true,
  assigned_date timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, suburb_id)
);

-- ---------------------------------------------------------------------------
-- Role-specific profiles + resident/security-company relationship
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resident_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  home_address text,
  id_document_url text,
  proof_of_residence_url text,
  security_company_affiliation_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  verification_admin_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  verification_date timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.patroller_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  badge_number text,
  training_certified boolean NOT NULL DEFAULT false,
  certification_date timestamptz,
  vehicle_registration text,
  vehicle_description text,
  patrol_hours_total numeric(10, 2) NOT NULL DEFAULT 0,
  incidents_reported_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  joined_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.security_company_branding (
  security_company_id uuid PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  primary_color_token text NOT NULL DEFAULT 'brand.blue.600',
  secondary_color_token text NOT NULL DEFAULT 'brand.blue.100',
  logo_url text,
  card_style text NOT NULL DEFAULT 'solid'
    CHECK (card_style IN ('solid', 'outlined', 'gradient')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.resident_security_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  security_company_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  membership_status text NOT NULL DEFAULT 'self_reported'
    CHECK (membership_status IN ('self_reported', 'verified', 'rejected', 'expired')),
  member_reference text,
  verified_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resident_user_id, security_company_id)
);

-- ---------------------------------------------------------------------------
-- Business + collaboration layers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('beta', 'standard', 'premium')),
  amount_zar integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'overdue', 'waived')),
  payment_method text,
  invoice_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.city_hub_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  city_id uuid REFERENCES public.cities (id) ON DELETE SET NULL,
  type text NOT NULL
    CHECK (type IN ('suspect_alert', 'pattern', 'resource_request', 'general')),
  title text NOT NULL,
  content text NOT NULL,
  related_suspect_profile_id uuid REFERENCES public.criminal_profiles (id) ON DELETE SET NULL,
  affected_suburb_ids uuid[] NOT NULL DEFAULT '{}',
  visibility text NOT NULL DEFAULT 'city_wide'
    CHECK (visibility IN ('city_wide', 'radius', 'specific_suburbs')),
  visibility_radius_km integer,
  requires_verification boolean NOT NULL DEFAULT false,
  verified_by_organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  legal_waiver_version_signed text,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  created_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.security_assignments (
  security_company_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  suburb_id uuid NOT NULL REFERENCES public.suburbs (id) ON DELETE CASCADE,
  assignment_type text NOT NULL DEFAULT 'primary'
    CHECK (assignment_type IN ('primary', 'secondary', 'backup')),
  assigned_date timestamptz NOT NULL DEFAULT now(),
  monthly_fee_agreed numeric(12, 2),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (security_company_id, suburb_id)
);

CREATE TABLE IF NOT EXISTS public.security_resident_access (
  security_company_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  resident_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  access_level text NOT NULL DEFAULT 'sos_only'
    CHECK (access_level IN ('full', 'limited', 'sos_only')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (security_company_id, resident_id)
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  action text NOT NULL,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sos_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.incidents (id) ON DELETE CASCADE,
  resident_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  trigger_type text NOT NULL DEFAULT 'button'
    CHECK (trigger_type IN ('button', 'voice_command', 'timer_expired')),
  audio_stream_started boolean NOT NULL DEFAULT false,
  audio_recording_url text,
  auto_location_accuracy integer,
  manual_location_confirmed boolean NOT NULL DEFAULT false,
  escalation_level smallint NOT NULL DEFAULT 0
    CHECK (escalation_level IN (0, 1, 2, 3)),
  escalation_triggered_at timestamptz[] NOT NULL DEFAULT '{}',
  resolved_by_organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  resident_feedback_rating smallint CHECK (resident_feedback_rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incident_id)
);

-- ---------------------------------------------------------------------------
-- Extend existing tables with org/suburb scope where available
-- ---------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS home_suburb_id uuid REFERENCES public.suburbs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patroller_suburb_id uuid REFERENCES public.suburbs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_method text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nda_signed_version text,
  ADD COLUMN IF NOT EXISTS nda_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS medical_notes text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'incidents'
  ) THEN
    ALTER TABLE public.incidents
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS suburb_id uuid REFERENCES public.suburbs (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS zone_id text,
      ADD COLUMN IF NOT EXISTS reporter_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS responder_organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS title text,
      ADD COLUMN IF NOT EXISTS visible_to_residents boolean NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
  ) THEN
    ALTER TABLE public.chat_messages
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS suburb_id uuid REFERENCES public.suburbs (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'text',
      ADD COLUMN IF NOT EXISTS incident_id uuid REFERENCES public.incidents (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS edited_at timestamptz,
      ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patrol_slots') THEN
    ALTER TABLE public.patrol_slots
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS suburb_id uuid REFERENCES public.suburbs (id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patrol_logs') THEN
    ALTER TABLE public.patrol_logs
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS suburb_id uuid REFERENCES public.suburbs (id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'active_patrols') THEN
    ALTER TABLE public.active_patrols
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS suburb_id uuid REFERENCES public.suburbs (id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patrol_locations') THEN
    ALTER TABLE public.patrol_locations
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS suburb_id uuid REFERENCES public.suburbs (id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.criminal_profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES public.cities (id) ON DELETE SET NULL;

ALTER TABLE public.profile_incidents
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL;

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Seed a legacy org for existing single-neighborhood data
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_legacy_org_id uuid;
BEGIN
  SELECT id INTO v_legacy_org_id
  FROM public.organizations
  WHERE lower(name) = 'theescombe neighborhood watch'
  LIMIT 1;

  IF v_legacy_org_id IS NULL THEN
    INSERT INTO public.organizations (name, type, status, subscription_tier, annual_fee_status, settings_json)
    VALUES (
      'Theescombe Neighborhood Watch',
      'nw_group',
      'active',
      'beta',
      'waived',
      jsonb_build_object('legacy_seeded', true)
    )
    RETURNING id INTO v_legacy_org_id;
  END IF;

  UPDATE public.users
  SET organization_id = v_legacy_org_id
  WHERE organization_id IS NULL;

  INSERT INTO public.organization_members (organization_id, user_id, member_role, status)
  SELECT
    v_legacy_org_id,
    u.id,
    CASE
      WHEN lower(trim(coalesce(u.role::text, ''))) IN ('admin', 'committee') THEN 'nw_admin'
      WHEN lower(trim(coalesce(u.role::text, ''))) = 'technical_support' THEN 'technical_support'
      WHEN lower(trim(coalesce(u.role::text, ''))) IN ('patroller', 'investigator', 'volunteer') THEN 'patroller'
      ELSE 'resident'
    END,
    'active'
  FROM public.users u
  ON CONFLICT (organization_id, user_id) DO NOTHING;
END $$;

-- Backfill organization references on operational tables when possible.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='incidents' AND column_name='reporter_id') THEN
    UPDATE public.incidents i
    SET organization_id = u.organization_id
    FROM public.users u
    WHERE i.organization_id IS NULL
      AND i.reporter_id::text = u.id::text;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='active_patrols' AND column_name='user_id') THEN
    UPDATE public.active_patrols ap
    SET organization_id = u.organization_id
    FROM public.users u
    WHERE ap.organization_id IS NULL
      AND ap.user_id::text = u.id::text;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrol_logs' AND column_name='user_id') THEN
    UPDATE public.patrol_logs pl
    SET organization_id = u.organization_id
    FROM public.users u
    WHERE pl.organization_id IS NULL
      AND pl.user_id::text = u.id::text;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrol_slots' AND column_name='user_id') THEN
    UPDATE public.patrol_slots ps
    SET organization_id = u.organization_id
    FROM public.users u
    WHERE ps.organization_id IS NULL
      AND ps.user_id::text = u.id::text;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_messages' AND column_name='sender_id') THEN
    UPDATE public.chat_messages cm
    SET organization_id = u.organization_id
    FROM public.users u
    WHERE cm.organization_id IS NULL
      AND cm.sender_id::text = u.id::text;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Tenant helper functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT om.organization_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.status = 'active'
  UNION
  SELECT u.organization_id
  FROM public.users u
  WHERE u.id = auth.uid()
    AND u.organization_id IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.current_org_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_org_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_org_ids() TO service_role;

CREATE OR REPLACE FUNCTION public.is_staff_role(p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_role, ''))) IN ('admin', 'committee', 'technical_support', 'nw_admin', 'security_admin', 'city_admin');
$$;

-- ---------------------------------------------------------------------------
-- Tighten existing policies and apply tenant isolation
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_suburbs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patroller_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_company_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_security_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.city_hub_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_resident_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sos_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select_member ON public.organizations;
CREATE POLICY organizations_select_member ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS organizations_manage_staff ON public.organizations;
CREATE POLICY organizations_manage_staff ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
  )
  WITH CHECK (id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS organizations_insert_staff ON public.organizations;
CREATE POLICY organizations_insert_staff ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
  );

DROP POLICY IF EXISTS org_members_select_member ON public.organization_members;
CREATE POLICY org_members_select_member ON public.organization_members
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS org_members_manage_staff ON public.organization_members;
CREATE POLICY org_members_manage_staff ON public.organization_members
  FOR ALL TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
  )
  WITH CHECK (organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS org_members_insert_self ON public.organization_members;
CREATE POLICY org_members_insert_self ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS resident_profiles_select_org ON public.resident_profiles;
CREATE POLICY resident_profiles_select_org ON public.resident_profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = resident_profiles.user_id
        AND u.organization_id IN (SELECT public.current_org_ids())
    )
  );

DROP POLICY IF EXISTS resident_profiles_update_self_or_staff ON public.resident_profiles;
CREATE POLICY resident_profiles_update_self_or_staff ON public.resident_profiles
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      JOIN public.users target ON target.id = resident_profiles.user_id
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
        AND target.organization_id IN (SELECT public.current_org_ids())
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      JOIN public.users target ON target.id = resident_profiles.user_id
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
        AND target.organization_id IN (SELECT public.current_org_ids())
    )
  );

DROP POLICY IF EXISTS resident_security_memberships_select ON public.resident_security_memberships;
CREATE POLICY resident_security_memberships_select ON public.resident_security_memberships
  FOR SELECT TO authenticated
  USING (
    resident_user_id = auth.uid()
    OR security_company_id IN (SELECT public.current_org_ids())
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = resident_security_memberships.resident_user_id
        AND u.organization_id IN (SELECT public.current_org_ids())
    )
  );

DROP POLICY IF EXISTS resident_security_memberships_write ON public.resident_security_memberships;
CREATE POLICY resident_security_memberships_write ON public.resident_security_memberships
  FOR ALL TO authenticated
  USING (
    resident_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
        AND (
          security_company_id IN (SELECT public.current_org_ids())
          OR cu.organization_id IN (SELECT public.current_org_ids())
        )
    )
  )
  WITH CHECK (
    resident_user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
  );

DROP POLICY IF EXISTS subscriptions_select_org ON public.subscriptions;
CREATE POLICY subscriptions_select_org ON public.subscriptions
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS subscriptions_manage_staff ON public.subscriptions;
CREATE POLICY subscriptions_manage_staff ON public.subscriptions
  FOR ALL TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
  )
  WITH CHECK (organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS city_hub_posts_select ON public.city_hub_posts;
CREATE POLICY city_hub_posts_select ON public.city_hub_posts
  FOR SELECT TO authenticated
  USING (
    status = 'published'
    OR author_organization_id IN (SELECT public.current_org_ids())
  );

DROP POLICY IF EXISTS city_hub_posts_write ON public.city_hub_posts;
CREATE POLICY city_hub_posts_write ON public.city_hub_posts
  FOR ALL TO authenticated
  USING (author_organization_id IN (SELECT public.current_org_ids()))
  WITH CHECK (author_organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS activity_logs_select_org ON public.activity_logs;
CREATE POLICY activity_logs_select_org ON public.activity_logs
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS activity_logs_insert_actor ON public.activity_logs;
CREATE POLICY activity_logs_insert_actor ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (organization_id IS NULL OR organization_id IN (SELECT public.current_org_ids()))
  );

DROP POLICY IF EXISTS sos_alerts_select_org ON public.sos_alerts;
CREATE POLICY sos_alerts_select_org ON public.sos_alerts
  FOR SELECT TO authenticated
  USING (
    resident_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.incidents i
      WHERE i.id = sos_alerts.incident_id
        AND i.organization_id IN (SELECT public.current_org_ids())
    )
  );

DROP POLICY IF EXISTS sos_alerts_write_org ON public.sos_alerts;
CREATE POLICY sos_alerts_write_org ON public.sos_alerts
  FOR ALL TO authenticated
  USING (
    resident_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
  )
  WITH CHECK (
    resident_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
  );

-- Tighten permissive legacy intelligence policies.
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.criminal_profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.criminal_profiles;
DROP POLICY IF EXISTS "Enable update for creators or admins" ON public.criminal_profiles;

CREATE POLICY criminal_profiles_select_org ON public.criminal_profiles
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_org_ids()));

CREATE POLICY criminal_profiles_insert_org ON public.criminal_profiles
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.current_org_ids()));

CREATE POLICY criminal_profiles_update_org ON public.criminal_profiles
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND (
      auth.uid()::text = created_by
      OR EXISTS (
        SELECT 1 FROM public.users cu
        WHERE cu.id = auth.uid()
          AND public.is_staff_role(cu.role::text)
      )
    )
  )
  WITH CHECK (organization_id IN (SELECT public.current_org_ids()));

CREATE POLICY criminal_profiles_delete_org ON public.criminal_profiles
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
  );

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.profile_incidents;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.profile_incidents;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.profile_incidents;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.profile_incidents;

CREATE POLICY profile_incidents_select_org ON public.profile_incidents
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_org_ids()));

CREATE POLICY profile_incidents_insert_org ON public.profile_incidents
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.current_org_ids()));

CREATE POLICY profile_incidents_update_staff_org ON public.profile_incidents
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
  )
  WITH CHECK (organization_id IN (SELECT public.current_org_ids()));

CREATE POLICY profile_incidents_delete_staff_org ON public.profile_incidents
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
  );

-- ---------------------------------------------------------------------------
-- Security-definer function hardening (org-scoped)
-- ---------------------------------------------------------------------------
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
      AND public.is_staff_role(cu.role::text)
  )
  AND (
    u.organization_id IN (SELECT public.current_org_ids())
    OR u.id = auth.uid()
  )
  ORDER BY u.created_at DESC;
$$;

COMMENT ON FUNCTION public.list_users_for_staff() IS
  'Returns users only inside the caller organizations; staff-only RPC.';

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
    SELECT 1
    FROM public.users cu
    JOIN public.incidents i ON i.id = p_incident_id
    WHERE cu.id = uid
      AND public.is_staff_role(cu.role::text)
      AND i.organization_id IN (SELECT public.current_org_ids())
  ) INTO ok;

  IF NOT ok THEN
    RAISE EXCEPTION 'forbidden: staff role in same organization required';
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
  'Hard-delete one incident in caller organization; requires staff role.';

CREATE OR REPLACE FUNCTION public.chat_unread_for_me(p_organization_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH boundary AS (
    SELECT COALESCE(
      (SELECT m.created_at
       FROM public.chat_messages m
       JOIN public.chat_read_state crs ON crs.user_id = auth.uid() AND m.id::text = crs.last_read_message_id::text),
      (SELECT crs2.last_read_at FROM public.chat_read_state crs2 WHERE crs2.user_id = auth.uid()),
      '-infinity'::timestamptz
    ) AS t
  ),
  allowed_org AS (
    SELECT CASE
      WHEN p_organization_id IS NULL THEN NULL::uuid
      ELSE p_organization_id
    END AS org_id
  )
  SELECT count(*)::int
  FROM public.chat_messages cm, boundary b, allowed_org ao
  WHERE cm.sender_id::text IS DISTINCT FROM auth.uid()::text
    AND cm.expires_at > now()
    AND cm.created_at > b.t
    AND (
      ao.org_id IS NULL
      OR cm.organization_id = ao.org_id
    )
    AND (
      cm.organization_id IS NULL
      OR cm.organization_id IN (SELECT public.current_org_ids())
    );
$$;

REVOKE ALL ON FUNCTION public.chat_unread_for_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_unread_for_me(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_unread_for_me()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.chat_unread_for_me(NULL::uuid);
$$;

REVOKE ALL ON FUNCTION public.chat_unread_for_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_unread_for_me() TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_mark_read(p_message_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  mid uuid;
  mts timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_message_id IS NOT NULL THEN
    SELECT id, created_at INTO mid, mts
    FROM public.chat_messages
    WHERE id = p_message_id
      AND expires_at > now()
      AND (
        organization_id IS NULL
        OR organization_id IN (SELECT public.current_org_ids())
      );
    IF mid IS NULL THEN
      RETURN;
    END IF;
  ELSE
    SELECT id, created_at INTO mid, mts
    FROM public.chat_messages
    WHERE expires_at > now()
      AND (
        organization_id IS NULL
        OR organization_id IN (SELECT public.current_org_ids())
      )
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.chat_read_state (user_id, last_read_message_id, last_read_at, updated_at)
  VALUES (uid, mid, COALESCE(mts, now()), now())
  ON CONFLICT (user_id) DO UPDATE SET
    last_read_message_id = EXCLUDED.last_read_message_id,
    last_read_at = EXCLUDED.last_read_at,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.chat_mark_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_mark_read(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Security-company metrics view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.security_company_resident_metrics AS
SELECT
  o.id AS security_company_id,
  o.name AS security_company_name,
  count(DISTINCT rsm.resident_user_id) FILTER (
    WHERE rsm.membership_status IN ('self_reported', 'verified')
  ) AS residents_linked_count,
  count(DISTINCT rsm.resident_user_id) FILTER (
    WHERE rsm.membership_status = 'verified'
  ) AS residents_verified_count,
  count(DISTINCT u.home_suburb_id) FILTER (
    WHERE rsm.membership_status IN ('self_reported', 'verified')
  ) AS suburbs_covered_count,
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
