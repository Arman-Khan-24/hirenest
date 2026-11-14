-- =====================================================================
-- 21_vendor_performance_v2.sql
-- Vendor ranking on four weighted pillars, filterable by date range:
--   1. Acknowledgement  - % of shares acknowledged within ack_sla_hours
--                         (a first submission counts as acknowledgement)
--   2. Submission timing - % of shares first submitted on/before the SLA
--                         (also reports late and missed counts)
--   3. Quality           - client ratings of submitted profiles
--   4. Compliance        - valid + complete submissions
-- Date range (p_from inclusive, p_to exclusive) filters shares by shared_at
-- and submissions by created_at. NULL = all time.
-- The composite averages over the pillars that have enough samples
-- (weights re-normalised) and reports how many pillars it used.
-- =====================================================================

begin;

-- 1. Settings: acknowledgement weight + acknowledgement SLA ---------------
alter table public.platform_settings
  add column if not exists ack_weight    numeric(5,2) not null default 0,
  add column if not exists ack_sla_hours integer      not null default 4
    check (ack_sla_hours between 1 and 168);

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.platform_settings'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%timing_weight%'
  loop
    execute format('alter table public.platform_settings drop constraint %I', c.conname);
  end loop;
end $$;

-- Carve the acknowledgement weight out of the existing timing weight so the
-- total timing influence is unchanged. Trigger off: keep the approver stamp.
alter table public.platform_settings disable trigger stamp_settings;
update public.platform_settings
   set ack_weight = 10,
       timing_weight = timing_weight - 10
 where id = 1 and ack_weight = 0 and timing_weight >= 10;
alter table public.platform_settings enable trigger stamp_settings;

alter table public.platform_settings
  add constraint platform_settings_weights_nonneg
    check (timing_weight >= 0 and quality_weight >= 0 and compliance_weight >= 0 and ack_weight >= 0),
  add constraint platform_settings_weights_sum
    check (timing_weight + quality_weight + compliance_weight + ack_weight = 100);

grant update (ack_weight, ack_sla_hours) on public.platform_settings to authenticated;

create or replace function private.stamp_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_by := auth.uid();
  if new.weights_approved and (not old.weights_approved
      or new.timing_weight <> old.timing_weight
      or new.quality_weight <> old.quality_weight
      or new.compliance_weight <> old.compliance_weight
      or new.ack_weight <> old.ack_weight) then
    new.weights_approved_by := auth.uid();
  elsif not new.weights_approved then
    new.weights_approved_by := null;
  end if;
  return new;
end;
$$;

-- 2. Metrics ---------------------------------------------------------------
drop function if exists private.vendor_metrics(uuid);
drop function if exists public.get_vendor_performance(uuid);
drop function if exists public.admin_vendor_performance(integer, integer);

create or replace function private.vendor_metrics(
  p_vendor uuid, p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  st public.platform_settings;
  v_t record;
  v_quality record;
  v_comp record;
  v_interview_avg numeric;
  v_ack_score numeric;     v_ack_prov numeric;
  v_timing_score numeric;  v_timing_prov numeric;
  v_quality_score numeric; v_quality_prov numeric;
  v_comp_score numeric;    v_comp_prov numeric;
  v_overall numeric;
  v_overall_status text;
  v_num numeric := 0;
  v_wsum numeric := 0;
  v_weighted int := 0;
  v_scored int := 0;
begin
  select * into st from public.platform_settings where id = 1;

  -- A + B. Acknowledgement and submission timing, from the same share rows
  with s as (
    select sh.*,
           (select min(sb.created_at) from public.submissions sb
             where sb.requirement_id = sh.requirement_id
               and sb.vendor_org_id = sh.vendor_org_id
               and sb.is_valid and sb.stage <> 'withdrawn') as first_sub
    from public.requirement_vendor_shares sh
    where sh.vendor_org_id = p_vendor
      and (p_from is null or sh.shared_at >= p_from)
      and (p_to is null or sh.shared_at < p_to)
  ), a as (
    select s.*,
           least(s.acknowledged_at, s.first_sub) as ack_at,
           s.shared_at + make_interval(hours => st.ack_sla_hours) as ack_due
    from s
  ), f as (
    select a.*,
           ((a.first_sub is not null or a.due_at < now())
             and (a.revoked_at is null or a.first_sub is not null)) as t_ok,
           ((a.ack_at is not null or a.ack_due < now())
             and (a.revoked_at is null or a.ack_at is not null)) as a_ok
    from a
  )
  select
    count(*) filter (where t_ok)                                              as t_eval,
    count(*) filter (where t_ok and first_sub <= due_at)                      as t_met,
    count(*) filter (where t_ok and first_sub > due_at)                       as t_late,
    count(*) filter (where t_ok and first_sub is null)                        as t_missed,
    count(*) filter (where t_ok and first_sub <= due_at
                       and shared_at > now() - interval '90 days')            as t_met_90d,
    count(*) filter (where t_ok and shared_at > now() - interval '90 days')   as t_eval_90d,
    round((avg(extract(epoch from (first_sub - shared_at)) / 3600)
           filter (where t_ok and first_sub is not null))::numeric, 1)        as avg_turnaround_hours,
    count(*) filter (where a_ok)                                              as a_eval,
    count(*) filter (where a_ok and ack_at <= ack_due)                        as a_met,
    round((avg(extract(epoch from (ack_at - shared_at)) / 3600)
           filter (where a_ok and ack_at is not null))::numeric, 1)           as avg_response_hours
  into v_t
  from f;

  -- C. Candidate quality (client feedback on submitted candidates)
  select
    count(distinct q.submission_id) as rated_submissions,
    round(avg((q.jd_skill_alignment + q.relevant_experience + q.resume_accuracy
               + q.communication + q.interview_readiness + q.overall_suitability) / 6.0), 2) as avg_rating,
    round(avg(q.jd_skill_alignment), 2)  as jd_skill_alignment,
    round(avg(q.relevant_experience), 2) as relevant_experience,
    round(avg(q.resume_accuracy), 2)     as resume_accuracy,
    round(avg(q.communication), 2)       as communication,
    round(avg(q.interview_readiness), 2) as interview_readiness,
    round(avg(q.overall_suitability), 2) as overall_suitability
  into v_quality
  from public.candidate_quality_feedback q
  join public.submissions sb on sb.id = q.submission_id
  where sb.vendor_org_id = p_vendor and not q.excluded_from_score
    and (p_from is null or sb.created_at >= p_from)
    and (p_to is null or sb.created_at < p_to);

  select round(avg(f.overall_rating), 2) into v_interview_avg
  from public.interview_feedback f
  join public.interviews i on i.id = f.interview_id
  join public.submissions sb on sb.id = i.submission_id
  where sb.vendor_org_id = p_vendor and not f.excluded_from_score
    and (p_from is null or sb.created_at >= p_from)
    and (p_to is null or sb.created_at < p_to);

  -- D. Process compliance (valid + complete submissions)
  select
    count(*) as total,
    count(*) filter (where sb.is_valid and c.resume_path is not null and cardinality(c.skills) > 0) as compliant
  into v_comp
  from public.submissions sb
  join public.candidates c on c.id = sb.candidate_id
  where sb.vendor_org_id = p_vendor and sb.stage <> 'withdrawn'
    and (p_from is null or sb.created_at >= p_from)
    and (p_to is null or sb.created_at < p_to);

  -- Provisional = shown for context even below the minimum sample size.
  v_ack_prov     := case when v_t.a_eval > 0 then round(100.0 * v_t.a_met / v_t.a_eval, 1) end;
  v_timing_prov  := case when v_t.t_eval > 0 then round(100.0 * v_t.t_met / v_t.t_eval, 1) end;
  v_quality_prov := case when v_quality.rated_submissions > 0
                         then round((v_quality.avg_rating - 1) / 4.0 * 100, 1) end;
  v_comp_prov    := case when v_comp.total > 0 then round(100.0 * v_comp.compliant / v_comp.total, 1) end;

  v_ack_score     := case when v_t.a_eval >= st.min_sample_size then v_ack_prov end;
  v_timing_score  := case when v_t.t_eval >= st.min_sample_size then v_timing_prov end;
  v_quality_score := case when v_quality.rated_submissions >= st.min_sample_size then v_quality_prov end;
  v_comp_score    := case when v_comp.total >= st.min_sample_size then v_comp_prov end;

  -- Composite: weighted over pillars that have enough data.
  v_weighted := (st.ack_weight > 0)::int + (st.timing_weight > 0)::int
              + (st.quality_weight > 0)::int + (st.compliance_weight > 0)::int;
  if v_ack_score is not null and st.ack_weight > 0 then
    v_num := v_num + v_ack_score * st.ack_weight; v_wsum := v_wsum + st.ack_weight; v_scored := v_scored + 1;
  end if;
  if v_timing_score is not null and st.timing_weight > 0 then
    v_num := v_num + v_timing_score * st.timing_weight; v_wsum := v_wsum + st.timing_weight; v_scored := v_scored + 1;
  end if;
  if v_quality_score is not null and st.quality_weight > 0 then
    v_num := v_num + v_quality_score * st.quality_weight; v_wsum := v_wsum + st.quality_weight; v_scored := v_scored + 1;
  end if;
  if v_comp_score is not null and st.compliance_weight > 0 then
    v_num := v_num + v_comp_score * st.compliance_weight; v_wsum := v_wsum + st.compliance_weight; v_scored := v_scored + 1;
  end if;

  if not st.weights_approved then
    v_overall_status := 'weights_not_approved';
  elsif v_wsum = 0 then
    v_overall_status := 'not_enough_data';
  else
    v_overall := round(v_num / v_wsum, 1);
    v_overall_status := 'ok';
  end if;

  return jsonb_build_object(
    'vendor_org_id', p_vendor,
    'min_sample_size', st.min_sample_size,
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'ack', jsonb_build_object(
      'status', case when v_ack_score is null then 'not_enough_data' else 'ok' end,
      'score', v_ack_score,
      'provisional_score', v_ack_prov,
      'evaluable_shares', v_t.a_eval,
      'acknowledged_in_sla', v_t.a_met,
      'ack_sla_hours', st.ack_sla_hours,
      'avg_response_hours', v_t.avg_response_hours),
    'timing', jsonb_build_object(
      'status', case when v_timing_score is null then 'not_enough_data' else 'ok' end,
      'score', v_timing_score,
      'provisional_score', v_timing_prov,
      'evaluable_shares', v_t.t_eval,
      'sla_met', v_t.t_met,
      'sla_late', v_t.t_late,
      'sla_missed', v_t.t_missed,
      'sla_compliance_90d_pct', case when v_t.t_eval_90d > 0
                                     then round(100.0 * v_t.t_met_90d / v_t.t_eval_90d, 1) end,
      'avg_response_hours', v_t.avg_response_hours,
      'avg_turnaround_hours', v_t.avg_turnaround_hours),
    'quality', jsonb_build_object(
      'status', case when v_quality_score is null then 'not_enough_data' else 'ok' end,
      'score', v_quality_score,
      'provisional_score', v_quality_prov,
      'rated_submissions', v_quality.rated_submissions,
      'avg_rating_1_to_5', v_quality.avg_rating,
      'dimensions', jsonb_build_object(
        'jd_skill_alignment', v_quality.jd_skill_alignment,
        'relevant_experience', v_quality.relevant_experience,
        'resume_accuracy', v_quality.resume_accuracy,
        'communication', v_quality.communication,
        'interview_readiness', v_quality.interview_readiness,
        'overall_suitability', v_quality.overall_suitability),
      'avg_interview_overall_1_to_5', v_interview_avg),
    'compliance', jsonb_build_object(
      'status', case when v_comp_score is null then 'not_enough_data' else 'ok' end,
      'score', v_comp_score,
      'provisional_score', v_comp_prov,
      'submissions', v_comp.total,
      'compliant', v_comp.compliant),
    'overall', jsonb_build_object(
      'status', v_overall_status,
      'score', v_overall,
      'pillars_scored', v_scored,
      'pillars_weighted', v_weighted,
      'partial', v_scored < v_weighted,
      'weights', jsonb_build_object('ack', st.ack_weight, 'timing', st.timing_weight,
                                    'quality', st.quality_weight, 'compliance', st.compliance_weight,
                                    'approved', st.weights_approved))
  );
end;
$$;

-- 3. RPCs ---------------------------------------------------------------------
create or replace function public.get_vendor_performance(
  p_vendor_org_id uuid, p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_metrics jsonb;
begin
  if private.is_internal()
     or (private.is_vendor_user() and private.my_org() = p_vendor_org_id) then
    return private.vendor_metrics(p_vendor_org_id, p_from, p_to);
  end if;

  if private.is_client_user()
     and (select share_vendor_summary_with_clients from public.platform_settings where id = 1)
     and private.can_view_org(p_vendor_org_id) then
    v_metrics := private.vendor_metrics(p_vendor_org_id, p_from, p_to);
    return jsonb_build_object('vendor_org_id', p_vendor_org_id, 'overall', v_metrics -> 'overall');
  end if;

  raise exception 'FORBIDDEN' using errcode = '42501';
end;
$$;

create or replace function public.admin_vendor_performance(
  p_limit integer default 50, p_offset integer default 0,
  p_from timestamptz default null, p_to timestamptz default null)
returns table (vendor_org_id uuid, vendor_name text, metrics jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_internal() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select o.id, o.name, private.vendor_metrics(o.id, p_from, p_to)
    from public.organizations o
    where o.type = 'vendor' and o.status = 'approved'
    order by o.name
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

revoke execute on function private.vendor_metrics(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.get_vendor_performance(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.admin_vendor_performance(integer, integer, timestamptz, timestamptz) from public, anon;
grant execute on function private.vendor_metrics(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.get_vendor_performance(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_vendor_performance(integer, integer, timestamptz, timestamptz) to authenticated;

commit;
