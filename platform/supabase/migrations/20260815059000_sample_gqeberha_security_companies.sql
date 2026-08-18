-- Sample Gqeberha security-company listings for register / profile dropdowns.
-- PSIRA numbers are stored when publicly confirmed; Tacnet is the live Theescombe partner.

WITH seed (
  name,
  psira_reg,
  partner_note,
  extra
) AS (
  VALUES
    (
      'Warhawk Security',
      '4788568',
      NULL,
      jsonb_build_object(
        'saps_reg', '26359',
        'compliance', jsonb_build_array('CIPC', 'CSD', 'PSSPF', 'NBCPSS'),
        'sites', jsonb_build_array('Coega', 'Struandale', 'Deal Party', 'Markman'),
        'kind', 'guarding',
        'base', 'Gqeberha'
      )
    ),
    (
      'Extreme Security',
      '1492891',
      'Alarm systems & armed response',
      jsonb_build_object(
        'kind', 'armed_response',
        'base', 'Newton Park, Gqeberha'
      )
    ),
    (
      'CCTV Security Surveillance',
      '4412150',
      'SAIDSA ASP-1571 · offsite monitoring',
      jsonb_build_object(
        'saidsa', 'ASP-1571',
        'kind', 'surveillance',
        'base', 'Gqeberha'
      )
    ),
    (
      'United Protection Solutions',
      '3266778',
      'Cape Town based · covers Gqeberha',
      jsonb_build_object(
        'kind', 'guarding',
        'base', 'Cape Town'
      )
    ),
    (
      'Atlas Security',
      NULL,
      'PSIRA-registered',
      jsonb_build_object('kind', 'armed_response', 'base', 'Gqeberha')
    ),
    (
      'Fidelity ADT',
      NULL,
      'PSIRA-registered',
      jsonb_build_object('kind', 'armed_response', 'base', 'South Africa')
    ),
    (
      'Algoa Security',
      NULL,
      'PSIRA-registered',
      jsonb_build_object('kind', 'guarding', 'base', 'Gqeberha')
    ),
    (
      'Armand Protection Services',
      NULL,
      'PSIRA-registered',
      jsonb_build_object('kind', 'guarding', 'base', 'Gqeberha')
    ),
    (
      'Xhobani Security',
      NULL,
      'PSIRA-registered',
      jsonb_build_object('kind', 'guarding', 'base', 'Gqeberha')
    ),
    (
      'M Security Services',
      NULL,
      'PSIRA-registered',
      jsonb_build_object('kind', 'guarding', 'base', 'Gqeberha')
    ),
    (
      'Tacnet',
      NULL,
      'Theescombe partner',
      jsonb_build_object(
        'kind', 'partner',
        'base', 'Theescombe, Gqeberha',
        'theescombe_partner', true
      )
    )
)
INSERT INTO public.organizations (
  name,
  type,
  status,
  subscription_tier,
  annual_fee_status,
  city_id,
  settings_json
)
SELECT
  s.name,
  'security_company',
  'active',
  'beta',
  'waived',
  public.default_city_id(),
  jsonb_strip_nulls(
    jsonb_build_object(
      'sample_listed', true,
      'psira_reg', s.psira_reg,
      'partner_note', s.partner_note
    ) || coalesce(s.extra, '{}'::jsonb)
  )
FROM seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.organizations o
  WHERE o.type = 'security_company'
    AND lower(trim(o.name)) = lower(s.name)
);

-- Refresh listing metadata on existing rows with the same name (do not demote live orgs).
UPDATE public.organizations o
SET
  status = CASE WHEN o.status = 'suspended' THEN o.status ELSE 'active' END,
  city_id = coalesce(o.city_id, public.default_city_id()),
  settings_json = o.settings_json || jsonb_strip_nulls(jsonb_build_object(
    'sample_listed', true,
    'psira_reg', coalesce(nullif(o.settings_json->>'psira_reg', ''), s.psira_reg),
    'partner_note', coalesce(nullif(o.settings_json->>'partner_note', ''), s.partner_note)
  ) || coalesce(s.extra, '{}'::jsonb))
FROM (
  VALUES
    ('Warhawk Security', '4788568', NULL, jsonb_build_object('saps_reg', '26359', 'kind', 'guarding')),
    ('Extreme Security', '1492891', 'Alarm systems & armed response', jsonb_build_object('kind', 'armed_response')),
    ('CCTV Security Surveillance', '4412150', 'SAIDSA ASP-1571 · offsite monitoring', jsonb_build_object('saidsa', 'ASP-1571', 'kind', 'surveillance')),
    ('United Protection Solutions', '3266778', 'Cape Town based · covers Gqeberha', jsonb_build_object('kind', 'guarding')),
    ('Atlas Security', NULL, 'PSIRA-registered', '{}'::jsonb),
    ('Fidelity ADT', NULL, 'PSIRA-registered', '{}'::jsonb),
    ('Algoa Security', NULL, 'PSIRA-registered', '{}'::jsonb),
    ('Armand Protection Services', NULL, 'PSIRA-registered', '{}'::jsonb),
    ('Xhobani Security', NULL, 'PSIRA-registered', '{}'::jsonb),
    ('M Security Services', NULL, 'PSIRA-registered', '{}'::jsonb),
    ('Tacnet', NULL, 'Theescombe partner', jsonb_build_object('theescombe_partner', true))
) AS s(name, psira_reg, partner_note, extra)
WHERE o.type = 'security_company'
  AND lower(trim(o.name)) = lower(s.name);

-- Tacnet covers the live Theescombe neighborhood.
INSERT INTO public.security_assignments (
  security_company_id,
  suburb_id,
  assignment_type,
  active
)
SELECT o.id, s.id, 'primary', true
FROM public.organizations o
JOIN public.suburbs s ON lower(s.name) = 'theescombe'
WHERE o.type = 'security_company'
  AND lower(trim(o.name)) = 'tacnet'
ON CONFLICT (security_company_id, suburb_id) DO UPDATE
SET active = true,
    assignment_type = EXCLUDED.assignment_type;

UPDATE public.organizations o
SET primary_suburb_id = s.id
FROM public.suburbs s
WHERE o.type = 'security_company'
  AND lower(trim(o.name)) = 'tacnet'
  AND lower(s.name) = 'theescombe'
  AND o.primary_suburb_id IS NULL;

CREATE OR REPLACE FUNCTION public.list_public_signup_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'city', (
      SELECT jsonb_build_object('id', c.id, 'name', c.name)
      FROM public.cities c
      WHERE c.id = public.default_city_id()
    ),
    'areas', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('id', o.id, 'name', o.name)
        ORDER BY o.name
      )
      FROM public.organizations o
      WHERE o.type = 'nw_group'
        AND o.status = 'active'
    ), '[]'::jsonb),
    'security_companies', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'psira_reg', nullif(o.settings_json->>'psira_reg', ''),
          'partner_note', nullif(o.settings_json->>'partner_note', '')
        )
        ORDER BY
          CASE WHEN coalesce(o.settings_json->>'theescombe_partner', '') = 'true' THEN 0 ELSE 1 END,
          o.name
      )
      FROM public.organizations o
      WHERE o.type = 'security_company'
        AND o.status <> 'suspended'
    ), '[]'::jsonb)
  );
$$;
