-- 30_dashboard_activity_links.sql
-- Backfill saved notification URLs to routes that exist in the current app.
-- Safe to run more than once; only matching legacy links are changed.

-- Client submissions are reviewed in the client candidate pipeline.
update public.notifications
   set link = regexp_replace(link, '^/client/submissions', '/client/candidates')
 where kind = 'submission'
   and link ~ '^/client/submissions([/?]|$)';

-- Feedback notifications use an interview UUID in the old path form. The UI
-- opens the matching interview feedback record from the interview list.
update public.notifications
   set link = '/client/interviews?interviewId=' ||
              (regexp_match(link, '^/client/interviews/([0-9a-fA-F-]{36})/?$'))[1]
 where kind = 'feedback'
   and link ~ '^/client/interviews/[0-9a-fA-F-]{36}/?$';

-- Older vendor interview notifications point to the related submission. Keep
-- that exact submission context and open it from the vendor interviews list.
with legacy_vendor_interviews as (
  select n.id as notification_id, i.submission_id
    from public.notifications n
    join lateral regexp_match(n.link, '^/vendor/submissions/([0-9a-fA-F-]{36})/?$') m on true
    join public.interviews i on i.submission_id = m[1]::uuid
   where n.kind = 'interview'
)
update public.notifications n
   set link = '/vendor/interviews?submissionId=' || l.submission_id::text
  from legacy_vendor_interviews l
 where n.id = l.notification_id;
