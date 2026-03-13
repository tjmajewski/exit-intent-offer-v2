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

  // Check if subscription is now active (with retry for race condition)
  let subscription = await getActiveSubscription(admin);

  // Shopify sometimes hasn't propagated the subscription status yet when the
  // callback fires. Retry once after a short delay.
  if (!subscription || subscription.status !== "ACTIVE") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    subscription = await getActiveSubscription(admin);
  }

  if (subscription && subscription.status === "ACTIVE") {
    const tier = requestedTier || tierFromSubscriptionName(subscription.name);
    await updatePlanData(admin, session, db, tier, subscription);
    console.log(`[Billing] Plan updated to ${tier} for ${session.shop}`);
  } else if (requestedTier) {
    // Subscription not yet active but we have the tier from our own returnUrl.
    // Update the DB immediately so features are accessible. The metafield will
    // be synced on the next page load via syncSubscriptionToPlan.
    console.log(`[Billing] Subscription not yet active for ${session.shop}, updating DB to ${requestedTier} from callback params`);
    await db.shop.upsert({
      where: { shopifyDomain: session.shop },
      update: { plan: requestedTier },
      create: { shopifyDomain: session.shop, plan: requestedTier },
    });
  } else {
    console.log(`[Billing] Subscription not active for ${session.shop}, status: ${subscription?.status || "none"}`);
  }

  return redirect("/app/upgrade");
}

/**
 * Update both metafield and DB with the confirmed plan data.
 */
async function updatePlanData(admin, session, db, tier, subscription) {
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

  // Ensure usage object exists with resetDate (prevents "Resets Unknown")
  if (!currentPlan.usage) {
    const resetDate = new Date();
    resetDate.setMonth(resetDate.getMonth() + 1);
    resetDate.setHours(0, 0, 0, 0);
    currentPlan.usage = {
      impressionsThisMonth: 0,
      resetDate: resetDate.toISOString()
    };
  } else if (!currentPlan.usage.resetDate) {
    const resetDate = new Date();
    resetDate.setMonth(resetDate.getMonth() + 1);
    resetDate.setHours(0, 0, 0, 0);
    currentPlan.usage.resetDate = resetDate.toISOString();
  }

  // Mark trial as used so the merchant can never get another free trial
  if (!currentPlan.hasUsedTrial) {
    currentPlan.hasUsedTrial = true;
    currentPlan.trialStartedAt = new Date().toISOString();
  }

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

  // Update database with plan and subscription ID
  await db.shop.upsert({
    where: { shopifyDomain: session.shop },
    update: {
      plan: tier,
      subscriptionId: subscription.id
    },
    create: {
      shopifyDomain: session.shop,
      plan: tier,
      subscriptionId: subscription.id,
    },
  });
}
