-- =====================================================================
-- 23_public_job_sla.sql
-- Public job page shows the vendor submission SLA (hours) for the job.
-- get_public_requirement gains a column, so it must be dropped first.
-- Safe to re-run.
-- =====================================================================

drop function if exists public.get_public_requirement(text);
create function public.get_public_requirement(p_slug text)
returns table (
  id uuid, slug text, title text, description text, skills text[],
  min_experience numeric(4,1), max_experience numeric(4,1),
  location text, work_mode text, employment_type text, openings integer,
  currency text, client_org_name text, posted_at timestamptz,
  submission_sla_hours integer
) language sql stable security definer set search_path = '' as $$
  select r.id, r.slug, r.title, r.description, r.skills,
         r.min_experience, r.max_experience, r.location, r.work_mode,
         r.employment_type, r.openings,
         split_part(r.currency, '|', 1)
           || coalesce('|cat=' || substring(r.currency from '\|cat=(it|non_it)'), '')
           || coalesce('|pt=' || substring(r.currency from '\|pt=(bench|market|both)'), '') as currency,
         'CL-' || upper(left(replace(r.client_org_id::text, '-', ''), 6)) as client_org_name,
         coalesce(r.opened_at, r.created_at) as posted_at,
         r.submission_sla_hours
    from public.requirements r
   where r.slug = p_slug and r.status = 'open' and r.is_public = true;
$$;

grant execute on function public.get_public_requirement(text) to anon, authenticated;
