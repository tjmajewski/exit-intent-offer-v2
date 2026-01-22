import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  try {
    const { topic, shop, session, payload } = await authenticate.webhook(request);

    console.log(" Discount webhook received:", topic);
    console.log("Shop:", shop);
    console.log("Discount code:", payload.code);
    console.log("Discount value:", payload.value);

    // Get shop from database
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });

    if (!shopRecord) {
      console.log("Shop not found in database");
      return new Response(null, { status: 200 });
    }

    // Extract discount details
    const discountCode = payload.code || payload.title;
    const discountValue = Math.abs(parseFloat(payload.value || 0));
    const discountType = payload.value_type === "percentage" ? "percentage" : "fixed_amount";

    // Create promotion record
    await db.promotion.create({
      data: {
        shopId: shopRecord.id,
        code: discountCode,
        amount: discountValue,
        type: discountType,
        detectedVia: "webhook",
        status: "monitoring",
        validFrom: payload.starts_at ? new Date(payload.starts_at) : null,
        validUntil: payload.ends_at ? new Date(payload.ends_at) : null,
        usageStats: JSON.stringify({ total: 0, last24h: 0 })
      }
    });

    console.log(` Promotion created: ${discountCode} - ${discountValue}${discountType === 'percentage' ? '%' : '$'} off`);

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Discount webhook error:", error);
    return new Response(null, { status: 500 });
  }
};