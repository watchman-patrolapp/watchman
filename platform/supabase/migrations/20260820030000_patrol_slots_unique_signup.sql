-- Prevent duplicate sign-ups for the same volunteer in the same window.
-- Partial unique index: one row per (org, date, start, volunteer).
-- Existing data may already have duplicates from double-clicks / race signups.

-- Keep the earliest row (smallest id) in each duplicate group; drop the rest.
DELETE FROM public.patrol_slots
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY organization_id, date, start_time, volunteer_uid
        ORDER BY id ASC
      ) AS rn
    FROM public.patrol_slots
    WHERE volunteer_uid IS NOT NULL
      AND organization_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS patrol_slots_org_date_start_volunteer_uidx
  ON public.patrol_slots (organization_id, date, start_time, volunteer_uid)
  WHERE volunteer_uid IS NOT NULL AND organization_id IS NOT NULL;
