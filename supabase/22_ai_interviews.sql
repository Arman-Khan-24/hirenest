-- =====================================================================
-- 22_ai_interviews.sql
-- AI-conducted written interview (first-round screening) for a submission.
--
-- Flow: HQ staff creates a session (server returns a one-time link) ->
-- candidate opens the link, consents, answers adaptive questions ->
-- server evaluates the transcript -> HQ staff reviews the advisory result.
--
-- Security model:
--   * The candidate is NOT a database user. Candidate access goes through the
--     server only, using the invite token; only the SHA-256 hash is stored.
--   * All writes use the service role. Authenticated users get read-only
--     access to HQ staff, and never to token_hash.
--   * Ratings are advisory; a recruiter decides.
-- Safe to re-run.
-- =====================================================================

create table if not exists public.ai_interview_sessions (
  id                  uuid primary key default gen_random_uuid(),
  token_hash          text not null unique,
  submission_id       uuid not null references public.submissions (id) on delete cascade,
  interview_id        uuid references public.interviews (id) on delete set null,
  status              text not null default 'invited'
                      check (status in ('invited', 'in_progress', 'completed', 'expired', 'cancelled')),
  max_questions       smallint not null default 8 check (max_questions between 3 and 15),
  expires_at          timestamptz not null,
  consent_at          timestamptz,
  consent_version     text,
  started_at          timestamptz,
  completed_at        timestamptz,
  turns               jsonb not null default '[]'::jsonb,
  evaluation          jsonb,
  skill_rating        smallint check (skill_rating between 1 and 5),
  communication_rating smallint check (communication_rating between 1 and 5),
  overall_rating      smallint check (overall_rating between 1 and 5),
  recommendation      text check (recommendation in ('advance', 'hold', 'reject')),
  question_source     text not null default 'ai' check (question_source in ('ai', 'template', 'mixed')),
  model_name          text,
  prompt_version      text,
  error               text,
  version             integer not null default 0,
  invite_email_sent_at timestamptz,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (status not in ('in_progress', 'completed') or consent_at is not null)
);

create index if not exists ai_interview_sessions_submission
  on public.ai_interview_sessions (submission_id, created_at desc);
create index if not exists ai_interview_sessions_status
  on public.ai_interview_sessions (status, expires_at);

alter table public.ai_interview_sessions enable row level security;

drop policy if exists ai_interview_select on public.ai_interview_sessions;
create policy ai_interview_select on public.ai_interview_sessions
  for select to authenticated using (private.is_internal());

-- No client-side writes: the server (service role) owns every mutation.
revoke all on public.ai_interview_sessions from anon, authenticated;
grant select (
  id, submission_id, interview_id, status, max_questions, expires_at, consent_at, consent_version,
  started_at, completed_at, turns, evaluation, skill_rating, communication_rating, overall_rating,
  recommendation, question_source, model_name, prompt_version, error, invite_email_sent_at,
  created_by, created_at, updated_at
) on public.ai_interview_sessions to authenticated;
