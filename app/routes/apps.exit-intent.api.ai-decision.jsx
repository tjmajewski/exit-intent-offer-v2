import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createPercentageDiscount, createFixedDiscount, createThresholdDiscount, getDiscountCodeDetails } from "../utils/discount-codes";
import { getMetaInsight, shouldUseMetaLearning } from "../utils/meta-learning.js";
import { trackAnalyticsEvent } from "../utils/analytics-metafield.js";
import { composeSegmentKey } from "../utils/segment-key.js";
import { isLearningWriteSkipped } from "../utils/dev-shop-guard.server.js";
import { recordTouch } from "../utils/journey.server.js";
import { loadPropensityModel, scorePropensity } from "../utils/propensity-model.server.js";
import { clusterKeysFor } from "../utils/store-cluster.server.js";
import { getBaselineCvrPrior } from "../utils/cluster-priors.server.js";
import { computePropensity } from "../utils/propensity.server.js";
import { enforceRateLimit } from "../utils/rate-limit.server.js";
import { getEnabledLayoutIds } from "../utils/templates.js";

// FNV-1a 32-bit hash — deterministic holdout bucketing per visitor.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export async function action({ request }) {
  // Per-IP rate limit — public app-proxy endpoint; each call does multiple
  // Admin API round-trips + DB writes and (unique mode) creates a real Shopify
  // discount code. Without this a bot loop mints unlimited price rules.
  const limited = enforceRateLimit(request, "ai-decision", {
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { default: db } = await import("../db.server.js");
  const { decideOffer, checkBudget, offerCeilingPercent, recommendedThreshold } = await import("../utils/ai-decision.server.js");
  try{
    const { admin } = await authenticate.public.appProxy(request);
    const { shop, signals, testMode } = await request.json();

    if (!shop || !signals) {
      return json({ error: "Missing shop or signals" }, { status: 400 });
    }

    // Merchant self-test (?resparq_test=1): force an offer and do NOT feed this
    // visit into threshold/holdout learning. Prevents the merchant's own
    // non-converting clicks from training the AI to stop showing the modal.
    const isTestMode = testMode === true;

    // Dev/preview write guard: never let test-store or preview traffic train the
    // bandit / adaptive threshold (prevents the "AI decided not to show" dead-end
    // from dev-data poisoning). The decision is still computed + served — we only
    // suppress the learning-table writes (VariantImpression / InterventionOutcome
    // / InterventionThreshold).
    const devWriteSkip = isLearningWriteSkipped({
      shopDomain: shop,
      isPreview: signals?.isPreview === true
    });
    if (devWriteSkip) {
      console.log(`[Dev Guard] Learning writes suppressed for ${shop} (dev/preview) — decision still served`);
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
      let createdNew = false;
      try {
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
        createdNew = true;
      } catch (e) {
        // Concurrent first-visit requests race the create — the loser picks
        // up the winner's row (and skips one-time init) instead of 500ing.
        if (e?.code === 'P2002') {
          shopRecord = await db.shop.findUnique({ where: { shopifyDomain: shop } });
        }
        if (!shopRecord) throw e;
      }

      // One-time init only for the request that actually created the row
      if (createdNew) {
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
      } // end one-time init
    }

    // Plan gate: AI mode requires Pro or Enterprise.
    // Settings.mode='ai' could be set on a Starter shop (e.g. downgrade after
    // upgrade), but the AI engine must not run for Starter. Treat as not-enabled.
    const shopPlan = shopRecord.plan || 'starter';
    if (shopPlan === 'starter') {
      console.log(`[AI Decision] Blocked: shop ${shop} on Starter plan — AI mode requires Pro or Enterprise`);
      return json({
        error: "AI mode requires Pro or Enterprise plan",
        plan: shopPlan,
        upgradeRequired: true
      }, { status: 403 });
    }

    // Check budget if enabled
    if (budgetEnabled) {
      // Budget config comes from the settings metafield (what the merchant
      // edits), not the DB shop row (only stamped at first install — stale).
      const budgetCheck = await checkBudget(db, shopRecord.id, { budgetAmount, budgetPeriod });
      
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
    // STICKY per-visitor assignment: hash the stable visitorId so the same
    // shopper is always in (or out of) the holdout for this shop. Per-request
    // randomness flickered assignment across visits and contaminated the
    // incrementality measurement in both directions. Old cached storefront
    // scripts without visitorId fall back to per-request random.
    const HOLDOUT_RATE = 0.05;
    const holdoutVisitorId = (typeof signals.visitorId === 'string' && signals.visitorId.length > 0)
      ? signals.visitorId
      : null;
    const isHoldout = !isTestMode && (holdoutVisitorId
      ? (fnv1a(`${holdoutVisitorId}:${shopRecord.id}`) % 100) < HOLDOUT_RATE * 100
      : Math.random() < HOLDOUT_RATE);

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
      if (!devWriteSkip) await recordHoldout(db, {
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

      // Journey log: holdout suppression is a touch too — the visitor's
      // journey record must show "we chose to show nothing" for sequencing.
      if (!devWriteSkip) recordTouch(db, {
        shopId: shopRecord.id,
        visitorId: signals.visitorId,
        surface: 'none',
        response: 'holdout',
        aiDecisionId: aiDecisionRecord.id,
        propensityScore: signals.propensityScore ?? null
      });

      console.log(`[AI Decision] Holdout group for ${shop} — no intervention (incrementality measurement)`);

      return json({
        shouldShow: false,
        isHoldout: true,
        decision: holdoutDecision,
        aiDecisionId: aiDecisionRecord.id
      });
    }

    // ---------------------------------------------------------------------
    // SERVER-SIDE SIGNAL ENRICHMENT: purchaseHistoryCount
    // The Pro intent score (determineOffer) reads signals.purchaseHistoryCount,
    // but the Pro storefront path sends raw signals with no client enrichment,
    // so the signal was always undefined → inert. Resolve it here from the
    // app-proxy logged_in_customer_id so it's live for BOTH tiers with no extra
    // storefront round-trip. Guests (no customer id) correctly contribute 0.
    // Uses numberOfOrders (ordersCount was removed in API 2026-01).
    // ---------------------------------------------------------------------
    if (signals.purchaseHistoryCount === undefined || signals.purchaseHistoryCount === null) {
      try {
        const loggedInCustomerId = new URL(request.url).searchParams.get('logged_in_customer_id');
        if (loggedInCustomerId && /^\d+$/.test(loggedInCustomerId)) {
          const custResp = await admin.graphql(`
            query CustomerEnrichment($id: ID!) {
              customer(id: $id) {
                numberOfOrders
                amountSpent { amount }
              }
            }
          `, { variables: { id: `gid://shopify/Customer/${loggedInCustomerId}` } });
          const custJson = await custResp.json();
          const customer = custJson?.data?.customer;
          if (customer) {
            signals.purchaseHistoryCount = parseInt(customer.numberOfOrders ?? 0, 10) || 0;
            signals.customerLifetimeValue = parseFloat(customer.amountSpent?.amount ?? 0) || 0;
            console.log(`[AI Decision] Enriched purchaseHistoryCount=${signals.purchaseHistoryCount} for customer ${loggedInCustomerId}`);
          } else {
            signals.purchaseHistoryCount = 0;
          }
        } else {
          // No logged-in customer → guest → no purchase history.
          signals.purchaseHistoryCount = 0;
        }
      } catch (err) {
        console.error('[AI Decision] purchaseHistoryCount enrichment failed:', err);
        signals.purchaseHistoryCount = signals.purchaseHistoryCount ?? 0;
      }
    }

    // UNIFIED METRIC: stamp propensity for BOTH tiers so the show/skip
    // decision, the threshold recording, and the holdout path all learn on
    // ONE scale. SECURITY: always recompute server-side, overwriting any
    // client-supplied value — signals come from the visitor's browser, and a
    // forced propensityScore of 0 would unlock the max discount while a
    // forced 100 poisons threshold learning.
    //
    // CALIBRATED MODEL (shadow-first): when a fresh trained model exists,
    // score it alongside the legacy curve and stamp BOTH into signals (which
    // persist on AIDecision — that's the shadow-comparison dataset). The
    // served score only switches to the model when the shop's
    // usePropensityModel flag is on; flag off = legacy-identical behavior.
    const legacyPropensity = computePropensity(signals);
    signals.propensityScoreLegacy = legacyPropensity;
    signals.propensityScore = legacyPropensity;
    try {
      const propensityModel = await loadPropensityModel(db);
      if (propensityModel) {
        const modelPropensity = scorePropensity(propensityModel, signals, shopRecord.id);
        if (modelPropensity !== null) {
          signals.propensityScoreModel = modelPropensity;
          if (shopRecord.usePropensityModel) {
            signals.propensityScore = modelPropensity;
          }
        }
      }
    } catch (e) {
      console.error('[AI Decision] Propensity model scoring failed (legacy served):', e.message);
    }
    console.log(`[AI Decision] Propensity P=${signals.propensityScore} (legacy=${legacyPropensity}${signals.propensityScoreModel !== undefined ? `, model=${signals.propensityScoreModel}${shopRecord.usePropensityModel ? ' SERVED' : ' shadow'}` : ''}, ${shopRecord.plan || 'pro'})`);

    // PRE-CHECK: the unified decideOffer engine determines whether intervention
    // is warranted (enables "no_intervention" as a learned outcome). Both tiers
    // share the same propensity metric, show/skip logic, and margin ceiling.
    const isEnterprisePlan = (shopRecord.plan || 'pro') === 'enterprise';

    // Enterprise promotional intelligence: check for active site-wide promos and
    // adjust aggression before the decision runs. Pro is detect-only (the
    // device-lift / promo upsell surfaces it elsewhere). Test mode skips promo
    // intelligence so merchant self-tests always reach the engine.
    let effectiveAggression = aggression;
    if (isEnterprisePlan && !isTestMode) {
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

    // Unified decision engine for BOTH tiers. Tier-specific behavior lives in
    // the variant engine (Layer 1) and ctx config below — the show/skip + offer
    // ceiling are now one code path.
    // Phase 4: this shop's cluster keys (vertical × AOV band), most-specific
    // first. Empty for unclustered shops — every prior lookup then no-ops.
    const shopClusterKeys = clusterKeysFor(shopRecord);

    const preScore = await decideOffer(signals, {
      plan: shopRecord.plan || 'pro',
      aggression: effectiveAggression,
      cartValue: signals.cartValue || 0,
      shopId: shopRecord.id,
      testMode: isTestMode,
      assumedGrossMargin: settings.assumedGrossMargin,
      clusterKeys: shopClusterKeys
    });

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
      if (!devWriteSkip) await recordInterventionOutcome(db, {
        shopId: shopRecord.id,
        wasShown: false,
        propensityScore: signals.propensityScore ?? null,
        intentScore: null, // unified on propensity; intent score retired
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

      // Journey log: learned/forced skip
      if (!devWriteSkip) recordTouch(db, {
        shopId: shopRecord.id,
        visitorId: signals.visitorId,
        surface: 'none',
        response: 'skipped',
        aiDecisionId: aiDecisionRecord.id,
        propensityScore: signals.propensityScore ?? null
      });

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
      // Phase 6a: evidence-gated discount decision. When this shop's
      // propensity bucket has mature discount/no-discount arm stats (>= 50
      // outcomes each), the choice is deterministic: discount only when
      // P(discount arm wins on profit) clears the aggression-set confidence
      // bar. Identical visitors get identical treatment; the dial now means
      // "how much evidence before I spend margin", not an RNG seed.
      let evidence = { evidenceBased: false };
      if (!isTestMode) {
        try {
          const { getDiscountArmStats, decideDiscountBaseline } = await import('../utils/discount-arm.server.js');
          const arms = await getDiscountArmStats(db, shopRecord.id, signals.propensityScore);
          evidence = decideDiscountBaseline(arms, effectiveAggression);
        } catch (e) {
          console.error('[Variant Selection] Discount-arm evidence load failed (coin flip fallback):', e.message);
        }
      }

      if (evidence.evidenceBased) {
        if (!evidence.useDiscount) {
          const noDiscountBaseline = baseline.replace('with_discount', 'no_discount');
          console.log(`[Variant Selection] Evidence: P(discount wins)=${evidence.pWin.toFixed(2)} < bar ${evidence.bar.toFixed(2)} (aggression ${effectiveAggression}/10) → ${noDiscountBaseline}`);
          baseline = noDiscountBaseline;
        } else {
          console.log(`[Variant Selection] Evidence: P(discount wins)=${evidence.pWin.toFixed(2)} ≥ bar ${evidence.bar.toFixed(2)} (aggression ${effectiveAggression}/10) → keeping discount baseline`);
        }
      } else {
        // Cold start: keep the legacy coin flip — it IS the exploration that
        // populates both arms so the evidence path can take over.
        const discountRoll = Math.random();
        if (discountRoll > aggressionNormalized) {
          // Downgrade to no-discount version of the same goal
          const noDiscountBaseline = baseline.replace('with_discount', 'no_discount');
          console.log(`[Variant Selection] Aggression ${effectiveAggression}/10 — roll ${discountRoll.toFixed(2)} > ${aggressionNormalized.toFixed(2)} → downgrading to ${noDiscountBaseline} (exploration, arms not mature)`);
          baseline = noDiscountBaseline;
        } else {
          console.log(`[Variant Selection] Aggression ${effectiveAggression}/10 — roll ${discountRoll.toFixed(2)} ≤ ${aggressionNormalized.toFixed(2)} → keeping discount baseline (exploration, arms not mature)`);
        }
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

    // Phase 4c: cluster CVR prior for this baseline — pseudo-counts that
    // anchor cold variants' Beta sampling to the cluster's reality. Cached
    // in-process; null for unclustered shops or missing insights.
    let clusterPrior = null;
    try {
      clusterPrior = await getBaselineCvrPrior(db, shopClusterKeys, baseline);
    } catch (e) {
      console.error('[Variant Selection] Cluster prior load failed (ignored):', e.message);
    }

    const selectedVariant = await selectVariantForImpression(
      shopRecord.id,
      baseline,
      segment,
      triggerReason,
      {
        segmentKey,
        storeVertical: shopRecord.storeVertical || null,
        enableArchetypePriors: prioriEnabled,
        // Sprint 3: hierarchical template posterior. Enterprise only — Pro's
        // 2-variant cap barely spans the layout space, so template pooling adds
        // little; the device-conditional lift is surfaced to Pro as an upsell.
        enableTemplatePriors: planTierForPriors === 'enterprise',
        clusterPrior
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

      // STAGE 4 — margin guardrail, always-on. The served amount comes from the
      // variant gene pool, which the aggression cap alone does NOT make
      // margin-safe. Clamp to the propensity + margin ceiling so no single offer
      // can turn the order unprofitable, and high-propensity carts get little or
      // nothing (announce-only). This is the guard the old engines computed but
      // never actually applied to the served offer.
      const ceilingPct = offerCeilingPercent({
        propensity: signals.propensityScore,
        aggression: effectiveAggression,
        assumedGrossMargin: settings.assumedGrossMargin
      });
      const isRevenueBaseline = baseline.includes('revenue');
      if (ceilingPct === 0) {
        console.log(`[Margin Guard] P=${signals.propensityScore} → announce-only (no discount)`);
        cappedOfferAmount = 0;
      } else if (isRevenueBaseline) {
        const thr = recommendedThreshold(signals.cartValue || 0);
        const maxDollars = Math.floor(thr * ceilingPct / 100);
        if (cappedOfferAmount > maxDollars) {
          console.log(`[Margin Guard] Capping threshold discount from $${cappedOfferAmount} to $${maxDollars} (ceiling ${ceilingPct}%, P=${signals.propensityScore})`);
          cappedOfferAmount = Math.max(maxDollars, 0);
        }
      } else if (cappedOfferAmount > ceilingPct) {
        console.log(`[Margin Guard] Capping discount from ${cappedOfferAmount}% to ${ceilingPct}% (P=${signals.propensityScore})`);
        cappedOfferAmount = ceilingPct;
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

    // Layout QA guard — the hard guarantee for the disable feature. A merchant
    // can turn off any layout that clashes with their theme (see /app/qa-layouts).
    // Generation-side filtering keeps NEW variants off disabled layouts, but
    // legacy DB variants, crossover inheritance, and meta-learning genes can all
    // still carry one. This single clamp is the boundary that holds: if the
    // selected variant points at a disabled layout, render an enabled one
    // (prefer Classic Card) so a turned-off pop-up can never reach a shopper.
    const enabledLayouts = getEnabledLayoutIds(shopRecord.disabledLayouts);
    let effectiveTemplateId = selectedVariant.templateId || 'classic-card';
    if (!enabledLayouts.includes(effectiveTemplateId)) {
      const remapped = enabledLayouts.includes('classic-card') ? 'classic-card' : enabledLayouts[0];
      console.warn(`[Layout QA] Variant ${selectedVariant.id} uses disabled layout "${effectiveTemplateId}" — rendering "${remapped}" instead.`);
      effectiveTemplateId = remapped;
    }

    // Phase 7c: generated candidates aren't in the static pools — the guard
    // accepts copy that's either in-pool OR a known generated candidate for
    // this baseline. Banned-claim regexes apply to BOTH (belt and
    // suspenders; generated copy was already validated at generation time).
    const { isGeneratedCopy } = await import('../utils/generated-copy.server.js');

    let effectiveHeadline = selectedVariant.headline;
    if (hasBannedClaim(baseline, effectiveHeadline) ||
        (!isValidHeadline(baseline, effectiveHeadline) && !(await isGeneratedCopy(db, baseline, 'headline', effectiveHeadline)))) {
      const fallback = pickFallbackHeadline(baseline);
      console.warn(`[Brand Safety] Unsafe headline on variant ${selectedVariant.id} — swapping to fallback. was="${effectiveHeadline}" now="${fallback}"`);
      effectiveHeadline = fallback;
    }

    let effectiveCta = selectedVariant.cta;
    if (hasBannedClaim(baseline, effectiveCta) ||
        (!isValidCta(baseline, effectiveCta) && !(await isGeneratedCopy(db, baseline, 'cta', effectiveCta)))) {
      const fallback = pickFallbackCta(baseline);
      console.warn(`[Brand Safety] Unsafe CTA on variant ${selectedVariant.id} — swapping to fallback. was="${effectiveCta}" now="${fallback}"`);
      effectiveCta = fallback;
    }

    let effectiveShowSubhead = selectedVariant.showSubhead ?? true;
    if (effectiveShowSubhead &&
        (hasBannedClaim(baseline, selectedVariant.subhead) ||
         (!isValidSubhead(baseline, selectedVariant.subhead) && !(await isGeneratedCopy(db, baseline, 'subhead', selectedVariant.subhead))))) {
      console.warn(`[Brand Safety] Unsafe subhead on variant ${selectedVariant.id} — hiding. subhead="${selectedVariant.subhead}"`);
      effectiveShowSubhead = false;
    }

    const decision = {
      type: baseline.includes('revenue') ? 'threshold' : 'percentage',
      amount: cappedOfferAmount,
      threshold: baseline.includes('revenue') ? recommendedThreshold(signals.cartValue || 0) : null,
      headline: effectiveHeadline,
      subhead: selectedVariant.subhead,
      cta: effectiveCta,
      redirect: selectedVariant.redirect,
      urgency: selectedVariant.urgency,
      showSubhead: effectiveShowSubhead,
      showProductImages: selectedVariant.showProductImages === true,
      triggerType: selectedVariant.triggerType || 'exit_intent',
      idleSeconds: selectedVariant.idleSeconds || 30,
      templateId: effectiveTemplateId,
      variantId: selectedVariant.id,
      variantPublicId: selectedVariant.variantId,
      baseline: baseline,
      archetype: archetypeName,
      confidence: selectedVariant.impressions > 100 ? 0.8 : 0.5
    };
    
    console.log('[Variant Engine] Decision:', decision);

    // Phase 7a: opening-surface arm (Enterprise, flag-gated) — chosen BEFORE
    // the impression is recorded, because pill openers must not create a
    // VariantImpression: the pill shows only "Still want your 15% off?", so
    // logging a copy exposure would pollute headline/CTA evolution stats with
    // sessions that never saw the copy. Pill-opener sessions train the
    // surface arm (journey log) instead; conversions still attribute via the
    // stamped aiDecisionId. If the pill later escalates to the modal, the
    // client reports a 'modal:escalated' journey touch.
    let openingSurface = 'modal';
    if (shopRecord.plan === 'enterprise' && shopRecord.enableSurfaceArm && !isTestMode &&
        decision.amount > 0 && decision.type !== 'no-discount') {
      try {
        const { getSurfaceArmStats, chooseOpeningSurface } = await import('../utils/surface-arm.server.js');
        const surfaceStats = await getSurfaceArmStats(db, shopRecord.id, signals.deviceType);
        openingSurface = chooseOpeningSurface(surfaceStats);
        console.log(`[Surface Arm] Opening surface: ${openingSurface}${surfaceStats ? '' : ' (cold start)'}`);
      } catch (e) {
        console.error('[Surface Arm] Selection failed (modal default):', e.message);
      }
    }

    // Step 5: Record impression (for evolution tracking + meta-learning).
    // Phase 2A: also persist scenario signals (pageType, promoInCart) and the
    // resolved archetype so cross-store meta-learning can aggregate on these
    // dimensions without joining back through Variant -> baseline -> gene-pools.
    // Dev/preview: skip the VariantImpression write (no learning contribution).
    // Pill openers: skip too (see surface-arm block above).
    const impressionRecord = (devWriteSkip || openingSurface === 'pill') ? null : await recordImpression(selectedVariant.id, shopRecord.id, {
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
    const impressionId = impressionRecord?.id || null;

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

      // Record "shown" intervention outcome (no discount, but modal was displayed).
      // Skip in merchant test mode so self-tests don't poison threshold learning.
      const { recordInterventionOutcome: recordShownOutcome } = await import('../utils/intervention-threshold.server.js');
      const noDiscSegment = (signals.deviceType === 'mobile') ? 'mobile'
                          : (signals.deviceType === 'desktop') ? 'desktop' : 'all';
      if (!isTestMode && !devWriteSkip) await recordShownOutcome(db, {
        shopId: shopRecord.id,
        wasShown: true,
        propensityScore: signals.propensityScore ?? null,
        cartValue: signals.cartValue,
        deviceType: signals.deviceType,
        trafficSource: signals.trafficSource,
        segment: noDiscSegment,
        aiDecisionId: noDiscAiDec.id,
        impressionId
      }).catch(e => console.error('[Threshold] Failed to record shown outcome:', e));

      // Journey log: announce-only modal shown
      if (!isTestMode && !devWriteSkip) recordTouch(db, {
        shopId: shopRecord.id,
        visitorId: signals.visitorId,
        surface: 'modal',
        response: 'shown',
        variantId: selectedVariant.id,
        impressionId,
        aiDecisionId: noDiscAiDec.id,
        offerType: 'no-discount',
        offerAmount: 0,
        triggerReason,
        propensityScore: signals.propensityScore ?? null,
        segmentKey,
        showNumber: typeof signals.modalShowCount === 'number' ? signals.modalShowCount + 1 : null,
        ignoreStreak: signals.modalIgnoreStreak ?? null
      });

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
            showSubhead: decision.showSubhead,
            showProductImages: decision.showProductImages
          },
          triggerType: decision.triggerType,
          idleSeconds: decision.idleSeconds,
          templateId: decision.templateId,
          variantId: decision.variantId,
          variantPublicId: decision.variantPublicId,
          impressionId
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

    // Generic-mode reconciliation can strip the discount after the surface
    // was chosen — a pill can't present a no-discount offer, so fall back to
    // the modal (the skipped impression stays skipped: rare, and conversions
    // still attribute via aiDecisionId).
    if (openingSurface === 'pill' && (decision.amount === 0 || decision.type === 'no-discount')) {
      console.log('[Surface Arm] Discount stripped by generic-code reconciliation — reverting opener to modal');
      openingSurface = 'modal';
    }

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
        timing: preScore.timing || decision.timing || null, // engine-emitted timing (both tiers)
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
      showSubhead: decision.showSubhead,
      showProductImages: decision.showProductImages
    };
    response.decision.triggerType = decision.triggerType;
    response.decision.idleSeconds = decision.idleSeconds;
    response.decision.templateId = decision.templateId;
    response.decision.variantId = decision.variantId;
    response.decision.variantPublicId = decision.variantPublicId;
    response.decision.impressionId = impressionId; // For tracking clicks/conversions
    response.decision.openingSurface = openingSurface; // 'modal' | 'pill' (phase 7a)
    
    console.log(`[Variant Engine] Returning variant ${decision.variantPublicId} (Gen ${selectedVariant.generation})`);

    // Record "shown" intervention outcome for adaptive threshold learning
    const { recordInterventionOutcome: recordShown } = await import('../utils/intervention-threshold.server.js');
    const shownSegment = (signals.deviceType === 'mobile') ? 'mobile'
                       : (signals.deviceType === 'desktop') ? 'desktop' : 'all';
    if (!isTestMode && !devWriteSkip) await recordShown(db, {
      shopId: shopRecord.id,
      wasShown: true,
      propensityScore: signals.propensityScore ?? null,
      cartValue: signals.cartValue,
      deviceType: signals.deviceType,
      trafficSource: signals.trafficSource,
      segment: shownSegment,
      aiDecisionId: discountAiDec.id,
      impressionId
    }).catch(e => console.error('[Threshold] Failed to record shown outcome:', e));

    // Journey log: discount offer shown — surface reflects the opener the
    // arm chose (pill openers must score as pill pulls, not modal pulls).
    if (!isTestMode && !devWriteSkip) recordTouch(db, {
      shopId: shopRecord.id,
      visitorId: signals.visitorId,
      surface: openingSurface,
      response: 'shown',
      variantId: selectedVariant.id,
      impressionId,
      aiDecisionId: discountAiDec.id,
      offerType: decision.type,
      offerAmount: decision.amount,
      discountCode: discountResult.code,
      triggerReason,
      propensityScore: signals.propensityScore ?? null,
      segmentKey,
      showNumber: typeof signals.modalShowCount === 'number' ? signals.modalShowCount + 1 : null,
      ignoreStreak: signals.modalIgnoreStreak ?? null
    });

    return json(response);
    
  } catch (error) {
    console.error("AI decision error:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
