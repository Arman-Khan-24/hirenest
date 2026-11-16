import React, { useState } from 'react';
import { CheckCircle2, Loader2, Mail, UserPlus } from 'lucide-react';
import { PublicInterviewError, publicInterviewApi, type CandidateReport as Report } from '../../api/aiInterviews';

const scoreColor = (n: number) => (n >= 4 ? '#17734A' : n >= 3 ? '#1D5FD1' : n >= 2 ? '#B7791F' : '#C0392B');

const Tile: React.FC<{ label: string; value: number | null }> = ({ label, value }) => (
  <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{label}</div>
    <div className="mt-1 font-mono text-[26px] font-bold tabular-nums" style={{ color: value ? scoreColor(value) : undefined }}>
      {value ?? '-'}
      <span className="text-[13px] font-medium text-[var(--text-tertiary)]"> / 5</span>
    </div>
  </div>
);

const Bar: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex items-center gap-3 py-0.5 text-[12px]">
    <span className="w-36 shrink-0 text-[var(--text-secondary)]">{label}</span>
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--track)]">
      <div className="h-full rounded-full" style={{ width: `${(value / 5) * 100}%`, background: scoreColor(value) }} />
    </div>
    <span className="w-8 text-right font-mono tabular-nums">{value.toFixed(1)}</span>
  </div>
);

const Bullets: React.FC<{ title: string; items: string[] }> = ({ title, items }) =>
  items.length ? (
    <div>
      <div className="text-[12px] font-semibold text-[var(--text-secondary)]">{title}</div>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] leading-[20px]">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  ) : null;

/** The candidate's own scorecard, plus the options to email it and to register for more jobs. */
export const CandidateReportScreen: React.FC<{
  token: string;
  firstName: string;
  report: Report;
  emailHint: string | null | undefined;
  signupUrl: string;
}> = ({ token, firstName, report, emailHint, signupUrl }) => {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const send = async () => {
    setState('sending');
    setMessage(null);
    try {
      const r = await publicInterviewApi.emailReport(token, emailHint ? undefined : email.trim());
      if (r.ok) {
        setState('sent');
        setMessage(`Sent to ${r.to || 'your email'}. Check your inbox (and spam folder).`);
      } else {
        setState('error');
        setMessage(r.error || 'We could not send the email right now.');
      }
    } catch (e) {
      setState('error');
      setMessage(e instanceof PublicInterviewError || e instanceof Error ? e.message : 'We could not send the email right now.');
    }
  };

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 py-8 sm:px-6">
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" aria-hidden />
        <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.01em]">Thank you for joining, {firstName}</h1>
        <p className="mt-1 text-[14px] leading-[22px] text-[var(--text-secondary)]">
          Your interview for {report.roleTitle} is complete and has gone to the recruiting team. Here is your screening scorecard.
        </p>
      </div>

      <section className="space-y-4 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5" aria-label="Your scorecard">
        <div className="grid grid-cols-3 gap-2.5">
          <Tile label="Role skills" value={report.ratings.skill} />
          <Tile label={report.spoken ? 'Spoken communication' : 'Communication'} value={report.ratings.communication} />
          <Tile label="Overall" value={report.ratings.overall} />
        </div>
        <p className="text-[14px] leading-[22px]">{report.summary}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Bullets title="What went well" items={report.strengths} />
          <Bullets title="To work on" items={report.improvements} />
        </div>
        {report.voice && (
          <div>
            <div className="text-[12px] font-semibold text-[var(--text-secondary)]">Spoken communication (1-5)</div>
            <div className="mt-1">
              <Bar label="Clarity" value={report.voice.clarity} />
              <Bar label="Fluency" value={report.voice.fluency} />
              <Bar label="Structure" value={report.voice.structure} />
              <Bar label="Vocabulary & grammar" value={report.voice.vocabulary} />
              <Bar label="Professional tone" value={report.voice.tone} />
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">Accent and pronunciation style are not scored.</p>
          </div>
        )}
        <p className="text-[11px] leading-[16px] text-[var(--text-tertiary)]">This scorecard is AI-assisted and reviewed by HireNest. It is not a hiring decision.</p>
      </section>

      <section className="space-y-3 rounded-[14px] border border-[var(--ai-block-border)] bg-[var(--ai-block-bg)] p-5">
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <Mail className="h-4 w-4 text-[var(--accent)]" aria-hidden /> Get this report by email
        </div>
        {state === 'sent' ? (
          <p role="status" className="text-[13px] text-emerald-700">
            {message}
          </p>
        ) : (
          <div className="space-y-2">
            {!emailHint && (
              <>
                <label htmlFor="report-email" className="text-[12px] font-medium text-[var(--text-secondary)]">
                  Your email address
                </label>
                <input
                  id="report-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-10 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-[14px] focus:border-[var(--focus-border)] focus:outline-none focus:ring-[3px] focus:ring-[var(--focus-ring)]"
                />
              </>
            )}
            <button
              type="button"
              onClick={send}
              disabled={state === 'sending' || (!emailHint && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[var(--primary-bg)] px-4 text-[14px] font-semibold text-white hover:bg-[var(--primary-hover)] disabled:opacity-50"
            >
              {state === 'sending' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {emailHint ? `Email it to ${emailHint}` : 'Email me this report'}
            </button>
            {state === 'error' && message && (
              <p role="alert" className="text-[13px] text-[var(--status-danger)]">
                {message}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <UserPlus className="h-4 w-4 text-[var(--accent)]" aria-hidden /> Looking for more opportunities?
        </div>
        <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
          Register on HireNest OS to apply for full-time (FTE) openings and more jobs. Your profile and reports stay in one place, and recruiters can find you for roles that fit.
        </p>
        <a
          href={signupUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center rounded-[10px] border border-[var(--primary-bg)] px-4 text-[14px] font-semibold text-[var(--primary-bg)] hover:bg-[var(--highlight-soft)]"
        >
          Create your free account
        </a>
      </section>
    </main>
  );
};
