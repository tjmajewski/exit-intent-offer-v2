export function determineOffer(signals, aggression, aiGoal, cartValue) {
  let score = 0;
  
  // Score each signal (0-100 scale)
  if (signals.visitFrequency === 1) score += 15; // New visitor
  if (signals.deviceType === 'mobile') score += 10;
  if (signals.trafficSource === 'paid') score += 20;
  if (signals.accountStatus === 'guest') score += 10;
  if (signals.timeOnSite < 30) score += 15; // Quick exit
  if (signals.cartValue > 75 && signals.cartValue < 150) score += 15;
  if (signals.pageViews >= 3) score += 10;
  if (signals.hasAbandonedBefore) score += 10;
  
  // If aggression is 0, return no-discount offer
  if (aggression === 0) {
    return {
      type: 'no-discount',
      amount: 0,
      confidence: 'high',
      reasoning: 'Aggression set to 0 - announcement only mode'
    };
  }
  
  // REVENUE MODE: Threshold offers to increase cart size
  if (aiGoal === 'revenue') {
    const currentCart = cartValue || signals.cartValue || 0;
    
    // Calculate ideal threshold (20-30% above current cart)
    const thresholdMultiplier = 1.25 + (score / 500); // 1.25x to 1.45x
    const targetThreshold = Math.round(currentCart * thresholdMultiplier / 5) * 5; // Round to nearest $5
    
    // Calculate discount amount based on aggression (5-15% of threshold)
    const discountPercent = 5 + (aggression * 1);
    const discountAmount = Math.round(targetThreshold * (discountPercent / 100));
    
    return {
      type: 'threshold',
      threshold: Math.max(targetThreshold, currentCart + 10), // At least $10 more
      amount: Math.max(discountAmount, 5), // Minimum $5 off
      confidence: score > 60 ? 'high' : 'medium',
      reasoning: `Revenue mode: Encouraging cart increase from $${currentCart} to $${targetThreshold}`
    };
  }
  
  // CONVERSION MODE: Immediate discounts to convert
  // Convert score to offer (0-100 → 5-25%)
  const baseOffer = 5 + (score / 100 * 20);
  
  // Apply aggression multiplier
  const finalOffer = baseOffer * (aggression / 5);
  
  // Determine if percentage or fixed based on cart value
  const shouldUseFixed = signals.cartValue < 50;
  
  if (shouldUseFixed) {
    // For small carts, use fixed amount ($5-$10)
    return {
      type: 'fixed',
      amount: Math.min(Math.max(Math.round(finalOffer / 2), 5), 10),
      confidence: score > 60 ? 'high' : 'medium',
      reasoning: `Conversion mode: Small cart, offering fixed discount`
    };
  } else {
    // For larger carts, use percentage (5-25%)
    return {
      type: 'percentage',
      amount: Math.min(Math.max(Math.round(finalOffer), 5), 25),
      confidence: score > 60 ? 'high' : 'medium',
      reasoning: `Conversion mode: Score ${score}, offering ${Math.round(finalOffer)}% discount`
    };
  }
}

export async function checkBudget(db, shopId, budgetPeriod) {
  const shop = await db.shop.findUnique({
    where: { id: shopId }
  });
  
  if (!shop || !shop.budgetEnabled) {
    return { hasRoom: true, remaining: Infinity };
  }
  
  // Calculate period start date
  const now = new Date();
  let periodStart;
  
  if (budgetPeriod === 'week') {
    periodStart = new Date(now);
    periodStart.setDate(now.getDate() - 7);
  } else {
    // month
    periodStart = new Date(now);
    periodStart.setMonth(now.getMonth() - 1);
  }
  
  // Get all non-expired offers in this period
  const offers = await db.discountOffer.findMany({
    where: {
      shopId: shopId,
      createdAt: {
        gte: periodStart
      },
      expiresAt: {
        gte: now // Only count offers that haven't expired yet
      }
    }
  });
  
  // Sum up the total discount amount offered
  const totalSpent = offers.reduce((sum, offer) => sum + offer.amount, 0);
  const remaining = shop.budgetAmount - totalSpent;
  
  return {
    hasRoom: remaining > 0,
    remaining: Math.max(remaining, 0),
    totalSpent
  };
}