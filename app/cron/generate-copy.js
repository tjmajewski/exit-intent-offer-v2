// Generative Copy Refresh Cron (monthly) — build plan phase 7c
//
// Asks Claude for fresh candidate copy per archetype, validates every
// candidate through the same brand-safety rails as hand-written pool copy
// (validateCandidate: length, placeholder discipline, tone, banned-claim
// regexes), and stores survivors as a per-baseline candidate pool in
// MetaLearningInsights. The variant engine's mutation operator draws from
// this pool for a bounded share of mutations — generated copy earns traffic
// only by winning Thompson draws.
//
// Requires: GENERATED_COPY_ENABLED=1 and ANTHROPIC_API_KEY. Without either,
// exits without calling the API (kill switch).

import db from '../db.server.js';
import { genePools, getAllBaselines } from '../utils/gene-pools.js';
import {
  validateCandidate, generationEnabled, GENERATED_COPY_INSIGHT_TYPE
} from '../utils/generated-copy.server.js';
import { writeClusterInsight } from '../utils/cluster-priors.server.js';

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 2000;

function buildPrompt(baseline, pool) {
  const discount = baseline.includes('with_discount');
  return `You are writing exit-intent popup copy for e-commerce cart recovery.

Archetype: ${pool.archetypeName} (baseline: ${baseline})
Existing winning examples (match their intent and energy, do NOT copy them):
- Headlines: ${JSON.stringify(pool.headlines.slice(0, 4))}
- Subheads: ${JSON.stringify(pool.subheads.slice(0, 4))}
- CTAs: ${JSON.stringify(pool.ctas.slice(0, 4))}

Rules (violations are discarded automatically):
- Headlines <= 70 characters, subheads <= 110, CTAs <= 28
- ${discount
    ? 'Use the literal placeholder {{amount}} where the discount number goes (e.g. "Take {{amount}}% off"). CTAs must NOT contain placeholders.'
    : 'NO placeholders of any kind — this archetype makes no discount offer.'}
- Never promise free shipping, product recommendations, or anything the popup cannot deliver
- Never invent statistics, customer counts, or reviews
- At most one exclamation mark per line; no all-caps shouting
- Plain, confident, brand-neutral e-commerce voice

Return STRICT JSON only, no markdown fences, exactly this shape:
{"headlines": [10 strings], "subheads": [10 strings], "ctas": [5 strings]}`;
}

async function generateForBaseline(baseline) {
  const pool = genePools[baseline];
  if (!pool?.archetypeName) return null;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: buildPrompt(baseline, pool) }]
    })
  });
  if (!resp.ok) {
    throw new Error(`Anthropic API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = (data?.content?.[0]?.text || '').replace(/^```(json)?|```$/gm, '').trim();
  const parsed = JSON.parse(text);

  // Validate every candidate through the brand-safety rails; dedupe against
  // the static pools so we don't store copies of hand-written genes.
  const staticSet = new Set([
    ...(pool.headlines || []), ...(pool.subheads || []), ...(pool.ctas || [])
  ]);
  const clean = (list, field) => [...new Set(list || [])]
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t && !staticSet.has(t) && validateCandidate(baseline, field, t));

  const result = {
    headlines: clean(parsed.headlines, 'headline'),
    subheads: clean(parsed.subheads, 'subhead'),
    ctas: clean(parsed.ctas, 'cta'),
    model: MODEL,
    generatedAt: new Date().toISOString()
  };
  const kept = result.headlines.length + result.subheads.length + result.ctas.length;
  const offered = (parsed.headlines?.length || 0) + (parsed.subheads?.length || 0) + (parsed.ctas?.length || 0);
  console.log(` ${baseline}: kept ${kept}/${offered} candidates after validation`);
  return kept > 0 ? result : null;
}

export async function generateCopy() {
  console.log('\n [Generated Copy] Starting monthly refresh...');
  console.log('='.repeat(80));

  if (!generationEnabled()) {
    console.log(' GENERATED_COPY_ENABLED != 1 — kill switch active, exiting.');
    return { generated: 0, skipped: 'disabled' };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(' ANTHROPIC_API_KEY missing — exiting.');
    return { generated: 0, skipped: 'no_api_key' };
  }

  let stored = 0;
  for (const baseline of getAllBaselines()) {
    try {
      const result = await generateForBaseline(baseline);
      if (result) {
        await writeClusterInsight(
          db, GENERATED_COPY_INSIGHT_TYPE, baseline, result,
          result.headlines.length + result.subheads.length + result.ctas.length,
          0.5
        );
        stored++;
      }
    } catch (e) {
      console.error(` ${baseline}: generation failed —`, e.message);
    }
  }

  console.log('='.repeat(80));
  console.log(` [Generated Copy] Stored candidate pools for ${stored} baselines`);
  return { generated: stored };
}

// If running directly (for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  generateCopy()
    .catch(console.error)
    .finally(() => process.exit());
}
