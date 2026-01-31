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

  console.log(` [Pro AI] Intent score: ${score}`);

  // =============================================================================
  // PRO AI: SHOULD WE SHOW? (simpler logic than Enterprise)
  // Goal: Don't waste discounts on customers who won't convert
  // =============================================================================

  const currentCartValue = cartValue || signals.cartValue || 0;

  // DON'T SHOW: Very low score + low cart = unlikely to convert
  if (score < 20 && currentCartValue < 40) {
    console.log(` [Pro AI] Score too low (${score}) with small cart ($${currentCartValue}) - skipping`);
    return null;
  }

  // DON'T SHOW: Negative score = very unlikely to convert
  if (score < 0) {
    console.log(` [Pro AI] Negative score (${score}) - not worth showing`);
    return null;
  }

  // DON'T SHOW: First-time visitor + quick exit + low cart = accidental visit
  if (signals.visitFrequency === 1 && signals.timeOnSite < 30 && currentCartValue < 50) {
    console.log(` [Pro AI] First-time quick exit with low cart - skipping`);
    return null;
  }

  // HIGH SCORE: Customer likely to convert anyway - minimal or no offer
  if (score > 80) {
    console.log(` [Pro AI] High score (${score}) - customer likely to convert, minimal offer`);
    // Still show but with reduced discount
    if (aggression > 0) {
      return {
        type: 'percentage',
        amount: 5, // Minimal discount - they're already likely to buy
        confidence: 'high',
        reasoning: `High intent score (${score}) - minimal nudge needed`
      };
    }
  }

  // If aggression is 0, return no-discount offer
  if (aggression === 0) {
    return {
      type: 'no-discount',
      amount: 0,
      confidence: 'high',
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

/**
 * Enterprise AI - Advanced decision engine with full signal access
 *
 * Key advantages over Pro:
 * 1. Access to high-value signals (failed coupons, exit page context, cart age)
 * 2. Smarter "should we even show" logic - doesn't waste discounts
 * 3. Dynamic timing control (immediate, exit_intent, or delayed)
 * 4. Budget-aware offer sizing
 * 5. Promotional intelligence integration
 */
export function enterpriseAI(signals, aggression, aiGoal = 'revenue') {
  const propensity = signals.propensityScore;
  const cartValue = signals.cartValue || 0;
  const cart = analyzeCartComposition(signals);

  console.log(' [Enterprise AI] Cart analysis:', cart);
  console.log(' [Enterprise AI] Propensity:', propensity);
  console.log(' [Enterprise AI] High-value signals:', {
    failedCouponAttempt: signals.failedCouponAttempt,
    exitPage: signals.exitPage,
    cartAgeMinutes: signals.cartAgeMinutes,
    cartHesitation: signals.cartHesitation
  });

  // =============================================================================
  // ENTERPRISE-EXCLUSIVE: SHOULD WE SHOW AT ALL?
  // Goal: Only show modal when necessary to get the conversion
  // =============================================================================

  // HIGH-VALUE SIGNAL: Failed coupon attempt - ALWAYS show, they want a discount
  if (signals.failedCouponAttempt) {
    console.log(' [Enterprise AI] Failed coupon detected - guaranteed show');
    const offer = calculateOfferForDiscountSeeker(signals, aggression, aiGoal, cartValue, cart);
    return { ...offer, timing: 'immediate', confidence: 'high', reasoning: 'Customer tried a coupon code - they want a discount' };
  }

  // EXIT PAGE CONTEXT: Checkout exit is highest intent
  if (signals.exitPage === 'checkout') {
    console.log(' [Enterprise AI] Checkout exit detected - high-value recovery');
    // They were about to buy - give them a reason to complete
    const offer = calculateCheckoutRecoveryOffer(signals, aggression, cartValue, cart);
    return { ...offer, timing: 'immediate', confidence: 'high', reasoning: 'Customer abandoned at checkout - recovery offer' };
  }

  // CART HESITATION: Add/remove behavior indicates price sensitivity
  if (signals.cartHesitation > 1) {
    console.log(' [Enterprise AI] Cart hesitation detected - price sensitive customer');
    const offer = calculateOfferForPriceSensitive(signals, aggression, aiGoal, cartValue, cart);
    return { ...offer, timing: 'exit_intent', confidence: 'medium', reasoning: 'Customer showing price sensitivity (add/remove behavior)' };
  }

  // CART AGE: Old carts may need a push
  if (signals.cartAgeMinutes > 60) {
    console.log(' [Enterprise AI] Stale cart detected (' + signals.cartAgeMinutes + ' minutes old)');
    // They've been thinking about it for a while - nudge them
    const offer = calculateStaleCartOffer(signals, aggression, aiGoal, cartValue, cart);
    return { ...offer, timing: 'immediate', confidence: 'medium', reasoning: 'Cart has been sitting for over an hour' };
  }
  
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