// Shopify App Billing - Subscription management via Shopify Billing API
// Uses appSubscriptionCreate mutation for recurring charges

const PROMO_CONFIGS = {
  EARLYACCESS: {
    targetTier: "pro",
    monthlyPrice: 29,
    annualPrice: 24.65,
    annualTotal: 296,
  },
};

export function validatePromoCode(code) {
  if (!code) return null;
  return PROMO_CONFIGS[code.toUpperCase().trim()] || null;
}

const PLAN_CONFIGS = {
  starter: {
    name: "Starter",
    monthlyPrice: 29,
    annualPrice: 24.65,
    annualTotal: 296,
  },
  pro: {
    name: "Pro",
    monthlyPrice: 79,
    annualPrice: 67.15,
    annualTotal: 806,
  },
  enterprise: {
    name: "Enterprise",
    monthlyPrice: 199,
    annualPrice: 169.15,
    annualTotal: 2030,
  },
};

export function getPlanConfig(tier) {
  return PLAN_CONFIGS[tier] || null;
}

/**
 * Create a Shopify app subscription using the Billing API.
 * Returns a confirmation URL that the merchant must visit to approve the charge.
 *
 * @param {object} admin - Shopify Admin API client
 * @param {string} tier - Plan tier: "starter" | "pro" | "enterprise"
 * @param {string} billingCycle - "monthly" | "annual"
 * @param {string} returnUrl - URL to redirect to after approval
 * @param {boolean} isTest - Whether this is a test charge (use true in development)
 * @param {number} trialDays - Number of trial days (0 if trial already used)
 */
export async function createSubscription(admin, tier, billingCycle, returnUrl, isTest = true, trialDays = 0, priceOverride = null) {
  const config = PLAN_CONFIGS[tier];
  if (!config) {
    throw new Error(`Invalid plan tier: ${tier}`);
  }

  const isAnnual = billingCycle === "annual";
  const price = priceOverride
    ? (isAnnual ? priceOverride.annualPrice : priceOverride.monthlyPrice)
    : (isAnnual ? config.annualPrice : config.monthlyPrice);
  const interval = isAnnual ? "ANNUAL" : "EVERY_30_DAYS";
  const planName = `Resparq ${config.name} (${isAnnual ? "Annual" : "Monthly"})`;

  const lineItems = [
    {
      plan: {
        appRecurringPricingDetails: {
          price: { amount: price, currencyCode: "USD" },
          interval,
        },
      },
    },
  ];

  const response = await admin.graphql(
    `mutation AppSubscriptionCreate(
      $name: String!
      $lineItems: [AppSubscriptionLineItemInput!]!
      $returnUrl: URL!
      $trialDays: Int
      $test: Boolean
    ) {
      appSubscriptionCreate(
        name: $name
        lineItems: $lineItems
        returnUrl: $returnUrl
        trialDays: $trialDays
        test: $test
      ) {
        appSubscription {
          id
          status
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        name: planName,
        lineItems,
        returnUrl,
        trialDays,
        test: isTest,
      },
    }
  );

  const data = await response.json();
  const result = data.data.appSubscriptionCreate;

  if (result.userErrors.length > 0) {
    console.error("[Billing] Subscription creation errors:", result.userErrors);
    throw new Error(result.userErrors.map((e) => e.message).join(", "));
  }

  return {
    subscriptionId: result.appSubscription.id,
    confirmationUrl: result.confirmationUrl,
  };
}

/**
 * Get the active subscription for the current app installation.
 * Returns null if no active subscription exists.
 */
export async function getActiveSubscription(admin) {
  const response = await admin.graphql(
    `query {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          test
          trialDays
          currentPeriodEnd
          lineItems {
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
                  interval
                  price {
                    amount
                    currencyCode
                  }
                }
                ... on AppUsagePricing {
                  terms
                  cappedAmount {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }`
  );

  const data = await response.json();
  const subscriptions = data.data.currentAppInstallation.activeSubscriptions;

  if (!subscriptions || subscriptions.length === 0) {
    return null;
  }

  return subscriptions[0];
}

/**
 * Derive the plan tier from an active subscription name.
 */
export function tierFromSubscriptionName(name) {
  if (!name) return "starter";
  const lower = name.toLowerCase();
  if (lower.includes("enterprise")) return "enterprise";
  if (lower.includes("pro")) return "pro";
  return "starter";
}

/**
 * Derive the billing cycle from an active subscription.
 */
export function billingCycleFromSubscription(subscription) {
  if (!subscription) return null;
  for (const lineItem of subscription.lineItems || []) {
    const pricing = lineItem.plan?.pricingDetails;
    if (pricing && pricing.interval) {
      return pricing.interval === "ANNUAL" ? "annual" : "monthly";
    }
  }
  return "monthly";
}

/**
 * Sync the active Shopify subscription to the DB plan tier.
 * Call this in admin loaders to self-heal if the billing callback
 * missed the update (race condition, transient error, etc.).
 *
 * Returns the corrected tier, or the current DB tier if no subscription.
 */
export async function syncSubscriptionToPlan(admin, session, db) {
  try {
    const subscription = await getActiveSubscription(admin);
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { plan: true, subscriptionId: true }
    });

    if (subscription && subscription.status === "ACTIVE") {
      const subscriptionTier = tierFromSubscriptionName(subscription.name);
      const currentDbTier = shopRecord?.plan || "starter";

      // DB tier doesn't match what Shopify says — fix it
      if (currentDbTier !== subscriptionTier) {
        console.log(`[Billing Sync] Correcting plan for ${session.shop}: DB had "${currentDbTier}", subscription says "${subscriptionTier}"`);
        await db.shop.upsert({
          where: { shopifyDomain: session.shop },
          update: { plan: subscriptionTier, subscriptionId: subscription.id },
          create: { shopifyDomain: session.shop, plan: subscriptionTier, subscriptionId: subscription.id },
        });
        return subscriptionTier;
      }

      return currentDbTier;
    }

    // No active subscription — if DB still says a paid tier, downgrade to starter
    if (shopRecord?.plan && shopRecord.plan !== "starter" && !shopRecord.subscriptionId) {
      // Only downgrade if there was never a subscriptionId (i.e. the "pro" default bug)
      console.log(`[Billing Sync] No subscription found for ${session.shop}, DB has "${shopRecord.plan}" with no subscriptionId — correcting to starter`);
      await db.shop.update({
        where: { shopifyDomain: session.shop },
        data: { plan: "starter" },
      });
      return "starter";
    }

    return shopRecord?.plan || "starter";
  } catch (e) {
    console.error("[Billing Sync] Error:", e);
    return null; // Caller falls back to existing logic
  }
}
