import { supabase } from '../lib/supabase';

export type AiInterviewStatus = 'invited' | 'in_progress' | 'completed' | 'expired' | 'cancelled';
export type AiInterviewMode = 'text' | 'voice_video';
export type AiRecommendation = 'advance' | 'hold' | 'reject';
export type IntegrityLevel = 'clear' | 'review' | 'flagged';

export interface VoiceMetrics {
  audible: boolean;
  clarity: number;
  fluency: number;
  structure: number;
  vocabulary: number;
  tone: number;
  fillers: number;
  words: number;
  wpm: number | null;
  notes: string;
}

export interface VoiceSummary {
  overall: number;
  clarity: number;
  fluency: number;
  structure: number;
  vocabulary: number;
  tone: number;
  avgWpm: number | null;
  totalFillers: number;
  answersAnalysed: number;
  answersTotal: number;
}

export interface IntegritySummary {
  level: IntegrityLevel;
  awayCount: number;
  awaySeconds: number;
  pastes: number;
  deviceDrops: number;
  reloads: number;
  reasons: string[];
}

export interface AiInterviewTurn {
  n: number;
  role: 'ai' | 'candidate';
  text: string;
  at: string;
  topic?: string;
  source?: 'ai' | 'template';
  signal?: 'strong' | 'adequate' | 'shallow' | 'off_topic';
  seconds?: number;
  pasted?: boolean;
  media?: boolean;
  voice?: VoiceMetrics;
}

export interface AiInterviewEvaluation {
  summary: string;
  skill_rating: number;
  communication_rating: number;
  overall_rating: number;
  recommendation: AiRecommendation;
  skill_evidence: Array<{ skill: string; level: 'proven' | 'partial' | 'unproven'; evidence: string }>;
  strengths: string[];
  gaps: string[];
  follow_ups: string[];
  concerns: string[];
  client_feedback?: { headline: string; summary: string; strengths: string[]; areas_to_probe: string[] };
  voice_communication?: VoiceSummary | null;
  integrity?: IntegritySummary | null;
}

export interface AiInterviewSession {
  id: string;
  submission_id: string;
  status: AiInterviewStatus;
  mode: AiInterviewMode;
  max_questions: number;
  max_answer_seconds: number;
  answered: number;
  online: boolean;
  last_seen_at: string | null;
  expires_at: string;
  consent_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  turns: AiInterviewTurn[];
  evaluation: AiInterviewEvaluation | null;
  skill_rating: number | null;
  communication_rating: number | null;
  overall_rating: number | null;
  recommendation: AiRecommendation | null;
  question_source: 'ai' | 'template' | 'mixed';
  error: string | null;
  invite_email_sent_at: string | null;
  client_summary: string | null;
  shared_with_client_at: string | null;
  recordings_expire_at: string | null;
  show_candidate_report?: boolean;
  created_at: string;
  // voice + video sessions only
  integrity?: IntegritySummary;
  voice?: VoiceSummary | null;
  recordings?: number;
  recordingsDeleted?: boolean;
}

export interface CreateAiInterviewResult {
  ok: boolean;
  session: AiInterviewSession;
  link: string;
  emailSent: boolean;
  emailError?: string;
}

export interface AiRecording {
  questionNo: number;
  status: 'uploaded' | 'analyzed' | 'failed';
  durationSeconds: number | null;
  transcript: string | null;
  voice: VoiceMetrics | null;
  videoUrl: string | null;
  audioUrl: string | null;
}

export interface AiLiveSnapshot {
  session: AiInterviewSession;
  online: boolean;
  lastSeenAt: string | null;
  currentQuestion: { n: number; text: string; topic: string | null } | null;
  recentTurns: AiInterviewTurn[];
  events: Array<{ type: string; at: string; duration_ms: number | null; question_no: number | null }>;
  integrity: IntegritySummary;
  latestRecording: { questionNo: number; videoUrl: string | null; transcript: string | null; voice: VoiceMetrics | null; durationSeconds: number | null } | null;
}

export interface AiSummary {
  sessionId: string;
  status: AiInterviewStatus;
  mode: AiInterviewMode;
  answered: number;
  maxQuestions: number;
  overall: number | null;
  skill: number | null;
  communication: number | null;
  recommendation: AiRecommendation | null;
  shared: boolean;
  completedAt: string | null;
  evaluated: boolean;
  integrity?: string | null;
}

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

export interface RecentAiInterview extends AiSummary {
  submissionId: string;
  createdAt: string;
  brief: SubmissionBrief | null;
}

export interface Scorecard {
  sessionId: string;
  candidateName: string;
  roleTitle: string;
  completedAt: string | null;
  mode: AiInterviewMode;
  ratings: { skill: number | null; communication: number | null; overall: number | null };
  recommendation: AiRecommendation | null;
  headline: string;
  summary: string;
  strengths: string[];
  areasToProbe: string[];
  skillEvidence: Array<{ skill: string; level: 'proven' | 'partial' | 'unproven'; evidence: string }>;
  voice: Pick<VoiceSummary, 'overall' | 'clarity' | 'fluency' | 'structure' | 'vocabulary' | 'tone' | 'avgWpm' | 'answersAnalysed'> | null;
  questionsAsked: number;
  questionsAnswered: number;
  reviewedBy: string | null;
  sharedAt: string | null;
}

async function staffApi<T>(url: string, opts?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const token = data?.session?.access_token;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

const post = (url: string, body: unknown = {}) => staffApi<{ ok: boolean; session: AiInterviewSession }>(url, { method: 'POST', body: JSON.stringify(body) });

export const aiInterviewApi = {
  list: (submissionId: string) =>
    staffApi<{ sessions: AiInterviewSession[] }>(`/api/ai-interviews?submissionId=${encodeURIComponent(submissionId)}`).then((r) => r.sessions),
  create: (p: { submissionId: string; mode: AiInterviewMode; maxQuestions: number; maxAnswerSeconds: number; expiresInHours: number; sendEmail: boolean; showCandidateReport: boolean }) =>
    staffApi<CreateAiInterviewResult>('/api/ai-interviews', { method: 'POST', body: JSON.stringify(p) }),
  cancel: (id: string) => post(`/api/ai-interviews/${id}/cancel`),
  regenerateLink: (id: string, sendEmail: boolean) =>
    staffApi<CreateAiInterviewResult>(`/api/ai-interviews/${id}/regenerate-link`, { method: 'POST', body: JSON.stringify({ sendEmail }) }),
  evaluate: (id: string) => post(`/api/ai-interviews/${id}/evaluate`),
  live: (id: string) => staffApi<AiLiveSnapshot>(`/api/ai-interviews/${id}/live`),
  recordings: (id: string) => staffApi<{ recordings: AiRecording[] }>(`/api/ai-interviews/${id}/recordings`).then((r) => r.recordings),
  deleteRecordings: (id: string) => staffApi<{ ok: boolean; deleted: number }>(`/api/ai-interviews/${id}/recordings/delete`, { method: 'POST', body: '{}' }),
  setClientSummary: (id: string, text: string) => post(`/api/ai-interviews/${id}/client-summary`, { text }),
  share: (id: string, share: boolean) => post(`/api/ai-interviews/${id}/share`, { share }),
  summaries: (submissionIds: string[]) =>
    staffApi<{ summaries: Record<string, AiSummary> }>(`/api/ai-interviews/summaries?ids=${submissionIds.map(encodeURIComponent).join(',')}`).then((r) => r.summaries),
  recent: () => staffApi<{ interviews: RecentAiInterview[] }>('/api/ai-interviews/recent').then((r) => r.interviews),
  scorecards: (submissionId: string) =>
    staffApi<{ scorecards: Scorecard[] }>(`/api/ai-interviews/scorecard?submissionId=${encodeURIComponent(submissionId)}`).then((r) => r.scorecards),
};

// ------------------------------------------------------------ candidate side
export interface CandidateReport {
  roleTitle: string;
  spoken: boolean;
  ratings: { skill: number | null; communication: number | null; overall: number | null };
  summary: string;
  strengths: string[];
  improvements: string[];
  voice: { clarity: number; fluency: number; structure: number; vocabulary: number; tone: number; avgWpm: number | null } | null;
}

export interface PublicInterviewView {
  report?: CandidateReport | null;
  reportPending?: boolean;
  reportAvailable?: boolean;
  emailHint?: string | null;
  signupUrl?: string;
  status: AiInterviewStatus;
  mode: AiInterviewMode;
  maxAnswerSeconds: number;
  roleTitle: string;
  candidateFirstName: string;
  maxQuestions: number;
  answered: number;
  transcript: Array<{ n: number; role: 'ai' | 'candidate'; text: string }>;
  current: { number: number; text: string } | null;
  expiresAt: string;
  consentVersion: string;
}

export class PublicInterviewError extends Error {
  constructor(
    message: string,
    public status: number,
    public view?: PublicInterviewView,
    public code?: string
  ) {
    super(message);
  }
}

async function publicApi<T = PublicInterviewView>(path: string, method: 'GET' | 'POST', body?: unknown, keepalive = false): Promise<T> {
  const res = await fetch(`/api/ai-interview/${path}`, {
    method,
    keepalive,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hasView = json && typeof json === 'object' && 'transcript' in json;
    throw new PublicInterviewError(json.error || `Request failed (${res.status})`, res.status, hasView ? (json as PublicInterviewView) : undefined, json.code);
  }
  return json as T;
}

export interface UploadTarget {
  path: string;
  token: string;
}
export interface UploadUrls {
  bucket: string;
  audio: UploadTarget;
  video: UploadTarget;
}
export interface RecordingRef {
  audioPath: string;
  videoPath: string;
  videoMime: string;
  durationSeconds: number;
}
export interface MonitorEvent {
  type: string;
  durationMs?: number;
  questionNo?: number;
  detail?: string;
}

export const publicInterviewApi = {
  load: (token: string) => publicApi(encodeURIComponent(token), 'GET'),
  start: (token: string) => publicApi(`${encodeURIComponent(token)}/start`, 'POST', { consent: true }),
  answer: (token: string, p: { answer: string; questionNumber: number; seconds: number; pasted: boolean }) =>
    publicApi(`${encodeURIComponent(token)}/answer`, 'POST', p),
  answerRecorded: (token: string, p: { questionNumber: number; seconds: number; recording: RecordingRef }) =>
    publicApi(`${encodeURIComponent(token)}/answer`, 'POST', p),
  answerFallback: (token: string, p: { questionNumber: number; seconds: number; fallbackText: string; fallbackReason: string }) =>
    publicApi(`${encodeURIComponent(token)}/answer`, 'POST', p),
  finish: (token: string) => publicApi(`${encodeURIComponent(token)}/finish`, 'POST', {}),
  finalize: (token: string) => publicApi(`${encodeURIComponent(token)}/finalize`, 'POST', {}),
  emailReport: (token: string, email?: string) =>
    publicApi<{ ok: boolean; to?: string; error?: string }>(`${encodeURIComponent(token)}/email-report`, 'POST', email ? { email } : {}),
  uploadUrls: (token: string, p: { questionNumber: number; videoMime: string }) =>
    publicApi<UploadUrls>(`${encodeURIComponent(token)}/upload-urls`, 'POST', p),
  ping: (token: string) => publicApi<{ ok: boolean }>(`${encodeURIComponent(token)}/ping`, 'POST', {}, true).catch(() => undefined),
  events: (token: string, events: MonitorEvent[]) =>
    publicApi<{ ok: boolean }>(`${encodeURIComponent(token)}/events`, 'POST', { events }, true),
};

/** Uploads a recording to the one-time signed URL the server issued. */
export async function uploadRecording(bucket: string, target: UploadTarget, blob: Blob, contentType: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(target.path, target.token, blob, { contentType, upsert: true });
  if (error) throw new Error(error.message || 'Upload failed');
}
