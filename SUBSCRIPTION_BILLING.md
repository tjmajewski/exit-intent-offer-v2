# Subscription Billing Architecture
**Last Updated:** March 13, 2026

> This doc covers **subscription billing** (plan tiers and feature gating).
> For **usage billing** (per-conversion commission charges), see [USAGE_BILLING.md](./USAGE_BILLING.md).

---

## Plan Tiers

| Plan | Monthly | Annual | Impressions | Key Features |
|------|---------|--------|-------------|--------------|
| Starter | $29 | $24.65/mo | 1,000/month | Manual mode only |
| Pro | $79 | $67.15/mo | 10,000/month | AI mode, evolution system, A/B testing |
| Enterprise | $199 | $169.15/mo | Unlimited | Advanced AI, promotions, variants, custom CSS |

---

## Data Stores

Plan information lives in **two places**, and understanding this is critical:

| Store | What | Updated By | Read By |
|-------|------|------------|---------|
| **Prisma DB** (`Shop.plan`) | Tier string ("starter", "pro", "enterprise") + `subscriptionId` | Billing callback, sync function, dev switcher | All admin page loaders (source of truth for UI) |
| **Shopify Metafield** (`exit_intent.plan`) | Full plan JSON with tier, usage, subscriptionId, trial info | Billing callback, settings save, dashboard init | Track endpoint (storefront impression counting) |

**Rule**: Admin pages use DB as source of truth. The storefront track endpoint uses metafield.

---

## Subscription Lifecycle

### 1. Creating a Subscription

**File:** `app/routes/app.upgrade.jsx` (action)

```
Merchant clicks "Subscribe" on upgrade page
  → action() calls createSubscription(admin, tier, billingCycle, returnUrl, isTest, trialDays)
  → Shopify appSubscriptionCreate mutation
  → Returns confirmationUrl
  → Frontend opens confirmationUrl via window.open(_top)
  → Merchant approves in Shopify admin
  → Shopify redirects to returnUrl: /app/billing-callback?tier=X&cycle=Y
```

**Subscription naming convention:** `Resparq {Tier} ({Cycle})`
Examples: "Resparq Enterprise (Monthly)", "Resparq Pro (Annual)"

**Trial logic:**
- First subscription ever: 14-day free trial
- Subsequent subscriptions: remaining trial days from original start
- `hasUsedTrial` flag in metafield prevents double trials

### 2. Billing Callback

**File:** `app/routes/app.billing-callback.jsx`

This is the critical path where the plan gets activated after approval.

```
Shopify redirects to /app/billing-callback?tier=enterprise&cycle=monthly
  → authenticate.admin(request)
  → getActiveSubscription(admin) — queries Shopify for active subscriptions
  → If subscription ACTIVE:
      → Update metafield (merge into existing plan data, preserving usage)
      → Update DB (upsert with tier + subscriptionId)
  → If subscription NOT YET ACTIVE (race condition):
      → Retry after 2 seconds
      → If still not active but tier param exists:
          → Update DB only (metafield syncs on next page load)
  → Redirect to /app/upgrade
```

**Race condition handling:** Shopify sometimes hasn't propagated the subscription
status when the callback fires. The callback retries once after 2s, and as a
fallback, trusts the `tier` query parameter (which came from our own `returnUrl`)
to update the DB immediately.

### 3. Self-Healing Sync

**File:** `app/utils/billing.server.js` → `syncSubscriptionToPlan()`

Every admin page load calls this function to catch any missed updates:

```
syncSubscriptionToPlan(admin, session, db)
  → getActiveSubscription(admin) — check what Shopify says
  → db.shop.findUnique() — check what DB says
  → If subscription active AND DB tier doesn't match:
      → Correct DB to match subscription
  → If no subscription AND DB has paid tier with no subscriptionId:
      → Downgrade to starter (fixes the old "pro" default bug)
  → Return the correct tier
```

**Integrated into loaders for:** Dashboard, Upgrade, Settings, Promotions

### 4. Subscription Verification

**File:** `app/utils/billing.server.js` → `getActiveSubscription()`

Queries Shopify's `currentAppInstallation.activeSubscriptions` GraphQL endpoint.
Returns the first active subscription with full details (name, status, line items,
pricing interval).

`tierFromSubscriptionName(name)` extracts the tier from the subscription name
(e.g., "Resparq Enterprise (Monthly)" → "enterprise").

---

## Feature Gating

### How Features Are Gated

**File:** `app/utils/featureGates.js`

```javascript
PLAN_FEATURES = {
  starter: { impressionLimit: 1000, features: [...] },
  pro:     { impressionLimit: 10000, features: [...] },
  enterprise: { impressionLimit: Infinity, features: [...] }
}
```

**Admin page gating** (server-side in loaders):

| Page | Gate Logic |
|------|-----------|
| Promotions | `plan.tier !== 'enterprise'` → shows upgrade prompt |
| Variants | `plan.tier !== 'enterprise'` → shows upgrade prompt |
| Performance | Accessible to all, but date filters/export gated to Pro+ |
| Conversions | Accessible to all, but advanced features gated to Pro+ |

**Sidebar gating** (`app/components/AppLayout.jsx`):
- Promotions: shows "ENTERPRISE" badge if not enterprise
- Variants: shows "ENTERPRISE" badge if not enterprise
- Performance: shows "PRO" badge if starter
- Upgrade link: hidden if enterprise

### Impression Limit Enforcement

**File:** `app/routes/apps.exit-intent.track.jsx`

The storefront track endpoint reads the plan from the **metafield** (not DB) and
checks `plan.usage.impressionsThisMonth` against the tier's limit. If over limit,
the impression is rejected and the modal won't show.

Usage resets on a rolling 30-day window based on `plan.usage.resetDate`.

---

## Settings Save & Plan Preservation

**File:** `app/routes/app.settings.jsx` (action)

When a merchant saves settings, the action writes both the settings and plan
metafields. The plan metafield is **merged** (not replaced) to preserve billing
data:

```javascript
// Read existing plan metafield first
const existingPlan = shopData.data.shop?.plan?.value
  ? JSON.parse(shopData.data.shop.plan.value)
  : { tier: "starter", billingCycle: "monthly" };

// Merge — preserves usage, subscriptionId, hasUsedTrial, etc.
planValue: JSON.stringify({
  ...existingPlan,
  tier: formData.get("tier") || existingPlan.tier || "starter"
})
```

This ensures that `usage.impressionsThisMonth`, `usage.resetDate`,
`subscriptionId`, `hasUsedTrial`, and `trialStartedAt` are never lost.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/utils/billing.server.js` | createSubscription, getActiveSubscription, syncSubscriptionToPlan, tier parsing |
| `app/routes/app.billing-callback.jsx` | Handles post-approval redirect, updates DB + metafield |
| `app/routes/app.upgrade.jsx` | Plan selection UI, subscription creation |
| `app/utils/featureGates.js` | PLAN_FEATURES definitions, hasFeature(), checkUsageLimit() |
| `app/components/AppLayout.jsx` | Sidebar feature badges and gating |
| `app/routes/apps.exit-intent.track.jsx` | Impression limit enforcement (reads metafield) |
| `prisma/schema.prisma` | Shop.plan field (default: "starter"), Shop.subscriptionId |

---

## Dev Switcher

**File:** `app/routes/app.dev-update-plan.jsx`

For development/testing, a plan switcher in the admin updates both DB and metafield
directly without going through Shopify billing. This is not visible to merchants
in production.

---

## Troubleshooting

### Features locked after subscribing
1. Check `syncSubscriptionToPlan` logs — it runs on every admin page load and
   will auto-correct mismatches
2. Verify `getActiveSubscription` returns the expected tier
3. Check DB: `SELECT plan, "subscriptionId" FROM "Shop" WHERE "shopifyDomain" = '...'`
4. Check metafield via Shopify admin GraphiQL

### Plan shows wrong tier
The self-healing sync corrects this automatically. If it persists:
1. Check if `tierFromSubscriptionName()` can parse the subscription name
2. Verify the subscription is truly ACTIVE in Shopify admin

### Impressions not counting / "Resets Unknown"
The track endpoint reads from **metafield only**. If settings save previously
destroyed the usage object, the sync won't fix the metafield automatically.
The billing callback and dashboard init both ensure the usage object exists.

### New shops showing Pro features without paying
Fixed: Prisma default changed from `"pro"` to `"starter"`. The
`syncSubscriptionToPlan` function also downgrades shops with paid tier but no
`subscriptionId` (the old default bug).
