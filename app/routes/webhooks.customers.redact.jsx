import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: Customer Redact (Data Deletion)
 *
 * When a customer requests their data be deleted, Shopify sends this webhook.
 * We must delete all personal data for this customer.
 *
 * For this app:
 * - Delete conversions linked to this customer
 * - Impression data is anonymous and doesn't need deletion
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Customer redact request for customer: ${payload.customer?.id}`);

  try {
    // Find the shop
    const shopRecord = await db.shop.findFirst({
      where: { shopDomain: shop }
    });

    if (!shopRecord) {
      console.log(`Shop ${shop} not found in database`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    let deletedCount = 0;

    // Delete conversions for this customer
    if (payload.customer?.id) {
      const deleteResult = await db.conversion.deleteMany({
        where: {
          shopId: shopRecord.id,
          customerId: String(payload.customer.id)
        }
      });

      deletedCount = deleteResult.count;
    }

    // If we had customer email in orders array, process those too
    if (payload.orders_to_redact && payload.orders_to_redact.length > 0) {
      for (const orderId of payload.orders_to_redact) {
        await db.conversion.deleteMany({
          where: {
            shopId: shopRecord.id,
            orderId: String(orderId)
          }
        });
      }
    }

    console.log(`Customer redact completed for ${shop}:`, {
      customerId: payload.customer?.id,
      conversionsDeleted: deletedCount
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error(`Error processing customer redact:`, error);
    // Still return 200 to acknowledge receipt
    return new Response(JSON.stringify({ success: true, error: error.message }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};
