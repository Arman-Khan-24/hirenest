import { supabase } from '../lib/supabase';

export type AiInterviewStatus = 'invited' | 'in_progress' | 'completed' | 'expired' | 'cancelled';
export type AiRecommendation = 'advance' | 'hold' | 'reject';

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
}

export interface AiInterviewSession {
  id: string;
  submission_id: string;
  status: AiInterviewStatus;
  max_questions: number;
  answered: number;
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
  created_at: string;
}

export interface CreateAiInterviewResult {
  ok: boolean;
  session: AiInterviewSession;
  link: string;
  emailSent: boolean;
  emailError?: string;
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

export const aiInterviewApi = {
  list: (submissionId: string) =>
    staffApi<{ sessions: AiInterviewSession[] }>(`/api/ai-interviews?submissionId=${encodeURIComponent(submissionId)}`).then(
      (r) => r.sessions
    ),
  create: (p: { submissionId: string; maxQuestions: number; expiresInHours: number; sendEmail: boolean }) =>
    staffApi<CreateAiInterviewResult>('/api/ai-interviews', { method: 'POST', body: JSON.stringify(p) }),
  cancel: (id: string) => staffApi<{ ok: boolean }>(`/api/ai-interviews/${id}/cancel`, { method: 'POST', body: '{}' }),
  regenerateLink: (id: string, sendEmail: boolean) =>
    staffApi<CreateAiInterviewResult>(`/api/ai-interviews/${id}/regenerate-link`, {
      method: 'POST',
      body: JSON.stringify({ sendEmail }),
    }),
  evaluate: (id: string) => staffApi<{ ok: boolean }>(`/api/ai-interviews/${id}/evaluate`, { method: 'POST', body: '{}' }),
};

// ------------------------------------------------------------ candidate side
export interface PublicInterviewView {
  status: AiInterviewStatus;
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
    public view?: PublicInterviewView
  ) {
    super(message);
  }
}

async function publicApi(path: string, method: 'GET' | 'POST', body?: unknown): Promise<PublicInterviewView> {
  const res = await fetch(`/api/ai-interview/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hasView = json && typeof json === 'object' && 'transcript' in json;
    throw new PublicInterviewError(json.error || `Request failed (${res.status})`, res.status, hasView ? (json as PublicInterviewView) : undefined);
  }
  return json as PublicInterviewView;
}

export const publicInterviewApi = {
  load: (token: string) => publicApi(encodeURIComponent(token), 'GET'),
  start: (token: string) => publicApi(`${encodeURIComponent(token)}/start`, 'POST', { consent: true }),
  answer: (token: string, p: { answer: string; questionNumber: number; seconds: number; pasted: boolean }) =>
    publicApi(`${encodeURIComponent(token)}/answer`, 'POST', p),
  finish: (token: string) => publicApi(`${encodeURIComponent(token)}/finish`, 'POST', {}),
};
