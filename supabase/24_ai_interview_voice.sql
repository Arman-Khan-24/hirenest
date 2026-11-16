-- =====================================================================
-- 24_ai_interview_voice.sql
-- Voice + video AI interview (proctored), recordings, integrity events and a
-- client-shareable screening scorecard. Builds on 22_ai_interviews.sql.
--
--   * Per-answer recordings live in a PRIVATE storage bucket; only the server
--     (service role) reads/writes them. Candidates upload via short-lived signed
--     upload URLs the server issues; staff play back via signed read URLs.
--   * Integrity events (tab switches, paste, camera drops) are append-only.
--   * Clients never read these tables: they see only a scorecard the server
--     builds from sessions HQ has explicitly shared.
-- Safe to re-run.
-- =====================================================================

alter table public.ai_interview_sessions
  add column if not exists mode text not null default 'text',
  add column if not exists max_answer_seconds smallint not null default 180,
  add column if not exists last_seen_at timestamptz,
  add column if not exists client_summary text,
  add column if not exists shared_with_client_at timestamptz,
  add column if not exists shared_by uuid references auth.users (id) on delete set null,
  add column if not exists recordings_expire_at timestamptz;

alter table public.ai_interview_sessions drop constraint if exists ai_interview_sessions_mode_check;
alter table public.ai_interview_sessions
  add constraint ai_interview_sessions_mode_check check (mode in ('text', 'voice_video'));
alter table public.ai_interview_sessions drop constraint if exists ai_interview_sessions_answer_seconds_check;
alter table public.ai_interview_sessions
  add constraint ai_interview_sessions_answer_seconds_check check (max_answer_seconds between 30 and 600);

grant select (mode, max_answer_seconds, last_seen_at, client_summary, shared_with_client_at, shared_by, recordings_expire_at)
  on public.ai_interview_sessions to authenticated;

-- One row per recorded answer ------------------------------------------------
create table if not exists public.ai_interview_recordings (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.ai_interview_sessions (id) on delete cascade,
  question_no      smallint not null check (question_no between 1 and 15),
  video_path       text,
  audio_path       text,
  video_mime       text,
  video_bytes      bigint,
  audio_bytes      bigint,
  duration_seconds numeric(7,1),
  status           text not null default 'uploaded' check (status in ('uploaded', 'analyzed', 'failed', 'deleted')),
  transcript       text,
  analysis         jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  unique (session_id, question_no)
);
create index if not exists ai_interview_recordings_session on public.ai_interview_recordings (session_id);

-- Integrity events (append-only) -----------------------------------------------
create table if not exists public.ai_interview_events (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.ai_interview_sessions (id) on delete cascade,
  at          timestamptz not null default now(),
  type        text not null check (type in (
                'tab_hidden', 'tab_visible', 'window_blur', 'window_focus', 'paste', 'copy',
                'camera_lost', 'mic_lost', 'devices_restored', 'page_reload', 'fullscreen_exit')),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 86400000),
  question_no smallint,
  detail      text
);
create index if not exists ai_interview_events_session on public.ai_interview_events (session_id, at);

alter table public.ai_interview_recordings enable row level security;
alter table public.ai_interview_events enable row level security;

drop policy if exists ai_interview_recordings_select on public.ai_interview_recordings;
create policy ai_interview_recordings_select on public.ai_interview_recordings
  for select to authenticated using (private.is_internal());
drop policy if exists ai_interview_events_select on public.ai_interview_events;
create policy ai_interview_events_select on public.ai_interview_events
  for select to authenticated using (private.is_internal());

revoke all on public.ai_interview_recordings from anon, authenticated;
revoke all on public.ai_interview_events from anon, authenticated;
grant select on public.ai_interview_recordings to authenticated;
grant select on public.ai_interview_events to authenticated;

-- Private bucket for recordings (no storage.objects policies = service role only) -----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ai-interview-recordings', 'ai-interview-recordings', false, 52428800,
  array['video/webm', 'video/mp4', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/mp4']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
