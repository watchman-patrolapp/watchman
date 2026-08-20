-- Harden security_company_resident_metrics: revoke direct API SELECT,
-- expose aggregates only via a staff-gated SECURITY DEFINER RPC.

REVOKE ALL ON TABLE public.security_company_resident_metrics FROM PUBLIC;
REVOKE ALL ON TABLE public.security_company_resident_metrics FROM anon;
REVOKE ALL ON TABLE public.security_company_resident_metrics FROM authenticated;

DROP FUNCTION IF EXISTS public.list_security_company_resident_metrics();

CREATE FUNCTION public.list_security_company_resident_metrics()
RETURNS TABLE (
  security_company_id uuid,
  security_company_name text,
  residents_linked_count bigint,
  residents_pending_count bigint,
  residents_verified_count bigint,
  watch_areas_count bigint,
  clients_won_30d bigint,
  clients_lost_30d bigint,
  incidents_last_30d bigint
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
  IF NOT (public.is_platform_staff() OR public.is_global_app_staff()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    m.security_company_id,
    m.security_company_name,
    m.residents_linked_count,
    m.residents_pending_count,
    m.residents_verified_count,
    m.watch_areas_count,
    m.clients_won_30d,
    m.clients_lost_30d,
    m.incidents_last_30d
  FROM public.security_company_resident_metrics m
  ORDER BY m.residents_linked_count DESC, m.security_company_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_security_company_resident_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_security_company_resident_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_security_company_resident_metrics() TO service_role;

COMMENT ON FUNCTION public.list_security_company_resident_metrics() IS
  'Platform / global staff only: city-wide security company client metrics. View itself is not selectable by authenticated.';

COMMENT ON VIEW public.security_company_resident_metrics IS
  'Internal aggregate view. Do not GRANT SELECT to authenticated — use list_security_company_resident_metrics().';

NOTIFY pgrst, 'reload schema';
