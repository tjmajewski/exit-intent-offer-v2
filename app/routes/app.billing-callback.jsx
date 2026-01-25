import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { getActiveSubscription, tierFromSubscriptionName } from "../utils/billing.server";

/**
 * Billing callback route.
 * Shopify redirects here after a merchant approves or declines a subscription.
 * URL format: /app/billing-callback?tier=pro&cycle=monthly&charge_id=xxx
 */
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const { default: db } = await import("../db.server.js");

  const url = new URL(request.url);
  const requestedTier = url.searchParams.get("tier");

  // Check if subscription is now active
  const subscription = await getActiveSubscription(admin);

  if (subscription && subscription.status === "ACTIVE") {
    const tier = requestedTier || tierFromSubscriptionName(subscription.name);

    // Get shop ID for metafield update
    const shopResponse = await admin.graphql(`
      query {
        shop {
          id
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
        }
      }
    `);
    const shopData = await shopResponse.json();
    const shopId = shopData.data.shop.id;

    const currentPlan = shopData.data.shop?.plan?.value
      ? JSON.parse(shopData.data.shop.plan.value)
      : { tier: "starter", status: "active" };

    currentPlan.tier = tier;
    currentPlan.status = "active";
    currentPlan.subscriptionId = subscription.id;

    // Update plan in metafields
    await admin.graphql(
      `mutation UpdatePlan($ownerId: ID!, $value: String!) {
        metafieldsSet(metafields: [{
          ownerId: $ownerId
          namespace: "exit_intent"
          key: "plan"
          value: $value
          type: "json"
        }]) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(currentPlan),
        },
      }
    );

    // Update database
    await db.shop.upsert({
      where: { shopifyDomain: session.shop },
      update: { plan: tier },
      create: {
        shopifyDomain: session.shop,
        plan: tier,
      },
    });

    console.log(`[Billing] Plan updated to ${tier} for ${session.shop}`);
  } else {
    console.log(`[Billing] Subscription not active for ${session.shop}, status: ${subscription?.status || "none"}`);
  }

  return redirect("/app/upgrade");
}
