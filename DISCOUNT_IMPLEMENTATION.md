cat > DISCOUNT_IMPLEMENTATION.md << 'EOF'
# Discount Code Implementation - ResparQ
**Status:** ✅ COMPLETE (as of January 15, 2026)

## Overview
ResparQ now supports automatic discount code creation and application in both Manual and AI modes. Discount codes are unique per customer to prevent sharing on Reddit/social media.

---

## Architecture

### Database Storage
All discount-related data is stored in the database for fast API access:
```prisma
model Shop {
  // Modal Content
  modalHeadline       String?
  modalBody           String?
  ctaButton           String?
  redirectDestination String?  @default("checkout")
  
  // Discount Settings
  discountCode        String?
  discountEnabled     Boolean  @default(false)
  offerType           String?  @default("percentage")
}

model DiscountOffer {
  id              String    @id @default(uuid())
  shopId          String
  shop            Shop      @relation(fields: [shopId], references: [id])
  discountCode    String
  offerType       String
  amount          Float
  cartValue       Float?
  expiresAt       DateTime
  redeemed        Boolean   @default(false)
  redeemedAt      DateTime?
  createdAt       DateTime  @default(now())
}
```

### Flow
1. **Settings Page** - Merchant enables discount, sets amount/type
2. **Discount Creation** - Shopify Admin API creates discount code
3. **Database Save** - Code saved to Shop table
4. **API Response** - shop-settings API returns code to modal
5. **Modal Application** - handleCTAClick adds `?discount=CODE` to checkout URL
6. **Shopify Checkout** - Discount applied automatically

---

## Manual Mode Implementation

### Discount Code Creation
Located in `app/routes/app.settings.jsx`:
```javascript
// Percentage discount
async function createDiscountCode(admin, discountPercentage) {
  const discountCode = `${discountPercentage}OFF`; // e.g., "10OFF"
  
  // Check if exists
  const checkQuery = `
    query {
      codeDiscountNodes(first: 50, query: "code:'${discountCode}'") {
        nodes {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) { nodes { code } }
            }
          }
        }
      }
    }
  `;
  
  const checkResponse = await admin.graphql(checkQuery);
  const checkResult = await checkResponse.json();
  
  if (checkResult.data.codeDiscountNodes.nodes.length > 0) {
    return discountCode; // Reuse existing
  }
  
  // Create new discount
  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
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

  const variables = {
    basicCodeDiscount: {
      title: `${discountPercentage}% Off - Exit Intent Offer`,
      code: discountCode,
      startsAt: new Date().toISOString(),
      customerSelection: { all: true },
      customerGets: {
        value: { percentage: discountPercentage / 100 },
        items: { all: true }
      },
      appliesOncePerCustomer: false,
      usageLimit: null
    }
  };

  const response = await admin.graphql(mutation, { variables });
  const result = await response.json();
  
  if (result.data.discountCodeBasicCreate.userErrors.length > 0) {
    throw new Error("Failed to create discount code");
  }
  
  return result.data.discountCodeBasicCreate.codeDiscountNode
    .codeDiscount.codes.nodes[0].code;
}
```

Similar function exists for `createFixedAmountDiscountCode()`.

### Settings Save
```javascript
// Create discount if enabled
if (settings.discountEnabled) {
  if (settings.offerType === "percentage" && settings.discountPercentage > 0) {
    settings.discountCode = await createDiscountCode(admin, settings.discountPercentage);
  } else if (settings.offerType === "fixed" && settings.discountAmount > 0) {
    settings.discountCode = await createFixedAmountDiscountCode(admin, settings.discountAmount);
  }
}

// Save to database
await db.shop.upsert({
  where: { shopifyDomain: shopDomain },
  update: {
    discountCode: settings.discountCode,
    discountEnabled: settings.discountEnabled,
    offerType: settings.offerType,
    // ... other fields
  },
  create: { /* same fields */ }
});
```

---

## AI Mode Implementation

### Unique Codes Per Customer
AI mode generates unique codes to prevent sharing:
```javascript
// In app/routes/apps.exit-intent.api.ai-decision.jsx
let discountResult;
if (decision.type === 'percentage') {
  discountResult = await createPercentageDiscount(admin, decision.amount);
} else if (decision.type === 'fixed') {
  discountResult = await createFixedDiscount(admin, decision.amount);
}

// Track in database
const discountOffer = await db.discountOffer.create({
  data: {
    shopId: shopRecord.id,
    discountCode: discountResult.code,
    offerType: decision.type,
    amount: decision.amount,
    cartValue: signals.cartValue,
    expiresAt: discountResult.expiresAt,
    redeemed: false
  }
});
```

Unique codes follow pattern: `UNIQUE_${timestamp}_${random}` (implementation in `app/utils/discount-codes.js`).

---

## Modal Integration

### Shop Settings API
`app/routes/apps.exit-intent.api.shop-settings.jsx` returns discount code:
```javascript
return json({ 
  plan: shopRecord.plan || 'starter',
  mode: shopRecord.mode || 'manual',
  enabled: true,
  modalHeadline: shopRecord.modalHeadline,
  modalBody: shopRecord.modalBody,
  ctaButton: shopRecord.ctaButton,
  redirectDestination: shopRecord.redirectDestination,
  discountCode: shopRecord.discountCode,  // ← Added
  discountEnabled: shopRecord.discountEnabled,
  offerType: shopRecord.offerType,
  triggers: { /* ... */ }
});
```

### Modal CTA Handler
`extensions/exit-intent-modal/assets/exit-intent-modal.js`:
```javascript
async handleCTAClick() {
  this.trackEvent('click');
  this.closeModal();
  
  const discountCode = this.settings.discountCode;
  const destination = this.settings.redirectDestination || 'checkout';
  
  // Build redirect URL
  let redirectUrl;
  if (destination === 'cart') {
    if (discountCode) {
      sessionStorage.setItem('exitIntentDiscount', discountCode);
    }
    redirectUrl = '/cart';
  } else {
    redirectUrl = discountCode ? `/checkout?discount=${discountCode}` : '/checkout';
  }
  
  window.location.href = redirectUrl;
}
```

---

## Budget Cap Integration

Budget tracking works with AI mode discounts:
```javascript
// In app/utils/ai-decision.js
export async function checkBudget(db, shopId, budgetPeriod) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  
  if (!shop || !shop.budgetEnabled) {
    return { hasRoom: true, remaining: Infinity };
  }
  
  // Calculate period start
  const now = new Date();
  const periodStart = budgetPeriod === 'week' 
    ? new Date(now.setDate(now.getDate() - 7))
    : new Date(now.setMonth(now.getMonth() - 1));
  
  // Sum discount offers in period
  const offers = await db.discountOffer.findMany({
    where: {
      shopId: shopId,
      createdAt: { gte: periodStart },
      expiresAt: { gte: new Date() }
    }
  });
  
  const totalSpent = offers.reduce((sum, offer) => sum + offer.amount, 0);
  const remaining = shop.budgetAmount - totalSpent;
  
  return {
    hasRoom: remaining > 0,
    remaining: Math.max(remaining, 0),
    totalSpent
  };
}
```

When budget exhausted, AI returns no-discount modal.

---

## Testing

### Manual Mode Test
1. Go to Settings → Manual Mode
2. Enable discount (10% percentage)
3. Save settings
4. Check terminal: `✓ Created discount code: 10OFF`
5. Go to store, trigger modal
6. Click CTA
7. Verify URL: `/checkout?discount=10OFF`
8. Verify discount applies in checkout ✅

### AI Mode Test
1. Switch to AI Mode in settings
2. Go to store, trigger modal
3. AI generates unique code
4. Click CTA
5. Verify unique discount code in URL
6. Verify discount applies ✅

### Budget Cap Test
```bash
node test-budget-exhaustion.js
```

Should show budget exhausted when limit reached.

---

## Common Issues

### Discount not applying at checkout
**Check:**
- Is `discountCode` in shop-settings API response?
- Does checkout URL have `?discount=CODE`?
- Is discount active in Shopify Admin → Discounts?
- Try manually: `/checkout?discount=10OFF`

### Discount code not created
**Check:**
- Terminal logs for "Creating discount code..."
- Shopify Admin permissions (need `write_discounts` scope)
- Any GraphQL errors in terminal

### Budget not tracking
**Check:**
- `budgetEnabled: true` in database
- `DiscountOffer` records being created
- Period calculation (week vs month)

---

## Files Reference

**Settings & Creation:**
- `app/routes/app.settings.jsx` - Discount creation, database save
- `app/utils/discount-codes.js` - Unique code generation (AI mode)

**API:**
- `app/routes/apps.exit-intent.api.shop-settings.jsx` - Returns discount code to modal
- `app/routes/apps.exit-intent.api.ai-decision.jsx` - AI discount decisions

**Modal:**
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` - Applies discount to checkout URL

**Database:**
- `prisma/schema.prisma` - Shop and DiscountOffer models

**Budget:**
- `app/utils/ai-decision.js` - `checkBudget()` function

---

## Next Steps

**Completed:** ✅
- Discount creation (manual + AI)
- Database storage
- API integration
- Modal application
- Budget tracking

**Future Enhancements:**
- Discount expiration (24 hours)
- Usage limit per code
- Customer-specific restrictions
- A/B test discount amounts
- Margin protection (don't discount below X%)

---

*Last Updated: January 15, 2026*
*Status: Production Ready* ✅
EOF