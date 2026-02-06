// Shopify App Billing - Subscription management via Shopify Billing API
// Uses appSubscriptionCreate mutation for recurring charges

const PLAN_CONFIGS = {
  starter: {
    name: "Starter",
    monthlyPrice: 29,
    annualPrice: 24.65,
    annualTotal: 296,
    usageTerms: "5% of recovered revenue",
    usageCap: 500,
  },
  pro: {
    name: "Pro",
    monthlyPrice: 79,
    annualPrice: 67.15,
    annualTotal: 806,
    usageTerms: "2% of recovered revenue",
    usageCap: 2000,
  },
  enterprise: {
    name: "Enterprise",
    monthlyPrice: 199,
    annualPrice: 169.15,
    annualTotal: 2030,
    usageTerms: "1% of recovered revenue",
    usageCap: 5000,
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
export async function createSubscription(admin, tier, billingCycle, returnUrl, isTest = true, trialDays = 0) {
  const config = PLAN_CONFIGS[tier];
  if (!config) {
    throw new Error(`Invalid plan tier: ${tier}`);
  }

  const isAnnual = billingCycle === "annual";
  const price = isAnnual ? config.annualPrice : config.monthlyPrice;
  const interval = isAnnual ? "ANNUAL" : "EVERY_30_DAYS";
  const planName = `ResparQ ${config.name} (${isAnnual ? "Annual" : "Monthly"})`;

  const lineItems = [
    {
      plan: {
        appRecurringPricingDetails: {
          price: { amount: price, currencyCode: "USD" },
          interval,
        },
      },
    },
    {
      plan: {
        appUsagePricingDetails: {
          terms: config.usageTerms,
          cappedAmount: { amount: config.usageCap, currencyCode: "USD" },
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
