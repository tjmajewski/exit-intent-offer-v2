import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createPercentageDiscount, createFixedDiscount } from "../utils/discount-codes";

/**
 * Per-session unique discount code generator for manual mode.
 *
 * When a merchant uses "Unique Codes" mode, each customer who sees the modal
 * gets their own code (with prefix + random suffix, 24h expiry, single use).
 * This prevents code sharing on Reddit / coupon sites.
 *
 * Called by the storefront modal JS via app proxy:
 *   POST /apps/exit-intent/api/generate-code
 *   Body: { shop: "mystore.myshopify.com" }
 */
export async function action({ request }) {
  try {
    const { admin } = await authenticate.public.appProxy(request);
    const { shop } = await request.json();

    if (!shop) {
      return json({ error: "Missing shop" }, { status: 400 });
    }

    const { default: db } = await import("../db.server.js");
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });

    if (!shopRecord) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    if (!shopRecord.discountEnabled) {
      return json({ error: "Discounts not enabled" }, { status: 400 });
    }

    // Determine which settings to use based on app mode
    const discountCodeMode = shopRecord.mode === "ai"
      ? shopRecord.aiDiscountCodeMode
      : shopRecord.manualDiscountCodeMode;

    // This endpoint is only for unique code generation
    if (discountCodeMode !== "unique") {
      return json({ error: "Shop is not in unique code mode" }, { status: 400 });
    }

    const prefix = shopRecord.mode === "ai"
      ? (shopRecord.aiDiscountCodePrefix || "EXIT")
      : (shopRecord.manualDiscountCodePrefix || "EXIT");

    // discountPercentage and discountAmount are stored in the metafield JSON,
    // not in the DB columns — read them from the metafield
    const settingsQuery = await admin.graphql(`
      query {
        shop {
          metafield(namespace: "exit_intent", key: "settings") {
            value
          }
        }
      }
    `);
    const settingsData = await settingsQuery.json();
    const metafieldSettings = settingsData.data.shop?.metafield?.value
      ? JSON.parse(settingsData.data.shop.metafield.value)
      : {};

    const offerType = shopRecord.offerType || metafieldSettings.offerType || "percentage";
    const discountPercentage = metafieldSettings.discountPercentage || 0;
    const discountAmount = metafieldSettings.discountAmount || 0;

    let discountResult;

    if (offerType === "percentage" && discountPercentage > 0) {
      discountResult = await createPercentageDiscount(admin, discountPercentage, prefix);
    } else if (offerType === "fixed" && discountAmount > 0) {
      discountResult = await createFixedDiscount(admin, discountAmount, prefix);
    } else {
      return json({ error: "Invalid offer configuration" }, { status: 400 });
    }

    // Track the discount offer in the database
    await db.discountOffer.create({
      data: {
        shopId: shopRecord.id,
        discountCode: discountResult.code,
        offerType: offerType,
        amount: offerType === "percentage" ? discountPercentage : discountAmount,
        cartValue: 0,
        expiresAt: discountResult.expiresAt,
        mode: "unique",
        redeemed: false
      }
    });

    console.log(`[Generate Code] Created unique code: ${discountResult.code} for ${shop}`);

    return json({
      code: discountResult.code,
      expiresAt: discountResult.expiresAt
    });

  } catch (error) {
    console.error("[Generate Code] Error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}
