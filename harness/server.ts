import express from 'express';
import { registerAiInterviewRoutes } from '../aiInterviewRoutes';
import { memoryStore, mkSc, SUB_ID } from '../scripts/ai-interview-test-kit';
import { newToken } from '../aiInterviewCore';

const m = memoryStore(mkSc({ sharedWithClientAt: '2026-11-16T09:00:00Z' }));
const app = express();

// CORS for the browser-side Supabase storage client (it talks to this server in the harness).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Fake Supabase signed-upload endpoint: PUT multipart, file part has an empty field name.
app.put('/storage/v1/object/upload/sign/:bucket/*', express.raw({ type: () => true, limit: '60mb' }), (req, res) => {
  const path = (req.params as Record<string, string>)[0];
  const body = req.body as Buffer;
  const ct = String(req.headers['content-type'] || '');
  const b = /boundary=(.+)$/.exec(ct)?.[1];
  let file = body;
  if (b) {
    const parts = body.toString('latin1').split(`--${b}`);
    const part = parts.find((p) => /filename=/.test(p) && !/cacheControl/.test(p.split('\r\n\r\n')[0]));
    if (part) {
      const headEnd = part.indexOf('\r\n\r\n') + 4;
      const raw = part.slice(headEnd, part.lastIndexOf('\r\n'));
      file = Buffer.from(raw, 'latin1');
    }
  }
  m.objects.set(path, file);
  console.log(`UPLOAD ${path} ${file.length} bytes`);
  res.json({ Key: `${req.params.bucket}/${path}` });
});

app.use(express.json());

const QUESTIONS = [
  'Which data pipeline are you proudest of, and what exactly did you own in building it?',
  'You mentioned Databricks. How did you handle schema changes and late-arriving data in that pipeline?',
  'A nightly Spark join suddenly takes four times longer. How would you diagnose and fix it?',
  'How would you control cost on a growing Azure data platform?',
  'What are you looking for in your next role, and what is your notice period?',
];
const TRANSCRIPTS = [
  'I led the migration of our batch ETL to Databricks on Azure, owning ingestion and the silver layer with PySpark and Delta merges at about two terabytes a day.',
  'Late data is handled with watermarks and idempotent merges on business keys, and schema changes go through Delta schema evolution with contract tests.',
  'I would open the Spark UI, find the skewed tasks, salt the hot key and broadcast the small side, which took one job from three hours to forty minutes.',
];
let qi = 0;
let ti = 0;

registerAiInterviewRoutes(app, {
  authenticate: async () => ({ ok: true, userId: 'staff-1', role: (process.env.H_ROLE || 'admin') as string, orgId: null }),
  getStore: () => m.store,
  getAi: () => ({}) as never,
  generate: async (_a, _m, _c, _s, schema) => {
    await new Promise((r) => setTimeout(r, 600));
    if (JSON.stringify(schema).includes('skill_evidence')) {
      return JSON.stringify({
        summary: 'Priya gave specific, hands-on answers on Databricks, Delta merges and Spark skew, with measurable outcomes. Azure cost depth was thinner.',
        skill_rating: 4, communication_rating: 3, overall_rating: 4, recommendation: 'advance',
        skill_evidence: [{ skill: 'Databricks', level: 'proven', evidence: 'Described Delta MERGE CDC at two terabytes a day.' }, { skill: 'Apache Spark', level: 'proven', evidence: 'Salting and broadcast cut a job from 3h to 40m.' }, { skill: 'Azure', level: 'partial', evidence: 'Mentioned cost controls without detail.' }],
        strengths: ['Quantified results', 'Clear structure'], gaps: ['Azure cost governance'], follow_ups: ['Probe ADF failure recovery'], concerns: ['Resume lists Python 6 years; no Python example given'],
        client_feedback: { headline: 'Strong hands-on data engineer', summary: 'Priya demonstrated hands-on Databricks and Spark delivery with measurable outcomes and communicated clearly. Azure cost governance is worth probing in the next round.', strengths: ['Quantified delivery results', 'Clear, structured communication'], areas_to_probe: ['Azure cost governance'] },
      });
    }
    return JSON.stringify({ question: QUESTIONS[qi++ % QUESTIONS.length], topic: 'Data pipelines', previous_answer_quality: 'strong' });
  },
  analyzeAudio: async ({ audio }) => {
    const b = Buffer.from(audio.base64, 'base64');
    const riff = b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE';
    const rate = riff ? b.readUInt32LE(24) : 0;
    const ch = riff ? b.readUInt16LE(22) : 0;
    const bits = riff ? b.readUInt16LE(34) : 0;
    const samples = riff ? (b.length - 44) / 2 : 0;
    let sum = 0;
    for (let i = 44; i + 1 < b.length; i += 2) { const v = b.readInt16LE(i) / 32768; sum += v * v; }
    const rms = samples ? Math.sqrt(sum / samples) : 0;
    console.log(`ANALYZE riff=${riff} rate=${rate} ch=${ch} bits=${bits} seconds=${(samples / (rate || 1)).toFixed(1)} rms=${rms.toFixed(3)}`);
    const audible = riff && rms > 0.005;
    return JSON.stringify({ transcript: audible ? TRANSCRIPTS[ti++ % TRANSCRIPTS.length] : '', audible, clarity: 4, fluency: 4, structure: 4, vocabulary_grammar: 4, professional_tone: 5, filler_words: 1, notes: 'Clear and well organised.' });
  },
  getResumeText: async () => 'Priya Sharma. Led Databricks migration at Contoso. Built Delta pipelines.',
  sendEmail: async (to, subject, html) => { console.log('EMAIL to=' + to.join(',') + ' subject=' + subject + ' hasCTA=' + /Create your account/.test(html)); return { ok: true }; },
  appBaseUrl: () => 'http://localhost:5199',
  cronSecret: () => undefined,
});

(async () => {
  await new Promise<void>((r) => app.listen(4010, () => r()));
  console.log('harness api on 4010');
  const { token, hash } = newToken();
  await m.store.create({ token_hash: hash, submission_id: SUB_ID, max_questions: 3, expires_at: new Date(Date.now() + 72 * 3600e3).toISOString(), created_by: 'staff-1', mode: 'voice_video', max_answer_seconds: 60 });
  console.log('VOICE_TOKEN=' + token);
})();
