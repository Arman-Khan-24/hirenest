import type { Candidate, CandidateMatch, Requirement } from '../types/db';
import { classifyRequirement } from './requirementCategory';

/**
 * Normalizes a skill or phrase for comparison.
 */
function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s+#./]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formats a raw atomic skill token into clean, readable casing while preserving acronyms.
 */
export function formatAtomicSkillLabel(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/^[•·\-–*]+\s*/, '')
    .replace(/[.;:,]+$/, '')
    .trim();
  if (!trimmed) return '';

  const ACRONYMS: Record<string, string> = {
    ai: 'AI',
    ml: 'ML',
    llm: 'LLM',
    llms: 'LLMs',
    rag: 'RAG',
    nlp: 'NLP',
    genai: 'GenAI',
    iac: 'IaC',
    aws: 'AWS',
    gcp: 'GCP',
    azure: 'Azure',
    sql: 'SQL',
    nosql: 'NoSQL',
    'pl/sql': 'PL/SQL',
    't-sql': 'T-SQL',
    postgresql: 'PostgreSQL',
    mysql: 'MySQL',
    mongodb: 'MongoDB',
    dynamodb: 'DynamoDB',
    bigquery: 'BigQuery',
    databricks: 'Databricks',
    snowflake: 'Snowflake',
    api: 'API',
    apis: 'APIs',
    rest: 'REST',
    graphql: 'GraphQL',
    'ci/cd': 'CI/CD',
    cicd: 'CI/CD',
    devops: 'DevOps',
    devsecops: 'DevSecOps',
    sre: 'SRE',
    k8s: 'K8s',
    sap: 'SAP',
    ppqm: 'PPQM',
    hana: 'HANA',
    abap: 'ABAP',
    vbcs: 'VBCS',
    oic: 'OIC',
    erp: 'ERP',
    hcm: 'HCM',
    scm: 'SCM',
    etl: 'ETL',
    elt: 'ELT',
    bi: 'BI',
    qa: 'QA',
    ui: 'UI',
    ux: 'UX',
    arm: 'ARM',
    rbac: 'RBAC',
    iam: 'IAM',
    aks: 'AKS',
    eks: 'EKS',
    gke: 'GKE',
  };

  const lower = trimmed.toLowerCase();
  if (
    lower.includes('evaluation of answer quality') ||
    (lower.includes('latency') && lower.includes('token cost'))
  ) {
    if (lower === 'evaluation of answer quality') return 'LLM Answer Quality Evaluation';
    if (lower === 'latency and token cost' || lower === 'latency & token cost') {
      return 'Latency & Token Optimization';
    }
    if (lower.includes('evaluation of answer quality') && lower.includes('token')) {
      return 'LLM Evaluation & Token Optimization';
    }
  }

  return trimmed
    .split(/\s+/)
    .map((word, idx) => {
      const cleanWord = word.toLowerCase();
      if (ACRONYMS[cleanWord]) return ACRONYMS[cleanWord];
      if (
        idx > 0 &&
        ['of', 'and', 'as', 'in', 'on', 'for', 'to', 'with', 'by', 'or'].includes(cleanWord)
      ) {
        return cleanWord;
      }
      if (word.length <= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Protected slash tokens that should NOT be split on `/`.
 */
const PROTECTED_SLASH_PATTERNS = [
  /\bci\s*\/\s*cd\b/gi,
  /\bpl\s*\/\s*sql\b/gi,
  /\bs\s*\/\s*4\s*hana\b/gi,
  /\bui\s*\/\s*ux\b/gi,
  /\btcp\s*\/\s*ip\b/gi,
  /\bos\s*\/\s*390\b/gi,
  /\bz\s*\/\s*os\b/gi,
];

/**
 * Splits compound JD skill strings (e.g., separated by `;`, `/`, `,`, `|`, bullets, or `and`)
 * into clean, atomic skill labels.
 */
export function decomposeCompoundSkills(rawSkills: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (candidate: string) => {
    const formatted = formatAtomicSkillLabel(candidate);
    if (!formatted || formatted.length < 2) return;
    const key = formatted.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(formatted);
    }
  };

  for (const rawItem of rawSkills || []) {
    if (!rawItem || typeof rawItem !== 'string') continue;

    let working = rawItem;
    const replacements: Array<{ placeholder: string; original: string }> = [];
    PROTECTED_SLASH_PATTERNS.forEach((pattern, i) => {
      working = working.replace(pattern, (match) => {
        const placeholder = `__SLASH_PROTECTED_${i}__`;
        replacements.push({ placeholder, original: match.replace(/\s*\/\s*/, '/') });
        return placeholder;
      });
    });

    const primaryChunks = working
      .split(/[;|\n\r/]+/)
      .map((c) => c.trim())
      .filter(Boolean);

    for (let chunk of primaryChunks) {
      for (const r of replacements) {
        chunk = chunk.replace(new RegExp(r.placeholder, 'g'), r.original);
      }

      const lowerChunk = chunk.toLowerCase();
      if (
        lowerChunk.startsWith('evaluation of ') &&
        (lowerChunk.includes('latency') || lowerChunk.includes('token'))
      ) {
        pushUnique('LLM Evaluation & Quality');
        pushUnique('Latency & Token Optimization');
        continue;
      }

      const subParts = chunk
        .split(/,|\band\b/i)
        .map((p) => p.trim())
        .filter(Boolean);

      for (const part of subParts) {
        pushUnique(part);
      }
    }
  }

  return result;
}

/**
 * Extracts core technical & domain skills from a JD title and description
 * to supplement decomposed requirement skills.
 */
const JD_SKILL_DETECTORS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Azure AI', pattern: /\bazure\s+ai\b/i },
  { label: 'Microsoft Foundry', pattern: /\b(?:microsoft\s+)?foundry\b/i },
  { label: 'Azure AI Search', pattern: /\bazure\s+(?:ai|cognitive)\s+search\b/i },
  { label: 'Copilot Studio', pattern: /\bcopilot\s+studio\b/i },
  { label: 'Microsoft Bicep', pattern: /\bbicep\b/i },
  { label: 'Infrastructure as Code', pattern: /\binfrastructure\s+as\s+code\b|\biac\b/i },
  { label: 'Azure', pattern: /\bazure\b/i },
  { label: 'AWS', pattern: /\baws\b|\bamazon\s+web\s+services\b/i },
  { label: 'GCP', pattern: /\bgcp\b|\bgoogle\s+cloud\b/i },
  { label: 'Terraform', pattern: /\bterraform\b/i },
  { label: 'Kubernetes', pattern: /\bkubernetes\b|\bk8s\b|\baks\b|\beks\b/i },
  { label: 'Docker', pattern: /\bdocker\b|\bcontainer/i },
  { label: 'DevSecOps', pattern: /\bdevsecops\b/i },
  { label: 'DevOps', pattern: /\bdevops\b/i },
  { label: 'CI/CD', pattern: /\bci\/cd\b|\bgithub\s+actions\b|\bazure\s+devops\b|\bjenkins\b/i },
  { label: 'Databricks', pattern: /\bdatabricks\b/i },
  { label: 'Python', pattern: /\bpython\b/i },
  { label: 'TypeScript', pattern: /\btypescript\b/i },
  { label: 'JavaScript', pattern: /\bjavascript\b/i },
  { label: 'React', pattern: /\breact(?:\.js|js)?\b/i },
  { label: 'Node.js', pattern: /\bnode(?:\.js|js)?\b/i },
  { label: 'Java', pattern: /\bjava\b/i },
  { label: 'C# / .NET', pattern: /\bc#\b|\b\.net\b/i },
  { label: 'PostgreSQL', pattern: /\bpostgres(?:ql)?\b/i },
  { label: 'SQL', pattern: /\bsql\b|\bt-sql\b|\bpl\/sql\b/i },
  { label: 'Database Architecture', pattern: /\bdatabase\s+(?:design|architect|rearchitect)/i },
  { label: 'Data Engineering', pattern: /\bdata\s+engineer(?:ing)?\b|\betl\b|\bdata\s+pipeline/i },
  { label: 'Snowflake', pattern: /\bsnowflake\b/i },
  { label: 'Spark', pattern: /\bspark\b|\bpyspark\b/i },
  { label: 'SAP PPQM', pattern: /\bsap\s+ppqm\b|\bppqm\b/i },
  { label: 'SAP HANA', pattern: /\bsap\s+hana\b|\bs\/4hana\b/i },
  { label: 'SAP BASIS', pattern: /\bsap\s+basis\b/i },
  { label: 'Machine Learning', pattern: /\bmachine\s+learning\b|\bdeep\s+learning\b|\bllm\b|\bgenai\b|\brag\b/i },
  { label: 'Solution Architecture', pattern: /\b(?:solution|cloud|enterprise|foundry|ai)\s+architect(?:ure)?\b/i },
  // Sales, Business Development, Account Management & Presales
  { label: 'Business Development', pattern: /\bbusiness\s+development\b|\bbd\b/i },
  { label: 'Account Management', pattern: /\baccount\s+manage(?:ment|r)\b|\bkey\s+account\b|\bclient\s+partner\b/i },
  { label: 'Technical Presales', pattern: /\b(?:technical\s+)?presales\b|\bpre-sales\b/i },
  { label: 'B2B Sales', pattern: /\bb2b\s+sales\b|\benterprise\s+sales\b|\bsolution\s+sales\b/i },
  { label: 'Solution Selling', pattern: /\bsolution\s+selling\b|\bconsultative\s+selling\b/i },
  { label: 'Client Acquisition', pattern: /\bclient\s+acquisition\b|\bnew\s+business\s+acquisition\b/i },
  { label: 'Client Relationship Management', pattern: /\bclient\s+relationships?\b|\bcustomer\s+relationships?\b/i },
  { label: 'Lead Generation & Prospecting', pattern: /\blead\s+gen(?:eration)?\b|\bprospecting\b|\bqualified\s+leads\b/i },
  { label: 'Deal Closing & Negotiation', pattern: /\bclose\s+deals\b|\bdeal\s+closing\b|\bcontract\s+negotiation\b/i },
  { label: 'Revenue Growth & Pipeline', pattern: /\brevenue\s+growth\b|\bpipeline\s+manage(?:ment)?\b|\bcross[- ]selling\b/i },
  { label: 'Stakeholder Management', pattern: /\bstakeholder\s+manage(?:ment)?\b|\bclient\s+engagement\b/i },
  { label: 'Cloud & IT Services', pattern: /\bcloud\s+(?:and\s+)?it\s+services\b|\bit\s+managed\s+services\b|\bmanaged\s+services\b|\bnaas\b|\bsaas\b/i },
  // Enterprise Applications & Systems
  { label: 'ServiceNow', pattern: /\bservicenow\b/i },
  { label: 'ServiceNow GRC / IRM', pattern: /\bgrc\b|\birm\b|\bgovernance(?:,\s*|\s+and\s+)risk\b/i },
  { label: 'Workday', pattern: /\bworkday\b/i },
  { label: 'Oracle Fusion', pattern: /\boracle\s+fusion\b/i },
  { label: 'VBCS', pattern: /\bvbcs\b|\bvisual\s+builder\s+(?:cloud\s+service|studio)?\b/i },
  { label: 'Oracle Cloud ERP / HCM', pattern: /\boracle\s+cloud\s+(?:erp|hcm|scm|financials)\b/i },
  { label: 'Oracle Integration Cloud', pattern: /\boracle\s+integration\s+cloud\b|\boic\b/i },
  { label: 'Salesforce', pattern: /\bsalesforce\b|\bsfdc\b/i },
  { label: 'Project Management', pattern: /\bproject\s+manage(?:ment|r)\b|\bpmp\b|\bscrum\b|\bagile\b/i },
  { label: 'Product Management', pattern: /\bproduct\s+manage(?:ment|r)\b/i },
  { label: 'Cybersecurity', pattern: /\bcybersecurity\b|\binformation\s+security\b|\bsiem\b|\bsoc\b/i },
];

/**
 * Domain synonym & capability clusters: maps normalized required skill concepts
 * to equivalent or strongly related resume skills/keywords.
 */
const SKILL_SYNONYM_CLUSTERS: Array<{
  triggers: RegExp[];
  strongEquivalents: RegExp[];
  partialEquivalents: RegExp[];
}> = [
  {
    triggers: [/\bbusiness\s+development\b/i, /\bbd\b/i, /\bclient\s+acquisition\b/i],
    strongEquivalents: [
      /\bbusiness\s+development\b/i,
      /\bbd\b/i,
      /\bclient\s+acquisition\b/i,
      /\bnew\s+business\b/i,
      /\baccount\s+management\b/i,
      /\bsolution\s+selling\b/i,
      /\bb2b\s+sales\b/i,
    ],
    partialEquivalents: [
      /\bsales\b/i,
      /\blead\s+gen/i,
      /\bprospecting\b/i,
      /\bcustomer\s+relationship/i,
      /\bdeal\s+closing\b/i,
      /\bclient\s+partner\b/i,
    ],
  },
  {
    triggers: [/\baccount\s+manage/i, /\bclient\s+relationship/i, /\bclient\s+partner/i],
    strongEquivalents: [
      /\baccount\s+manage/i,
      /\bclient\s+relationship/i,
      /\bclient\s+partner\b/i,
      /\bcustomer\s+success\b/i,
      /\bkey\s+account\b/i,
      /\bclient\s+retention\b/i,
    ],
    partialEquivalents: [
      /\bbusiness\s+development\b/i,
      /\bcross[- ]selling\b/i,
      /\bupselling\b/i,
      /\bstakeholder\s+manage/i,
      /\bsales\b/i,
    ],
  },
  {
    triggers: [/\b(?:technical\s+)?presales\b/i, /\bpre-sales\b/i],
    strongEquivalents: [
      /\bpresales\b/i,
      /\bpre-sales\b/i,
      /\brfp\b/i,
      /\brfi\b/i,
      /\btechnical\s+sales\b/i,
      /\bsolution\s+architect/i,
      /\bproof\s+of\s+concept\b/i,
      /\bpoc\b/i,
    ],
    partialEquivalents: [
      /\bclient\s+presentation\b/i,
      /\bdemo\b/i,
      /\bsolution\s+design\b/i,
      /\bcloud\b/i,
    ],
  },
  {
    triggers: [/\bservicenow\b/i],
    strongEquivalents: [
      /\bservicenow\b/i,
      /\bsnow\b/i,
      /\bnow\s+platform\b/i,
      /\bservicenow\s+developer\b/i,
      /\bservicenow\s+admin\b/i,
    ],
    partialEquivalents: [
      /\bitsm\b/i,
      /\bitom\b/i,
      /\bgrc\b/i,
      /\birm\b/i,
      /\bcmdb\b/i,
      /\bjavascript\b/i,
    ],
  },
  {
    triggers: [/\bgrc\b/i, /\birm\b/i, /\bgovernance(?:,\s*|\s+and\s+)risk\b/i],
    strongEquivalents: [
      /\bgrc\b/i,
      /\birm\b/i,
      /\bgovernance\b/i,
      /\brisk\s+management\b/i,
      /\bcompliance\b/i,
    ],
    partialEquivalents: [
      /\bservicenow\b/i,
      /\baudit\b/i,
      /\bpolicy\b/i,
      /\bsecurity\b/i,
    ],
  },
  {
    triggers: [/\bcloud\s+(?:and\s+)?it\s+services\b/i, /\bit\s+managed\s+services\b/i, /\bmanaged\s+services\b/i],
    strongEquivalents: [
      /\bcloud\s+(?:infrastructure|services?)\b/i,
      /\bmanaged\s+services\b/i,
      /\bit\s+services\b/i,
      /\bsaas\b/i,
      /\bnaas\b/i,
      /\biaas\b/i,
    ],
    partialEquivalents: [
      /\bazure\b/i,
      /\baws\b/i,
      /\bgcp\b/i,
      /\bcloud\b/i,
      /\btelecom\b/i,
    ],
  },
  {
    triggers: [/\bbicep\b/i, /\barm\s+template/i],
    strongEquivalents: [
      /\bbicep\b/i,
      /\barm\s+template/i,
      /\binfrastructure\s+as\s+code\b/i,
      /\biac\b/i,
      /\bterraform\b/i,
    ],
    partialEquivalents: [
      /\bazure\b/i,
      /\bdevsecops\b/i,
      /\bdevops\b/i,
      /\bcloudformation\b/i,
      /\bpulumi\b/i,
      /\bci\/cd\b/i,
    ],
  },
  {
    triggers: [/\binfrastructure\s+as\s+code\b/i, /\biac\b/i],
    strongEquivalents: [
      /\binfrastructure\s+as\s+code\b/i,
      /\biac\b/i,
      /\bterraform\b/i,
      /\bbicep\b/i,
      /\bcloudformation\b/i,
      /\bpulumi\b/i,
      /\bansible\b/i,
      /\bdevsecops\b/i,
      /\bdevops\b/i,
    ],
    partialEquivalents: [/\bci\/cd\b/i, /\bkubernetes\b/i, /\bdocker\b/i, /\bcloud\b/i, /\bazure\b/i, /\baws\b/i],
  },
  {
    triggers: [
      /\bazure\s+ai\b/i,
      /\bfoundry\b/i,
      /\bcopilot\s+studio\b/i,
      /\bazure\s+ai\s+search\b/i,
      /\bcognitive\s+search\b/i,
    ],
    strongEquivalents: [
      /\bazure\s+ai\b/i,
      /\bfoundry\b/i,
      /\bcopilot\b/i,
      /\bopenai\b/i,
      /\bllm\b/i,
      /\bgenai\b/i,
      /\brag\b/i,
      /\bmachine\s+learning\b/i,
      /\bai\s+architect/i,
    ],
    partialEquivalents: [
      /\bazure\b/i,
      /\bcloud\s+architect/i,
      /\bsolution\s+architect/i,
      /\bpython\b/i,
      /\bdata\s+engineer/i,
      /\bdata\s+scien/i,
    ],
  },
  {
    triggers: [
      /\bllm\s+evaluation\b/i,
      /\banswer\s+quality\b/i,
      /\btoken\s+(?:cost|optimization)\b/i,
      /\blatency\b/i,
    ],
    strongEquivalents: [
      /\bllm\b/i,
      /\bgenai\b/i,
      /\bopenai\b/i,
      /\bmachine\s+learning\b/i,
      /\bperformance\s+tuning\b/i,
      /\bobservability\b/i,
      /\bmlops\b/i,
    ],
    partialEquivalents: [
      /\bpython\b/i,
      /\bazure\b/i,
      /\bdata\s+engineer/i,
      /\barchitect\b/i,
      /\bmonitoring\b/i,
      /\bcloud\b/i,
    ],
  },
  {
    triggers: [/\bdevsecops\b/i, /\bdevops\b/i, /\bcloud\s+architect/i, /\bsolution\s+architect/i],
    strongEquivalents: [
      /\bdevsecops\b/i,
      /\bdevops\b/i,
      /\bci\/cd\b/i,
      /\bkubernetes\b/i,
      /\bdocker\b/i,
      /\bterraform\b/i,
      /\bazure\b/i,
      /\baws\b/i,
      /\bgcp\b/i,
      /\bsystem\s+design\b/i,
    ],
    partialEquivalents: [/\blinux\b/i, /\bgit\b/i, /\bmicroservices\b/i],
  },
  {
    triggers: [
      /\bdatabase\s+design/i,
      /\bdatabase\s+architect/i,
      /\brearchitect/i,
      /\bdata\s+model/i,
      /\bpostgresql\b/i,
      /\bsql\b/i,
    ],
    strongEquivalents: [
      /\bpostgresql\b/i,
      /\bsql\b/i,
      /\bpl\/sql\b/i,
      /\boracle\b/i,
      /\bmysql\b/i,
      /\bdatabase\b/i,
      /\bdata\s+model/i,
      /\bdb\b/i,
      /\bdba\b/i,
      /\bsnowflake\b/i,
    ],
    partialEquivalents: [/\betl\b/i, /\bdata\s+warehous/i, /\bdata\s+engineer/i, /\bperformance\s+tuning\b/i],
  },
  {
    triggers: [
      /\bdatabricks\b/i,
      /\bdata\s+engineer/i,
      /\betl\b/i,
      /\bdata\s+pipeline/i,
      /\bspark\b/i,
      /\bsnowflake\b/i,
    ],
    strongEquivalents: [
      /\bdatabricks\b/i,
      /\bdata\s+engineer/i,
      /\betl\b/i,
      /\bspark\b/i,
      /\bpyspark\b/i,
      /\bsnowflake\b/i,
      /\bbigquery\b/i,
      /\bkafka\b/i,
      /\bsql\b/i,
      /\bpython\b/i,
      /\bdata\s+warehous/i,
    ],
    partialEquivalents: [/\bpostgresql\b/i, /\bazure\b/i, /\baws\b/i, /\bgcp\b/i],
  },
  {
    triggers: [
      /\boracle\s+fusion\b/i,
      /\bvbcs\b/i,
      /\bvisual\s+builder\b/i,
      /\boracle\s+cloud\s+(?:erp|hcm|scm|financia)/i,
      /\boracle\s+integration\s+cloud\b|\boic\b/i,
    ],
    strongEquivalents: [
      /\boracle\s+fusion\b/i,
      /\bvbcs\b/i,
      /\bvisual\s+builder(?:\s+cloud\s+service|\s+studio)?\b/i,
      /\boracle\s+cloud\s+(?:erp|hcm|scm|infrastructure|financials?)\b/i,
      /\boracle\s+integration\s+cloud\b|\boic\b/i,
      /\bfusion\s+(?:technical|functional|developer|consultant)\b/i,
      /\boracle\s+cloud\s+applications\b/i,
    ],
    partialEquivalents: [
      /\boracle\s+apps\b/i,
      /\boracle\s+ebs\b/i,
      /\be-business\s+suite\b/i,
    ],
  },
];

/**
 * Industry & Technical Domain Clusters for the 20% Domain Match (D) dimension.
 */
const DOMAIN_CLUSTERS: Array<{
  id: string;
  name: string;
  patterns: RegExp[];
  adjacentDomains: string[];
}> = [
  {
    id: 'ai_genai_foundry',
    name: 'AI, GenAI & Agentic Systems',
    patterns: [
      /\bazure\s+ai\b/i,
      /\bfoundry\b/i,
      /\bcopilot\b/i,
      /\bopenai\b/i,
      /\bllm\b/i,
      /\bgenai\b/i,
      /\brag\b/i,
      /\bmachine\s+learning\b/i,
      /\bcognitive\s+search\b/i,
      /\bai\s+search\b/i,
    ],
    adjacentDomains: ['cloud_devsecops_infra', 'data_engineering_lakehouse'],
  },
  {
    id: 'cloud_devsecops_infra',
    name: 'Cloud Infrastructure & DevSecOps',
    patterns: [
      /\bazure\b/i,
      /\baws\b/i,
      /\bgcp\b/i,
      /\bbicep\b/i,
      /\bterraform\b/i,
      /\binfrastructure\s+as\s+code\b/i,
      /\biac\b/i,
      /\bdevsecops\b/i,
      /\bdevops\b/i,
      /\bkubernetes\b/i,
      /\bdocker\b/i,
      /\bci\/cd\b/i,
      /\bcloud\b/i,
    ],
    adjacentDomains: ['ai_genai_foundry', 'software_backend_fullstack'],
  },
  {
    id: 'data_engineering_lakehouse',
    name: 'Data Engineering, Lakehouse & Analytics',
    patterns: [
      /\bdatabricks\b/i,
      /\bspark\b/i,
      /\bpyspark\b/i,
      /\bdata\s+engineer/i,
      /\betl\b/i,
      /\bdata\s+pipeline/i,
      /\bsnowflake\b/i,
      /\bbigquery\b/i,
      /\bkafka\b/i,
      /\bdata\s+warehous/i,
    ],
    adjacentDomains: ['database_rdbms_architecture', 'ai_genai_foundry', 'cloud_devsecops_infra'],
  },
  {
    id: 'database_rdbms_architecture',
    name: 'Database Architecture & RDBMS',
    patterns: [
      /\bpostgresql\b/i,
      /\bsql\b/i,
      /\bpl\/sql\b/i,
      /\boracle\b/i,
      /\bmysql\b/i,
      /\bdatabase\b/i,
      /\brearchitect/i,
      /\bdata\s+model/i,
      /\bdba\b/i,
      /\bperformance\s+tuning\b/i,
    ],
    adjacentDomains: ['data_engineering_lakehouse', 'software_backend_fullstack'],
  },
  {
    id: 'enterprise_erp_sap',
    name: 'Enterprise ERP & SAP',
    patterns: [
      /\bsap\b/i,
      /\bppqm\b/i,
      /\bhana\b/i,
      /\bs\/4hana\b/i,
      /\babap\b/i,
      /\bbasis\b/i,
      /\berp\b/i,
    ],
    adjacentDomains: ['database_rdbms_architecture'],
  },
  {
    id: 'software_backend_fullstack',
    name: 'Software & Distributed Systems Engineering',
    patterns: [
      /\btypescript\b/i,
      /\bjavascript\b/i,
      /\breact\b/i,
      /\bnode(?:\.js|js)?\b/i,
      /\bpython\b/i,
      /\bjava\b/i,
      /\bspring\s*boot\b/i,
      /\bgolang\b/i,
      /\bc#\b/i,
      /\b\.net\b/i,
      /\bmicroservices\b/i,
      /\bdistributed\s+systems\b/i,
      /\brest\s*api/i,
    ],
    adjacentDomains: ['cloud_devsecops_infra', 'database_rdbms_architecture'],
  },
  {
    id: 'qa_test_automation',
    name: 'Quality Engineering & Automation',
    patterns: [
      /\bselenium\b/i,
      /\bplaywright\b/i,
      /\bcypress\b/i,
      /\bqa\s+automation\b/i,
      /\btest\s+automation\b/i,
    ],
    adjacentDomains: ['software_backend_fullstack'],
  },
];

const STOP_WORDS = new Set([
  'and',
  'or',
  'of',
  'the',
  'in',
  'on',
  'for',
  'to',
  'with',
  'as',
  'by',
  'at',
  'from',
  'senior',
  'junior',
  'lead',
  'principal',
  'staff',
  'consultant',
  'specialist',
  'associate',
]);

/**
 * Extracts all normalized text & skill signals from a Candidate record
 * (including `skills`, `current_title`, `summary`, and `parsed_data`).
 */
export function extractCandidateProfileSignals(candidate: Candidate): {
  explicitSkills: string[];
  inferredSkills: string[];
  allSkills: string[];
  corpusText: string;
  titleTokens: Set<string>;
} {
  const rawSkills = Array.isArray(candidate.skills) ? candidate.skills : [];
  const explicitSkills = decomposeCompoundSkills(rawSkills);

  const parsedDataStr = candidate.parsed_data ? JSON.stringify(candidate.parsed_data) : '';
  const corpusText = [
    candidate.current_title || '',
    candidate.summary || '',
    explicitSkills.join(' '),
    parsedDataStr,
  ]
    .join(' ')
    .toLowerCase();

  const inferredSkills: string[] = [];
  const seen = new Set(explicitSkills.map((s) => s.toLowerCase()));

  for (const detector of JD_SKILL_DETECTORS) {
    if (detector.pattern.test(corpusText) && !seen.has(detector.label.toLowerCase())) {
      seen.add(detector.label.toLowerCase());
      inferredSkills.push(detector.label);
    }
  }

  const titleLower = (candidate.current_title || '').toLowerCase();
  if (/\bcloud\b/.test(titleLower) && !seen.has('cloud architecture')) {
    seen.add('cloud architecture');
    inferredSkills.push('Cloud Architecture');
  }
  if (/\bdevsecops\b/.test(titleLower) && !seen.has('devsecops')) {
    seen.add('devsecops');
    inferredSkills.push('DevSecOps');
  }
  if (/\bdevops\b/.test(titleLower) && !seen.has('devops')) {
    seen.add('devops');
    inferredSkills.push('DevOps');
  }
  if (/\barchitect\b/.test(titleLower) && !seen.has('solution architecture')) {
    seen.add('solution architecture');
    inferredSkills.push('Solution Architecture');
  }
  if (/\bdata\s+engineer/i.test(titleLower) && !seen.has('data engineering')) {
    seen.add('data engineering');
    inferredSkills.push('Data Engineering');
  }
  if (/\bdatabase\b/i.test(titleLower) && !seen.has('database architecture')) {
    seen.add('database architecture');
    inferredSkills.push('Database Architecture');
  }

  const titleTokens = new Set(
    normalizeText(candidate.current_title || '')
      .split(' ')
      .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
  );

  return {
    explicitSkills,
    inferredSkills,
    allSkills: [...explicitSkills, ...inferredSkills],
    corpusText,
    titleTokens,
  };
}

const LOCATION_WORDS = new Set([
  'bangalore', 'bengaluru', 'mumbai', 'pune', 'hyderabad', 'delhi', 'noida', 'gurgaon', 'gurugram',
  'chennai', 'kolkata', 'remote', 'hybrid', 'onsite', 'bang', 'hyd'
]);

const ROLE_SUFFIXES = /\b(?:manager|executive|developer|engineer|specialist|consultant|associate|lead|director|architect|analyst)\b/gi;
const SENIORITY_PREFIXES = /\b(?:senior|sr\.?|junior|jr\.?|principal|staff|lead|chief|head\s+of)\b/gi;

export function extractSkillsFromJobTitle(rawTitle: string): string[] {
  if (!rawTitle || typeof rawTitle !== 'string') return [];
  // Clean out parenthesis containing locations like (Bang), (Pune / Hyderabad)
  const cleaned = rawTitle.replace(/\(([^)]+)\)/g, (_match, inner) => {
    const lowerInner = inner.toLowerCase();
    const isLocation = Array.from(LOCATION_WORDS).some((loc) => lowerInner.includes(loc));
    return isLocation ? '' : inner;
  });

  // Split by slashes, dashes, ampersands, commas
  const segments = cleaned
    .split(/[/|&–—,-]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const skills: string[] = [];
  const seen = new Set<string>();

  for (const seg of segments) {
    const lower = seg.toLowerCase().trim();
    if (lower.length < 2 || LOCATION_WORDS.has(lower)) continue;

    if (/\bbusiness\s+development\b/i.test(seg) && !seen.has('business development')) {
      seen.add('business development');
      skills.push('Business Development');
    }
    if (/\baccount\s+manage/i.test(seg) && !seen.has('account management')) {
      seen.add('account management');
      skills.push('Account Management');
    }
    if (/\b(?:technical\s+)?presales\b/i.test(seg) && !seen.has('technical presales')) {
      seen.add('technical presales');
      skills.push('Technical Presales');
    }
    if (/\bservicenow\b/i.test(seg) && !seen.has('servicenow')) {
      seen.add('servicenow');
      skills.push('ServiceNow');
    }
    if ((/\bgrc\b/i.test(seg) || /\birm\b/i.test(seg)) && !seen.has('grc / irm')) {
      seen.add('grc / irm');
      skills.push('GRC / IRM');
    }
    if (/\bsolution\s+architect/i.test(seg) && !seen.has('solution architecture')) {
      seen.add('solution architecture');
      skills.push('Solution Architecture');
    }
    if (/\bsnowflake\b/i.test(seg) && !seen.has('snowflake')) {
      seen.add('snowflake');
      skills.push('Snowflake');
    }
    if (/\bdata\s+engineer/i.test(seg) && !seen.has('data engineering')) {
      seen.add('data engineering');
      skills.push('Data Engineering');
    }
    if (/\bworkday\b/i.test(seg) && !seen.has('workday')) {
      seen.add('workday');
      skills.push('Workday');
    }

    // Generic strip: strip seniority and suffixes to get the core capability
    const stripped = seg
      .replace(SENIORITY_PREFIXES, '')
      .replace(ROLE_SUFFIXES, '')
      .trim();

    if (stripped.length >= 3 && !seen.has(stripped.toLowerCase())) {
      const lowerStripped = stripped.toLowerCase();
      if (!LOCATION_WORDS.has(lowerStripped)) {
        seen.add(lowerStripped);
        skills.push(stripped);
      }
    }
  }

  return skills;
}

/**
 * Extracts normalized atomic requirement skills from the Requirement's `skills` array,
 * plus core skills mentioned in `title` and `description`.
 */
export function extractRequirementAtomicSkills(
  requirement: Pick<Requirement, 'title' | 'description' | 'skills'>
): string[] {
  const decomposed = decomposeCompoundSkills(requirement.skills || []);
  // Skills defined on the requirement are the single source of truth. Only when none were
  // defined do we fall back to inferring skills from the title/description.
  if (decomposed.length > 0) return decomposed;
  const seen = new Set<string>();

  const titleAndDesc = `${requirement.title || ''} ${requirement.description || ''}`;

  // 1. Detect skills in title
  for (const detector of JD_SKILL_DETECTORS) {
    if (detector.pattern.test(requirement.title || '') && !seen.has(detector.label.toLowerCase())) {
      seen.add(detector.label.toLowerCase());
      decomposed.push(detector.label);
    }
  }

  // 2. Also detect skills from description
  if (titleAndDesc.trim()) {
    for (const detector of JD_SKILL_DETECTORS) {
      if (detector.pattern.test(titleAndDesc) && !seen.has(detector.label.toLowerCase())) {
        seen.add(detector.label.toLowerCase());
        decomposed.push(detector.label);
      }
    }
  }

  // 3. Fallback: extract core skills from title structure if still few or none detected
  if (decomposed.length < 3 && requirement.title?.trim()) {
    const titleSkills = extractSkillsFromJobTitle(requirement.title);
    for (const s of titleSkills) {
      if (!seen.has(s.toLowerCase())) {
        seen.add(s.toLowerCase());
        decomposed.push(s);
      }
    }
  }

  return decomposed;
}

/**
 * Evaluates a single atomic JD skill against a candidate's profile signals.
 * Prioritizes JD-specific skills over generic keywords in resume text.
 * Returns a credit score in [0, 1] and whether it counts as matched/evidenced.
 */
function evaluateSingleSkillMatch(
  reqSkill: string,
  candidateSignals: ReturnType<typeof extractCandidateProfileSignals>
): { credit: number; matchedLabel: string | null } {
  const normReq = normalizeText(reqSkill);
  if (!normReq) return { credit: 0, matchedLabel: null };

  const isCompoundReq = normReq.split(' ').filter(Boolean).length >= 2;

  // 1. Exact or specific match against candidate's explicit or inferred skills
  for (const cSkill of candidateSignals.allSkills) {
    const normCand = normalizeText(cSkill);
    if (!normCand) continue;
    if (normCand === normReq) {
      return { credit: 1.0, matchedLabel: reqSkill };
    }
    // Candidate has a specific title or skill that contains the full JD skill
    // e.g., candidate has "Senior Oracle Fusion Developer" -> contains "oracle fusion"
    if (normReq.length >= 3 && normCand.includes(normReq)) {
      return { credit: 0.94, matchedLabel: reqSkill };
    }
    // Requirement contains candidate skill: ONLY allow if candidate skill is NOT just a generic single atom
    // e.g., candidate having "oracle" must NEVER be credited as matching "oracle fusion"
    if (normCand.length >= 3 && normReq.includes(normCand)) {
      if (isCompoundReq) {
        // If requirement is compound, a shorter candidate skill must match almost the full phrase (>= 80% length)
        if (normCand.length >= normReq.length * 0.8) {
          return { credit: 0.85, matchedLabel: reqSkill };
        }
        // Otherwise it's only a single sub-token/keyword, NOT a verified match
      } else {
        return { credit: 0.94, matchedLabel: reqSkill };
      }
    }
  }

  // 2. Direct phrase presence in candidate's full resume corpus with exact word boundaries
  if (normReq.length >= 3) {
    const escapedReq = normReq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const phraseRegex = new RegExp(`\\b${escapedReq}\\b`, 'i');
    if (phraseRegex.test(candidateSignals.corpusText)) {
      return { credit: 0.95, matchedLabel: reqSkill };
    }
  }

  // 3. Domain synonym & ecosystem cluster equivalence
  for (const cluster of SKILL_SYNONYM_CLUSTERS) {
    const matchesTrigger = cluster.triggers.some((rx) => rx.test(reqSkill));
    if (matchesTrigger) {
      const hasStrong = cluster.strongEquivalents.some((rx) =>
        rx.test(candidateSignals.corpusText)
      );
      if (hasStrong) {
        return { credit: 0.86, matchedLabel: reqSkill };
      }
      const hasPartial = cluster.partialEquivalents.some((rx) =>
        rx.test(candidateSignals.corpusText)
      );
      if (hasPartial) {
        // Partial synonym alone is an adjacent signal; do NOT mark as fully verified match
        return { credit: 0.35, matchedLabel: null };
      }
    }
  }

  // 4. Token-level overlap (e.g., "Azure AI Search" vs candidate having "Azure" or "AI")
  const reqTokens = normReq
    .split(' ')
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  if (reqTokens.length > 0) {
    let matchedTokenCount = 0;
    for (const token of reqTokens) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tokenRegex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (tokenRegex.test(candidateSignals.corpusText)) {
        matchedTokenCount += 1;
      }
    }
    if (matchedTokenCount > 0) {
      const ratio = matchedTokenCount / reqTokens.length;
      if (isCompoundReq) {
        // Compound skills (e.g., "Oracle Fusion", "VBCS Developer") require high token overlap (>= 75%)
        // Having only "Oracle" for "Oracle Fusion" gives ratio 0.5 -> weak credit, NOT a matched skill
        if (ratio >= 0.75) {
          const credit = Math.min(0.80, 0.50 + ratio * 0.30);
          return { credit, matchedLabel: reqSkill };
        } else {
          // Low overlap single-word keyword occurrence: low credit, NEVER marked as matched
          return { credit: Math.min(0.20, ratio * 0.30), matchedLabel: null };
        }
      } else {
        const credit = Math.min(0.85, 0.45 + ratio * 0.45);
        return { credit, matchedLabel: credit >= 0.60 ? reqSkill : null };
      }
    }
  }

  return { credit: 0, matchedLabel: null };
}

/**
 * Dimension 2: Experience Match Score (E, 0–100, Weight 25%)
 */
function computeExperienceScoreAndNote(
  candidateYears: number | null | undefined,
  minYears: number | null | undefined,
  maxYears: number | null | undefined
): { score: number; note: string } {
  const cYears = Number(candidateYears ?? 0);
  const reqMin = Number(minYears ?? 0);
  const reqMax = maxYears !== null && maxYears !== undefined ? Number(maxYears) : null;

  if (reqMin <= 0 && (reqMax === null || reqMax <= 0)) {
    return {
      score: cYears > 0 ? 90 : 75,
      note: `${cYears.toFixed(1)} yrs experience`,
    };
  }

  if (cYears >= reqMin && (reqMax === null || cYears <= reqMax)) {
    return {
      score: 100,
      note: `${cYears.toFixed(1)} yrs within target (${reqMin.toFixed(1)}–${(reqMax ?? reqMin + 5).toFixed(1)} yrs)`,
    };
  }

  if (cYears < reqMin) {
    const deficit = reqMin - cYears;
    const ratio = reqMin > 0 ? Math.max(0, cYears / reqMin) : 0;
    const score = Math.round(Math.max(20, Math.min(95, ratio * 85 + (deficit <= 1.5 ? 10 : 0))));
    return {
      score,
      note: `${cYears.toFixed(1)} yrs vs minimum ${reqMin.toFixed(1)} yrs`,
    };
  }

  const overage = reqMax !== null ? cYears - reqMax : 0;
  const score = Math.round(Math.max(75, 100 - overage * 4));
  return {
    score,
    note: `${cYears.toFixed(1)} yrs (exceeds ${reqMax?.toFixed(1)} yrs range)`,
  };
}

/**
 * Dimension 3: Domain Match Score (D, 0–100, Weight 20%)
 * Evaluates industry, business domain, and project relevance between JD and Candidate Resume.
 */
function computeDomainMatchScore(
  requirement: Pick<Requirement, 'title' | 'description' | 'skills'>,
  candidateSignals: ReturnType<typeof extractCandidateProfileSignals>
): { score: number; matchedDomains: string[] } {
  // Domain comes from the criteria entered on the requirement (title + defined skills), not free-text noise.
  const jdCorpus = `${requirement.title || ''} ${(requirement.skills || []).join(' ')}`.toLowerCase();

  const reqDomains = DOMAIN_CLUSTERS.filter((cluster) =>
    cluster.patterns.some((rx) => rx.test(jdCorpus))
  );
  const candDomains = new Set(
    DOMAIN_CLUSTERS.filter((cluster) =>
      cluster.patterns.some((rx) => rx.test(candidateSignals.corpusText))
    ).map((c) => c.id)
  );

  if (reqDomains.length === 0) {
    return { score: 75, matchedDomains: [] };
  }

  let domainCredits = 0;
  const matchedDomains: string[] = [];

  for (const reqDom of reqDomains) {
    if (candDomains.has(reqDom.id)) {
      domainCredits += 1.0;
      matchedDomains.push(reqDom.name);
    } else if (reqDom.adjacentDomains.some((adj) => candDomains.has(adj))) {
      domainCredits += 0.65;
      matchedDomains.push(`${reqDom.name} (Adjacent)`);
    } else {
      domainCredits += 0.2;
    }
  }

  // Also check JD title keyword overlap in candidate corpus
  const jdTitleTokens = normalizeText(requirement.title || '')
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  let titleHits = 0;
  for (const token of jdTitleTokens) {
    if (candidateSignals.corpusText.includes(token)) {
      titleHits += 1;
    }
  }
  const titleBonus = jdTitleTokens.length > 0 ? (titleHits / jdTitleTokens.length) * 15 : 0;

  const rawScore = (domainCredits / reqDomains.length) * 88 + titleBonus;
  return {
    score: Math.round(Math.max(20, Math.min(100, rawScore))),
    matchedDomains,
  };
}

/**
 * Dimension 4: Seniority Match Score (N, 0–100, Weight 15%)
 * Evaluates role level, responsibility, and seniority alignment.
 */
function inferSeniorityTier(
  text: string,
  years: number | null | undefined
): { tier: number; label: string } {
  const lower = text.toLowerCase();
  const y = Number(years ?? 0);

  if (/\b(architect|principal|staff|director|vp|head|chief)\b/.test(lower) || y >= 10) {
    return { tier: 4, label: 'Architect / Principal' };
  }
  if (/\b(lead|senior|sr\.?|specialist|manager)\b/.test(lower) || y >= 6) {
    return { tier: 3, label: 'Senior / Lead / Specialist' };
  }
  if (/\b(junior|jr\.?|associate|intern|trainee|entry)\b/.test(lower) && y < 3) {
    return { tier: 1, label: 'Junior / Associate' };
  }
  return { tier: 2, label: 'Mid-Level Engineer / Consultant' };
}

function computeSeniorityMatchScore(
  requirement: Pick<Requirement, 'title' | 'description'> & {
    min_experience?: number | null;
    max_experience?: number | null;
  },
  candidate: Candidate
): { score: number; label: string } {
  const reqTargetYears =
    requirement.min_experience !== null && requirement.min_experience !== undefined
      ? Number(requirement.min_experience)
      : 4;
  const jdSeniority = inferSeniorityTier(
    `${requirement.title || ''} ${requirement.description || ''}`,
    reqTargetYears
  );
  const candSeniority = inferSeniorityTier(
    `${candidate.current_title || ''} ${candidate.summary || ''}`,
    candidate.total_experience_years
  );

  const tierDiff = Math.abs(jdSeniority.tier - candSeniority.tier);
  let score = 80;
  if (tierDiff === 0) {
    score = 95;
  } else if (tierDiff === 1) {
    // Candidate 1 tier above or below target
    score = candSeniority.tier > jdSeniority.tier ? 88 : 78;
  } else if (tierDiff === 2) {
    score = 58;
  } else {
    score = 40;
  }

  // Refine with experience proximity to target range
  const cYears = Number(candidate.total_experience_years ?? 0);
  if (reqTargetYears > 0) {
    if (cYears >= reqTargetYears) {
      score = Math.min(100, score + 5);
    } else if (reqTargetYears - cYears <= 1.5) {
      score = Math.max(70, score - 4);
    } else if (reqTargetYears - cYears > 3) {
      score = Math.max(35, score - 12);
    }
  }

  return {
    score: Math.round(Math.max(25, Math.min(100, score))),
    label: candSeniority.label,
  };
}

export interface DimensionBreakdown {
  skills: { score: number; weight: 0.4; contribution: number };
  experience: { score: number; weight: 0.25; contribution: number };
  domain: { score: number; weight: 0.2; contribution: number };
  seniority: { score: number; weight: 0.15; contribution: number };
}

export interface FineTunedMatchResult {
  skill_score: number;
  experience_score: number;
  domain_score: number;
  seniority_score: number;
  computed_score: number;
  final_score: number;
  matched_skills: string[];
  unproven_skills: string[];
  experience_note: string;
  eligibility_note?: string;
  role_alignment?: number;
  dimensions: DimensionBreakdown;
}


const ROLE_NOISE = new Set([
  'senior','sr','lead','junior','jr','principal','staff','associate','manager','head','specialist',
  'consultant','executive','officer','engineer','developer','analyst','architect','and','the','of','for',
]);

/** Role alignment (0-100): requirement title vs the candidate's role evidence (title, summary, parsed resume). */
function computeRoleAlignment(
  requirement: { title?: string | null },
  candidate: Candidate,
  corpus: string
): number {
  const reqTokens = normalizeText(requirement.title || '')
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t) && !ROLE_NOISE.has(t));
  const titleText = normalizeText(candidate.current_title || '');
  // Same role family (e.g. developer vs developer) is itself evidence.
  const familyOf = (t: string) =>
    /(developer|programmer|engineer|architect|devops|sre|tester|qa)/.test(t) ? 'tech' :
    /(sales|business development|account executive)/.test(t) ? 'sales' :
    /(account|finance|audit|tax)/.test(t) ? 'finance' :
    /(hr|recruit|talent|payroll)/.test(t) ? 'hr' :
    /(market|seo|content|brand)/.test(t) ? 'marketing' :
    /(support|service|bpo|voice)/.test(t) ? 'support' : '';
  const sameFamily =
    familyOf(normalizeText(requirement.title || '')) !== '' &&
    familyOf(normalizeText(requirement.title || '')) === familyOf(titleText);
  if (reqTokens.length === 0) return sameFamily ? 80 : 60;
  const inTitle = reqTokens.filter((t) => titleText.includes(t)).length;
  const inCorpus = reqTokens.filter((t) => corpus.includes(t)).length;
  const raw = (inTitle / reqTokens.length) * 70 + (inCorpus / reqTokens.length) * 30 + (sameFamily ? 25 : 0);
  return Math.round(Math.max(0, Math.min(100, raw)));
}

function computeEligibilityDeduction(
  requirement: { location?: string | null; work_mode?: string | null },
  candidate: Candidate
): { deduction: number; note: string } {
  const mode = String(requirement.work_mode || '').toLowerCase();
  if (mode !== 'onsite' && mode !== 'hybrid') return { deduction: 0, note: '' };
  const reqLoc = normalizeText(requirement.location || '');
  const candLoc = normalizeText(candidate.location || '');
  if (!reqLoc || !candLoc || reqLoc === 'remote') return { deduction: 0, note: '' };
  const reqTokens = reqLoc.split(' ').filter((t) => t.length >= 3);
  const overlaps = reqTokens.some((t) => candLoc.includes(t));
  return overlaps
    ? { deduction: 0, note: '' }
    : { deduction: 6, note: `Location differs (${candidate.location} vs ${requirement.location}, ${mode}).` };
}

/**
 * 4-Dimension Weighted Matching Engine:
 *   Match Score = 0.40 * S + 0.25 * E + 0.20 * D + 0.15 * N
 * Where:
 *   S = Skills match score out of 100 (40%)
 *   E = Experience match score out of 100 (25%)
 *   D = Domain match score out of 100 (20%)
 *   N = Seniority match score out of 100 (15%)
 */
export function computeFineTunedCandidateMatch(
  requirement: Pick<Requirement, 'id' | 'title' | 'description' | 'skills'> & {
    min_experience?: number | null;
    max_experience?: number | null;
    min_experience_years?: number | null;
    max_experience_years?: number | null;
    location?: string | null;
    work_mode?: string | null;
  },
  candidate: Candidate,
  existingMatch?: Partial<CandidateMatch> | null
): FineTunedMatchResult {
  const atomicReqSkills = extractRequirementAtomicSkills(requirement);
  const candidateSignals = extractCandidateProfileSignals(candidate);

  const matchedSkills: string[] = [];
  const unprovenSkills: string[] = [];
  let totalSkillCredit = 0;

  for (const reqSkill of atomicReqSkills) {
    const { credit, matchedLabel } = evaluateSingleSkillMatch(reqSkill, candidateSignals);
    totalSkillCredit += credit;
    if (matchedLabel && credit >= 0.5) {
      matchedSkills.push(matchedLabel);
    } else {
      unprovenSkills.push(reqSkill);
    }
  }

  // 1. S = Skills Match Score (0–100, Weight 40%): coverage of the skills defined on the
  // requirement, evidenced in the resume. Unproven skills are listed for the senior
  // recruiter to verify; they are not hidden or double-penalised.
  const skillScore = Math.round(
    Math.max(
      0,
      Math.min(100, atomicReqSkills.length > 0 ? (totalSkillCredit / atomicReqSkills.length) * 100 : 50)
    )
  );

  // 2. E = Experience Match Score (0–100, Weight 25%)
  const minExp = requirement.min_experience ?? requirement.min_experience_years ?? 0;
  const maxExp = requirement.max_experience ?? requirement.max_experience_years ?? null;
  const { score: experienceScore, note: experienceNote } = computeExperienceScoreAndNote(
    candidate.total_experience_years,
    minExp,
    maxExp
  );

  // 3. D = Domain Match Score (0–100, Weight 20%)
  const { score: clusterDomainScore } = computeDomainMatchScore(requirement, candidateSignals);
  const roleAlignment = computeRoleAlignment(requirement, candidate, candidateSignals.corpusText);
  const domainScore = Math.round(clusterDomainScore * 0.6 + roleAlignment * 0.4);

  // 4. N = Seniority Match Score (0–100, Weight 15%)
  const { score: seniorityScore } = computeSeniorityMatchScore(
    {
      title: requirement.title,
      description: requirement.description,
      min_experience: minExp,
      max_experience: maxExp,
    },
    candidate
  );

  // Contributions: 0.40*S + 0.25*E + 0.20*D + 0.15*N
  const skillsContribution = Number((skillScore * 0.4).toFixed(2));
  const experienceContribution = Number((experienceScore * 0.25).toFixed(2));
  const domainContribution = Number((domainScore * 0.2).toFixed(2));
  const seniorityContribution = Number((seniorityScore * 0.15).toFixed(2));

  const weightedScore = Math.max(
    0,
    Math.min(
      100,
      skillsContribution + experienceContribution + domainContribution + seniorityContribution
    )
  );
  // Skill coverage gates the overall score: weak coverage of the defined skills cannot be
  // rescued by experience/seniority alone.
  let cappedScore = Math.min(weightedScore, 35 + skillScore * 0.65);

  // Strict JD Skill Verification Guard:
  // Prioritizes JD-specific skills over generic resume keywords.
  // Weak coverage of the defined JD skills cannot be inflated by generic resume history.
  if (atomicReqSkills.length > 0) {
    const verifiedRatio = matchedSkills.length / atomicReqSkills.length;
    if (verifiedRatio < 0.5) {
      // E.g., if candidate has 0 or few verified JD skills, strictly cap the match score
      // so candidates lacking core requirements (e.g. Oracle Fusion / VBCS) cannot get 70-85%.
      const jdSkillCap = Math.max(25, Math.round(verifiedRatio * 60 + 15));
      cappedScore = Math.min(cappedScore, jdSkillCap);
    }
  }
  // An IT candidate must not surface for a non-IT requirement (or vice versa) unless the
  // defined skills are mostly covered.
  const reqCategory = classifyRequirement({
    title: requirement.title,
    skills: requirement.skills,
    description: requirement.description,
  });
  const candCategory = classifyRequirement({
    title: candidate.current_title,
    skills: Array.isArray(candidate.skills) ? candidate.skills : [],
  });
  if (reqCategory !== candCategory && skillScore < 60) {
    cappedScore = Math.min(cappedScore, 45);
  }
  const eligibility = computeEligibilityDeduction(requirement, candidate);
  const computedScore = Math.round(Math.max(0, cappedScore - eligibility.deduction));

  const overrideScore =
    existingMatch?.override_score !== undefined ? existingMatch.override_score : null;
  const finalScore =
    overrideScore !== null && overrideScore !== undefined ? overrideScore : computedScore;

  return {
    skill_score: skillScore,
    experience_score: experienceScore,
    domain_score: domainScore,
    seniority_score: seniorityScore,
    computed_score: computedScore,
    final_score: finalScore,
    matched_skills: matchedSkills,
    unproven_skills: unprovenSkills,
    experience_note: experienceNote,
    eligibility_note: eligibility.note || undefined,
    role_alignment: roleAlignment,
    dimensions: {
      skills: { score: skillScore, weight: 0.4, contribution: skillsContribution },
      experience: { score: experienceScore, weight: 0.25, contribution: experienceContribution },
      domain: { score: domainScore, weight: 0.2, contribution: domainContribution },
      seniority: { score: seniorityScore, weight: 0.15, contribution: seniorityContribution },
    },
  };
}
