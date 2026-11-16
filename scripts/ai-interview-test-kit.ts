/**
 * Shared test doubles for the AI interview backend: an in-memory SessionStore with fake object
 * storage. Used by scripts/verify-ai-interview.ts. Never touches the real database or storage.
 */
import type { EventInput, EventRow, RecordingRow, SessionRow, SessionStore, SubmissionContext } from '../aiInterviewStore';
import type { InterviewContext } from '../aiInterviewCore';

export const SUB_ID = '11111111-1111-4111-8111-111111111111';
export const CLIENT_ORG = '33333333-3333-4333-8333-333333333333';
export const baseCtx: InterviewContext = {
  roleTitle: 'Senior Data Engineer',
  roleDescription: 'Build and operate batch and streaming data pipelines on Azure and Databricks. Own data quality, performance tuning and cost.',
  mustHaveSkills: ['Python', 'SQL', 'Databricks', 'Apache Spark', 'Azure'],
  minExp: 5, maxExp: 9, workMode: 'hybrid', employmentType: 'full_time', location: 'Hyderabad',
  candidateFullName: 'Priya Sharma', candidateFirstName: 'Priya', candidateTitle: 'Data Engineer', candidateExpYears: 6,
  candidateSkills: ['Python', 'SQL', 'Spark'], resumeExcerpt: null,
};
export const mkSc = (over: Partial<SubmissionContext> = {}): SubmissionContext => ({
  ctx: baseCtx, candidateEmail: 'priya@example.com', stage: 'recruiter_review',
  resumePath: null, clientOrgId: CLIENT_ORG, sharedWithClientAt: null, ...over,
});

export function memoryStore(sc: SubmissionContext | null = mkSc()) {
  const rows = new Map<string, SessionRow>();
  const recs = new Map<string, RecordingRow>();
  const events: EventRow[] = [];
  const objects = new Map<string, Buffer>();
  const notes: Array<{ userId: string; title: string }> = [];
  let seq = 0;
  const store: SessionStore = {
    async create(r) {
      const now = new Date().toISOString();
      const row: SessionRow = {
        id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, token_hash: r.token_hash, submission_id: r.submission_id,
        interview_id: null, status: 'invited', mode: r.mode, max_questions: r.max_questions, max_answer_seconds: r.max_answer_seconds,
        expires_at: r.expires_at, consent_at: null, consent_version: null, started_at: null, completed_at: null, last_seen_at: null,
        turns: [], evaluation: null, skill_rating: null, communication_rating: null, overall_rating: null, recommendation: null,
        question_source: 'ai', model_name: null, prompt_version: null, error: null, version: 0, invite_email_sent_at: null,
        client_summary: null, shared_with_client_at: null, shared_by: null, recordings_expire_at: null,
        created_by: r.created_by, created_at: now, updated_at: now,
      };
      rows.set(row.id, row);
      return structuredClone(row);
    },
    async getById(id) { const r = rows.get(id); return r ? structuredClone(r) : null; },
    async getByTokenHash(h) { const r = [...rows.values()].find((x) => x.token_hash === h); return r ? structuredClone(r) : null; },
    async listBySubmission(id) { return [...rows.values()].filter((r) => r.submission_id === id).map((r) => structuredClone(r)); },
    async update(id, expected, patch) {
      const r = rows.get(id);
      if (!r || r.version !== expected) return null;
      Object.assign(r, patch, { version: expected + 1, updated_at: new Date().toISOString() });
      return structuredClone(r);
    },
    async touch(id) { const r = rows.get(id); if (r) r.last_seen_at = new Date().toISOString(); },
    async getSubmissionContext(id) { return id === SUB_ID ? structuredClone(sc) : null; },
    async notify(userId, n) { notes.push({ userId, title: n.title }); },
    async getProfileName(id) { return id === 'staff-1' ? 'Asha Recruiter' : null; },
    async upsertRecording(row) {
      const key = `${row.session_id}:${row.question_no}`;
      const cur = recs.get(key) || ({ id: `rec-${key}`, session_id: row.session_id, question_no: row.question_no, video_path: null, audio_path: null, video_mime: null, video_bytes: null, audio_bytes: null, duration_seconds: null, status: 'uploaded', transcript: null, analysis: null, error: null, created_at: new Date().toISOString() } as RecordingRow);
      const next = { ...cur, ...row } as RecordingRow;
      recs.set(key, next);
      return structuredClone(next);
    },
    async listRecordings(sid) { return [...recs.values()].filter((r) => r.session_id === sid).sort((a, b) => a.question_no - b.question_no).map((r) => structuredClone(r)); },
    async addEvents(sid, evs: EventInput[]) { for (const e of evs) events.push({ ...e, session_id: sid, at: e.at || new Date().toISOString() }); },
    async listEvents(sid, limit = 500) { return events.filter((e) => e.session_id === sid).slice(-limit); },
    async countEvents(sid) { return events.filter((e) => e.session_id === sid).length; },
    async createUploadUrl(path) { return { path, token: `tok-${path}` }; },
    async statObject(path) { const b = objects.get(path); return b ? { size: b.length } : null; },
    async download(path) { return objects.get(path) ?? null; },
    async signedReadUrl(path) { return objects.has(path) ? `https://signed.test/${path}?exp=1` : null; },
    async removeObjects(paths) { for (const p of paths) objects.delete(p); },
    async listExpiredRecordings(nowIso) { return [...rows.values()].filter((r) => r.recordings_expire_at && r.recordings_expire_at < nowIso).map((r) => structuredClone(r)); },
  };
  const upload = (sessionId: string, n: number, speech: string, ext = 'webm') => {
    // The fake "audio" carries its own transcript so the stub analyser can "hear" it.
    objects.set(`${sessionId}/q${n}-audio.wav`, Buffer.concat([Buffer.from(`SPEECH:${speech}`), Buffer.alloc(5000)]));
    objects.set(`${sessionId}/q${n}-video.${ext}`, Buffer.alloc(20000));
  };
  return { store, rows, recs, events, objects, notes, upload };
}

