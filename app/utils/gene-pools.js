// Gene Pools: Component library for evolutionary variants
// Each baseline has its own gene pool with ~432 possible combinations

export const genePools = {
  revenue_with_discount: {
    offerAmounts: [10, 15, 20, 25],  // $ off for thresholds
    
    headlines: [
      'Almost there! Add {{threshold_remaining}} more',
      'Unlock {{amount}} off with {{threshold_remaining}} more',
      'You\'re {{percent_to_goal}}% of the way to {{amount}} off!'
    ],
    
    headlinesWithSocialProof: [
      '{{social_proof_count}} customers unlocked this discount',
      'Join {{social_proof_count}} shoppers saving today',
      'Rated {{rating}} stars - add {{threshold_remaining}} to save'
    ],
    
    subheads: [
      'Complete your order and save big',
      'Don\'t miss out on this exclusive offer',
      'Limited time - discount expires in 24 hours'
    ],
    
    subheadsWithSocialProof: [
      '{{social_proof_count}} orders saved with this offer',
      'Trusted by {{social_proof_count}} happy shoppers',
      'Join our {{rating}}-star rated community'
    ],
    
    ctas: [
      'Add More Items',
      'Keep Shopping',
      'Unlock My Discount'
    ],
    
    redirects: ['cart', 'checkout'],
    urgency: [true, false]
  },
  
  revenue_no_discount: {
    offerAmounts: [0],  // No discount, no incentive
    
    headlines: [
      'Complete your order to unlock rewards',
      'You\'re building a great cart!',
      'Almost ready to checkout?'
    ],
    
    headlinesWithSocialProof: [
      '{{social_proof_count}} customers completed their orders today',
      'Join {{social_proof_count}} satisfied shoppers',
      'Rated {{rating}} stars by real customers'
    ],
    
    subheads: [
      'Complete your purchase with confidence',
      'Join our community of satisfied customers',
      'Your items are reserved and waiting'
    ],
    
    subheadsWithSocialProof: [
      '{{social_proof_count}} orders shipped this month',
      'Trusted by {{social_proof_count}} happy customers',
      '{{rating}}-star service guaranteed'
    ],
    
    ctas: [
      'Complete My Order',
      'Go to Checkout',
      'Finish Shopping'
    ],
    
    redirects: ['cart', 'checkout'],
    urgency: [false]  // No urgency without incentive
  },
  
  conversion_with_discount: {
    offerAmounts: [10, 15, 20, 25],  // % off
    
    headlines: [
      'Wait! Get {{amount}}% off before you go',
      'Don\'t leave empty-handed - save {{amount}}%',
      'Your exclusive {{amount}}% discount is ready'
    ],
    
    headlinesWithSocialProof: [
      '{{social_proof_count}} customers claimed this {{amount}}% off',
      'Join {{social_proof_count}} shoppers who saved {{amount}}%',
      'Rated {{rating}} stars - get {{amount}}% off now'
    ],
    
    subheads: [
      'This offer won\'t last long',
      'Join thousands of happy customers',
      'Complete your order risk-free'
    ],
    
    subheadsWithSocialProof: [
      '{{social_proof_count}} orders placed with this discount',
      'Trusted by {{social_proof_count}} satisfied customers',
      '{{rating}}-star rated by verified buyers'
    ],
    
    ctas: [
      'Claim My Discount',
      'Apply & Checkout',
      'Get {{amount}}% Off Now'
    ],
    
    redirects: ['cart', 'checkout'],
    urgency: [true, false]
  },
  
  conversion_no_discount: {
    offerAmounts: [0],  // No discount, social proof only
    
    headlines: [
      'Complete your order with confidence',
      'Join our community of satisfied customers',
      'Your items are waiting for you'
    ],
    
    headlinesWithSocialProof: [
      '{{social_proof_count}} customers trust us',
      'Rated {{rating}} stars by verified buyers',
      'Join {{social_proof_count}} happy customers'
    ],
    
    subheads: [
      'Secure checkout and risk-free returns',
      'Trusted by customers like you',
      'Fast processing and reliable shipping'
    ],
    
    subheadsWithSocialProof: [
      '{{social_proof_count}} orders shipped and counting',
      'Join {{social_proof_count}} satisfied shoppers',
      'Rated {{rating}} stars by real customers'
    ],
    
    ctas: [
      'Complete My Order',
      'Checkout Securely',
      'Finish Purchase'
    ],
    
    redirects: ['cart', 'checkout'],
    urgency: [false]  // No urgency without incentive
  },
  
  // PURE REMINDER: No offers, no discounts, no incentives
  // Used when AI decides customer doesn't need any offer (aggression=0 or offerAmount=0)
  pure_reminder: {
    offerAmounts: [0],  // No offer at all
    
    headlines: [
      'You have items in your cart',
      'Your cart is waiting',
      'Ready to complete your order?',
      'Don\'t forget about your items'
    ],
    
    headlinesWithSocialProof: [
      '{{social_proof_count}} customers completed their orders',
      'Join {{social_proof_count}} shoppers',
      'Rated {{rating}} stars by verified buyers'
    ],
    
    subheads: [
      'Complete your purchase when you\'re ready',
      'Your items are reserved',
      'Checkout at your convenience',
      'Your cart will be here when you return'
    ],
    
    subheadsWithSocialProof: [
      '{{social_proof_count}} orders delivered successfully',
      'Trusted by {{social_proof_count}} customers',
      '{{rating}}-star service you can count on'
    ],
    
    ctas: [
      'View Cart',
      'Go to Checkout',
      'Complete Order',
      'Return to Cart'
    ],
    
    redirects: ['cart', 'checkout'],
    urgency: [false]  // No urgency for reminders
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
    pool.urgency.length
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
  console.log('🧬 Gene Pool Statistics:');
  console.log('========================');
  
  getAllBaselines().forEach(baseline => {
    const count = getCombinationCount(baseline);
    console.log(`${baseline}: ${count} possible combinations`);
  });
  
  console.log('\nTotal possible combinations across all baselines:', 
    getAllBaselines().reduce((sum, b) => sum + getCombinationCount(b), 0)
  );
}
