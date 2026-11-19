import { parseRequirementMeta } from './enterpriseLifecycle';
import { hasBgvRequired } from '../components/domain/RequirementRibbon';

export const DEFAULT_BASIC_BGV_CHECKS: string[] = [
  'Employment History Check',
  'Police Clearance Certificate (PCC)',
];

export const STANDARD_BGV_SUGGESTIONS: string[] = [
  'Employment History Check',
  'Police Clearance Certificate (PCC)',
  'Education Verification',
  'Criminal Background Check',
  'Identity Verification (Aadhaar / Passport)',
  'Address Verification',
  'Drug Screening / Medical Check',
  'Credit & Financial Check',
  'Reference Checks (Past Employers)',
  'Verified In-House Bench Resource Status',
  'Previous 5 Years Form 16 / ITR Verification',
  'Global Sanctions & Watchlist Screening',
];

const STORAGE_KEY = 'hirenest_saved_bgv_suggestions';

/**
 * Returns all BGV suggestions: standard built-in plus any custom items
 * previously saved by the user in this browser.
 */
export function getSavedBgvSuggestions(): string[] {
  const set = new Set<string>(STANDARD_BGV_SUGGESTIONS);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((item) => {
            if (typeof item === 'string' && item.trim()) {
              set.add(item.trim());
            }
          });
        }
      }
    }
  } catch {
    // ignore localStorage errors
  }
  return Array.from(set);
}

/**
 * Persists a new or custom BGV check so it always appears in the dropdown
 * and suggestions for all future requirements.
 */
export function saveBgvSuggestion(newCheck: string): void {
  const trimmed = newCheck?.trim();
  if (!trimmed) return;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const current = getSavedBgvSuggestions();
      if (!current.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
        current.push(trimmed);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      }
    }
  } catch {
    // ignore localStorage errors
  }
}

/**
 * Resolves the list of required BGV checks for a requirement.
 * If checks are explicitly configured, returns them.
 * If BGV is required (by flag or JD inference) but no explicit checks are saved,
 * returns the basic default checks: Employment History Check & PCC.
 */
export function getRequirementBgvChecks(reqOrMeta?: any): string[] {
  if (!reqOrMeta) return [];

  // If already parsed meta object
  if (Array.isArray(reqOrMeta.bgvChecks) && reqOrMeta.bgvChecks.length > 0) {
    return reqOrMeta.bgvChecks;
  }

  // Parse meta from requirement object or currency string
  const meta = parseRequirementMeta(reqOrMeta);
  if (Array.isArray(meta.bgvChecks) && meta.bgvChecks.length > 0) {
    return meta.bgvChecks;
  }

  // Check if requirement has BGV required flag or inferred from description
  const isRequired = meta.hasBgv ?? hasBgvRequired(reqOrMeta);
  if (isRequired) {
    return [...DEFAULT_BASIC_BGV_CHECKS];
  }

  return [];
}

/**
 * Formats a short badge label for the BGV check (e.g. for sidebar or ribbon).
 * Short abbreviations for common checks, or clean count.
 */
export function formatBgvSummary(checks: string[]): string {
  if (!checks || checks.length === 0) return 'Required';

  const abbrMap: Record<string, string> = {
    'police clearance certificate (pcc)': 'PCC',
    'employment history check': 'Emp',
    'education verification': 'Edu',
    'identity verification (aadhaar / passport)': 'ID',
    'address verification': 'Addr',
    'drug screening / medical check': 'Drug/Med',
    'credit & financial check': 'Credit',
    'criminal background check': 'Criminal',
    'verified in-house bench resource status': 'Bench',
  };

  const parts = checks.map((c) => {
    const key = c.toLowerCase().trim();
    if (abbrMap[key]) return abbrMap[key];
    if (key.includes('pcc') || key.includes('police')) return 'PCC';
    if (key.includes('employ')) return 'Emp';
    if (key.includes('educat')) return 'Edu';
    if (key.includes('ident') || key.includes('aadhaar') || key.includes('passport')) return 'ID';
    if (key.includes('drug') || key.includes('medic')) return 'Med';
    if (key.includes('crim')) return 'Crim';
    // Truncate long custom check names to 10 chars
    return c.length > 10 ? c.slice(0, 9) + '…' : c;
  });

  if (parts.length <= 3) {
    return `Mandatory (${parts.join(' + ')})`;
  }
  return `Mandatory (${parts.slice(0, 2).join(' + ')} +${parts.length - 2})`;
}
