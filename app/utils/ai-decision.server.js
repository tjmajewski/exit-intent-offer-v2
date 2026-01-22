// Helper: Analyze cart composition to adjust strategy
function analyzeCartComposition(signals) {
  const cartValue = signals.cartValue || 0;
  const itemCount = signals.itemCount || 1; // Default to 1 if not provided
  const avgItemPrice = itemCount > 0 ? cartValue / itemCount : cartValue;
  
  return {
    isHighTicket: avgItemPrice > 200, // Single expensive item (snowboard)
    isMultiItem: itemCount > 1,
    avgItemPrice: avgItemPrice,
    itemCount: itemCount,
    cartValue: cartValue
  };
}

export async function determineOffer(signals, aggression, aiGoal, cartValue, shopId = null, plan = 'pro') {
  // PHASE 5: Promotional intelligence (detection for all, control for Enterprise only)
  let activePromoWarning = null;
  
  if (shopId) {
    const { default: db } = await import('../db.server.js');
    
    const activePromo = await db.promotion.findFirst({
      where: {
        shopId: shopId,
        status: "active",
        classification: "site_wide",
        aiStrategy: { not: "ignore" }
      },
      orderBy: {
        amount: 'desc' // Get highest promo if multiple active
      }
    });

    if (activePromo) {
      // PRO TIER: Detect but don't act (upsell opportunity)
      if (plan === 'pro') {
        console.log(` [Pro] Site-wide promo detected but no action taken: ${activePromo.code} - ${activePromo.amount}%`);
        activePromoWarning = {
          code: activePromo.code,
          amount: activePromo.amount,
          message: `Site-wide ${activePromo.amount}% promo active - upgrade to Enterprise for automatic optimization`
        };
        // Continue with normal AI logic (no adjustments)
      }
      
      // ENTERPRISE TIER: Detect and auto-optimize
      if (plan === 'enterprise') {
        console.log(` [Enterprise] Active site-wide promo: ${activePromo.code} - ${activePromo.amount}%`);
        
        // Check if merchant has manually overridden
        if (activePromo.merchantOverride) {
          const override = JSON.parse(activePromo.merchantOverride);
          console.log(` Merchant override active: ${override.type}`);
          
          if (override.type === 'pause') {
            return null; // Don't show modal
          }
          
          if (override.type === 'force_zero') {
            return {
              type: 'no-discount',
              amount: 0,
              confidence: 'high',
              reasoning: `Merchant override: announcement mode during ${activePromo.code}`
            };
          }
          
          // Use merchant's custom aggression
          aggression = override.customAggression || aggression;
        } else {
          // Use AI's automatic strategy
          if (activePromo.aiStrategy === "pause") {
            console.log("AI paused due to site-wide promotion");
            return null; // Don't show modal at all
          }
          
          if (activePromo.aiStrategy === "increase") {
            // Force minimum offer to beat the promo by 5%
            const minOffer = activePromo.amount + 5;
            aggression = Math.max(aggression, Math.ceil(minOffer / 2.5)); // Convert to 1-10 scale
            console.log(`AI auto-increased aggression to beat ${activePromo.amount}% promo`);
          }
        }
      }
    }
  }

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
    const cart = analyzeCartComposition(signals);
    
    console.log(' REVENUE MODE TRIGGERED');
    console.log('Cart composition:', cart);
    
    // HIGH-TICKET SINGLE ITEM: Encourage accessories, not second big item
    if (cart.isHighTicket && !cart.isMultiItem) {
      const accessoryThreshold = Math.round(currentCart * 0.25);
      const rawThreshold = currentCart + accessoryThreshold;
      
      const threshold = rawThreshold < 50 ? Math.round(rawThreshold / 5) * 5 
                      : rawThreshold < 200 ? Math.round(rawThreshold / 10) * 10 
                      : Math.round(rawThreshold / 25) * 25;
      
      const discountPercent = 5 + (aggression * 0.5);
      const rawDiscount = threshold * (discountPercent / 100);
      const discountAmount = rawDiscount <= 15 ? Math.round(rawDiscount)
                           : rawDiscount < 20 ? Math.round(rawDiscount / 5) * 5
                           : rawDiscount < 100 ? Math.round(rawDiscount / 10) * 10
                           : Math.round(rawDiscount / 25) * 25;
      
      return {
        type: 'threshold',
        threshold: Math.max(threshold, currentCart + 20),
        amount: Math.max(discountAmount, 5),
        confidence: 'high',
        reasoning: `High-ticket item ($${cart.avgItemPrice.toFixed(0)}) - encouraging accessory add-on to $${threshold}`
      };
    }
    
    // MULTI-ITEM CART: They're bundling, encourage more
    const thresholdMultiplier = cart.isMultiItem ? 1.3 + (score / 500) : 1.25 + (score / 500);
    const rawThreshold = currentCart * thresholdMultiplier;
    
    let targetThreshold;
    if (rawThreshold < 50) {
      targetThreshold = Math.round(rawThreshold / 5) * 5;
    } else if (rawThreshold < 200) {
      targetThreshold = Math.round(rawThreshold / 10) * 10;
    } else {
      targetThreshold = Math.round(rawThreshold / 25) * 25;
    }
    
    const discountPercent = 5 + (aggression * 1);
    const rawDiscount = targetThreshold * (discountPercent / 100);
    
    let discountAmount;
    if (rawDiscount <= 15) {
      discountAmount = Math.round(rawDiscount); // Whole dollars for small amounts
    } else if (rawDiscount < 20) {
      discountAmount = Math.round(rawDiscount / 5) * 5; // Round to $5
    } else if (rawDiscount < 100) {
      discountAmount = Math.round(rawDiscount / 10) * 10; // Round to $10
    } else {
      discountAmount = Math.round(rawDiscount / 25) * 25; // Round to $25
    }
    
    return {
      type: 'threshold',
      threshold: Math.max(targetThreshold, currentCart + 10),
      amount: Math.max(discountAmount, 5),
      confidence: score > 60 ? 'high' : 'medium',
      reasoning: cart.isMultiItem 
        ? `Multi-item cart - encouraging bundle expansion to $${targetThreshold}`
        : `Revenue mode: Encouraging cart increase from $${currentCart} to $${targetThreshold}`
    };
  }
  
  // CONVERSION MODE: Immediate discounts to convert
  const cart = analyzeCartComposition(signals);
  
  // HIGH-TICKET SINGLE ITEM: Lower % discount (they're already buying)
  if (cart.isHighTicket && !cart.isMultiItem) {
    const conservativeOffer = 5 + (aggression * 0.8); // 5-13% max
    return {
      type: 'percentage',
      amount: Math.min(Math.round(conservativeOffer), 15), // Cap at 15%
      confidence: 'high',
      reasoning: `High-ticket single item ($${cart.avgItemPrice.toFixed(0)}) - conservative discount to close`
    };
  }
  
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
} // Close determineOffer function // Close determineOffer function

export function enterpriseAI(signals, aggression, aiGoal = 'revenue') {
  const propensity = signals.propensityScore;
  const cartValue = signals.cartValue || 0;
  const cart = analyzeCartComposition(signals);
  
  console.log(' [Enterprise AI] Cart analysis:', cart);
  console.log(' [Enterprise AI] Propensity:', propensity);
  
  // High propensity (>75) = likely to buy anyway
  if (propensity > 75) {
    // Don't show discount if high-value customer
    if (signals.customerLifetimeValue > 500) {
      return null; // Don't show modal at all
    }
    
    // Revenue mode: Try to increase cart size even for high-propensity
    if (aiGoal === 'revenue' && cartValue > 20) {
      const rawThreshold = cartValue * 1.3;
      const threshold = rawThreshold < 50 ? Math.round(rawThreshold / 5) * 5 
                      : rawThreshold < 200 ? Math.round(rawThreshold / 10) * 10 
                      : Math.round(rawThreshold / 25) * 25;
      
      const rawDiscount = threshold * 0.08;
      const discountAmount = rawDiscount <= 15 ? Math.round(rawDiscount)
                           : rawDiscount < 20 ? Math.round(rawDiscount / 5) * 5
                           : rawDiscount < 100 ? Math.round(rawDiscount / 10) * 10
                           : Math.round(rawDiscount / 25) * 25;
      
      return {
        type: 'threshold',
        threshold: threshold,
        amount: Math.max(discountAmount, 5),
        timing: 'exit_intent',
        confidence: 'high',
        reasoning: `High propensity - encouraging cart increase from $${cartValue} to $${threshold}`
      };
    }
    
    // Conversion mode: Show small discount - they're already likely to convert
    return {
      type: 'percentage',
      amount: 5,
      timing: 'exit_intent',
      confidence: 'high',
      reasoning: 'High propensity - minimal discount needed'
    };
  }
  
  // Medium propensity (40-75) = needs incentive
  if (propensity > 40) {
    // Revenue mode: Threshold offers
    if (aiGoal === 'revenue' && cartValue > 20) {
      // HIGH-TICKET SINGLE ITEM: Encourage accessories
      if (cart.isHighTicket && !cart.isMultiItem) {
        const accessoryThreshold = Math.round(cartValue * 0.25);
        const rawThreshold = cartValue + accessoryThreshold;
        
        const threshold = rawThreshold < 50 ? Math.round(rawThreshold / 5) * 5 
                        : rawThreshold < 200 ? Math.round(rawThreshold / 10) * 10 
                        : Math.round(rawThreshold / 25) * 25;
        
        const discountPercent = 8 + (aggression * 0.5);
        const rawDiscount = threshold * (discountPercent / 100);
        const discountAmount = rawDiscount < 20 ? Math.round(rawDiscount / 5) * 5
                             : rawDiscount < 100 ? Math.round(rawDiscount / 10) * 10
                             : Math.round(rawDiscount / 25) * 25;
        
        return {
          type: 'threshold',
          threshold: Math.max(threshold, cartValue + 20),
          amount: Math.max(discountAmount, 5),
          timing: 'exit_intent',
          confidence: 'medium',
          reasoning: `Medium propensity + high-ticket item ($${cart.avgItemPrice.toFixed(0)}) - encouraging accessory add-on to $${threshold}`
        };
      }
      
      // NORMAL THRESHOLD LOGIC
      const rawThreshold = cartValue * 1.35;
      const threshold = rawThreshold < 50 ? Math.round(rawThreshold / 5) * 5 
                      : rawThreshold < 200 ? Math.round(rawThreshold / 10) * 10 
                      : Math.round(rawThreshold / 25) * 25;
      
      const discountPercent = 10 + (aggression * 1);
      const rawDiscount = threshold * (discountPercent / 100);
      const discountAmount = rawDiscount <= 15 ? Math.round(rawDiscount)
                           : rawDiscount < 20 ? Math.round(rawDiscount / 5) * 5
                           : rawDiscount < 100 ? Math.round(rawDiscount / 10) * 10
                           : Math.round(rawDiscount / 25) * 25;
      
      return {
        type: 'threshold',
        threshold: threshold,
        amount: Math.max(discountAmount, 5),
        timing: 'exit_intent',
        confidence: 'medium',
        reasoning: `Medium propensity - encouraging cart increase from $${cartValue} to $${threshold}`
      };
    }
    
    // Conversion mode: Percentage offer
    const offer = 10 + (aggression * 1.5);
    return {
      type: 'percentage',
      amount: Math.round(offer),
      timing: 'exit_intent',
      confidence: 'medium',
      reasoning: 'Medium propensity - standard offer'
    };
  }
  
  // Low propensity (<40) = aggressive offer or don't waste discount
  if (cartValue < 30) {
    return null; // Don't show - unlikely to convert
  }
  
  // Revenue mode: Big threshold offer to capture high-intent browsers
  if (aiGoal === 'revenue') {
    // HIGH-TICKET SINGLE ITEM: Even more conservative on accessories
    if (cart.isHighTicket && !cart.isMultiItem) {
      const accessoryThreshold = Math.round(cartValue * 0.3);
      const rawThreshold = cartValue + accessoryThreshold;
      
      const threshold = rawThreshold < 50 ? Math.round(rawThreshold / 5) * 5 
                      : rawThreshold < 200 ? Math.round(rawThreshold / 10) * 10 
                      : Math.round(rawThreshold / 25) * 25;
      
      const discountPercent = 10 + (aggression * 0.8);
      const rawDiscount = threshold * (discountPercent / 100);
      const discountAmount = rawDiscount <= 15 ? Math.round(rawDiscount)
                           : rawDiscount < 20 ? Math.round(rawDiscount / 5) * 5
                           : rawDiscount < 100 ? Math.round(rawDiscount / 10) * 10
                           : Math.round(rawDiscount / 25) * 25;
      
      return {
        type: 'threshold',
        threshold: Math.max(threshold, cartValue + 30),
        amount: Math.max(discountAmount, 10),
        timing: 'immediate',
        confidence: 'low',
        reasoning: `Low propensity + high-ticket ($${cart.avgItemPrice.toFixed(0)}) - aggressive accessory upsell to $${threshold}`
      };
    }
    
    // NORMAL LOW PROPENSITY THRESHOLD
    const rawThreshold = cartValue * 1.4;
    const threshold = rawThreshold < 50 ? Math.round(rawThreshold / 5) * 5 
                    : rawThreshold < 200 ? Math.round(rawThreshold / 10) * 10 
                    : Math.round(rawThreshold / 25) * 25;
    
    const rawDiscount = threshold * 0.15;
    const discountAmount = rawDiscount < 20 ? Math.round(rawDiscount / 5) * 5
                         : rawDiscount < 100 ? Math.round(rawDiscount / 10) * 10
                         : Math.round(rawDiscount / 25) * 25;
    
    return {
      type: 'threshold',
      threshold: threshold,
      amount: Math.max(discountAmount, 10),
      timing: 'immediate',
      confidence: 'low',
      reasoning: `Low propensity but $${cartValue} cart - aggressive threshold offer`
    };
  }
  
  // Conversion mode: Low propensity but decent cart value - go aggressive immediately
  return {
    type: 'percentage',
    amount: 20 + aggression,
    timing: 'immediate', // Show right away, don't wait for exit
    confidence: 'low',
    reasoning: 'Low propensity but high cart - aggressive immediate offer'
  };
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