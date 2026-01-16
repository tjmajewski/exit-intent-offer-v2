# Plan Switcher Architecture - ResparQ
**Date:** January 16, 2026
**Status:** ✅ Fixed and Working

## Overview
The plan switcher is a **dev-only** feature that allows testing different plan tiers (Starter/Pro/Enterprise) without actual billing. It persists across all pages and controls feature access throughout the app.

---

## Architecture

### Data Storage: Dual System
Plans are stored in **TWO places** for different purposes:

#### 1. Database (Prisma)
```prisma
model Shop {
  id            String   @id @default(uuid())
  shopifyDomain String   @unique
  plan          String   @default("pro")  // ← Source of truth
  // ... other fields
}
```

**Purpose:** Fast API access, consistent across sessions
**Access:** `db.shop.findUnique({ where: { shopifyDomain } })`

#### 2. Shopify Metafields
```javascript
{
  namespace: "exit_intent",
  key: "plan",
  value: JSON.stringify({
    tier: "pro",
    status: "active",
    billingCycle: "monthly"
  })
}
```

**Purpose:** Shopify-native storage, used by some legacy code
**Access:** Admin GraphQL API

### Why Both?
- **Database** = Fast, reliable, used by modal APIs
- **Metafields** = Backwards compatibility, some pages still read from here
- **Critical:** Both must stay in sync

---

## Plan Switcher UI Location

### Development Mode Only
```javascript
// app/components/AppLayout.jsx
function DevPlanSwitcher({ plan }) {
  if (process.env.NODE_ENV !== 'development' || !plan) {
    return null; // Hidden in production
  }
  
  return (
    <fetcher.Form method="post" action="/app/dev-update-plan">
      <select name="tier" defaultValue={plan.tier} onChange={...}>
        <option value="starter">Starter</option>
        <option value="pro">Pro</option>
        <option value="enterprise">Enterprise</option>
      </select>
    </fetcher.Form>
  );
}
```

**Location:** Bottom of sidebar (above "PRO PLAN" badge)
**Visibility:** Only in development environment
**Position:** Persists across all pages (part of AppLayout)

---

## How Plan Switching Works

### Flow Diagram
```
User selects plan
    ↓
DevPlanSwitcher submits form
    ↓
POST /app/dev-update-plan
    ↓
Update Database (Shop.plan)
    ↓
Update Metafields (exit_intent:plan)
    ↓
Redirect back to previous page
    ↓
Page loader reads updated plan
    ↓
UI updates with new tier gates
```

### Step-by-Step Code Flow

#### 1. User Changes Dropdown
```javascript
// Dropdown in DevPlanSwitcher
<select name="tier" onChange={(e) => e.target.form.requestSubmit()}>
```
- Auto-submits form on change
- Sends tier value to backend

#### 2. Backend Route Handles Update
```javascript
// app/routes/app.dev-update-plan.jsx
export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const tier = formData.get("tier"); // "starter" | "pro" | "enterprise"
  
  // Step 1: Get current plan from metafields
  const shopResponse = await admin.graphql(`
    query {
      shop {
        id
        plan: metafield(namespace: "exit_intent", key: "plan") {
          value
        }
      }
    }
  `);
  
  // Step 2: Update metafields
  const currentPlan = JSON.parse(shopData.data.shop.plan.value);
  currentPlan.tier = tier;
  
  await admin.graphql(`
    mutation UpdatePlan($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [{
        ownerId: $ownerId
        namespace: "exit_intent"
        key: "plan"
        value: $value
        type: "json"
      }]) {
        metafields { id }
      }
    }
  `, { variables: { ownerId: shopId, value: JSON.stringify(currentPlan) }});
  
  // Step 3: Update database
  await db.shop.upsert({
    where: { shopifyDomain: session.shop },
    update: { plan: tier },
    create: { shopifyDomain: session.shop, plan: tier }
  });
  
  // Step 4: Redirect back
  return redirect(request.headers.get("Referer") || "/app");
}
```

#### 3. Page Loaders Read Updated Plan

**Dashboard Example:**
```javascript
// app/routes/app._index.jsx
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  
  // Get plan from database (fast, reliable)
  const shopRecord = await db.shop.findUnique({
    where: { shopifyDomain: session.shop }
  });
  
  const plan = shopRecord 
    ? { tier: shopRecord.plan, status: "active" }
    : { tier: "starter", status: "active" };
  
  return { plan, /* other data */ };
}
```

**Settings Example:**
```javascript
// app/routes/app.settings.jsx
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  
  const shopRecord = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      plan: true,
      brandPrimaryColor: true,
      // ... other fields
    }
  });
  
  const plan = shopRecord 
    ? { tier: shopRecord.plan, billingCycle: "monthly" }
    : { tier: "starter", billingCycle: "monthly" };
  
  return { settings, plan, /* other data */ };
}
```

#### 4. UI Updates with Feature Gates
```javascript
// Feature gates use plan tier
const canUseAIMode = plan && (plan.tier === "pro" || plan.tier === "enterprise");
const canUseAllTriggers = plan ? hasFeature(plan, 'allTriggers') : false;
const canUseCartValue = plan ? hasFeature(plan, 'cartValueTargeting') : false;

// Conditional rendering
{canUseAIMode ? (
  <AISettings />
) : (
  <UpgradePrompt tier="pro" />
)}
```

---

## Feature Access by Tier

### Starter ($29/mo)
- ✅ Manual mode only
- ✅ Basic triggers (exit intent)
- ✅ 1,000 sessions/month
- ❌ No AI mode
- ❌ No timer trigger
- ❌ No cart value targeting
- ❌ Limited analytics (30 days only)

### Pro ($79/mo)
- ✅ AI mode with optimization
- ✅ All triggers (exit intent, timer, cart value)
- ✅ 10,000 sessions/month
- ✅ Full analytics (lifetime)
- ✅ Budget caps
- ❌ No manual variant controls
- ❌ No promo intelligence
- ❌ No brand customization

### Enterprise ($299/mo)
- ✅ Everything in Pro
- ✅ Manual variant controls (Kill/Protect/Champion)
- ✅ Promotional intelligence
- ✅ Brand customization (colors, fonts, CSS)
- ✅ Evolution system controls
- ✅ Unlimited sessions
- ✅ Priority support

---

## Feature Gate Implementation

### Central Feature Gate Utility
```javascript
// app/utils/featureGates.js
export function hasFeature(plan, feature) {
  const tier = plan?.tier || 'starter';
  
  const features = {
    starter: ['manual', 'exitIntent'],
    pro: ['manual', 'ai', 'exitIntent', 'allTriggers', 'cartValueTargeting', 'redirectChoice', 'lifetimeAnalytics'],
    enterprise: ['manual', 'ai', 'exitIntent', 'allTriggers', 'cartValueTargeting', 'redirectChoice', 'lifetimeAnalytics', 'manualControls', 'promoIntelligence', 'brandCustomization', 'evolutionControls']
  };
  
  return features[tier]?.includes(feature) || false;
}
```

### Usage in Components
```javascript
// Get feature access
const canUseAIMode = hasFeature(plan, 'ai');
const canUseAllTriggers = hasFeature(plan, 'allTriggers');

// Conditional UI
{canUseAIMode ? (
  <AISettingsTab {...props} />
) : (
  <div>
    <h2>Upgrade to Pro</h2>
    <p>AI optimization available on Pro and Enterprise plans</p>
  </div>
)}
```

---

## Testing the Plan Switcher

### Test Checklist

**Basic Functionality:**
1. ✅ Dropdown shows current plan selected
2. ✅ Changing plan triggers immediate update
3. ✅ Page refreshes with new plan tier
4. ✅ Sidebar badge updates ("STARTER PLAN" → "PRO PLAN")
5. ✅ Plan persists after navigation

**Feature Gates:**
1. ✅ Starter: AI tab shows upsell overlay
2. ✅ Starter: Advanced tab shows upsell
3. ✅ Pro: AI tab shows settings
4. ✅ Pro: Advanced tab shows settings
5. ✅ Pro: Branding tab shows upsell (Enterprise only)
6. ✅ Enterprise: All tabs accessible
7. ✅ Enterprise: No upsell prompts shown

**Navigation Persistence:**
1. ✅ Switch to Pro → Navigate to Settings → Still Pro
2. ✅ Switch to Enterprise → Navigate to Analytics → Still Enterprise
3. ✅ Switch to Starter → Refresh page → Still Starter

**Database Sync:**
```sql
-- Check database value
SELECT shopifyDomain, plan FROM Shop WHERE shopifyDomain = 'exit-intent-test-2.myshopify.com';
```

**Metafield Sync:**
```graphql
# Check metafield value in Shopify Admin
query {
  shop {
    metafield(namespace: "exit_intent", key: "plan") {
      value
    }
  }
}
```

---

## Bug History

### Bug #2: Plan Persistence Issue (FIXED)
**Problem:** Sidebar switcher and dashboard top switcher were out of sync
**Root Cause:** 
- Sidebar switcher updated database only
- Dashboard switcher updated metafields only
- Different pages read from different sources

**Solution:**
- Removed dashboard top switcher (duplicate)
- Updated sidebar switcher to update BOTH database AND metafields
- Ensured all page loaders read from database consistently

**Files Changed:**
- `app/routes/app.dev-update-plan.jsx` - Now updates both sources
- `app/routes/app._index.jsx` - Removed duplicate switcher UI

---

## Production Behavior

### In Production (NODE_ENV=production)
- Plan switcher UI is **completely hidden**
- Plans are managed through actual Shopify billing
- Database stores real plan from billing webhooks
- No dev-only testing features visible

### Real Billing Integration (Future)
```javascript
// When merchant upgrades via Shopify billing
export async function billingWebhook({ request }) {
  const billing = await request.json();
  
  await db.shop.update({
    where: { shopifyDomain: billing.shop },
    data: { 
      plan: billing.plan, // "starter" | "pro" | "enterprise"
      billingStatus: "active",
      billingPeriodEnd: new Date(billing.periodEnd)
    }
  });
}
```

---

## Troubleshooting

### Plan Not Updating After Switch
**Check:**
1. Is `process.env.NODE_ENV` set to `"development"`?
2. Does database have shop record? Run: `db.shop.findUnique({ where: { shopifyDomain } })`
3. Are metafields updating? Check Shopify Admin → Metafields
4. Is page loader reading from database or metafields?

### Feature Gates Not Working
**Check:**
1. Is `plan` prop being passed to component?
2. Is `hasFeature()` returning correct boolean?
3. Are tier names lowercase? ("pro" not "Pro")
4. Is feature name spelled correctly?

### Switcher Not Visible
**Check:**
1. Is `NODE_ENV=development`?
2. Is `plan` prop defined in AppLayout?
3. Is sidebar loading correctly?
4. Check browser console for errors

---

## Files Reference

**Plan Switcher UI:**
- `app/components/AppLayout.jsx` - DevPlanSwitcher component

**Plan Update Logic:**
- `app/routes/app.dev-update-plan.jsx` - Updates database + metafields

**Feature Gates:**
- `app/utils/featureGates.js` - hasFeature() utility

**Page Loaders (read plan):**
- `app/routes/app._index.jsx` - Dashboard
- `app/routes/app.settings.jsx` - Settings
- `app/routes/app.analytics.jsx` - Analytics
- `app/routes/app.conversions.jsx` - Conversions
- `app/routes/app.promotions.jsx` - Promotions

**Database Schema:**
- `prisma/schema.prisma` - Shop model with plan field

---

**Status:** ✅ Working correctly as of January 16, 2026
**Next:** No further changes needed - plan switcher is stable
