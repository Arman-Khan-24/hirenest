import type express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoogleGenAI } from '@google/genai';
import {
  CONSENT_VERSION,
  MAX_ANSWER_CHARS,
  PROMPT_VERSION,
  answeredCount,
  buildEvalPrompt,
  buildQuestionPrompt,
  canEvaluate,
  clampQuestions,
  fallbackQuestion,
  firstName,
  hashToken,
  isPlausibleToken,
  newToken,
  parseEvaluation,
  parseQuestion,
  sanitizeAnswer,
  withTimeout,
  type AnswerSignal,
  type Evaluation,
  type InterviewContext,
  type Recommendation,
  type Turn,
} from './aiInterviewCore';

export type SessionStatus = 'invited' | 'in_progress' | 'completed' | 'expired' | 'cancelled';

export interface SessionRow {
  id: string;
  token_hash: string;
  submission_id: string;
  interview_id: string | null;
  status: SessionStatus;
  max_questions: number;
  expires_at: string;
  consent_at: string | null;
  consent_version: string | null;
  started_at: string | null;
  completed_at: string | null;
  turns: Turn[];
  evaluation: Evaluation | null;
  skill_rating: number | null;
  communication_rating: number | null;
  overall_rating: number | null;
  recommendation: Recommendation | null;
  question_source: 'ai' | 'template' | 'mixed';
  model_name: string | null;
  prompt_version: string | null;
  error: string | null;
  version: number;
  invite_email_sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionContext {
  ctx: InterviewContext;
  candidateEmail: string | null;
  stage: string;
}

export interface SessionStore {
  create(row: {
    token_hash: string;
    submission_id: string;
    max_questions: number;
    expires_at: string;
    created_by: string;
  }): Promise<SessionRow>;
  getById(id: string): Promise<SessionRow | null>;
  getByTokenHash(hash: string): Promise<SessionRow | null>;
  listBySubmission(submissionId: string): Promise<SessionRow[]>;
  /** Optimistic update: returns null when `expectedVersion` no longer matches (concurrent change). */
  update(id: string, expectedVersion: number, patch: Partial<SessionRow>): Promise<SessionRow | null>;
  getSubmissionContext(submissionId: string): Promise<SubmissionContext | null>;
  notify(userId: string, n: { title: string; body: string; link: string }): Promise<void>;
}

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
  sendEmail: (to: string[], subject: string, html: string) => Promise<{ ok: boolean; error?: string }>;
  appBaseUrl: () => string;
}

// ------------------------------------------------------------ supabase store
export function createSupabaseStore(admin: SupabaseClient): SessionStore {
  const asRow = (d: unknown): SessionRow | null => (d ? (d as SessionRow) : null);
  return {
    async create(row) {
      const { data, error } = await admin.from('ai_interview_sessions').insert(row).select('*').single();
      if (error) throw new Error(error.message);
      return data as SessionRow;
    },
    async getById(id) {
      const { data } = await admin.from('ai_interview_sessions').select('*').eq('id', id).maybeSingle();
      return asRow(data);
    },
    async getByTokenHash(hash) {
      const { data } = await admin.from('ai_interview_sessions').select('*').eq('token_hash', hash).maybeSingle();
      return asRow(data);
    },
    async listBySubmission(submissionId) {
      const { data } = await admin
        .from('ai_interview_sessions')
        .select('*')
        .eq('submission_id', submissionId)
        .order('created_at', { ascending: false });
      return (data || []) as SessionRow[];
    },
    async update(id, expectedVersion, patch) {
      const { data, error } = await admin
        .from('ai_interview_sessions')
        .update({ ...patch, version: expectedVersion + 1, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('version', expectedVersion)
        .select('*')
        .maybeSingle();
      if (error) throw new Error(error.message);
      return asRow(data);
    },
    async getSubmissionContext(submissionId) {
      const { data: sub } = await admin
        .from('submissions')
        .select('id, stage, requirement_id, candidate_id')
        .eq('id', submissionId)
        .maybeSingle();
      if (!sub) return null;
      const [{ data: req }, { data: cand }, { data: contact }] = await Promise.all([
        admin
          .from('requirements')
          .select('title, description, skills, min_experience, max_experience, location, work_mode, employment_type')
          .eq('id', sub.requirement_id)
          .maybeSingle(),
        admin
          .from('candidates')
          .select('full_name, current_title, total_experience_years, skills')
          .eq('id', sub.candidate_id)
          .maybeSingle(),
        admin.from('candidate_contacts').select('email').eq('candidate_id', sub.candidate_id).maybeSingle(),
      ]);
      if (!req || !cand) return null;
      return {
        stage: String(sub.stage),
        candidateEmail: (contact?.email as string | null) ?? null,
        ctx: {
          roleTitle: String(req.title || 'the role'),
          roleDescription: String(req.description || ''),
          mustHaveSkills: (req.skills as string[] | null) ?? [],
          minExp: (req.min_experience as number | null) ?? null,
          maxExp: (req.max_experience as number | null) ?? null,
          workMode: (req.work_mode as string | null) ?? null,
          employmentType: (req.employment_type as string | null) ?? null,
          location: (req.location as string | null) ?? null,
          candidateFirstName: firstName(cand.full_name as string),
          candidateTitle: (cand.current_title as string | null) ?? null,
          candidateExpYears: (cand.total_experience_years as number | null) ?? null,
          candidateSkills: (cand.skills as string[] | null) ?? [],
        },
      };
    },
    async notify(userId, n) {
      await admin.from('notifications').insert({ user_id: userId, kind: 'ai_interview', title: n.title, body: n.body, link: n.link });
    },
  };
}

// ----------------------------------------------------------------- helpers
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(key: string, max: number, windowMs = 60 * 60 * 1000): boolean {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
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

/** Strips everything a candidate must never see (scores, token hash, staff metadata). */
function publicView(s: SessionRow, ctx: InterviewContext) {
  const last = s.turns[s.turns.length - 1];
  const current = s.status === 'in_progress' && last?.role === 'ai' ? { number: last.n, text: last.text } : null;
  return {
    status: s.status,
    roleTitle: ctx.roleTitle,
    candidateFirstName: ctx.candidateFirstName,
    maxQuestions: s.max_questions,
    answered: answeredCount(s.turns),
    transcript: s.turns.map((t) => ({ n: t.n, role: t.role, text: t.text })),
    current,
    expiresAt: s.expires_at,
    consentVersion: CONSENT_VERSION,
  };
}

function staffView(s: SessionRow) {
  const { token_hash: _omit, ...rest } = s;
  void _omit;
  return { ...rest, answered: answeredCount(s.turns) };
}

// ------------------------------------------------------------------ routes
export function registerAiInterviewRoutes(app: express.Express, deps: AiInterviewDeps): void {
  const noStore = (res: express.Response) => res.setHeader('Cache-Control', 'no-store');

  async function generateQuestion(ctx: InterviewContext, turns: Turn[], n: number, total: number) {
    const ai = deps.getAi();
    if (ai) {
      try {
        const p = buildQuestionPrompt(ctx, turns, n, total);
        const raw = await withTimeout(deps.generate(ai, 'gemini-2.5-flash', p.contents, p.system, p.schema), 20000, 'question');
        const prior = turns.filter((t) => t.role === 'ai').map((t) => t.text);
        const q = parseQuestion(raw, prior);
        return { ...q, source: 'ai' as const };
      } catch (e) {
        console.warn('[ai-interview] question generation failed, using template:', e instanceof Error ? e.message : e);
      }
    }
    return { ...fallbackQuestion(ctx, n, total), signal: undefined as AnswerSignal | undefined, source: 'template' as const };
  }

  async function evaluate(
    ctx: InterviewContext,
    turns: Turn[]
  ): Promise<{ patch: Partial<SessionRow> }> {
    if (!canEvaluate(turns)) return { patch: { evaluation: null, error: 'insufficient_input' } };
    const ai = deps.getAi();
    if (!ai) return { patch: { evaluation: null, error: 'ai_unavailable' } };
    try {
      const p = buildEvalPrompt(ctx, turns);
      const raw = await withTimeout(deps.generate(ai, 'gemini-2.5-flash', p.contents, p.system, p.schema), 35000, 'evaluation');
      const ev = parseEvaluation(raw);
      return {
        patch: {
          evaluation: ev,
          skill_rating: ev.skill_rating,
          communication_rating: ev.communication_rating,
          overall_rating: ev.overall_rating,
          recommendation: ev.recommendation,
          model_name: 'gemini-2.5-flash',
          prompt_version: PROMPT_VERSION,
          error: null,
        },
      };
    } catch (e) {
      console.warn('[ai-interview] evaluation failed:', e instanceof Error ? e.message : e);
      return { patch: { evaluation: null, error: 'evaluation_failed' } };
    }
  }

  async function complete(
    store: SessionStore,
    s: SessionRow,
    ctx: InterviewContext,
    turns: Turn[]
  ): Promise<SessionRow | null> {
    const { patch } = await evaluate(ctx, turns);
    const updated = await store.update(s.id, s.version, {
      ...patch,
      turns,
      status: 'completed',
      completed_at: new Date().toISOString(),
      question_source: questionSource(turns),
    });
    if (updated && s.created_by) {
      const who = ctx.candidateFirstName;
      const rec = updated.recommendation ? ` Recommendation: ${updated.recommendation}.` : ' Review the transcript.';
      await store
        .notify(s.created_by, {
          title: 'AI interview completed',
          body: `${who} finished the AI interview for ${ctx.roleTitle}.${rec}`,
          link: `/admin/submissions/${s.submission_id}`,
        })
        .catch(() => undefined);
    }
    return updated;
  }

  // ============================== staff (authenticated, HQ only) ==============================
  async function guardStaff(req: express.Request, res: express.Response) {
    noStore(res);
    const auth = await deps.authenticate(req, { strict: true });
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.message });
      return null;
    }
    if (auth.role !== 'admin' && auth.role !== 'recruiter') {
      res.status(403).json({ error: 'Internal staff access required.' });
      return null;
    }
    const store = deps.getStore();
    if (!store) {
      res.status(503).json({ error: 'Service unavailable.' });
      return null;
    }
    return { auth, store };
  }

  const linkFor = (token: string) => `${deps.appBaseUrl().replace(/\/$/, '')}/ai-interview/${token}`;

  async function emailInvite(
    store: SessionStore,
    s: SessionRow,
    sc: SubmissionContext,
    link: string
  ): Promise<{ emailSent: boolean; emailError?: string }> {
    if (!sc.candidateEmail) return { emailSent: false, emailError: 'No email address on file for this candidate.' };
    const mins = Math.round(s.max_questions * 2.5);
    const expires = new Date(s.expires_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const html = `<p>Hi ${esc(sc.ctx.candidateFirstName)},</p>
<p>You have been invited to a short written interview for <strong>${esc(sc.ctx.roleTitle)}</strong> with HireNest. It takes about ${mins} minutes and you can answer at your own pace on any device.</p>
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
      const b = (req.body || {}) as { submissionId?: unknown; maxQuestions?: unknown; expiresInHours?: unknown; sendEmail?: unknown };
      const submissionId = String(b.submissionId || '');
      if (!/^[0-9a-f-]{36}$/i.test(submissionId)) {
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
        const rotated = await g.store.update(existing.id, existing.version, { token_hash: hash, expires_at });
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

  app.get('/api/ai-interviews', async (req, res) => {
    const g = await guardStaff(req, res);
    if (!g) return;
    const submissionId = String(req.query.submissionId || '');
    if (!/^[0-9a-f-]{36}$/i.test(submissionId)) {
      res.status(400).json({ error: 'submissionId is required.' });
      return;
    }
    const rows = await g.store.listBySubmission(submissionId);
    for (const s of rows) {
      if (isExpired(s)) {
        const u = await g.store.update(s.id, s.version, { status: 'expired' });
        if (u) Object.assign(s, u);
      }
    }
    res.json({ sessions: rows.map(staffView) });
  });

  async function loadForStaff(req: express.Request, res: express.Response) {
    const g = await guardStaff(req, res);
    if (!g) return null;
    const id = String(req.params.id || '');
    const s = /^[0-9a-f-]{36}$/i.test(id) ? await g.store.getById(id) : null;
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
    const { patch } = await evaluate(sc.ctx, c.s.turns);
    const u = await c.store.update(c.s.id, c.s.version, patch);
    if (!u) {
      res.status(409).json({ error: 'The interview changed. Please refresh.' });
      return;
    }
    res.json({ ok: true, session: staffView(u) });
  });

  // ============================== candidate (token-based, no login) ==============================
  async function loadByToken(req: express.Request, res: express.Response) {
    noStore(res);
    const token = req.params.token;
    if (rateLimited(`ip:${clientIp(req)}`, 400) || (isPlausibleToken(token) && rateLimited(`tok:${token}`, 250))) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return null;
    }
    const invalid = () => {
      res.status(404).json({ error: 'This interview link is not valid.' });
      return null;
    };
    if (!isPlausibleToken(token)) return invalid();
    const store = deps.getStore();
    if (!store) {
      res.status(503).json({ error: 'The interview service is temporarily unavailable.' });
      return null;
    }
    let s = await store.getByTokenHash(hashToken(token));
    if (!s) return invalid();
    if (isExpired(s)) {
      s = (await store.update(s.id, s.version, { status: 'expired' })) || { ...s, status: 'expired' };
    }
    const sc = await store.getSubmissionContext(s.submission_id);
    if (!sc) return invalid();
    return { store, s, sc };
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
      const q = await generateQuestion(c.sc.ctx, [], 1, c.s.max_questions);
      const now = new Date().toISOString();
      const turns: Turn[] = [{ n: 1, role: 'ai', text: q.question, at: now, topic: q.topic, source: q.source }];
      const u = await c.store.update(c.s.id, c.s.version, {
        status: 'in_progress',
        consent_at: now,
        consent_version: CONSENT_VERSION,
        started_at: now,
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
      const b = (req.body || {}) as { answer?: unknown; questionNumber?: unknown; seconds?: unknown; pasted?: unknown };
      const last = s.turns[s.turns.length - 1];
      if (!last || last.role !== 'ai' || last.n !== Number(b.questionNumber)) {
        res.status(409).json({ error: 'That question has already been answered.', ...publicView(s, sc.ctx) });
        return;
      }
      const text = sanitizeAnswer(b.answer);
      if (!text) {
        res.status(400).json({ error: 'Please write an answer before sending.' });
        return;
      }
      if (text.length > MAX_ANSWER_CHARS) {
        res.status(400).json({ error: `Please keep your answer under ${MAX_ANSWER_CHARS} characters.` });
        return;
      }
      const seconds = Math.max(0, Math.min(86400, Math.round(Number(b.seconds)) || 0));
      const answerTurn: Turn = {
        n: last.n,
        role: 'candidate',
        text,
        at: new Date().toISOString(),
        seconds,
        pasted: b.pasted === true,
      };
      const turns: Turn[] = [...s.turns, answerTurn];

      if (last.n >= s.max_questions) {
        const done = await complete(store, s, sc.ctx, turns);
        if (!done) {
          res.status(409).json({ error: 'This answer was already received.' });
          return;
        }
        res.json(publicView(done, sc.ctx));
        return;
      }

      const q = await generateQuestion(sc.ctx, turns, last.n + 1, s.max_questions);
      if (q.signal) answerTurn.signal = q.signal;
      turns.push({ n: last.n + 1, role: 'ai', text: q.question, at: new Date().toISOString(), topic: q.topic, source: q.source });
      const u = await store.update(s.id, s.version, { turns, question_source: questionSource(turns) });
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
      const done = await complete(store, s, sc.ctx, turns);
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
}
