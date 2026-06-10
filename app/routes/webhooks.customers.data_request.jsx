import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: Customer Data Request
 *
 * Provide any data we hold about this customer. The only customer-identifying
 * data this app stores is in Conversion (matched by customerEmail); impression
 * and decision rows are anonymous.
 *
 * Previous version queried `shop.shopDomain` (not a column) and selected
 * `customerId`/`totalPrice` (not columns), so it threw and returned nothing.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Customer data request for customer: ${payload.customer?.id}`);

  try {
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });

    const customerData = { conversions: [] };

    if (shopRecord && payload.customer?.email) {
      customerData.conversions = await db.conversion.findMany({
        where: {
          shopId: shopRecord.id,
          customerEmail: payload.customer.email
        },
        select: {
          orderId: true,
          orderNumber: true,
          orderValue: true,
          customerEmail: true,
          discountCode: true,
          discountAmount: true,
          orderedAt: true,
          createdAt: true
        }
      });
    }

    // Compliance: surface the collected data in logs/response so the merchant
    // can fulfil the SAR. Shopify only requires acknowledgement; the actual
    // hand-off to the customer is the merchant's responsibility.
    console.log(`Customer data request processed for ${shop}:`, {
      customerId: payload.customer?.id,
      conversionsFound: customerData.conversions.length
    });

    return new Response(JSON.stringify({ success: true, data: customerData }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    if (error instanceof Response) throw error; // invalid HMAC → 401
    console.error(`Error processing customer data request:`, error);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};
