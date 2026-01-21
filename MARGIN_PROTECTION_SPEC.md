# Margin Protection Feature - Enterprise AI Mode

**Status:** Pre-Implementation Documentation
**Target Release:** Before Production Launch
**Plan Tier:** Enterprise Only
**Mode:** AI Mode Only
**Priority:** High (Pre-Launch Requirement)

---

## Overview

Margin Protection prevents the AI from offering discounts that would cause merchants to sell below their desired profit margin. This feature fetches product cost data from Shopify and ensures discount offers maintain a minimum margin percentage set by the merchant.

### Business Value

- **Prevents loss-making sales** - AI won't discount below cost + desired margin
- **Protects profit margins** - Merchants set acceptable margin thresholds per product
- **Complements budget controls** - Works alongside existing daily/monthly budget caps
- **Enterprise differentiator** - Premium feature for high-volume merchants

---

## User Story

**As an Enterprise merchant using AI mode,**
**I want to set minimum margin thresholds,**
**So that the AI never offers discounts that eat into my profit margins below my acceptable level.**

---

## Feature Requirements

### Functional Requirements

1. **Fetch Product Costs**
   - Integrate with Shopify Admin API to fetch `inventoryItem.unitCost`
   - Handle products without cost data (skip margin check or use default)
   - Cache costs to minimize API calls

2. **Margin Calculation**
   - Formula: `Margin % = ((Price - Cost - Discount) / Price) × 100`
   - Example: $100 product, $40 cost, 15% discount → Margin = 45%
   - Calculate margin impact BEFORE making offer decision

3. **Merchant Controls**
   - Global minimum margin setting (e.g., "Never go below 30% margin")
   - Per-product margin overrides (optional, future enhancement)
   - Toggle to enable/disable margin protection

4. **AI Decision Logic**
   - Check margin impact before offering discount
   - If discount would break margin threshold, reduce discount amount or offer no discount
   - Fallback to reminder modal (no discount) if minimum viable discount breaks margin

5. **Admin UI**
   - Settings → AI Settings → New section: "Margin Protection"
   - Toggle: "Enable Margin Protection" (Enterprise only)
   - Input: "Minimum Margin %" (0-100, default: 20)
   - Help text: "AI will not offer discounts that reduce profit margin below this threshold"
   - Warning badge if product costs not set up in Shopify

---

## Database Schema Changes

### Shop Model Updates

Add to `prisma/schema.prisma`:

```prisma
model Shop {
  // ... existing fields

  // Margin Protection (Enterprise AI Mode)
  marginProtectionEnabled  Boolean  @default(false)
  minimumMarginPercent     Float    @default(20)
  marginProtectionUpdatedAt DateTime?
}
```

**Migration:**
```bash
npx prisma migrate dev --name add_margin_protection
```

---

## API Changes

### New Utility: Product Cost Fetcher

**File:** `app/utils/product-costs.js`

```javascript
/**
 * Fetches product costs from Shopify for margin calculations
 */

import { gql } from 'graphql-request';

const PRODUCT_COSTS_QUERY = gql`
  query GetProductCosts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        price
        inventoryItem {
          id
          unitCost {
            amount
          }
        }
      }
    }
  }
`;

export async function getProductCosts(admin, variantIds) {
  try {
    const response = await admin.graphql(PRODUCT_COSTS_QUERY, {
      variables: { ids: variantIds }
    });

    const data = await response.json();

    // Map variant ID to cost
    const costs = {};
    data.data.nodes.forEach(node => {
      if (node?.inventoryItem?.unitCost) {
        costs[node.id] = parseFloat(node.inventoryItem.unitCost.amount);
      }
    });

    return costs;
  } catch (error) {
    console.error('[Margin Protection] Failed to fetch product costs:', error);
    return {};
  }
}

export function calculateMargin(price, cost, discountAmount) {
  if (!cost || cost === 0) return null; // Can't calculate without cost

  const finalPrice = price - discountAmount;
  const profit = finalPrice - cost;
  const marginPercent = (profit / price) * 100;

  return {
    marginPercent,
    profit,
    finalPrice,
    cost
  };
}

export function getMaxDiscountForMargin(price, cost, minimumMarginPercent) {
  if (!cost || cost === 0) return null;

  // Formula: discount = price - cost - (price * minMargin / 100)
  const maxDiscount = price - cost - (price * minimumMarginPercent / 100);

  return Math.max(0, maxDiscount); // Never return negative
}
```

---

### AI Decision Updates

**File:** `app/utils/ai-decision.js`

Update `determineOffer()` function:

```javascript
export async function determineOffer(admin, signals, shop, cart) {
  // ... existing AI logic

  // NEW: Margin Protection Check (Enterprise + AI mode only)
  if (shop.plan === 'enterprise' && shop.marginProtectionEnabled) {
    const offerWithMargin = await applyMarginProtection(
      admin,
      proposedOffer,
      cart,
      shop.minimumMarginPercent
    );

    if (!offerWithMargin) {
      // Margin threshold cannot be met, return no-discount reminder
      return {
        action: 'offer',
        offer: createReminderModal(shop),
        reason: 'margin_protection'
      };
    }

    proposedOffer = offerWithMargin;
  }

  return {
    action: 'offer',
    offer: proposedOffer
  };
}

async function applyMarginProtection(admin, offer, cart, minimumMarginPercent) {
  // Fetch product costs for cart items
  const variantIds = cart.items.map(item => item.variantId);
  const costs = await getProductCosts(admin, variantIds);

  // Check each cart item's margin impact
  for (const item of cart.items) {
    const cost = costs[item.variantId];
    if (!cost) continue; // Skip if no cost data

    const price = parseFloat(item.price);
    const discountAmount = calculateDiscountAmount(offer, price);

    const margin = calculateMargin(price, cost, discountAmount);

    if (margin.marginPercent < minimumMarginPercent) {
      // Discount breaks margin threshold
      // Option 1: Reduce discount
      const maxDiscount = getMaxDiscountForMargin(price, cost, minimumMarginPercent);

      if (maxDiscount < 1) {
        // Even minimal discount breaks margin, return null
        return null;
      }

      // Adjust offer to max allowable discount
      offer.amount = calculatePercentageFromAmount(maxDiscount, price);
    }
  }

  return offer;
}

function calculateDiscountAmount(offer, price) {
  if (offer.type === 'percentage') {
    return price * (offer.amount / 100);
  } else if (offer.type === 'fixed') {
    return offer.amount;
  }
  return 0;
}
```

---

## UI Implementation

### Settings Page Updates

**File:** `app/routes/app.settings.jsx`

Add to AI Settings tab:

```jsx
{/* Margin Protection Section (Enterprise Only) */}
{hasFeature(plan, 'marginProtection') && (
  <Card>
    <BlockStack gap="400">
      <Text variant="headingMd">Margin Protection</Text>

      <Checkbox
        label="Enable margin protection"
        checked={settings.marginProtectionEnabled}
        onChange={(value) => setSettings({
          ...settings,
          marginProtectionEnabled: value
        })}
        helpText="Prevent AI from offering discounts that reduce profit margins below your threshold"
      />

      {settings.marginProtectionEnabled && (
        <>
          <TextField
            label="Minimum margin percentage"
            type="number"
            value={settings.minimumMarginPercent}
            onChange={(value) => setSettings({
              ...settings,
              minimumMarginPercent: parseFloat(value)
            })}
            suffix="%"
            min="0"
            max="100"
            helpText="AI will not offer discounts that reduce margin below this percentage"
          />

          <Banner status="info">
            <p>
              <strong>How it works:</strong> Before offering a discount, the AI checks
              each product's cost (from Shopify inventory) and ensures the final margin
              stays above your threshold.
            </p>
          </Banner>

          {!hasProductCosts && (
            <Banner status="warning">
              <p>
                <strong>Product costs not found.</strong> Set up product costs in
                Shopify Admin → Products → [Product] → Inventory → Cost per item.
                Without cost data, margin protection cannot function.
              </p>
            </Banner>
          )}
        </>
      )}
    </BlockStack>
  </Card>
)}
```

---

## Feature Gates

**File:** `app/utils/featureGates.js`

```javascript
export const PLAN_FEATURES = {
  starter: {
    // ... existing features
    marginProtection: false,
  },
  pro: {
    // ... existing features
    marginProtection: false,
  },
  enterprise: {
    // ... existing features
    marginProtection: true, // NEW
  }
};
```

---

## Edge Cases & Handling

### 1. Products Without Cost Data

**Scenario:** Merchant hasn't set `unitCost` in Shopify
**Handling:** Skip margin check for those products, log warning

**Code:**
```javascript
if (!cost) {
  console.warn(`[Margin Protection] No cost data for variant ${variantId}, skipping margin check`);
  continue; // Skip this item
}
```

---

### 2. Multiple Products in Cart with Different Costs

**Scenario:** Cart has 3 products, one breaks margin threshold
**Handling:** Calculate margin for each item, use most restrictive

**Code:**
```javascript
let maxAllowableDiscount = Infinity;

for (const item of cart.items) {
  const itemMaxDiscount = getMaxDiscountForMargin(item.price, item.cost, minimumMargin);
  maxAllowableDiscount = Math.min(maxAllowableDiscount, itemMaxDiscount);
}

// Apply most restrictive discount across cart
```

---

### 3. Discount Type Conflicts

**Scenario:** Fixed $10 discount, but margin only allows $5
**Handling:** Convert to percentage or reduce amount

**Code:**
```javascript
if (offer.type === 'fixed' && offer.amount > maxAllowableDiscount) {
  // Reduce fixed amount
  offer.amount = maxAllowableDiscount;
}
```

---

### 4. Budget Cap + Margin Protection

**Scenario:** Both budget and margin limits active
**Handling:** Apply both constraints, use most restrictive

**Logic:**
1. Check budget cap (existing)
2. If budget allows, check margin protection (new)
3. If margin protection reduces discount, use reduced amount
4. Track against budget as usual

---

## Testing Requirements

### Unit Tests

**File:** `app/utils/product-costs.test.js`

```javascript
describe('Margin Protection', () => {
  test('calculates margin correctly', () => {
    const margin = calculateMargin(100, 40, 15); // $100 product, $40 cost, $15 discount
    expect(margin.marginPercent).toBe(45); // (85 - 40) / 100 = 45%
  });

  test('gets max discount for 30% margin', () => {
    const maxDiscount = getMaxDiscountForMargin(100, 40, 30);
    expect(maxDiscount).toBe(30); // $100 - $40 - $30 = $30 max discount
  });

  test('returns null when cost is missing', () => {
    const margin = calculateMargin(100, null, 15);
    expect(margin).toBeNull();
  });
});
```

---

### Integration Tests

**Test Scenarios:**

1. **Margin protection enabled, discount within threshold**
   - Set minimum margin: 30%
   - Product: $100 price, $40 cost
   - AI offers: 15% discount
   - Expected: Discount applied (margin = 45%)

2. **Margin protection enabled, discount breaks threshold**
   - Set minimum margin: 30%
   - Product: $100 price, $70 cost
   - AI offers: 15% discount
   - Expected: Discount reduced to 0% or reminder modal (margin would be 15%)

3. **Margin protection disabled**
   - AI offers: Any discount
   - Expected: Margin not checked, normal behavior

4. **No cost data**
   - Product missing `unitCost`
   - Expected: Margin check skipped, warning logged

---

### Manual Testing Checklist

- [ ] Enable margin protection in settings (Enterprise)
- [ ] Set minimum margin to 30%
- [ ] Create test product with cost = $40, price = $100
- [ ] Add to cart, trigger exit intent
- [ ] Verify AI offers max 30% discount (margin stays at 30%)
- [ ] Create product with no cost data
- [ ] Verify AI offers normal discount (skips margin check)
- [ ] Disable margin protection
- [ ] Verify AI offers discounts without margin constraint

---

## Performance Considerations

### API Call Optimization

**Problem:** Fetching costs for every AI decision adds latency

**Solutions:**

1. **Cache product costs** (30 minutes TTL)
   ```javascript
   const costCache = new Map(); // In-memory cache
   const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
   ```

2. **Batch fetch costs** for entire cart
   ```javascript
   const variantIds = cart.items.map(i => i.variantId);
   const costs = await getProductCosts(admin, variantIds); // Single query
   ```

3. **Lazy load costs** (only when margin protection enabled)
   ```javascript
   if (!shop.marginProtectionEnabled) {
     return proposedOffer; // Skip cost fetch
   }
   ```

---

## Migration Plan

### Phase 1: Database Schema
```bash
npx prisma migrate dev --name add_margin_protection
```

### Phase 2: Add Utility Functions
- Create `app/utils/product-costs.js`
- Add margin calculation functions

### Phase 3: Update AI Decision Logic
- Integrate margin checks into `determineOffer()`
- Add logging and error handling

### Phase 4: UI Updates
- Add margin protection section to Settings
- Add feature gate for Enterprise

### Phase 5: Testing
- Unit tests for margin calculations
- Integration tests with real Shopify data
- Manual testing with various scenarios

### Phase 6: Documentation
- Update help docs
- Add tooltips in UI
- Create merchant guide

---

## Success Metrics

**Short-term (Week 1):**
- Feature enabled by 30%+ of Enterprise customers
- Zero margin-breaking discounts reported
- < 100ms added latency to AI decisions

**Long-term (Month 1):**
- 50%+ of Enterprise customers use margin protection
- Average margin maintained above merchant thresholds
- Customer feedback: "Prevents loss-making sales"

---

## Future Enhancements

1. **Per-product margin overrides**
   - Set different thresholds for different products
   - Example: 20% for apparel, 40% for accessories

2. **Margin-aware offer optimization**
   - AI learns which margins convert best
   - Optimize for "margin × conversion rate"

3. **Margin reporting**
   - Analytics showing average margin per conversion
   - Compare margin-protected vs non-protected sales

4. **Dynamic margin adjustment**
   - Lower margins for high-value customers
   - Higher margins for new customers

---

## Open Questions

1. **How to handle bundles/kits?**
   - Calculate weighted average cost?
   - Use most restrictive margin?

2. **Should margin be calculated per-item or cart-wide?**
   - Current spec: Per-item (most restrictive)
   - Alternative: Average margin across cart

3. **What if ALL products lack cost data?**
   - Disable feature with warning?
   - Proceed with default margin assumption?

---

**Last Updated:** January 2026
**Status:** Awaiting Implementation
**Owner:** Development Team
**Related:** Budget Controls, AI Decision Engine
