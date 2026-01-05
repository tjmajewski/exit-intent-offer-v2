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
    
    subheads: [
      'Complete your order and save big',
      'Don\'t miss out on this exclusive offer',
      'Limited time - discount expires in 24 hours'
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
    offerAmounts: [0],  // No discount, just incentive
    
    headlines: [
      'Almost there! Add {{threshold_remaining}} more',
      'You\'re {{percent_to_goal}}% of the way to free shipping',
      'Just {{threshold_remaining}} away from unlocking perks'
    ],
    
    subheads: [
      'Get free shipping on orders over {{threshold}}',
      'Unlock free shipping and priority processing',
      'Complete your order to qualify for free delivery'
    ],
    
    ctas: [
      'Add More Items',
      'Shop More',
      'Unlock Free Shipping'
    ],
    
    redirects: ['cart', 'checkout'],
    urgency: [true, false]
  },
  
  conversion_with_discount: {
    offerAmounts: [10, 15, 20, 25],  // % off
    
    headlines: [
      'Wait! Get {{amount}}% off before you go',
      'Don\'t leave empty-handed - save {{amount}}%',
      'Your exclusive {{amount}}% discount is ready'
    ],
    
    subheads: [
      'This offer won\'t last long',
      'Join thousands of happy customers',
      'Complete your order risk-free'
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
    offerAmounts: [0],  // No discount, social proof
    
    headlines: [
      '10,000+ customers trust us',
      'Join our community of happy customers',
      'Don\'t miss out on what everyone\'s buying'
    ],
    
    subheads: [
      'Risk-free returns and fast shipping',
      'Rated 4.8/5 stars by verified buyers',
      'Complete your order with confidence'
    ],
    
    ctas: [
      'Complete My Order',
      'Checkout Now',
      'Join Our Customers'
    ],
    
    redirects: ['cart', 'checkout'],
    urgency: [true, false]
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
