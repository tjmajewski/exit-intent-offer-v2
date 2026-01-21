# Discount Code Modes: Generic vs Unique

**Status:** Pre-Implementation Documentation
**Target Release:** Before Production Launch
**Plan Tier:** All (Starter, Pro, Enterprise)
**Mode:** Both Manual and AI Mode
**Priority:** High (Pre-Launch Requirement)

---

## Overview

Allow merchants to choose between **unique discount codes** (one per customer session, 24-hour expiry) and **generic discount codes** (single reusable code for all customers). This gives merchants flexibility in how they manage discount distribution and redemption.

### Business Value

- **Flexibility** - Merchants choose strategy that fits their business
- **Simplicity** - Generic codes easier to manage and track
- **Scarcity** - Unique codes create urgency with 24-hour expiry
- **All plan tiers** - Democratizes feature across Starter, Pro, Enterprise

---

## User Stories

### Story 1: Merchant Wants Simplicity
**As a merchant,**
**I want to use a single generic discount code for all customers,**
**So that I can easily track redemptions and avoid creating hundreds of unique codes.**

### Story 2: Merchant Wants Urgency
**As a merchant,**
**I want unique discount codes with 24-hour expiry,**
**So that customers feel urgency to complete their purchase quickly.**

---

## Feature Requirements

### Functional Requirements

1. **Discount Mode Setting**
   - Setting: "Discount Code Mode" (Manual and AI modes)
   - Options:
     - **Generic** - Single reusable code for all customers
     - **Unique** - Unique code per session with 24-hour expiry
   - Default: Unique (current behavior)

2. **Generic Code Behavior**
   - Create ONE discount code in Shopify
   - Reuse same code for all customers
   - No expiry (or merchant-set expiry, optional)
   - Code format: Merchant-defined (e.g., "SAVE15", "WELCOME10")

3. **Unique Code Behavior** (Current)
   - Create unique code per customer session
   - Code format: `EXIT15-ABC123` (random suffix)
   - 24-hour expiry from creation
   - Track in DiscountOffer table

4. **Manual Mode**
   - Generic: Merchant sets code in settings (e.g., "SAVE15")
   - Unique: System generates codes with merchant-set prefix

5. **AI Mode**
   - Generic: Use single merchant-set code for all AI offers
   - Unique: System generates unique codes per AI decision

6. **Code Management**
   - Generic codes: Created once, reused indefinitely
   - Unique codes: Created per session, cleaned up after 24 hours
   - Both: Tracked for conversion attribution

---

## Database Schema Changes

### Shop Model Updates

Add to `prisma/schema.prisma`:

```prisma
model Shop {
  // ... existing fields

  // Discount Code Mode (All plans, both Manual and AI)
  discountCodeMode        String   @default("unique") // "unique" or "generic"
  genericDiscountCode     String?  // The generic code (if mode = generic)
  discountCodePrefix      String?  @default("EXIT") // Prefix for unique codes
}
```

**Migration:**
```bash
npx prisma migrate dev --name add_discount_code_mode
```

---

### DiscountOffer Model Updates

Update `prisma/schema.prisma`:

```prisma
model DiscountOffer {
  // ... existing fields

  // Add mode tracking
  mode                String   @default("unique") // "unique" or "generic"

  // Generic codes don't expire, but track it anyway
  expiresAt           DateTime?  // Nullable for generic codes

  // ... rest of fields
}
```

**Migration:**
```bash
npx prisma migrate dev --name add_discount_offer_mode
```

---

## UI Implementation

### Settings Page - Manual Mode

**File:** `app/routes/app.settings.jsx`

Add to Quick Setup or Advanced tab:

```jsx
{/* Discount Code Mode */}
<Card>
  <BlockStack gap="400">
    <Text variant="headingMd">Discount Code Mode</Text>

    <ChoiceList
      title="Choose how discount codes are generated"
      choices={[
        {
          label: 'Generic code (same for all customers)',
          value: 'generic',
          helpText: 'Use a single discount code for all customers. Easy to track and manage.'
        },
        {
          label: 'Unique codes (one per customer session)',
          value: 'unique',
          helpText: 'Generate unique codes with 24-hour expiry. Creates urgency and prevents sharing.'
        }
      ]}
      selected={[settings.discountCodeMode]}
      onChange={(value) => setSettings({
        ...settings,
        discountCodeMode: value[0]
      })}
    />

    {/* Show based on selected mode */}
    {settings.discountCodeMode === 'generic' ? (
      <>
        <TextField
          label="Generic discount code"
          value={settings.genericDiscountCode}
          onChange={(value) => setSettings({
            ...settings,
            genericDiscountCode: value.toUpperCase()
          })}
          placeholder="SAVE15"
          maxLength={20}
          helpText="This code will be shown to all customers. Use letters and numbers only."
        />

        <Banner status="info">
          <p>
            <strong>Generic mode:</strong> The code "{settings.genericDiscountCode || 'SAVE15'}"
            will be shown to every customer. This code will be created in Shopify with no expiry date.
          </p>
        </Banner>
      </>
    ) : (
      <>
        <TextField
          label="Code prefix (optional)"
          value={settings.discountCodePrefix}
          onChange={(value) => setSettings({
            ...settings,
            discountCodePrefix: value.toUpperCase()
          })}
          placeholder="EXIT"
          maxLength={10}
          helpText="Unique codes will be formatted as: PREFIX-ABC123"
        />

        <Banner status="info">
          <p>
            <strong>Unique mode:</strong> Each customer gets a unique code like
            "{settings.discountCodePrefix || 'EXIT'}-ABC123" that expires in 24 hours.
            This prevents code sharing and creates urgency.
          </p>
        </Banner>
      </>
    )}
  </BlockStack>
</Card>
```

---

### Settings Page - AI Mode

Same UI, but with additional explanation:

```jsx
{settings.mode === 'ai' && (
  <Banner>
    <p>
      <strong>AI Mode:</strong> The AI will use your selected discount code mode
      when making offers. Generic codes are simpler but allow sharing. Unique codes
      create urgency with 24-hour expiry.
    </p>
  </Banner>
)}
```

---

## Implementation Details

### 1. Manual Mode - Generic Code

**File:** `app/routes/app.settings.jsx` (action function)

```javascript
export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const settings = {
    discountCodeMode: formData.get('discountCodeMode'),
    genericDiscountCode: formData.get('genericDiscountCode'),
    discountCodePrefix: formData.get('discountCodePrefix'),
    // ... other fields
  };

  // If generic mode, create the generic discount code once
  if (settings.discountCodeMode === 'generic' && settings.genericDiscountCode) {
    const codeExists = await checkDiscountCodeExists(admin, settings.genericDiscountCode);

    if (!codeExists) {
      // Create new generic discount code
      await createGenericDiscountCode(admin, {
        code: settings.genericDiscountCode,
        type: settings.offerType,
        amount: settings.offerType === 'percentage'
          ? settings.discountPercentage
          : settings.discountAmount,
        noExpiry: true // Generic codes don't expire
      });
    }
  }

  // Save settings to database
  await db.shop.upsert({
    where: { shopifyDomain: session.shop },
    update: settings,
    create: { shopifyDomain: session.shop, ...settings }
  });

  return json({ success: true });
}
```

---

### 2. Discount Code Creation Utility

**File:** `app/utils/discount-codes.js`

Update to support both modes:

```javascript
/**
 * Creates discount code based on shop's mode setting
 */
export async function createDiscountCode(admin, shop, options = {}) {
  const { cartValue, signals } = options;

  // Determine discount amount (manual or AI)
  const discountAmount = options.amount || shop.discountPercentage || 10;
  const discountType = options.type || shop.offerType || 'percentage';

  // MODE: Generic - Reuse existing code
  if (shop.discountCodeMode === 'generic') {
    // Return the generic code (already created in settings)
    return {
      code: shop.genericDiscountCode,
      amount: discountAmount,
      type: discountType,
      expiresAt: null, // No expiry
      mode: 'generic'
    };
  }

  // MODE: Unique - Generate new code
  const uniqueCode = generateUniqueCode(shop.discountCodePrefix || 'EXIT');

  // Create discount in Shopify
  await createShopifyDiscount(admin, {
    code: uniqueCode,
    type: discountType,
    amount: discountAmount,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
  });

  // Track in database
  await db.discountOffer.create({
    data: {
      shopId: shop.id,
      discountCode: uniqueCode,
      offerType: discountType,
      amount: discountAmount,
      cartValue: cartValue || 0,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      mode: 'unique'
    }
  });

  return {
    code: uniqueCode,
    amount: discountAmount,
    type: discountType,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    mode: 'unique'
  };
}

function generateUniqueCode(prefix) {
  const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${randomSuffix}`;
}

async function createGenericDiscountCode(admin, { code, type, amount, noExpiry }) {
  const mutation = type === 'percentage'
    ? CREATE_PERCENTAGE_DISCOUNT_MUTATION
    : CREATE_FIXED_DISCOUNT_MUTATION;

  const variables = {
    discount: {
      title: code,
      code: code,
      value: type === 'percentage' ? { percentage: amount / 100 } : { amount: amount },
      startsAt: new Date().toISOString(),
      endsAt: noExpiry ? null : undefined, // No expiry for generic codes
      usageLimit: null // Unlimited uses
    }
  };

  await admin.graphql(mutation, { variables });
}
```

---

### 3. AI Mode Integration

**File:** `app/utils/ai-decision.js`

```javascript
export async function determineOffer(admin, signals, shop, cart) {
  // ... AI logic determines offer amount and type

  // Create discount code based on shop's mode
  const discountOffer = await createDiscountCode(admin, shop, {
    amount: proposedAmount,
    type: proposedType,
    cartValue: cart.totalValue,
    signals
  });

  return {
    action: 'offer',
    offer: {
      type: discountOffer.type,
      amount: discountOffer.amount,
      discountCode: discountOffer.code,
      expiresAt: discountOffer.expiresAt,
      mode: discountOffer.mode, // NEW: Track which mode
      // ... rest of offer data
    }
  };
}
```

---

### 4. Storefront Modal Updates

**File:** `extensions/exit-intent-modal/assets/exit-intent-modal.js`

Update modal rendering to show expiry only for unique codes:

```javascript
renderModal(settings, offer) {
  const modal = document.createElement('div');
  modal.className = 'exit-intent-modal';

  // ... existing modal HTML

  // Show countdown only for unique codes
  if (offer.mode === 'unique' && offer.expiresAt) {
    const expiryTime = new Date(offer.expiresAt);
    const hoursLeft = Math.ceil((expiryTime - Date.now()) / (1000 * 60 * 60));

    modal.innerHTML += `
      <div class="expiry-notice">
        <span class="urgency-icon">⏰</span>
        <span>Code expires in ${hoursLeft} hours</span>
      </div>
    `;
  } else if (offer.mode === 'generic') {
    // Optional: Show "No expiry" message
    modal.innerHTML += `
      <div class="expiry-notice">
        <span>Use code anytime!</span>
      </div>
    `;
  }

  return modal;
}
```

---

## Analytics Tracking

### Conversion Attribution

**File:** `app/routes/webhooks.orders.create.jsx`

Update to track both modes:

```javascript
export async function action({ request }) {
  const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

  const order = payload;
  const discountCode = order.discount_codes?.[0]?.code;

  if (!discountCode) return json({ success: true });

  // Find discount offer by code
  const discountOffer = await db.discountOffer.findFirst({
    where: {
      shop: { shopifyDomain: shop },
      discountCode: discountCode
    }
  });

  // Track conversion
  await db.conversion.create({
    data: {
      shopId: shopRecord.id,
      orderId: order.id,
      orderNumber: order.name,
      orderValue: parseFloat(order.total_price),
      discountCode: discountCode,
      discountMode: discountOffer?.mode || 'unknown', // NEW: Track mode
      // ... other fields
    }
  });

  return json({ success: true });
}
```

---

### Analytics Dashboard

**File:** `app/routes/app.analytics.jsx`

Add breakdown by code mode:

```javascript
export async function loader({ request }) {
  // ... existing analytics

  // NEW: Breakdown by discount mode
  const conversionsByMode = await db.conversion.groupBy({
    by: ['discountMode'],
    where: { shopId: shopRecord.id },
    _count: { id: true },
    _sum: { orderValue: true }
  });

  return json({
    analytics: {
      // ... existing metrics
      byMode: {
        generic: {
          conversions: conversionsByMode.find(m => m.discountMode === 'generic')?._count.id || 0,
          revenue: conversionsByMode.find(m => m.discountMode === 'generic')?._sum.orderValue || 0
        },
        unique: {
          conversions: conversionsByMode.find(m => m.discountMode === 'unique')?._count.id || 0,
          revenue: conversionsByMode.find(m => m.discountMode === 'unique')?._sum.orderValue || 0
        }
      }
    }
  });
}
```

---

## Edge Cases & Handling

### 1. Generic Code Already Exists

**Scenario:** Merchant enters "SAVE15", but code already exists in Shopify
**Handling:** Check if code exists, if yes, verify it matches settings, if not, show error

**Code:**
```javascript
const codeExists = await checkDiscountCodeExists(admin, genericCode);

if (codeExists) {
  const existingCode = await getDiscountCodeDetails(admin, genericCode);

  if (existingCode.value !== settings.discountPercentage) {
    return json({
      error: `Code "${genericCode}" already exists with different settings. Please choose a different code or update the existing one.`
    }, { status: 400 });
  }

  // Code exists with correct settings, proceed
}
```

---

### 2. Switching from Unique to Generic Mid-Campaign

**Scenario:** Merchant has active unique codes, switches to generic mode
**Handling:** Existing unique codes still valid until expiry, new offers use generic code

**Code:**
```javascript
// When mode changes, log event
if (oldSettings.discountCodeMode !== newSettings.discountCodeMode) {
  await db.settingsChangeLog.create({
    data: {
      shopId: shop.id,
      field: 'discountCodeMode',
      oldValue: oldSettings.discountCodeMode,
      newValue: newSettings.discountCodeMode,
      changedAt: new Date()
    }
  });

  // Don't delete existing unique codes, let them expire naturally
}
```

---

### 3. Generic Code Redemption Limit

**Scenario:** Merchant wants to limit total redemptions of generic code
**Handling:** Add optional "usage limit" setting

**Future Enhancement:**
```jsx
{settings.discountCodeMode === 'generic' && (
  <TextField
    label="Maximum redemptions (optional)"
    type="number"
    value={settings.genericCodeUsageLimit}
    onChange={(value) => setSettings({
      ...settings,
      genericCodeUsageLimit: parseInt(value)
    })}
    helpText="Leave empty for unlimited redemptions"
  />
)}
```

---

### 4. Code Sharing Prevention (Unique Mode)

**Scenario:** Customer shares unique code on social media
**Handling:** 24-hour expiry limits sharing window, track usage per code

**Monitoring:**
```javascript
// Track redemptions per unique code
const redemptions = await db.conversion.count({
  where: { discountCode: uniqueCode }
});

if (redemptions > 3) {
  // Alert: Possible code sharing
  console.warn(`[Code Sharing Alert] Code ${uniqueCode} used ${redemptions} times`);
}
```

---

## Testing Requirements

### Unit Tests

**File:** `app/utils/discount-codes.test.js`

```javascript
describe('Discount Code Modes', () => {
  test('generates unique code with prefix', () => {
    const code = generateUniqueCode('EXIT');
    expect(code).toMatch(/^EXIT-[A-Z0-9]{6}$/);
  });

  test('returns generic code when mode is generic', async () => {
    const shop = {
      discountCodeMode: 'generic',
      genericDiscountCode: 'SAVE15'
    };

    const result = await createDiscountCode(mockAdmin, shop);
    expect(result.code).toBe('SAVE15');
    expect(result.mode).toBe('generic');
    expect(result.expiresAt).toBeNull();
  });

  test('creates unique code when mode is unique', async () => {
    const shop = {
      discountCodeMode: 'unique',
      discountCodePrefix: 'EXIT'
    };

    const result = await createDiscountCode(mockAdmin, shop);
    expect(result.code).toMatch(/^EXIT-/);
    expect(result.mode).toBe('unique');
    expect(result.expiresAt).toBeTruthy();
  });
});
```

---

### Integration Tests

**Test Scenarios:**

1. **Manual mode, generic code**
   - Set mode to "generic"
   - Set code to "SAVE15"
   - Save settings
   - Expected: Code created in Shopify, no expiry

2. **Manual mode, unique code**
   - Set mode to "unique"
   - Set prefix to "EXIT"
   - Trigger modal
   - Expected: Unique code like "EXIT-ABC123" created, 24hr expiry

3. **AI mode, generic code**
   - Enable AI mode
   - Set discount mode to "generic"
   - Trigger AI decision
   - Expected: AI returns generic code for offer

4. **AI mode, unique code**
   - Enable AI mode
   - Set discount mode to "unique"
   - Trigger AI decision
   - Expected: AI creates new unique code per decision

5. **Mode switching**
   - Start with unique mode
   - Switch to generic mode
   - Expected: Settings saved, existing unique codes still valid

---

### Manual Testing Checklist

**Generic Mode:**
- [ ] Set mode to "generic" in settings
- [ ] Enter code "SAVE15"
- [ ] Save settings
- [ ] Verify code created in Shopify Admin
- [ ] Trigger exit intent on storefront
- [ ] Verify modal shows "SAVE15"
- [ ] Complete purchase with code
- [ ] Verify conversion tracked
- [ ] Trigger modal again (new session)
- [ ] Verify same code "SAVE15" shown

**Unique Mode:**
- [ ] Set mode to "unique" in settings
- [ ] Set prefix to "EXIT"
- [ ] Save settings
- [ ] Trigger exit intent on storefront
- [ ] Verify modal shows code like "EXIT-ABC123"
- [ ] Verify expiry notice shown
- [ ] Complete purchase with code
- [ ] Trigger modal again (new session)
- [ ] Verify NEW unique code shown (different from first)

**Mode Switching:**
- [ ] Start with unique mode
- [ ] Create test order with unique code
- [ ] Switch to generic mode
- [ ] Save settings
- [ ] Verify existing unique code still works
- [ ] Trigger new modal
- [ ] Verify generic code shown

---

## Migration Plan

### Phase 1: Database Schema
```bash
npx prisma migrate dev --name add_discount_code_mode
```

### Phase 2: Update Discount Code Utility
- Modify `app/utils/discount-codes.js`
- Add mode parameter
- Support both generic and unique creation

### Phase 3: Settings UI
- Add discount mode selector to settings
- Add generic code input field
- Update validation

### Phase 4: Storefront Integration
- Update modal JavaScript to handle both modes
- Add/remove expiry notice based on mode

### Phase 5: Analytics Tracking
- Add `discountMode` to Conversion model
- Update analytics dashboard

### Phase 6: Testing
- Unit tests for mode logic
- Integration tests for both modes
- Manual testing across all scenarios

---

## Success Metrics

**Week 1:**
- 40%+ of merchants choose generic mode
- 60%+ of merchants stick with unique mode
- Zero errors in discount code creation

**Month 1:**
- Generic mode: Higher absolute conversions (more redemptions)
- Unique mode: Higher conversion rate (urgency works)
- Customer feedback: "Love the flexibility!"

---

## Future Enhancements

1. **Custom expiry for generic codes**
   - Let merchant set expiry (e.g., "Valid until end of month")

2. **Hybrid mode**
   - Generic code + unique suffix
   - Example: "SAVE15-ABC123"
   - Track individual sessions but use consistent base code

3. **Usage limits per mode**
   - Generic: Limit total redemptions
   - Unique: Limit redemptions per code (default: 1)

4. **A/B test modes automatically**
   - Test both modes simultaneously
   - Recommend best performer

---

## Documentation for Merchants

### Help Text for Settings

**Generic Mode:**
> **Generic discount codes** use a single reusable code for all customers.
> This makes tracking simple and allows you to promote the same code across
> all channels. There's no expiry, so customers can use it anytime.
>
> **Best for:** Ongoing promotions, brand awareness, easy tracking

**Unique Mode:**
> **Unique discount codes** generate a new code for each customer session
> with a 24-hour expiry. This creates urgency and prevents code sharing,
> leading to higher conversion rates.
>
> **Best for:** Exit intent urgency, preventing abuse, one-time offers

---

## Open Questions

1. **Should generic codes have optional expiry?**
   - Current spec: No expiry
   - Alternative: Merchant-set expiry date

2. **Should we allow switching modes per modal (for multi-modal)?**
   - Current: Global setting
   - Alternative: Per-modal setting

3. **How to handle generic code conflicts?**
   - Current: Check if exists, error if different settings
   - Alternative: Auto-append number (SAVE15-2)

4. **Should unique codes be truly unique or allow duplicates?**
   - Current: Random generation (very low collision chance)
   - Alternative: Guaranteed unique with database check

---

**Last Updated:** January 2026
**Status:** Awaiting Implementation
**Owner:** Development Team
**Related:** Discount Creation, AI Decision Engine, Manual Mode
