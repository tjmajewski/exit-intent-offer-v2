import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: Customer Data Request
 *
 * When a customer requests their data, Shopify sends this webhook.
 * We need to provide any data we have about this customer.
 *
 * For this app, we store minimal customer data:
 * - Conversions (customerId, email, order info)
 * - Impression data is anonymous (no customer identifiers)
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Customer data request for customer: ${payload.customer?.id}`);

  try {
    // Find the shop
    const shopRecord = await db.shop.findFirst({
      where: { shopDomain: shop }
    });

    if (!shopRecord) {
      console.log(`Shop ${shop} not found in database`);
      return new Response(JSON.stringify({ success: true, data: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Find any conversions for this customer
    const customerData = {
      conversions: []
    };

    if (payload.customer?.id) {
      const conversions = await db.conversion.findMany({
        where: {
          shopId: shopRecord.id,
          customerId: String(payload.customer.id)
        },
        select: {
          orderId: true,
          orderNumber: true,
          totalPrice: true,
          discountCode: true,
          orderedAt: true,
          createdAt: true
        }
      });

      customerData.conversions = conversions;
    }

    // Log the data request for compliance
    console.log(`Customer data request processed for ${shop}:`, {
      customerId: payload.customer?.id,
      conversionsFound: customerData.conversions.length
    });

    // Note: In a production app, you might want to:
    // 1. Store this request in a queue
    // 2. Email the merchant with the data
    // 3. Provide a download link
    // For now, we just acknowledge receipt

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error(`Error processing customer data request:`, error);
    // Still return 200 to acknowledge receipt
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};
