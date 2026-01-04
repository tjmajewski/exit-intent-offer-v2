import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { determineOffer, checkBudget, enterpriseAI } from "../utils/ai-decision";
import { createPercentageDiscount, createFixedDiscount, createThresholdDiscount } from "../utils/discount-codes";
import { getMetaInsight, shouldUseMetaLearning } from "../utils/meta-learning.js";

const db = new PrismaClient();

export async function action({ request }) {
  try {
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
    
    const { aiGoal, aggression, budgetEnabled, budgetAmount, budgetPeriod } = settings;
    
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
    
    // Make AI decision - use Enterprise AI if enabled
    let decision;
    
    if (shopRecord.plan === 'enterprise' && settings.mode === 'ai') {
      // Import enterpriseAI function
      const { enterpriseAI } = await import('../utils/ai-decision.js');
      decision = enterpriseAI(signals, aggression);
      
      console.log('[Enterprise AI] Decision:', decision);
      
      // Enterprise AI can return null (don't show modal at all)
      if (decision === null) {
        console.log('[Enterprise AI] AI decided not to show modal');
        
        // Log the AI decision to skip
        await db.aIDecision.create({
          data: {
            shopId: shopRecord.id,
            signals: JSON.stringify(signals),
            decision: JSON.stringify({
              type: 'no-show',
              reasoning: 'Enterprise AI decided not to show modal'
            })
          }
        });
        
        return json({
          shouldShow: false,
          decision: null
        });
      }
    } else {
      // Standard Pro tier AI
      decision = determineOffer(signals, aggression, aiGoal, signals.cartValue);
      console.log('[Pro AI] Decision:', decision);
    }
    
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
    
    // Create discount code based on type
    let discountResult;
    let offerAmount = decision.amount;
    
    if (decision.type === 'percentage') {
      discountResult = await createPercentageDiscount(admin, decision.amount);
    } else if (decision.type === 'fixed') {
      discountResult = await createFixedDiscount(admin, decision.amount);
    } else if (decision.type === 'threshold') {
      discountResult = await createThresholdDiscount(admin, decision.threshold, decision.amount);
      offerAmount = decision.amount; // Store discount amount, not threshold
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
    
    // Select copy variant for this customer segment
    const { getSegment, selectVariant } = await import('../utils/copy-variants.js');
    const segment = getSegment(signals);
    
    // Check if we should use meta-learning for this store/segment
    const useMeta = await shouldUseMetaLearning(db, shopRecord.id, segment);
    let variant = selectVariant(shopRecord, segment);
    
    // If using meta-learning and we have insights, bias selection
    if (useMeta) {
      const metaInsight = await getMetaInsight(db, segment, 'signal_correlation');
      if (metaInsight) {
        console.log(`[AI Decision] New store - using meta-learning for ${segment} (${metaInsight.storeCount} stores, ${metaInsight.sampleSize} samples)`);
        // Variant already selected, but log that we're in meta-learning mode
        // Future: Could use metaInsight to influence decision type/amount
      }
    }
    
    console.log(`[AI Decision] Selected variant ${variant.id} for segment ${segment} (meta-learning: ${useMeta})`);
    
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
        segment: segment // Always include segment for tracking
      }
    };
    
    // Only add variant copy for Enterprise users
    if (isEnterprise) {
      response.decision.variant = {
        id: variant.id,
        headline: variant.headline,
        body: variant.body,
        cta: variant.cta,
        segment: segment
      };
      console.log(`[AI Decision] Enterprise user - using variant copy`);
    } else {
      // Pro users still get variant ID for tracking, but no custom copy
      response.decision.variantId = variant.id;
      console.log(`[AI Decision] Pro user - using default copy, tracking variant ${variant.id}`);
    }
    
    return json(response);
    
  } catch (error) {
    console.error("AI decision error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}