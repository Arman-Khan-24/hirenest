-- 29_reusable_candidates_and_withdrawn_gate.sql
-- 1. Updates validation_state and synchronizes decision gates on rejected/withdrawn submissions.
-- 2. Allows candidates whose prior submission was rejected or withdrawn to re-match and be submitted to upcoming/open requirements.
-- 3. Triggers auto-match recomputation when a candidate is released or rejected.

-- 1. Update submit_candidate to ignore rejected or withdrawn previous submissions
create or replace function public.submit_candidate(
  p_requirement_id uuid, p_candidate_id uuid, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.requirements;
  v_source public.candidate_source;
  v_vendor uuid;
  v_existing uuid;
  v_id uuid;
begin
  select * into r from public.requirements where id = p_requirement_id;
  if r.id is null or r.status <> 'open' then
    raise exception 'Requirement is not open for submissions';
  end if;

  if private.is_vendor_user() then
    v_source := 'vendor';
    v_vendor := private.my_org();
    if not exists (select 1 from public.requirement_vendor_shares s
                   where s.requirement_id = r.id and s.vendor_org_id = v_vendor and s.revoked_at is null) then
      raise exception 'FORBIDDEN: requirement is not shared with your agency' using errcode = '42501';
    end if;
    if not exists (select 1 from public.candidates c where c.id = p_candidate_id and c.owner_vendor_org_id = v_vendor) then
      raise exception 'FORBIDDEN: candidate is not associated with your agency' using errcode = '42501';
    end if;
  elsif private.is_internal() then
    v_source := 'internal';
    v_vendor := null;
  else
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Only block if candidate has an ACTIVE (non-rejected, non-withdrawn) submission for this requirement
  select id into v_existing from public.submissions
   where requirement_id = p_requirement_id
     and candidate_id = p_candidate_id
     and stage not in ('rejected', 'withdrawn');

  if v_existing is not null then
    insert into public.duplicate_flags (kind, match_type, existing_candidate_id, requirement_id, attempted_by, attempted_org_id)
    values ('submission', 'same_requirement', p_candidate_id, p_requirement_id, auth.uid(), private.my_org());
    perform private.notify_org(private.internal_org(), 'duplicate', 'Duplicate submission attempt',
                               r.title, '/admin/duplicates');
    return jsonb_build_object('status', 'duplicate', 'reason', 'Candidate is already in the pipeline for this requirement');
  end if;

  insert into public.submissions (requirement_id, candidate_id, source, vendor_org_id, submitted_by, stage, notes, validation_state)
  values (p_requirement_id, p_candidate_id, v_source, v_vendor, auth.uid(), 'recruiter_review', p_notes, 'pending_assessment')
  returning id into v_id;

  insert into public.submission_stage_history (submission_id, from_stage, to_stage, actor_id, actor_role, reason)
  values (v_id, null, 'recruiter_review', auth.uid(), private.my_role(), 'Submitted');

  insert into public.submission_assessments (submission_id) values (v_id);

  perform private.emit_event('SUBMISSION_CREATED', 'submission', v_id,
                             jsonb_build_object('source', v_source, 'vendor_org_id', v_vendor),
                             'SUBMISSION_CREATED:' || v_id);
  perform private.notify_org(private.internal_org(), 'submission', 'New candidate submission',
                             r.title, '/admin/submissions?subId=' || v_id);
  return jsonb_build_object('status', 'created', 'submission_id', v_id);
end;
$$;

-- 2. Update apply_direct to ignore rejected or withdrawn previous submissions
create or replace function public.apply_direct(p_requirement_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.requirements;
  v_cand uuid := private.my_candidate_id();
  v_id uuid;
begin
  if v_cand is null then
    raise exception 'Create your candidate profile before applying';
  end if;
  select * into r from public.requirements where id = p_requirement_id;
  if r.id is null or r.status <> 'open' or not r.is_public then
    raise exception 'This requirement is not open for direct applications';
  end if;

  -- Only block if candidate has an ACTIVE (non-rejected, non-withdrawn) submission for this requirement
  if exists (select 1 from public.submissions
             where requirement_id = p_requirement_id
               and candidate_id = v_cand
               and stage not in ('rejected', 'withdrawn')) then
    return jsonb_build_object('status', 'duplicate', 'reason', 'You are already in the active pipeline for this requirement');
  end if;

  insert into public.submissions (requirement_id, candidate_id, source, vendor_org_id, submitted_by, stage, validation_state)
  values (p_requirement_id, v_cand, 'direct', null, auth.uid(), 'recruiter_review', 'pending_assessment')
  returning id into v_id;

  insert into public.submission_stage_history (submission_id, from_stage, to_stage, actor_id, actor_role, reason)
  values (v_id, null, 'recruiter_review', auth.uid(), 'candidate', 'Direct application - routed to Admin review');

  insert into public.submission_assessments (submission_id) values (v_id);

  perform private.emit_event('DIRECT_APPLICATION_CREATED', 'submission', v_id, '{}'::jsonb,
                             'DIRECT_APPLICATION_CREATED:' || v_id);
  perform private.notify_org(private.internal_org(), 'submission', 'New direct application',
                             r.title, '/admin/submissions?subId=' || v_id);
  return jsonb_build_object('status', 'created', 'submission_id', v_id);
end;
$$;

-- 3. Update transition_submission_gate to synchronize validation_state and re-match released candidates
create or replace function public.transition_submission_gate(
  p_submission_id uuid,
  p_to            public.submission_stage,
  p_reason        text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.submissions;
  r public.requirements;
  v_allowed boolean := false;
  v_new_validation_state public.submission_validation_state;
begin
  select * into s from public.submissions where id = p_submission_id for update;
  if not found then
    raise exception 'submission not found';
  end if;
  select * into r from public.requirements where id = s.requirement_id;

  -- Client review gate
  if p_to = 'client_review' and s.validation_state <> 'approved' then
    raise exception 'cannot transition to client_review until recruiter validation is approved';
  end if;

  if private.is_internal() then
    v_allowed := true;
  elsif private.is_submission_client(s.id) then
    v_allowed := (s.stage::text || '>' || p_to::text) = any (array[
      'client_review>interviewing', 'client_review>rejected', 'interviewing>offered', 'interviewing>rejected']);
  elsif p_to = 'withdrawn' and (
          (private.is_vendor_user() and s.vendor_org_id = private.my_org())
          or s.candidate_id = private.my_candidate_id()) then
    v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'FORBIDDEN: you cannot move this submission to %', p_to using errcode = '42501';
  end if;

  if p_to = 'rejected' then
    v_new_validation_state := 'rejected_by_recruiter'::public.submission_validation_state;
  else
    v_new_validation_state := s.validation_state;
  end if;

  update public.submissions
     set stage = p_to,
         stage_changed_at = now(),
         validation_state = v_new_validation_state,
         shared_with_client_at = case when p_to = 'client_review' and shared_with_client_at is null then now() else shared_with_client_at end,
         updated_at = now()
   where id = s.id;

  -- Abandon open clarifications and recompute matches for released candidate
  if p_to in ('rejected', 'withdrawn') then
    update public.submission_clarifications
       set status = 'abandoned'
     where submission_id = s.id
       and status = 'open';

    perform private.recompute_for_candidate(s.candidate_id);
  end if;

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

-- 4. Clean up any existing rejected submissions in database
update public.submissions
   set validation_state = 'rejected_by_recruiter'::public.submission_validation_state
 where stage = 'rejected'
   and (validation_state is null or validation_state <> 'rejected_by_recruiter');

-- Abandon any leftover open clarifications for closed submissions
update public.submission_clarifications
   set status = 'abandoned'
 where status = 'open'
   and submission_id in (select id from public.submissions where stage in ('rejected', 'withdrawn'));
