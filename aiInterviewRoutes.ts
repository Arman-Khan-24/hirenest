import type express from 'express';
import type { GoogleGenAI } from '@google/genai';
import {
  MAX_ANSWER_CHARS,
  PROMPT_VERSION,
  RECORDINGS_RETENTION_DAYS,
  aggregateVoice,
  answeredCount,
  buildEvalPrompt,
  buildQuestionPrompt,
  buildScorecard,
  buildVoicePrompt,
  canEvaluate,
  clampAnswerSeconds,
  clampQuestions,
  consentVersionFor,
  fallbackQuestion,
  finalizeEvaluation,
  hashToken,
  integritySummary,
  isPlausibleToken,
  newToken,
  parseEvaluation,
  parseQuestion,
  parseVoiceAnalysis,
  sanitizeAnswer,
  withTimeout,
  type AnswerSignal,
  type InterviewContext,
  type InterviewMode,
  type Turn,
} from './aiInterviewCore';
import {
  RECORDINGS_BUCKET,
  createSupabaseStore,
  type EventInput,
  type RecordingRow,
  type SessionRow,
  type SessionStore,
  type SubmissionContext,
} from './aiInterviewStore';

export { createSupabaseStore };
export type { SessionRow, SessionStore, SubmissionContext, RecordingRow };

type AuthResult =
  | { ok: true; userId: string; role: string; orgId: string | null }
  | { ok: false; status: number; message: string };

export interface AiInterviewDeps {
  authenticate: (req: express.Request, opts?: { strict?: boolean }) => Promise<AuthResult>;
  getStore: () => SessionStore | null;
  getAi: () => GoogleGenAI | null;
  generate: (
    ai: GoogleGenAI,
    model: 'gemini-2.5-flash-lite' | 'gemini-2.5-flash',
    contents: string,
    system: string,
    schema?: Record<string, unknown>
  ) => Promise<string>;
  /** Sends one audio clip to the model and returns its JSON text. */
  analyzeAudio: (a: { system: string; prompt: string; audio: { mime: string; base64: string }; schema: Record<string, unknown> }) => Promise<string>;
  /** Plain text of a candidate's resume file, or null. */
  getResumeText: (path: string) => Promise<string | null>;
  sendEmail: (to: string[], subject: string, html: string) => Promise<{ ok: boolean; error?: string }>;
  appBaseUrl: () => string;
  cronSecret?: () => string | undefined;
}

// ----------------------------------------------------------------- helpers
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const UUID = /^[0-9a-f-]{36}$/i;
const EVENT_TYPES = new Set([
  'tab_hidden', 'tab_visible', 'window_blur', 'window_focus', 'paste', 'copy',
  'camera_lost', 'mic_lost', 'devices_restored', 'page_reload', 'fullscreen_exit',
]);
const MIN_AUDIO_BYTES = 4096;
const MIN_VIDEO_BYTES = 8192;
const MAX_AUDIO_BYTES = 14 * 1024 * 1024;
const ONLINE_WINDOW_MS = 40_000;

const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(key: string, max: number, windowMs = 60 * 60 * 1000): boolean {
  const now = Date.now();
  if (hits.size > 8000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  const cur = hits.get(key);
  if (!cur || cur.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  cur.count += 1;
  return cur.count > max;
}

function clientIp(req: express.Request): string {
  const xf = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xf) ? xf[0] : xf || '').split(',')[0].trim();
  return first || req.socket.remoteAddress || 'unknown';
}

function questionSource(turns: Turn[]): 'ai' | 'template' | 'mixed' {
  const qs = turns.filter((t) => t.role === 'ai');
  if (qs.every((t) => t.source !== 'template')) return 'ai';
  if (qs.every((t) => t.source === 'template')) return 'template';
  return 'mixed';
}

function isExpired(s: SessionRow): boolean {
  return (s.status === 'invited' || s.status === 'in_progress') && new Date(s.expires_at).getTime() < Date.now();
}

const isOnline = (s: SessionRow) => !!s.last_seen_at && Date.now() - new Date(s.last_seen_at).getTime() < ONLINE_WINDOW_MS;

/** Strips everything a candidate must never see (scores, token hash, staff metadata). */
function publicView(s: SessionRow, ctx: InterviewContext) {
  const last = s.turns[s.turns.length - 1];
  const current = s.status === 'in_progress' && last?.role === 'ai' ? { number: last.n, text: last.text } : null;
  return {
    status: s.status,
    mode: s.mode,
    maxAnswerSeconds: s.max_answer_seconds,
    roleTitle: ctx.roleTitle,
    candidateFirstName: ctx.candidateFirstName,
    maxQuestions: s.max_questions,
    answered: answeredCount(s.turns),
    transcript: s.turns.map((t) => ({ n: t.n, role: t.role, text: t.text })),
    current,
    expiresAt: s.expires_at,
    consentVersion: consentVersionFor(s.mode),
  };
}

function staffView(s: SessionRow, extra: Record<string, unknown> = {}) {
  const { token_hash: _omit, ...rest } = s;
  void _omit;
  return { ...rest, answered: answeredCount(s.turns), online: isOnline(s), ...extra };
}

const extFor = (mime: string) => (/mp4/i.test(mime) ? 'mp4' : 'webm');
const baseMime = (mime: string) => (/mp4/i.test(mime) ? 'video/mp4' : 'video/webm');

// ------------------------------------------------------------------ routes
export function registerAiInterviewRoutes(app: express.Express, deps: AiInterviewDeps): void {
  const noStore = (res: express.Response) => res.setHeader('Cache-Control', 'no-store');
  const resumeCache = new Map<string, { at: number; text: string | null }>();
  const uploadIssued = new Map<string, number>();

  async function withResume(sc: SubmissionContext): Promise<InterviewContext> {
    if (!sc.resumePath) return sc.ctx;
    const hit = resumeCache.get(sc.resumePath);
    let text: string | null;
    if (hit && Date.now() - hit.at < 5 * 60_000) text = hit.text;
    else {
      text = await withTimeout(deps.getResumeText(sc.resumePath), 8000, 'resume').catch(() => null);
      resumeCache.set(sc.resumePath, { at: Date.now(), text });
    }
    return { ...sc.ctx, resumeExcerpt: text ? text.slice(0, 6000) : null };
  }

  async function generateQuestion(ctx: InterviewContext, turns: Turn[], n: number, total: number, mode: InterviewMode) {
    const ai = deps.getAi();
    if (ai) {
      try {
        const p = buildQuestionPrompt(ctx, turns, n, total, mode);
        const raw = await withTimeout(
          deps.generate(ai, 'gemini-2.5-flash', p.contents, p.system, p.schema),
          mode === 'voice_video' ? 15000 : 20000,
          'question'
        );
        const prior = turns.filter((t) => t.role === 'ai').map((t) => t.text);
        return { ...parseQuestion(raw, prior), source: 'ai' as const };
      } catch (e) {
        console.warn('[ai-interview] question generation failed, using template:', e instanceof Error ? e.message : e);
      }
    }
    return { ...fallbackQuestion(ctx, n, total), signal: undefined as AnswerSignal | undefined, source: 'template' as const };
  }

  async function evaluate(store: SessionStore, s: SessionRow, ctx: InterviewContext, turns: Turn[]): Promise<Partial<SessionRow>> {
    if (!canEvaluate(turns)) return { evaluation: null, error: 'insufficient_input' };
    const ai = deps.getAi();
    if (!ai) return { evaluation: null, error: 'ai_unavailable' };
    try {
      const events = s.mode === 'voice_video' ? await store.listEvents(s.id, 600) : [];
      const p = buildEvalPrompt(ctx, turns, aggregateVoice(turns));
      const raw = await withTimeout(deps.generate(ai, 'gemini-2.5-flash', p.contents, p.system, p.schema), 35000, 'evaluation');
      const ev = parseEvaluation(raw);
      const fin = finalizeEvaluation(ev, turns, events);
      return {
        evaluation: fin.evaluation,
        skill_rating: ev.skill_rating,
        communication_rating: fin.communication_rating,
        overall_rating: ev.overall_rating,
        recommendation: ev.recommendation,
        model_name: 'gemini-2.5-flash',
        prompt_version: PROMPT_VERSION,
        error: null,
      };
    } catch (e) {
      console.warn('[ai-interview] evaluation failed:', e instanceof Error ? e.message : e);
      return { evaluation: null, error: 'evaluation_failed' };
    }
  }

  async function notifyCreator(store: SessionStore, s: SessionRow, ctx: InterviewContext, rec: string | null) {
    if (!s.created_by) return;
    await store
      .notify(s.created_by, {
        title: 'AI interview completed',
        body: `${ctx.candidateFirstName} finished the AI interview for ${ctx.roleTitle}.${rec ? ` Recommendation: ${rec}.` : ' Review the recording and transcript.'}`,
        link: `/admin/submissions/${s.submission_id}`,
      })
      .catch(() => undefined);
  }

  /** Runs the (slow) evaluation for a completed session that still lacks one. Safe to call concurrently. */
  async function runEvaluation(store: SessionStore, s: SessionRow, sc: SubmissionContext): Promise<SessionRow | null> {
    const ctx = await withResume(sc);
    const patch = await evaluate(store, s, ctx, s.turns);
    return store.update(s.id, s.version, patch);
  }

  async function ensureEvaluated(store: SessionStore, s: SessionRow): Promise<SessionRow> {
    if (s.status !== 'completed' || s.evaluation || s.error !== 'pending_evaluation') return s;
    const sc = await store.getSubmissionContext(s.submission_id);
    if (!sc) return s;
    return (await runEvaluation(store, s, sc)) || (await store.getById(s.id)) || s;
  }

  async function complete(
    store: SessionStore,
    s: SessionRow,
    sc: SubmissionContext,
    turns: Turn[]
  ): Promise<SessionRow | null> {
    const voice = s.mode === 'voice_video';
    const now = new Date();
    const base: Partial<SessionRow> = {
      turns,
      status: 'completed',
      completed_at: now.toISOString(),
      question_source: questionSource(turns),
      recordings_expire_at: voice ? new Date(now.getTime() + RECORDINGS_RETENTION_DAYS * 86400_000).toISOString() : null,
    };
    if (voice) {
      // Voice evaluation is slow (audio already analysed per answer); defer it so this request stays well under the time limit.
      const u = await store.update(s.id, s.version, { ...base, evaluation: null, error: 'pending_evaluation' });
      if (u) await notifyCreator(store, u, sc.ctx, null);
      return u;
    }
    const ctx = await withResume(sc);
    const patch = await evaluate(store, s, ctx, turns);
    const u = await store.update(s.id, s.version, { ...base, ...patch });
    if (u) await notifyCreator(store, u, ctx, u.recommendation);
    return u;
  }

  async function deleteRecordings(store: SessionStore, s: SessionRow): Promise<number> {
    const recs = await store.listRecordings(s.id);
    const paths = recs.flatMap((r) => [r.video_path, r.audio_path]).filter((p): p is string => !!p);
    await store.removeObjects(paths);
    for (const r of recs) {
      await store.upsertRecording({ session_id: s.id, question_no: r.question_no, status: 'deleted', video_path: null, audio_path: null });
    }
    await store.update(s.id, s.version, { recordings_expire_at: null }).catch(() => null);
    return paths.length;
  }

  // ============================== staff (authenticated, HQ only) ==============================
  async function guardStaff(req: express.Request, res: express.Response, opts: { allowClient?: boolean } = {}) {
    noStore(res);
    const auth = await deps.authenticate(req, { strict: true });
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return null;
    }
    const staff = auth.role === 'admin' || auth.role === 'recruiter';
    const client = auth.role === 'client_manager' || auth.role === 'client_member';
    if (!staff && !(opts.allowClient && client)) {
      res.status(403).json({ error: 'Internal staff access required.' });
      return null;
    }
    const store = deps.getStore();
    if (!store) {
      res.status(503).json({ error: 'Service unavailable.' });
      return null;
    }
    return { auth, store, staff };
  }

  const linkFor = (token: string) => `${deps.appBaseUrl().replace(/\/$/, '')}/ai-interview/${token}`;

  async function emailInvite(store: SessionStore, s: SessionRow, sc: SubmissionContext, link: string) {
    if (!sc.candidateEmail) return { emailSent: false, emailError: 'No email address on file for this candidate.' };
    const mins = Math.round(s.max_questions * (s.mode === 'voice_video' ? 3 : 2.5));
    const expires = new Date(s.expires_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const what =
      s.mode === 'voice_video'
        ? `a short recorded interview. You will need a quiet place, a working camera and microphone, and to stay on the interview page. It takes about ${mins} minutes.`
        : `a short written interview. It takes about ${mins} minutes and you can answer at your own pace on any device.`;
    const html = `<p>Hi ${esc(sc.ctx.candidateFirstName)},</p>
<p>You have been invited to ${what} The role is <strong>${esc(sc.ctx.roleTitle)}</strong> with HireNest.</p>
<p><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;background:#1F4CC4;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Start the interview</a></p>
<p style="font-size:12px;color:#667085">This personal link expires on ${esc(expires)}. Please do not share it. A recruiter reviews every interview; the AI only assists.</p>`;
    const out = await deps.sendEmail([sc.candidateEmail], `Your HireNest interview for ${sc.ctx.roleTitle}`, html);
    if (out.ok) await store.update(s.id, s.version, { invite_email_sent_at: new Date().toISOString() }).catch(() => null);
    return { emailSent: out.ok, emailError: out.ok ? undefined : out.error };
  }

  app.post('/api/ai-interviews', async (req, res) => {
    const g = await guardStaff(req, res);
    if (!g) return;
    try {
      const b = (req.body || {}) as Record<string, unknown>;
      const submissionId = String(b.submissionId || '');
      if (!UUID.test(submissionId)) {
        res.status(400).json({ error: 'A valid submissionId is required.' });
        return;
      }
      const sc = await g.store.getSubmissionContext(submissionId);
      if (!sc) {
        res.status(404).json({ error: 'Submission not found.' });
        return;
      }
      if (sc.stage === 'withdrawn' || sc.stage === 'rejected') {
        res.status(400).json({ error: `Cannot interview a ${sc.stage} submission.` });
        return;
      }
      const mode: InterviewMode = b.mode === 'text' ? 'text' : 'voice_video';
      const hours = Math.max(6, Math.min(336, Math.round(Number(b.expiresInHours)) || 72));
      const expires_at = new Date(Date.now() + hours * 3600_000).toISOString();
      const { token, hash } = newToken();

      const existing = (await g.store.listBySubmission(submissionId)).find(
        (s) => (s.status === 'invited' || s.status === 'in_progress') && !isExpired(s)
      );
      let session: SessionRow;
      if (existing) {
        if (existing.status === 'in_progress') {
          res.status(409).json({ error: 'An AI interview is already in progress for this submission.' });
          return;
        }
        const rotated = await g.store.update(existing.id, existing.version, {
          token_hash: hash,
          expires_at,
          mode,
          max_questions: clampQuestions(b.maxQuestions),
          max_answer_seconds: clampAnswerSeconds(b.maxAnswerSeconds),
        });
        if (!rotated) {
          res.status(409).json({ error: 'The interview changed while you were creating it. Please retry.' });
          return;
        }
        session = rotated;
      } else {
        session = await g.store.create({
          token_hash: hash,
          submission_id: submissionId,
          max_questions: clampQuestions(b.maxQuestions),
          expires_at,
          created_by: g.auth.userId,
          mode,
          max_answer_seconds: clampAnswerSeconds(b.maxAnswerSeconds),
        });
      }
      const link = linkFor(token);
      const mail = b.sendEmail ? await emailInvite(g.store, session, sc, link) : { emailSent: false };
      res.json({ ok: true, session: staffView(session), link, ...mail });
    } catch (e) {
      console.error('[ai-interview] create failed:', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Could not create the AI interview.' });
    }
  });

  async function enrich(store: SessionStore, s: SessionRow) {
    if (s.mode !== 'voice_video') return staffView(s);
    const [events, recs] = await Promise.all([store.listEvents(s.id, 600), store.listRecordings(s.id)]);
    return staffView(s, {
      integrity: integritySummary(events),
      voice: aggregateVoice(s.turns),
      recordings: recs.filter((r) => r.status !== 'deleted').length,
      recordingsDeleted: recs.length > 0 && recs.every((r) => r.status === 'deleted'),
    });
  }

  app.get('/api/ai-interviews', async (req, res) => {
    const g = await guardStaff(req, res);
    if (!g) return;
    const submissionId = String(req.query.submissionId || '');
    if (!UUID.test(submissionId)) {
      res.status(400).json({ error: 'submissionId is required.' });
      return;
    }
    let rows = await g.store.listBySubmission(submissionId);
    rows = await Promise.all(
      rows.map(async (s) => {
        if (isExpired(s)) return (await g.store.update(s.id, s.version, { status: 'expired' })) || s;
        return ensureEvaluated(g.store, s);
      })
    );
    res.json({ sessions: await Promise.all(rows.map((s) => enrich(g.store, s))) });
  });

  // Client-safe scorecards. Staff see every completed evaluation; clients only what HQ has shared.
  app.get('/api/ai-interviews/scorecard', async (req, res) => {
    const g = await guardStaff(req, res, { allowClient: true });
    if (!g) return;
    const submissionId = String(req.query.submissionId || '');
    if (!UUID.test(submissionId)) {
      res.status(400).json({ error: 'submissionId is required.' });
      return;
    }
    const sc = await g.store.getSubmissionContext(submissionId);
    if (!sc) {
      res.status(404).json({ error: 'Submission not found.' });
      return;
    }
    if (!g.staff && (!sc.sharedWithClientAt || !g.auth.orgId || sc.clientOrgId !== g.auth.orgId)) {
      res.status(403).json({ error: 'Not available.' });
      return;
    }
    const rows = (await g.store.listBySubmission(submissionId)).filter(
      (s) => s.status === 'completed' && s.evaluation && (g.staff || s.shared_with_client_at)
    );
    const cards = await Promise.all(
      rows.map(async (s) =>
        buildScorecard(s, {
          candidateName: sc.ctx.candidateFullName,
          roleTitle: sc.ctx.roleTitle,
          reviewedBy: s.shared_by ? await g.store.getProfileName(s.shared_by) : null,
        })
      )
    );
    res.json({ scorecards: cards.filter(Boolean) });
  });

  async function loadForStaff(req: express.Request, res: express.Response) {
    const g = await guardStaff(req, res);
    if (!g) return null;
    const id = String(req.params.id || '');
    const s = UUID.test(id) ? await g.store.getById(id) : null;
    if (!s) {
      res.status(404).json({ error: 'AI interview not found.' });
      return null;
    }
    return { ...g, s };
  }

  app.post('/api/ai-interviews/:id/cancel', async (req, res) => {
    const c = await loadForStaff(req, res);
    if (!c) return;
    if (c.s.status !== 'invited' && c.s.status !== 'in_progress') {
      res.status(409).json({ error: `Cannot cancel an interview that is ${c.s.status}.` });
      return;
    }
    const u = await c.store.update(c.s.id, c.s.version, { status: 'cancelled' });
    if (!u) {
      res.status(409).json({ error: 'The interview changed. Please refresh.' });
      return;
    }
    res.json({ ok: true, session: staffView(u) });
  });

  app.post('/api/ai-interviews/:id/regenerate-link', async (req, res) => {
    const c = await loadForStaff(req, res);
    if (!c) return;
    const notStarted = !c.s.consent_at && (c.s.status === 'invited' || c.s.status === 'expired');
    if (!notStarted) {
      res.status(409).json({ error: 'A new link can only be issued before the candidate has started.' });
      return;
    }
    const { token, hash } = newToken();
    const expires_at = new Date(Date.now() + 72 * 3600_000).toISOString();
    const u = await c.store.update(c.s.id, c.s.version, { token_hash: hash, status: 'invited', expires_at });
    if (!u) {
      res.status(409).json({ error: 'The interview changed. Please refresh.' });
      return;
    }
    const link = linkFor(token);
    const sc = req.body?.sendEmail ? await c.store.getSubmissionContext(u.submission_id) : null;
    const mail = sc ? await emailInvite(c.store, u, sc, link) : { emailSent: false };
    res.json({ ok: true, session: staffView(u), link, ...mail });
  });

  app.post('/api/ai-interviews/:id/evaluate', async (req, res) => {
    const c = await loadForStaff(req, res);
    if (!c) return;
    if (c.s.status !== 'completed') {
      res.status(409).json({ error: 'Only a completed interview can be evaluated.' });
      return;
    }
    const sc = await c.store.getSubmissionContext(c.s.submission_id);
    if (!sc) {
      res.status(404).json({ error: 'Submission not found.' });
      return;
    }
    const u = await runEvaluation(c.store, c.s, sc);
    if (!u) {
      res.status(409).json({ error: 'The interview changed. Please refresh.' });
      return;
    }
    res.json({ ok: true, session: await enrich(c.store, u) });
  });

  // Live view for an observing recruiter/admin: refreshed by polling.
  app.get('/api/ai-interviews/:id/live', async (req, res) => {
    const c = await loadForStaff(req, res);
    if (!c) return;
    const [events, recs] = await Promise.all([c.store.listEvents(c.s.id, 200), c.store.listRecordings(c.s.id)]);
    const analysed = recs.filter((r) => r.status !== 'deleted' && r.video_path);
    const latest = analysed[analysed.length - 1];
    const last = c.s.turns[c.s.turns.length - 1];
    res.json({
      session: staffView(c.s),
      online: isOnline(c.s),
      lastSeenAt: c.s.last_seen_at,
      currentQuestion: c.s.status === 'in_progress' && last?.role === 'ai' ? { n: last.n, text: last.text, topic: last.topic ?? null } : null,
      recentTurns: c.s.turns.slice(-6),
      events: events.slice(-25),
      integrity: integritySummary(events),
      latestRecording: latest
        ? {
            questionNo: latest.question_no,
            videoUrl: latest.video_path ? await c.store.signedReadUrl(latest.video_path, 3600) : null,
            transcript: latest.transcript,
            voice: latest.analysis,
            durationSeconds: latest.duration_seconds,
          }
        : null,
    });
  });

  app.get('/api/ai-interviews/:id/recordings', async (req, res) => {
    const c = await loadForStaff(req, res);
    if (!c) return;
    const recs = (await c.store.listRecordings(c.s.id)).filter((r) => r.status !== 'deleted');
    res.json({
      recordings: await Promise.all(
        recs.map(async (r) => ({
          questionNo: r.question_no,
          status: r.status,
          durationSeconds: r.duration_seconds,
          transcript: r.transcript,
          voice: r.analysis,
          videoUrl: r.video_path ? await c.store.signedReadUrl(r.video_path, 3600) : null,
          audioUrl: r.audio_path ? await c.store.signedReadUrl(r.audio_path, 3600) : null,
        }))
      ),
    });
  });

  app.post('/api/ai-interviews/:id/recordings/delete', async (req, res) => {
    const c = await loadForStaff(req, res);
    if (!c) return;
    if (c.s.status === 'in_progress') {
      res.status(409).json({ error: 'Recordings cannot be deleted while the interview is in progress.' });
      return;
    }
    const n = await deleteRecordings(c.store, c.s);
    res.json({ ok: true, deleted: n });
  });

  app.post('/api/ai-interviews/:id/client-summary', async (req, res) => {
    const c = await loadForStaff(req, res);
    if (!c) return;
    const text = sanitizeAnswer(req.body?.text).slice(0, 1500);
    const u = await c.store.update(c.s.id, c.s.version, { client_summary: text || null });
    if (!u) {
      res.status(409).json({ error: 'The interview changed. Please refresh.' });
      return;
    }
    res.json({ ok: true, session: staffView(u) });
  });

  app.post('/api/ai-interviews/:id/share', async (req, res) => {
    const c = await loadForStaff(req, res);
    if (!c) return;
    const share = req.body?.share !== false;
    if (share && (c.s.status !== 'completed' || !c.s.evaluation)) {
      res.status(409).json({ error: 'Only a completed, evaluated interview can be shared with the client.' });
      return;
    }
    const u = await c.store.update(c.s.id, c.s.version, {
      shared_with_client_at: share ? new Date().toISOString() : null,
      shared_by: share ? c.auth.userId : null,
    });
    if (!u) {
      res.status(409).json({ error: 'The interview changed. Please refresh.' });
      return;
    }
    res.json({ ok: true, session: staffView(u) });
  });

  // Scheduled retention job (Vercel cron sends the CRON_SECRET as a bearer token).
  const purge = async (req: express.Request, res: express.Response) => {
    const secret = deps.cronSecret?.();
    if (!secret || req.get('authorization') !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const store = deps.getStore();
    if (!store) {
      res.status(503).json({ error: 'Service unavailable.' });
      return;
    }
    const due = await store.listExpiredRecordings(new Date().toISOString());
    let files = 0;
    for (const s of due) files += await deleteRecordings(store, s);
    res.json({ ok: true, sessions: due.length, files });
  };
  app.get('/api/ai-interviews/purge', purge);
  app.post('/api/ai-interviews/purge', purge);

  // ============================== candidate (token-based, no login) ==============================
  type Bucket = 'api' | 'ping' | 'events';
  const CAPS: Record<Bucket, { ip: number; tok: number }> = {
    api: { ip: 400, tok: 250 },
    ping: { ip: 3000, tok: 900 },
    events: { ip: 1500, tok: 600 },
  };

  async function resolveSession(req: express.Request, res: express.Response, kind: Bucket = 'api') {
    noStore(res);
    const token = req.params.token;
    const cap = CAPS[kind];
    if (rateLimited(`${kind}:ip:${clientIp(req)}`, cap.ip) || (isPlausibleToken(token) && rateLimited(`${kind}:tok:${token}`, cap.tok))) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return null;
    }
    const notFound = () => {
      res.status(404).json({ error: 'This interview link is not valid.' });
      return null;
    };
    if (!isPlausibleToken(token)) return notFound();
    const store = deps.getStore();
    if (!store) {
      res.status(503).json({ error: 'The interview service is temporarily unavailable.' });
      return null;
    }
    let s = await store.getByTokenHash(hashToken(token));
    if (!s) return notFound();
    if (isExpired(s)) s = (await store.update(s.id, s.version, { status: 'expired' })) || { ...s, status: 'expired' };
    return { store, s };
  }

  async function loadByToken(req: express.Request, res: express.Response) {
    const r = await resolveSession(req, res);
    if (!r) return null;
    const sc = await r.store.getSubmissionContext(r.s.submission_id);
    if (!sc) {
      res.status(404).json({ error: 'This interview link is not valid.' });
      return null;
    }
    return { ...r, sc };
  }

  const terminal = (s: SessionRow, res: express.Response): boolean => {
    if (s.status === 'cancelled') {
      res.status(410).json({ error: 'This interview was cancelled. Please contact your recruiter.', status: 'cancelled' });
      return true;
    }
    if (s.status === 'expired') {
      res.status(410).json({ error: 'This interview link has expired. Please ask your recruiter for a new one.', status: 'expired' });
      return true;
    }
    return false;
  };

  app.get('/api/ai-interview/:token', async (req, res) => {
    try {
      const c = await loadByToken(req, res);
      if (!c) return;
      if (terminal(c.s, res)) return;
      res.json(publicView(c.s, c.sc.ctx));
    } catch (e) {
      console.error('[ai-interview] load failed:', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  app.post('/api/ai-interview/:token/start', async (req, res) => {
    try {
      const c = await loadByToken(req, res);
      if (!c) return;
      if (terminal(c.s, res)) return;
      if (c.s.status !== 'invited') {
        res.json(publicView(c.s, c.sc.ctx));
        return;
      }
      if (req.body?.consent !== true) {
        res.status(400).json({ error: 'Please confirm your consent to start the interview.' });
        return;
      }
      const ctx = await withResume(c.sc);
      const q = await generateQuestion(ctx, [], 1, c.s.max_questions, c.s.mode);
      const now = new Date().toISOString();
      const turns: Turn[] = [{ n: 1, role: 'ai', text: q.question, at: now, topic: q.topic, source: q.source }];
      const u = await c.store.update(c.s.id, c.s.version, {
        status: 'in_progress',
        consent_at: now,
        consent_version: consentVersionFor(c.s.mode),
        started_at: now,
        last_seen_at: now,
        turns,
        question_source: questionSource(turns),
        model_name: q.source === 'ai' ? 'gemini-2.5-flash' : null,
        prompt_version: PROMPT_VERSION,
      });
      if (!u) {
        const fresh = await c.store.getById(c.s.id);
        res.json(publicView(fresh || c.s, c.sc.ctx));
        return;
      }
      res.json(publicView(u, c.sc.ctx));
    } catch (e) {
      console.error('[ai-interview] start failed:', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Could not start the interview. Please try again.' });
    }
  });

  // Short-lived signed upload URLs for the recording of ONE answer. Paths are fixed by the server.
  app.post('/api/ai-interview/:token/upload-urls', async (req, res) => {
    try {
      const r = await resolveSession(req, res);
      if (!r) return;
      const { s, store } = r;
      if (terminal(s, res)) return;
      const last = s.turns[s.turns.length - 1];
      const n = Number(req.body?.questionNumber);
      if (s.mode !== 'voice_video' || s.status !== 'in_progress' || !last || last.role !== 'ai' || last.n !== n) {
        res.status(409).json({ error: 'Recording is not expected for this question.' });
        return;
      }
      const key = `${s.id}:${n}`;
      const issued = (uploadIssued.get(key) || 0) + 1;
      uploadIssued.set(key, issued);
      if (issued > 8) {
        res.status(429).json({ error: 'Too many recording attempts for this question.' });
        return;
      }
      const ext = extFor(String(req.body?.videoMime || ''));
      const audioPath = `${s.id}/q${n}-audio.wav`;
      const videoPath = `${s.id}/q${n}-video.${ext}`;
      const [audio, video] = await Promise.all([store.createUploadUrl(audioPath), store.createUploadUrl(videoPath)]);
      if (!audio || !video) {
        res.status(503).json({ error: 'Recording storage is unavailable right now.' });
        return;
      }
      res.json({ bucket: RECORDINGS_BUCKET, audio, video });
    } catch (e) {
      console.error('[ai-interview] upload-urls failed:', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Could not prepare the recording upload.' });
    }
  });

  async function analyseRecording(
    store: SessionStore,
    s: SessionRow,
    question: Turn,
    rec: { audioPath: string; videoPath: string; videoMime: string; durationSeconds: number }
  ): Promise<{ ok: true; text: string; voice: NonNullable<Turn['voice']> } | { ok: false; code: 'no_speech' | 'transcription_failed'; status: number }> {
    await store.upsertRecording({
      session_id: s.id,
      question_no: question.n,
      audio_path: rec.audioPath,
      video_path: rec.videoPath,
      video_mime: rec.videoMime,
      duration_seconds: rec.durationSeconds,
      status: 'uploaded',
      error: null,
    });
    try {
      if (!deps.getAi()) throw new Error('ai_unavailable');
      const audio = await store.download(rec.audioPath);
      if (!audio || audio.length > MAX_AUDIO_BYTES) throw new Error('audio_unreadable');
      const p = buildVoicePrompt(question.text);
      const raw = await withTimeout(
        deps.analyzeAudio({ system: p.system, prompt: p.prompt, audio: { mime: 'audio/wav', base64: audio.toString('base64') }, schema: p.schema }),
        28000,
        'audio'
      );
      const { transcript, metrics } = parseVoiceAnalysis(raw, rec.durationSeconds);
      if (!metrics.audible) {
        await store.upsertRecording({ session_id: s.id, question_no: question.n, status: 'failed', error: 'no_speech', analysis: metrics });
        return { ok: false, code: 'no_speech', status: 422 };
      }
      await store.upsertRecording({ session_id: s.id, question_no: question.n, status: 'analyzed', transcript, analysis: metrics, error: null });
      return { ok: true, text: transcript, voice: metrics };
    } catch (e) {
      console.warn('[ai-interview] audio analysis failed:', e instanceof Error ? e.message : e);
      await store.upsertRecording({ session_id: s.id, question_no: question.n, status: 'failed', error: 'transcription_failed' }).catch(() => null);
      return { ok: false, code: 'transcription_failed', status: 502 };
    }
  }

  app.post('/api/ai-interview/:token/answer', async (req, res) => {
    try {
      const c = await loadByToken(req, res);
      if (!c) return;
      if (terminal(c.s, res)) return;
      const { s, sc, store } = c;
      if (s.status !== 'in_progress') {
        res.status(409).json({ error: 'This interview is not in progress.', ...publicView(s, sc.ctx) });
        return;
      }
      const b = (req.body || {}) as Record<string, any>;
      const last = s.turns[s.turns.length - 1];
      if (!last || last.role !== 'ai' || last.n !== Number(b.questionNumber)) {
        res.status(409).json({ error: 'That question has already been answered.', ...publicView(s, sc.ctx) });
        return;
      }

      const voiceMode = s.mode === 'voice_video';
      const seconds = Math.max(0, Math.min(86400, Math.round(Number(b.seconds)) || 0));
      let answerTurn: Turn;

      if (voiceMode && b.recording) {
        const videoMime = baseMime(String(b.recording.videoMime || ''));
        const expectAudio = `${s.id}/q${last.n}-audio.wav`;
        const expectVideo = `${s.id}/q${last.n}-video.${extFor(videoMime)}`;
        if (b.recording.audioPath !== expectAudio || b.recording.videoPath !== expectVideo) {
          res.status(400).json({ error: 'Invalid recording reference.', code: 'recording_missing' });
          return;
        }
        const [a, v] = await Promise.all([store.statObject(expectAudio), store.statObject(expectVideo)]);
        if (!a || !v || a.size < MIN_AUDIO_BYTES || v.size < MIN_VIDEO_BYTES) {
          res.status(400).json({ error: 'Your camera and microphone recording was not received. Please record this answer again.', code: 'recording_missing' });
          return;
        }
        const duration = Math.max(1, Math.min(s.max_answer_seconds + 15, Number(b.recording.durationSeconds) || seconds || 1));
        const out = await analyseRecording(store, s, last, { audioPath: expectAudio, videoPath: expectVideo, videoMime, durationSeconds: duration });
        if (!out.ok) {
          res.status(out.status).json({
            code: out.code,
            error:
              out.code === 'no_speech'
                ? "We couldn't hear your answer. Please check your microphone and record it again."
                : "We couldn't process your recording right now. You can try again or type your answer instead.",
          });
          return;
        }
        answerTurn = { n: last.n, role: 'candidate', text: out.text, at: new Date().toISOString(), seconds: Math.round(duration), media: true, voice: out.voice };
      } else if (voiceMode) {
        // Typed fallback is only allowed after a recording problem, and is visible to the recruiter as unrecorded.
        const reason = String(b.fallbackReason || '');
        const text = sanitizeAnswer(b.fallbackText);
        if (!['transcription_failed', 'no_speech', 'device_error'].includes(reason) || !text) {
          res.status(400).json({ error: 'A recording is required for this interview.', code: 'recording_required' });
          return;
        }
        if (text.length > MAX_ANSWER_CHARS) {
          res.status(400).json({ error: `Please keep your answer under ${MAX_ANSWER_CHARS} characters.` });
          return;
        }
        answerTurn = { n: last.n, role: 'candidate', text, at: new Date().toISOString(), seconds, pasted: b.pasted === true };
      } else {
        const text = sanitizeAnswer(b.answer);
        if (!text) {
          res.status(400).json({ error: 'Please write an answer before sending.' });
          return;
        }
        if (text.length > MAX_ANSWER_CHARS) {
          res.status(400).json({ error: `Please keep your answer under ${MAX_ANSWER_CHARS} characters.` });
          return;
        }
        answerTurn = { n: last.n, role: 'candidate', text, at: new Date().toISOString(), seconds, pasted: b.pasted === true };
      }

      const turns: Turn[] = [...s.turns, answerTurn];

      if (last.n >= s.max_questions) {
        const done = await complete(store, s, sc, turns);
        if (!done) {
          res.status(409).json({ error: 'This answer was already received.' });
          return;
        }
        res.json(publicView(done, sc.ctx));
        return;
      }

      const ctx = await withResume(sc);
      const q = await generateQuestion(ctx, turns, last.n + 1, s.max_questions, s.mode);
      if (q.signal) answerTurn.signal = q.signal;
      turns.push({ n: last.n + 1, role: 'ai', text: q.question, at: new Date().toISOString(), topic: q.topic, source: q.source });
      const u = await store.update(s.id, s.version, { turns, question_source: questionSource(turns), last_seen_at: new Date().toISOString() });
      if (!u) {
        res.status(409).json({ error: 'This answer was already received.' });
        return;
      }
      res.json(publicView(u, sc.ctx));
    } catch (e) {
      console.error('[ai-interview] answer failed:', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Could not save your answer. Please try again.' });
    }
  });

  app.post('/api/ai-interview/:token/finish', async (req, res) => {
    try {
      const c = await loadByToken(req, res);
      if (!c) return;
      if (terminal(c.s, res)) return;
      const { s, sc, store } = c;
      if (s.status === 'completed') {
        res.json(publicView(s, sc.ctx));
        return;
      }
      if (s.status !== 'in_progress') {
        res.status(409).json({ error: 'This interview has not started.' });
        return;
      }
      const turns = s.turns.filter((t, i) => !(i === s.turns.length - 1 && t.role === 'ai'));
      const done = await complete(store, s, sc, turns);
      if (!done) {
        const fresh = await store.getById(s.id);
        res.json(publicView(fresh || s, sc.ctx));
        return;
      }
      res.json(publicView(done, sc.ctx));
    } catch (e) {
      console.error('[ai-interview] finish failed:', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Could not finish the interview. Please try again.' });
    }
  });

  // Called by the candidate page right after a voice interview completes so the evaluation is ready
  // by the time a recruiter opens it. Staff views also trigger it, so nothing depends on this call.
  app.post('/api/ai-interview/:token/finalize', async (req, res) => {
    try {
      const c = await loadByToken(req, res);
      if (!c) return;
      const s = await ensureEvaluated(c.store, c.s);
      res.json(publicView(s, c.sc.ctx));
    } catch (e) {
      console.error('[ai-interview] finalize failed:', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // Light-weight endpoints: no submission lookups, separate (higher) rate limits.
  app.post('/api/ai-interview/:token/ping', async (req, res) => {
    try {
      const r = await resolveSession(req, res, 'ping');
      if (!r) return;
      if (r.s.status === 'in_progress') await r.store.touch(r.s.id);
      res.json({ ok: true, status: r.s.status });
    } catch {
      res.status(500).json({ ok: false });
    }
  });

  app.post('/api/ai-interview/:token/events', async (req, res) => {
    try {
      const r = await resolveSession(req, res, 'events');
      if (!r) return;
      if (r.s.status !== 'in_progress') {
        res.json({ ok: true, stored: 0 });
        return;
      }
      const raw = Array.isArray(req.body?.events) ? (req.body.events as Array<Record<string, unknown>>).slice(0, 20) : [];
      const events: EventInput[] = raw
        .filter((e) => typeof e?.type === 'string' && EVENT_TYPES.has(e.type))
        .map((e) => ({
          type: String(e.type),
          duration_ms: Number.isFinite(Number(e.durationMs)) ? Math.max(0, Math.min(86_400_000, Math.round(Number(e.durationMs)))) : null,
          question_no: Number.isFinite(Number(e.questionNo)) ? Math.max(1, Math.min(15, Math.round(Number(e.questionNo)))) : null,
          detail: typeof e.detail === 'string' ? e.detail.slice(0, 120) : null,
        }));
      if (events.length && (await r.store.countEvents(r.s.id)) < 600) await r.store.addEvents(r.s.id, events);
      await r.store.touch(r.s.id);
      res.json({ ok: true, stored: events.length });
    } catch {
      res.status(500).json({ ok: false });
    }
  });

}
