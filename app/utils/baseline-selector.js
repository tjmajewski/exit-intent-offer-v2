// Baseline Selector: Decides which modal type to use based on customer signals
// Returns one of 4 baselines: revenue/conversion × discount/no-discount

/**
 * Select the appropriate baseline for a customer
 * @param {Object} signals - Customer signals from AI decision engine
 * @param {string} aiGoal - Shop's AI goal ('revenue' or 'conversion')
 * @returns {string} - One of 4 baselines
 */
export function selectBaseline(signals, aiGoal = 'revenue') {
  const propensityScore = signals.propensityScore || 50;
  const hasPromoActive = signals.hasPromoActive || false;
  
  // High propensity threshold (doesn't need incentive)
  const highPropensity = propensityScore >= 70;
  
  // If site-wide promo is active, avoid discount baselines
  if (hasPromoActive) {
    console.log('⚠️ Site-wide promo active - using no-discount baseline');
    return aiGoal === 'revenue' ? 'revenue_no_discount' : 'conversion_no_discount';
  }
  
  // Revenue mode: Upsell to increase cart value
  if (aiGoal === 'revenue') {
    if (highPropensity) {
      // Customer is ready to buy - upsell without discount
      console.log('💰 Revenue mode + high propensity → revenue_no_discount');
      return 'revenue_no_discount';
    } else {
      // Customer needs incentive to add more
      console.log('💰 Revenue mode + needs incentive → revenue_with_discount');
      return 'revenue_with_discount';
    }
  }
  
  // Conversion mode: Convert abandoners
  if (aiGoal === 'conversion') {
    if (highPropensity) {
      // Customer is likely to convert - use social proof
      console.log('🎯 Conversion mode + high propensity → conversion_no_discount');
      return 'conversion_no_discount';
    } else {
      // Customer needs incentive to complete purchase
      console.log('🎯 Conversion mode + needs incentive → conversion_with_discount');
      return 'conversion_with_discount';
    }
  }
  
  // Default fallback (shouldn't reach here)
  console.warn('⚠️ Unknown aiGoal, defaulting to conversion_with_discount');
  return 'conversion_with_discount';
}

/**
 * Get human-readable explanation of baseline choice
 * @param {string} baseline - The selected baseline
 * @returns {string} - Explanation text
 */
export function explainBaseline(baseline) {
  const explanations = {
    revenue_with_discount: 'Upselling with discount incentive to increase cart value',
    revenue_no_discount: 'Upselling without discount (customer is ready to buy more)',
    conversion_with_discount: 'Converting abandoners with discount incentive',
    conversion_no_discount: 'Converting abandoners with social proof (no discount needed)'
  };
  
  return explanations[baseline] || 'Unknown baseline';
}

/**
 * Determine if customer needs a discount based on signals
 * @param {Object} signals - Customer signals
 * @returns {boolean} - True if customer needs incentive
 */
export function needsIncentive(signals) {
  const propensityScore = signals.propensityScore || 50;
  const cartAbandonmentCount = signals.cartAbandonmentCount || 0;
  const isFirstVisit = signals.accountStatus === 'guest' && signals.visitFrequency === 1;
  
  // High propensity customers don't need incentive
  if (propensityScore >= 70) return false;
  
  // Repeat abandoners definitely need incentive
  if (cartAbandonmentCount >= 2) return true;
  
  // First-time visitors with low propensity need incentive
  if (isFirstVisit && propensityScore < 50) return true;
  
  // Medium propensity (50-69) - might need incentive
  return propensityScore < 60;
}

/**
 * Test baseline selection with sample signals
 */
export function testBaselineSelection() {
  console.log('🧪 Testing Baseline Selection');
  console.log('==============================\n');
  
  const testCases = [
    {
      name: 'High-intent returning customer (revenue mode)',
      signals: { propensityScore: 85, accountStatus: 'customer', visitFrequency: 5 },
      aiGoal: 'revenue',
      expected: 'revenue_no_discount'
    },
    {
      name: 'Low-intent first-time visitor (revenue mode)',
      signals: { propensityScore: 35, accountStatus: 'guest', visitFrequency: 1 },
      aiGoal: 'revenue',
      expected: 'revenue_with_discount'
    },
    {
      name: 'High-intent abandoner (conversion mode)',
      signals: { propensityScore: 75, cartAbandonmentCount: 1 },
      aiGoal: 'conversion',
      expected: 'conversion_no_discount'
    },
    {
      name: 'Low-intent repeat abandoner (conversion mode)',
      signals: { propensityScore: 40, cartAbandonmentCount: 3 },
      aiGoal: 'conversion',
      expected: 'conversion_with_discount'
    },
    {
      name: 'Site-wide promo active (should avoid discount)',
      signals: { propensityScore: 45, hasPromoActive: true },
      aiGoal: 'revenue',
      expected: 'revenue_no_discount'
    }
  ];
  
  testCases.forEach(test => {
    const result = selectBaseline(test.signals, test.aiGoal);
    const passed = result === test.expected ? '✅' : '❌';
    console.log(`${passed} ${test.name}`);
    console.log(`   Expected: ${test.expected}`);
    console.log(`   Got: ${result}`);
    console.log(`   Explanation: ${explainBaseline(result)}\n`);
  });
}
