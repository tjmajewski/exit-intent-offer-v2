import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  try {
    const { topic, shop, session, payload } = await authenticate.webhook(request);

    console.log("📦 Webhook received:", topic);
    console.log("Shop:", shop);
    console.log("Order ID:", payload.id);
    console.log("Order total:", payload.total_price);

    // Check if our discount code was used
    const discountCodes = payload.discount_codes || [];
    const exitDiscountUsed = discountCodes.find(dc => 
      dc.code && /^\d+(OFF|DOLLARSOFF|GIFT)$/i.test(dc.code)
    );

    // PHASE 5: Track ALL discount usage for promotional intelligence
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });

    if (shopRecord && discountCodes.length > 0) {
      for (const dc of discountCodes) {
        if (!dc.code) continue;
        
        // Find promotion in database
        const promo = await db.promotion.findFirst({
          where: {
            shopId: shopRecord.id,
            code: dc.code
          }
        });

        if (promo) {
          // Update usage stats
          const stats = JSON.parse(promo.usageStats);
          stats.total += 1;
          stats.last24h = (stats.last24h || 0) + 1;

          await db.promotion.update({
            where: { id: promo.id },
            data: {
              usageStats: JSON.stringify(stats)
            }
          });

          console.log(`📊 Promotion usage tracked: ${dc.code} (Total: ${stats.total})`);

          // Classify promotion if not yet classified
          if (!promo.classification) {
            await classifyPromotion(promo.id);
          }
        }
      }
    }

    // Check if gift card voucher product is in the order
    const lineItems = payload.line_items || [];
    const giftCardVoucher = lineItems.find(item => 
      item.product_id === 7790476951630
    );

    // If neither discount nor voucher, skip
    if (!exitDiscountUsed && !giftCardVoucher) {
      console.log("No exit intent offer used, skipping");
      return new Response(null, { status: 200 });
    }

    // If gift card voucher found, create real gift card
    if (giftCardVoucher) {
      console.log("🎁 Gift card voucher found in order!");
      
      // Get gift card amount from settings (we'll need to query this)
      const settingsQuery = `
        query {
          shop {
            metafield(namespace: "exit_intent", key: "settings") {
              value
            }
          }
        }
      `;
      
      const { admin } = await authenticate.admin({ session });
      const settingsResponse = await admin.graphql(settingsQuery);
      const settingsResult = await settingsResponse.json();
      const settings = JSON.parse(settingsResult.data.shop?.metafield?.value || '{}');
      
      const giftCardAmount = settings.discountAmount || 15;
      
      // Create real gift card
      console.log(`Creating $${giftCardAmount} gift card for customer...`);
      
      const giftCardMutation = `
        mutation giftCardCreate($input: GiftCardCreateInput!) {
          giftCardCreate(input: $input) {
            giftCard {
              id
              initialValue {
                amount
              }
              maskedCode
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
      
      const giftCardResponse = await admin.graphql(giftCardMutation, {
        variables: {
          input: {
            initialValue: parseFloat(giftCardAmount),
            note: `Exit Intent Offer - Order #${payload.order_number}`,
            customerId: payload.customer?.id ? payload.customer.id.toString().split('/').pop() : null
          }
        }
      });
      
      const giftCardResult = await giftCardResponse.json();
      
      if (giftCardResult.data.giftCardCreate.giftCard) {
        console.log("✓ Gift card created:", giftCardResult.data.giftCardCreate.giftCard.maskedCode);
      } else {
        console.error("Gift card creation failed:", giftCardResult.data.giftCardCreate.userErrors);
      }
    }

    const orderValue = parseFloat(payload.total_price);
    console.log(`🎉 Exit intent discount redeemed: ${exitDiscountUsed.code}`);
    console.log(`💰 Order value: $${orderValue}`);
    
    // Update analytics and modal library
    await updateAnalytics(session, orderValue);
    console.log("✓ Analytics updated with conversion and revenue");

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(null, { status: 500 });
  }
};

async function updateAnalytics(session, revenue) {
  // Use the session to make GraphQL requests
  const { admin } = await authenticate.admin({ session });
  
  // Query current analytics and modal library
  const query = `
    query {
      shop {
        id
        analytics: metafield(namespace: "exit_intent", key: "analytics") {
          value
        }
        modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
          value
        }
      }
    }
  `;

  const response = await admin.graphql(query);
  const result = await response.json();

  const shopId = result.data.shop.id;

  // Parse current analytics or use defaults
  const currentValue = result.data.shop?.analytics?.value;
  const analytics = currentValue ? JSON.parse(currentValue) : {
    impressions: 0,
    clicks: 0,
    closeouts: 0,
    conversions: 0,
    revenue: 0,
    events: []
  };

  // Increment conversions and add revenue
  analytics.conversions += 1;
  analytics.revenue += revenue;

  // Add timestamped conversion event
  if (!analytics.events) analytics.events = [];
  analytics.events.push({
    type: "conversion",
    timestamp: new Date().toISOString(),
    revenue: revenue
  });

  console.log("📊 New analytics:", analytics);

  // Save updated analytics
  const analyticsMutation = `
    mutation SetAnalytics($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [{
        ownerId: $ownerId
        namespace: "exit_intent"
        key: "analytics"
        value: $value
        type: "json"
      }]) {
        metafields {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  await admin.graphql(analyticsMutation, {
    variables: {
      ownerId: shopId,
      value: JSON.stringify(analytics)
    }
  });

  // Update modal library stats
  const modalLibraryValue = result.data.shop?.modalLibrary?.value;
  if (modalLibraryValue) {
    const modalLibrary = JSON.parse(modalLibraryValue);
    const currentModal = modalLibrary.modals?.find(m => m.modalId === modalLibrary.currentModalId);
    
    if (currentModal) {
      currentModal.stats.conversions = (currentModal.stats.conversions || 0) + 1;
      currentModal.stats.revenue = (currentModal.stats.revenue || 0) + revenue;
      
      console.log(`📊 Updated ${currentModal.modalName} stats:`, currentModal.stats);
      
      // Save updated modal library
      const modalLibraryMutation = `
        mutation UpdateModalLibrary($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "modal_library"
            value: $value
            type: "json"
          }]) {
            metafields {
              id
            }
          }
        }
      `;

      await admin.graphql(modalLibraryMutation, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(modalLibrary)
        }
      });
    }
  }
}

async function classifyPromotion(promoId) {
  const promo = await db.promotion.findUnique({
    where: { id: promoId }
  });

  if (!promo) return;

  const hoursSince = (Date.now() - promo.detectedAt.getTime()) / (1000 * 60 * 60);
  
  // Wait at least 4 hours before classifying
  if (hoursSince < 4) {
    console.log(`⏳ Waiting to classify ${promo.code} (only ${hoursSince.toFixed(1)} hours old)`);
    return;
  }

  const stats = JSON.parse(promo.usageStats);
  const usagePerHour = stats.total / hoursSince;

  let classification, aiStrategy, reason;

  // High usage = site-wide promotion
  if (usagePerHour > 10) {
    classification = "site_wide";
    aiStrategy = promo.amount >= 25 ? "pause" : "increase";
    reason = `${promo.amount}% site-wide promo detected (${stats.total} uses in ${hoursSince.toFixed(1)} hours)`;
  } 
  // Medium usage = targeted campaign
  else if (usagePerHour > 2) {
    classification = "targeted";
    aiStrategy = "continue";
    reason = `Targeted promo (${usagePerHour.toFixed(1)} uses/hour)`;
  } 
  // Low usage = customer service code
  else {
    classification = "customer_service";
    aiStrategy = "ignore";
    reason = `Low usage - likely customer service code (${stats.total} total uses)`;
  }

  await db.promotion.update({
    where: { id: promo.id },
    data: {
      classification,
      aiStrategy,
      aiStrategyReason: reason,
      status: "active"
    }
  });

  console.log(`✅ Promotion classified: ${promo.code} → ${classification} (${aiStrategy})`);
}