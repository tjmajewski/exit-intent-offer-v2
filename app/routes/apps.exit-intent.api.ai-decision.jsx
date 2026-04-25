import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createPercentageDiscount, createFixedDiscount, createThresholdDiscount, getDiscountCodeDetails } from "../utils/discount-codes";
import { getMetaInsight, shouldUseMetaLearning } from "../utils/meta-learning.js";
import { trackAnalyticsEvent } from "../utils/analytics-metafield.js";
import { composeSegmentKey } from "../utils/segment-key.js";

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
        console.log(` Budget exhausted for ${shop}. Showing no-discount modal.`);
        
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
      
      console.log(` Budget check passed. Remaining: $${budgetCheck.remaining}`);
    }
    
    // =========================================================================
    // HOLDOUT GROUP: 5% of eligible traffic is randomly excluded from ALL
    // intervention. This happens BEFORE hard overrides and Thompson Sampling
    // so the holdout is unbiased. Holdout outcomes are recorded for
    // incrementality measurement but never fed into the learning loop.
    // =========================================================================
    const HOLDOUT_RATE = 0.05;
    const isHoldout = Math.random() < HOLDOUT_RATE;

    if (isHoldout) {
      const holdoutDecision = {
        type: 'holdout',
        amount: 0,
        reasoning: 'Randomly assigned to holdout group for incrementality measurement'
      };

      const aiDecisionRecord = await db.aIDecision.create({
        data: {
          shopId: shopRecord.id,
          signals: JSON.stringify(signals),
          decision: JSON.stringify(holdoutDecision)
        }
      });

      // Record holdout outcome — excluded from threshold learning
      const { recordInterventionOutcome: recordHoldout } = await import('../utils/intervention-threshold.server.js');
      const holdoutSegment = (signals.deviceType === 'mobile') ? 'mobile'
                           : (signals.deviceType === 'desktop') ? 'desktop' : 'all';
      await recordHoldout(db, {
        shopId: shopRecord.id,
        wasShown: false,
        isHoldout: true,
        propensityScore: signals.propensityScore ?? null,
        cartValue: signals.cartValue,
        deviceType: signals.deviceType,
        trafficSource: signals.trafficSource,
        segment: holdoutSegment,
        aiDecisionId: aiDecisionRecord.id
      }).catch(e => console.error('[Holdout] Failed to record holdout outcome:', e));

      console.log(`[AI Decision] Holdout group for ${shop} — no intervention (incrementality measurement)`);

      return json({
        shouldShow: false,
        isHoldout: true,
        decision: holdoutDecision,
        aiDecisionId: aiDecisionRecord.id
      });
    }

    // PRE-CHECK: Run AI scoring to determine if intervention is warranted
    // This enables "no_intervention" as a learned outcome
    // Enterprise customers use the dedicated enterpriseAI() engine which
    // leverages propensity scores, high-value signals, and timing control.
    // Pro customers use the simpler determineOffer() intent-score logic.
    const isEnterprisePlan = (shopRecord.plan || 'pro') === 'enterprise';

    // Enterprise promotional intelligence: check for active site-wide promos
    // and adjust aggression before the AI decision runs.
    // (Pro handles this inside determineOffer itself.)
    let effectiveAggression = aggression;
    if (isEnterprisePlan) {
      const activePromo = await db.promotion.findFirst({
        where: {
          shopId: shopRecord.id,
          status: "active",
          classification: "site_wide",
          aiStrategy: { not: "ignore" }
        },
        orderBy: { amount: 'desc' }
      });

      if (activePromo) {
        console.log(` [Enterprise] Active site-wide promo: ${activePromo.code} - ${activePromo.amount}%`);

        if (activePromo.merchantOverride) {
          const override = JSON.parse(activePromo.merchantOverride);
          console.log(` Merchant override active: ${override.type}`);

          if (override.type === 'pause') {
            // Record no-intervention and return early
            await db.aIDecision.create({
              data: {
                shopId: shopRecord.id,
                signals: JSON.stringify(signals),
                decision: JSON.stringify({ type: 'no_intervention', amount: 0, reasoning: 'Merchant override: paused during promo' })
              }
            });
            return json({ shouldShow: false, decision: { type: 'no_intervention', amount: 0, reasoning: 'Merchant override: paused during promo' } });
          }

          if (override.type === 'force_zero') {
            return json({
              shouldShow: true,
              decision: {
                type: 'no-discount',
                amount: 0,
                code: null,
                message: `Merchant override: announcement mode during ${activePromo.code}`
              }
            });
          }

          effectiveAggression = override.customAggression || aggression;
        } else {
          if (activePromo.aiStrategy === "pause") {
            console.log("AI paused due to site-wide promotion");
            await db.aIDecision.create({
              data: {
                shopId: shopRecord.id,
                signals: JSON.stringify(signals),
                decision: JSON.stringify({ type: 'no_intervention', amount: 0, reasoning: 'AI paused during site-wide promo' })
              }
            });
            return json({ shouldShow: false, decision: { type: 'no_intervention', amount: 0, reasoning: 'AI paused during site-wide promo' } });
          }

          if (activePromo.aiStrategy === "decrease") {
            const maxOffer = Math.max(5, Math.floor(activePromo.amount * 0.3));
            effectiveAggression = Math.min(aggression, Math.ceil(maxOffer / 2.5));
            console.log(`AI auto-decreased aggression to preserve margin during ${activePromo.amount}% promo (max exit offer: ${maxOffer}%)`);
          }
        }
      }
    }

    const preScore = isEnterprisePlan
      ? await enterpriseAI(signals, effectiveAggression, aiGoal, shopRecord.id)
      : await determineOffer(
          signals,
          aggression,
          aiGoal,
          signals.cartValue || 0,
          shopRecord.id,
          shopRecord.plan || 'pro'
        );

    if (preScore === null) {
      // AI determined no modal intervention is needed — record this decision
      // so the system can learn that "do nothing" was the right call
      const noInterventionDecision = {
        type: 'no_intervention',
        amount: 0,
        reasoning: 'AI determined no modal intervention needed for this customer',
        signals_summary: {
          cartValue: signals.cartValue,
          visitFrequency: signals.visitFrequency,
          timeOnSite: signals.timeOnSite,
          deviceType: signals.deviceType,
          localHour: signals.localHour,
        }
      };

      const aiDecisionRecord = await db.aIDecision.create({
        data: {
          shopId: shopRecord.id,
          signals: JSON.stringify(signals),
          decision: JSON.stringify(noInterventionDecision)
        }
      });

      // Record intervention outcome for adaptive threshold learning
      const { recordInterventionOutcome } = await import('../utils/intervention-threshold.server.js');
      const segment = (signals.deviceType === 'mobile') ? 'mobile'
                    : (signals.deviceType === 'desktop') ? 'desktop' : 'all';
      await recordInterventionOutcome(db, {
        shopId: shopRecord.id,
        wasShown: false,
        propensityScore: signals.propensityScore ?? null,
        intentScore: isEnterprisePlan ? null : (preScore?.intentScore ?? null),
        cartValue: signals.cartValue,
        deviceType: signals.deviceType,
        trafficSource: signals.trafficSource,
        segment,
        aiDecisionId: aiDecisionRecord.id
      }).catch(e => console.error('[Threshold] Failed to record no_intervention outcome:', e));

      // Track as an analytics event for learning
      trackAnalyticsEvent(admin, 'no_intervention').catch(e =>
        console.error('[Analytics] Failed to track no_intervention event:', e)
      );

      console.log(`[AI Decision] No intervention for ${shop}: ${noInterventionDecision.reasoning}`);

      return json({
        shouldShow: false,
        decision: noInterventionDecision,
        aiDecisionId: aiDecisionRecord.id
      });
    }

    // NEW: Use variant-based evolution system
    const { selectBaseline } = await import('../utils/baseline-selector.js');
    const { selectVariantForImpression, getLiveVariants, seedInitialPopulation, recordImpression } =
      await import('../utils/variant-engine.js');

    // Step 1: Determine which baseline to use (revenue/conversion × discount/no-discount)
    let baseline = selectBaseline(signals, aiGoal);

    // AGGRESSION CONTROLS:
    // 1. Frequency — aggression acts as a probability ceiling for discount offers.
    //    Aggression 5 → ~50% of visitors get a discount baseline, rest get no-discount copy.
    //    Aggression 10 → up to 100% can get discounts. Aggression 0 → pure reminder only.
    // 2. Max discount size — aggression caps how large the discount can be (see Step 4).
    // Use effectiveAggression which accounts for Enterprise promo adjustments.
    const aggressionNormalized = Math.max(0, Math.min(10, effectiveAggression)) / 10; // 0.0 – 1.0

    if (effectiveAggression === 0) {
      baseline = 'pure_reminder';
      console.log(`[Variant Selection] Aggression = 0 → forcing pure_reminder baseline`);
    } else if (baseline.includes('with_discount')) {
      // Roll against aggression to decide if this visitor gets a discount
      const discountRoll = Math.random();
      if (discountRoll > aggressionNormalized) {
        // Downgrade to no-discount version of the same goal
        const noDiscountBaseline = baseline.replace('with_discount', 'no_discount');
        console.log(`[Variant Selection] Aggression ${effectiveAggression}/10 — roll ${discountRoll.toFixed(2)} > ${aggressionNormalized.toFixed(2)} → downgrading to ${noDiscountBaseline}`);
        baseline = noDiscountBaseline;
      } else {
        console.log(`[Variant Selection] Aggression ${effectiveAggression}/10 — roll ${discountRoll.toFixed(2)} ≤ ${aggressionNormalized.toFixed(2)} → keeping discount baseline`);
      }
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
    // Pass triggerReason so Thompson Sampling can use trigger-specific conversion stats.
    // Phase 2C: compose segmentKey up-front and enable archetype priors for
    // Enterprise plans so per-segment archetype winners are actually promoted
    // at runtime (not just visible on the dashboard).
    const triggerReason = preScore?.triggerReason || 'general';
    const resolvedPageType = signals.pageType || signals.exitPage || null;
    const resolvedPromoInCart = signals.promoInCart === true;
    const segmentKey = composeSegmentKey({
      deviceType: signals.deviceType,
      trafficSource: signals.trafficSource,
      accountStatus: signals.accountStatus,
      pageType: resolvedPageType,
      promoInCart: resolvedPromoInCart,
      visitFrequency: signals.visitFrequency
    });
    // Phase 2E: archetype priors active for both Pro and Enterprise.
    // Pro (2 variants) behaves as segment-based routing — when the two
    // variants happen to represent different archetypes, priors bias toward
    // whichever wins this segmentKey (or falls back to meta-learning). When
    // both variants share an archetype, priors are a no-op and Thompson
    // Sampling runs uniformly.
    const planTierForPriors = shopRecord.plan || 'pro';
    const prioriEnabled = planTierForPriors === 'enterprise' || planTierForPriors === 'pro';
    const selectedVariant = await selectVariantForImpression(
      shopRecord.id,
      baseline,
      segment,
      triggerReason,
      {
        segmentKey,
        storeVertical: shopRecord.storeVertical || null,
        enableArchetypePriors: prioriEnabled
      }
    );
    console.log(`[Variant Selection] Selected ${selectedVariant.variantId} (Gen ${selectedVariant.generation}, trigger: ${triggerReason}, segmentKey: ${segmentKey}, priors: ${prioriEnabled ? planTierForPriors : 'off'})`);

    // Step 4: Build decision from variant genes
    // Cap the offer amount based on aggression level.
    // Aggression acts as a ceiling: aggression 5 → max 50% of pool max, aggression 10 → full max.
    // The AI can always choose LESS than the cap, but never more.
    let cappedOfferAmount = selectedVariant.offerAmount;
    if (baseline.includes('with_discount') && selectedVariant.offerAmount > 0) {
      const pool = (await import('../utils/gene-pools.js')).genePools[baseline];
      const poolMax = Math.max(...pool.offerAmounts);
      const maxAllowed = Math.round(poolMax * aggressionNormalized);
      if (cappedOfferAmount > maxAllowed) {
        console.log(`[Aggression Cap] Capping offer from ${cappedOfferAmount} to ${maxAllowed} (aggression ${effectiveAggression}/10, pool max ${poolMax})`);
        cappedOfferAmount = maxAllowed;
      }
    }

    // Brand-safety guards: protect against stale DB variants carrying copy that's
    // no longer in the current gene pool, OR copy that matches the archetype's
    // banned-pattern list (e.g. headlines promising product browsing the modal
    // can't deliver, or "free shipping" claims the merchant hasn't authorized).
    // Subhead is hidden; headline/CTA fall back to in-pool copy since the modal
    // can't render without them.
    const {
      isValidSubhead, isValidHeadline, isValidCta,
      pickFallbackHeadline, pickFallbackCta, hasBannedClaim,
      getArchetype
    } = await import('../utils/gene-pools.js');

    // Resolve archetype name for this baseline — surfaced in decision payload
    // so the modal JS log, admin dashboards, and meta-learning aggregators all
    // agree on what kind of modal was shown.
    const archetypeName = getArchetype(baseline)?.archetypeName || null;

    let effectiveHeadline = selectedVariant.headline;
    if (!isValidHeadline(baseline, effectiveHeadline) || hasBannedClaim(baseline, effectiveHeadline)) {
      const fallback = pickFallbackHeadline(baseline);
      console.warn(`[Brand Safety] Unsafe headline on variant ${selectedVariant.id} — swapping to fallback. was="${effectiveHeadline}" now="${fallback}"`);
      effectiveHeadline = fallback;
    }

    let effectiveCta = selectedVariant.cta;
    if (!isValidCta(baseline, effectiveCta) || hasBannedClaim(baseline, effectiveCta)) {
      const fallback = pickFallbackCta(baseline);
      console.warn(`[Brand Safety] Unsafe CTA on variant ${selectedVariant.id} — swapping to fallback. was="${effectiveCta}" now="${fallback}"`);
      effectiveCta = fallback;
    }

    let effectiveShowSubhead = selectedVariant.showSubhead ?? true;
    if (effectiveShowSubhead && (!isValidSubhead(baseline, selectedVariant.subhead) || hasBannedClaim(baseline, selectedVariant.subhead))) {
      console.warn(`[Brand Safety] Unsafe subhead on variant ${selectedVariant.id} — hiding. subhead="${selectedVariant.subhead}"`);
      effectiveShowSubhead = false;
    }

    const decision = {
      type: baseline.includes('revenue') ? 'threshold' : 'percentage',
      amount: cappedOfferAmount,
      threshold: baseline.includes('revenue') ? Math.round(signals.cartValue * 1.3) : null,
      headline: effectiveHeadline,
      subhead: selectedVariant.subhead,
      cta: effectiveCta,
      redirect: selectedVariant.redirect,
      urgency: selectedVariant.urgency,
      showSubhead: effectiveShowSubhead,
      triggerType: selectedVariant.triggerType || 'exit_intent',
      idleSeconds: selectedVariant.idleSeconds || 30,
      variantId: selectedVariant.id,
      variantPublicId: selectedVariant.variantId,
      baseline: baseline,
      archetype: archetypeName,
      confidence: selectedVariant.impressions > 100 ? 0.8 : 0.5
    };
    
    console.log('[Variant Engine] Decision:', decision);
    
    // Step 5: Record impression (for evolution tracking + meta-learning).
    // Phase 2A: also persist scenario signals (pageType, promoInCart) and the
    // resolved archetype so cross-store meta-learning can aggregate on these
    // dimensions without joining back through Variant -> baseline -> gene-pools.
    const impressionRecord = await recordImpression(selectedVariant.id, shopRecord.id, {
      segment: segment,
      deviceType: signals.deviceType || 'unknown',
      trafficSource: signals.trafficSource || 'unknown',
      accountStatus: signals.accountStatus || null,
      visitFrequency: signals.visitFrequency ?? null,
      cartValue: signals.cartValue,
      triggerReason,
      pageType: resolvedPageType,
      promoInCart: resolvedPromoInCart,
      archetype: archetypeName,
      segmentKey
    });

    // Update analytics metafield for dashboard metrics (fire-and-forget to avoid blocking)
    trackAnalyticsEvent(admin, 'impression').catch(e =>
      console.error('[Analytics] Failed to track impression event:', e)
    );

    // If no discount needed (no-discount baseline or 0 amount), return with copy but no code
    if (decision.type === 'no-discount' || decision.amount === 0) {
      const noDiscAiDec = await db.aIDecision.create({
        data: {
          shopId: shopRecord.id,
          signals: JSON.stringify(signals),
          decision: JSON.stringify(decision)
        }
      });

      // Record "shown" intervention outcome (no discount, but modal was displayed)
      const { recordInterventionOutcome: recordShownOutcome } = await import('../utils/intervention-threshold.server.js');
      const noDiscSegment = (signals.deviceType === 'mobile') ? 'mobile'
                          : (signals.deviceType === 'desktop') ? 'desktop' : 'all';
      await recordShownOutcome(db, {
        shopId: shopRecord.id,
        wasShown: true,
        propensityScore: signals.propensityScore ?? null,
        cartValue: signals.cartValue,
        deviceType: signals.deviceType,
        trafficSource: signals.trafficSource,
        segment: noDiscSegment,
        aiDecisionId: noDiscAiDec.id,
        impressionId: impressionRecord.id
      }).catch(e => console.error('[Threshold] Failed to record shown outcome:', e));

      return json({
        shouldShow: true,
        aiDecisionId: noDiscAiDec.id,
        decision: {
          type: 'no-discount',
          amount: 0,
          code: null,
          baseline: decision.baseline,
          archetype: decision.archetype,
          variant: {
            headline: decision.headline,
            subhead: decision.subhead,
            cta: decision.cta,
            redirect: decision.redirect,
            urgency: decision.urgency,
            showSubhead: decision.showSubhead
          },
          triggerType: decision.triggerType,
          idleSeconds: decision.idleSeconds,
          variantId: decision.variantId,
          variantPublicId: decision.variantPublicId,
          impressionId: impressionRecord.id
        }
      });
    }
    
    // Create discount code based on type and mode
    let discountResult;
    let offerAmount = decision.amount;

    // MODE: Generic - Reuse the same code for all customers (AI mode uses AI-specific settings)
    if (aiDiscountCodeMode === 'generic' && aiGenericDiscountCode) {
      console.log(`[AI Mode] Using generic discount code: ${aiGenericDiscountCode}`);

      // For generic codes, the merchant's code already exists in Shopify with
      // its own fixed discount value. The AI/variant engine, however, picked
      // decision.amount independently from the gene pool — so the modal could
      // promise "Save 25%" when the code only gives 10% (false advertising).
      //
      // Guard: look up the code's real value and reconcile.
      //   - Same type + different amount → sync the amount. Variant copy stays
      //     valid because the {{amount}} placeholder will now interpolate
      //     against the real number. (Most common drift case.)
      //   - Type mismatch (e.g. variant is PERCENT_DISCOUNT but code is fixed-$)
      //     → variant copy has hard-coded "%" / currency formatting that can't
      //     be safely repurposed. Replace headline/subhead/cta with neutral
      //     no-amount-bearing copy so the customer still sees the modal +
      //     gets the code, but never sees a number that disagrees with reality.
      //   - Code missing / unsupported shape (free shipping, BXGY) → same
      //     neutral-copy fallback.
      const realDetails = await getDiscountCodeDetails(admin, aiGenericDiscountCode);

      if (realDetails && realDetails.type === decision.type) {
        if (realDetails.amount !== decision.amount) {
          console.warn(
            `[AI Mode] Generic code amount drift on "${aiGenericDiscountCode}" — ` +
            `aligning copy. was: ${decision.amount}, now: ${realDetails.amount}`
          );
          decision.amount    = realDetails.amount;
          decision.threshold = realDetails.threshold;
          offerAmount        = realDetails.amount;
        }
      } else {
        // Cannot safely show amount-bearing copy. Strip placeholders.
        console.error(
          `[AI Mode] Generic code "${aiGenericDiscountCode}" mismatch — ` +
          `decision wanted ${decision.type}/${decision.amount}, ` +
          `code is ${realDetails ? `${realDetails.type}/${realDetails.amount}` : 'not found / unsupported'}. ` +
          `Falling back to neutral copy.`
        );
        // Neutral copy: no {{amount}}, no %/$ claims. Code is still delivered
        // to the customer at checkout via decision.code — they just won't see
        // a specific promise about its value.
        decision.headline    = 'You left something in your cart';
        decision.subhead     = 'Your discount is waiting at checkout';
        decision.cta         = 'Complete My Order';
        decision.showSubhead = true;
        // Switch to no-discount type so the client renderer skips its
        // threshold-ENFORCE / percentage / fixed branches that build copy
        // out of decision.amount (would render "$0 off" otherwise).
        // The code still flows through decision.code → settings.discountCode
        // → sessionStorage → /discount/<code>?redirect=/checkout.
        decision.type        = 'no-discount';
        decision.amount      = 0;
        decision.threshold   = null;
        offerAmount          = 0;
      }

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
    const discountAiDec = await db.aIDecision.create({
      data: {
        shopId: shopRecord.id,
        signals: JSON.stringify(signals),
        decision: JSON.stringify(decision),
        offerId: discountOffer.id
      }
    });
    
    console.log(` AI offer created: ${discountResult.code} (${decision.type}, $${offerAmount})`);
    
    // Variant copy is already in decision object from variant genes
    // No need for separate copy variant selection
    
    // Check if shop has Enterprise plan (copy optimization enabled)
    // Use database plan, not metafield
    const isEnterprise = shopRecord.plan === 'enterprise' || settings.copyOptimization === true;
    
    // Build response - only include variant for Enterprise users
    const response = {
      shouldShow: true,
      aiDecisionId: discountAiDec.id,
      decision: {
        type: decision.type,
        amount: decision.amount,
        threshold: decision.threshold || null,
        timing: decision.timing || null, // Enterprise AI timing control
        code: discountResult.code,
        confidence: decision.confidence,
        expiresAt: discountResult.expiresAt,
        baseline: decision.baseline, // Include baseline for tracking
        archetype: decision.archetype // Archetype name (e.g. THRESHOLD_DISCOUNT)
      }
    };
    
    // Add variant copy and genes to response
    response.decision.variant = {
      headline: decision.headline,
      subhead: decision.subhead,
      cta: decision.cta,
      redirect: decision.redirect,
      urgency: decision.urgency,
      showSubhead: decision.showSubhead
    };
    response.decision.triggerType = decision.triggerType;
    response.decision.idleSeconds = decision.idleSeconds;
    response.decision.variantId = decision.variantId;
    response.decision.variantPublicId = decision.variantPublicId;
    response.decision.impressionId = impressionRecord.id; // For tracking clicks/conversions
    
    console.log(`[Variant Engine] Returning variant ${decision.variantPublicId} (Gen ${selectedVariant.generation})`);

    // Record "shown" intervention outcome for adaptive threshold learning
    const { recordInterventionOutcome: recordShown } = await import('../utils/intervention-threshold.server.js');
    const shownSegment = (signals.deviceType === 'mobile') ? 'mobile'
                       : (signals.deviceType === 'desktop') ? 'desktop' : 'all';
    await recordShown(db, {
      shopId: shopRecord.id,
      wasShown: true,
      propensityScore: signals.propensityScore ?? null,
      cartValue: signals.cartValue,
      deviceType: signals.deviceType,
      trafficSource: signals.trafficSource,
      segment: shownSegment,
      aiDecisionId: discountAiDec.id,
      impressionId: impressionRecord.id
    }).catch(e => console.error('[Threshold] Failed to record shown outcome:', e));

    return json(response);
    
  } catch (error) {
    console.error("AI decision error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
