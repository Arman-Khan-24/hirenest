-- =====================================================================
-- 27_fix_requirements_permissions.sql
-- Grant full table DML privileges on requirements & financial tables to
-- authenticated role. Row-level security (RLS) policies continue to
-- enforce strict role, org, and tenant authorization on every operation.
-- =====================================================================

GRANT ALL ON public.requirements TO authenticated;
GRANT ALL ON public.requirement_financials TO authenticated;
GRANT ALL ON public.requirement_margins TO authenticated;
GRANT ALL ON public.requirement_vendor_shares TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Ensure Internal / Unmapped organization is approved
UPDATE public.organizations
   SET status = 'approved'
 WHERE name = 'Internal / Unmapped'
   AND status != 'approved';
