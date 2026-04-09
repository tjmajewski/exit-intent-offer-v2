// =============================================================================
// PROFITABILITY GUARD
// Ensures discounts don't erode store margins beyond what's sustainable.
// E-commerce average margins are 20-50%. We cap discount at a fraction of
// estimated margin so stores remain profitable even when offering discounts.
// =============================================================================

/**
 * Cap a discount amount to protect store profitability.
 * @param {number} discountAmount - Raw discount amount (percentage or fixed)
 * @param {string} discountType - 'percentage' | 'fixed' | 'threshold'
 * @param {number} cartValue - Current cart value
 * @param {number} aggression - 0-10 aggression setting
 * @returns {number} - Capped discount amount
 */
function capDiscountForProfitability(discountAmount, discountType, cartValue, aggression) {
  // Estimated margin floor: even aggressive discounting shouldn't exceed
  // ~20% of cart value (assumes ~40% average margin, keeping half as profit)
  // Lower aggression = more conservative
  const maxDiscountPercent = 10 + (aggression * 1.5); // 10-25% max based on aggression

  if (discountType === 'percentage') {
    return Math.min(discountAmount, maxDiscountPercent);
  }

  if (discountType === 'fixed' || discountType === 'threshold') {
    const maxFixed = cartValue * (maxDiscountPercent / 100);
    return Math.min(discountAmount, Math.max(maxFixed, 5)); // At least $5
  }

  return discountAmount;
}

// Helper: Detect funnel stage to automatically choose revenue vs conversion goal.
// Replaces the static merchant toggle — the AI now picks the right strategy
// per customer based on their position in the post-ATC journey.
function detectFunnelGoalFromSignals(signals) {
  let revenueScore = 0;
  let conversionScore = 0;

  // Exit page is the strongest funnel-stage signal
  if (signals.exitPage === 'checkout') {
    conversionScore += 40;
  } else if (signals.exitPage === 'cart') {
    conversionScore += 25;
  } else if (signals.exitPage === 'product' || signals.exitPage === 'collection') {
    revenueScore += 25;
  }

  // Cart hesitation = price sensitivity → conversion
  if (signals.cartHesitation > 1) {
    conversionScore += 20;
  } else if (signals.cartHesitation === 0) {
    revenueScore += 10;
  }

  // Failed coupon attempt → wants a discount now
  if (signals.failedCouponAttempt) {
    conversionScore += 30;
  }

  // Cart age: fresh = still shopping, stale = need a push
  if (signals.cartAgeMinutes > 30) {
    conversionScore += 15;
  } else if (signals.cartAgeMinutes != null && signals.cartAgeMinutes < 10) {
    revenueScore += 15;
  }

  // Previous abandoner = high risk → conversion
  if (signals.hasAbandonedBefore) {
    conversionScore += 15;
  }

  // Multiple page views = still browsing = revenue opportunity
  if (signals.pageViews >= 5) {
    revenueScore += 15;
  } else if (signals.pageViews < 2) {
    conversionScore += 5;
  }

  // Low cart value = less room for threshold, direct discount better
  const cartValue = signals.cartValue || 0;
  if (cartValue < 30) {
    conversionScore += 10;
  } else if (cartValue > 100) {
    revenueScore += 10;
  }

  const goal = revenueScore >= conversionScore ? 'revenue' : 'conversion';
  console.log(` [Funnel Stage] revenue=${revenueScore} conversion=${conversionScore} → ${goal}`);
  return goal;
}

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

export async function determineOffer(signals, aggression, _aiGoal, cartValue, shopId = null, plan = 'pro') {
  // Funnel-stage detection: automatically choose revenue (upsell) vs conversion
  // (direct discount) based on customer signals instead of static merchant toggle.
  const aiGoal = detectFunnelGoalFromSignals(signals);
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
          
          if (activePromo.aiStrategy === "decrease") {
            // Reduce exit offers to preserve margin since discount codes stack with site-wide promo
            const maxOffer = Math.max(5, Math.floor(activePromo.amount * 0.3)); // Cap at 30% of promo amount
            aggression = Math.min(aggression, Math.ceil(maxOffer / 2.5)); // Convert to 1-10 scale
            console.log(`AI auto-decreased aggression to preserve margin during ${activePromo.amount}% promo (max exit offer: ${maxOffer}%)`);
          }
        }
      }
    }
  }

  let score = 0;

  // =============================================================================
  // PRO AI SCORING - Determines offer aggressiveness (higher = more likely to convert)
  // Goal: Show modal only when necessary to get a conversion
  // =============================================================================

  // POSITIVE SIGNALS (customer likely to convert with small nudge)
  // -----------------------------------------------------------------------------

  // Returning visitors convert 2-3x better than new visitors
  if (signals.visitFrequency > 1) score += 20;
  if (signals.visitFrequency > 3) score += 10; // Very engaged, been back multiple times

  // Paid traffic is pre-qualified (clicked an ad, showed intent)
  if (signals.trafficSource === 'paid') score += 15;

  // Long time on site = genuine consideration, not accidental visit
  if (signals.timeOnSite > 120) score += 20; // 2+ minutes of browsing
  if (signals.timeOnSite > 300) score += 10; // 5+ minutes = very engaged

  // Engaged browsing behavior
  if (signals.pageViews >= 5) score += 15;
  else if (signals.pageViews >= 3) score += 10;

  // Sweet spot cart values (serious but not huge commitment)
  if (signals.cartValue > 50 && signals.cartValue < 200) score += 10;
  if (signals.cartValue > 100) score += 5; // Higher cart = more invested

  // Logged-in users have accounts = more committed
  if (signals.accountStatus === 'logged_in') score += 15;

  // Deep scroll = read the content, engaged with page
  if (signals.scrollDepth > 75) score += 10;

  // NEGATIVE SIGNALS (customer unlikely to convert, don't waste discount)
  // -----------------------------------------------------------------------------

  // First-time visitors have ~2% conversion rate - be cautious
  if (signals.visitFrequency === 1) score -= 10;

  // Quick exits suggest accidental visit or wrong product
  if (signals.timeOnSite < 30) score -= 15;

  // Mobile has ~50% lower conversion rates than desktop
  if (signals.deviceType === 'mobile') score -= 5;

  // Very low cart values often don't convert regardless of discount
  if (signals.cartValue < 25) score -= 10;

  // Shallow engagement
  if (signals.pageViews < 2) score -= 10;

  // HIGH-VALUE SIGNALS (strong purchase intent indicators)
  // -----------------------------------------------------------------------------

  // Failed coupon attempt = customer explicitly wants a discount (STRONGEST SIGNAL)
  if (signals.failedCouponAttempt) score += 35;

  // Previous abandoner who came back = second chance, high intent
  if (signals.hasAbandonedBefore) score += 25;

  // Cart hesitation (added then removed items) = price sensitivity
  if (signals.cartHesitation > 0) score += 15;

  // Exit from checkout page = was about to buy, something stopped them
  if (signals.exitPage === 'checkout') score += 30;
  if (signals.exitPage === 'cart') score += 15;

  // Long product dwell time = serious consideration
  if (signals.productDwellTime > 60) score += 15;

  // Returning customer with purchase history = knows and trusts the brand
  if (signals.purchaseHistoryCount > 0) score += 20;
  if (signals.purchaseHistoryCount > 3) score += 10; // Loyal customer

  // Cart age - older carts may need a push
  if (signals.cartAgeMinutes > 30) score += 10;
  if (signals.cartAgeMinutes > 60) score += 5;

  // TIME-OF-DAY SIGNALS (customer's local time)
  // Late-night shoppers (10pm-5am) show higher purchase intent — they're
  // browsing deliberately, not casually. Also more impulsive / emotional.
  // Early morning (5am-8am) and lunch (11am-1pm) are moderate intent windows.
  // Mid-afternoon (2pm-5pm) is casual browsing — lowest conversion rates.
  const hour = signals.localHour;
  if (hour !== undefined && hour !== null) {
    if (hour >= 22 || hour < 5) {
      // Late night: high intent, impulsive, willing to treat themselves
      score += 20;
    } else if (hour >= 5 && hour < 8) {
      // Early morning: intentional shopping before the day starts
      score += 10;
    } else if (hour >= 11 && hour < 13) {
      // Lunch break: quick decision window, moderate intent
      score += 5;
    } else if (hour >= 14 && hour < 17) {
      // Mid-afternoon: casual browsing, lowest conversion window
      score -= 5;
    }
    // 8am-11am and 5pm-10pm are neutral — no adjustment
  }

  console.log(` [Pro AI] Intent score: ${score}`);

  // =============================================================================
  // PRO AI: SHOULD WE SHOW? (Adaptive threshold + hard overrides)
  // Uses per-shop learned thresholds when available; falls back to hardcoded
  // defaults for cold-start. Hard overrides for strongest signals are kept.
  // =============================================================================

  const currentCartValue = cartValue || signals.cartValue || 0;

  // HARD OVERRIDE: Negative score = very unlikely to convert (always skip)
  if (score < 0) {
    console.log(` [Pro AI] Negative score (${score}) - no intervention (preserving margin)`);
    return null;
  }

  // HARD OVERRIDE: First-time visitor + quick exit + low cart = accidental visit
  if (signals.visitFrequency === 1 && signals.timeOnSite < 30 && currentCartValue < 50) {
    console.log(` [Pro AI] First-time quick exit with low cart - no intervention`);
    return null;
  }

  // ADAPTIVE THRESHOLD: consult per-shop learned thresholds for the gray zone
  if (shopId) {
    const { default: db } = await import('../db.server.js');
    const { shouldIntervene } = await import('./intervention-threshold.server.js');
    const segment = signals.deviceType === 'mobile' ? 'mobile'
                  : signals.deviceType === 'desktop' ? 'desktop' : 'all';

    const decision = await shouldIntervene(db, shopId, score, segment);
    if (!decision.shouldShow) {
      console.log(` [Pro AI] Adaptive threshold: no intervention for score ${score} bucket ${decision.bucket}${decision.isExploring ? ' (exploring)' : ''}`);
      return null;
    }
    if (decision.isExploring) {
      console.log(` [Pro AI] Adaptive threshold: showing for score ${score} bucket ${decision.bucket} (exploring)`);
    }
  }

  // Derive the dominant trigger reason from signals (for variant evolution tracking).
  // Priority order matches Enterprise hard overrides so the same customer gets
  // the same triggerReason regardless of Pro vs Enterprise tier.
  const triggerReason = signals.failedCouponAttempt ? 'failedCoupon'
    : signals.exitPage === 'checkout' ? 'checkoutExit'
    : signals.cartHesitation > 1 ? 'cartHesitation'
    : signals.cartAgeMinutes > 60 ? 'staleCart'
    : 'general';

  // HIGH SCORE: Customer likely to convert anyway - minimal or no offer
  if (score > 80) {
    console.log(` [Pro AI] High score (${score}) - customer likely to convert, minimal offer`);
    // Still show but with reduced discount
    if (aggression > 0) {
      return {
        type: 'percentage',
        amount: 5, // Minimal discount - they're already likely to buy
        confidence: 'high',
        triggerReason,
        reasoning: `High intent score (${score}) - minimal nudge needed, protecting margin`
      };
    }
  }

  // If aggression is 0, return no-discount offer
  if (aggression === 0) {
    return {
      type: 'no-discount',
      amount: 0,
      confidence: 'high',
      triggerReason,
      reasoning: 'Aggression set to 0 - announcement only mode'
    };
  }

  // =============================================================================
  // PRO AI: WHAT OFFER TO SHOW (based on score and aggression)
  // =============================================================================

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
        triggerReason,
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
      triggerReason,
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
    const cappedOffer = capDiscountForProfitability(Math.round(conservativeOffer), 'percentage', currentCartValue, aggression);
    return {
      type: 'percentage',
      amount: Math.min(cappedOffer, 15), // Cap at 15%
      confidence: 'high',
      triggerReason,
      reasoning: `High-ticket single item ($${cart.avgItemPrice.toFixed(0)}) - conservative discount to close (margin-protected)`
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
    const rawFixed = Math.min(Math.max(Math.round(finalOffer / 2), 5), 10);
    const cappedFixed = capDiscountForProfitability(rawFixed, 'fixed', currentCartValue, aggression);
    return {
      type: 'fixed',
      amount: cappedFixed,
      confidence: score > 60 ? 'high' : 'medium',
      triggerReason,
      reasoning: `Conversion mode: Small cart, offering fixed discount (margin-protected)`
    };
  } else {
    // For larger carts, use percentage (5-25%)
    const rawPercent = Math.min(Math.max(Math.round(finalOffer), 5), 25);
    const cappedPercent = capDiscountForProfitability(rawPercent, 'percentage', currentCartValue, aggression);
    return {
      type: 'percentage',
      amount: cappedPercent,
      confidence: score > 60 ? 'high' : 'medium',
      triggerReason,
      reasoning: `Conversion mode: Score ${score}, offering ${cappedPercent}% discount (margin-protected)`
    };
  }
} // Close determineOffer function // Close determineOffer function

/**
 * Enterprise AI - Advanced decision engine with full signal access
 *
 * Key advantages over Pro:
 * 1. Access to high-value signals (failed coupons, exit page context, cart age)
 * 2. Smarter "should we even show" logic - doesn't waste discounts
 * 3. Dynamic timing control (immediate, exit_intent, or delayed)
 * 4. Budget-aware offer sizing
 * 5. Promotional intelligence integration
 * 6. Profitability-aware: understands that stores need to be profitable,
 *    not just maximize raw revenue. No intervention is sometimes the best outcome.
 */
export async function enterpriseAI(signals, aggression, _aiGoal = 'revenue', shopId = null) {
  // Funnel-stage detection: automatically choose revenue (upsell) vs conversion
  // (direct discount) based on customer signals instead of static merchant toggle.
  const aiGoal = detectFunnelGoalFromSignals(signals);
  const propensity = signals.propensityScore;
  const cartValue = signals.cartValue || 0;
  const cart = analyzeCartComposition(signals);

  console.log(' [Enterprise AI] Cart analysis:', cart);
  console.log(' [Enterprise AI] Propensity:', propensity);
  console.log(' [Enterprise AI] High-value signals:', {
    failedCouponAttempt: signals.failedCouponAttempt,
    exitPage: signals.exitPage,
    cartAgeMinutes: signals.cartAgeMinutes,
    cartHesitation: signals.cartHesitation,
    localHour: signals.localHour
  });

  // TIME-OF-DAY INTELLIGENCE
  // Late-night shoppers convert at higher rates with smaller discounts (impulse buying).
  // Afternoon browsers need bigger incentives (casual browsing, more comparison shopping).
  const hour = signals.localHour;
  const isLateNight = hour !== undefined && (hour >= 22 || hour < 5);
  const isAfternoon = hour !== undefined && (hour >= 14 && hour < 17);

  // =============================================================================
  // ENTERPRISE-EXCLUSIVE: SHOULD WE SHOW AT ALL?
  // Hard overrides for strongest signals, then adaptive thresholds for the gray zone.
  // =============================================================================

  // HARD OVERRIDE: Failed coupon attempt - ALWAYS show, they want a discount
  if (signals.failedCouponAttempt) {
    console.log(' [Enterprise AI] Failed coupon detected - guaranteed show');
    const offer = calculateOfferForDiscountSeeker(signals, aggression, aiGoal, cartValue, cart);
    return { ...offer, timing: 'immediate', confidence: 'high', triggerReason: 'failedCoupon', reasoning: 'Customer tried a coupon code - they want a discount' };
  }

  // HARD OVERRIDE: Checkout exit is highest intent - ALWAYS show
  if (signals.exitPage === 'checkout') {
    console.log(' [Enterprise AI] Checkout exit detected - high-value recovery');
    const offer = calculateCheckoutRecoveryOffer(signals, aggression, cartValue, cart);
    return { ...offer, timing: 'immediate', confidence: 'high', triggerReason: 'checkoutExit', reasoning: 'Customer abandoned at checkout - recovery offer' };
  }

  // HARD OVERRIDE: Cart hesitation indicates price sensitivity - ALWAYS show
  if (signals.cartHesitation > 1) {
    console.log(' [Enterprise AI] Cart hesitation detected - price sensitive customer');
    const offer = calculateOfferForPriceSensitive(signals, aggression, aiGoal, cartValue, cart);
    return { ...offer, timing: 'exit_intent', confidence: 'medium', triggerReason: 'cartHesitation', reasoning: 'Customer showing price sensitivity (add/remove behavior)' };
  }

  // HARD OVERRIDE: Stale cart may need a push - ALWAYS show
  if (signals.cartAgeMinutes > 60) {
    console.log(' [Enterprise AI] Stale cart detected (' + signals.cartAgeMinutes + ' minutes old)');
    const offer = calculateStaleCartOffer(signals, aggression, aiGoal, cartValue, cart);
    return { ...offer, timing: 'immediate', confidence: 'medium', triggerReason: 'staleCart', reasoning: 'Cart has been sitting for over an hour' };
  }

  // ADAPTIVE THRESHOLD: consult per-shop learned thresholds for the gray zone.
  // Replaces the old hardcoded propensity > 85/75/40 checks.
  if (shopId && propensity != null) {
    const { default: db } = await import('../db.server.js');
    const { shouldIntervene } = await import('./intervention-threshold.server.js');
    const segment = signals.deviceType === 'mobile' ? 'mobile'
                  : signals.deviceType === 'desktop' ? 'desktop' : 'all';

    const decision = await shouldIntervene(db, shopId, propensity, segment);
    if (!decision.shouldShow) {
      console.log(` [Enterprise AI] Adaptive threshold: no intervention for propensity ${propensity} bucket ${decision.bucket}${decision.isExploring ? ' (exploring)' : ''}`);
      return null;
    }
    if (decision.isExploring) {
      console.log(` [Enterprise AI] Adaptive threshold: showing for propensity ${propensity} bucket ${decision.bucket} (exploring)`);
    }
  }

  // =============================================================================
  // ENTERPRISE: WHAT OFFER TO SHOW (based on propensity and aggression)
  // =============================================================================

  // High propensity (>75) = likely to buy anyway — minimal offer
  if (propensity > 75) {
    
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
        triggerReason: 'general',
        reasoning: `High propensity - encouraging cart increase from $${cartValue} to $${threshold}`
      };
    }

    // Conversion mode: Show small discount - they're already likely to convert
    return {
      type: 'percentage',
      amount: 5,
      timing: 'exit_intent',
      confidence: 'high',
      triggerReason: 'general',
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
          triggerReason: 'general',
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
        triggerReason: 'general',
        reasoning: `Medium propensity - encouraging cart increase from $${cartValue} to $${threshold}`
      };
    }
    
    // Conversion mode: Percentage offer — adjust by time of day
    let offer = 10 + (aggression * 1.5);
    let timeReasoning = '';
    if (isLateNight) {
      offer *= 0.8; // Late-night impulse buyers need less incentive
      timeReasoning = ' (reduced for late-night impulse window)';
    } else if (isAfternoon) {
      offer *= 1.15; // Afternoon browsers need more nudging
      timeReasoning = ' (increased for afternoon casual browsing)';
    }
    return {
      type: 'percentage',
      amount: Math.round(offer),
      timing: 'exit_intent',
      confidence: 'medium',
      triggerReason: 'general',
      reasoning: `Medium propensity - standard offer${timeReasoning}`
    };
  }
  
  // Low propensity (<40) = aggressive offer needed
  // (The adaptive threshold already decided to show — these customers need a big nudge)
  
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
        triggerReason: 'general',
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
      triggerReason: 'general',
      reasoning: `Low propensity but $${cartValue} cart - aggressive threshold offer`
    };
  }

  // Conversion mode: Low propensity but decent cart value - go aggressive immediately
  return {
    type: 'percentage',
    amount: 20 + aggression,
    timing: 'immediate', // Show right away, don't wait for exit
    confidence: 'low',
    triggerReason: 'general',
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

// =============================================================================
// ENTERPRISE AI - Advanced Signal-Based Offer Calculations
// =============================================================================

/**
 * Calculate offer for customers who tried a coupon code
 * They explicitly want a discount - give them one that converts
 */
function calculateOfferForDiscountSeeker(signals, aggression, aiGoal, cartValue, cart) {
  // They want a discount, so give them one - but be smart about it

  if (aiGoal === 'revenue' && cartValue > 30) {
    // Try to increase cart size with threshold offer
    const rawThreshold = cartValue * 1.25; // 25% increase target
    const threshold = roundToNiceNumber(rawThreshold);
    const discountPercent = 10 + (aggression * 0.5);
    const discountAmount = roundToNiceNumber(threshold * (discountPercent / 100));

    return {
      type: 'threshold',
      threshold: Math.max(threshold, cartValue + 15),
      amount: Math.max(discountAmount, 5)
    };
  }

  // Conversion mode - straight discount
  const baseDiscount = 10 + (aggression * 1.5);
  return {
    type: 'percentage',
    amount: Math.min(Math.round(baseDiscount), 25)
  };
}

/**
 * Calculate offer for checkout abandonment recovery
 * Highest intent signal - they were about to buy
 */
function calculateCheckoutRecoveryOffer(signals, aggression, cartValue, cart) {
  // They were at checkout - small nudge should work
  // Don't give away too much, they're already committed

  if (cart.isHighTicket) {
    // High ticket item at checkout - minimal discount needed
    return {
      type: 'percentage',
      amount: 5 + Math.floor(aggression * 0.5) // 5-10%
    };
  }

  // Standard checkout recovery
  const discount = 8 + (aggression * 0.8); // 8-16%
  return {
    type: 'percentage',
    amount: Math.min(Math.round(discount), 15)
  };
}

/**
 * Calculate offer for price-sensitive customers (cart hesitation)
 * They're considering but price is a barrier
 */
function calculateOfferForPriceSensitive(signals, aggression, aiGoal, cartValue, cart) {
  // They're price sensitive, so discount is key

  if (aiGoal === 'revenue' && cartValue > 40) {
    // Threshold offer - get them to add more but give good discount
    const rawThreshold = cartValue * 1.2;
    const threshold = roundToNiceNumber(rawThreshold);
    const discountPercent = 12 + (aggression * 1);
    const discountAmount = roundToNiceNumber(threshold * (discountPercent / 100));

    return {
      type: 'threshold',
      threshold: Math.max(threshold, cartValue + 10),
      amount: Math.max(discountAmount, 5)
    };
  }

  // Conversion - give decent discount since they're price sensitive
  const baseDiscount = 12 + (aggression * 1.5);
  return {
    type: 'percentage',
    amount: Math.min(Math.round(baseDiscount), 20)
  };
}

/**
 * Calculate offer for stale carts (items sitting for a while)
 * They've been thinking about it - nudge them to complete
 */
function calculateStaleCartOffer(signals, aggression, aiGoal, cartValue, cart) {
  // Cart has been sitting - they're undecided

  if (aiGoal === 'revenue' && cartValue > 50) {
    // Try to get them to add more
    const rawThreshold = cartValue * 1.3;
    const threshold = roundToNiceNumber(rawThreshold);
    const discountPercent = 10 + (aggression * 0.8);
    const discountAmount = roundToNiceNumber(threshold * (discountPercent / 100));

    return {
      type: 'threshold',
      threshold: Math.max(threshold, cartValue + 20),
      amount: Math.max(discountAmount, 5)
    };
  }

  // Conversion - moderate discount to push them over the edge
  const baseDiscount = 10 + aggression;
  return {
    type: 'percentage',
    amount: Math.min(Math.round(baseDiscount), 18)
  };
}

/**
 * Round to psychologically appealing numbers
 */
function roundToNiceNumber(value) {
  if (value <= 15) return Math.round(value);
  if (value < 50) return Math.round(value / 5) * 5;
  if (value < 200) return Math.round(value / 10) * 10;
  return Math.round(value / 25) * 25;
}