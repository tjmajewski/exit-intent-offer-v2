import { ensureSubscriptionEligibility } from "./discount-subscription.js";
import {
  applySubscriptionFields,
  isSubscriptionFieldRejection,
  shopSellsSubscriptions
} from "./discount-subscription-fields.js";

/**
 * Send a discountCodeBasicCreate and return the created code.
 *
 * One submit path for all four create sites, because the subscription-field
 * rule has to be applied identically at every one of them. Four hand-copied
 * literals is how three of them ended up sending fields Shopify rejects.
 *
 * `input` must NOT carry appliesOnSubscription / appliesOnOneTimePurchase /
 * recurringCycleLimit — this decides whether to add them.
 *
 * The retry is the important part. A store that does not sell subscriptions
 * rejects all three fields and takes the ENTIRE offer down with them, which is
 * exactly what happened to the first paying merchant for a week. Capability
 * detection can be wrong or stale; this makes that survivable rather than
 * fatal.
 *
 * @param {object} admin
 * @param {Object} input - basicCodeDiscount, without subscription fields
 * @param {string} label - for logs
 * @param {string|null} shopId - cache key for capability detection
 * @returns {Promise<string>} the created code
 */
async function submitBasicCodeDiscount(admin, input, label, shopId = null) {
  const wantsSubscriptions = shopId
    ? await shopSellsSubscriptions(admin, shopId)
    : false;

  const attempt = async (withSubscriptions) => {
    const variables = {
      basicCodeDiscount: applySubscriptionFields(input, withSubscriptions)
    };
    const response = await admin.graphql(DISCOUNT_CREATE_MUTATION, { variables });
    const result = await response.json();
    // A top-level `errors` array means `data` is null. Reading through it is
    // how this used to surface as an opaque TypeError instead of the real
    // message.
    if (!result?.data?.discountCodeBasicCreate) {
      throw new Error(
        `${label}: no discountCodeBasicCreate in response — ` +
        `${JSON.stringify(result?.errors || result).slice(0, 400)}`
      );
    }
    return result.data.discountCodeBasicCreate;
  };

  let payload = await attempt(wantsSubscriptions);

  if (wantsSubscriptions && isSubscriptionFieldRejection(payload.userErrors)) {
    console.warn(
      `[Discount] ${label}: store rejected the subscription fields despite ` +
      `reporting selling plans — retrying without them.`
    );
    payload = await attempt(false);
  }

  if (payload.userErrors?.length > 0) {
    console.error(`Error creating discount (${label}):`, payload.userErrors);
    throw new Error(
      `Failed to create discount code (${label}): ` +
      payload.userErrors.map((e) => `${(e.field || []).join('.')}: ${e.message}`).join('; ')
    );
  }

  const created = payload.codeDiscountNode?.codeDiscount?.codes?.nodes?.[0]?.code;
  if (!created) {
    throw new Error(`${label}: create reported no errors but returned no code`);
  }
  return created;
}

const DISCOUNT_CREATE_MUTATION = `
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            codes(first: 1) { nodes { code } }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

/**
 * Derive a branded code prefix from the shop's myshopify domain.
 * acme-cycling.myshopify.com → "ACMECYCLI" (capped at 8 chars, alphanumeric only).
 * Falls back to "SAVE" when no usable shop name is available.
 */
export function derivePrefixFromShop(shopDomain) {
  if (!shopDomain || typeof shopDomain !== 'string') return 'SAVE';
  const handle = shopDomain.split('.')[0] || '';
  const cleaned = handle.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
  return cleaned || 'SAVE';
}

// Generate unique discount code
function generateUniqueCode(type, amount, prefix = 'SAVE') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);

  if (type === 'percentage') {
    return `${prefix}${amount}-${timestamp}${random}`.toUpperCase();
  } else if (type === 'fixed') {
    return `${prefix}${amount}OFF-${timestamp}${random}`.toUpperCase();
  } else if (type === 'threshold') {
    return `${prefix}SPEND${amount.threshold}-${timestamp}${random}`.toUpperCase();
  }

  return `${prefix}-${timestamp}${random}`.toUpperCase();
}

/**
 * Main function to create discount code based on shop's mode setting
 * Supports both generic (reusable) and unique (per-session) modes
 */
export async function createDiscountCode(admin, shop, options = {}) {
  const { cartValue, type, amount } = options;

  const discountType = type || shop.offerType || 'percentage';
  const discountAmount = amount || (discountType === 'percentage' ? 10 : 10);

  // MODE: Generic - Reuse existing code
  if (shop.discountCodeMode === 'generic' && shop.genericDiscountCode) {
    console.log(`Using generic discount code: ${shop.genericDiscountCode}`);

    return {
      code: shop.genericDiscountCode,
      amount: discountAmount,
      type: discountType,
      expiresAt: null, // No expiry for generic codes
      mode: 'generic'
    };
  }

  // MODE: Unique - Generate new code with 24h expiry
  const prefix = shop.discountCodePrefix || 'EXIT';
  let result;

  if (discountType === 'percentage') {
    result = await createPercentageDiscount(admin, discountAmount, prefix);
  } else if (discountType === 'fixed') {
    result = await createFixedDiscount(admin, discountAmount, prefix);
  } else {
    throw new Error(`Unsupported discount type: ${discountType}`);
  }

  return {
    code: result.code,
    amount: discountAmount,
    type: discountType,
    expiresAt: result.expiresAt,
    mode: 'unique'
  };
}

/**
 * Create or verify generic discount code exists in Shopify
 * Should be called when merchant saves settings with generic mode
 */
export async function createGenericDiscountCode(admin, code, type, amount, shopId = null) {
  // First check if code already exists
  const existingCode = await checkDiscountCodeExists(admin, code);

  if (existingCode) {
    console.log(`Generic code ${code} already exists, reusing it`);
    // Spec 2.0: a generic code minted before subscription support would be
    // rejected on every subscription cart, forever (generic codes never rotate).
    await ensureSubscriptionEligibility(admin, code);
    return { code, exists: true };
  }

  // Create new generic code with no expiry

  const variables = {
    basicCodeDiscount: {
      title: type === 'percentage'
        ? `${amount}% Off - Generic Exit Intent`
        : `$${amount} Off - Generic Exit Intent`,
      code: code,
      startsAt: new Date().toISOString(),
      // No endsAt - generic codes don't expire
      customerSelection: {
        all: true
      },
      // Stack with the store's own promos so the customer never has to choose
      // between our exit offer and an active site-wide code at checkout.
      combinesWith: {
        orderDiscounts: true,
        productDiscounts: true,
        shippingDiscounts: true
      },
      customerGets: {
        value: type === 'percentage'
          ? { percentage: amount / 100 }
          : {
              discountAmount: {
                amount: Math.round(amount).toString(),
                appliesOnEachItem: false
              }
            }
        ,
        items: {
          all: true
        },
        // See submitBasicCodeDiscount: the subscription fields are added only
        // when the store sells subscriptions.
      }
      // No usage limit for generic codes - can be reused
    }
  };

  const createdCode = await submitBasicCodeDiscount(
    admin, variables.basicCodeDiscount, `generic ${type} ${amount}`, shopId
  );

  console.log(` Created generic discount: ${createdCode} (no expiry)`);

  return { code: createdCode, exists: false };
}

/**
 * Look up the actual discount value of an existing code in Shopify.
 *
 * Used in generic-code mode: the merchant types in a code they already
 * created (e.g. "WELCOME10"). The AI evolves an offer amount independently
 * (e.g. 25%), so without this lookup the modal could promise "Save 25%"
 * while the code only gives 10% — a false-advertising bug for the customer.
 *
 * Returns: { type: 'percentage'|'fixed'|'threshold', amount: number, threshold: number|null }
 *   - percentage: amount is whole number (e.g. 10 = 10% off)
 *   - fixed:      amount is dollars off
 *   - threshold:  amount is dollars off, threshold is the spend requirement
 *   Returns null if the code is missing, free shipping, BXGY, or otherwise
 *   not representable as a single discount value (caller should fall back).
 *
 * Cached per code for 5 min — merchant's generic code rarely changes between
 * decisions, no point hammering Shopify on every modal show.
 */
const _genericCodeCache = new Map(); // code -> { value, expiresAt }
const GENERIC_CODE_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getDiscountCodeDetails(admin, code) {
  if (!code) return null;
  const now = Date.now();
  const cached = _genericCodeCache.get(code);
  if (cached && cached.expiresAt > now) return cached.value;

  const query = `
    query DiscountByCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            customerGets {
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount {
                  amount { amount }
                }
              }
            }
            minimumRequirement {
              __typename
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal { amount }
              }
            }
          }
        }
      }
    }
  `;

  let value = null;
  try {
    const response = await admin.graphql(query, { variables: { code } });
    const result = await response.json();
    const cd = result?.data?.codeDiscountNodeByCode?.codeDiscount;

    if (cd && cd.__typename === 'DiscountCodeBasic') {
      const v = cd.customerGets?.value;
      const min = cd.minimumRequirement;
      if (v?.__typename === 'DiscountPercentage' && typeof v.percentage === 'number') {
        // Shopify stores percentage as 0-1 fraction
        value = { type: 'percentage', amount: Math.round(v.percentage * 100), threshold: null };
      } else if (v?.__typename === 'DiscountAmount' && v.amount?.amount) {
        const amt = Math.round(parseFloat(v.amount.amount));
        if (min?.__typename === 'DiscountMinimumSubtotal' && min.greaterThanOrEqualToSubtotal?.amount) {
          value = { type: 'threshold', amount: amt, threshold: Math.round(parseFloat(min.greaterThanOrEqualToSubtotal.amount)) };
        } else {
          value = { type: 'fixed', amount: amt, threshold: null };
        }
      }
      // Other shapes (free shipping, BXGY) → value stays null, caller falls back
    }
  } catch (e) {
    console.error('[Discount Lookup] Failed to read code details:', e);
    return null;
  }

  _genericCodeCache.set(code, { value, expiresAt: now + GENERIC_CODE_CACHE_TTL_MS });
  return value;
}

/**
 * Check if a discount code already exists in Shopify
 */
async function checkDiscountCodeExists(admin, code) {
  const query = `
    query CheckCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        id
      }
    }
  `;

  const response = await admin.graphql(query, {
    variables: { code }
  });
  const result = await response.json();

  return !!result.data?.codeDiscountNodeByCode?.id;
}

// Create percentage discount with 24h expiration
export async function createPercentageDiscount(admin, percentage, prefix = 'SAVE', shopId = null) {
  const code = generateUniqueCode('percentage', percentage, prefix);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  

  const variables = {
    basicCodeDiscount: {
      title: `${percentage}% Off - Exit Intent (24h)`,
      code: code,
      startsAt: new Date().toISOString(),
      endsAt: expiresAt.toISOString(),
      customerSelection: {
        all: true
      },
      // Stack with the store's own promos so the customer never has to choose
      // between our exit offer and an active site-wide code at checkout.
      combinesWith: {
        orderDiscounts: true,
        productDiscounts: true,
        shippingDiscounts: true
      },
      customerGets: {
        value: {
          percentage: percentage / 100
        },
        items: {
          all: true
        },
        // appliesOnOneTimePurchase / appliesOnSubscription / recurringCycleLimit
        // are added by submitBasicCodeDiscount ONLY when the store sells
        // subscriptions. Shopify rejects all three otherwise and the whole
        // offer dies with them — see discount-subscription-fields.js.
      },
      appliesOncePerCustomer: true,
      usageLimit: 1
    }
  };

  const createdCode = await submitBasicCodeDiscount(
    admin, variables.basicCodeDiscount, `percentage ${percentage}%`, shopId
  );

  console.log(` Created percentage discount: ${createdCode} (expires in 24h)`);
  
  return {
    code: createdCode,
    expiresAt: expiresAt
  };
}

// Create fixed amount discount with 24h expiration
export async function createFixedDiscount(admin, amount, prefix = 'SAVE', shopId = null) {
  const code = generateUniqueCode('fixed', amount, prefix);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  

  const variables = {
    basicCodeDiscount: {
      title: `$${amount} Off - Exit Intent (24h)`,
      code: code,
      startsAt: new Date().toISOString(),
      endsAt: expiresAt.toISOString(),
      customerSelection: {
        all: true
      },
      // Stack with the store's own promos so the customer never has to choose
      // between our exit offer and an active site-wide code at checkout.
      combinesWith: {
        orderDiscounts: true,
        productDiscounts: true,
        shippingDiscounts: true
      },
      customerGets: {
        value: {
          discountAmount: {
            amount: Math.round(amount).toString(),
            appliesOnEachItem: false
          }
        },
        items: {
          all: true
        },
        // appliesOnOneTimePurchase / appliesOnSubscription / recurringCycleLimit
        // are added by submitBasicCodeDiscount ONLY when the store sells
        // subscriptions. Shopify rejects all three otherwise and the whole
        // offer dies with them — see discount-subscription-fields.js.
      },
      appliesOncePerCustomer: true,
      usageLimit: 1
    }
  };

  const createdCode = await submitBasicCodeDiscount(
    admin, variables.basicCodeDiscount, `fixed $${amount}`, shopId
  );

  console.log(` Created fixed discount: ${createdCode} (expires in 24h)`);
  
  return {
    code: createdCode,
    expiresAt: expiresAt
  };
}

// Create threshold discount (spend $X get $Y off) with 24h expiration
export async function createThresholdDiscount(admin, threshold, discountAmount, prefix = 'SAVE', shopId = null) {
  const code = generateUniqueCode('threshold', { threshold, amount: discountAmount }, prefix);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  

  const variables = {
    basicCodeDiscount: {
      title: `Spend $${threshold} Get $${discountAmount} Off - Exit Intent (24h)`,
      code: code,
      startsAt: new Date().toISOString(),
      endsAt: expiresAt.toISOString(),
      customerSelection: {
        all: true
      },
      // Stack with the store's own promos so the customer never has to choose
      // between our exit offer and an active site-wide code at checkout.
      combinesWith: {
        orderDiscounts: true,
        productDiscounts: true,
        shippingDiscounts: true
      },
      minimumRequirement: {
        subtotal: {
          greaterThanOrEqualToSubtotal: threshold.toString()
        }
      },
      customerGets: {
        value: {
          discountAmount: {
            amount: Math.round(discountAmount).toString(),
            appliesOnEachItem: false
          }
        },
        items: {
          all: true
        },
        // appliesOnOneTimePurchase / appliesOnSubscription / recurringCycleLimit
        // are added by submitBasicCodeDiscount ONLY when the store sells
        // subscriptions. Shopify rejects all three otherwise and the whole
        // offer dies with them — see discount-subscription-fields.js.
      },
      appliesOncePerCustomer: true,
      usageLimit: 1
    }
  };

  const createdCode = await submitBasicCodeDiscount(
    admin, variables.basicCodeDiscount, `threshold $${threshold}/$${discountAmount}`, shopId
  );

  console.log(` Created threshold discount: ${createdCode} (spend $${threshold} get $${discountAmount} off, expires in 24h)`);
  
  return {
    code: createdCode,
    expiresAt: expiresAt,
    threshold: threshold
  };
}