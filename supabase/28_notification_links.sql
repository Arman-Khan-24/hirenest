-- 28_notification_links.sql
-- Fix clarification and submission notification links to use query param ?subId=
-- so both vendor and admin submission pages open the drawer directly without routing issues.

create or replace function public.request_clarification(
  p_submission_id   uuid,
  p_missing_skills  text[],
  p_questions       text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_vendor uuid;
  v_cand   uuid;
  v_id     uuid;
begin
  if not private.is_internal() then
    raise exception 'only internal recruiters can request candidate clarification';
  end if;

  select vendor_org_id, candidate_id into v_vendor, v_cand
    from public.submissions
   where id = p_submission_id;

  if not found then
    raise exception 'submission not found';
  end if;

  insert into public.submission_clarifications (
      submission_id, requested_by, routed_to_vendor_org_id, routed_to_candidate_id,
      missing_skills, questions)
   values (p_submission_id, auth.uid(), v_vendor, v_cand,
           coalesce(p_missing_skills, '{}'), p_questions)
   returning id into v_id;

  update public.submissions
     set validation_state = 'pending_clarification'
   where id = p_submission_id
     and validation_state <> 'approved';

  if v_vendor is not null then
    perform private.notify_org(v_vendor, 'clarification', 'Clarification requested',
                               'Missing skills follow-up', '/vendor/submissions?subId=' || p_submission_id);
  end if;
  return v_id;
end;
$$;

create or replace function public.transition_submission_gate(
  p_submission_id uuid,
  p_to            public.submission_stage,
  p_reason        text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.submissions;
  r public.requirements;
begin
  select * into s from public.submissions where id = p_submission_id for update;
  if not found then
    raise exception 'submission not found';
  end if;
  select * into r from public.requirements where id = s.requirement_id;

  -- 1. If transitioning to client_review, ensure validation approved
  if p_to = 'client_review' and s.validation_state <> 'approved' then
    raise exception 'cannot transition to client_review until recruiter validation is approved';
  end if;

  update public.submissions
     set stage = p_to,
         shared_with_client_at = case when p_to = 'client_review' and shared_with_client_at is null then now() else shared_with_client_at end,
         updated_at = now()
   where id = p_submission_id;

  insert into public.submission_stage_history (submission_id, from_stage, to_stage, actor_id, actor_role, reason)
  values (s.id, s.stage, p_to, auth.uid(), (select role::text from public.profiles where id = auth.uid()), p_reason);

  perform private.emit_event('SUBMISSION_STAGE_TRANSITIONED', 'submission', s.id,
                             jsonb_build_object('from', s.stage, 'to', p_to));

  if p_to = 'client_review' then
    perform private.notify_org(r.client_org_id, 'submission', 'New candidate for review', r.title,
                               '/client/submissions?subId=' || s.id);
  end if;
  if s.vendor_org_id is not null then
    perform private.notify_org(s.vendor_org_id, 'submission', 'Submission status updated',
                               r.title || ': ' || p_to::text, '/vendor/submissions?subId=' || s.id);
  end if;
end;
$$;
