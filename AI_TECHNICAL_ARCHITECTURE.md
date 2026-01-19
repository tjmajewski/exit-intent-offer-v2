# ResparQ AI - Technical Architecture
**Last Updated:** January 16, 2026  
**Audience:** Developers

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Core Files & Functions](#core-files--functions)
3. [Database Schema](#database-schema)
4. [API Endpoints](#api-endpoints)
5. [Data Flow](#data-flow)
6. [Evolution Algorithm Details](#evolution-algorithm-details)
7. [Thompson Sampling Implementation](#thompson-sampling-implementation)
8. [Social Proof Integration](#social-proof-integration)

---

## System Architecture

### High-Level Components
```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (Shopify Theme Extension)      │
│  - Exit intent detection                                     │
│  - Modal rendering                                           │
│  - Event tracking (impression/click/conversion)              │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP
┌─────────────────────────────────────────────────────────────┐
│                      REMIX APP (Node.js)                     │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ API Routes                                            │  │
│  │  - /api/ai-decision (decide which variant to show)   │  │
│  │  - /api/track-variant (record performance)           │  │
│  │  - /api/admin/collect-social-proof (refresh metrics) │  │
│  │  - /api/cron/social-proof (daily collection)         │  │
│  │  - /api/cron/evolution (trigger evolution cycles)    │  │
│  └───────────────────────────────────────────────────────┘  │
│                            ↓                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Core Utilities                                        │  │
│  │  - variant-engine.js (evolution logic)               │  │
│  │  - gene-pools.js (variant templates)                 │  │
│  │  - baseline-selector.js (mode selection)             │  │
│  │  - ai-decision.js (offer logic)                      │  │
│  │  - social-proof.js (data collection & formatting)    │  │
│  │  - social-proof-cache.js (1-hour cache)              │  │
│  │  - meta-learning.js (network insights)               │  │
│  └───────────────────────────────────────────────────────┘  │
│                            ↓                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Prisma ORM                                            │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      SQLite Database                         │
│  - Shops, Variants, VariantImpressions                      │
│  - DiscountOffers, AIDecisions                              │
│  - MetaLearningGenes, MetaLearningInsights                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      Shopify Admin API                       │
│  - Create discount codes                                     │
│  - Fetch order/customer counts                              │
│  - GraphQL queries                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Files & Functions

### 1. `variant-engine.js`

**Purpose:** Core evolution system - creates, selects, evolves variants

**Key Functions:**
```javascript
// Generate unique ID
generateVariantId() → "VAR_1234567890_ABCDE"

// Create random variant from gene pool
createRandomVariant(baseline, segment, useSocialProof)
→ { variantId, genes, performance, status }

// Create variant with social proof support
createRandomVariantWithSocialProof(shopId, baseline, segment)
→ Variant with placeholders replaced

// Seed initial population (Gen 0)
seedInitialPopulation(shopId, baseline, segment)
→ Array of 10 variants (5 proven + 5 random for new stores)

// Get live variants
getLiveVariants(shopId, baseline, segment)
→ Array of variants with status 'alive' or 'champion'

// Thompson Sampling selection
selectVariantForImpression(shopId, baseline, segment)
→ Variant (Champion gets 70%, others use Thompson Sampling)

// Record events
recordImpression(variantId, shopId, context)
recordClick(impressionId)
recordConversion(impressionId, revenue, discountAmount)

// Evolution cycle (every 100 impressions)
evolutionCycle(shopId, baseline, segment)
→ { killed, bred, champion, population }

// Bayesian comparison
bayesianCompare(variantA, variantB)
→ { probability, lift, avgCVR_A, avgCVR_B }

// Detect champion
detectChampion(liveVariants)
→ Variant or null

// Breed new variant
breedNewVariant(parents, baseline, segment, shopId, settings)
→ New variant with mixed genes
```

**Evolution Settings:**
```javascript
{
  mutationRate: 15,      // 0-100, how often genes mutate
  crossoverRate: 70,     // 0-100, how much genes mix
  selectionPressure: 5,  // 1-10, how quickly to kill poor performers
  populationSize: 10     // 5-20, how many variants alive
}
```

---

### 2. `gene-pools.js`

**Purpose:** Define all possible genes for each baseline

**Structure:**
```javascript
export const genePools = {
  revenue_with_discount: {
    offerAmounts: [10, 15, 20, 25],
    headlines: [...],
    headlinesWithSocialProof: [...],
    subheads: [...],
    subheadsWithSocialProof: [...],
    ctas: [...],
    redirects: ['cart', 'checkout'],
    urgency: [true, false]
  },
  // ... 4 other baselines
};

// Helper functions
getRandomGene(baseline, geneType)
isValidGene(baseline, geneType, geneValue)
getAllBaselines()
getCombinationCount(baseline)
```

**Total Gene Space:**
- 5 baselines × ~800 combinations each = 4,000+ possible variants

---

### 3. `baseline-selector.js`

**Purpose:** Determine which baseline to use based on signals and goal

**Logic:**
```javascript
export function selectBaseline(signals, aiGoal) {
  // Force pure_reminder if aggression = 0
  if (shop.aggression === 0) {
    return 'pure_reminder';
  }
  
  // Calculate propensity score (0-100)
  const propensity = calculatePropensityScore(signals);
  
  // Determine if customer needs incentive
  const needsIncentive = propensity < 70;
  
  // Select baseline
  if (aiGoal === 'revenue') {
    return needsIncentive 
      ? 'revenue_with_discount' 
      : 'revenue_no_discount';
  } else {
    return needsIncentive 
      ? 'conversion_with_discount' 
      : 'conversion_no_discount';
  }
}

function calculatePropensityScore(signals) {
  let score = 50; // Baseline
  
  if (signals.visitFrequency === 1) score += 15;
  if (signals.deviceType === 'mobile') score += 10;
  if (signals.trafficSource === 'paid') score += 20;
  if (signals.accountStatus === 'guest') score += 10;
  if (signals.timeOnSite < 30) score += 15;
  if (signals.cartValue > 75) score += 10;
  if (signals.pageViews >= 3) score += 10;
  if (signals.hasAbandonedBefore) score += 10;
  
  return Math.min(score, 100);
}
```

---

### 4. `social-proof.js`

**Purpose:** Collect, format, and replace social proof data

**Key Functions:**
```javascript
// Collect metrics from Shopify
collectStoreMetrics(admin, shopifyDomain)
→ { customerCount, orderCount, avgRating, reviewCount }

// Format for display
formatSocialProof(count, type)
→ "5k+" or null

formatRating(rating)
→ "4.8" or null

// Replace placeholders
replaceSocialProofPlaceholders(text, shop)
→ "Join {{social_proof_count}} customers" → "Join 5k+ customers"

// Check qualification
hasSocialProof(shop)
→ boolean (meets threshold and enabled)

// Test formatting
testSocialProofFormatting()
→ Console output showing format tests
```

**GraphQL Queries:**
```javascript
// Customer count
query {
  customersCount {
    count
  }
}

// Order count
query {
  ordersCount {
    count
  }
}
```

---

### 5. `social-proof-cache.js`

**Purpose:** 1-hour in-memory cache for social proof data

**Implementation:**
```javascript
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

getSocialProofFromCache(shopId)
→ cached data or null

setSocialProofCache(shopId, data)
→ void (stores with timestamp)

clearSocialProofCache(shopId)
clearAllSocialProofCache()
```

---

### 6. `ai-decision.js`

**Purpose:** Determine offer type and amount based on signals

**Key Functions:**
```javascript
// Main decision function
determineOffer(signals, aggression, aiGoal, cartValue, shopId, plan)
→ { type, amount, threshold, confidence, reasoning }

// Enterprise AI with propensity scoring
enterpriseAI(signals, aggression, aiGoal)
→ Enhanced decision with timing and confidence

// Budget check
checkBudget(db, shopId, budgetPeriod)
→ { hasRoom, remaining, totalSpent }

// Cart composition analysis
analyzeCartComposition(signals)
→ { isHighTicket, isMultiItem, avgItemPrice, itemCount }
```

---

## Database Schema

### Core Tables

**Shop**
```prisma
model Shop {
  id                String   @id @default(uuid())
  shopifyDomain     String   @unique
  mode              String   @default("manual")
  plan              String   @default("pro")
  aiGoal            String   @default("revenue")
  aggression        Int      @default(5)
  budgetEnabled     Boolean  @default(false)
  budgetAmount      Float    @default(500)
  budgetPeriod      String   @default("month")
  
  // Evolution settings (Enterprise)
  mutationRate      Int      @default(15)
  crossoverRate     Int      @default(70)
  selectionPressure Int      @default(5)
  populationSize    Int      @default(10)
  
  // Social Proof
  customerCount         Int?
  orderCount            Int?
  avgRating             Float?
  reviewCount           Int?
  socialProofEnabled    Boolean   @default(true)
  socialProofType       String    @default("orders")
  socialProofMinimum    Int       @default(100)
  socialProofUpdatedAt  DateTime?
  
  lastEvolutionCycle DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  variants          Variant[]
  discountOffers    DiscountOffer[]
  aiDecisions       AIDecision[]
}
```

**Variant**
```prisma
model Variant {
  id          String   @id @default(uuid())
  shopId      String
  shop        Shop     @relation(fields: [shopId], references: [id])
  
  variantId   String   @unique
  baseline    String
  segment     String   @default("all")
  status      String   @default("alive")
  generation  Int      @default(0)
  parents     String?
  
  // Genes
  offerAmount Int
  headline    String
  subhead     String
  cta         String
  redirect    String
  urgency     Boolean
  
  // Performance
  impressions           Int     @default(0)
  clicks                Int     @default(0)
  conversions           Int     @default(0)
  revenue               Float   @default(0)
  profitPerImpression   Float   @default(0)
  
  birthDate     DateTime @default(now())
  deathDate     DateTime?
  championDate  DateTime?
  
  impressionRecords VariantImpression[]
}
```

**VariantImpression**
```prisma
model VariantImpression {
  id             String   @id @default(uuid())
  variantId      String
  variant        Variant  @relation(fields: [variantId], references: [id])
  shopId         String
  
  segment        String?
  deviceType     String?
  trafficSource  String?
  cartValue      Float?
  
  clicked        Boolean  @default(false)
  converted      Boolean  @default(false)
  revenue        Float?
  discountAmount Float?
  profit         Float?
  
  timestamp      DateTime @default(now())
}
```

**DiscountOffer**
```prisma
model DiscountOffer {
  id           String   @id @default(uuid())
  shopId       String
  shop         Shop     @relation(fields: [shopId], references: [id])
  
  discountCode String
  offerType    String
  amount       Float
  cartValue    Float?
  
  redeemed     Boolean  @default(false)
  redeemedAt   DateTime?
  expiresAt    DateTime
  createdAt    DateTime @default(now())
}
```

**MetaLearningGene**
```prisma
model MetaLearningGene {
  id          String   @id @default(uuid())
  
  baseline    String
  geneType    String
  geneValue   String
  
  sampleSize           Int
  avgProfitPerImpression Float
  confidenceLevel      Float
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@unique([baseline, geneType, geneValue])
}
```

---

## API Endpoints

### 1. POST `/api/ai-decision`

**Purpose:** Decide which variant to show based on customer signals

**Request:**
```json
{
  "shop": "store.myshopify.com",
  "signals": {
    "visitFrequency": 1,
    "cartValue": 75.50,
    "deviceType": "mobile",
    "trafficSource": "paid",
    "accountStatus": "guest",
    "timeOnSite": 45,
    "pageViews": 3,
    "hasAbandonedBefore": false
  }
}
```

**Process:**
1. Get shop settings from Shopify metafield
2. Check if AI mode enabled
3. Check budget if enabled
4. Select baseline (revenue/conversion × discount/no-discount)
5. Get/seed variants for baseline
6. Use Thompson Sampling to select variant
7. Apply social proof if shop qualifies
8. Create discount code if needed
9. Record impression
10. Return decision

**Response:**
```json
{
  "shouldShow": true,
  "decision": {
    "type": "percentage",
    "amount": 15,
    "code": "EXIT15_ABC123",
    "confidence": 0.8,
    "expiresAt": "2026-01-17T12:00:00Z",
    "baseline": "conversion_with_discount",
    "variant": {
      "headline": "Wait! Get 15% off before you go",
      "subhead": "Join 5k+ happy customers",
      "cta": "Claim My Discount",
      "redirect": "checkout",
      "urgency": true
    },
    "variantId": "abc-123-def-456",
    "variantPublicId": "VAR_1234567890_ABCDE",
    "impressionId": "imp-789"
  }
}
```

---

### 2. POST `/api/track-variant`

**Purpose:** Track click or conversion for a variant

**Request:**
```json
{
  "shop": "store.myshopify.com",
  "impressionId": "imp-789",
  "event": "click" | "conversion",
  "revenue": 125.00  // Only for conversion
}
```

**Process:**
1. Find shop
2. Update impression record
3. Update variant performance metrics
4. Recalculate profitPerImpression

**Response:**
```json
{
  "success": true
}
```

---

### 3. POST `/api/admin/collect-social-proof`

**Purpose:** Manually trigger social proof metrics collection

**Authentication:** Requires Shopify admin session

**Process:**
1. Authenticate admin
2. Call `collectStoreMetrics(admin, session.shop)`
3. Clear social proof cache
4. Return metrics

**Response:**
```json
{
  "success": true,
  "metrics": {
    "customerCount": 2500,
    "orderCount": 5000,
    "avgRating": 4.8,
    "reviewCount": 1200
  }
}
```

---

### 4. GET `/api/cron/social-proof?secret=XXX`

**Purpose:** Daily cron job to collect metrics for all shops

**Authentication:** Requires CRON_SECRET env variable

**Process:**
1. Verify secret
2. Get all shops with `socialProofEnabled: true`
3. For each shop:
   - Authenticate with Shopify
   - Call `collectStoreMetrics()`
   - Store results
4. Return summary

**Response:**
```json
{
  "success": true,
  "processed": 150,
  "results": [
    {
      "shopifyDomain": "store1.myshopify.com",
      "success": true,
      "metrics": { ... }
    },
    ...
  ]
}
```

---

### 5. POST `/api/cron/evolution`

**Purpose:** Trigger evolution cycles for all active shops

**Process:**
1. Get all shops with AI mode enabled
2. For each shop:
   - Count impressions since last cycle
   - If >= 100 → run `evolutionCycle()`
   - Update `lastEvolutionCycle` timestamp
3. Return summary

**Response:**
```json
{
  "success": true,
  "cyclesRun": 45,
  "results": [
    {
      "shopId": "abc-123",
      "killed": 2,
      "bred": 2,
      "champion": "VAR_1234567890_ABCDE"
    },
    ...
  ]
}
```

---

## Data Flow

### Impression Flow
```
1. User exits page
   ↓
2. Frontend calls POST /api/ai-decision
   {
     shop: "store.myshopify.com",
     signals: { ... }
   }
   ↓
3. Backend:
   - selectBaseline(signals, aiGoal)
   - seedInitialPopulation() if needed
   - selectVariantForImpression() via Thompson Sampling
   - createRandomVariantWithSocialProof() applies social proof
   - replaceSocialProofPlaceholders()
   - createDiscountCode() if offer needed
   - recordImpression()
   ↓
4. Response:
   {
     decision: {
       variant: { headline, subhead, cta, ... },
       code: "EXIT15_ABC123",
       impressionId: "imp-789"
     }
   }
   ↓
5. Frontend renders modal with variant genes
   ↓
6. User clicks CTA
   ↓
7. Frontend calls POST /api/track-variant
   {
     impressionId: "imp-789",
     event: "click"
   }
   ↓
8. Backend: recordClick(impressionId)
   ↓
9. User completes purchase
   ↓
10. Frontend calls POST /api/track-variant
    {
      impressionId: "imp-789",
      event: "conversion",
      revenue: 125.00
    }
    ↓
11. Backend: recordConversion(impressionId, revenue, discount)
```

### Evolution Flow
```
1. Cron triggers POST /api/cron/evolution
   ↓
2. For each shop:
   - Count impressions since last cycle
   - If >= 100:
     ↓
3. evolutionCycle(shopId, baseline, segment)
   ↓
4. Get all live variants
   ↓
5. Calculate fitness (profitPerImpression)
   ↓
6. Bayesian comparison: find dying variants
   - Compare each to top performer
   - If 95% confident it's worse → mark for death
   ↓
7. Kill variants: status = 'dead'
   ↓
8. Breed replacements:
   - Select 2 parents weighted by fitness
   - Crossover genes (70% rate)
   - Mutate genes (15% rate)
   - Validate brand safety (Enterprise)
   - Create new variant
   ↓
9. Detect champion:
   - Find candidates (500+ imp, 7+ days)
   - Test top performer vs all others
   - If beats all with 95% confidence → crown
   ↓
10. Update shop.lastEvolutionCycle
```

---

## Evolution Algorithm Details

### Thompson Sampling Math

**Beta Distribution:**
```
For each variant:
  α (alpha) = conversions + 1
  β (beta) = (impressions - conversions) + 1
  
  Distribution: Beta(α, β)
```

**Sampling Process:**
```javascript
function selectVariant(variants) {
  const samples = variants.map(v => {
    const alpha = v.conversions + 1;
    const beta = (v.impressions - v.conversions) + 1;
    
    // Sample from Beta(alpha, beta) using jStat
    return {
      variant: v,
      sample: jStat.beta.sample(alpha, beta)
    };
  });
  
  // Sort by sample value, highest wins
  samples.sort((a, b) => b.sample - a.sample);
  
  return samples[0].variant;
}
```

**Why This Works:**
- Variants with high conversion rates sample high more often
- Variants with low data (few impressions) have wide distributions → explore
- Variants with lots of data have narrow distributions → exploit if good
- Automatically balances exploration vs exploitation

---

### Bayesian A/B Testing

**Comparing Two Variants:**
```javascript
function bayesianCompare(variantA, variantB) {
  const samplesA = [];
  const samplesB = [];
  const numSamples = 10000;
  
  // Sample from both distributions
  for (let i = 0; i < numSamples; i++) {
    const alphaA = variantA.conversions + 1;
    const betaA = (variantA.impressions - variantA.conversions) + 1;
    
    const alphaB = variantB.conversions + 1;
    const betaB = (variantB.impressions - variantB.conversions) + 1;
    
    samplesA.push(jStat.beta.sample(alphaA, betaA));
    samplesB.push(jStat.beta.sample(alphaB, betaB));
  }
  
  // Count how often A beats B
  let aWins = 0;
  for (let i = 0; i < numSamples; i++) {
    if (samplesA[i] > samplesB[i]) aWins++;
  }
  
  const probability = aWins / numSamples;
  
  return {
    probability,  // P(A > B)
    lift: (avgA - avgB) / avgB
  };
}
```

**Interpretation:**
- `probability = 0.95` → 95% confident A is better than B
- `lift = 0.15` → A is 15% better than B

---

### Genetic Operations

**Crossover (Gene Mixing):**
```javascript
// Parent 1: { headline: "A", cta: "Buy Now" }
// Parent 2: { headline: "B", cta: "Shop Now" }

// With 70% crossover rate:
const child = {
  headline: random() < 0.7 
    ? (random() < 0.5 ? parent1.headline : parent2.headline)
    : parent1.headline,
    
  cta: random() < 0.7 
    ? (random() < 0.5 ? parent1.cta : parent2.cta)
    : parent1.cta
};

// Result (example): { headline: "B", cta: "Buy Now" }
```

**Mutation (Random Changes):**
```javascript
// With 15% mutation rate:
Object.keys(childGenes).forEach(gene => {
  if (Math.random() < 0.15) {
    // Randomly select new value from gene pool
    childGenes[gene] = randomOptionFromPool(gene);
  }
});

// Example: headline mutates from "A" → "C" (random from pool)
```

---

## Social Proof Integration

### Cache Flow
```
Request 1 (Shop ABC, Variant Creation):
  ├─ getSocialProofFromCache("abc")
  ├─ Cache miss → null
  ├─ db.shop.findUnique({ id: "abc" })
  ├─ setSocialProofCache("abc", { orderCount: 5000, ... })
  └─ Create variant with social proof

Request 2 (30 min later, Shop ABC):
  ├─ getSocialProofFromCache("abc")
  ├─ Cache hit → { orderCount: 5000, ... }
  └─ Create variant with social proof (no DB query)

Request 3 (70 min later, Shop ABC):
  ├─ getSocialProofFromCache("abc")
  ├─ Cache expired (> 1 hour)
  ├─ db.shop.findUnique({ id: "abc" })
  ├─ setSocialProofCache("abc", { orderCount: 5100, ... })
  └─ Create variant with social proof
```

### Placeholder Replacement Flow
```
1. Variant gene selected:
   "Join {{social_proof_count}} happy customers"

2. replaceSocialProofPlaceholders(text, shop)
   ├─ shop.orderCount = 5000
   ├─ formatSocialProof(5000) → "5k+"
   └─ text.replace("{{social_proof_count}}", "5k+")

3. Final copy:
   "Join 5k+ happy customers"
```

**Edge Cases:**
```javascript
// Case 1: Shop doesn't qualify (50 orders)
formatSocialProof(50) → null
replaceSocialProofPlaceholders() → null
// Variant gene is excluded from pool entirely

// Case 2: Shop has 500 orders but disabled social proof
shop.socialProofEnabled = false
hasSocialProof(shop) → false
// Social proof genes not added to pool

// Case 3: Shop has orders but no rating
text = "Rated {{rating}} stars"
shop.avgRating = null
replaceSocialProofPlaceholders() → null
// Gene excluded from pool
```

---

## Performance Optimizations

### 1. Caching
- Social proof: 1-hour in-memory cache
- Reduces DB queries by 95%+

### 2. Batch Operations
- Evolution cycles process all variants at once
- Single transaction for kills + breeds

### 3. Indexed Queries
```prisma
@@index([shopId, baseline, segment, status])
@@index([shopId, status])
@@index([timestamp])
```

### 4. Connection Pooling
- Prisma handles connection pooling
- Max connections: 10 (configurable)

### 5. Lazy Loading
- Variants only loaded when needed
- Impressions paginated for large datasets

---

## Testing

### Unit Tests
```javascript
// test-variant-engine.js
import { testVariantCreation } from './variant-engine.js';

testVariantCreation();
// Output:
// ✅ Random variant created
// ✅ Diverse variants created
// ✅ Gene distribution validated
```

### Integration Tests
```javascript
// test-social-proof.js
import { testSocialProofFormatting } from './social-proof.js';
import { createRandomVariantWithSocialProof } from './variant-engine.js';

// Test formatting
testSocialProofFormatting();

// Test variant creation with social proof
const variant = await createRandomVariantWithSocialProof(
  'test-shop-id',
  'conversion_no_discount',
  'all'
);

console.log(variant.headline); // Should show "5k+" if shop qualifies
```

---

## Deployment Checklist

- [ ] Database migrated: `npx prisma migrate deploy`
- [ ] Environment variables set: `CRON_SECRET`
- [ ] Cron jobs configured:
  - [ ] Social proof collection (daily 3 AM)
  - [ ] Evolution cycles (hourly)
- [ ] Shopify webhooks configured:
  - [ ] `orders/create` → Update metrics
  - [ ] `app/uninstalled` → Cleanup
- [ ] Theme extension published
- [ ] API rate limits configured
- [ ] Error monitoring enabled (Sentry)
- [ ] Performance monitoring enabled

---

## Troubleshooting

### Variants Not Evolving

**Check:**
1. Are there 100+ impressions since last cycle?
2. Is `shop.lastEvolutionCycle` recent?
3. Are cron jobs running?
4. Check logs for evolution errors

### Social Proof Not Showing

**Check:**
1. `shop.socialProofEnabled = true`?
2. `shop.orderCount >= 100` or `customerCount >= 100`?
3. Is cache working? (`getSocialProofFromCache()`)
4. Are placeholders in gene pool?
5. Check logs for replacement errors

### Thompson Sampling Not Working

**Check:**
1. Are variants getting impressions?
2. Is jStat library loaded?
3. Check beta distribution sampling
4. Verify champion gets 70% traffic

---

**Related Docs:**
- [Complete AI Guide](./AI_SYSTEM_COMPLETE_GUIDE.md)
- [Pro vs Enterprise](./AI_PRO_VS_ENTERPRISE.md)
- [Social Proof Docs](./SOCIAL_PROOF_TECHNICAL_DOCS.md)

