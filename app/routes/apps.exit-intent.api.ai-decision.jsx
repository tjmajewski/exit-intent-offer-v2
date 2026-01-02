import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { determineOffer, checkBudget } from "../utils/ai-decision";
import { createPercentageDiscount, createFixedDiscount, createThresholdDiscount } from "../utils/discount-codes";

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
    
    // Make AI decision
    const decision = determineOffer(signals, aggression, aiGoal, signals.cartValue);
    
    console.log('AI Decision:', decision);
    
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
    
    return json({
      shouldShow: true,
      decision: {
        type: decision.type,
        amount: decision.amount,
        threshold: decision.threshold || null,
        code: discountResult.code,
        confidence: decision.confidence,
        expiresAt: discountResult.expiresAt
      }
    });
    
  } catch (error) {
    console.error("AI decision error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}