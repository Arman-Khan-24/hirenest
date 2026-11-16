import React, { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Dialog } from '../ui/kit';
import type { Scorecard } from '../../api/aiInterviews';

const REC_LABEL: Record<NonNullable<Scorecard['recommendation']>, { text: string; bg: string; fg: string }> = {
  advance: { text: 'Recommended to advance', bg: '#E6F4EC', fg: '#17734A' },
  hold: { text: 'Hold: needs a closer look', bg: '#FDF3DC', fg: '#8A5A00' },
  reject: { text: 'Not recommended', bg: '#FBE7E4', fg: '#A32B1D' },
};
const LEVEL: Record<string, { bg: string; fg: string }> = {
  proven: { bg: '#E6F4EC', fg: '#17734A' },
  partial: { bg: '#FDF3DC', fg: '#8A5A00' },
  unproven: { bg: '#EFEDE8', fg: '#5B584E' },
};

const scoreColor = (n: number) => (n >= 4 ? '#17734A' : n >= 3 ? '#1D5FD1' : n >= 2 ? '#B7791F' : '#C0392B');

const Tile: React.FC<{ label: string; value: number | null; sub?: string }> = ({ label, value, sub }) => (
  <div style={{ border: '1px solid #E6E0D6', borderRadius: 10, padding: '12px 14px', background: '#FFFEFB' }}>
    <div style={{ fontSize: 11, color: '#716E64', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    <div style={{ marginTop: 4, fontSize: 28, fontWeight: 700, color: value ? scoreColor(value) : '#716E64', fontVariantNumeric: 'tabular-nums' }}>
      {value ?? '-'}
      <span style={{ fontSize: 14, fontWeight: 500, color: '#716E64' }}> / 5</span>
    </div>
    {sub && <div style={{ fontSize: 11, color: '#716E64', marginTop: 2 }}>{sub}</div>}
  </div>
);

const Bar: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '3px 0' }}>
    <span style={{ width: 130, color: '#36342E' }}>{label}</span>
    <div style={{ flex: 1, height: 7, borderRadius: 4, background: '#EFE9E1', overflow: 'hidden' }}>
      <div style={{ width: `${(value / 5) * 100}%`, height: '100%', background: scoreColor(value) }} />
    </div>
    <span style={{ width: 28, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(1)}</span>
  </div>
);

const Bullets: React.FC<{ title: string; items: string[] }> = ({ title, items }) =>
  items.length ? (
    <div>
      <div style={{ fontSize: 11, color: '#716E64', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: '20px', color: '#14213D' }}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  ) : null;

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');

/** Client-facing screening scorecard. Fixed light colours so it exports cleanly as an image. */
export const ScreeningScorecard = React.forwardRef<HTMLDivElement, { card: Scorecard }>(({ card }, ref) => {
  const rec = card.recommendation ? REC_LABEL[card.recommendation] : null;
  return (
    <div
      ref={ref}
      style={{ background: '#FFFFFF', color: '#14213D', fontFamily: "'Inter', system-ui, sans-serif", border: '1px solid #E6E0D6', borderRadius: 14, padding: 24, maxWidth: 760 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 26, height: 26, borderRadius: 7, background: '#1D5FD1', color: '#fff', fontWeight: 700, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>H</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#716E64', letterSpacing: '0.04em', textTransform: 'uppercase' }}>HireNest · Screening round scorecard</span>
          </div>
          <h2 style={{ margin: '10px 0 2px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>{card.candidateName}</h2>
          <div style={{ fontSize: 13, color: '#605D52' }}>
            {card.roleTitle} · {card.mode === 'voice_video' ? 'Recorded video interview' : 'Written interview'} · {fmtDate(card.completedAt)}
          </div>
        </div>
        {rec && (
          <div style={{ background: rec.bg, color: rec.fg, fontWeight: 700, fontSize: 12, padding: '6px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>{rec.text}</div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 16 }}>
        <Tile label="Role skills" value={card.ratings.skill} sub="Evidence against the job description" />
        <Tile label="Communication" value={card.ratings.communication} sub={card.voice ? 'Measured from spoken answers' : 'From written answers'} />
        <Tile label="Overall" value={card.ratings.overall} />
      </div>

      {card.headline && <div style={{ marginTop: 16, fontSize: 15, fontWeight: 700 }}>{card.headline}</div>}
      <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: '21px', color: '#14213D' }}>{card.summary}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 16 }}>
        <Bullets title="Strengths" items={card.strengths} />
        <Bullets title="Areas to probe next" items={card.areasToProbe} />
      </div>

      {card.skillEvidence.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, color: '#716E64', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Skills assessed</div>
          <div style={{ marginTop: 6, border: '1px solid #E6E0D6', borderRadius: 10, overflow: 'hidden' }}>
            {card.skillEvidence.map((e, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 12px', borderTop: i ? '1px solid #EFE9E1' : 'none', fontSize: 12, lineHeight: '18px' }}>
                <div>
                  <strong>{e.skill}</strong>
                  <span style={{ color: '#605D52' }}> · {e.evidence}</span>
                </div>
                <span style={{ background: (LEVEL[e.level] || LEVEL.unproven).bg, color: (LEVEL[e.level] || LEVEL.unproven).fg, fontWeight: 600, fontSize: 11, padding: '2px 8px', borderRadius: 999, height: 'fit-content', whiteSpace: 'nowrap' }}>{e.level}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {card.voice && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, color: '#716E64', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Spoken communication (1-5)</div>
          <div style={{ marginTop: 6 }}>
            <Bar label="Clarity" value={card.voice.clarity} />
            <Bar label="Fluency" value={card.voice.fluency} />
            <Bar label="Structure" value={card.voice.structure} />
            <Bar label="Vocabulary & grammar" value={card.voice.vocabulary} />
            <Bar label="Professional tone" value={card.voice.tone} />
          </div>
          <div style={{ fontSize: 11, color: '#716E64', marginTop: 4 }}>
            Based on {card.voice.answersAnalysed} recorded answer{card.voice.answersAnalysed === 1 ? '' : 's'}
            {card.voice.avgWpm ? ` · about ${card.voice.avgWpm} words per minute` : ''}. Accent and pronunciation style are not scored.
          </div>
        </div>
      )}

      <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid #EFE9E1', fontSize: 11, lineHeight: '16px', color: '#716E64' }}>
        {card.questionsAnswered} of {card.questionsAsked} questions answered · AI-assisted first-round screening
        {card.reviewedBy ? `, reviewed by ${card.reviewedBy} (HireNest)` : ', reviewed by HireNest'}
        {card.sharedAt ? ` · shared ${fmtDate(card.sharedAt)}` : ''}. This scorecard is advisory and is not a final hiring decision.
      </div>
    </div>
  );
});
ScreeningScorecard.displayName = 'ScreeningScorecard';

/** Preview dialog with a PNG download. */
export const ScorecardDialog: React.FC<{ card: Scorecard; open: boolean; onClose: () => void; canDownload?: boolean }> = ({ card, open, onClose, canDownload = true }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (!ref.current) return;
    setBusy(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(ref.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const a = document.createElement('a');
      a.download = `HireNest-Screening-${card.candidateName.replace(/\s+/g, '_')}-${card.roleTitle.replace(/\s+/g, '_')}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } catch {
      window.alert('Could not generate the image. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Screening round scorecard" maxWidth="max-w-[820px]">
      <div className="space-y-3">
        {canDownload && (
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" loading={busy} onClick={download}>
              <Download className="h-3.5 w-3.5" /> Download as image
            </Button>
          </div>
        )}
        <div className="overflow-x-auto">
          <ScreeningScorecard ref={ref} card={card} />
        </div>
      </div>
    </Dialog>
  );
};
