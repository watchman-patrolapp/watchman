-- Admin-editable list prices. Catalog is the default schedule; organizations.annual_fee_zar
-- is an optional override for one company or neighborhood.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS annual_fee_zar integer;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_annual_fee_zar_nonneg;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_annual_fee_zar_nonneg
  CHECK (annual_fee_zar IS NULL OR annual_fee_zar >= 0);

COMMENT ON COLUMN public.organizations.annual_fee_zar IS
  'Custom annual list price in ZAR. NULL uses platform_billing_catalog for this org type.';

CREATE TABLE IF NOT EXISTS public.platform_billing_catalog (
  id text PRIMARY KEY CHECK (id = 'default'),
  nw_under_limit_zar integer NOT NULL DEFAULT 2500 CHECK (nw_under_limit_zar >= 0),
  nw_at_or_above_limit_zar integer NOT NULL DEFAULT 3500 CHECK (nw_at_or_above_limit_zar >= 0),
  security_under_limit_zar integer NOT NULL DEFAULT 15000 CHECK (security_under_limit_zar >= 0),
  security_at_or_above_limit_zar integer NOT NULL DEFAULT 25000 CHECK (security_at_or_above_limit_zar >= 0),
  small_org_user_limit integer NOT NULL DEFAULT 10 CHECK (small_org_user_limit >= 1),
  trial_months integer NOT NULL DEFAULT 2 CHECK (trial_months >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL
);

INSERT INTO public.platform_billing_catalog (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_billing_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_billing_catalog_select ON public.platform_billing_catalog;
CREATE POLICY platform_billing_catalog_select ON public.platform_billing_catalog
  FOR SELECT TO authenticated
  USING (public.is_platform_staff() OR public.is_global_app_staff());

DROP POLICY IF EXISTS platform_billing_catalog_update ON public.platform_billing_catalog;
CREATE POLICY platform_billing_catalog_update ON public.platform_billing_catalog
  FOR UPDATE TO authenticated
  USING (public.is_platform_staff() OR public.is_global_app_staff())
  WITH CHECK (public.is_platform_staff() OR public.is_global_app_staff());

GRANT SELECT, UPDATE ON public.platform_billing_catalog TO authenticated;
GRANT ALL ON public.platform_billing_catalog TO service_role;
