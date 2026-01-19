# Social Proof System - Technical Documentation
**Date:** January 16, 2026  
**Audience:** Developers, Technical Stakeholders  
**Status:** ✅ Implemented and Tested

---

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Implementation Phases](#implementation-phases)
4. [Database Schema](#database-schema)
5. [API Reference](#api-reference)
6. [Gene Pool Structure](#gene-pool-structure)
7. [Caching Strategy](#caching-strategy)
8. [Testing](#testing)
9. [Deployment](#deployment)
10. [Future Enhancements](#future-enhancements)

---

## System Overview

### Purpose
Dynamically display customer counts, order volumes, and ratings in exit-intent modal copy to build trust and increase conversions through social proof.

### Key Features
- ✅ Automatic data collection from Shopify (orders, customers)
- ✅ Smart formatting (5000 → "5k+", 4.8 → "4.8★")
- ✅ Placeholder-based gene system (`{{social_proof_count}}`, `{{rating}}`)
- ✅ Intelligent qualification checks (minimum thresholds)
- ✅ 1-hour in-memory caching
- ✅ Merchant configuration UI
- ✅ Separate gene pools for social proof variants

### Design Principles
1. **Never show bad copy** - If shop doesn't qualify, use regular genes instead
2. **Impressive numbers only** - Minimum 100 orders/customers, 4.0+ rating
3. **Rounded for credibility** - "500+" looks better than "487"
4. **Cache-first** - Minimize database hits during high-traffic variant creation
5. **Merchant control** - Let shops enable/disable and configure thresholds

---

## Architecture

### High-Level Flow
```
┌─────────────────────────────────────────┐
│ MERCHANT SETTINGS                       │
│ - Enable/disable social proof           │
│ - Choose type (orders/customers/reviews)│
│ - Set minimum threshold                 │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ DATA COLLECTION (Daily Cron)           │
│ collectStoreMetrics()                   │
│ - Shopify GraphQL (orders/customers)    │
│ - Review APIs (future)                  │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ DATABASE (Prisma Shop Model)           │
│ Stores: orderCount, avgRating, etc.     │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ CACHE LAYER (1-hour TTL)               │
│ In-memory Map, cleared on metrics update│
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ GENE POOLS                              │
│ headlines + headlinesWithSocialProof    │
│ subheads + subheadsWithSocialProof      │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ VARIANT CREATION                        │
│ createRandomVariantWithSocialProof()    │
│ - Check cache for shop data             │
│ - Validate qualification                │
│ - Select appropriate gene pool          │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ PLACEHOLDER REPLACEMENT                 │
│ replaceSocialProofPlaceholders()        │
│ {{social_proof_count}} → "5k+"          │
│ {{rating}} → "4.8"                      │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ FINAL VARIANT                           │
│ "Join 5k+ happy customers"              │
└─────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Data Collection Layer

**File:** `app/utils/social-proof.js`

**Functions Implemented:**
```javascript
// Main collection function
export async function collectStoreMetrics(admin, shopifyDomain)

// Helper functions
async function getCustomerCount(admin)
async function getOrderCount(admin)
async function getReviewMetrics(admin)
```

**Shopify GraphQL Queries:**
```graphql
# Customer Count
query {
  customersCount {
    count
  }
}

# Order Count
query {
  ordersCount {
    count
  }
}
```

**Database Update:**
```javascript
await db.shop.update({
  where: { shopifyDomain },
  data: {
    customerCount,
    orderCount,
    avgRating,
    reviewCount,
    socialProofUpdatedAt: new Date()
  }
});
```

**Error Handling:**
- Catches Shopify API failures gracefully
- Returns null on error, doesn't throw
- Logs errors for debugging

---

### Phase 2: Formatting Layer

**File:** `app/utils/social-proof.js`

**Functions Implemented:**
```javascript
export function formatSocialProof(count, type = 'orders')
export function formatRating(rating)
```

**Formatting Rules:**

| Input | Output | Logic |
|-------|--------|-------|
| 0-99 | `null` | Too small, don't show |
| 100-999 | `"500+"` | Round to nearest 100 |
| 1,000-9,999 | `"5k+"` | Round to nearest 1k |
| 10,000-99,999 | `"50k+"` | Round to nearest 1k |
| 100,000+ | `"100k+"` | Round to nearest 100k |

**Rating Rules:**
- Below 4.0 → `null` (don't show low ratings)
- 4.0+ → Format to 1 decimal: `"4.8"`

**Why Rounding:**
1. **Credibility** - "500+" looks more trustworthy than "487"
2. **Privacy** - Doesn't expose exact business metrics
3. **Aesthetics** - Cleaner, easier to read

---

### Phase 3: Gene Pool Integration

**File:** `app/utils/gene-pools.js`

**Structure Change:**
```javascript
// BEFORE (all genes mixed together)
headlines: [
  'Complete your order with confidence',
  'Join {{social_proof_count}} happy customers' // ❌ Breaks if no proof
]

// AFTER (separated)
headlines: [
  'Complete your order with confidence',
  'Join our community of satisfied customers'
],
headlinesWithSocialProof: [
  '{{social_proof_count}} customers trust us',
  'Rated {{rating}} stars by verified buyers',
  'Join {{social_proof_count}} happy customers'
]
```

**All Baselines Updated:**
- `revenue_with_discount` - "{{social_proof_count}} customers unlocked this discount"
- `revenue_no_discount` - "{{social_proof_count}} customers completed their orders today"
- `conversion_with_discount` - "{{social_proof_count}} customers claimed this {{amount}}% off"
- `conversion_no_discount` - "{{social_proof_count}} customers trust us"
- `pure_reminder` - "{{social_proof_count}} customers completed their orders"

**Placeholders Used:**
- `{{social_proof_count}}` - Replaced with formatted count ("5k+")
- `{{rating}}` - Replaced with formatted rating ("4.8")
- `{{amount}}` - Existing placeholder for discount percentage
- `{{threshold_remaining}}` - Existing placeholder for revenue mode

---

### Phase 4: Variant Creation with Social Proof

**File:** `app/utils/variant-engine.js`

**Key Function:**
```javascript
export async function createRandomVariantWithSocialProof(shopId, baseline, segment = 'all')
```

**Logic Flow:**
```javascript
// 1. Check cache first
let shop = getSocialProofFromCache(shopId);

// 2. If not cached, fetch from DB and cache
if (!shop) {
  shop = await db.shop.findUnique({
    where: { id: shopId },
    select: {
      orderCount, customerCount, avgRating, reviewCount,
      socialProofEnabled, socialProofType, socialProofMinimum
    }
  });
  setSocialProofCache(shopId, shop);
}

// 3. Check if shop qualifies
const socialProofAvailable = shop?.socialProofEnabled && hasSocialProof(shop);

// 4. Create variant with appropriate gene pool
const variant = createRandomVariant(baseline, segment, socialProofAvailable);

// 5. Replace placeholders
if (socialProofAvailable && variant.headline.includes('{{')) {
  variant.headline = replaceSocialProofPlaceholders(variant.headline, shop);
}

return variant;
```

**Updated `createRandomVariant`:**
```javascript
function createRandomVariant(baseline, segment = 'all', useSocialProof = false) {
  const pool = genePools[baseline];
  
  // Decide which gene pools to use
  const headlinePool = useSocialProof && pool.headlinesWithSocialProof
    ? [...pool.headlines, ...pool.headlinesWithSocialProof]
    : pool.headlines;
  
  const subheadPool = useSocialProof && pool.subheadsWithSocialProof
    ? [...pool.subheads, ...pool.subheadsWithSocialProof]
    : pool.subheads;
  
  // Random selection from appropriate pool
  headline: headlinePool[Math.floor(Math.random() * headlinePool.length)],
  subhead: subheadPool[Math.floor(Math.random() * subheadPool.length)],
  // ... rest of variant
}
```

---

### Phase 5: Validation and Replacement

**File:** `app/utils/social-proof.js`

**Qualification Check:**
```javascript
export function hasSocialProof(shop) {
  const hasCount = (shop.orderCount && shop.orderCount >= (shop.socialProofMinimum || 100)) || 
                   (shop.customerCount && shop.customerCount >= (shop.socialProofMinimum || 100));
  const hasRating = shop.avgRating && shop.avgRating >= 4.0;
  
  return hasCount || hasRating;
}
```

**Placeholder Replacement:**
```javascript
export function replaceSocialProofPlaceholders(text, shop) {
  if (!text || !text.includes('{{')) return text;
  
  // Get formatted values
  const count = shop.orderCount || shop.customerCount || 0;
  const proofCount = formatSocialProof(count);
  const rating = formatRating(shop.avgRating);
  
  // If no valid social proof, return null (skip this gene)
  if (!proofCount && text.includes('{{social_proof_count}}')) {
    return null;
  }
  
  if (!rating && text.includes('{{rating}}')) {
    return null;
  }
  
  // Replace placeholders
  let result = text;
  if (proofCount) {
    result = result.replace(/\{\{social_proof_count\}\}/g, proofCount);
  }
  if (rating) {
    result = result.replace(/\{\{rating\}\}/g, rating);
  }
  
  return result;
}
```

**Why Return Null:**
- Signals to variant engine that this gene should be skipped
- Prevents broken placeholders like "Join {{social_proof_count}} customers"
- Variant engine can re-roll to non-social-proof gene

---

### Phase 6: Merchant Settings UI

**File:** `app/routes/app.settings.jsx` (AI Settings Tab component)

**Settings Added:**
```jsx
<div style={{ /* Social Proof Settings container */ }}>
  <h2>Social Proof Settings</h2>
  
  {/* Enable/Disable */}
  <input
    type="checkbox"
    name="socialProofEnabled"
    defaultChecked={settings.socialProofEnabled ?? true}
  />
  
  {/* Type Selector */}
  <select name="socialProofType" defaultValue={settings.socialProofType || "orders"}>
    <option value="orders">Order count</option>
    <option value="customers">Customer count</option>
    <option value="reviews">Review count</option>
  </select>
  
  {/* Minimum Threshold */}
  <input
    type="number"
    name="socialProofMinimum"
    defaultValue={settings.socialProofMinimum || 100}
  />
  
  {/* Current Metrics Display */}
  {(settings.orderCount || settings.customerCount) && (
    <div>✅ Current metrics: {settings.orderCount} orders, ...</div>
  )}
  
  {/* Manual Refresh Button */}
  <button onClick={async () => {
    await fetch('/api/admin/collect-social-proof', { method: 'POST' });
    alert('✅ Metrics updated!');
  }}>
    🔄 Refresh Metrics Now
  </button>
</div>
```

---

## Database Schema

### Prisma Model Updates
```prisma
model Shop {
  id                String   @id @default(uuid())
  shopifyDomain     String   @unique
  
  // ... existing fields ...
  
  // Social Proof Fields
  customerCount         Int?
  orderCount            Int?
  avgRating             Float?
  reviewCount           Int?
  socialProofEnabled    Boolean   @default(true)
  socialProofType       String    @default("orders")
  socialProofMinimum    Int       @default(100)
  socialProofUpdatedAt  DateTime?
}
```

### Migration Required
```bash
npx prisma migrate dev --name add_social_proof_fields
```

---

## API Reference

### POST /api/admin/collect-social-proof

**Purpose:** Manually trigger social proof metrics collection for current shop

**Authentication:** Requires Shopify admin session

**Request:**
```http
POST /api/admin/collect-social-proof
```

**Response:**
```json
{
  "success": true,
  "metrics": {
    "customerCount": 2500,
    "orderCount": 5000,
    "avgRating": 4.8,
    "reviewCount": 1200
  },
  "message": "Social proof metrics updated successfully"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Failed to fetch customer count: GraphQL error"
}
```

---

### GET /api/cron/social-proof?secret=XXX

**Purpose:** Cron job endpoint to collect metrics for all shops

**Authentication:** Requires CRON_SECRET environment variable

**Request:**
```http
GET /api/cron/social-proof?secret=your-secret-key
```

**Response:**
```json
{
  "success": true,
  "processed": 3,
  "results": [
    {
      "shopifyDomain": "store1.myshopify.com",
      "success": true,
      "metrics": { ... }
    },
    {
      "shopifyDomain": "store2.myshopify.com",
      "success": false,
      "error": "API rate limit exceeded"
    }
  ]
}
```

**Cron Setup Example (EasyCron):**
```
URL: https://yourapp.com/api/cron/social-proof?secret=YOUR_SECRET
Frequency: Daily at 3:00 AM
```

---

## Gene Pool Structure

### Example: conversion_no_discount Baseline
```javascript
conversion_no_discount: {
  offerAmounts: [0],
  
  // Regular genes (always available)
  headlines: [
    'Complete your order with confidence',
    'Join our community of satisfied customers',
    'Your items are waiting for you'
  ],
  
  // Social proof genes (conditional - only if shop qualifies)
  headlinesWithSocialProof: [
    '{{social_proof_count}} customers trust us',
    'Rated {{rating}} stars by verified buyers',
    'Join {{social_proof_count}} happy customers'
  ],
  
  subheads: [
    'Secure checkout and risk-free returns',
    'Trusted by customers like you',
    'Fast processing and reliable shipping'
  ],
  
  subheadsWithSocialProof: [
    '{{social_proof_count}} orders shipped and counting',
    'Join {{social_proof_count}} satisfied shoppers',
    'Rated {{rating}} stars by real customers'
  ],
  
  ctas: [
    'Complete My Order',
    'Checkout Securely',
    'Finish Purchase'
  ],
  
  redirects: ['cart', 'checkout'],
  urgency: [false]
}
```

### Gene Selection Logic
```javascript
// If shop has social proof
const headlinePool = [
  'Complete your order with confidence',       // 3 regular
  'Join our community of satisfied customers',
  'Your items are waiting for you',
  '5k+ customers trust us',                    // 3 social proof
  'Rated 4.8 stars by verified buyers',
  'Join 5k+ happy customers'
];  // Total: 6 options

// Random selection gives 50% chance of social proof gene
headline = headlinePool[Math.floor(Math.random() * 6)];
```

---

## Caching Strategy

### Implementation

**File:** `app/utils/social-proof-cache.js`
```javascript
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

export function getSocialProofFromCache(shopId) {
  const cached = cache.get(shopId);
  if (!cached) return null;
  
  // Check if expired
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.delete(shopId);
    return null;
  }
  
  return cached.data;
}

export function setSocialProofCache(shopId, data) {
  cache.set(shopId, {
    data,
    timestamp: Date.now()
  });
}
```

### Cache Invalidation

**Automatic:**
- 1-hour TTL expiration
- Server restart (in-memory cache)

**Manual:**
- `clearAllSocialProofCache()` called after metrics collection
- Ensures fresh data on next variant creation

### Why In-Memory?

**Pros:**
- Extremely fast (no DB query)
- Simple implementation
- Auto-clears on deployment

**Cons:**
- Lost on server restart (acceptable - rebuilds quickly)
- Not shared across multiple server instances (acceptable for this use case)

**Alternative (Future):** Redis cache for multi-instance deployments

---

## Testing

### Unit Tests

**File:** `test-social-proof.js`
```javascript
import { testSocialProofFormatting } from './app/utils/social-proof.js';
import { createRandomVariantWithSocialProof } from './app/utils/variant-engine.js';

// Test 1: Formatting functions
testSocialProofFormatting();

// Test 2: Variant creation
const variant = await createRandomVariantWithSocialProof(
  'test-shop-id',
  'conversion_no_discount',
  'all'
);

console.log(variant.headline); // Should show "5k+" if shop qualifies
```

**Expected Output:**
```
✅ 50 orders → null (Too small)
✅ 500 orders → 500+ (Hundreds)
✅ 2500 orders → 2k+ (Thousands)
✅ 15000 orders → 15k+ (Tens of thousands)
✅ 150000 orders → 100k+ (Hundreds of thousands)

✅ 3.5 stars → null (Too low)
✅ 4.0 stars → 4.0 (Minimum)
✅ 4.8 stars → 4.8 (Good)
✅ 4.95 stars → 5.0 (Excellent)
```

### Integration Testing

**Test Scenarios:**

1. **New shop (0 orders):**
   - Should only use regular genes
   - No placeholders in final variant

2. **Qualified shop (5000+ orders):**
   - Should mix regular and social proof genes
   - Placeholders replaced correctly

3. **Edge case (99 orders):**
   - Just below threshold
   - Should use regular genes

4. **Cache hit:**
   - Second variant creation should be instant
   - No DB query

5. **Cache miss after 1 hour:**
   - Should fetch from DB again
   - Update cache

### Manual Testing Checklist

- [ ] Install app on test store
- [ ] Set test data (5000 orders, 4.8 rating)
- [ ] Create 10 variants
- [ ] Verify mix of social proof and regular genes
- [ ] Check placeholders replaced correctly
- [ ] Disable social proof in settings
- [ ] Verify only regular genes used
- [ ] Click "Refresh Metrics" button
- [ ] Verify metrics update

---

## Deployment

### Environment Variables
```bash
# .env
CRON_SECRET=your-random-secret-key-here-change-in-production
```

**Generate Secure Secret:**
```bash
echo "CRON_SECRET=$(openssl rand -hex 32)" >> .env
```

### Database Migration
```bash
# Run migration
npx prisma migrate deploy

# Verify schema
npx prisma studio
```

### Cron Job Setup

**Option 1: EasyCron**
1. Sign up at easycron.com
2. Create new cron job
3. URL: `https://yourapp.com/api/cron/social-proof?secret=YOUR_SECRET`
4. Schedule: Daily at 3:00 AM
5. Timezone: UTC

**Option 2: GitHub Actions**
```yaml
name: Collect Social Proof Metrics
on:
  schedule:
    - cron: '0 3 * * *'  # Daily at 3 AM UTC
jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger metrics collection
        run: |
          curl "https://yourapp.com/api/cron/social-proof?secret=${{ secrets.CRON_SECRET }}"
```

**Option 3: Render Cron Jobs**
```yaml
# render.yaml
services:
  - type: cron
    name: social-proof-collector
    schedule: "0 3 * * *"
    command: curl "https://yourapp.com/api/cron/social-proof?secret=$CRON_SECRET"
```

### Monitoring

**Check Collection Success:**
```sql
-- View last update times
SELECT shopifyDomain, socialProofUpdatedAt, orderCount, avgRating
FROM Shop
ORDER BY socialProofUpdatedAt DESC;
```

**Alert on Stale Data:**
```sql
-- Shops not updated in 48 hours
SELECT shopifyDomain, socialProofUpdatedAt
FROM Shop
WHERE socialProofEnabled = true
  AND socialProofUpdatedAt < datetime('now', '-2 days');
```

---

## Future Enhancements

### Review App Integrations

**Judge.me API:**
```javascript
async function getJudgeMeReviews(shopDomain) {
  const response = await fetch(
    `https://judge.me/api/v1/reviews?shop_domain=${shopDomain}`,
    { headers: { 'Authorization': `Bearer ${JUDGEME_API_KEY}` } }
  );
  const data = await response.json();
  
  return {
    count: data.total,
    avgRating: data.average_rating
  };
}
```

**Yotpo API:**
```javascript
async function getYotpoReviews(shopDomain, appKey) {
  const response = await fetch(
    `https://api.yotpo.com/v1/apps/${appKey}/reviews`,
    { headers: { 'Authorization': `Bearer ${YOTPO_API_KEY}` } }
  );
  const data = await response.json();
  
  return {
    count: data.response.pagination.total,
    avgRating: data.response.bottomline.average_score
  };
}
```

### Real-Time Updates via Webhooks

**Shopify Webhook:**
```javascript
// app/routes/webhooks.orders.create.jsx
export async function action({ request }) {
  const order = await request.json();
  
  // Increment order count in real-time
  await db.shop.update({
    where: { shopifyDomain: order.shop },
    data: {
      orderCount: { increment: 1 },
      socialProofUpdatedAt: new Date()
    }
  });
  
  // Clear cache
  clearSocialProofCache(shopId);
  
  return json({ success: true });
}
```

### A/B Testing Social Proof Effectiveness

**Track Variant Performance by Type:**
```prisma
model Variant {
  // ... existing fields ...
  
  hasSocialProof Boolean @default(false)
  socialProofType String? // "count" | "rating" | "both"
}
```

**Analytics Query:**
```sql
-- Compare social proof vs regular variants
SELECT
  hasSocialProof,
  AVG(profitPerImpression) as avg_ppi,
  AVG(conversions / CAST(impressions AS FLOAT)) as cvr
FROM Variant
WHERE impressions > 100
GROUP BY hasSocialProof;
```

### Dynamic Thresholds by Industry
```javascript
function getIndustryThreshold(shop) {
  const industryThresholds = {
    'fashion': 500,
    'electronics': 200,
    'food': 1000,
    'services': 50
  };
  
  return industryThresholds[shop.industry] || 100;
}
```

### Competitor Comparison
```javascript
headlinesWithSocialProof: [
  '{{social_proof_count}} customers chose us over {{competitor}}',
  'Join {{social_proof_count}} shoppers who switched from {{competitor}}'
]
```

---

## Troubleshooting

### Issue: Placeholders Not Being Replaced

**Symptoms:**
- Variants show "{{social_proof_count}}" to users
- Headlines look broken

**Diagnosis:**
```javascript
// Check if replacement function is being called
console.log('Before replacement:', variant.headline);
const replaced = replaceSocialProofPlaceholders(variant.headline, shop);
console.log('After replacement:', replaced);
```

**Common Causes:**
1. Shop data not in cache or DB
2. `socialProofEnabled` is false
3. Counts below threshold
4. Rating below 4.0

**Fix:**
- Verify shop has data: `SELECT * FROM Shop WHERE id = 'xxx'`
- Check cache: `console.log(getSocialProofFromCache(shopId))`
- Manually set test data to verify logic

---

### Issue: Cache Not Working

**Symptoms:**
- DB query on every variant creation
- Slow performance

**Diagnosis:**
```javascript
const cached = getSocialProofFromCache(shopId);
console.log('Cache hit:', cached !== null);
```

**Common Causes:**
1. Server restart (cache is in-memory)
2. Cache expired (1 hour TTL)
3. Different shopId being used

**Fix:**
- Verify cache is being set: `setSocialProofCache(shopId, data)`
- Check cache TTL hasn't expired
- Ensure consistent shopId format (UUID)

---

### Issue: No Social Proof Genes Selected

**Symptoms:**
- All variants use regular genes
- No social proof showing despite shop qualifying

**Diagnosis:**
```javascript
console.log('Shop qualifies:', hasSocialProof(shop));
console.log('Social proof available:', socialProofAvailable);
console.log('Headline pool:', headlinePool);
```

**Common Causes:**
1. Random selection happened to pick regular genes (50/50 chance)
2. Shop doesn't actually qualify
3. `socialProofEnabled` is false

**Fix:**
- Create multiple variants to verify distribution
- Check qualification logic: `hasSocialProof(shop)`
- Verify settings in merchant dashboard

---

### Issue: Shopify GraphQL Errors

**Symptoms:**
- `collectStoreMetrics()` returns null
- Console shows GraphQL errors

**Diagnosis:**
```javascript
try {
  const response = await admin.graphql(query);
  console.log('GraphQL response:', await response.json());
} catch (error) {
  console.error('GraphQL error:', error);
}
```

**Common Causes:**
1. API rate limit exceeded
2. Invalid GraphQL query
3. Missing Shopify permissions

**Fix:**
- Check Shopify API rate limits
- Verify query syntax
- Ensure app has `read_orders` and `read_customers` scopes

---

## Performance Considerations

### Database Load

**Before Social Proof:**
- Variant creation: 0 DB queries (all in memory)

**After Social Proof (Without Cache):**
- Variant creation: 1 DB query per variant
- High-traffic site: 1000+ queries/hour

**After Social Proof (With Cache):**
- Variant creation: 1 DB query per shop per hour
- High-traffic site: ~50 queries/hour

**Impact:** Cache reduces DB load by 95%+

### Memory Usage

**Cache Size:**
- Average shop data: ~200 bytes
- 1000 cached shops: ~200 KB
- Negligible impact on server memory

**Cache Eviction:**
- Automatic after 1 hour
- Manual via `clearAllSocialProofCache()`

### Network Calls

**Shopify API:**
- 2 GraphQL queries per shop per collection
- Rate limit: 40 requests/second (API 2024-10 version)
- Daily collection for 1000 shops: ~2000 requests = negligible

---

## Code Quality

### Type Safety

**Add TypeScript Definitions (Future):**
```typescript
interface SocialProofData {
  orderCount: number | null;
  customerCount: number | null;
  avgRating: number | null;
  reviewCount: number | null;
  socialProofEnabled: boolean;
  socialProofType: 'orders' | 'customers' | 'reviews';
  socialProofMinimum: number;
}

function hasSocialProof(shop: SocialProofData): boolean {
  // ...
}
```

### Error Handling

**All Functions Have Try-Catch:**
```javascript
try {
  const metrics = await collectStoreMetrics(admin, shopifyDomain);
} catch (error) {
  console.error('Failed to collect metrics:', error);
  return null; // Graceful degradation
}
```

### Logging

**Structured Logging:**
```javascript
console.log(`📊 Collecting social proof metrics for ${shopifyDomain}`);
console.log(`  ✅ Customers: ${customerCount}`);
console.log(`  ✅ Orders: ${orderCount}`);
console.log(`  ✅ Social proof updated for ${shopifyDomain}`);
```

---

## Security

### API Endpoint Protection

**Cron Endpoint:**
```javascript
const CRON_SECRET = process.env.CRON_SECRET || 'change-me-in-production';

if (secret !== CRON_SECRET) {
  return json({ error: 'Unauthorized' }, { status: 401 });
}
```

**Admin Endpoint:**
```javascript
const { admin, session } = await authenticate.admin(request);
// Automatically verified by Shopify auth
```

### Data Privacy

**No PII Collected:**
- Only aggregate counts (orders, customers)
- No individual customer data
- No order details

**Shopify Scopes Required:**
- `read_orders` - For order count
- `read_customers` - For customer count

---

## Maintenance

### Weekly Tasks
- [ ] Check cron job execution logs
- [ ] Verify cache hit rates
- [ ] Monitor social proof variant performance

### Monthly Tasks
- [ ] Review qualification thresholds
- [ ] Analyze A/B test results (social proof vs regular)
- [ ] Update gene pool copy based on performance

### Quarterly Tasks
- [ ] Evaluate review app integrations
- [ ] Consider dynamic threshold adjustments
- [ ] Review and update documentation

---

## References

### Related Files
- `app/utils/social-proof.js` - Main utility functions
- `app/utils/social-proof-cache.js` - Caching layer
- `app/utils/gene-pools.js` - Gene pool definitions
- `app/utils/variant-engine.js` - Variant creation logic
- `app/routes/api.admin.collect-social-proof.jsx` - Manual trigger endpoint
- `app/routes/api.cron.social-proof.jsx` - Cron job endpoint
- `prisma/schema.prisma` - Database schema

### External Documentation
- [Shopify Admin GraphQL API](https://shopify.dev/docs/api/admin-graphql)
- [Judge.me API Docs](https://judge.me/api)
- [Yotpo API Docs](https://apidocs.yotpo.com/)
- [Bayesian Statistics](https://en.wikipedia.org/wiki/Bayesian_statistics)

---

**End of Technical Documentation**

*For product-level documentation, see AI_SYSTEM_OVERVIEW.md*
*For setup instructions, see SOCIAL_PROOF_README.md*
