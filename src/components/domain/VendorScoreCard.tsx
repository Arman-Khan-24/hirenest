import React from 'react';
import { Badge } from '../ui/kit';
import { NotEnoughData, ScoreBar } from './DomainBadges';
import type { VendorPerformanceResult } from '../../types/db';

const QUALITY_DIMENSION_LABELS: Record<
  keyof VendorPerformanceResult['quality']['dimensions'],
  string
> = {
  jd_skill_alignment: 'JD skill alignment',
  relevant_experience: 'Relevant experience',
  resume_accuracy: 'Resume accuracy & completeness',
  communication: 'Communication & professionalism',
  interview_readiness: 'Interview readiness',
  overall_suitability: 'Overall candidate suitability',
};

const PillarTile: React.FC<{
  color: string;
  title: string;
  samples: string;
  score: number | null;
  provisional?: number | null;
  rows: Array<[string, string]>;
}> = ({ color, title, samples, score, provisional, rows }) => (
  <div className="p-5 space-y-4 bg-[var(--surface)]">
    <div className="flex items-center justify-between">
      <span className="inline-flex items-center gap-2 text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
        <span>{title}</span>
      </span>
      <span className="text-[12px] leading-[16px] font-mono tabular-nums text-[var(--text-tertiary)]">
        {samples}
      </span>
    </div>
    <div>
      {score !== null ? (
        <div className="text-[28px] leading-[36px] font-semibold tracking-[-0.01em] font-mono tabular-nums text-[var(--text-primary)]">
          {Math.round(score)}
        </div>
      ) : provisional !== null && provisional !== undefined ? (
        <div className="flex items-baseline gap-2 py-1">
          <span className="text-[28px] leading-[36px] font-semibold font-mono tabular-nums text-[var(--text-tertiary)]">
            {Math.round(provisional)}
          </span>
          <span className="text-[12px] text-[var(--text-tertiary)]">provisional</span>
        </div>
      ) : (
        <div className="text-[14px] leading-[20px] text-[var(--text-secondary)] py-1">Not enough data</div>
      )}
    </div>
    <div className="pt-3 border-t border-[var(--border)] space-y-1.5 text-[13px] leading-[20px]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <span className="text-[var(--text-secondary)]">{label}</span>
          <span className="font-mono tabular-nums text-[var(--text-primary)] text-right">{value}</span>
        </div>
      ))}
    </div>
  </div>
);

export const VendorPerformancePanel: React.FC<{
  performance: VendorPerformanceResult;
  clientSummaryOnly?: boolean;
}> = ({ performance, clientSummaryOnly = false }) => {
  const minSample = performance.min_sample_size ?? 5;
  const { timing, quality, compliance, overall } = performance;

  if (clientSummaryOnly) {
    return (
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5 flex items-center justify-between">
        <div>
          <h3 className="text-[14px] leading-[20px] font-medium text-[var(--text-primary)]">
            Overall vendor standing
          </h3>
          <p className="text-[13px] leading-[20px] text-[var(--text-secondary)] mt-0.5">
            Composite score across timing, quality, and process compliance.
          </p>
        </div>
        <div>
          {overall.status === 'weights_not_approved' ? (
            <Badge tone="warning">Pending approval</Badge>
          ) : overall.status === 'not_enough_data' || overall.score === null ? (
            <NotEnoughData />
          ) : (
            <ScoreBar score={overall.score} />
          )}
        </div>
      </div>
    );
  }

  const ack = performance.ack;
  const rangeLabel = performance.range?.from || performance.range?.to ? 'selected period' : 'all time';
  const dash = 'Not enough data';
  const hours = (v: number | null | undefined) => (v !== null && v !== undefined ? `${v}h` : dash);

  return (
    <div className="space-y-6">
      <p className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
        Showing {rangeLabel}. A score appears once a pillar has {minSample} samples; below that the
        provisional value is shown in grey.
      </p>
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] grid grid-cols-1 sm:grid-cols-2 gap-px" style={{ backgroundColor: 'var(--border)' }}>
        {ack && (
          <PillarTile
            color="#7C3AED"
            title="Acknowledgement"
            samples={`${ack.evaluable_shares} of ${minSample} samples`}
            score={ack.score}
            provisional={ack.provisional_score}
            rows={[
              [`Acknowledged within ${ack.ack_sla_hours}h`, `${ack.acknowledged_in_sla} / ${ack.evaluable_shares}`],
              ['Avg acknowledgement time', hours(ack.avg_response_hours)],
            ]}
          />
        )}
        <PillarTile
          color="#1D5FD1"
          title="Submission timing"
          samples={`${timing.evaluable_shares} of ${minSample} samples`}
          score={timing.score}
          provisional={timing.provisional_score}
          rows={[
            ['Before SLA', `${timing.sla_met} / ${timing.evaluable_shares}`],
            ['After SLA (late)', timing.sla_late !== undefined ? String(timing.sla_late) : '-'],
            ['Never submitted (missed)', timing.sla_missed !== undefined ? String(timing.sla_missed) : '-'],
            ['Avg turnaround', hours(timing.avg_turnaround_hours)],
            [
              '90d SLA compliance',
              timing.sla_compliance_90d_pct !== null ? `${timing.sla_compliance_90d_pct}%` : dash,
            ],
          ]}
        />
        <PillarTile
          color="#C98A4B"
          title="Quality of profiles"
          samples={`${quality.rated_submissions} of ${minSample} samples`}
          score={quality.score}
          provisional={quality.provisional_score}
          rows={[
            ['Rated submissions', String(quality.rated_submissions)],
            [
              'Avg quality (1-5)',
              quality.avg_rating_1_to_5 !== null ? `${quality.avg_rating_1_to_5} / 5` : dash,
            ],
            [
              'Avg interview (1-5)',
              quality.avg_interview_overall_1_to_5 !== null
                ? `${quality.avg_interview_overall_1_to_5} / 5`
                : dash,
            ],
          ]}
        />
        <PillarTile
          color="#2A9D8F"
          title="Compliance"
          samples={`${compliance.submissions} of ${minSample} samples`}
          score={compliance.score}
          provisional={compliance.provisional_score}
          rows={[
            ['Compliant submissions', `${compliance.compliant} / ${compliance.submissions}`],
            ['Min sample threshold', String(minSample)],
          ]}
        />

        {/* Composite */}
        <div className="p-5 space-y-4 bg-[var(--surface)] sm:col-span-2">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-[12px] leading-[16px] font-medium text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-[#36342E] shrink-0" />
              <span>Overall composite</span>
            </span>
            {overall.status === 'weights_not_approved' ? (
              <Badge tone="warning">Pending approval</Badge>
            ) : overall.status === 'not_enough_data' ? (
              <Badge tone="neutral">Not enough data</Badge>
            ) : overall.partial ? (
              <Badge tone="neutral">
                Partial: {overall.pillars_scored} of {overall.pillars_weighted} pillars
              </Badge>
            ) : (
              <Badge tone="success">Approved</Badge>
            )}
          </div>
          <div>
            {overall.status === 'weights_not_approved' ? (
              <div className="text-[13px] leading-[20px] text-[var(--text-secondary)] py-1">
                Platform weights pending admin approval
              </div>
            ) : overall.status === 'not_enough_data' || overall.score === null ? (
              <div className="text-[14px] leading-[20px] text-[var(--text-secondary)] py-1">
                Not enough data
              </div>
            ) : (
              <div className="text-[28px] leading-[36px] font-semibold tracking-[-0.01em] font-mono tabular-nums text-[var(--text-primary)]">
                {Math.round(overall.score)}
              </div>
            )}
          </div>
          {overall.weights && (
            <div className="pt-3 border-t border-[var(--border)] space-y-1.5 text-[13px] leading-[20px]">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Weights (Ack / Submit / Quality / Compliance)</span>
                <span className="font-mono tabular-nums text-[var(--text-primary)]">
                  {overall.weights.ack ?? 0}% / {overall.weights.timing}% / {overall.weights.quality}% /{' '}
                  {overall.weights.compliance}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Weights status</span>
                <span className="text-[var(--text-primary)]">
                  {overall.weights.approved ? 'Approved' : 'Unapproved'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Six Quality Dimensions Breakdown */}
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5">
        <h4 className="section-title-bar text-[16px] leading-[24px] font-semibold tracking-[-0.01em] text-[var(--text-primary)] mb-4">
          Quality dimensions (1–5 scale)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
          {(
            Object.keys(QUALITY_DIMENSION_LABELS) as Array<
              keyof VendorPerformanceResult['quality']['dimensions']
            >
          ).map((key) => {
            const val = quality.dimensions?.[key];
            const pct = val !== null && val !== undefined ? Math.round((val / 5) * 100) : null;
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-4 py-1.5 border-b border-[var(--border)]"
              >
                <span className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                  {QUALITY_DIMENSION_LABELS[key]}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {val !== null && val !== undefined ? (
                    <>
                      <span className="font-mono tabular-nums text-[13px] leading-[20px] font-medium text-[var(--text-primary)]">
                        {val} / 5
                      </span>
                      <div className="w-14 h-1 rounded-[2px] bg-[var(--track)] overflow-hidden">
                        <div
                          className="h-full bg-[#174DB0]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <span className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                      Not enough data
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
