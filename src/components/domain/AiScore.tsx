import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { Badge, Dialog, TableSkeleton } from '../ui/kit';
import { aiInterviewApi, type AiSummary } from '../../api/aiInterviews';
import { AiInterviewPanel } from './AiInterviewPanel';
import { ScorecardDialog } from './ScreeningScorecard';

/** Loads AI-interview results for the submissions on screen in one request. */
export function useAiInterviewSummaries(submissionIds: Array<string | null | undefined>) {
  const ids = [...new Set(submissionIds.filter((x): x is string => !!x))].sort().slice(0, 60);
  return useQuery({
    queryKey: ['ai_summaries', ids.join(',')],
    queryFn: () => aiInterviewApi.summaries(ids),
    enabled: ids.length > 0,
    staleTime: 20_000,
    retry: false,
    refetchInterval: (q) => (Object.values(q.state.data ?? {}).some((s) => s.status === 'in_progress') ? 10_000 : false),
  });
}

const tone = (n: number | null) => (n === null ? 'neutral' : n >= 4 ? 'emerald' : n >= 3 ? 'info' : n >= 2 ? 'amber' : 'red');

const ScorecardLoader: React.FC<{ submissionId: string; onClose: () => void }> = ({ submissionId, onClose }) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ai_scorecards', submissionId, 'cell'],
    queryFn: () => aiInterviewApi.scorecards(submissionId),
    retry: false,
  });
  if (data?.[0]) return <ScorecardDialog card={data[0]} open onClose={onClose} canDownload />;
  return (
    <Dialog open onClose={onClose} title="Screening round scorecard">
      {isLoading ? <TableSkeleton rows={3} cols={2} /> : <p className="text-[13px] text-[var(--text-secondary)]">{error ? 'The scorecard is not available.' : 'No scorecard has been shared yet.'}</p>}
    </Dialog>
  );
};

/**
 * One cell for any pipeline table. Staff open the full interview panel (details, recordings, sharing);
 * vendors and clients open the scorecard HQ shared with them.
 */
export const AiScoreCell: React.FC<{
  submissionId: string;
  summary: AiSummary | undefined;
  viewer: 'staff' | 'vendor' | 'client';
  candidateName: string;
  roleTitle?: string;
}> = ({ submissionId, summary, viewer, candidateName, roleTitle }) => {
  const [open, setOpen] = useState(false);
  if (!summary) return <span className="text-[12px] text-[var(--text-tertiary)]">{viewer === 'staff' ? 'No AI interview' : '-'}</span>;

  let body: React.ReactNode;
  if (summary.status === 'completed' && summary.evaluated) {
    body = (
      <span className="inline-flex flex-col items-start gap-0.5">
        <Badge tone={tone(summary.overall)} className="font-mono tabular-nums">
          {summary.overall ?? '-'}/5 overall
        </Badge>
        <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
          skill {summary.skill ?? '-'} · comm {summary.communication ?? '-'}
          {viewer === 'staff' && summary.shared ? ' · shared' : ''}
        </span>
      </span>
    );
  } else if (summary.status === 'completed') {
    body = <Badge tone="amber">Scoring…</Badge>;
  } else if (summary.status === 'in_progress') {
    body = (
      <Badge tone="amber">
        Interviewing {summary.answered}/{summary.maxQuestions}
      </Badge>
    );
  } else {
    body = <Badge tone="info">Invited</Badge>;
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="rounded-[6px] px-1 py-0.5 text-left hover:bg-[var(--bg-hover)]"
        aria-label={`Open AI interview scorecard for ${candidateName}`}
      >
        {body}
      </button>
      {open &&
        (viewer === 'staff' ? (
          <Dialog
            open
            onClose={() => setOpen(false)}
            title={`AI interview · ${candidateName}`}
            description={roleTitle}
            maxWidth="max-w-[820px]"
          >
            <AiInterviewPanel submissionId={submissionId} candidateName={candidateName} />
          </Dialog>
        ) : (
          <ScorecardLoader submissionId={submissionId} onClose={() => setOpen(false)} />
        ))}
    </>
  );
};

/** Header icon for the column. */
export const AiScoreHeader: React.FC = () => (
  <span className="inline-flex items-center gap-1">
    <Bot className="h-3.5 w-3.5" aria-hidden /> AI interview
  </span>
);
