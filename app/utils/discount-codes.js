// Generate unique discount code
function generateUniqueCode(type, amount) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  
  if (type === 'percentage') {
    return `EXIT${amount}-${timestamp}${random}`.toUpperCase();
  } else if (type === 'fixed') {
    return `EXIT${amount}OFF-${timestamp}${random}`.toUpperCase();
  } else if (type === 'threshold') {
    return `EXITSPEND${amount.threshold}-${timestamp}${random}`.toUpperCase();
  }
  
  return `EXIT-${timestamp}${random}`.toUpperCase();
}

// Create percentage discount with 24h expiration
export async function createPercentageDiscount(admin, percentage) {
  const code = generateUniqueCode('percentage', percentage);
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
  
  console.log(`✓ Created percentage discount: ${createdCode} (expires in 24h)`);
  
  return {
    code: createdCode,
    expiresAt: expiresAt
  };
}

// Create fixed amount discount with 24h expiration
export async function createFixedDiscount(admin, amount) {
  const code = generateUniqueCode('fixed', amount);
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
  
  console.log(`✓ Created fixed discount: ${createdCode} (expires in 24h)`);
  
  return {
    code: createdCode,
    expiresAt: expiresAt
  };
}

// Create threshold discount (spend $X get $Y off) with 24h expiration
export async function createThresholdDiscount(admin, threshold, discountAmount) {
  const code = generateUniqueCode('threshold', { threshold, amount: discountAmount });
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
  
  console.log(`✓ Created threshold discount: ${createdCode} (spend $${threshold} get $${discountAmount} off, expires in 24h)`);
  
  return {
    code: createdCode,
    expiresAt: expiresAt,
    threshold: threshold
  };
}