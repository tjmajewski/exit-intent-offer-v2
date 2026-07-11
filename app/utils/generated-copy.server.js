// =============================================================================
// GENERATIVE COPY REFRESH (build plan phase 7c)
//
// The hand-written gene pools (3-6 options per slot) are the quality ceiling
// on "learn the best message" — evolution can only shuffle what a human
// wrote in January. A monthly cron asks Claude for fresh candidate copy per
// archetype, every candidate passes the same brand-safety rails as
// hand-written copy, survivors are stored as a per-baseline candidate pool,
// and the mutation operator occasionally draws from it. Generated copy earns
// traffic ONLY by winning Thompson draws — no special treatment.
//
// Kill switch: GENERATED_COPY_ENABLED !== '1' disables generation AND
// injection (existing generated variants keep serving; the serve-time guard
// below still recognizes their copy so they aren't swapped to fallbacks).
// =============================================================================

import { hasBannedClaim } from './gene-pools.js';

export const GENERATED_COPY_INSIGHT_TYPE = 'generated_copy';

// Fraction of MUTATIONS (not variants) that draw from the generated pool
// when one exists. Net exploration ≈ mutationRate (15%) × this ≈ 4.5% per
// gene per bred variant — the "≤10% of exploration budget" cap from the plan.
export const GENERATED_MUTATION_SHARE = 0.3;

const FIELD_LIMITS = { headline: 70, subhead: 110, cta: 28 };
const FRESHNESS_DAYS = 60; // stale pools stop being served/injected

export function generationEnabled() {
  return process.env.GENERATED_COPY_ENABLED === '1';
}

/**
 * Brand-safety validation for one generated candidate. Same bar as
 * hand-written pool copy, plus placeholder discipline:
 *  - only {{amount}} is ever allowed (social-proof placeholders are gated by
 *    shop qualification and must never enter via generation)
 *  - no-discount baselines allow NO placeholders at all
 * Pure function — unit-tested in scripts/dev/test-generated-copy.mjs.
 */
export function validateCandidate(baseline, field, text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length === 0 || t.length > (FIELD_LIMITS[field] || 70)) return false;

  // Placeholder discipline
  const placeholders = t.match(/\{\{[^}]*\}\}/g) || [];
  const discountBaseline = baseline.includes('with_discount');
  for (const ph of placeholders) {
    if (ph !== '{{amount}}') return false;
    if (!discountBaseline) return false;
    if (field === 'cta') return false; // CTAs never carry placeholders
  }

  // Tone rails: no shouting, at most one exclamation mark
  if ((t.match(/!/g) || []).length > 1) return false;
  const letters = t.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 8) {
    const upper = letters.replace(/[^A-Z]/g, '').length;
    if (upper / letters.length > 0.6) return false;
  }

  // Archetype banned-claim list (same guard the serve path uses)
  if (hasBannedClaim(baseline, t)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Serve/breed-time loader (10-min cache)
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = new Map();

export function clearGeneratedCopyCache() {
  cache = new Map();
}

/** @returns {{ headlines:string[], subheads:string[], ctas:string[] } | null} */
export async function getGeneratedCopy(db, baseline) {
  const hit = cache.get(baseline);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.value;

  let value = null;
  try {
    const row = await db.metaLearningInsights.findFirst({
      where: { insightType: GENERATED_COPY_INSIGHT_TYPE, segment: baseline },
      orderBy: { lastUpdated: 'desc' }
    });
    if (row && Date.now() - row.lastUpdated.getTime() < FRESHNESS_DAYS * 24 * 60 * 60 * 1000) {
      const parsed = JSON.parse(row.data);
      if (Array.isArray(parsed.headlines)) value = parsed;
    }
  } catch (e) {
    console.error(`[Generated Copy] Load failed (${baseline}):`, e.message);
  }
  if (cache.size > 100) cache = new Map();
  cache.set(baseline, { value, fetchedAt: Date.now() });
  return value;
}

/**
 * Serve-time guard helper: is this text a known generated candidate for the
 * baseline? The endpoint's brand-safety clamp swaps any copy that isn't in
 * the static pools — generated copy must be recognized or it would be
 * swapped to a fallback the moment it's served.
 */
export async function isGeneratedCopy(db, baseline, field, text) {
  const pool = await getGeneratedCopy(db, baseline);
  if (!pool) return false;
  const list = field === 'headline' ? pool.headlines
    : field === 'subhead' ? pool.subheads
    : field === 'cta' ? pool.ctas
    : null;
  return Array.isArray(list) && list.includes(text);
}

/**
 * Mutation hook for the variant engine: maybe swap a freshly-mutated gene
 * for a generated candidate. Returns the candidate or null (keep the static
 * pool's pick). Only fires when generation is enabled and a fresh pool
 * exists.
 */
export async function maybeGeneratedGene(db, baseline, field) {
  if (!generationEnabled()) return null;
  if (Math.random() >= GENERATED_MUTATION_SHARE) return null;
  const pool = await getGeneratedCopy(db, baseline);
  const list = field === 'headline' ? pool?.headlines
    : field === 'subhead' ? pool?.subheads
    : field === 'cta' ? pool?.ctas
    : null;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}
