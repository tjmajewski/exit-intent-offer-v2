// Gene Pools: Component library for evolutionary variants
// Each baseline has its own gene pool with ~432 possible combinations

export const genePools = {
  // REVENUE + DISCOUNT: Threshold offers to increase cart value (e.g., "Spend $X more, save $Y")
  revenue_with_discount: {
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
  revenue_no_discount: {
    offerAmounts: [0],  // No discount, no incentive

    headlines: [
      'Great picks — make it the perfect order',
      'Customers who bought these also added...',
      'Your order is almost complete'
    ],

    headlinesWithSocialProof: [
      '{{social_proof_count}} customers completed their orders today',
      'Join {{social_proof_count}} shoppers who found the perfect combo',
      '{{rating}}-star favorites picked just for you'
    ],

    subheads: [
      'You\'ve got great taste — see what goes with it',
      'Make the most of your order before you go',
      'Browse a few more favorites before checkout'
    ],

    subheadsWithSocialProof: [
      '{{social_proof_count}} customers added more items to their order',
      '{{social_proof_count}} happy customers can\'t be wrong',
      '{{rating}}-star quality across the board'
    ],

    ctas: [
      'Continue Shopping',
      'Complete My Order',
      'See What Pairs Well'
    ],

    redirects: ['cart', 'checkout'],
    urgency: [false],  // No urgency without incentive
    showSubhead: [true, false],
    triggerTypes: ['exit_intent', 'idle', 'exit_intent_or_idle'],
    idleSeconds: [15, 30, 45, 60]
  },

  // CONVERSION + DISCOUNT: % off to prevent cart abandonment
  conversion_with_discount: {
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
