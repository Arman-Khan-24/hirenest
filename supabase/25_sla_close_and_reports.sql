-- =====================================================================
-- 25_sla_close_and_reports.sql
--  1. Requirements close automatically the moment their submission SLA runs out
--     (counted from the time they were posted / last opened). Runs every 5 minutes
--     inside the database via pg_cron, so it does not wait for the daily app job.
--  2. AI interview: candidate-facing scorecard switch + email tracking.
-- Safe to re-run.
-- =====================================================================

-- 1. Auto-close -------------------------------------------------------------
create or replace function public.close_expired_requirements()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id, title, submission_sla_hours, status
      from public.requirements
     where status = 'open'
       and opened_at is not null
       and opened_at + make_interval(hours => submission_sla_hours) <= now()
     for update skip locked
  loop
    update public.requirements
       set status = 'closed', closed_at = now()
     where id = r.id and status = 'open';

    perform private.emit_event('REQUIREMENT_STATUS_UPDATED', 'requirement', r.id,
                               jsonb_build_object('from', r.status, 'to', 'closed', 'reason', 'SLA expired (auto-close)'));
    perform private.notify_org(
      private.internal_org(), 'sla_auto_close', 'Requirement auto-closed: ' || r.title,
      '"' || r.title || '" was automatically closed after its ' || r.submission_sla_hours
        || '-hour SLA expired. Re-open it from the requirement page to start a new SLA.',
      '/admin/requirements/' || r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.close_expired_requirements() from public, anon, authenticated;

-- Schedule it. pg_cron must be enabled (Supabase: Database -> Extensions -> pg_cron).
do $$
begin
  create extension if not exists pg_cron;
  begin
    perform cron.unschedule('close-expired-requirements');
  exception when others then null;
  end;
  perform cron.schedule('close-expired-requirements', '*/5 * * * *', 'select public.close_expired_requirements();');
  raise notice 'Scheduled close-expired-requirements every 5 minutes.';
exception when others then
  raise notice 'Could not schedule with pg_cron (%). Enable the pg_cron extension, then re-run this file. The daily app job still closes expired requirements.', sqlerrm;
end $$;

-- 2. AI interview reports ----------------------------------------------------
alter table public.ai_interview_sessions
  add column if not exists show_candidate_report boolean not null default true,
  add column if not exists candidate_report_emailed_at timestamptz;

grant select (show_candidate_report, candidate_report_emailed_at) on public.ai_interview_sessions to authenticated;
