// Gene Pools: Component library for evolutionary variants
// Each baseline has its own gene pool with ~432 possible combinations.
//
// ARCHETYPE MODEL (introduced alongside brand-safety guard):
// Each baseline is also an "archetype" — a declarative description of what the
// modal template can render and what copy is coherent with it. Archetype metadata
// lives on each pool entry:
//   archetypeName          — stable identifier (e.g. 'THRESHOLD_DISCOUNT')
//   archetypeDescription   — human explanation of the modal's intent
//   slots                  — ordered list of what the renderer can draw
//                            (e.g. ['headline','subhead','cta','discount_code'])
//   requiredSlots          — slots that MUST render for the archetype to be valid
//   requires               — preconditions for firing this archetype at all
//                            (e.g. { discountCode: true, cartItemsMin: 1 })
//   copyBannedPatterns     — regex list — copy matching any of these should never
//                            be in this archetype (belt-and-suspenders for pool edits)
//
// Adding a new modal type (e.g. cross-sell with product grid) = adding a new
// archetype with its own slots list. The renderer reads slots from the decision
// payload and draws only what's declared. No in-pool copy can promise slots the
// archetype doesn't have.

// Shared banned patterns — copy that promises features no current archetype delivers.
// Applied to every existing archetype because none of them render products,
// recommendations, or have standing free-shipping/returns guarantees.
// Recurring-language patterns (spec 2.2). A Resparq discount applies to the
// FIRST order only, so no discount archetype may imply the discount recurs.
// Exported so the subscription-upsell archetype (spec 2.4) — the one pool that
// legitimately says "every order" because the SAVING recurs, not a code — can
// filter these back out of its own copyBannedPatterns.
export const RECURRING_LANGUAGE_PATTERNS = [
  /every\s+(order|month|delivery)/i,            // implies a recurring discount
  // "forever" only as an AFFIRMATIVE permanence claim. Negation-aware so
  // existing urgency copy ("won't last forever", "not reserved forever") — which
  // says the opposite — is not caught. Variable-length negative lookbehind for a
  // negation word within 30 chars before "forever".
  /(?<!\b(?:won'?t|will not|cannot|can'?t|don'?t|not|isn'?t|never|no)\b.{0,30})forever/i
];

const UNIVERSAL_BANNED_PATTERNS = [
  /customers.+(bought|added|viewed|liked)/i,    // implies product cross-sell grid
  /(also|people).+(bought|added|viewed|liked)/i,
  /see.+what.+(pairs|goes|matches)/i,           // implies product showcase
  /browse.+(favorites|recommendations|picks)/i, // implies product list
  /free\s+shipping/i,                           // merchant may not offer it
  /easy\s+returns/i,                            // merchant may not offer it
  /money.?back.+guarantee/i,                    // merchant may not offer it
  ...RECURRING_LANGUAGE_PATTERNS                // discount never recurs (spec 2.2)
];

// Modal-design template gene (Sprint 3). Cross-archetype: all 8 visual
// templates are copy-agnostic chrome, so every archetype draws from the same
// pool. Must stay in sync with MODAL_LAYOUTS (app/utils/templates.js) and the
// storefront TEMPLATES registry (modal-templates.js). Testimonial renders
// decorative stars + merchant copy only (no fabricated social proof);
// Timer-Front is deadline-driven from offerExpiresAt, independent of the
// urgency gene — both safe to pair with any archetype.
export const TEMPLATE_IDS = [
  'classic-card', 'top-banner', 'bottom-sheet', 'coupon-ticket',
  'split-hero', 'timer-front', 'testimonial', 'scratch-reveal'
];

export const genePools = {
  // REVENUE + DISCOUNT: Threshold offers to increase cart value (e.g., "Spend $X more, save $Y")
  revenue_with_discount: {
    archetypeName: 'THRESHOLD_DISCOUNT',
    archetypeDescription: 'AOV lift via "spend $X more, save $Y" threshold offer',
    slots: ['headline', 'subhead', 'cta', 'discount_code'],
    requiredSlots: ['headline', 'cta', 'discount_code'],
    requires: { cartValue: 'gt0', discountCode: true, thresholdComputable: true },
    copyBannedPatterns: UNIVERSAL_BANNED_PATTERNS,

    offerAmounts: [10, 15, 20, 25],  // $ off for thresholds

    headlines: [
      'You\'re just {{threshold_remaining}} away from {{amount}} off',
      'Spend {{threshold_remaining}} more and save {{amount}}',
      'Add {{threshold_remaining}} to unlock {{amount}} off'
    ],

    subheads: [
      'The discount applies to your whole order at checkout',
      'Your savings apply automatically at checkout',
      'Every item you add counts toward the goal'
    ],

    // THRESHOLD ARCHETYPE: urgency copy must ALSO state the qualifying
    // condition. The previous lines here ('Save {{amount}}, expires in 24
    // hours') were written for a flat-discount frame: they name the reward but
    // never the requirement, so an urgency variant rendered a modal that said
    // "save $8" while silently requiring several hundred dollars more in the
    // cart. Every line below carries {{threshold_remaining}} or {{threshold}}.
    headlinesWithUrgency: [
      'Add {{threshold_remaining}} for {{amount}} off. Expires in 24 hours.',
      'Only 24 hours left to add {{threshold_remaining}} and save {{amount}}',
      'Today only: add {{threshold_remaining}} to unlock {{amount}} off'
    ],

    subheadsWithUrgency: [
      'Once you reach {{threshold}}, the {{amount}} comes off automatically',
      'Add {{threshold_remaining}} more and it applies to your whole order',
      'You\'re {{threshold_remaining}} away from the full discount'
    ],

    ctas: [
      'Unlock My Savings',
      'Add Items & Save',
      'Get {{amount}} Off'
    ],

    redirects: ['cart', 'checkout'],
    urgency: [true, false],
    showSubhead: [true, false],  // Whether to render subhead text at all (true = show, false = headline+CTA only)
    showProductImages: [true, false],  // Render cart-item thumbnails inside the modal (degrades to hidden when cart has no images)

    // Trigger strategy: how to fire the modal
    // exit_intent = mouse leave (desktop) / back-button (mobile fallback)
    // idle = show after X seconds idle on page with cart items
    // exit_intent_or_idle = whichever fires first (covers both desktop & mobile)
    triggerTypes: ['exit_intent', 'idle', 'exit_intent_or_idle'],
    idleSeconds: [15, 30, 45, 60],  // Only used when trigger includes idle
    templateIds: TEMPLATE_IDS
  },

  // REVENUE + NO DISCOUNT: Upsell without discount (high-propensity customers)
  // NOTE: This archetype's modal has NO product grid / recommendation surface.
  // Copy MUST NOT promise product browsing, pairing, or cross-sell ("customers also
  // bought", "see what pairs", "browse favorites") — the modal cannot deliver on that
  // promise and will read as dishonest. When a cross-sell template with a product grid
  // ships, introduce a separate CROSS_SELL archetype for that copy.
  revenue_no_discount: {
    archetypeName: 'SOFT_UPSELL',
    archetypeDescription: 'Gentle nudge to finish checkout without offering a discount',
    slots: ['headline', 'subhead', 'cta'],
    requiredSlots: ['headline', 'cta'],
    requires: { cartItemsMin: 1 },
    copyBannedPatterns: UNIVERSAL_BANNED_PATTERNS,

    offerAmounts: [0],  // No discount, no incentive

    headlines: [
      'Your order is almost complete',
      'Ready to finish up?',
      'Your cart is waiting for you'
    ],

    subheads: [
      'Everything\'s saved. Pick up right where you left off.',
      'Checkout takes less than a minute',
      'No rush. Your items aren\'t going anywhere.'
    ],

    ctas: [
      'Complete My Order',
      'Take Me to Checkout',
      'Finish My Order'
    ],

    redirects: ['cart', 'checkout'],
    urgency: [false],  // No urgency without incentive
    showSubhead: [true, false],
    showProductImages: [true, false],
    triggerTypes: ['exit_intent', 'idle', 'exit_intent_or_idle'],
    idleSeconds: [15, 30, 45, 60],
    templateIds: TEMPLATE_IDS
  },

  // CONVERSION + DISCOUNT: % off to prevent cart abandonment
  conversion_with_discount: {
    archetypeName: 'PERCENT_DISCOUNT',
    archetypeDescription: 'Convert hesitant cart via % off discount code',
    slots: ['headline', 'subhead', 'cta', 'discount_code'],
    requiredSlots: ['headline', 'cta', 'discount_code'],
    requires: { cartItemsMin: 1, discountCode: true },
    copyBannedPatterns: UNIVERSAL_BANNED_PATTERNS,

    offerAmounts: [10, 15, 20, 25],  // % off

    headlines: [
      'Take {{amount}}% off your order',
      'Your {{amount}}% discount is ready',
      'Save {{amount}}% before you go'
    ],

    subheads: [
      'Applied automatically at checkout',
      'It works on everything in your cart',
      'One click and the discount is yours'
    ],

    headlinesWithUrgency: [
      'Your {{amount}}% discount expires in 24 hours',
      '24 hours left to save {{amount}}%',
      'Limited time: {{amount}}% off, just for you'
    ],

    subheadsWithUrgency: [
      'This code was made just for you. It applies at checkout.',
      'It works on everything in your cart',
      'One click and {{amount}}% comes off your total'
    ],

    ctas: [
      'Claim {{amount}}% Off',
      'Apply My Discount',
      'Save {{amount}}% Now'
    ],

    redirects: ['cart', 'checkout'],
    urgency: [true, false],
    showSubhead: [true, false],
    showProductImages: [true, false],
    triggerTypes: ['exit_intent', 'idle', 'exit_intent_or_idle'],
    idleSeconds: [15, 30, 45, 60],
    templateIds: TEMPLATE_IDS
  },

  // CONVERSION + NO DISCOUNT: Convert without discount (social proof / trust focus)
  conversion_no_discount: {
    archetypeName: 'TRUST_REMINDER',
    archetypeDescription: 'Trust/social-proof nudge with no discount',
    slots: ['headline', 'subhead', 'cta'],
    requiredSlots: ['headline', 'cta'],
    requires: { cartItemsMin: 1 },
    copyBannedPatterns: UNIVERSAL_BANNED_PATTERNS,

    offerAmounts: [0],  // No discount, social proof only

    headlines: [
      'You left something in your cart',
      'Your order is just a click away',
      'Still thinking it over?'
    ],

    subheads: [
      'Your cart is saved and ready when you are',
      'Checkout takes less than a minute',
      'Everything\'s still here, just as you left it'
    ],

    ctas: [
      'Complete My Order',
      'Take Me to Checkout',
      'Yes, I Want This'
    ],

    redirects: ['cart', 'checkout'],
    urgency: [false],  // No urgency without incentive
    showSubhead: [true, false],
    showProductImages: [true, false],
    triggerTypes: ['exit_intent', 'idle', 'exit_intent_or_idle'],
    idleSeconds: [15, 30, 45, 60],
    templateIds: TEMPLATE_IDS
  },

  // PURE REMINDER: No offers, no discounts, no incentives
  // Used when AI decides customer doesn't need any offer (aggression=0 or offerAmount=0)
  pure_reminder: {
    archetypeName: 'PURE_REMINDER',
    archetypeDescription: 'Bare save-the-cart reminder, no offer of any kind',
    slots: ['headline', 'subhead', 'cta'],
    requiredSlots: ['headline', 'cta'],
    requires: {},
    copyBannedPatterns: UNIVERSAL_BANNED_PATTERNS,

    offerAmounts: [0],  // No offer at all

    headlines: [
      'You left something behind',
      'Ready to pick up where you left off?',
      'Your cart is still here',
      'Don\'t lose your picks'
    ],

    subheads: [
      'Everything\'s saved. Checkout takes less than a minute.',
      'Come back and finish whenever you\'re ready',
      'One click and your order is on its way',
      'Your items are waiting, but stock can change'
    ],

    ctas: [
      'Back to My Cart',
      'Go to Checkout',
      'Complete My Order',
      'View My Cart'
    ],

    redirects: ['cart', 'checkout'],
    urgency: [false],  // No urgency for reminders
    showSubhead: [true, false],
    showProductImages: [true, false],
    triggerTypes: ['exit_intent', 'idle', 'exit_intent_or_idle'],
    idleSeconds: [15, 30, 45, 60],
    templateIds: TEMPLATE_IDS
  }
};

// Runtime brand-safety guards against legacy/off-pool DB rows.
// When a gene pool entry is removed (e.g. because the copy promised something the
// modal can't deliver), existing Variant rows in the DB still carry the old text.
// These helpers let the API layer detect and neutralize those before they render.

// Normalize {{placeholders}} and whitespace so interpolated strings match templates
const normalizeGene = (s) => s.replace(/\{\{[^}]+\}\}/g, '').replace(/\s+/g, ' ').trim();

function collectPoolStrings(baseline, keys) {
  const pool = genePools[baseline];
  if (!pool) return [];
  return keys.flatMap((k) => pool[k] || []);
}

export function isValidSubhead(baseline, text) {
  if (!text) return true; // empty/null is safe — renderer will hide it
  const all = collectPoolStrings(baseline, ['subheads', 'subheadsWithUrgency']);
  const target = normalizeGene(text);
  return all.some((t) => normalizeGene(t) === target);
}

export function isValidHeadline(baseline, text) {
  if (!text) return false; // headline is required — blank is not safe
  const all = collectPoolStrings(baseline, ['headlines', 'headlinesWithUrgency']);
  const target = normalizeGene(text);
  return all.some((t) => normalizeGene(t) === target);
}

export function isValidCta(baseline, text) {
  if (!text) return false; // CTA is required
  const all = collectPoolStrings(baseline, ['ctas']);
  const target = normalizeGene(text);
  return all.some((t) => normalizeGene(t) === target);
}

// Pick a safe in-pool fallback when a variant carries off-pool copy.
// Used to rescue the render; evolution metrics for that variant will be slightly
// noisy until a cleanup job retires off-pool rows, but nothing dishonest ships.
export function pickFallbackHeadline(baseline) {
  const all = collectPoolStrings(baseline, ['headlines']);
  return all[0] || null;
}

export function pickFallbackCta(baseline) {
  const all = collectPoolStrings(baseline, ['ctas']);
  return all[0] || null;
}

// Does this text trip any banned-pattern regex for the archetype?
// Belt-and-suspenders check: even if a string is in-pool, if it matches a banned
// pattern the pool has drifted and the copy should be treated as unsafe.
// (Today the pools are clean, so this never fires — it exists to catch future edits
// that accidentally reintroduce forbidden claims.)
export function hasBannedClaim(baseline, text) {
  if (!text) return false;
  const pool = genePools[baseline];
  const patterns = pool?.copyBannedPatterns || [];
  return patterns.some((re) => re.test(text));
}

// ── Archetype accessors ──────────────────────────────────────────────────────
// `archetypes` is the archetype-name-keyed view of the gene pools. Use this when
// you want to look up a modal type by its stable identifier (e.g. 'THRESHOLD_DISCOUNT')
// rather than by baseline key. Both views share the same underlying objects.
export const archetypes = Object.fromEntries(
  Object.entries(genePools)
    .filter(([, pool]) => pool.archetypeName)
    .map(([baseline, pool]) => [pool.archetypeName, { baseline, ...pool }])
);

export function getArchetype(baseline) {
  return genePools[baseline] || null;
}

export function getArchetypeByName(name) {
  return archetypes[name] || null;
}

export function getArchetypeSlots(baseline) {
  return genePools[baseline]?.slots || ['headline', 'subhead', 'cta'];
}

// Helper: Get total possible combinations for a baseline
export function getCombinationCount(baseline) {
  const pool = genePools[baseline];
  return (
    pool.offerAmounts.length *
    pool.headlines.length *
    pool.subheads.length *
    pool.ctas.length *
    pool.redirects.length *
    pool.urgency.length *
    (pool.showSubhead?.length || 1) *
    pool.triggerTypes.length *
    pool.idleSeconds.length
  );
}

// Helper: Get a random gene value from a pool
export function getRandomGene(baseline, geneType) {
  const pool = genePools[baseline];
  const options = pool[geneType + 's'] || pool[geneType];
  
  if (!options || options.length === 0) {
    throw new Error(`Invalid gene type: ${geneType} for baseline: ${baseline}`);
  }
  
  return options[Math.floor(Math.random() * options.length)];
}

// Helper: Validate that a gene exists in the pool
export function isValidGene(baseline, geneType, geneValue) {
  const pool = genePools[baseline];
  const options = pool[geneType + 's'] || pool[geneType];
  
  if (!options) return false;
  
  return options.includes(geneValue);
}

// Helper: Get all baselines
export function getAllBaselines() {
  return Object.keys(genePools);
}

// Example usage and stats
export function printGenePoolStats() {
  console.log(' Gene Pool Statistics:');
  console.log('========================');
  
  getAllBaselines().forEach(baseline => {
    const count = getCombinationCount(baseline);
    console.log(`${baseline}: ${count} possible combinations`);
  });
  
  console.log('\nTotal possible combinations across all baselines:', 
    getAllBaselines().reduce((sum, b) => sum + getCombinationCount(b), 0)
  );
}
