-- Residents may only set pending / clear a pending request. Staff review via RPC.

CREATE OR REPLACE FUNCTION public.trg_guard_patroller_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.patroller_request_status IS NOT DISTINCT FROM OLD.patroller_request_status
     AND NEW.patroller_request_reviewed_by IS NOT DISTINCT FROM OLD.patroller_request_reviewed_by
     AND NEW.patroller_request_reviewed_at IS NOT DISTINCT FROM OLD.patroller_request_reviewed_at THEN
    RETURN NEW;
  END IF;

  IF public.can_review_patroller_requests() THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NEW.patroller_request_status IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_guard_patroller_request ON public.resident_profiles;
CREATE TRIGGER zzz_guard_patroller_request
  BEFORE UPDATE OF patroller_request_status, patroller_request_reviewed_at, patroller_request_reviewed_by
  ON public.resident_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_guard_patroller_request();

NOTIFY pgrst, 'reload schema';
