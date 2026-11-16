import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Loader2, Mic, RotateCcw, Square, Volume2 } from 'lucide-react';
import {
  PublicInterviewError,
  publicInterviewApi,
  uploadRecording,
  type PublicInterviewView,
  type RecordingRef,
} from '../../api/aiInterviews';
import {
  AnswerRecorder,
  DeviceError,
  acquireDevices,
  checkBrowserSupport,
  devicesLive,
  speak,
  stopStream,
  ttsSupported,
  watchLevel,
  type RecordedAnswer,
} from '../../lib/interviewMedia';
import { useInterviewMonitor } from '../../lib/useInterviewMonitor';

const MAX_TYPED_CHARS = 4000;
const MIN_ANSWER_SECONDS = 3;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Mirrored live camera preview. */
const Preview: React.FC<{ stream: MediaStream | null; className?: string }> = ({ stream, className = '' }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      muted
      playsInline
      aria-label="Your camera preview"
      className={`aspect-video w-full -scale-x-100 rounded-[10px] bg-black object-cover ${className}`}
    />
  );
};

const LevelBar: React.FC<{ level: number }> = ({ level }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--track)]" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
    <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-75" style={{ width: `${Math.max(2, Math.round(level * 100))}%` }} />
  </div>
);

// ------------------------------------------------------------------ device check
export const DeviceCheck: React.FC<{
  stream: MediaStream | null;
  onStream: (s: MediaStream | null) => void;
}> = ({ stream, onStream }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [speakerTested, setSpeakerTested] = useState(false);
  const support = checkBrowserSupport();

  useEffect(() => {
    if (!stream) return;
    return watchLevel(stream, (l) => {
      setLevel(l);
      if (l > 0.12) setHeard(true);
    });
  }, [stream]);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      onStream(await acquireDevices());
    } catch (e) {
      setError(e instanceof DeviceError || e instanceof Error ? e.message : 'Could not start your camera and microphone.');
    } finally {
      setBusy(false);
    }
  };

  if (!support.ok) {
    return (
      <div role="alert" className="rounded-[10px] border border-amber-300/60 bg-amber-50 p-3 text-[13px] leading-[20px] text-amber-900">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4" aria-hidden /> This browser cannot take the recorded interview
        </div>
        It does not support {support.missing.join(', ')}. Please open this link in the latest Chrome, Edge, Firefox or Safari, on a phone or laptop with a camera.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[13px] font-semibold">Camera and microphone check</div>
      {stream ? (
        <div className="space-y-2.5">
          <Preview stream={stream} className="max-w-sm" />
          <ul className="space-y-1.5 text-[13px]">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> Camera is on
            </li>
            <li className="flex items-center gap-2">
              {heard ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> : <Mic className="h-4 w-4 text-[var(--text-tertiary)]" aria-hidden />}
              {heard ? 'Microphone is working' : 'Say a few words: the bar below should move'}
            </li>
          </ul>
          <LevelBar level={level} />
          {ttsSupported() && (
            <div className="flex items-center gap-2 text-[13px]">
              <button
                type="button"
                onClick={() => {
                  speak('Hello. This is your interviewer. If you can hear me clearly, you are ready to begin.', () => undefined, () => setSpeakerTested(true));
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 font-medium hover:bg-[var(--bg-hover)]"
              >
                <Volume2 className="h-3.5 w-3.5" aria-hidden /> Test speaker
              </button>
              <span className="text-[12px] text-[var(--text-tertiary)]">{speakerTested ? 'Questions will be read aloud like this.' : 'Questions are read aloud, so turn your volume up.'}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[var(--primary-bg)] bg-[var(--surface)] px-4 text-[14px] font-semibold text-[var(--primary-bg)] hover:bg-[var(--highlight-soft)] disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
            Enable camera and microphone
          </button>
          <p className="text-[12px] text-[var(--text-tertiary)]">Both are required. Your browser will ask for permission.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-[var(--status-danger)]">
          {error}
        </p>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ interview room
type Phase = 'reading' | 'ready' | 'recording' | 'uploading' | 'analysing' | 'error';
interface RoomError {
  code: 'no_speech' | 'transcription_failed' | 'upload' | 'other';
  message: string;
}

export const VoiceInterviewRoom: React.FC<{
  token: string;
  view: PublicInterviewView;
  stream: MediaStream | null;
  resumed: boolean;
  onStream: (s: MediaStream | null) => void;
  onView: (v: PublicInterviewView) => void;
  onFatal: (e: unknown) => void;
}> = ({ token, view, stream, resumed, onStream, onView, onFatal }) => {
  const current = view.current;
  const monitor = useInterviewMonitor({ token, active: true, questionNo: current?.number ?? null });
  const [phase, setPhase] = useState<Phase>('reading');
  const [speaking, setSpeaking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<RoomError | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [regaining, setRegaining] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [live, setLive] = useState(() => devicesLive(stream));

  const recorder = useRef<AnswerRecorder | null>(null);
  const lastRecorded = useRef<RecordedAnswer | null>(null);
  const lastRef = useRef<RecordingRef | null>(null);
  const cancelSpeech = useRef<() => void>(() => undefined);
  const prevLive = useRef(live);
  const reportedReload = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Report a resumed session (page reloaded mid-interview).
  useEffect(() => {
    if (resumed && !reportedReload.current) {
      reportedReload.current = true;
      monitor.report({ type: 'page_reload' });
    }
  }, [resumed, monitor]);

  // Watch the camera and microphone: both must stay on for the whole interview.
  useEffect(() => {
    setLive(devicesLive(stream));
    if (!stream) return;
    const tick = window.setInterval(() => setLive(devicesLive(stream)), 1000);
    return () => window.clearInterval(tick);
  }, [stream]);
  useEffect(() => {
    const p = prevLive.current;
    if (p.camera && !live.camera) monitor.report({ type: 'camera_lost' });
    if (p.mic && !live.mic) monitor.report({ type: 'mic_lost' });
    if ((!p.camera || !p.mic) && live.camera && live.mic) monitor.report({ type: 'devices_restored' });
    prevLive.current = live;
  }, [live, monitor]);
  const devicesOk = live.camera && live.mic;

  // Mic level while recording.
  useEffect(() => {
    if (phase !== 'recording' || !stream) return;
    return watchLevel(stream, setLevel);
  }, [phase, stream]);

  // Read each new question aloud.
  const readQuestion = useCallback(() => {
    if (!current) return;
    cancelSpeech.current();
    setSpeaking(false);
    cancelSpeech.current = speak(
      current.text,
      () => setSpeaking(true),
      () => {
        setSpeaking(false);
        setPhase((p) => (p === 'reading' ? 'ready' : p));
      }
    );
  }, [current]);

  useEffect(() => {
    if (!current) return;
    setPhase('reading');
    setError(null);
    setTyping(false);
    setTyped('');
    setElapsed(0);
    setConfirmFinish(false);
    lastRecorded.current = null;
    lastRef.current = null;
    const t = window.setTimeout(readQuestion, 350);
    return () => {
      window.clearTimeout(t);
      cancelSpeech.current();
    };
  }, [current?.number]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      cancelSpeech.current();
      recorder.current?.cancel();
    },
    []
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [view.transcript.length, phase]);

  // Timer + automatic stop at the time limit.
  useEffect(() => {
    if (phase !== 'recording') return;
    const t = window.setInterval(() => {
      const s = recorder.current?.elapsedSeconds() ?? 0;
      setElapsed(s);
      if (s >= view.maxAnswerSeconds) void stopAndSubmit();
    }, 250);
    return () => window.clearInterval(t);
  }, [phase, view.maxAnswerSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  const regainDevices = async () => {
    setRegaining(true);
    setGateError(null);
    try {
      stopStream(stream);
      onStream(await acquireDevices());
    } catch (e) {
      setGateError(e instanceof Error ? e.message : 'Could not start your camera and microphone.');
    } finally {
      setRegaining(false);
    }
  };

  const handleFailure = (e: unknown) => {
    if (e instanceof PublicInterviewError) {
      if (e.status === 409 && e.view) return onView(e.view);
      if (e.status === 404 || e.status === 410) return onFatal(e);
      if (e.code === 'no_speech') return fail({ code: 'no_speech', message: e.message });
      if (e.code === 'transcription_failed') return fail({ code: 'transcription_failed', message: e.message });
      return fail({ code: e.code === 'recording_missing' ? 'upload' : 'other', message: e.message });
    }
    fail({ code: 'other', message: 'We could not reach the interview service. Check your connection and try again.' });
  };
  const fail = (er: RoomError) => {
    setError(er);
    setPhase('error');
  };

  const sendRecorded = async (ref: RecordingRef) => {
    if (!current) return;
    setPhase('analysing');
    try {
      const next = await publicInterviewApi.answerRecorded(token, { questionNumber: current.number, seconds: Math.round(ref.durationSeconds), recording: ref });
      onView(next);
    } catch (e) {
      handleFailure(e);
    }
  };

  const uploadAndSend = async (rec: RecordedAnswer) => {
    if (!current) return;
    setPhase('uploading');
    try {
      const urls = await publicInterviewApi.uploadUrls(token, { questionNumber: current.number, videoMime: rec.videoMime });
      await Promise.all([
        uploadRecording(urls.bucket, urls.audio, rec.wav, 'audio/wav'),
        uploadRecording(urls.bucket, urls.video, rec.video, rec.videoMime),
      ]);
      const ref: RecordingRef = { audioPath: urls.audio.path, videoPath: urls.video.path, videoMime: rec.videoMime, durationSeconds: rec.seconds };
      lastRef.current = ref;
      await sendRecorded(ref);
    } catch (e) {
      if (e instanceof PublicInterviewError) handleFailure(e);
      else fail({ code: 'upload', message: 'Your recording could not be uploaded. Check your connection and try again.' });
    }
  };

  const startAnswering = async () => {
    if (!stream || !devicesOk) return;
    cancelSpeech.current();
    setSpeaking(false);
    setError(null);
    try {
      const r = new AnswerRecorder(stream);
      recorder.current = r;
      await r.start();
      setElapsed(0);
      setPhase('recording');
    } catch {
      fail({ code: 'other', message: 'Recording could not start. Check that your camera and microphone are on, then try again.' });
    }
  };

  const stopAndSubmit = async () => {
    const r = recorder.current;
    if (!r) return;
    if (r.elapsedSeconds() < MIN_ANSWER_SECONDS) {
      setError({ code: 'other', message: 'Please answer for at least a few seconds.' });
      return;
    }
    recorder.current = null;
    try {
      const rec = await r.stop();
      lastRecorded.current = rec;
      await uploadAndSend(rec);
    } catch {
      fail({ code: 'other', message: 'Your recording could not be saved. Please record this answer again.' });
    }
  };

  const retry = async () => {
    setError(null);
    if (lastRef.current && error?.code === 'transcription_failed') return sendRecorded(lastRef.current);
    if (lastRecorded.current && error?.code === 'upload') return uploadAndSend(lastRecorded.current);
    setPhase('ready');
  };

  const sendTyped = async () => {
    const text = typed.trim();
    if (!text || !current) return;
    setPhase('analysing');
    try {
      onView(
        await publicInterviewApi.answerFallback(token, {
          questionNumber: current.number,
          seconds: Math.round(elapsed),
          fallbackText: text,
          fallbackReason: error?.code === 'no_speech' ? 'no_speech' : 'transcription_failed',
        })
      );
    } catch (e) {
      handleFailure(e);
    }
  };

  const finishEarly = async () => {
    setPhase('analysing');
    try {
      onView(await publicInterviewApi.finish(token));
    } catch (e) {
      handleFailure(e);
    }
  };

  const busy = phase === 'uploading' || phase === 'analysing';
  const remaining = Math.max(0, view.maxAnswerSeconds - elapsed);
  const pct = Math.min(100, (elapsed / view.maxAnswerSeconds) * 100);

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-6 sm:px-6">
      {/* camera + microphone must stay on */}
      {!devicesOk && (
        <div className="absolute inset-0 z-20 flex items-start justify-center bg-[var(--app-bg)]/95 px-4 pt-16" role="alertdialog" aria-modal="true" aria-label="Camera and microphone required">
          <div className="w-full max-w-md rounded-[14px] border border-amber-300 bg-[var(--surface)] p-6 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" aria-hidden />
            <h2 className="mt-2 text-[17px] font-semibold">Camera and microphone required</h2>
            <p className="mt-1.5 text-[13px] leading-[20px] text-[var(--text-secondary)]">
              {resumed && !stream ? 'Welcome back. ' : ''}Both must stay on for the whole interview. Turn them on to continue where you left off.
            </p>
            {gateError && (
              <p role="alert" className="mt-2 text-[13px] text-[var(--status-danger)]">
                {gateError}
              </p>
            )}
            <button
              type="button"
              onClick={regainDevices}
              disabled={regaining}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-[10px] bg-[var(--primary-bg)] px-5 text-[14px] font-semibold text-white disabled:opacity-60"
            >
              {regaining && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Enable camera and microphone
            </button>
          </div>
        </div>
      )}

      {monitor.awayCount > 0 && (
        <div role="status" className="mt-3 flex items-start gap-2 rounded-[10px] border border-amber-300/70 bg-amber-50 px-3 py-2 text-[12px] leading-[18px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          You left this page {monitor.awayCount} time{monitor.awayCount === 1 ? '' : 's'}. Please stay on this page during the interview. This is recorded and your recruiter will see it.
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,260px)_1fr]">
        <div className="space-y-2">
          <div className="relative">
            <Preview stream={stream} />
            {phase === 'recording' && (
              <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden /> REC {mmss(elapsed)}
              </span>
            )}
          </div>
          {phase === 'recording' && <LevelBar level={level} />}
          <p className="text-[11px] leading-[16px] text-[var(--text-tertiary)]">Your camera and microphone are recorded for this interview and reviewed by your recruiter.</p>
        </div>

        <div className="space-y-3">
          {/* transcript so far */}
          <div className="max-h-44 space-y-2 overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3" aria-live="polite">
            {view.transcript.length <= 1 && <p className="text-[12px] text-[var(--text-tertiary)]">Your answers appear here after each question.</p>}
            {view.transcript
              .filter((m) => !(m.role === 'ai' && current && m.n === current.number))
              .map((m, i) =>
                m.role === 'ai' ? (
                  <div key={`${m.n}-${i}`} className="text-[12px] leading-[18px] text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--accent)]">Q{m.n}.</span> {m.text}
                  </div>
                ) : (
                  <div key={`${m.n}-${i}`} className="rounded-[8px] bg-[var(--bg-subtle)] p-2 text-[12px] leading-[18px]">
                    <span className="font-semibold">You said:</span> {m.text}
                  </div>
                )
              )}
            <div ref={bottomRef} />
          </div>

          {/* current question */}
          {current && (
            <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between text-[12px] text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--text-primary)]">
                  Question {current.number} of {view.maxQuestions}
                </span>
                <span>{view.answered} answered</span>
              </div>
              <div className="mt-2 flex items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary-bg)] text-[11px] font-bold text-white" aria-hidden>
                  AI
                </span>
                <p className="text-[15px] leading-[24px]" aria-live="polite">
                  {current.text}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-tertiary)]">
                {speaking && (
                  <span className="inline-flex items-center gap-1.5 text-[var(--accent)]">
                    <Volume2 className="h-3.5 w-3.5 animate-pulse" aria-hidden /> Reading the question aloud…
                  </span>
                )}
                {!busy && phase !== 'recording' && ttsSupported() && (
                  <button type="button" onClick={readQuestion} className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-[var(--text-primary)]">
                    <RotateCcw className="h-3 w-3" aria-hidden /> Replay question
                  </button>
                )}
              </div>
            </div>
          )}

          {/* controls */}
          {current && !typing && (
            <div className="space-y-2.5">
              {phase === 'recording' && (
                <div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--track)]">
                    <div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--text-tertiary)]">{mmss(remaining)} left for this answer. It stops automatically.</div>
                </div>
              )}
              {busy && (
                <div role="status" className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {phase === 'uploading' ? 'Uploading your answer…' : 'Listening to your answer and preparing the next question…'}
                </div>
              )}
              {error && (
                <div role="alert" className="rounded-[10px] border border-amber-300/70 bg-amber-50 p-3 text-[13px] leading-[20px] text-amber-900">
                  {error.message}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {error.code !== 'other' && (
                      <button type="button" onClick={retry} className="inline-flex h-8 items-center rounded-[8px] bg-[var(--primary-bg)] px-3 text-[12px] font-semibold text-white">
                        {error.code === 'no_speech' ? 'Record again' : 'Try again'}
                      </button>
                    )}
                    {(error.code === 'transcription_failed' || error.code === 'no_speech') && (
                      <button type="button" onClick={() => setTyping(true)} className="inline-flex h-8 items-center rounded-[8px] border border-amber-400 bg-white px-3 text-[12px] font-semibold">
                        Type my answer instead
                      </button>
                    )}
                    {error.code === 'other' && phase !== 'recording' && (
                      <button type="button" onClick={() => { setError(null); setPhase('ready'); }} className="inline-flex h-8 items-center rounded-[8px] border border-amber-400 bg-white px-3 text-[12px] font-semibold">
                        OK
                      </button>
                    )}
                  </div>
                </div>
              )}
              {!busy && phase !== 'error' && (
                <div className="flex flex-wrap items-center gap-3">
                  {phase === 'recording' ? (
                    <button type="button" onClick={stopAndSubmit} className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-red-600 px-5 text-[14px] font-semibold text-white hover:bg-red-700">
                      <Square className="h-4 w-4 fill-current" aria-hidden /> Stop and submit answer
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startAnswering}
                      disabled={!devicesOk}
                      className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[var(--primary-bg)] px-5 text-[14px] font-semibold text-white hover:bg-[var(--primary-hover)] disabled:opacity-50"
                    >
                      <Mic className="h-4 w-4" aria-hidden /> {phase === 'reading' ? 'Start answering now' : 'Start answering'}
                    </button>
                  )}
                  {view.answered >= 1 && phase !== 'recording' && !confirmFinish && (
                    <button type="button" onClick={() => setConfirmFinish(true)} className="text-[12px] text-[var(--text-tertiary)] underline underline-offset-2 hover:text-[var(--text-primary)]">
                      End interview early
                    </button>
                  )}
                  {confirmFinish && (
                    <span className="text-[12px] text-[var(--text-tertiary)]">
                      End now?{' '}
                      <button type="button" onClick={finishEarly} className="font-semibold text-[var(--status-danger)] underline underline-offset-2">
                        Yes, end
                      </button>{' '}
                      <button type="button" onClick={() => setConfirmFinish(false)} className="underline underline-offset-2">
                        Keep going
                      </button>
                    </span>
                  )}
                </div>
              )}
              {phase !== 'recording' && !busy && !error && (
                <p className="text-[12px] text-[var(--text-tertiary)]">
                  Speak for up to {Math.round(view.maxAnswerSeconds / 60)} minute{view.maxAnswerSeconds >= 120 ? 's' : ''}. Give a real example if you can.
                </p>
              )}
            </div>
          )}

          {typing && current && (
            <div className="space-y-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3">
              <label htmlFor="typed-answer" className="text-[12px] font-medium text-[var(--text-secondary)]">
                Type your answer (this will be marked as not recorded)
              </label>
              <textarea
                id="typed-answer"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                rows={4}
                className="w-full resize-none rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[14px] leading-[22px] focus:border-[var(--focus-border)] focus:outline-none focus:ring-[3px] focus:ring-[var(--focus-ring)]"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-[var(--text-tertiary)]">
                  {typed.length}/{MAX_TYPED_CHARS}
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setTyping(false)} className="h-9 rounded-[8px] border border-[var(--border)] px-3 text-[13px] font-medium">
                    Back to recording
                  </button>
                  <button
                    type="button"
                    onClick={sendTyped}
                    disabled={!typed.trim() || typed.length > MAX_TYPED_CHARS || busy}
                    className="h-9 rounded-[8px] bg-[var(--primary-bg)] px-4 text-[13px] font-semibold text-white disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
