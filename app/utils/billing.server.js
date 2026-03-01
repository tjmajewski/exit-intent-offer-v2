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

/**
 * Get commission rate for a plan tier.
 * Starter: 5%, Pro: 2%, Enterprise: 1%
 */
export function getCommissionRate(tier) {
  const rates = {
    starter: 0.05,
    pro: 0.02,
    enterprise: 0.01,
  };
  return rates[tier] || 0.05; // Default to starter rate
}

/**
 * Record a usage charge for recovered revenue.
 * This calls Shopify's appUsageRecordCreate mutation to bill the merchant.
 *
 * @param {object} admin - Shopify Admin API client
 * @param {string} subscriptionLineItemId - The usage line item ID from the subscription
 * @param {string} orderId - Order ID (used as idempotency key)
 * @param {number} recoveredRevenue - The order total that was recovered
 * @param {string} tier - Plan tier for commission rate
 * @returns {object} Result with success status and charge details
 */
export async function recordUsageCharge(admin, subscriptionLineItemId, orderId, recoveredRevenue, tier) {
  const commissionRate = getCommissionRate(tier);
  const chargeAmount = Math.round(recoveredRevenue * commissionRate * 100) / 100; // Round to cents

  // Don't charge for tiny amounts (under $0.50)
  if (chargeAmount < 0.50) {
    console.log(`[Billing] Skipping usage charge for order ${orderId}: amount $${chargeAmount} below minimum`);
    return {
      success: true,
      skipped: true,
      reason: "Amount below minimum threshold",
      chargeAmount,
    };
  }

  const description = `Commission on recovered order (${(commissionRate * 100).toFixed(0)}% of $${recoveredRevenue.toFixed(2)})`;

  try {
    const response = await admin.graphql(
      `mutation AppUsageRecordCreate(
        $subscriptionLineItemId: ID!
        $price: MoneyInput!
        $description: String!
        $idempotencyKey: String!
      ) {
        appUsageRecordCreate(
          subscriptionLineItemId: $subscriptionLineItemId
          price: $price
          description: $description
          idempotencyKey: $idempotencyKey
        ) {
          appUsageRecord {
            id
            createdAt
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          subscriptionLineItemId,
          price: {
            amount: chargeAmount,
            currencyCode: "USD",
          },
          description,
          idempotencyKey: `order-${orderId}`, // Ensures we don't double-charge
        },
      }
    );

    const data = await response.json();
    const result = data.data?.appUsageRecordCreate;

    if (!result) {
      console.error("[Billing] No result from usage record mutation:", data);
      return {
        success: false,
        error: "No response from Shopify",
        chargeAmount,
      };
    }

    if (result.userErrors && result.userErrors.length > 0) {
      const errorMessage = result.userErrors.map((e) => e.message).join(", ");
      console.error("[Billing] Usage charge errors:", result.userErrors);
      return {
        success: false,
        error: errorMessage,
        chargeAmount,
      };
    }

    console.log(`[Billing] Usage charge recorded: $${chargeAmount} for order ${orderId}`);
    return {
      success: true,
      chargeId: result.appUsageRecord.id,
      chargeAmount,
      createdAt: result.appUsageRecord.createdAt,
    };
  } catch (error) {
    console.error("[Billing] Error recording usage charge:", error);
    return {
      success: false,
      error: error.message,
      chargeAmount,
    };
  }
}

/**
 * Get the usage line item ID from an active subscription.
 * We need this ID to record usage charges.
 */
export async function getUsageLineItemId(admin) {
  const subscription = await getActiveSubscription(admin);

  if (!subscription) {
    console.log("[Billing] No active subscription found");
    return null;
  }

  // Find the usage pricing line item
  for (const lineItem of subscription.lineItems) {
    if (lineItem.plan.pricingDetails.__typename === "AppUsagePricing" ||
        lineItem.plan.pricingDetails.terms) {
      // The line item ID is needed for usage recording
      // We need to query for it specifically
      break;
    }
  }

  // Query for the subscription with line item IDs
  const response = await admin.graphql(
    `query {
      currentAppInstallation {
        activeSubscriptions {
          id
          lineItems {
            id
            plan {
              pricingDetails {
                __typename
                ... on AppUsagePricing {
                  terms
                }
              }
            }
          }
        }
      }
    }`
  );

  const data = await response.json();
  const subs = data.data?.currentAppInstallation?.activeSubscriptions;

  if (!subs || subs.length === 0) {
    return null;
  }

  // Find the usage line item
  for (const sub of subs) {
    for (const lineItem of sub.lineItems) {
      if (lineItem.plan.pricingDetails.__typename === "AppUsagePricing") {
        return {
          subscriptionId: sub.id,
          lineItemId: lineItem.id,
        };
      }
    }
  }

  return null;
}
