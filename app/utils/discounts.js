export async function createDiscountCode(admin, discountPercentage) {
  const discountCode = `${discountPercentage}OFF`;
  
  console.log(`Creating discount code: ${discountCode}`);
  
  // Check if THIS SPECIFIC code already exists
  const checkQuery = `
    query {
      codeDiscountNodes(first: 50, query: "code:'${discountCode}'") {
        nodes {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
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
  
  const checkResponse = await admin.graphql(checkQuery);
  const checkResult = await checkResponse.json();
  
  // Check if the SPECIFIC code exists in the results
  const codeExists = checkResult.data.codeDiscountNodes.nodes.some(node => 
    node.codeDiscount?.codes?.nodes?.some(c => c.code === discountCode)
  );
  
  if (codeExists) {
    console.log(`✓ Using existing discount code: ${discountCode}`);
    return discountCode;
  }
  
  // Create new discount code with percentage in title
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
      title: `${discountPercentage}% Off - Exit Intent Offer`,
      code: discountCode,
      startsAt: new Date().toISOString(),
      customerSelection: {
        all: true
      },
      customerGets: {
        value: {
          percentage: discountPercentage / 100
        },
        items: {
          all: true
        }
      },
      appliesOncePerCustomer: false,
      usageLimit: null
    }
  };

  const response = await admin.graphql(mutation, { variables });
  const result = await response.json();
  
  if (result.data.discountCodeBasicCreate.userErrors.length > 0) {
    console.error("Error creating discount:", result.data.discountCodeBasicCreate.userErrors);
    throw new Error("Failed to create discount code");
  }
  
  const code = result.data.discountCodeBasicCreate.codeDiscountNode
    .codeDiscount.codes.nodes[0].code;
  
  console.log(`✓ Created new discount code: ${code}`);
  return code;
}

export async function createFixedAmountDiscountCode(admin, discountAmount, currencyCode = 'USD') {
  const discountCode = `${discountAmount}DOLLARSOFF`;
  
  console.log(`Creating fixed amount discount code: ${discountCode}`);
  
  // Check if THIS SPECIFIC code already exists
  const checkQuery = `
    query {
      codeDiscountNodes(first: 50, query: "code:'${discountCode}'") {
        nodes {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
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
  
  const checkResponse = await admin.graphql(checkQuery);
  const checkResult = await checkResponse.json();
  
  console.log('=== CHECK QUERY RESULT ===');
  console.log('Query result:', JSON.stringify(checkResult, null, 2));
  console.log('Nodes found:', checkResult.data?.codeDiscountNodes?.nodes?.length || 0);
  
  // Check if the SPECIFIC code exists in the results
  const codeExists = checkResult.data.codeDiscountNodes.nodes.some(node => 
    node.codeDiscount?.codes?.nodes?.some(c => c.code === discountCode)
  );
  
  if (codeExists) {
    console.log(`✓ Using existing discount code: ${discountCode}`);
    return discountCode;
  }
  
  // Create new fixed amount discount code
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
      title: `$${discountAmount} Off - Exit Intent Offer`,
      code: discountCode,
      startsAt: new Date().toISOString(),
      customerSelection: {
        all: true
      },
      customerGets: {
        value: {
          discountAmount: {
            amount: discountAmount.toString(),
            appliesOnEachItem: false
          }
        },
        items: {
          all: true
        }
      },
      appliesOncePerCustomer: false,
      usageLimit: null
    }
  };

  const response = await admin.graphql(mutation, { variables });
  const result = await response.json();
  
  if (result.data.discountCodeBasicCreate.userErrors.length > 0) {
    console.error("Error creating discount:", result.data.discountCodeBasicCreate.userErrors);
    throw new Error("Failed to create discount code: " + JSON.stringify(result.data.discountCodeBasicCreate.userErrors));
  }
  
  const code = result.data.discountCodeBasicCreate.codeDiscountNode
    .codeDiscount.codes.nodes[0].code;
  
  console.log(`✓ Created new fixed amount discount code: ${code}`);
  return code;
}

export async function createGiftCard(admin, giftCardAmount) {
  const giftCardValue = parseFloat(giftCardAmount);
  
  console.log(`Creating $${giftCardValue} gift card`);
  
  const mutation = `
    mutation giftCardCreate($input: GiftCardCreateInput!) {
      giftCardCreate(input: $input) {
        giftCard {
          id
          initialValue {
            amount
          }
          maskedCode
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      initialValue: giftCardValue,
      note: "Exit Intent Offer"
    }
  };

  const response = await admin.graphql(mutation, { variables });
  const result = await response.json();
  
  if (result.data.giftCardCreate.userErrors.length > 0) {
    console.error("Error creating gift card:", result.data.giftCardCreate.userErrors);
    throw new Error("Failed to create gift card: " + JSON.stringify(result.data.giftCardCreate.userErrors));
  }
  
  const giftCardCode = result.data.giftCardCreate.giftCard.id;
  console.log(`✓ Created gift card: ${giftCardCode}`);
  
  return giftCardCode;
}
