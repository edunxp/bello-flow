BEGIN;

CREATE FUNCTION public.purge_expired_audit_events()
RETURNS TABLE (cutoff_at TIMESTAMPTZ, removed_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
SET timezone = 'UTC'
AS $function$
  WITH retention AS (
    SELECT statement_timestamp() - INTERVAL '24 months' AS cutoff
  ), removed AS (
    DELETE FROM public.audit_event AS event
    USING retention
    WHERE event.occurred_at < retention.cutoff
    RETURNING 1
  )
  SELECT retention.cutoff, (SELECT count(*) FROM removed)
  FROM retention;
$function$;

REVOKE ALL ON FUNCTION public.purge_expired_audit_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_audit_events() TO bello_audit_maintenance;

COMMIT;
