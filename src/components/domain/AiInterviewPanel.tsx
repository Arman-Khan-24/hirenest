import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Copy, ExternalLink, Eye, FileText, Link2, Mail, Share2, Trash2, Video } from 'lucide-react';
import { Badge, Button, Dialog, ErrorState, Select, TableSkeleton, Textarea } from '../ui/kit';
import { useToast } from '../ui/Toast';
import { mapSupabaseError } from '../../lib/errors';
import { ScorecardDialog } from './ScreeningScorecard';
import {
  aiInterviewApi,
  type AiInterviewMode,
  type AiInterviewSession,
  type AiInterviewStatus,
  type AiRecommendation,
  type AiRecording,
  type CreateAiInterviewResult,
  type IntegrityLevel,
  type Scorecard,
  type VoiceMetrics,
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

const INTEGRITY_META: Record<IntegrityLevel, { label: string; tone: 'emerald' | 'amber' | 'red' }> = {
  clear: { label: 'No flags', tone: 'emerald' },
  review: { label: 'Review', tone: 'amber' },
  flagged: { label: 'Flagged', tone: 'red' },
};

const LEVEL_TONE = { proven: 'emerald', partial: 'amber', unproven: 'neutral' } as const;

const ERROR_TEXT: Record<string, string> = {
  pending_evaluation: 'The evaluation is being prepared. It runs when the candidate finishes or when you open this page.',
  insufficient_input: 'The candidate gave too little input to evaluate. Review the transcript and recordings manually.',
  ai_unavailable: 'The AI provider was unavailable, so no evaluation was produced. Review the transcript and recordings manually, or re-run the evaluation.',
  evaluation_failed: 'The AI evaluation failed. Review the transcript and recordings manually, or re-run the evaluation.',
};

const EVENT_LABEL: Record<string, string> = {
  tab_hidden: 'Left the interview tab',
  tab_visible: 'Returned to the tab',
  window_blur: 'Clicked outside the interview window',
  window_focus: 'Returned to the window',
  paste: 'Pasted text',
  copy: 'Copied text',
  camera_lost: 'Camera turned off',
  mic_lost: 'Microphone turned off',
  devices_restored: 'Camera and microphone restored',
  page_reload: 'Reloaded the page',
  fullscreen_exit: 'Left full screen',
};

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const ago = (iso: string | null | undefined) => {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

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

const Rating: React.FC<{ label: string; value: number | null; sub?: string }> = ({ label, value, sub }) => (
  <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3">
    <div className="text-[12px] text-[var(--text-secondary)]">{label}</div>
    <div className="mt-0.5 font-mono text-[22px] font-semibold tabular-nums">
      {value ?? '-'}
      <span className="text-[13px] font-normal text-[var(--text-tertiary)]"> / 5</span>
    </div>
    {sub && <div className="text-[11px] text-[var(--text-tertiary)]">{sub}</div>}
  </div>
);

const VoiceChips: React.FC<{ v: VoiceMetrics }> = ({ v }) => (
  <div className="flex flex-wrap gap-1.5 text-[11px] text-[var(--text-secondary)]">
    {[
      ['Clarity', v.clarity],
      ['Fluency', v.fluency],
      ['Structure', v.structure],
      ['Vocab', v.vocabulary],
      ['Tone', v.tone],
    ].map(([k, n]) => (
      <span key={k as string} className="rounded-full border border-[var(--border)] px-2 py-0.5">
        {k} <strong className="font-mono">{n}</strong>/5
      </span>
    ))}
    {v.wpm ? <span className="rounded-full border border-[var(--border)] px-2 py-0.5">{v.wpm} wpm</span> : null}
    <span className="rounded-full border border-[var(--border)] px-2 py-0.5">{v.fillers} fillers</span>
  </div>
);

// ----------------------------------------------------------- live observation
const LiveObserver: React.FC<{ sessionId: string; candidateName: string; onClose: () => void }> = ({ sessionId, candidateName, onClose }) => {
  const { data, error } = useQuery({
    queryKey: ['ai_live', sessionId],
    queryFn: () => aiInterviewApi.live(sessionId),
    refetchInterval: 3000,
  });
  const s = data?.session;
  const ended = s && s.status !== 'in_progress';
  return (
    <Dialog open onClose={onClose} title={`Observing live · ${candidateName}`} description="Read-only view, refreshes every 3 seconds. Recordings and transcript appear as each answer is submitted." maxWidth="max-w-[820px]">
      {error ? (
        <p className="text-[13px] text-[var(--status-danger)]">{mapSupabaseError(error)}</p>
      ) : !data || !s ? (
        <TableSkeleton rows={3} cols={2} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_META[s.status].tone}>{STATUS_META[s.status].label}</Badge>
            {s.status === 'in_progress' && (
              <Badge tone={data.online ? 'emerald' : 'neutral'}>{data.online ? 'Candidate online' : `Away or offline · last seen ${ago(data.lastSeenAt)}`}</Badge>
            )}
            <Badge tone={INTEGRITY_META[data.integrity.level].tone}>Integrity: {INTEGRITY_META[data.integrity.level].label}</Badge>
            <span className="text-[12px] text-[var(--text-secondary)]">
              {s.answered}/{s.max_questions} answered
            </span>
          </div>
          {ended && <p className="rounded-[8px] bg-[var(--bg-subtle)] p-2.5 text-[13px]">This interview is {s.status}. Close this window and open the session card for the full review.</p>}
          {data.currentQuestion && (
            <div className="rounded-[10px] border border-[var(--border)] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                Now asking Q{data.currentQuestion.n}
                {data.currentQuestion.topic ? ` · ${data.currentQuestion.topic}` : ''}
              </div>
              <p className="mt-1 text-[14px] leading-[22px]">{data.currentQuestion.text}</p>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-[12px] font-medium text-[var(--text-secondary)]">Latest recorded answer</div>
              {data.latestRecording?.videoUrl ? (
                <>
                  <video key={data.latestRecording.videoUrl} controls preload="metadata" src={data.latestRecording.videoUrl} className="aspect-video w-full rounded-[8px] bg-black" />
                  <div className="text-[12px] text-[var(--text-secondary)]">
                    Q{data.latestRecording.questionNo}
                    {data.latestRecording.durationSeconds ? ` · ${Math.round(data.latestRecording.durationSeconds)}s` : ''}
                  </div>
                  {data.latestRecording.transcript ? (
                    <p className="rounded-[8px] bg-[var(--bg-subtle)] p-2 text-[13px] leading-[20px]">{data.latestRecording.transcript}</p>
                  ) : (
                    <p className="text-[12px] text-[var(--text-tertiary)]">No transcript for this answer.</p>
                  )}
                  {data.latestRecording.voice && <VoiceChips v={data.latestRecording.voice} />}
                </>
              ) : (
                <p className="rounded-[8px] border border-dashed border-[var(--border-strong)] p-3 text-[12px] text-[var(--text-tertiary)]">No answer has been recorded yet.</p>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-[12px] font-medium text-[var(--text-secondary)]">Monitoring feed</div>
              {data.events.length === 0 ? (
                <p className="text-[12px] text-[var(--text-tertiary)]">No tab switches, pastes or device interruptions so far.</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto text-[12px]">
                  {[...data.events].reverse().map((e, i) => (
                    <li key={i} className="flex justify-between gap-2 rounded-[6px] bg-[var(--bg-subtle)] px-2 py-1">
                      <span>
                        {EVENT_LABEL[e.type] || e.type}
                        {e.duration_ms ? ` (${Math.round(e.duration_ms / 1000)}s)` : ''}
                        {e.question_no ? ` · Q${e.question_no}` : ''}
                      </span>
                      <span className="shrink-0 text-[var(--text-tertiary)]">{ago(e.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div>
            <div className="text-[12px] font-medium text-[var(--text-secondary)]">Conversation so far</div>
            <div className="mt-1.5 max-h-56 space-y-2 overflow-y-auto rounded-[10px] border border-[var(--border)] p-3">
              {data.recentTurns.map((t, i) =>
                t.role === 'ai' ? (
                  <div key={i} className="text-[13px] leading-[20px]">
                    <span className="font-semibold text-[var(--accent)]">AI Q{t.n}:</span> {t.text}
                  </div>
                ) : (
                  <div key={i} className="rounded-[8px] bg-[var(--bg-subtle)] p-2 text-[13px] leading-[20px]">
                    <span className="font-semibold">Candidate:</span> {t.text}
                  </div>
                )
              )}
            </div>
          </div>
          <p className="text-[11px] leading-[16px] text-[var(--text-tertiary)]">
            Live video and audio streaming is not available yet. Every answer is recorded in full and appears here as soon as it is submitted.
          </p>
        </div>
      )}
    </Dialog>
  );
};

// ------------------------------------------------------------ recordings list
const RecordingsList: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ai_recordings', sessionId],
    queryFn: () => aiInterviewApi.recordings(sessionId),
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <TableSkeleton rows={2} cols={2} />;
  if (error) return <p className="text-[13px] text-[var(--status-danger)]">{mapSupabaseError(error)}</p>;
  const recs: AiRecording[] = data || [];
  if (!recs.length) return <p className="text-[13px] text-[var(--text-secondary)]">No recordings available.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {recs.map((r) => (
        <div key={r.questionNo} className="space-y-2 rounded-[10px] border border-[var(--border)] p-3">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-semibold">Answer {r.questionNo}</span>
            <span className="text-[var(--text-tertiary)]">{r.durationSeconds ? `${Math.round(r.durationSeconds)}s` : ''}</span>
          </div>
          {r.videoUrl ? <video controls preload="none" src={r.videoUrl} className="aspect-video w-full rounded-[8px] bg-black" /> : null}
          {r.transcript ? (
            <p className="text-[13px] leading-[20px]">{r.transcript}</p>
          ) : (
            <p className="text-[12px] text-amber-700">Not transcribed{r.status === 'failed' ? ' (analysis failed). Watch the video.' : '.'}</p>
          )}
          {r.voice && <VoiceChips v={r.voice} />}
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------- session card
const SessionCard: React.FC<{
  s: AiInterviewSession;
  card: Scorecard | undefined;
  candidateName: string;
  onChanged: () => void;
  onLink: (r: CreateAiInterviewResult) => void;
}> = ({ s, card, candidateName, onChanged, onLink }) => {
  const { toast } = useToast();
  const meta = STATUS_META[s.status];
  const voice = s.mode === 'voice_video';
  const fail = (title: string) => (e: unknown) => toast({ title, description: mapSupabaseError(e), tone: 'error' });
  const ok = (title: string) => () => {
    toast({ title, tone: 'success' });
    onChanged();
  };

  const [observing, setObserving] = useState(false);
  const [showRecs, setShowRecs] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ev = s.evaluation;
  const [summary, setSummary] = useState(s.client_summary ?? ev?.client_feedback?.summary ?? '');

  const cancel = useMutation({ mutationFn: () => aiInterviewApi.cancel(s.id), onSuccess: ok('AI interview cancelled'), onError: fail('Could not cancel') });
  const regen = useMutation({
    mutationFn: (sendEmail: boolean) => aiInterviewApi.regenerateLink(s.id, sendEmail),
    onSuccess: (r) => {
      onLink(r);
      onChanged();
    },
    onError: fail('Could not issue a new link'),
  });
  const evaluate = useMutation({ mutationFn: () => aiInterviewApi.evaluate(s.id), onSuccess: ok('Evaluation re-run'), onError: fail('Could not evaluate') });
  const saveSummary = useMutation({ mutationFn: () => aiInterviewApi.setClientSummary(s.id, summary), onSuccess: ok('Client summary saved'), onError: fail('Could not save') });
  const share = useMutation({
    mutationFn: (v: boolean) => aiInterviewApi.share(s.id, v),
    onSuccess: (_r, v) => {
      toast({ title: v ? 'Scorecard shared with the client' : 'Scorecard hidden from the client', tone: 'success' });
      onChanged();
    },
    onError: fail('Could not update sharing'),
  });
  const delRecs = useMutation({
    mutationFn: () => aiInterviewApi.deleteRecordings(s.id),
    onSuccess: (r) => {
      toast({ title: `Deleted ${r.deleted} recording file${r.deleted === 1 ? '' : 's'}`, tone: 'success' });
      setConfirmDelete(false);
      onChanged();
    },
    onError: fail('Could not delete recordings'),
  });

  const canReissue = !s.consent_at && (s.status === 'invited' || s.status === 'expired');
  const vs = s.voice;
  const integ = s.integrity;

  return (
    <div className="space-y-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <Badge tone={voice ? 'info' : 'neutral'}>{voice ? 'Voice + video' : 'Text'}</Badge>
          {s.status === 'in_progress' && <Badge tone={s.online ? 'emerald' : 'neutral'}>{s.online ? 'Online now' : 'Away'}</Badge>}
          <span className="text-[12px] text-[var(--text-secondary)]">
            {s.answered}/{s.max_questions} answered · created {fmt(s.created_at)}
          </span>
          {s.question_source !== 'ai' && <Badge tone="neutral">{s.question_source === 'template' ? 'Template questions' : 'Some template questions'}</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {s.status === 'in_progress' && voice && (
            <Button size="sm" variant="secondary" onClick={() => setObserving(true)}>
              <Eye className="h-3.5 w-3.5" /> Observe live
            </Button>
          )}
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
      {s.status === 'in_progress' && <p className="text-[13px] text-[var(--text-secondary)]">Started {fmt(s.started_at)}. This page refreshes automatically.</p>}
      {observing && <LiveObserver sessionId={s.id} candidateName={candidateName} onClose={() => setObserving(false)} />}

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
                <Rating label="Communication" value={s.communication_rating} sub={vs ? `Measured from ${vs.answersAnalysed} spoken answer${vs.answersAnalysed === 1 ? '' : 's'}` : 'From written answers'} />
                <Rating label="Overall" value={s.overall_rating} />
              </div>
              <p className="text-[14px] leading-[22px]">{ev.summary}</p>
            </>
          ) : (
            <div className="rounded-[10px] border border-amber-300/60 bg-amber-50 p-3 text-[13px] leading-[20px] text-amber-900">
              {ERROR_TEXT[s.error || ''] || 'No evaluation is available. Review the transcript manually.'}
              {s.error !== 'insufficient_input' && (
                <div className="mt-2">
                  <Button size="sm" variant="outline" loading={evaluate.isPending} onClick={() => evaluate.mutate()}>
                    {s.error === 'pending_evaluation' ? 'Run evaluation now' : 'Re-run evaluation'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {voice && vs && (
            <div className="rounded-[10px] border border-[var(--border)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Spoken communication (measured from audio)</div>
                <span className="font-mono text-[13px] font-semibold">{vs.overall.toFixed(1)} / 5</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
                {(
                  [
                    ['Clarity', vs.clarity],
                    ['Fluency', vs.fluency],
                    ['Structure', vs.structure],
                    ['Vocabulary & grammar', vs.vocabulary],
                    ['Professional tone', vs.tone],
                  ] as const
                ).map(([k, n]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-[var(--text-secondary)]">{k}</span>
                    <span className="font-mono tabular-nums">{n.toFixed(1)}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-2">
                  <span className="text-[var(--text-secondary)]">Pace</span>
                  <span className="font-mono tabular-nums">{vs.avgWpm ? `${vs.avgWpm} wpm` : '-'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[var(--text-secondary)]">Filler words</span>
                  <span className="font-mono tabular-nums">{vs.totalFillers}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[var(--text-secondary)]">Answers analysed</span>
                  <span className="font-mono tabular-nums">
                    {vs.answersAnalysed}/{vs.answersTotal}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">Accent and pronunciation style are not scored. Typed or unrecorded answers have no spoken score.</p>
            </div>
          )}

          {voice && integ && (
            <div className="rounded-[10px] border border-[var(--border)] p-3">
              <div className="flex items-center gap-2">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Interview integrity</div>
                <Badge tone={INTEGRITY_META[integ.level].tone}>{INTEGRITY_META[integ.level].label}</Badge>
              </div>
              {integ.reasons.length ? (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px]">
                  {integ.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Candidate stayed on the interview page with camera and microphone on throughout.</p>
              )}
              <p className="mt-2 text-[11px] leading-[16px] text-[var(--text-tertiary)]">
                Browsers can detect leaving the tab or window, pasting and device interruptions. They cannot detect another device, notes off-screen or another person in the room, so watch the recordings before relying on this.
              </p>
            </div>
          )}

          {ev && ev.skill_evidence.length > 0 && (
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
          {ev && (
            <div className="grid gap-4 sm:grid-cols-2">
              <List title="Strengths" items={ev.strengths} />
              <List title="Gaps" items={ev.gaps} />
              <List title="Suggested follow-ups for the next round" items={ev.follow_ups} />
              <List title="Verify (observations, not conclusions)" items={ev.concerns} tone="text-amber-700" />
            </div>
          )}

          {ev && (
            <div className="space-y-2.5 rounded-[10px] border border-[var(--ai-block-border)] bg-[var(--ai-block-bg)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  <FileText className="h-3.5 w-3.5" /> Client scorecard
                </div>
                {s.shared_with_client_at ? <Badge tone="emerald">Shared {fmt(s.shared_with_client_at)}</Badge> : <Badge tone="neutral">Not shared</Badge>}
              </div>
              <Textarea
                label="Summary the client will read (edit before sharing)"
                rows={4}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                hint="Shown on the scorecard instead of the AI draft. Integrity notes, concerns, transcripts and recordings are never shared with clients."
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" loading={saveSummary.isPending} disabled={summary === (s.client_summary ?? ev.client_feedback?.summary ?? '')} onClick={() => saveSummary.mutate()}>
                  Save summary
                </Button>
                <Button size="sm" variant="secondary" disabled={!card} onClick={() => setPreviewing(true)}>
                  <FileText className="h-3.5 w-3.5" /> Preview / download scorecard
                </Button>
                {s.shared_with_client_at ? (
                  <Button size="sm" variant="outline" loading={share.isPending} onClick={() => share.mutate(false)}>
                    Stop sharing
                  </Button>
                ) : (
                  <Button size="sm" loading={share.isPending} onClick={() => share.mutate(true)}>
                    <Share2 className="h-3.5 w-3.5" /> Share with client
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-[var(--text-tertiary)]">The client sees the scorecard on this candidate once the submission is shared with them.</p>
              {card && previewing && <ScorecardDialog card={card} open onClose={() => setPreviewing(false)} />}
            </div>
          )}
        </div>
      )}

      {voice && (s.recordings ?? 0) > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowRecs((v) => !v)}>
              <Video className="h-3.5 w-3.5" /> {showRecs ? 'Hide recordings' : `Watch recordings (${s.recordings})`}
            </Button>
            {s.status !== 'in_progress' && (
              <div className="flex items-center gap-2 text-[12px] text-[var(--text-tertiary)]">
                {s.recordings_expire_at && <span>Auto-deletes {fmt(s.recordings_expire_at)}</span>}
                {confirmDelete ? (
                  <>
                    <Button size="sm" variant="danger" loading={delRecs.isPending} onClick={() => delRecs.mutate()}>
                      Delete now
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete recordings
                  </Button>
                )}
              </div>
            )}
          </div>
          {showRecs && <RecordingsList sessionId={s.id} />}
        </div>
      )}
      {voice && s.recordingsDeleted && <p className="text-[12px] text-[var(--text-tertiary)]">Recordings have been deleted. Transcript and evaluation are kept.</p>}

      {s.turns.length > 0 && (
        <details className="group rounded-[10px] border border-[var(--border)]">
          <summary className="cursor-pointer select-none px-3 py-2 text-[13px] font-medium">Transcript ({s.answered} answers)</summary>
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
                    {voice && (t.media ? <Badge tone="info">spoken</Badge> : <Badge tone="amber">typed, not recorded</Badge>)}
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

// ----------------------------------------------------------------------- panel
export const AiInterviewPanel: React.FC<{ submissionId: string; candidateName: string }> = ({ submissionId, candidateName }) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<AiInterviewMode>('voice_video');
  const [questions, setQuestions] = useState('8');
  const [answerSeconds, setAnswerSeconds] = useState('120');
  const [hours, setHours] = useState('72');
  const [sendEmail, setSendEmail] = useState(true);
  const [lastLink, setLastLink] = useState<CreateAiInterviewResult | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ai_interviews', submissionId],
    queryFn: () => aiInterviewApi.list(submissionId),
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'in_progress' || s.status === 'invited') ? 8000 : false),
  });
  const sessions = data || [];
  const hasEvaluated = sessions.some((s) => s.status === 'completed' && s.evaluation);
  const { data: cards = [] } = useQuery({
    queryKey: ['ai_scorecards', submissionId],
    queryFn: () => aiInterviewApi.scorecards(submissionId),
    enabled: hasEvaluated,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['ai_interviews', submissionId] });
    void qc.invalidateQueries({ queryKey: ['ai_scorecards', submissionId] });
  };

  const showResult = (r: CreateAiInterviewResult) => {
    setLastLink(r);
    if (r.emailSent) toast({ title: 'Invitation emailed to the candidate', tone: 'success' });
    else if (r.emailError) toast({ title: 'Link created, email not sent', description: r.emailError, tone: 'error' });
  };

  const create = useMutation({
    mutationFn: () =>
      aiInterviewApi.create({
        submissionId,
        mode,
        maxQuestions: Number(questions),
        maxAnswerSeconds: Number(answerSeconds),
        expiresInHours: Number(hours),
        sendEmail,
      }),
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

  const busy = sessions.some((s) => s.status === 'in_progress');
  const perQ = mode === 'voice_video' ? Math.round(Number(answerSeconds) / 60 + 1) : 2.5;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          <Bot className="h-4 w-4 text-[var(--accent)]" /> AI interview
        </h3>
        <p className="mt-1 text-[13px] leading-[20px] text-[var(--text-secondary)]">
          {candidateName} is interviewed by an AI that reads each question aloud, listens to the answer, and adapts to what they say, using the resume and the job description. It then drafts an
          evidence-based scorecard for you to review and share with the client. It never decides: ratings are advisory.
        </p>
      </div>

      <div className="space-y-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Interview type"
            value={mode}
            onChange={(e) => setMode(e.target.value as AiInterviewMode)}
            options={[
              { value: 'voice_video', label: 'Voice + video (recorded, monitored)' },
              { value: 'text', label: 'Written text only' },
            ]}
          />
          <Select
            label="Number of questions"
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            options={[5, 8, 10, 12].map((n) => ({ value: String(n), label: `${n} questions (about ${Math.round(n * perQ)} min)` }))}
          />
          {mode === 'voice_video' && (
            <Select
              label="Time limit per spoken answer"
              value={answerSeconds}
              onChange={(e) => setAnswerSeconds(e.target.value)}
              options={[
                { value: '60', label: '1 minute' },
                { value: '90', label: '1.5 minutes' },
                { value: '120', label: '2 minutes' },
                { value: '180', label: '3 minutes' },
              ]}
            />
          )}
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
        {mode === 'voice_video' && (
          <ul className="list-disc space-y-0.5 rounded-[8px] bg-[var(--bg-subtle)] py-2 pl-7 pr-3 text-[12px] leading-[18px] text-[var(--text-secondary)]">
            <li>Camera and microphone are mandatory: the candidate cannot start or continue without them, and every answer is recorded.</li>
            <li>Leaving the tab or window, pasting, and device interruptions are logged and shown to you. You can watch live and replay every answer.</li>
            <li>Recordings are deleted automatically after 90 days, or sooner when you delete them.</li>
          </ul>
        )}
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="h-4 w-4 accent-[var(--primary-bg)]" />
          Email the invitation to the candidate
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button loading={create.isPending} disabled={busy} onClick={() => create.mutate()}>
            <Bot className="h-3.5 w-3.5" /> Create AI interview
          </Button>
          {busy && <span className="text-[12px] text-[var(--text-secondary)]">An interview is in progress for this submission.</span>}
        </div>

        {lastLink && (
          <div className="space-y-2 rounded-[10px] border border-[var(--ai-block-border)] bg-[var(--ai-block-bg)] p-3">
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
        <p className="rounded-[10px] border border-dashed border-[var(--border-strong)] p-4 text-center text-[13px] text-[var(--text-secondary)]">No AI interviews for this submission yet.</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard key={s.id} s={s} card={cards.find((c) => c.sessionId === s.id)} candidateName={candidateName} onChanged={refresh} onLink={showResult} />
          ))}
        </div>
      )}
    </div>
  );
};
