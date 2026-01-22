import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createPercentageDiscount, createFixedDiscount, createThresholdDiscount } from "../utils/discount-codes";
import { getMetaInsight, shouldUseMetaLearning } from "../utils/meta-learning.js";

export async function action({ request }) {
  const { default: db } = await import("../db.server.js");
  const { determineOffer, checkBudget, enterpriseAI } = await import("../utils/ai-decision.server.js");
  try{
    const { admin } = await authenticate.public.appProxy(request);
    const { shop, signals } = await request.json();
    
    if (!shop || !signals) {
      return json({ error: "Missing shop or signals" }, { status: 400 });
    }
    
    // Get shop settings from metafield
    const shopQuery = await admin.graphql(`
      query {
        shop {
          id
          metafield(namespace: "exit_intent", key: "settings") {
            value
          }
        }
      }
    `);
    
    const shopData = await shopQuery.json();
    const shopId = shopData.data.shop.id;
    const settingsValue = shopData.data.shop?.metafield?.value;
    
    if (!settingsValue) {
      return json({ error: "Shop settings not found" }, { status: 404 });
    }
    
    const settings = JSON.parse(settingsValue);
    
    // Check if AI mode is enabled
    if (settings.mode !== 'ai') {
      return json({ error: "AI mode not enabled" }, { status: 400 });
    }
    
    const {
      aiGoal,
      aggression,
      budgetEnabled,
      budgetAmount,
      budgetPeriod,
      aiDiscountCodeMode,
      aiGenericDiscountCode,
      aiDiscountCodePrefix,
      offerType
    } = settings;
    
    // Find or create shop in database
    let shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });
    
    if (!shopRecord) {
      shopRecord = await db.shop.create({
        data: {
          shopifyDomain: shop,
          mode: 'ai',
          aiGoal: aiGoal || 'revenue',
          aggression: aggression || 5,
          budgetEnabled: budgetEnabled || false,
          budgetAmount: budgetAmount || 500,
          budgetPeriod: budgetPeriod || 'month'
        }
      });
      
      // Initialize copy variants for new shop
      const { initializeCopyVariants } = await import('../utils/copy-variants.js');
      await initializeCopyVariants(db, shopRecord.id);
      console.log('[AI Decision] Initialized copy variants for new shop');
      
      // Auto-detect brand colors for Enterprise customers
      if (shopRecord.plan === 'enterprise') {
        try {
          const { detectBrandColors } = await import('../utils/brand-detection.js');
          const brandColors = await detectBrandColors(admin);
          
          if (brandColors) {
            await db.shop.update({
              where: { id: shopRecord.id },
              data: {
                brandPrimaryColor: brandColors.primary,
                brandSecondaryColor: brandColors.secondary,
                brandAccentColor: brandColors.accent,
                brandFont: brandColors.font
              }
            });
            console.log('[Brand Detection] Auto-detected colors:', brandColors);
          }
        } catch (error) {
          console.error('[Brand Detection] Failed to auto-detect:', error);
          // Don't fail shop creation if brand detection fails
        }
      }
    }
    
    // Check budget if enabled
    if (budgetEnabled) {
      const budgetCheck = await checkBudget(db, shopRecord.id, budgetPeriod);
      
      if (!budgetCheck.hasRoom) {
        console.log(`⚠️ Budget exhausted for ${shop}. Showing no-discount modal.`);
        
        // Log AI decision
        await db.aIDecision.create({
          data: {
            shopId: shopRecord.id,
            signals: JSON.stringify(signals),
            decision: JSON.stringify({
              type: 'budget-exhausted',
              amount: 0,
              reasoning: 'Budget cap reached'
            })
          }
        });
        
        return json({
          shouldShow: true,
          decision: {
            type: 'no-discount',
            amount: 0,
            code: null,
            message: 'Budget exhausted - showing announcement only'
          }
        });
      }
      
      console.log(`✓ Budget check passed. Remaining: $${budgetCheck.remaining}`);
    }
    
    // NEW: Use variant-based evolution system
    const { selectBaseline } = await import('../utils/baseline-selector.js');
    const { selectVariantForImpression, getLiveVariants, seedInitialPopulation, recordImpression } = 
      await import('../utils/variant-engine.js');
    
    // Step 1: Determine which baseline to use (revenue/conversion × discount/no-discount)
    let baseline = selectBaseline(signals, aiGoal);
    
    // CRITICAL: If aggression is 0 OR AI determines no offer needed, use pure_reminder
    // This prevents false advertising (modal copy promising offers we don't give)
    if (aggression === 0) {
      baseline = 'pure_reminder';
      console.log(`[Variant Selection] Aggression = 0 → forcing pure_reminder baseline`);
    }
    
    console.log(`[Variant Selection] Baseline: ${baseline}`);
    
    // Step 1.5: Determine segment (device-specific evolution)
    const deviceType = signals.deviceType || 'unknown';
    const segment = deviceType === 'mobile' ? 'mobile' : 
                    deviceType === 'desktop' ? 'desktop' : 'all';
    console.log(`[Variant Selection] Segment: ${segment}`);
    
    // Step 2: Check if variants exist for this baseline, if not seed them
    const existingVariants = await getLiveVariants(shopRecord.id, baseline, segment);
    
    if (existingVariants.length === 0) {
      console.log(`[Variant Selection] No variants found. Seeding initial population...`);
      await seedInitialPopulation(shopRecord.id, baseline, segment);
    }
    
    // Step 3: Use Thompson Sampling to select variant
    const selectedVariant = await selectVariantForImpression(shopRecord.id, baseline, segment);
    console.log(`[Variant Selection] Selected ${selectedVariant.variantId} (Gen ${selectedVariant.generation})`);
    
    // Step 4: Build decision from variant genes
    const decision = {
      type: baseline.includes('revenue') ? 'threshold' : 'percentage',
      amount: selectedVariant.offerAmount,
      threshold: baseline.includes('revenue') ? Math.round(signals.cartValue * 1.3) : null,
      headline: selectedVariant.headline,
      subhead: selectedVariant.subhead,
      cta: selectedVariant.cta,
      redirect: selectedVariant.redirect,
      urgency: selectedVariant.urgency,
      variantId: selectedVariant.id,
      variantPublicId: selectedVariant.variantId,
      baseline: baseline,
      confidence: selectedVariant.impressions > 100 ? 0.8 : 0.5
    };
    
    console.log('[Variant Engine] Decision:', decision);
    
    // Step 5: Record impression (for evolution tracking)
    const impressionRecord = await recordImpression(selectedVariant.id, shopRecord.id, {
      segment: segment,
      deviceType: signals.deviceType || 'unknown',
      trafficSource: signals.trafficSource || 'unknown',
      cartValue: signals.cartValue
    });
    
    // If no discount needed, return early
    if (decision.type === 'no-discount') {
      await db.aIDecision.create({
        data: {
          shopId: shopRecord.id,
          signals: JSON.stringify(signals),
          decision: JSON.stringify(decision)
        }
      });
      
      return json({
        shouldShow: true,
        decision: {
          type: 'no-discount',
          amount: 0,
          code: null,
          message: decision.reasoning
        }
      });
    }
    
    // Create discount code based on type and mode
    let discountResult;
    let offerAmount = decision.amount;

    // MODE: Generic - Reuse the same code for all customers (AI mode uses AI-specific settings)
    if (aiDiscountCodeMode === 'generic' && aiGenericDiscountCode) {
      console.log(`[AI Mode] Using generic discount code: ${aiGenericDiscountCode}`);

      // For generic codes, we don't create a new Shopify discount (it already exists)
      // Just return the code with no expiry
      discountResult = {
        code: aiGenericDiscountCode,
        expiresAt: null // Generic codes don't expire
      };
    }
    // MODE: Unique - Create new code with 24h expiry (default behavior)
    else {
      const prefix = aiDiscountCodePrefix || 'EXIT';
      console.log(`[AI Mode] Creating unique discount code with prefix: ${prefix}`);

      if (decision.type === 'percentage') {
        discountResult = await createPercentageDiscount(admin, decision.amount, prefix);
      } else if (decision.type === 'fixed') {
        discountResult = await createFixedDiscount(admin, decision.amount, prefix);
      } else if (decision.type === 'threshold') {
        discountResult = await createThresholdDiscount(admin, decision.threshold, decision.amount, prefix);
        offerAmount = decision.amount; // Store discount amount, not threshold
      }
    }
    
    // Track discount offer in database
    const discountOffer = await db.discountOffer.create({
      data: {
        shopId: shopRecord.id,
        discountCode: discountResult.code,
        offerType: decision.type,
        amount: offerAmount,
        cartValue: signals.cartValue,
        expiresAt: discountResult.expiresAt,
        mode: aiDiscountCodeMode === 'generic' ? 'generic' : 'unique',
        redeemed: false
      }
    });
    
    // Log AI decision
    await db.aIDecision.create({
      data: {
        shopId: shopRecord.id,
        signals: JSON.stringify(signals),
        decision: JSON.stringify(decision),
        offerId: discountOffer.id
      }
    });
    
    console.log(`✓ AI offer created: ${discountResult.code} (${decision.type}, $${offerAmount})`);
    
    // Variant copy is already in decision object from variant genes
    // No need for separate copy variant selection
    
    // Check if shop has Enterprise plan (copy optimization enabled)
    // Use database plan, not metafield
    const isEnterprise = shopRecord.plan === 'enterprise' || settings.copyOptimization === true;
    
    // Build response - only include variant for Enterprise users
    const response = {
      shouldShow: true,
      decision: {
        type: decision.type,
        amount: decision.amount,
        threshold: decision.threshold || null,
        timing: decision.timing || null, // Enterprise AI timing control
        code: discountResult.code,
        confidence: decision.confidence,
        expiresAt: discountResult.expiresAt,
        baseline: decision.baseline // Include baseline for tracking
      }
    };
    
    // Add variant copy and genes to response
    response.decision.variant = {
      headline: decision.headline,
      subhead: decision.subhead,
      cta: decision.cta,
      redirect: decision.redirect,
      urgency: decision.urgency
    };
    response.decision.variantId = decision.variantId;
    response.decision.variantPublicId = decision.variantPublicId;
    response.decision.impressionId = impressionRecord.id; // For tracking clicks/conversions
    
    console.log(`[Variant Engine] Returning variant ${decision.variantPublicId} (Gen ${selectedVariant.generation})`);
    
    return json(response);
    
  } catch (error) {
    console.error("AI decision error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}
