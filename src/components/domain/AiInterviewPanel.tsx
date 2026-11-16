import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Copy, ExternalLink, Link2, Mail } from 'lucide-react';
import { Badge, Button, Select, TableSkeleton, ErrorState } from '../ui/kit';
import { useToast } from '../ui/Toast';
import { mapSupabaseError } from '../../lib/errors';
import {
  aiInterviewApi,
  type AiInterviewSession,
  type AiInterviewStatus,
  type AiRecommendation,
  type CreateAiInterviewResult,
} from '../../api/aiInterviews';

const STATUS_META: Record<AiInterviewStatus, { label: string; tone: 'info' | 'amber' | 'emerald' | 'neutral' | 'red' }> = {
  invited: { label: 'Waiting for candidate', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'amber' },
  completed: { label: 'Completed', tone: 'emerald' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

const REC_META: Record<AiRecommendation, { label: string; tone: 'emerald' | 'amber' | 'red' }> = {
  advance: { label: 'Suggests advancing', tone: 'emerald' },
  hold: { label: 'Suggests holding', tone: 'amber' },
  reject: { label: 'Suggests not advancing', tone: 'red' },
};

const LEVEL_TONE = { proven: 'emerald', partial: 'amber', unproven: 'neutral' } as const;

const ERROR_TEXT: Record<string, string> = {
  insufficient_input: 'The candidate gave too little written input to evaluate. Review the transcript manually.',
  ai_unavailable: 'The AI provider was unavailable, so no evaluation was produced. Questions came from a fixed template. Review the transcript manually, or re-run the evaluation.',
  evaluation_failed: 'The AI evaluation failed. Review the transcript manually, or re-run the evaluation.',
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

const List: React.FC<{ title: string; items: string[]; tone?: string }> = ({ title, items, tone }) =>
  items.length ? (
    <div>
      <div className="text-[12px] font-medium text-[var(--text-secondary)]">{title}</div>
      <ul className={`mt-1 list-disc space-y-1 pl-5 text-[13px] leading-[20px] ${tone || 'text-[var(--text-primary)]'}`}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  ) : null;

const Rating: React.FC<{ label: string; value: number | null }> = ({ label, value }) => (
  <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3">
    <div className="text-[12px] text-[var(--text-secondary)]">{label}</div>
    <div className="mt-0.5 font-mono text-[22px] font-semibold tabular-nums">
      {value ?? '-'}
      <span className="text-[13px] font-normal text-[var(--text-tertiary)]"> / 5</span>
    </div>
  </div>
);

const SessionCard: React.FC<{
  s: AiInterviewSession;
  onChanged: () => void;
  onLink: (r: CreateAiInterviewResult) => void;
}> = ({ s, onChanged, onLink }) => {
  const { toast } = useToast();
  const meta = STATUS_META[s.status];
  const fail = (title: string) => (e: unknown) => toast({ title, description: mapSupabaseError(e), tone: 'error' });

  const cancel = useMutation({
    mutationFn: () => aiInterviewApi.cancel(s.id),
    onSuccess: () => {
      toast({ title: 'AI interview cancelled', tone: 'success' });
      onChanged();
    },
    onError: fail('Could not cancel'),
  });
  const regen = useMutation({
    mutationFn: (sendEmail: boolean) => aiInterviewApi.regenerateLink(s.id, sendEmail),
    onSuccess: (r) => {
      onLink(r);
      onChanged();
    },
    onError: fail('Could not issue a new link'),
  });
  const evaluate = useMutation({
    mutationFn: () => aiInterviewApi.evaluate(s.id),
    onSuccess: () => {
      toast({ title: 'Evaluation re-run', tone: 'success' });
      onChanged();
    },
    onError: fail('Could not evaluate'),
  });

  const ev = s.evaluation;
  const canReissue = !s.consent_at && (s.status === 'invited' || s.status === 'expired');

  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="text-[12px] text-[var(--text-secondary)]">
            {s.answered}/{s.max_questions} answered · created {fmt(s.created_at)}
          </span>
          {s.question_source !== 'ai' && (
            <Badge tone="neutral">{s.question_source === 'template' ? 'Template questions' : 'Some template questions'}</Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canReissue && (
            <Button size="sm" variant="outline" loading={regen.isPending} onClick={() => regen.mutate(false)}>
              <Link2 className="h-3.5 w-3.5" /> New link
            </Button>
          )}
          {canReissue && (
            <Button size="sm" variant="outline" loading={regen.isPending} onClick={() => regen.mutate(true)}>
              <Mail className="h-3.5 w-3.5" /> New link + email
            </Button>
          )}
          {(s.status === 'invited' || s.status === 'in_progress') && (
            <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {s.status === 'invited' && (
        <p className="text-[13px] text-[var(--text-secondary)]">
          Link valid until {fmt(s.expires_at)}. The candidate has not started yet.
          {s.invite_email_sent_at ? ` Invitation emailed ${fmt(s.invite_email_sent_at)}.` : ''}
        </p>
      )}
      {s.status === 'in_progress' && (
        <p className="text-[13px] text-[var(--text-secondary)]">
          Started {fmt(s.started_at)}. This page refreshes automatically.
        </p>
      )}

      {s.status === 'completed' && (
        <div className="space-y-4">
          {ev ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {s.recommendation && <Badge tone={REC_META[s.recommendation].tone}>{REC_META[s.recommendation].label}</Badge>}
                <span className="text-[12px] text-[var(--text-tertiary)]">AI suggestion only. The decision is yours.</span>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <Rating label="Role skill" value={s.skill_rating} />
                <Rating label="Written communication" value={s.communication_rating} />
                <Rating label="Overall" value={s.overall_rating} />
              </div>
              <p className="text-[14px] leading-[22px]">{ev.summary}</p>
              {ev.skill_evidence.length > 0 && (
                <div>
                  <div className="text-[12px] font-medium text-[var(--text-secondary)]">Evidence by skill</div>
                  <div className="mt-1.5 divide-y divide-[var(--border)] rounded-[8px] border border-[var(--border)]">
                    {ev.skill_evidence.map((e, i) => (
                      <div key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                        <div className="min-w-0 text-[13px] leading-[20px]">
                          <span className="font-medium">{e.skill}</span>
                          <span className="text-[var(--text-secondary)]"> · {e.evidence}</span>
                        </div>
                        <Badge tone={LEVEL_TONE[e.level]}>{e.level}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <List title="Strengths" items={ev.strengths} />
                <List title="Gaps" items={ev.gaps} />
                <List title="Suggested follow-ups for the next round" items={ev.follow_ups} />
                <List title="Verify (observations, not conclusions)" items={ev.concerns} tone="text-amber-700" />
              </div>
            </>
          ) : (
            <div className="rounded-[10px] border border-amber-300/60 bg-amber-50 p-3 text-[13px] leading-[20px] text-amber-900">
              {ERROR_TEXT[s.error || ''] || 'No evaluation is available. Review the transcript manually.'}
              {s.error !== 'insufficient_input' && (
                <div className="mt-2">
                  <Button size="sm" variant="outline" loading={evaluate.isPending} onClick={() => evaluate.mutate()}>
                    Re-run evaluation
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {s.turns.length > 0 && (
        <details className="group rounded-[10px] border border-[var(--border)]" open={s.status === 'in_progress'}>
          <summary className="cursor-pointer select-none px-3 py-2 text-[13px] font-medium">
            Transcript ({s.answered} answers)
          </summary>
          <div className="space-y-3 border-t border-[var(--border)] p-3">
            {s.turns.map((t, i) =>
              t.role === 'ai' ? (
                <div key={i} className="text-[13px] leading-[20px]">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                    Q{t.n}
                    {t.topic ? ` · ${t.topic}` : ''}
                  </div>
                  {t.text}
                </div>
              ) : (
                <div key={i} className="rounded-[8px] bg-[var(--bg-subtle)] p-2.5 text-[13px] leading-[20px]">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
                    <span className="font-semibold uppercase tracking-wide">Answer {t.n}</span>
                    {typeof t.seconds === 'number' && t.seconds > 0 && <span>{t.seconds}s</span>}
                    {t.signal && <Badge tone={t.signal === 'strong' ? 'emerald' : t.signal === 'adequate' ? 'info' : 'amber'}>{t.signal.replace('_', ' ')}</Badge>}
                    {t.pasted && <Badge tone="neutral">pasted text</Badge>}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{t.text}</div>
                </div>
              )
            )}
          </div>
        </details>
      )}
    </div>
  );
};

export const AiInterviewPanel: React.FC<{ submissionId: string; candidateName: string }> = ({ submissionId, candidateName }) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [questions, setQuestions] = useState('8');
  const [hours, setHours] = useState('72');
  const [sendEmail, setSendEmail] = useState(true);
  const [lastLink, setLastLink] = useState<CreateAiInterviewResult | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ai_interviews', submissionId],
    queryFn: () => aiInterviewApi.list(submissionId),
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'in_progress' || s.status === 'invited') ? 8000 : false),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['ai_interviews', submissionId] });

  const showResult = (r: CreateAiInterviewResult) => {
    setLastLink(r);
    if (r.emailSent) toast({ title: 'Invitation emailed to the candidate', tone: 'success' });
    else if (r.emailError) toast({ title: 'Link created, email not sent', description: r.emailError, tone: 'error' });
  };

  const create = useMutation({
    mutationFn: () =>
      aiInterviewApi.create({ submissionId, maxQuestions: Number(questions), expiresInHours: Number(hours), sendEmail }),
    onSuccess: (r) => {
      showResult(r);
      refresh();
    },
    onError: (e) => toast({ title: 'Could not create the AI interview', description: mapSupabaseError(e), tone: 'error' }),
  });

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: 'Link copied', tone: 'success' });
    } catch {
      window.prompt('Copy this link', link);
    }
  };

  const sessions = data || [];
  const busy = sessions.some((s) => s.status === 'in_progress');

  return (
    <div className="space-y-5">
      <div>
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          <Bot className="h-4 w-4 text-[var(--accent)]" /> AI interview
        </h3>
        <p className="mt-1 text-[13px] leading-[20px] text-[var(--text-secondary)]">
          {candidateName} answers adaptive written questions on their own device. The AI then drafts an evidence-based
          assessment for you to review. It never decides: ratings are advisory and the transcript is always available.
        </p>
      </div>

      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Number of questions"
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            options={[
              { value: '5', label: '5 questions (about 12 min)' },
              { value: '8', label: '8 questions (about 20 min)' },
              { value: '10', label: '10 questions (about 25 min)' },
              { value: '12', label: '12 questions (about 30 min)' },
            ]}
          />
          <Select
            label="Link valid for"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            options={[
              { value: '24', label: '24 hours' },
              { value: '72', label: '3 days' },
              { value: '168', label: '7 days' },
            ]}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            className="h-4 w-4 accent-[var(--primary-bg)]"
          />
          Email the invitation to the candidate
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button loading={create.isPending} disabled={busy} onClick={() => create.mutate()}>
            <Bot className="h-3.5 w-3.5" /> Create AI interview
          </Button>
          {busy && <span className="text-[12px] text-[var(--text-secondary)]">An interview is in progress for this submission.</span>}
        </div>

        {lastLink && (
          <div className="rounded-[10px] border border-[var(--ai-block-border)] bg-[var(--ai-block-bg)] p-3 space-y-2">
            <div className="text-[12px] font-medium text-[var(--text-secondary)]">
              Candidate link. Copy it now: it is shown only once. You can issue a new one until the candidate starts.
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={lastLink.link}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Candidate interview link"
                className="h-9 min-w-0 flex-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 font-mono text-[12px]"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => copy(lastLink.link)}>
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
                <a href={lastLink.link} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" type="button">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </Button>
                </a>
              </div>
            </div>
            <div className="text-[12px] text-[var(--text-secondary)]">
              {lastLink.emailSent
                ? 'Invitation emailed to the candidate.'
                : lastLink.emailError
                  ? `Email not sent: ${lastLink.emailError} Share the link yourself.`
                  : 'Share this link with the candidate (WhatsApp, email).'}
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton rows={2} cols={3} />
      ) : error ? (
        <ErrorState message={mapSupabaseError(error)} onRetry={() => refetch()} />
      ) : sessions.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-[var(--border-strong)] p-4 text-center text-[13px] text-[var(--text-secondary)]">
          No AI interviews for this submission yet.
        </p>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard key={s.id} s={s} onChanged={refresh} onLink={showResult} />
          ))}
        </div>
      )}
    </div>
  );
};
