// Generate unique discount code
function generateUniqueCode(type, amount, prefix = 'EXIT') {
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
export async function createGenericDiscountCode(admin, code, type, amount) {
  // First check if code already exists
  const existingCode = await checkDiscountCodeExists(admin, code);

  if (existingCode) {
    console.log(`Generic code ${code} already exists, reusing it`);
    return { code, exists: true };
  }

  // Create new generic code with no expiry
  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) {
                nodes {
                  code
                }
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

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
        }
      }
      // No usage limit for generic codes - can be reused
    }
  };

  const response = await admin.graphql(mutation, { variables });
  const result = await response.json();

  if (result.data.discountCodeBasicCreate.userErrors.length > 0) {
    console.error("Error creating generic discount:", result.data.discountCodeBasicCreate.userErrors);
    throw new Error("Failed to create generic discount code");
  }

  const createdCode = result.data.discountCodeBasicCreate.codeDiscountNode
    .codeDiscount.codes.nodes[0].code;

  console.log(` Created generic discount: ${createdCode} (no expiry)`);

  return { code: createdCode, exists: false };
}

/**
 * Check if a discount code already exists in Shopify
 */
async function checkDiscountCodeExists(admin, code) {
  const query = `
    query {
      codeDiscountNodes(first: 1, query: "code:${code}") {
        nodes {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) {
                nodes {
                  code
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await admin.graphql(query);
  const result = await response.json();

  return result.data.codeDiscountNodes.nodes.length > 0;
}

// Create percentage discount with 24h expiration
export async function createPercentageDiscount(admin, percentage, prefix = 'EXIT') {
  const code = generateUniqueCode('percentage', percentage, prefix);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  
  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) {
                nodes {
                  code
                }
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    basicCodeDiscount: {
      title: `${percentage}% Off - Exit Intent (24h)`,
      code: code,
      startsAt: new Date().toISOString(),
      endsAt: expiresAt.toISOString(),
      customerSelection: {
        all: true
      },
      customerGets: {
        value: {
          percentage: percentage / 100
        },
        items: {
          all: true
        }
      },
      appliesOncePerCustomer: true,
      usageLimit: 1
    }
  };

  const response = await admin.graphql(mutation, { variables });
  const result = await response.json();
  
  if (result.data.discountCodeBasicCreate.userErrors.length > 0) {
    console.error("Error creating discount:", result.data.discountCodeBasicCreate.userErrors);
    throw new Error("Failed to create discount code");
  }
  
  const createdCode = result.data.discountCodeBasicCreate.codeDiscountNode
    .codeDiscount.codes.nodes[0].code;
  
  console.log(` Created percentage discount: ${createdCode} (expires in 24h)`);
  
  return {
    code: createdCode,
    expiresAt: expiresAt
  };
}

// Create fixed amount discount with 24h expiration
export async function createFixedDiscount(admin, amount, prefix = 'EXIT') {
  const code = generateUniqueCode('fixed', amount, prefix);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  
  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) {
                nodes {
                  code
                }
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    basicCodeDiscount: {
      title: `$${amount} Off - Exit Intent (24h)`,
      code: code,
      startsAt: new Date().toISOString(),
      endsAt: expiresAt.toISOString(),
      customerSelection: {
        all: true
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
        }
      },
      appliesOncePerCustomer: true,
      usageLimit: 1
    }
  };

  const response = await admin.graphql(mutation, { variables });
  const result = await response.json();
  
  if (result.data.discountCodeBasicCreate.userErrors.length > 0) {
    console.error("Error creating discount:", result.data.discountCodeBasicCreate.userErrors);
    throw new Error("Failed to create discount code");
  }
  
  const createdCode = result.data.discountCodeBasicCreate.codeDiscountNode
    .codeDiscount.codes.nodes[0].code;
  
  console.log(` Created fixed discount: ${createdCode} (expires in 24h)`);
  
  return {
    code: createdCode,
    expiresAt: expiresAt
  };
}

// Create threshold discount (spend $X get $Y off) with 24h expiration
export async function createThresholdDiscount(admin, threshold, discountAmount, prefix = 'EXIT') {
  const code = generateUniqueCode('threshold', { threshold, amount: discountAmount }, prefix);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  
  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) {
                nodes {
                  code
                }
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    basicCodeDiscount: {
      title: `Spend $${threshold} Get $${discountAmount} Off - Exit Intent (24h)`,
      code: code,
      startsAt: new Date().toISOString(),
      endsAt: expiresAt.toISOString(),
      customerSelection: {
        all: true
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
        }
      },
      appliesOncePerCustomer: true,
      usageLimit: 1
    }
  };

  const response = await admin.graphql(mutation, { variables });
  const result = await response.json();
  
  if (result.data.discountCodeBasicCreate.userErrors.length > 0) {
    console.error("Error creating discount:", result.data.discountCodeBasicCreate.userErrors);
    throw new Error("Failed to create discount code");
  }
  
  const createdCode = result.data.discountCodeBasicCreate.codeDiscountNode
    .codeDiscount.codes.nodes[0].code;
  
  console.log(` Created threshold discount: ${createdCode} (spend $${threshold} get $${discountAmount} off, expires in 24h)`);
  
  return {
    code: createdCode,
    expiresAt: expiresAt,
    threshold: threshold
  };
}