# Discount Code Implementation - Repsarq
**Status:** ✅ COMPLETE (Updated January 16, 2026)

## Overview
Repsarq supports automatic discount code creation and application in both Manual and AI modes. Discount codes are unique per customer in AI mode to prevent sharing on Reddit/social media. Manual mode uses simple, reusable codes.

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
5. **Modal Application** - handleCTAClick applies discount via Cart API
6. **Shopify Checkout** - Discount applied automatically

---

## Manual Mode Implementation

### Discount Code Creation
Located in `app/utils/discounts.js`:

#### Percentage Discounts
```javascript
export async function createDiscountCode(admin, discountPercentage) {
  const discountCode = `${discountPercentage}OFF`; // e.g., "5OFF", "10OFF"
  
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
  
  // ✅ FIXED: Verify exact code match (not just any discount exists)
  const codeExists = checkResult.data.codeDiscountNodes.nodes.some(node => 
    node.codeDiscount?.codes?.nodes?.some(c => c.code === discountCode)
  );
  
  if (codeExists) {
    console.log(`✓ Using existing discount code: ${discountCode}`);
    return discountCode;
  }
  
  // Create new discount code
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
    console.error("Error creating discount:", result.data.discountCodeBasicCreate.userErrors);
    throw new Error("Failed to create discount code");
  }
  
  const code = result.data.discountCodeBasicCreate.codeDiscountNode
    .codeDiscount.codes.nodes[0].code;
  
  console.log(`✓ Created new discount code: ${code}`);
  return code;
}
```

#### Fixed Amount Discounts
```javascript
export async function createFixedAmountDiscountCode(admin, discountAmount, currencyCode = 'USD') {
  const discountCode = `${discountAmount}DOLLARSOFF`; // e.g., "10DOLLARSOFF"
  
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
  
  // ✅ FIXED: Verify exact code match
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
      title: `$${discountAmount} Off - Exit Intent Offer`,
      code: discountCode,
      startsAt: new Date().toISOString(),
      customerSelection: { all: true },
      customerGets: {
        value: {
          discountAmount: {
            amount: discountAmount.toString(),
            appliesOnEachItem: false
          }
        },
        items: { all: true }
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
```

### Settings Save
```javascript
// app/routes/app.settings.jsx - action function
console.log('=== DISCOUNT DEBUG ===');
console.log('Discount enabled:', settings.discountEnabled);
console.log('Offer type:', settings.offerType);
console.log('Discount percentage:', settings.discountPercentage);
console.log('Discount amount:', settings.discountAmount);

// Create discount if enabled
if (settings.discountEnabled) {
  console.log('Creating discount code...');
  
  if (settings.offerType === "percentage" && settings.discountPercentage > 0) {
    console.log('Creating percentage discount:', settings.discountPercentage);
    settings.discountCode = await createDiscountCode(admin, settings.discountPercentage);
    console.log('Created code:', settings.discountCode);
  } else if (settings.offerType === "fixed" && settings.discountAmount > 0) {
    console.log('Creating fixed discount:', settings.discountAmount);
    settings.discountCode = await createFixedAmountDiscountCode(admin, settings.discountAmount);
    console.log('Created code:', settings.discountCode);
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

console.log('✓ Settings saved to database including discount code:', settings.discountCode);
```

---

## AI Mode Implementation

### Unique Codes Per Customer
AI mode generates unique codes to prevent sharing:
```javascript
// app/utils/discount-codes.js

function generateUniqueCode(type, amount) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  
  if (type === 'percentage') {
    return `EXIT${amount}-${timestamp}${random}`.toUpperCase();
  } else if (type === 'fixed') {
    return `EXIT${amount}OFF-${timestamp}${random}`.toUpperCase();
  }
  
  return `EXIT-${timestamp}${random}`.toUpperCase();
}

export async function createPercentageDiscount(admin, percentage) {
  const code = generateUniqueCode('percentage', percentage);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  
  // GraphQL mutation to create discount...
  
  return {
    code: createdCode,
    expiresAt: expiresAt
  };
}
```

### AI Decision with Discount
```javascript
// app/routes/apps.exit-intent.api.ai-decision.jsx
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
  discountCode: shopRecord.discountCode,  // ← Sent to modal
  discountEnabled: shopRecord.discountEnabled,
  offerType: shopRecord.offerType,
  triggers: { /* ... */ }
});
```

### Modal CTA Handler
`extensions/exit-intent-modal/assets/exit-intent-modal.js`:

**CRITICAL:** Modern Shopify checkouts don't accept `?discount=CODE` URL parameters. We must use the Cart API to apply discounts.
```javascript
async handleCTAClick() {
  // Track events
  this.trackEvent('click');
  this.trackVariant('click');
  
  if (this.currentImpressionId) {
    await fetch('/apps/exit-intent/api/track-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        impressionId: this.currentImpressionId,
        buttonType: 'primary'
      })
    });
  }
  
  // Close modal
  this.closeModal();
  
  const discountCode = this.settings.discountCode;
  const offerType = this.settings.offerType || 'percentage';
  const destination = this.settings.redirectDestination || 'checkout';
  
  // Handle gift card offer
  if (offerType === 'giftcard') {
    await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: 7790476951630, quantity: 1 }]
      })
    });
    window.location.href = destination === 'cart' ? '/cart' : '/checkout';
    return;
  }
  
  // ✅ Apply discount via Cart API (modern Shopify requirement)
  if (discountCode) {
    try {
      console.log(`Applying discount code via Cart API: ${discountCode}`);
      await fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attributes: {
            discount_code: discountCode
          }
        })
      });
      console.log('Discount code applied successfully');
    } catch (error) {
      console.error('Error applying discount code:', error);
    }
  }
  
  // Redirect to cart or checkout
  const redirectUrl = destination === 'cart' ? '/cart' : '/checkout';
  console.log(`Redirecting to ${redirectUrl}`);
  window.location.href = redirectUrl;
}
```

**Key Changes from Previous Implementation:**
- ❌ OLD: `window.location.href = `/checkout?discount=${discountCode}`` (doesn't work with modern Shopify)
- ✅ NEW: Apply via Cart API first, then redirect to `/checkout`
- Cart API call: `POST /cart/update.js` with `{ attributes: { discount_code: "5OFF" } }`

---

## Budget Cap Integration

Budget tracking works with AI mode discounts:
```javascript
// app/utils/ai-decision.js
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
2. Enable discount (5% percentage)
3. Save settings
4. Check terminal: `✓ Created new discount code: 5OFF` (or `Using existing discount code: 5OFF`)
5. Check Shopify Admin → Discounts → Verify `5OFF` exists
6. Go to store, add item to cart
7. Trigger modal (move mouse to top of browser)
8. Click CTA button
9. Check browser console: `Applying discount code via Cart API: 5OFF`
10. Verify discount applies at checkout ✅

### AI Mode Test
1. Switch to AI Mode in settings
2. Go to store, add item to cart
3. Trigger modal
4. AI generates unique code (e.g., `EXIT10-ABC123DEF`)
5. Click CTA
6. Verify unique discount code applied at checkout ✅

### Budget Cap Test
```bash
node test-budget-exhaustion.js
```
Should show budget exhausted when limit reached.

### Manual Verification
```bash
# Check discount exists in Shopify
# Admin → Discounts → Search for "5OFF"
# Should show: "5% Off - Exit Intent Offer"
```

---

## Common Issues

### Discount not applying at checkout
**Check:**
1. Is `discountCode` in shop-settings API response?
2. Does browser console show "Applying discount code via Cart API: [CODE]"?
3. Is discount active in Shopify Admin → Discounts?
4. Try manually at cart: Enter code and click "Apply"
5. Check Cart API response in Network tab

### Discount code not created
**Check:**
1. Terminal logs for "Creating discount code..."
2. Shopify Admin permissions (need `write_discounts` scope)
3. Any GraphQL errors in terminal
4. Check if code already exists (might be false positive)

### "Code not valid" error at cart
**Root Cause:** Code doesn't actually exist in Shopify
**Solution:** 
- Fixed in `app/utils/discounts.js` - now verifies exact code match
- Previous bug: Would return "Using existing" when code didn't exist
- Now properly checks: `node.codeDiscount?.codes?.nodes?.some(c => c.code === discountCode)`

### Budget not tracking
**Check:**
- `budgetEnabled: true` in database
- `DiscountOffer` records being created
- Period calculation (week vs month)

---

## Bug History

### Bug: Discount Code False Positive (FIXED - Jan 16, 2026)
**Problem:** Logs showed "Using existing discount code: 5OFF" but code didn't exist in Shopify
**Root Cause:** Check query returned `nodes.length > 0` if ANY discount existed, not the specific code
**Solution:** 
```javascript
// Before (WRONG)
if (checkResult.data.codeDiscountNodes.nodes.length > 0) {
  return discountCode; // Returns even if wrong code
}

// After (CORRECT)
const codeExists = checkResult.data.codeDiscountNodes.nodes.some(node => 
  node.codeDiscount?.codes?.nodes?.some(c => c.code === discountCode)
);
if (codeExists) {
  return discountCode; // Only returns if exact match
}
```

### Bug: Modern Shopify Checkout URL Parameters (FIXED - Jan 16, 2026)
**Problem:** `/checkout?discount=5OFF` didn't apply discount
**Root Cause:** New Shopify checkout (`/checkouts/cn/...`) doesn't read URL parameters
**Solution:** Apply discount via Cart API before redirecting:
```javascript
// Apply discount to cart first
await fetch('/cart/update.js', {
  method: 'POST',
  body: JSON.stringify({ attributes: { discount_code: "5OFF" } })
});

// Then redirect (discount already applied)
window.location.href = '/checkout';
```

---

## Files Reference

**Settings & Creation:**
- `app/routes/app.settings.jsx` - Discount creation, database save, form handling
- `app/utils/discounts.js` - Manual mode discount creation (percentage, fixed, gift card)
- `app/utils/discount-codes.js` - AI mode unique code generation

**API:**
- `app/routes/apps.exit-intent.api.shop-settings.jsx` - Returns discount code to modal
- `app/routes/apps.exit-intent.api.ai-decision.jsx` - AI discount decisions

**Modal:**
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` - Applies discount via Cart API

**Database:**
- `prisma/schema.prisma` - Shop and DiscountOffer models

**Budget:**
- `app/utils/ai-decision.js` - `checkBudget()` function

---

## Next Steps

**Completed:** ✅
- Discount creation (manual + AI) with exact code verification
- Database storage and sync
- API integration
- Modal application via Cart API (modern Shopify)
- Budget tracking
- Bug fixes for false positives and URL parameters

**Future Enhancements:**
- Discount expiration UI (show countdown in modal)
- Usage analytics per code
- Customer-specific restrictions
- A/B test discount amounts
- Margin protection (don't discount below X%)
- Automatic code cleanup (delete expired codes)

---

*Last Updated: January 16, 2026*
*Status: Production Ready* ✅
*Recent Fixes: Code verification + Cart API application*
