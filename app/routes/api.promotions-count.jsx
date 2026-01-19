import { authenticate } from "../shopify.server";
import db from "../db.server";

export async function loader({ request }) {
  try {
    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(`
      query {
        shop {
          id
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
        }
      }
    `);

    const data = await response.json();
    const plan = data.data.shop?.plan?.value
      ? JSON.parse(data.data.shop.plan.value)
      : { tier: "pro" };

    // Only Enterprise customers get promotional intelligence
    if (plan.tier !== 'enterprise') {
      return Response.json({ count: 0 });
    }

    // Get shop from database
    const shopDomain = new URL(request.url).searchParams.get('shop') || request.headers.get('host');
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain }
    });

    if (!shopRecord) {
      return Response.json({ count: 0 });
    }

    // Count unseen active promotions
    const unseenCount = await db.promotion.count({
      where: {
        shopId: shopRecord.id,
        status: 'active',
        seenByMerchant: false
      }
    });

    return Response.json({ count: unseenCount });
  } catch (error) {
    console.error("Error counting unseen promotions:", error);
    return Response.json({ count: 0 });
  }
}
