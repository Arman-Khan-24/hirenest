import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { HeroSection } from './HeroSection';
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Check,
  Loader2,
  Menu,
  X,
  Building2,
  Handshake,
  UserSearch,
  Database,
  Lock,
  History,
} from 'lucide-react';
import {
  submitEarlyAccessApplication,
  MODULE_LABELS,
  BUSINESS_TYPE_LABELS,
  COMPANY_SIZE_LABELS,
  type EarlyAccessSubmitPayload,
  type HirenestModule,
  type BusinessType,
  type CompanySize,
} from '../../api/earlyAccess';

// Pull from the app's own semantic tokens (src/index.css) rather than raw hex,
// so the marketing site and the product stay one visual system and a token
// change here propagates everywhere else too.
const INK = 'var(--text-primary)'; // logo navy #14213D
const INK_SOFT = 'var(--text-secondary)'; // body #605D52 — 6:1 on cream
const INK_FAINT = 'var(--text-tertiary)'; // #716E64 — 4.5:1 on cream (AA minimum for caption text)
const LINE = 'var(--border)'; // warm hairline
const LINE_SOFT = 'var(--track)'; // softer warm hairline
const PAPER = 'var(--bg-subtle)'; // canvas-soft #F8F4F0
const BRAND = 'var(--primary-bg)'; // blue #1D5FD1 (fills only; use --accent for text)
const NAVY = '#14213D'; // logo navy — a fixed dark band, not theme-coupled, by design (DESIGN.md hero-band-dark)
const ACCENT = '#1D5FD1'; // logo royal blue

type Role = 'hq' | 'client' | 'vendor' | 'candidate';

const ROLE_GROUPS: {
  role: Role;
  label: string;
  who: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  points: string[];
  footerLabel: string;
  footerValue: string;
}[] = [
  {
    role: 'hq',
    label: 'HireNest HQ',
    who: 'Admins & recruiters',
    icon: ShieldCheck,
    points: [
      'Deterministic skill-experience-domain match scoring on every candidate',
      'Vendor scorecards, SLA tiers and performance-based share allocation',
      'Assignment overrides, dispute resolution and platform configuration',
    ],
    footerLabel: 'Oversees',
    footerValue: 'All 4 roles',
  },
  {
    role: 'client',
    label: 'Hiring clients',
    who: 'Companies with open roles',
    icon: Building2,
    points: [
      'Author requirements once; HQ routes them to the right vendors',
      'Review HQ-forwarded candidates against a shared scoring rubric',
      'Schedule interviews and return structured feedback inside a 24-hour SLA',
    ],
    footerLabel: 'Requirement ownership',
    footerValue: 'One thread, start to close',
  },
  {
    role: 'vendor',
    label: 'Staffing vendors',
    who: 'Agencies & recruiters',
    icon: Handshake,
    points: [
      'See only the requirements assigned to you, not a blind blast list',
      'Candidate pool with SHA-256 resume de-duplication across your team',
      'A transparent 5-axis scorecard instead of a black-box ranking',
    ],
    footerLabel: 'Visibility',
    footerValue: 'Assigned requirements only',
  },
  {
    role: 'candidate',
    label: 'Candidates',
    who: 'People applying for work',
    icon: UserSearch,
    points: [
      'A "Jobs for me" shortlist, matched to your profile, not a keyword search',
      'One resume, reused across every submission a vendor makes on your behalf',
      'Real-time status instead of silence after you apply',
    ],
    footerLabel: 'Profile control',
    footerValue: 'Edit skills & resume anytime',
  },
];

const PIPELINE = [
  { n: '01', category: 'Intake', title: 'Requirement', sla: 'Logged once', detail: 'Client or HQ opens a requirement; it is scored and routed to eligible vendors automatically.', footerLabel: 'Trigger', footerValue: 'SLA clock starts on creation', accent: '#1D5FD1' },
  { n: '02', category: 'Routing', title: 'Shortlist', sla: '48h SLA', detail: 'Vendors submit matched candidates; HQ forwards the ranked, deduplicated shortlist to the client.', footerLabel: 'Result', footerValue: 'Ranked by match score', accent: '#1A56C2' },
  { n: '03', category: 'Review', title: 'Interview', sla: '24h feedback', detail: 'Client runs the loop against a shared rubric and returns structured feedback on the clock.', footerLabel: 'Enforcement', footerValue: 'Structured feedback, no email loop', accent: '#14213D' },
  { n: '04', category: 'Close', title: 'Offer', sla: 'Audited', detail: 'Offer, onboarding and vendor share are recorded against the same requirement thread.', footerLabel: 'Record', footerValue: 'Logged to the audit trail', accent: '#1F6B45' },
];

const COMPLIANCE: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    title: 'DPDP Act 2023',
    description: 'Candidate consent and data-principal rights built into onboarding and profile handling.',
    icon: ShieldCheck,
  },
  {
    title: 'Row level security',
    description: 'Database-level policies enforce who can read or write each row, not just the API layer.',
    icon: Database,
  },
  {
    title: 'Tenant isolation',
    description: 'Each client and vendor organization only ever sees the requirements routed to it.',
    icon: Lock,
  },
  {
    title: 'Audit logging',
    description: 'Every assignment, submission and stage change is recorded against the requirement thread.',
    icon: History,
  },
];

/** Fades and lifts a block into place the first time it scrolls into view. */
function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function EarlyAccessForm() {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [appId, setAppId] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState<EarlyAccessSubmitPayload>({
    contactName: '',
    designation: '',
    businessEmail: '',
    phone: '',
    companyName: '',
    companyWebsite: '',
    businessType: 'staffing_agency',
    country: 'India',
    companySize: '11-50',
    recruitmentTeamSize: '',
    businessRequirements: '',
    interestedModules: [],
    currentChallenges: '',
    linkedinUrl: '',
    comments: '',
    privacyConsent: false,
  });

  const toggleModule = (m: HirenestModule) => {
    setForm((prev) => ({
      ...prev,
      interestedModules: prev.interestedModules.includes(m)
        ? prev.interestedModules.filter((x) => x !== m)
        : [...prev.interestedModules, m],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.privacyConsent) {
      setError('Please accept the privacy notice to continue.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitEarlyAccessApplication(form);
      setAppId(res.applicationId);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-12 space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full flex items-center justify-center" style={{ background: '#E7F4EC' }}>
          <CheckCircle2 className="h-6 w-6" style={{ color: '#17734A' }} />
        </div>
        <h3 className="text-[20px] font-semibold" style={{ color: INK }}>Application submitted</h3>
        <p className="text-[14px] max-w-md mx-auto" style={{ color: INK_SOFT }}>
          Your application ID is{' '}
          <span className="font-mono font-semibold" style={{ color: INK }}>{appId}</span>. Our team will
          review your application and reach out within 48 hours.
        </p>
        <p className="text-[13px]" style={{ color: INK_FAINT }}>
          You will receive an invitation to register and set up your HireNestOS workspace once approved.
        </p>
      </div>
    );
  }

  const inputCls =
    'w-full h-10 px-3 rounded-[6px] border bg-[var(--zp-canvas)] text-[14px] outline-none transition-colors focus:ring-[3px] focus:ring-[var(--focus-ring)] focus:border-[var(--focus-border)]';
  const inputStyle = { borderColor: LINE, color: INK } as React.CSSProperties;
  const labelCls = 'block text-[12px] font-medium mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-[6px] border px-3 py-2 text-[13px]" style={{ background: '#FBEAE8', borderColor: '#F3C5C1', color: '#B8322B' }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>
            Contact name <span style={{ color: '#B8322B' }}>*</span>
          </label>
          <input
            type="text"
            required
            value={form.contactName}
            onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
            placeholder="Full name"
            className={inputCls}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Designation</label>
          <input
            type="text"
            value={form.designation}
            onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
            placeholder="e.g. Head of Talent"
            className={inputCls}
            style={inputStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>
            Business email <span style={{ color: '#B8322B' }}>*</span>
          </label>
          <input
            type="email"
            required
            value={form.businessEmail}
            onChange={(e) => setForm((f) => ({ ...f, businessEmail: e.target.value }))}
            placeholder="name@company.com"
            className={inputCls}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Phone</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="+91 98765 43210"
            className={inputCls}
            style={inputStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>
            Company name <span style={{ color: '#B8322B' }}>*</span>
          </label>
          <input
            type="text"
            required
            value={form.companyName}
            onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
            placeholder="Company name"
            className={inputCls}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Company website</label>
          <input
            type="url"
            value={form.companyWebsite}
            onChange={(e) => setForm((f) => ({ ...f, companyWebsite: e.target.value }))}
            placeholder="https://company.com"
            className={inputCls}
            style={inputStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Business type</label>
          <select
            value={form.businessType}
            onChange={(e) => setForm((f) => ({ ...f, businessType: e.target.value as BusinessType }))}
            className={inputCls}
            style={inputStyle}
          >
            {Object.entries(BUSINESS_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Country</label>
          <input
            type="text"
            value={form.country}
            onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
            placeholder="India"
            className={inputCls}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Company size</label>
          <select
            value={form.companySize}
            onChange={(e) => setForm((f) => ({ ...f, companySize: e.target.value as CompanySize }))}
            className={inputCls}
            style={inputStyle}
          >
            {Object.entries(COMPANY_SIZE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>Recruitment team size</label>
          <input
            type="text"
            value={form.recruitmentTeamSize}
            onChange={(e) => setForm((f) => ({ ...f, recruitmentTeamSize: e.target.value }))}
            placeholder="e.g. 5-10 recruiters"
            className={inputCls}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={labelCls} style={{ color: INK_SOFT }}>LinkedIn / company profile</label>
          <input
            type="url"
            value={form.linkedinUrl}
            onChange={(e) => setForm((f) => ({ ...f, linkedinUrl: e.target.value }))}
            placeholder="https://linkedin.com/company/..."
            className={inputCls}
            style={inputStyle}
          />
        </div>
      </div>

      <div>
        <label className={labelCls} style={{ color: INK_SOFT }}>Business requirements</label>
        <textarea
          rows={2}
          value={form.businessRequirements}
          onChange={(e) => setForm((f) => ({ ...f, businessRequirements: e.target.value }))}
          placeholder="What are your primary hiring or staffing needs?"
          className={`${inputCls} h-auto py-2`}
          style={inputStyle}
        />
      </div>

      <div>
        <label className={labelCls} style={{ color: INK_SOFT }}>Interested HireNestOS modules</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {(Object.entries(MODULE_LABELS) as [HirenestModule, string][]).map(([key, label]) => {
            const active = form.interestedModules.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleModule(key)}
                className="px-3 py-2 rounded-full text-[12px] font-medium border transition-colors leading-none hover:border-[var(--zp-ink)]"
                style={active ? { background: NAVY, color: '#FFFEFB', borderColor: NAVY } : { background: 'var(--zp-canvas)', color: INK_SOFT, borderColor: LINE }}
              >
                {active && <Check className="inline h-3 w-3 mr-1" />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className={labelCls} style={{ color: INK_SOFT }}>Current recruitment challenges</label>
        <textarea
          rows={2}
          value={form.currentChallenges}
          onChange={(e) => setForm((f) => ({ ...f, currentChallenges: e.target.value }))}
          placeholder="What challenges are you facing with your current process?"
          className={`${inputCls} h-auto py-2`}
          style={inputStyle}
        />
      </div>

      <div>
        <label className={labelCls} style={{ color: INK_SOFT }}>Additional comments</label>
        <textarea
          rows={2}
          value={form.comments}
          onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))}
          placeholder="Anything else you'd like us to know?"
          className={`${inputCls} h-auto py-2`}
          style={inputStyle}
        />
      </div>

      <div className="pt-2 border-t" style={{ borderColor: LINE_SOFT }}>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={form.privacyConsent}
            onChange={(e) => setForm((f) => ({ ...f, privacyConsent: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded"
            style={{ borderColor: LINE, accentColor: BRAND }}
          />
          <span className="text-[12px] leading-relaxed" style={{ color: INK_SOFT }}>
            I consent to HireNest Workforce Pvt Ltd collecting and processing my information as
            described in the{' '}
            <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:no-underline" style={{ color: 'var(--accent)' }}>
              Privacy Policy
            </a>
            . I understand my data will be used to evaluate my early access application and contact me
            about HireNestOS. <span style={{ color: '#B8322B' }}>*</span>
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="zp-btn zp-btn-primary w-full disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : (
          <>
            Request early access
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}

const TRUSTED_VENDORS = [
  'Bluesand IT Solutions',
  'Nexzibyte Solutions',
  'AIMitra',
  'Federal Soft Systems',
  'Apex Talent Partners',
  'Tribirds IT Services',
  'IceApple Technology Solutions',
  'Velzo Technologies Pvt Ltd',
  'Sarathi Nexus',
  'Codemech Solution',
  'Anyaccess Technologies India Pvt. Ltd.',
  'Asridhi Infotech',
  'CloudNextGen IT Software Solutions',
  'Cognityhire',
  'Glimmora International',
  'JMR Consultancy',
  'Mathesis Labs',
  'Mycloudcrew',
  'Quantum Centric',
  'Hirety',
];

const MATCHING_CANDIDATE_SAMPLES = [
  {
    role: 'Senior Oracle Cloud ERP / Fusion Architect',
    matchScore: 94,
    exp: '8.5 yrs exp',
    vendor: 'Bluesand IT Solutions',
    status: 'Client Interview',
    skills: ['Oracle Fusion', 'Cloud ERP', 'HCM Modules', 'VBCS', 'OIC'],
  },
  {
    role: 'Principal Full Stack Engineer (React & Node)',
    matchScore: 96,
    exp: '7.0 yrs exp',
    vendor: 'Nexzibyte Solutions',
    status: 'Recruiter Validated',
    skills: ['React 19', 'TypeScript', 'Node.js', 'PostgreSQL', 'GraphQL'],
  },
  {
    role: 'Lead Cloud DevOps & Infrastructure Engineer',
    matchScore: 91,
    exp: '6.5 yrs exp',
    vendor: 'Federal Soft Systems',
    status: 'Forwarded to Client',
    skills: ['AWS', 'Kubernetes', 'Terraform', 'Docker', 'CI/CD Pipelines'],
  },
  {
    role: 'Senior GenAI & Data Platform Engineer',
    matchScore: 95,
    exp: '5.5 yrs exp',
    vendor: 'Apex Talent Partners',
    status: 'Offer in Progress',
    skills: ['Python', 'Gemini AI', 'Vector DB', 'PyTorch', 'FastAPI'],
  },
];

function VendorTrustSection() {
  return (
    <section id="vendors" className="py-20 border-y bg-[var(--zp-canvas)]" style={{ borderColor: LINE }}>
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
        {/* Header with Badges & Live Metrics */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 mb-12">
          <div>
            <div className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold tracking-wide uppercase mb-3 bg-[#EEF4FF] text-[#1D5FD1] border border-[#BFDBFE]">
              Network & Matching Powerhouse
            </div>
            <h2 className="type-display-lg !text-[clamp(28px,3.2vw,42px)]">
              Trusted by 25+ Staffing Agencies & 450+ Verified Candidates
            </h2>
            <p className="text-[16px] leading-relaxed mt-3 max-w-2xl" style={{ color: INK_SOFT }}>
              Enterprise requirements routed with zero noise. Staffing vendors compete on transparent SLA timers, composite quality scorecards, and deterministic matching precision across India.
            </p>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[var(--zp-canvas-soft)] p-3 rounded-[12px] border shrink-0" style={{ borderColor: LINE }}>
            <div className="px-3 py-2 text-center border-r" style={{ borderColor: LINE }}>
              <div className="text-[22px] font-bold font-mono tracking-tight" style={{ color: ACCENT }}>25+</div>
              <div className="text-[11px] font-medium" style={{ color: INK_FAINT }}>Vendor Agencies</div>
            </div>
            <div className="px-3 py-2 text-center sm:border-r" style={{ borderColor: LINE }}>
              <div className="text-[22px] font-bold font-mono tracking-tight" style={{ color: '#059669' }}>450+</div>
              <div className="text-[11px] font-medium" style={{ color: INK_FAINT }}>Candidates in Pool</div>
            </div>
            <div className="px-3 py-2 text-center border-r" style={{ borderColor: LINE }}>
              <div className="text-[22px] font-bold font-mono tracking-tight" style={{ color: NAVY }}>92%</div>
              <div className="text-[11px] font-medium" style={{ color: INK_FAINT }}>Match Precision</div>
            </div>
            <div className="px-3 py-2 text-center">
              <div className="text-[22px] font-bold font-mono tracking-tight" style={{ color: '#D97706' }}>&lt; 48h</div>
              <div className="text-[11px] font-medium" style={{ color: INK_FAINT }}>Shortlist SLA</div>
            </div>
          </div>
        </div>

        {/* Vendors Marquee / Grid */}
        <div className="mb-14">
          <div className="text-[12px] font-mono uppercase tracking-wider mb-4 flex items-center justify-between" style={{ color: INK_FAINT }}>
            <span className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[#1D5FD1]" />
              Staffing Agencies on HireNestOS
            </span>
            <span className="text-[11px] font-medium hidden sm:inline">Ranked by Composite SLA & Quality</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
            {TRUSTED_VENDORS.map((vendor, i) => (
              <div
                key={vendor}
                className="group flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-[10px] border bg-[var(--zp-canvas)] hover:border-[#1D5FD1] hover:shadow-xs transition-all duration-150"
                style={{ borderColor: LINE }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full bg-[#10B981] shrink-0" />
                  <span className="text-[13px] font-medium truncate group-hover:text-[#1D5FD1] transition-colors" style={{ color: INK }}>
                    {vendor}
                  </span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--zp-canvas-soft)] text-[#64748B] shrink-0">
                  #{i + 1}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 450+ Candidates in Matching Style Showcase */}
        <div className="rounded-[16px] border p-6 sm:p-8 bg-[#F8F9FC]" style={{ borderColor: LINE }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b" style={{ borderColor: LINE }}>
            <div>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#10B981]" />
                </span>
                <span className="font-mono text-[12px] font-semibold text-[#059669] uppercase tracking-wide">
                  Live Fitment Engine
                </span>
              </div>
              <h3 className="text-[20px] font-bold tracking-tight mt-1" style={{ color: INK }}>
                Real-Time Candidate Matching Stream
              </h3>
              <p className="text-[13px] mt-0.5" style={{ color: INK_SOFT }}>
                450+ profiles actively scored across skill overlap, domain depth, seniority, and SLA readiness.
              </p>
            </div>

            <div className="flex items-center gap-2 text-[12px] font-mono" style={{ color: INK_FAINT }}>
              <span className="inline-block px-2.5 py-1 rounded-md bg-white border font-semibold shadow-xs" style={{ borderColor: LINE, color: INK }}>
                SHA-256 De-duplicated
              </span>
              <span className="inline-block px-2.5 py-1 rounded-md bg-white border font-semibold shadow-xs" style={{ borderColor: LINE, color: '#1D5FD1' }}>
                BGV Verified
              </span>
            </div>
          </div>

          {/* Candidate Match Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MATCHING_CANDIDATE_SAMPLES.map((cand) => (
              <div
                key={cand.role}
                className="rounded-[12px] border bg-white p-5 shadow-xs hover:border-[#1D5FD1] transition-all hover:shadow-md"
                style={{ borderColor: LINE }}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h4 className="font-semibold text-[15px] leading-snug" style={{ color: INK }}>
                      {cand.role}
                    </h4>
                    <div className="flex items-center gap-2 text-[12px] mt-1" style={{ color: INK_FAINT }}>
                      <span>{cand.exp}</span>
                      <span>•</span>
                      <span className="font-medium text-[#1D5FD1]">via {cand.vendor}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="inline-flex items-center px-2.5 py-1 rounded-full text-[13px] font-bold font-mono bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]">
                      {cand.matchScore}% Match
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t" style={{ borderColor: LINE_SOFT }}>
                  {cand.skills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-[#F1F5F9] text-[#334155]"
                    >
                      <Check className="h-3 w-3 text-[#059669]" />
                      {skill}
                    </span>
                  ))}
                  <span className="inline-flex items-center text-[11px] font-mono px-2 py-0.5 rounded bg-[#EFF6FF] text-[#1D5FD1] ml-auto">
                    {cand.status}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px]" style={{ borderColor: LINE, color: INK_SOFT }}>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#059669]" />
              <span>Full compliance with candidate privacy and vendor ownership protections under DPDP 2023.</span>
            </div>
            <Link
              to="/jobs"
              className="inline-flex items-center gap-1 font-semibold text-[#1D5FD1] hover:underline"
            >
              Browse Public Openings <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export const LandingPage: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--zp-canvas)] font-sans antialiased" style={{ color: INK }}>
      {/* Navigation */}
      <header className="sticky top-0 z-50 bg-[#FFFEFB]/90 backdrop-blur-md border-b" style={{ borderColor: LINE }}>
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              <img
                src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
                alt="HireNest"
                className="h-8 w-8 rounded-[6px] bg-white object-contain p-0.5 border"
                style={{ borderColor: LINE }}
              />
              <div className="flex flex-col">
                <span className="font-display text-[16px] font-semibold tracking-[-0.02em] leading-tight">
                  HireNest
                </span>
                <span className="text-[10px] leading-tight" style={{ color: INK_FAINT }}>
                  Workforce Pvt Ltd
                </span>
              </div>
            </div>
            <nav className="hidden md:flex items-center gap-1 text-[15px] font-medium" style={{ color: INK }}>
              <a href="#vendors" className="px-3 py-2 rounded-[8px] hover:bg-[var(--zp-canvas-soft)] transition-colors" style={{ color: 'inherit' }}>
                Vendors & Matching
              </a>
              <a href="#platform" className="px-3 py-2 rounded-[8px] hover:bg-[var(--zp-canvas-soft)] transition-colors" style={{ color: 'inherit' }}>
                Platform
              </a>
              <a href="#pipeline" className="px-3 py-2 rounded-[8px] hover:bg-[var(--zp-canvas-soft)] transition-colors" style={{ color: 'inherit' }}>
                Pipeline
              </a>
              <Link to="/jobs" className="px-3 py-2 rounded-[8px] hover:bg-[var(--zp-canvas-soft)] transition-colors" style={{ color: 'inherit' }}>
                Jobs
              </Link>
              <a href="#security" className="px-3 py-2 rounded-[8px] hover:bg-[var(--zp-canvas-soft)] transition-colors" style={{ color: 'inherit' }}>
                Security
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/signin"
              className="hidden sm:inline text-[15px] font-medium transition-colors hover:text-[var(--zp-brand-text)]"
              style={{ color: INK }}
            >
              Sign in
            </Link>
            <a
              href="#early-access"
              className="zp-btn zp-btn-primary hidden sm:inline-flex !py-2 !px-4 !text-[14px]"
            >
              Request early access
            </a>
            <button
              type="button"
              className="md:hidden h-10 w-10 inline-flex items-center justify-center rounded-[12px] border transition-colors"
              style={{ borderColor: LINE, color: INK_SOFT }}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t px-4 py-4 space-y-1 bg-[var(--zp-canvas)]" style={{ borderColor: LINE_SOFT }}>
            <a href="#vendors" onClick={() => setMobileMenuOpen(false)} className="block py-2.5 text-[14px] font-medium transition-colors" style={{ color: INK_SOFT }}>Vendors & Matching</a>
            <a href="#platform" onClick={() => setMobileMenuOpen(false)} className="block py-2.5 text-[14px] font-medium transition-colors" style={{ color: INK_SOFT }}>Platform</a>
            <a href="#pipeline" onClick={() => setMobileMenuOpen(false)} className="block py-2.5 text-[14px] font-medium transition-colors" style={{ color: INK_SOFT }}>Pipeline</a>
            <Link to="/jobs" onClick={() => setMobileMenuOpen(false)} className="block py-2.5 text-[14px] font-medium transition-colors" style={{ color: INK_SOFT }}>Jobs</Link>
            <a href="#security" onClick={() => setMobileMenuOpen(false)} className="block py-2.5 text-[14px] font-medium transition-colors" style={{ color: INK_SOFT }}>Security</a>
            <div className="pt-3 mt-2 border-t flex flex-col gap-2.5" style={{ borderColor: LINE_SOFT }}>
              <Link to="/signin" className="text-[14px] font-medium transition-colors" style={{ color: INK_SOFT }}>Sign in</Link>
              <a
                href="#early-access"
                onClick={() => setMobileMenuOpen(false)}
                className="zp-btn zp-btn-primary"
              >
                Request early access
              </a>
            </div>
          </div>
        )}
      </header>

      <HeroSection />

      {/* Trusted by 25+ Staffing Agencies & 450+ Candidates in Matching Style */}
      <VendorTrustSection />

      {/* Platform, grouped by the role it serves — an editorial list, not a bento grid */}
      <section id="platform" className="py-20 sm:py-28 bg-[var(--zp-canvas)]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-[280px_1fr] gap-8 lg:gap-16">
            <div className="lg:sticky lg:top-20 lg:self-start">
              <div className="type-eyebrow mb-4" style={{ color: ACCENT }}>Platform</div>
              <h2 className="type-display-lg">
                Built for every seat
              </h2>
              <p className="text-[17px] leading-relaxed mt-4" style={{ color: INK_SOFT }}>
                Nobody logs in and sees "everything." Each party gets exactly the slice of the
                requirement that is theirs to act on.
              </p>
            </div>

            <div>
              {ROLE_GROUPS.map((g, i) => {
                const Icon = g.icon;
                return (
                  <Reveal key={g.role} delay={i * 0.05}>
                  <div
                    className={`group grid sm:grid-cols-[auto_1fr] gap-x-6 gap-y-3 py-9 ${i > 0 ? 'border-t' : ''}`}
                    style={{ borderColor: LINE }}
                  >
                    <div className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2">
                      <span className="font-mono text-[12px] text-[var(--text-tertiary)]">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="h-11 w-11 rounded-[12px] flex items-center justify-center transition-colors duration-200 bg-[var(--zp-canvas-soft)] group-hover:bg-[var(--zp-brand)] text-[var(--zp-brand)] group-hover:text-[var(--zp-canvas)]">
                        <Icon className="h-5 w-5" />
                      </span>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h3 className="font-semibold text-[22px] tracking-[-0.02em]" style={{ color: INK }}>{g.label}</h3>
                        <span className="text-[13px]" style={{ color: INK_FAINT }}>{g.who}</span>
                      </div>
                      <ul className="mt-3 space-y-2 text-[15px] leading-relaxed" style={{ color: INK_SOFT }}>
                        {g.points.map((p) => (
                          <li key={p} className="pl-3.5 border-l" style={{ borderColor: LINE }}>
                            {p}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 text-[12px] font-mono" style={{ color: INK_FAINT }}>
                        {g.footerLabel} — <span style={{ color: INK_SOFT }}>{g.footerValue}</span>
                      </div>
                    </div>
                  </div>
                  </Reveal>
                );
              })}

              {/* Platform-wide capabilities that sit underneath every role */}
              <div className="pt-8 border-t text-[13px] space-y-2 sm:space-y-0" style={{ borderColor: LINE, color: INK_SOFT }}>
                <span className="font-medium block sm:inline sm:mr-4" style={{ color: INK }}>Underneath all four:</span>
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-x-8 sm:gap-y-3">
                  <span>AI copilot for JD drafting & screening</span>
                  <span>Server-side NDA gate before protected collaboration</span>
                  <span>Annual or monthly billing, GST-compliant invoicing</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pipeline — a real sequence, so it earns the numbering */}
      <section id="pipeline" className="py-20 sm:py-28" style={{ background: PAPER }}>
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 space-y-10">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <div className="type-eyebrow" style={{ color: ACCENT }}>Pipeline</div>
            <h2 className="type-display-lg">
              The pipeline, with a clock on every handoff
            </h2>
            <p className="text-[17px] leading-relaxed" style={{ color: INK_SOFT }}>
              Four stages, each with an owner and an SLA, not a Kanban board anyone can quietly leave stale.
            </p>
          </div>

          <div className="relative">
            <div className="hidden lg:block absolute top-6 left-[12.5%] right-[12.5%] h-px" style={{ background: LINE }} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 relative">
              {PIPELINE.map((step, i) => (
                <Reveal key={step.n} delay={i * 0.08}>
                <div className="h-full rounded-[12px] border p-6 transition-all duration-200 hover:-translate-y-1 hover:border-[var(--zp-ink)] hover:shadow-[4px_4px_0_0_var(--zp-ink)]" style={{ borderColor: LINE, background: 'var(--zp-canvas)' }}>
                  <div className="flex items-center gap-2.5 mb-4">
                    <span
                      className="w-7 h-7 rounded-full text-white font-mono font-semibold text-[12px] flex items-center justify-center shrink-0"
                      style={{ background: step.accent }}
                    >
                      {step.n}
                    </span>
                    <span className="font-mono text-[11px] uppercase tracking-wide" style={{ color: step.accent }}>
                      {step.category}
                    </span>
                  </div>
                  <h3 className="text-[20px] font-semibold tracking-[-0.02em]">{step.title}</h3>
                  <p className="text-[14px] leading-relaxed mt-2" style={{ color: INK_SOFT }}>{step.detail}</p>
                  <div className="mt-4 pt-3 border-t font-mono text-[11px]" style={{ borderColor: LINE }}>
                    <span style={{ color: INK_FAINT }}>{step.footerLabel}: </span>
                    <span style={{ color: step.accent }}>{step.footerValue}</span>
                  </div>
                </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Security & compliance — dark panel, matching the product's own badges */}
      <section id="security" className="py-20 sm:py-24 px-4 sm:px-6" style={{ background: NAVY }}>
        <div className="max-w-[1280px] mx-auto">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-10">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6" style={{ color: '#38ACEF' }} />
              <h3 className="type-display-lg !text-[clamp(28px,3.4vw,40px)] text-white">Enterprise security & compliance</h3>
            </div>
            <p className="text-[14px] text-slate-300 max-w-sm">
              Built for staffing operations that move candidate data across organizations under
              India's privacy law.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {COMPLIANCE.map((c, i) => {
              const Icon = c.icon;
              return (
                <Reveal key={c.title} delay={i * 0.08} className="h-full">
                <div className="h-full p-6 rounded-[12px] border transition-colors duration-200 hover:border-[#1D5FD1]/60" style={{ borderColor: 'rgba(255,254,251,0.1)', background: 'rgba(255,254,251,0.04)' }}>
                  <div className="w-10 h-10 rounded-[10px] flex items-center justify-center mb-5" style={{ background: 'rgba(29, 95, 209,0.16)', color: '#38ACEF' }}>
                    <Icon className="h-[18px] w-[18px]" />
                  </div>
                  <div className="font-semibold text-[17px] text-white mb-2">{c.title}</div>
                  <p className="text-[14px] text-slate-300 leading-relaxed">{c.description}</p>
                </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Early Access Form */}
      <section id="early-access" className="py-20 sm:py-28" style={{ background: PAPER }}>
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 grid lg:grid-cols-[1fr_1.3fr] gap-12">
          <div>
            <div className="type-eyebrow mb-4" style={{ color: ACCENT }}>
              Limited enterprise cohort
            </div>
            <h2 className="type-display-lg">
              Apply for early access
            </h2>
            <p className="text-[17px] leading-relaxed mt-4 max-w-sm" style={{ color: INK_SOFT }}>
              We are onboarding staffing companies, IT recruitment agencies, independent recruiters and
              corporate hiring teams ahead of our commercial launch. Our team reviews every application
              within 48 hours.
            </p>
          </div>
          <div className="rounded-[12px] border p-6 sm:p-8 bg-[var(--zp-canvas)] shadow-[0_24px_60px_-32px_rgba(20, 33, 61,0.35)]" style={{ borderColor: NAVY }}>
            <EarlyAccessForm />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="pt-16 pb-10 px-4 sm:px-6 text-white" style={{ background: NAVY }}>
        <div className="max-w-[1280px] mx-auto flex flex-col gap-10">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-8 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <img
                src="/assets/aistudio/WhatsApp_Image_2026-10-25_at_12.39.21_03c58b61.jpeg"
                alt="HireNest"
                className="h-8 w-8 rounded-[6px] bg-white object-contain p-0.5"
              />
              <div className="flex flex-col">
                <span className="font-semibold text-white text-[15px] tracking-tight">HireNestOS</span>
                <span className="text-[11px] text-slate-400">Hire Nest Workforce Pvt Ltd</span>
              </div>
            </div>
            <nav className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px] text-slate-300">
              <a href="#platform" className="hover:text-white transition-colors">Platform</a>
              <a href="#pipeline" className="hover:text-white transition-colors">Pipeline</a>
              <a href="#security" className="hover:text-white transition-colors">Security</a>
              <Link to="/privacy-policy" className="hover:text-white transition-colors">Privacy policy</Link>
              <a
                href="https://www.hirenestworkforce.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                www.hirenestworkforce.com
              </a>
              <a
                href="https://www.linkedin.com/company/hirenest-workforce-pvt-ltd/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="HireNest Workforce on LinkedIn"
                className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
                </svg>
                LinkedIn
              </a>
            </nav>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-[12px] text-slate-500 font-mono">
            <span>© 2026 HireNest Workforce Pvt Ltd. All rights reserved.</span>
            <span>
              Built by{' '}
              <a
                href="https://atkind.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-slate-300 hover:text-white hover:underline transition-colors"
              >
                Atkind Pvt Ltd
              </a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};
