import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { getActiveSubscription, tierFromSubscriptionName, validatePromoCode } from "../utils/billing.server";

const VALID_TIERS = ["starter", "pro", "enterprise"];

/**
 * Billing callback route.
 * Shopify redirects here after a merchant approves or declines a subscription.
 * URL format: /app/billing-callback?cycle=monthly&promo=EARLYACCESS&charge_id=xxx
 *
 * SECURITY: the plan tier is derived *only* from the active Shopify
 * subscription's name (via `tierFromSubscriptionName`), never from a
 * `?tier=` query param. The query string is fully attacker-controlled — a
 * merchant who paid for Pro could otherwise hit this route with
 * `?tier=enterprise`, and a merchant with no subscription at all could grant
 * themselves any tier for free. We upgrade the DB only when Shopify confirms
 * an ACTIVE subscription; otherwise we leave the plan untouched and let the
 * next admin page load self-heal.
 */
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const { default: db } = await import("../db.server.js");

  const url = new URL(request.url);
  const promoParam = url.searchParams.get("promo");
  const validatedPromo = promoParam ? validatePromoCode(promoParam) : null;
  const promoCode = validatedPromo ? promoParam.toUpperCase().trim() : null;

  // Check if subscription is now active (with retry for race condition)
  let subscription = await getActiveSubscription(admin);

  // Shopify sometimes hasn't propagated the subscription status yet when the
  // callback fires. Retry once after a short delay.
  if (!subscription || subscription.status !== "ACTIVE") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    subscription = await getActiveSubscription(admin);
  }

  if (subscription && subscription.status === "ACTIVE") {
    // Tier comes from Shopify's confirmed subscription, NOT the query string.
    const tier = tierFromSubscriptionName(subscription.name);
    if (!VALID_TIERS.includes(tier)) {
      console.warn(`[Billing] Unrecognized subscription name "${subscription.name}" for ${session.shop} — not updating plan`);
      return redirect("/app/upgrade");
    }
    await updatePlanData(admin, session, db, tier, subscription, promoCode);
    console.log(`[Billing] Plan updated to ${tier} for ${session.shop}${promoCode ? ` (promo: ${promoCode})` : ""}`);
  } else {
    // No active subscription — do NOT grant any tier. Granting off an
    // unverified query param is a free-upgrade hole. If Shopify is just slow
    // to propagate, the merchant's next admin page load self-heals via
    // syncSubscriptionToPlan once the subscription flips ACTIVE.
    console.log(`[Billing] Subscription not active for ${session.shop}, status: ${subscription?.status || "none"} — leaving plan unchanged`);
  }

  return redirect("/app/upgrade");
}

/**
 * Update both metafield and DB with the confirmed plan data.
 */
async function updatePlanData(admin, session, db, tier, subscription, promoCode = null) {
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
  if (promoCode) {
    currentPlan.promoCode = promoCode;
  }

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

  // Mark trial as used so the merchant can never get another free trial.
  // Record the granted length (EARLYACCESS = 60 days, else 14) so remaining-
  // trial math survives a later plan switch.
  if (!currentPlan.hasUsedTrial) {
    const promo = promoCode ? validatePromoCode(promoCode) : null;
    currentPlan.hasUsedTrial = true;
    currentPlan.trialStartedAt = new Date().toISOString();
    currentPlan.trialLengthDays = promo?.trialDays ?? 14;
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
      subscriptionId: subscription.id,
      ...(promoCode ? { promoCode, promoAppliedAt: new Date() } : {}),
    },
    create: {
      shopifyDomain: session.shop,
      plan: tier,
      subscriptionId: subscription.id,
      ...(promoCode ? { promoCode, promoAppliedAt: new Date() } : {}),
    },
  });
}
