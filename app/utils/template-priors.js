// 3-level hierarchical template posterior (Sprint 3).
//
// templateId is a bandit gene, but a flat per-variant beta posterior is data-
// starved: each variant only carries one templateId, so a brand-new variant
// with a great layout looks identical to one with a poor layout until it
// accumulates its own impressions. This module pools template performance
// across the store and blends it with cross-store meta-learning, then nudges
// Thompson Sampling toward layouts that win — the same "tilt, don't force"
// shape as archetype-priors.js.
//
// Three levels, most specific first:
//   1. archetype-specific — this shop, this archetype (baseline), per template.
//   2. store-level pooled  — this shop, ALL archetypes pooled, per template.
//   3. cross-store meta     — MetaLearningGene(baseline, 'templateId'), per template.
//
// Weights anneal with sample count via cascading shrinkage: meta seeds the
// store estimate, the store estimate seeds the archetype estimate. As a level
// accumulates its own impressions it relies less on the level above. With zero
// own data the score is driven entirely by meta (or a global default), so a
// cold-start shop still benefits from the network without over-committing.

// Lookback for own-shop impressions.
const WINDOW_DAYS = 30;

// Pseudo-count (strength) of each prior level when shrinking the level below.
// Higher = the prior dominates longer before own data takes over. Tuned
// conservatively so a few dozen own impressions are enough to move the needle.
const META_PSEUDO = 40;   // strength of meta prior on the store estimate
const STORE_PSEUDO = 60;  // strength of store estimate on the archetype estimate

// Fallback CVR when there's no meta signal at all (keeps the math well-defined;
// only matters in absolute terms, ranking is unaffected when it's uniform).
const GLOBAL_DEFAULT_CVR = 0.08;

// Don't bias on noise: need at least this many pooled own-shop template
// impressions OR any meta signal before we tilt sampling.
const MIN_STORE_IMPRESSIONS = 30;

// Multiplier shape (mirrors archetype-priors): best template gets MAX_BOOST,
// worst gets MIN_BOOST, interior ranks linear. Intentionally gentle.
const MAX_BOOST = 1.25;
const MIN_BOOST = 0.88;

/**
 * Compute templateId → multiplier map for the current decision.
 *
 * @param {object} prisma
 * @param {string} shopId
 * @param {object} ctx
 *   baseline       the variant baseline being sampled (archetype key); used for
 *                  the archetype level + the meta lookup.
 *   archetypeName  denormalized archetype name as stored on VariantImpression
 *                  (matches impression.archetype). Falls back to baseline.
 * @returns {Promise<{ priors: Map<string, number>, source: string }>}
 *   source ∈ 'hierarchical' | 'none'
 */
export async function computeTemplatePriors(prisma, shopId, ctx = {}) {
  const { baseline = null, archetypeName = null } = ctx;
  const archKey = archetypeName || baseline;

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // ---- Levels 1 + 2: own-shop impressions, joined to variant.templateId ----
  const rows = await prisma.variantImpression.findMany({
    where: { shopId, timestamp: { gte: since } },
    select: {
      converted: true,
      archetype: true,
      variant: { select: { templateId: true } }
    }
  });

  const store = new Map(); // templateId → { i, c }  (pooled across archetypes)
  const arch = new Map();  // templateId → { i, c }  (this archetype only)
  let storeTotal = 0;

  for (const r of rows) {
    const tid = r.variant?.templateId;
    if (!tid) continue;
    bump(store, tid, r.converted);
    storeTotal += 1;
    if (archKey && r.archetype === archKey) bump(arch, tid, r.converted);
  }

  // ---- Level 3: cross-store meta-learning for this baseline ----
  const meta = new Map(); // templateId → { rate, n }
  if (baseline) {
    const metaRows = await prisma.metaLearningGene.findMany({
      where: { baseline, geneType: 'templateId' },
      select: { geneValue: true, avgCVR: true, totalImpressions: true }
    });
    for (const m of metaRows) {
      if (!m.geneValue) continue;
      meta.set(m.geneValue, {
        rate: typeof m.avgCVR === 'number' ? m.avgCVR : GLOBAL_DEFAULT_CVR,
        n: m.totalImpressions || 0
      });
    }
  }

  // Nothing to go on — stay uniform.
  if (storeTotal < MIN_STORE_IMPRESSIONS && meta.size === 0) {
    return { priors: new Map(), source: 'none' };
  }

  // Candidate templates = anything we have a signal for at any level.
  const templates = new Set([...store.keys(), ...meta.keys()]);
  if (templates.size < 2) {
    return { priors: new Map(), source: 'none' };
  }

  // Cascading shrinkage: meta → store → archetype.
  const scored = [];
  for (const tid of templates) {
    const metaRate = meta.has(tid) ? meta.get(tid).rate : GLOBAL_DEFAULT_CVR;

    const s = store.get(tid) || { i: 0, c: 0 };
    const storeRate = (s.c + META_PSEUDO * metaRate) / (s.i + META_PSEUDO);

    const a = arch.get(tid) || { i: 0, c: 0 };
    const archRate = (a.c + STORE_PSEUDO * storeRate) / (a.i + STORE_PSEUDO);

    scored.push({ templateId: tid, score: archRate });
  }

  scored.sort((x, y) => y.score - x.score);
  return { priors: scoredToPriors(scored), source: 'hierarchical' };
}

function bump(map, key, converted) {
  if (!map.has(key)) map.set(key, { i: 0, c: 0 });
  const b = map.get(key);
  b.i += 1;
  if (converted) b.c += 1;
}

/**
 * Convert a sorted [{ templateId, score }] array (highest first) into a
 * multiplier map. Rank 0 = MAX_BOOST, rank (n-1) = MIN_BOOST, linear interior.
 */
function scoredToPriors(scored) {
  const priors = new Map();
  const n = scored.length;
  if (n === 0) return priors;
  if (n === 1) {
    priors.set(scored[0].templateId, MAX_BOOST);
    return priors;
  }
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    priors.set(scored[i].templateId, MAX_BOOST - t * (MAX_BOOST - MIN_BOOST));
  }
  return priors;
}

/**
 * Look up a template's multiplier. Missing template → neutral 1.0 so variants
 * with an un-ranked layout aren't penalized.
 */
export function getTemplateMultiplier(priors, templateId) {
  if (!priors || !templateId) return 1.0;
  const m = priors.get(templateId);
  return typeof m === 'number' ? m : 1.0;
}
