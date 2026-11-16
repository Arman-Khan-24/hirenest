import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Clock, Loader2, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { DeviceCheck, VoiceInterviewRoom } from '../../components/domain/VoiceInterview';
import { CandidateReportScreen } from '../../components/domain/CandidateReport';
import { stopStream } from '../../lib/interviewMedia';
import { PublicInterviewError, publicInterviewApi, type PublicInterviewView } from '../../api/aiInterviews';

const MAX_CHARS = 4000;

const draftKey = (token: string, n: number) => `hn-ai-draft:${token.slice(0, 12)}:${n}`;
const readDraft = (token: string, n: number) => {
  try {
    return localStorage.getItem(draftKey(token, n)) || '';
  } catch {
    return '';
  }
};
const writeDraft = (token: string, n: number, v: string) => {
  try {
    if (v) localStorage.setItem(draftKey(token, n), v);
    else localStorage.removeItem(draftKey(token, n));
  } catch {
    /* storage unavailable: drafts just won't persist */
  }
};

const Shell: React.FC<{ children: React.ReactNode; subtitle?: string }> = ({ children, subtitle }) => (
  <div className="min-h-[100dvh] flex flex-col bg-[var(--app-bg)] text-[var(--text-primary)]">
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary-bg)] text-sm font-bold text-white">
            H
          </span>
          <span className="text-[15px] font-semibold tracking-tight">HireNest</span>
        </div>
        {subtitle && <span className="truncate pl-3 text-[12px] text-[var(--text-secondary)]">{subtitle}</span>}
      </div>
    </header>
    {children}
  </div>
);

const Notice: React.FC<{ title: string; body: string; tone?: 'ok' | 'warn' }> = ({ title, body, tone = 'warn' }) => (
  <main className="flex flex-1 items-center justify-center px-4 py-10">
    <div className="w-full max-w-md rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
      {tone === 'ok' ? (
        <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" aria-hidden />
      ) : (
        <Clock className="mx-auto h-9 w-9 text-amber-600" aria-hidden />
      )}
      <h1 className="mt-3 text-[18px] font-semibold">{title}</h1>
      <p className="mt-2 text-[14px] leading-[22px] text-[var(--text-secondary)]">{body}</p>
    </div>
  </main>
);

export const AiInterviewPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const [view, setView] = useState<PublicInterviewView | null>(null);
  const [fatal, setFatal] = useState<{ title: string; body: string; tone?: 'ok' | 'warn' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const resumed = useRef(false);
  const finalized = useRef(false);
  const [reportFailed, setReportFailed] = useState(false);

  const shownAt = useRef<number>(Date.now());
  const pasted = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const applyView = useCallback(
    (v: PublicInterviewView) => {
      setView(v);
      setError(null);
      setConfirmFinish(false);
      shownAt.current = Date.now();
      pasted.current = false;
      setAnswer(v.current ? readDraft(token, v.current.number) : '');
    },
    [token]
  );

  const handleFailure = useCallback((e: unknown) => {
    if (e instanceof PublicInterviewError) {
      if (e.status === 404) {
        setFatal({ title: 'Link not valid', body: 'This interview link is not valid. Please check the link in your invitation email, or ask your recruiter for a new one.' });
        return;
      }
      if (e.status === 410) {
        setFatal({ title: 'This interview is no longer available', body: e.message });
        return;
      }
      return setError(e.message);
    }
    setError('We could not reach the interview service. Check your connection and try again.');
  }, []);

  useEffect(() => {
    let alive = true;
    publicInterviewApi
      .load(token)
      .then((v) => {
        if (!alive) return;
        resumed.current = v.status === 'in_progress';
        applyView(v);
      })
      .catch((e) => alive && handleFailure(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token, applyView, handleFailure]);

  const changeStream = useCallback((next: MediaStream | null) => {
    if (streamRef.current && streamRef.current !== next) stopStream(streamRef.current);
    streamRef.current = next;
    setStream(next);
  }, []);

  // Release the camera when leaving, and when the interview is over.
  useEffect(() => () => stopStream(streamRef.current), []);
  useEffect(() => {
    if (view?.status !== 'completed') return;
    changeStream(null);
    if (view.reportPending && !finalized.current) {
      finalized.current = true;
      publicInterviewApi
        .finalize(token)
        .then((v) => setView(v))
        .catch(() => setReportFailed(true));
    }
  }, [view?.status, view?.reportPending, token, changeStream]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [view?.transcript.length, sending, pending]);

  useEffect(() => {
    if (view?.current && !sending) textRef.current?.focus({ preventScroll: true });
  }, [view?.current?.number, sending]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      applyView(await publicInterviewApi.start(token));
    } catch (e) {
      handleFailure(e);
    } finally {
      setStarting(false);
    }
  };

  const send = async () => {
    if (!view?.current || sending) return;
    const text = answer.trim();
    if (!text) {
      setError('Please write an answer before sending.');
      return;
    }
    setSending(true);
    setError(null);
    setPending(text);
    setAnswer('');
    const n = view.current.number;
    try {
      const next = await publicInterviewApi.answer(token, {
        answer: text,
        questionNumber: n,
        seconds: Math.round((Date.now() - shownAt.current) / 1000),
        pasted: pasted.current,
      });
      writeDraft(token, n, '');
      setPending(null);
      applyView(next);
    } catch (e) {
      setPending(null);
      if (e instanceof PublicInterviewError && e.status === 409 && e.view) applyView(e.view);
      else {
        setAnswer(text);
        handleFailure(e);
      }
    } finally {
      setSending(false);
    }
  };

  const finishEarly = async () => {
    setSending(true);
    setError(null);
    try {
      applyView(await publicInterviewApi.finish(token));
    } catch (e) {
      handleFailure(e);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <main className="flex flex-1 items-center justify-center" aria-busy="true">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" aria-label="Loading" />
        </main>
      </Shell>
    );
  }
  if (fatal) {
    return (
      <Shell>
        <Notice {...fatal} />
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <Notice title="Something went wrong" body={error || 'Please reload the page and try again.'} />
      </Shell>
    );
  }

  const voice = view.mode === 'voice_video';
  const minutes = Math.round(view.maxQuestions * (voice ? 3 : 2.5));

  if (view.status === 'completed') {
    if (view.report) {
      return (
        <Shell subtitle={view.roleTitle}>
          <CandidateReportScreen
            token={token}
            firstName={view.candidateFirstName}
            report={view.report}
            emailHint={view.emailHint}
            signupUrl={view.signupUrl || '/signup'}
          />
        </Shell>
      );
    }
    if (view.reportPending && !reportFailed) {
      return (
        <Shell subtitle={view.roleTitle}>
          <main className="flex flex-1 items-center justify-center px-4 py-10" role="status" aria-busy="true">
            <div className="w-full max-w-md rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--accent)]" aria-hidden />
              <h1 className="mt-3 text-[18px] font-semibold">Thank you, {view.candidateFirstName}</h1>
              <p className="mt-2 text-[14px] leading-[22px] text-[var(--text-secondary)]">Your interview is complete. We are preparing your scorecard. This takes about half a minute.</p>
            </div>
          </main>
        </Shell>
      );
    }
    return (
      <Shell subtitle={view.roleTitle}>
        <Notice
          tone="ok"
          title={`Thank you, ${view.candidateFirstName}`}
          body="Your interview is complete and has been sent to the recruiting team. A recruiter will review your answers and be in touch about next steps. You can close this page."
        />
      </Shell>
    );
  }

  if (view.status === 'invited') {
    return (
      <Shell subtitle={view.roleTitle}>
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
          <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
            <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--accent)]">
              <Sparkles className="h-4 w-4" aria-hidden /> {voice ? 'Recorded video interview' : 'Written interview'}
            </div>
            <h1 className="mt-2 text-[22px] font-semibold leading-[28px] tracking-[-0.01em]">
              Hi {view.candidateFirstName}, welcome to your interview for {view.roleTitle}
            </h1>
            <p className="mt-2 text-[14px] leading-[22px] text-[var(--text-secondary)]">
              {voice
                ? `You will answer ${view.maxQuestions} short questions out loud on camera, about ${minutes} minutes in total. Each question is read to you; then you record your answer. Find a quiet, well-lit place, use your own words and give real examples.`
                : `You will answer ${view.maxQuestions} short questions in writing, about ${minutes} minutes in total. Take your time, use your own words, and give real examples where you can. You can come back to this link if you get interrupted.`}
            </p>

            <div className="mt-5 rounded-[10px] border border-[var(--border)] bg-[var(--bg-subtle)] p-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden /> Before you begin
              </div>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-[20px] text-[var(--text-secondary)]">
                <li>An AI assistant asks the questions. It only helps; a human recruiter reviews your answers and makes every decision.</li>
                {voice ? (
                  <>
                    <li>Your camera and microphone are <strong>required and recorded</strong>. Recordings are kept for 90 days, then deleted, and reviewed by HireNest recruiters (who may also observe live).</li>
                    <li>AI transcribes your answers and rates your spoken communication (clarity, fluency, structure, vocabulary, tone). Accent is not scored. A recruiter reviews everything and makes every decision.</li>
                    <li>Please stay on this page. Switching tabs or windows, and pasting text, are recorded and shown to the recruiter.</li>
                    <li>A summary scorecard of this screening round may be shared with the hiring client.</li>
                  </>
                ) : (
                  <li>We store your answers, how long each took, and whether text was pasted, and share them with HireNest and the hiring team for this role.</li>
                )}
                <li>Please do not include sensitive personal details such as ID numbers, bank details or health information.</li>
                <li>You can stop at any time. Contact info@hirenestworkforce.com for any question about your data.</li>
              </ul>
              {voice && (
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <DeviceCheck stream={stream} onStream={changeStream} />
                </div>
              )}
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[13px] font-medium">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary-bg)]"
                />
                <span>I understand and agree to take this interview on these terms.</span>
              </label>
            </div>

            {error && (
              <p role="alert" className="mt-4 text-[13px] text-[var(--status-danger)]">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={start}
              disabled={!consent || starting || (voice && !stream)}
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--primary-bg)] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {starting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {starting ? 'Preparing your first question…' : voice && !stream ? 'Enable camera and microphone to start' : 'Start interview'}
            </button>
          </div>
        </main>
      </Shell>
    );
  }

  // in progress (spoken interview)
  if (voice) {
    const vp = Math.min(100, Math.round((view.answered / view.maxQuestions) * 100));
    return (
      <Shell subtitle={view.roleTitle}>
        <div className="border-b border-[var(--border)] bg-[var(--surface)]">
          <div className="mx-auto max-w-3xl px-4 py-2.5 sm:px-6">
            <div className="flex items-center justify-between text-[12px] text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">Recorded interview</span>
              <span>{vp}% complete</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--track)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={vp}>
              <div className="h-full rounded-full bg-[var(--primary-bg)] transition-all" style={{ width: `${vp}%` }} />
            </div>
          </div>
        </div>
        <VoiceInterviewRoom
          token={token}
          view={view}
          stream={stream}
          resumed={resumed.current}
          onStream={changeStream}
          onView={applyView}
          onFatal={handleFailure}
        />
      </Shell>
    );
  }

  // in progress (written interview)
  const current = view.current;
  const progress = Math.min(100, Math.round((view.answered / view.maxQuestions) * 100));
  const tooLong = answer.length > MAX_CHARS;

  return (
    <Shell subtitle={view.roleTitle}>
      <div className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto max-w-3xl px-4 py-2.5 sm:px-6">
          <div className="flex items-center justify-between text-[12px] text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">
              Question {Math.min(view.answered + 1, view.maxQuestions)} of {view.maxQuestions}
            </span>
            <span>{progress}% complete</span>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--track)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div className="h-full rounded-full bg-[var(--primary-bg)] transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
        <div className="flex-1 space-y-4 py-5" aria-live="polite">
          {view.transcript.map((m, i) =>
            m.role === 'ai' ? (
              <div key={`${m.n}-${i}`} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary-bg)] text-[11px] font-bold text-white" aria-hidden>
                  AI
                </span>
                <div className="max-w-[88%] rounded-[12px] rounded-tl-[4px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[14px] leading-[22px]">
                  <div className="sr-only">Question {m.n}</div>
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={`${m.n}-${i}`} className="flex justify-end">
                <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-[12px] rounded-tr-[4px] bg-[var(--primary-bg)] px-3.5 py-2.5 text-[14px] leading-[22px] text-white">
                  {m.text}
                </div>
              </div>
            )
          )}
          {pending && (
            <div className="flex justify-end">
              <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-[12px] rounded-tr-[4px] bg-[var(--primary-bg)] px-3.5 py-2.5 text-[14px] leading-[22px] text-white opacity-80">
                {pending}
              </div>
            </div>
          )}
          {sending && (
            <div className="flex items-start gap-2.5" role="status">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary-bg)] text-[11px] font-bold text-white" aria-hidden>
                AI
              </span>
              <div className="flex items-center gap-1 rounded-[12px] rounded-tl-[4px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3">
                <span className="sr-only">Preparing the next question</span>
                {[0, 1, 2].map((d) => (
                  <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-tertiary)]" style={{ animationDelay: `${d * 150}ms` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {current && (
          <div className="sticky bottom-0 -mx-4 border-t border-[var(--border)] bg-[var(--app-bg)] px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:px-6">
            {error && (
              <p role="alert" className="mb-2 text-[13px] text-[var(--status-danger)]">
                {error}
              </p>
            )}
            <label htmlFor="ai-answer" className="sr-only">
              Your answer to question {current.number}
            </label>
            <textarea
              id="ai-answer"
              ref={textRef}
              value={answer}
              disabled={sending}
              rows={4}
              placeholder="Type your answer here. Specific examples work best."
              onChange={(e) => {
                setAnswer(e.target.value);
                writeDraft(token, current.number, e.target.value);
              }}
              onPaste={(e) => {
                if ((e.clipboardData?.getData('text') || '').length >= 40) pasted.current = true;
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void send();
                }
              }}
              className="w-full resize-none rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[14px] leading-[22px] placeholder:text-[var(--text-tertiary)] focus:border-[var(--focus-border)] focus:outline-none focus:ring-[3px] focus:ring-[var(--focus-ring)] disabled:opacity-60"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="min-w-0 text-[12px] text-[var(--text-tertiary)]">
                <span className={tooLong ? 'font-medium text-[var(--status-danger)]' : ''}>
                  {answer.length}/{MAX_CHARS}
                </span>
                {view.answered >= 1 && !confirmFinish && (
                  <button
                    type="button"
                    onClick={() => setConfirmFinish(true)}
                    disabled={sending}
                    className="ml-3 underline underline-offset-2 hover:text-[var(--text-primary)] disabled:opacity-50"
                  >
                    End interview early
                  </button>
                )}
                {confirmFinish && (
                  <span className="ml-3">
                    End now?{' '}
                    <button type="button" onClick={finishEarly} disabled={sending} className="font-semibold text-[var(--status-danger)] underline underline-offset-2">
                      Yes, end
                    </button>{' '}
                    <button type="button" onClick={() => setConfirmFinish(false)} className="underline underline-offset-2">
                      Keep going
                    </button>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={send}
                disabled={sending || !answer.trim() || tooLong}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] bg-[var(--primary-bg)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                {view.answered + 1 >= view.maxQuestions ? 'Submit' : 'Send'}
              </button>
            </div>
            <p className="mt-1.5 hidden text-[11px] text-[var(--text-tertiary)] sm:block">Press Ctrl+Enter (or Cmd+Enter) to send.</p>
          </div>
        )}
      </main>
    </Shell>
  );
};
