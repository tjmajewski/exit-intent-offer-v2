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
const UNIVERSAL_BANNED_PATTERNS = [
  /customers.+(bought|added|viewed|liked)/i,    // implies product cross-sell grid
  /(also|people).+(bought|added|viewed|liked)/i,
  /see.+what.+(pairs|goes|matches)/i,           // implies product showcase
  /browse.+(favorites|recommendations|picks)/i, // implies product list
  /free\s+shipping/i,                           // merchant may not offer it
  /easy\s+returns/i,                            // merchant may not offer it
  /money.?back.+guarantee/i                     // merchant may not offer it
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
      'Spend {{threshold_remaining}} more, save {{amount}} instantly',
      'So close! {{percent_to_goal}}% to unlocking {{amount}} off'
    ],

    headlinesWithSocialProof: [
      '{{social_proof_count}} shoppers unlocked this deal today',
      'This discount helped {{social_proof_count}} customers save',
      '{{rating}}-star favorites — add {{threshold_remaining}} to save'
    ],

    subheads: [
      'Add a little more and save on your entire order',
      'This offer is only available right now',
      'Your cart qualifies — don\'t let this deal slip away'
    ],

    subheadsWithSocialProof: [
      '{{social_proof_count}} orders saved with this offer today',
      '{{social_proof_count}} shoppers grabbed this deal — your turn',
      '{{rating}}-star rated products at a price you\'ll love'
    ],

    headlinesWithUrgency: [
      'Save {{amount}} — this offer expires in 24 hours',
      '{{amount}} off is yours, but not for long',
      'Unlock {{amount}} off before this deal disappears'
    ],

    subheadsWithUrgency: [
      'This exclusive offer expires soon — act now',
      'Your personal discount code is only valid for 24 hours',
      'Once the timer runs out, this deal is gone'
    ],

    ctas: [
      'Unlock My Savings',
      'Add Items & Save',
      'Get {{amount}} Off'
    ],

    redirects: ['cart', 'checkout'],
    urgency: [true, false],
    showSubhead: [true, false],  // Whether to render subhead text at all (true = show, false = headline+CTA only)

    // Trigger strategy: how to fire the modal
    // exit_intent = mouse leave (desktop) / back-button (mobile fallback)
    // idle = show after X seconds idle on page with cart items
    // exit_intent_or_idle = whichever fires first (covers both desktop & mobile)
    triggerTypes: ['exit_intent', 'idle', 'exit_intent_or_idle'],
    idleSeconds: [15, 30, 45, 60]  // Only used when trigger includes idle
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
      'Great picks — make it the perfect order',
      'Your order is almost complete',
      'Ready when you are'
    ],

    headlinesWithSocialProof: [
      '{{social_proof_count}} customers completed their orders today',
      '{{rating}}-star favorites are in your cart'
    ],

    subheads: [
      'Make the most of your order before you go',
      'Your cart is saved — finish whenever you\'re ready',
      'A few taps and it\'s on the way'
    ],

    subheadsWithSocialProof: [
      '{{social_proof_count}} orders completed today',
      '{{social_proof_count}} happy customers can\'t be wrong',
      '{{rating}}-star quality across the board'
    ],

    ctas: [
      'Complete My Order',
      'Return to Checkout',
      'Finish My Order'
    ],

    redirects: ['cart', 'checkout'],
    urgency: [false],  // No urgency without incentive
    showSubhead: [true, false],
    triggerTypes: ['exit_intent', 'idle', 'exit_intent_or_idle'],
    idleSeconds: [15, 30, 45, 60]
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
      'Hold on — take {{amount}}% off your order',
      'Your {{amount}}% discount is waiting',
      'Before you go — save {{amount}}% right now'
    ],

    headlinesWithSocialProof: [
      '{{social_proof_count}} shoppers claimed this {{amount}}% off today',
      'Join {{social_proof_count}} customers saving {{amount}}%',
      '{{rating}}-star products, now {{amount}}% off for you'
    ],

    subheads: [
      'Use it now — this offer expires soon',
      'Apply at checkout in one click',
      'This exclusive offer won\'t be here tomorrow'
    ],

    subheadsWithSocialProof: [
      '{{social_proof_count}} orders placed with this discount today',
      '{{social_proof_count}} customers saved — don\'t miss your turn',
      '{{rating}}-star products at {{amount}}% off? Easy decision'
    ],

    headlinesWithUrgency: [
      'Your {{amount}}% discount expires in 24 hours',
      'Act fast — {{amount}}% off won\'t last forever',
      'Exclusive {{amount}}% off, just for you — limited time'
    ],

    subheadsWithUrgency: [
      'This unique code was created just for you and expires soon',
      'Your personal discount code is only valid for 24 hours',
      'Grab this deal before your exclusive offer expires'
    ],

    ctas: [
      'Claim {{amount}}% Off',
      'Apply My Discount',
      'Save {{amount}}% Now'
    ],

    redirects: ['cart', 'checkout'],
    urgency: [true, false],
    showSubhead: [true, false],
    triggerTypes: ['exit_intent', 'idle', 'exit_intent_or_idle'],
    idleSeconds: [15, 30, 45, 60]
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
      'You left something great in your cart',
      'Your order is just one click away',
      'Still thinking it over?'
    ],

    headlinesWithSocialProof: [
      '{{social_proof_count}} customers bought this — and loved it',
      '{{rating}} stars from verified buyers',
      'Join {{social_proof_count}} happy customers today'
    ],

    subheads: [
      'Your cart is saved and ready for you',
      'Checkout takes less than 60 seconds',
      'Your items are selling fast — grab yours'
    ],

    subheadsWithSocialProof: [
      '{{social_proof_count}} five-star reviews and counting',
      '{{social_proof_count}} happy orders this week — yours is next',
      '{{rating}} stars — see why customers keep coming back'
    ],

    ctas: [
      'Complete My Order',
      'Return to Checkout',
      'Yes, I Want This'
    ],

    redirects: ['cart', 'checkout'],
    urgency: [false],  // No urgency without incentive
    showSubhead: [true, false],
    triggerTypes: ['exit_intent', 'idle', 'exit_intent_or_idle'],
    idleSeconds: [15, 30, 45, 60]
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
      'Still interested? Your cart is saved',
      'Your picks are going fast',
      'Don\'t let your cart expire'
    ],

    headlinesWithSocialProof: [
      '{{social_proof_count}} customers checked out today',
      '{{social_proof_count}} shoppers are browsing this right now',
      '{{rating}}-star products — still in your cart'
    ],

    subheads: [
      'Stock levels change — grab yours before it\'s gone',
      'Your cart is saved, but not reserved forever',
      'Come back and finish what you started',
      'One click and it\'s yours'
    ],

    subheadsWithSocialProof: [
      '{{social_proof_count}} orders placed this week',
      '{{social_proof_count}} customers grabbed theirs — will you?',
      '{{rating}}-star quality — still in your cart'
    ],

    ctas: [
      'Back to My Cart',
      'Finish Checkout',
      'Complete My Order',
      'View My Cart'
    ],

    redirects: ['cart', 'checkout'],
    urgency: [false],  // No urgency for reminders
    showSubhead: [true, false],
    triggerTypes: ['exit_intent', 'idle', 'exit_intent_or_idle'],
    idleSeconds: [15, 30, 45, 60]
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
  const all = collectPoolStrings(baseline, ['subheads', 'subheadsWithSocialProof', 'subheadsWithUrgency']);
  const target = normalizeGene(text);
  return all.some((t) => normalizeGene(t) === target);
}

export function isValidHeadline(baseline, text) {
  if (!text) return false; // headline is required — blank is not safe
  const all = collectPoolStrings(baseline, ['headlines', 'headlinesWithSocialProof', 'headlinesWithUrgency']);
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
