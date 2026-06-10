import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR: Customer Redact (Data Deletion)
 *
 * Delete all personal data we hold for this customer. The only customer
 * identifier this app stores is `Conversion.customerEmail` (impression /
 * decision rows are anonymous). Match on that, plus any orders_to_redact.
 *
 * Previous version queried `shop.shopDomain` (not a column → Prisma threw,
 * caught, 200) and filtered conversions by `customerId` (also not a column),
 * so it deleted nothing.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Customer redact request for customer: ${payload.customer?.id}`);

  try {
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });

    if (!shopRecord) {
      console.log(`Shop ${shop} not found in database`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    let deletedByEmail = 0;
    let deletedByOrder = 0;

    // Delete conversions matching the customer's email.
    const email = payload.customer?.email;
    if (email) {
      const res = await db.conversion.deleteMany({
        where: { shopId: shopRecord.id, customerEmail: email }
      });
      deletedByEmail = res.count;
    }

    // Also delete any specifically listed orders.
    const ordersToRedact = payload.orders_to_redact || [];
    if (ordersToRedact.length > 0) {
      const res = await db.conversion.deleteMany({
        where: {
          shopId: shopRecord.id,
          orderId: { in: ordersToRedact.map((id) => String(id)) }
        }
      });
      deletedByOrder = res.count;
    }

    console.log(`Customer redact completed for ${shop}:`, {
      customerId: payload.customer?.id,
      conversionsDeletedByEmail: deletedByEmail,
      conversionsDeletedByOrder: deletedByOrder
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    if (error instanceof Response) throw error; // invalid HMAC → 401
    console.error(`Error processing customer redact:`, error);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};
