import type { SupabaseClient } from '@supabase/supabase-js';
import { firstName, type Evaluation, type InterviewContext, type InterviewMode, type Recommendation, type Turn, type VoiceMetrics } from './aiInterviewCore';

export const RECORDINGS_BUCKET = 'ai-interview-recordings';

export type SessionStatus = 'invited' | 'in_progress' | 'completed' | 'expired' | 'cancelled';

export interface SessionRow {
  id: string;
  token_hash: string;
  submission_id: string;
  interview_id: string | null;
  status: SessionStatus;
  mode: InterviewMode;
  max_questions: number;
  max_answer_seconds: number;
  expires_at: string;
  consent_at: string | null;
  consent_version: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_seen_at: string | null;
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
  client_summary: string | null;
  shared_with_client_at: string | null;
  shared_by: string | null;
  recordings_expire_at: string | null;
  show_candidate_report: boolean;
  candidate_report_emailed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordingRow {
  id: string;
  session_id: string;
  question_no: number;
  video_path: string | null;
  audio_path: string | null;
  video_mime: string | null;
  video_bytes: number | null;
  audio_bytes: number | null;
  duration_seconds: number | null;
  status: 'uploaded' | 'analyzed' | 'failed' | 'deleted';
  transcript: string | null;
  analysis: VoiceMetrics | null;
  error: string | null;
  created_at: string;
}

export interface EventInput {
  type: string;
  at?: string;
  duration_ms?: number | null;
  question_no?: number | null;
  detail?: string | null;
}
export interface EventRow extends EventInput {
  id?: number;
  session_id: string;
  at: string;
}

export interface SubmissionContext {
  ctx: InterviewContext;
  candidateEmail: string | null;
  stage: string;
  resumePath: string | null;
  clientOrgId: string | null;
  vendorOrgId: string | null;
  sharedWithClientAt: string | null;
}

/** Light description of a submission, for list screens and access checks. */
export interface SubmissionBrief {
  id: string;
  stage: string;
  candidateName: string;
  roleTitle: string;
  clientOrgId: string | null;
  clientName: string | null;
  vendorOrgId: string | null;
  vendorName: string | null;
  sharedWithClientAt: string | null;
}

export interface NewSession {
  token_hash: string;
  submission_id: string;
  max_questions: number;
  expires_at: string;
  created_by: string;
  mode: InterviewMode;
  max_answer_seconds: number;
  show_candidate_report?: boolean;
}

export interface SessionStore {
  create(row: NewSession): Promise<SessionRow>;
  getById(id: string): Promise<SessionRow | null>;
  getByTokenHash(hash: string): Promise<SessionRow | null>;
  listBySubmission(submissionId: string): Promise<SessionRow[]>;
  /** Optimistic update: returns null when `expectedVersion` no longer matches (concurrent change). */
  update(id: string, expectedVersion: number, patch: Partial<SessionRow>): Promise<SessionRow | null>;
  /** Heartbeat. Deliberately does not touch `version`, so it never conflicts with answer updates. */
  touch(id: string): Promise<void>;
  getSubmissionContext(submissionId: string): Promise<SubmissionContext | null>;
  notify(userId: string, n: { title: string; body: string; link: string }): Promise<void>;
  getProfileName(userId: string): Promise<string | null>;

  upsertRecording(row: Partial<RecordingRow> & { session_id: string; question_no: number }): Promise<RecordingRow>;
  listRecordings(sessionId: string): Promise<RecordingRow[]>;

  addEvents(sessionId: string, events: EventInput[]): Promise<void>;
  listEvents(sessionId: string, limit?: number): Promise<EventRow[]>;
  countEvents(sessionId: string): Promise<number>;

  createUploadUrl(path: string): Promise<{ path: string; token: string } | null>;
  statObject(path: string): Promise<{ size: number } | null>;
  download(path: string): Promise<Buffer | null>;
  signedReadUrl(path: string, seconds: number): Promise<string | null>;
  removeObjects(paths: string[]): Promise<void>;

  listForSubmissions(submissionIds: string[]): Promise<SessionRow[]>;
  listRecent(limit: number): Promise<SessionRow[]>;
  submissionBriefs(submissionIds: string[]): Promise<SubmissionBrief[]>;

  /** Completed sessions whose recordings are past retention. */
  listExpiredRecordings(nowIso: string): Promise<SessionRow[]>;
}

export function createSupabaseStore(admin: SupabaseClient): SessionStore {
  const asRow = <T,>(d: unknown): T | null => (d ? (d as T) : null);
  const split = (path: string) => {
    const i = path.lastIndexOf('/');
    return { dir: path.slice(0, i), name: path.slice(i + 1) };
  };
  return {
    async create(row) {
      const { data, error } = await admin.from('ai_interview_sessions').insert(row).select('*').single();
      if (error) throw new Error(error.message);
      return data as SessionRow;
    },
    async getById(id) {
      const { data } = await admin.from('ai_interview_sessions').select('*').eq('id', id).maybeSingle();
      return asRow<SessionRow>(data);
    },
    async getByTokenHash(hash) {
      const { data } = await admin.from('ai_interview_sessions').select('*').eq('token_hash', hash).maybeSingle();
      return asRow<SessionRow>(data);
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
      return asRow<SessionRow>(data);
    },
    async touch(id) {
      await admin.from('ai_interview_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', id);
    },
    async getSubmissionContext(submissionId) {
      const { data: sub } = await admin
        .from('submissions')
        .select('id, stage, requirement_id, candidate_id, shared_with_client_at, vendor_org_id')
        .eq('id', submissionId)
        .maybeSingle();
      if (!sub) return null;
      const [{ data: req }, { data: cand }, { data: contact }] = await Promise.all([
        admin
          .from('requirements')
          .select('title, description, skills, min_experience, max_experience, location, work_mode, employment_type, client_org_id')
          .eq('id', sub.requirement_id)
          .maybeSingle(),
        admin
          .from('candidates')
          .select('full_name, current_title, total_experience_years, skills, resume_path')
          .eq('id', sub.candidate_id)
          .maybeSingle(),
        admin.from('candidate_contacts').select('email').eq('candidate_id', sub.candidate_id).maybeSingle(),
      ]);
      if (!req || !cand) return null;
      return {
        stage: String(sub.stage),
        candidateEmail: (contact?.email as string | null) ?? null,
        resumePath: (cand.resume_path as string | null) ?? null,
        clientOrgId: (req.client_org_id as string | null) ?? null,
        sharedWithClientAt: (sub.shared_with_client_at as string | null) ?? null,
        vendorOrgId: (sub.vendor_org_id as string | null) ?? null,
        ctx: {
          roleTitle: String(req.title || 'the role'),
          roleDescription: String(req.description || ''),
          mustHaveSkills: (req.skills as string[] | null) ?? [],
          minExp: (req.min_experience as number | null) ?? null,
          maxExp: (req.max_experience as number | null) ?? null,
          workMode: (req.work_mode as string | null) ?? null,
          employmentType: (req.employment_type as string | null) ?? null,
          location: (req.location as string | null) ?? null,
          candidateFullName: String(cand.full_name || 'Candidate'),
          candidateFirstName: firstName(cand.full_name as string),
          candidateTitle: (cand.current_title as string | null) ?? null,
          candidateExpYears: (cand.total_experience_years as number | null) ?? null,
          candidateSkills: (cand.skills as string[] | null) ?? [],
          resumeExcerpt: null,
        },
      };
    },
    async notify(userId, n) {
      await admin.from('notifications').insert({ user_id: userId, kind: 'ai_interview', title: n.title, body: n.body, link: n.link });
    },
    async getProfileName(userId) {
      const { data } = await admin.from('profiles').select('full_name').eq('id', userId).maybeSingle();
      return (data?.full_name as string | null) ?? null;
    },

    async upsertRecording(row) {
      const { data, error } = await admin
        .from('ai_interview_recordings')
        .upsert(row, { onConflict: 'session_id,question_no' })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as RecordingRow;
    },
    async listRecordings(sessionId) {
      const { data } = await admin
        .from('ai_interview_recordings')
        .select('*')
        .eq('session_id', sessionId)
        .order('question_no', { ascending: true });
      return (data || []) as RecordingRow[];
    },

    async addEvents(sessionId, events) {
      if (!events.length) return;
      const rows = events.map((e) => ({
        session_id: sessionId,
        type: e.type,
        at: e.at || new Date().toISOString(),
        duration_ms: e.duration_ms ?? null,
        question_no: e.question_no ?? null,
        detail: e.detail ?? null,
      }));
      const { error } = await admin.from('ai_interview_events').insert(rows);
      if (error) throw new Error(error.message);
    },
    async listEvents(sessionId, limit = 500) {
      const { data } = await admin
        .from('ai_interview_events')
        .select('id, session_id, at, type, duration_ms, question_no, detail')
        .eq('session_id', sessionId)
        .order('at', { ascending: false })
        .limit(limit);
      return ((data || []) as EventRow[]).reverse();
    },
    async countEvents(sessionId) {
      const { count } = await admin
        .from('ai_interview_events')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId);
      return count || 0;
    },

    async createUploadUrl(path) {
      const { data, error } = await admin.storage.from(RECORDINGS_BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error || !data) return null;
      return { path: data.path, token: data.token };
    },
    async statObject(path) {
      const { dir, name } = split(path);
      const { data } = await admin.storage.from(RECORDINGS_BUCKET).list(dir, { search: name, limit: 5 });
      const item = (data || []).find((d) => d.name === name);
      const size = Number((item?.metadata as { size?: number } | undefined)?.size);
      return item && Number.isFinite(size) ? { size } : null;
    },
    async download(path) {
      const { data, error } = await admin.storage.from(RECORDINGS_BUCKET).download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
    async signedReadUrl(path, seconds) {
      const { data } = await admin.storage.from(RECORDINGS_BUCKET).createSignedUrl(path, seconds);
      return data?.signedUrl ?? null;
    },
    async removeObjects(paths) {
      if (!paths.length) return;
      await admin.storage.from(RECORDINGS_BUCKET).remove(paths);
    },

    async listForSubmissions(submissionIds) {
      if (!submissionIds.length) return [];
      const { data } = await admin
        .from('ai_interview_sessions')
        .select('*')
        .in('submission_id', submissionIds)
        .order('created_at', { ascending: false });
      return (data || []) as SessionRow[];
    },
    async listRecent(limit) {
      const { data } = await admin
        .from('ai_interview_sessions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      return (data || []) as SessionRow[];
    },
    async submissionBriefs(submissionIds) {
      if (!submissionIds.length) return [];
      const { data } = await admin
        .from('submissions')
        .select('id, stage, shared_with_client_at, vendor_org_id, candidates(full_name), requirements(title, client_org_id, organizations(name)), organizations(name)')
        .in('id', submissionIds);
      type Row = {
        id: string;
        stage: string;
        shared_with_client_at: string | null;
        vendor_org_id: string | null;
        candidates: { full_name: string } | null;
        requirements: { title: string; client_org_id: string | null; organizations: { name: string } | null } | null;
        organizations: { name: string } | null;
      };
      return ((data || []) as unknown as Row[]).map((r) => ({
        id: r.id,
        stage: String(r.stage),
        candidateName: r.candidates?.full_name || 'Candidate',
        roleTitle: r.requirements?.title || 'Requirement',
        clientOrgId: r.requirements?.client_org_id ?? null,
        clientName: r.requirements?.organizations?.name ?? null,
        vendorOrgId: r.vendor_org_id ?? null,
        vendorName: r.organizations?.name ?? null,
        sharedWithClientAt: r.shared_with_client_at ?? null,
      }));
    },

    async listExpiredRecordings(nowIso) {
      const { data } = await admin
        .from('ai_interview_sessions')
        .select('*')
        .not('recordings_expire_at', 'is', null)
        .lt('recordings_expire_at', nowIso)
        .limit(50);
      return (data || []) as SessionRow[];
    },
  };
}
