// =============================================================================
// SUBSCRIPTION ELIGIBILITY BACKFILL (spec section 2.0)
//
// Commit 1276574 made every discountCodeBasicCreate site set
// appliesOnSubscription / appliesOnOneTimePurchase / recurringCycleLimit: 1, so
// NEW codes apply to selling-plan line items (first billing cycle only).
//
// The gap this closes: every code-reuse path early-returns a pre-existing
// Shopify code untouched, so codes minted BEFORE that commit stay
// one-time-purchase-only and are silently rejected at checkout on a
// subscription cart. On the reuse path we now read the code's current
// eligibility and, only when it is stale, fire one discountCodeBasicUpdate.
//
// Self-limiting: after the first repair the code reports
// appliesOnSubscription: true, so the fleet backfills itself over normal
// traffic — no migration script, no extra mutation once a code is current.
//
// NEVER throws. This runs on the offer-delivery hot path; a code that could not
// be repaired is still a working code for one-time carts, and failing the whole
// request over it would be strictly worse than serving it as-is.
// =============================================================================

const CHECK_QUERY = `
  query CheckCodeSubscriptionEligibility($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        ... on DiscountCodeBasic {
          customerGets {
            appliesOnOneTimePurchase
            appliesOnSubscription
          }
        }
      }
    }
  }
`;

const UPDATE_MUTATION = `
  mutation BackfillSubscriptionEligibility($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Repair a reused discount code so it applies to subscription line items.
 *
 * @param {object} admin  Authenticated Admin GraphQL client
 * @param {string} code   The discount code being reused
 * @param {string|null} nodeId  Discount node id, when the caller already has it
 *                              from its own existence check (saves a query)
 * @returns {Promise<boolean>} true if the code is now subscription-eligible
 */
export async function ensureSubscriptionEligibility(admin, code, nodeId = null) {
  try {
    const checkResp = await admin.graphql(CHECK_QUERY, { variables: { code } });
    const checkJson = await checkResp.json();
    const node = checkJson?.data?.codeDiscountNodeByCode;
    const id = node?.id || nodeId;
    if (!id) return false;

    const gets = node?.codeDiscount?.customerGets;
    // Already current (or not a DiscountCodeBasic — e.g. a BXGY/free-shipping
    // code the merchant made by hand, which this backfill must not touch).
    if (!gets) return false;
    if (gets.appliesOnSubscription === true) return true;

    const updateResp = await admin.graphql(UPDATE_MUTATION, {
      variables: {
        id,
        basicCodeDiscount: {
          customerGets: {
            appliesOnOneTimePurchase: gets.appliesOnOneTimePurchase !== false,
            appliesOnSubscription: true
          },
          // Subscription (selling plan) items: discount the first billing cycle
          // only — renewals bill at full price. Same policy as the create sites.
          recurringCycleLimit: 1
        }
      }
    });
    const updateJson = await updateResp.json();
    const errors = updateJson?.data?.discountCodeBasicUpdate?.userErrors || [];
    if (errors.length > 0) {
      console.error(`[Subscription Backfill] ${code} not repaired:`, errors);
      return false;
    }

    console.log(`[Subscription Backfill] ${code} now applies to subscriptions (first cycle only)`);
    return true;
  } catch (err) {
    console.error(`[Subscription Backfill] ${code} check/update failed (serving code as-is):`, err.message);
    return false;
  }
}
