# Repsarq AI - Technical Architecture
**Last Updated:** April 6, 2026
**Audience:** Developers

---

## Table of Contents

1. [AI Philosophy](#ai-philosophy)
2. [Customer Signals](#customer-signals)
3. [Tier Comparison](#tier-comparison)
4. [System Architecture](#system-architecture)
5. [Core Files & Functions](#core-files--functions)
6. [Database Schema](#database-schema)
7. [API Endpoints](#api-endpoints)
8. [Data Flow](#data-flow)
9. [Evolution Algorithm Details](#evolution-algorithm-details)
10. [Thompson Sampling Implementation](#thompson-sampling-implementation)
11. [Social Proof Integration](#social-proof-integration)
12. [Adaptive Intervention Thresholds](#adaptive-intervention-thresholds)

---

## AI Philosophy

### Goal: Show Modal Only When Necessary

The Repsarq AI is designed with a single guiding principle: **only show a discount modal when it's necessary to get the conversion**.

This means:
- High-intent customers who would buy anyway → No modal or minimal offer
- Price-sensitive customers who need a nudge → Targeted discount
- Low-intent browsers → Don't waste discounts on unlikely conversions

### How We Determine "Necessary"

The AI uses **propensity scoring** (0-100) to predict purchase likelihood:
- **High propensity (70+)**: Likely to convert without help → Skip modal or show non-discount reminder
- **Medium propensity (40-70)**: On the fence → Show appropriate offer
- **Low propensity (<40)**: Unlikely to convert → Only show if cart value justifies it

---

## Customer Signals

### Signal Categories

| Category | Signals | Available In |
|----------|---------|--------------|
| **Core Signals** | visitFrequency, cartValue, itemCount, deviceType, accountStatus, trafficSource, timeOnSite, pageViews, hasAbandonedBefore | Pro + Enterprise |
| **Engagement Signals** | scrollDepth, productDwellTime, cartHesitation, abandonmentCount | Enterprise |
| **High-Value Signals** | failedCouponAttempt, exitPage, cartAgeMinutes | Enterprise |
| **Time-Based Signals** | localHour (customer's local time of day, 0-23) | Pro + Enterprise |
| **Server-Enriched** | purchaseHistoryCount, customerLifetimeValue, averageOrderValue, cartComposition | Pro + Enterprise |

### Signal Scoring Logic (Continuous Propensity Model)

Propensity scoring uses **continuous functions with logarithmic diminishing returns** rather than binary thresholds. Baseline score starts at 45 (shifted from 50 for more resolution at the top). All 23 available signals contribute, clamped to 0-100.

**Customer Commitment (max ~30 points):**

| Signal | Formula | Examples | Reasoning |
|--------|---------|----------|-----------|
| `purchaseHistoryCount` | `min(20, 8 × ln(count + 1))` | 1 order = +5.5, 3 = +11, 10 = +19 | Knows and trusts the brand |
| `customerLifetimeValue` | `min(8, 3 × ln(clv/50 + 1))` | $200 = +4.5, $500 = +7 | High-value customer |
| `accountStatus = 'logged_in'` | +6 flat | — | Committed enough to create account |
| `accountStatus = 'guest'` | -3 flat | — | Less committed |

**Engagement Depth (max ~25 points):**

| Signal | Formula | Examples | Reasoning |
|--------|---------|----------|-----------|
| `timeOnSite` ≥ 30s | `min(12, 4 × ln(sec/30 + 1))` | 2m = +7, 5m = +10 | Genuine consideration |
| `timeOnSite` < 30s | `max(-12, -12 × (1 - sec/30))` | 10s = -8, 25s = -2 | Quick exit = low intent |
| `pageViews` | `min(8, 3 × ln(views + 1))` | 3 = +4, 5 = +5.5, 10 = +7 | Engaged browsing |
| `scrollDepth` | `(depth/100) × 8` | 50% = +4, 80% = +6.4 | Read content, engaged |
| `productDwellTime` | `min(6, 2.5 × ln(sec/15 + 1))` | 30s = +2.7, 60s = +4, 120s = +5.3 | Serious product consideration |

**Visit Intent (max ~20 points):**

| Signal | Formula | Examples | Reasoning |
|--------|---------|----------|-----------|
| `visitFrequency` > 1 | `min(12, 5 × ln(visits))` | 2 = +3.5, 4 = +7, 10 = +11.5 | Returning visitors convert 2-3x better |
| `visitFrequency` = 1 | -8 flat (skipped if purchaseHistory > 0) | — | First-time visitor penalty |
| `trafficSource` | paid: +5, email: +4, direct: +2, social: +1, organic: 0 | — | Pre-qualified traffic |
| `exitPage` | checkout: -8, cart: -4, product: 0, collection/other: +2 | — | Where exit intent fired |

**Cart Signals (max ~15 points):**

| Signal | Formula | Examples | Reasoning |
|--------|---------|----------|-----------|
| `cartValue` ≥ $20 | `min(8, 3 × ln(value/20 + 1))` | $50 = +4, $100 = +5.5, $200 = +7 | Invested in purchase |
| `cartValue` < $20 | `max(-6, -6 × (1 - value/20))` | $5 = -4.5, $10 = -3 | Low commitment |
| `itemCount` > 1 | `min(4, 1.5 × ln(count + 1))` | 2 = +1.6, 3 = +2, 5 = +2.7 | Multi-item = higher commitment |
| `cartAgeMinutes` | >60m: -5, >30m: -3 | — | Indecision signal |

**Discount-Seeking Signals (max ~-30 points):**

| Signal | Formula | Examples | Reasoning |
|--------|---------|----------|-----------|
| `failedCouponAttempt` | -18 flat | — | Explicitly wants a discount |
| `cartHesitation` | `max(-12, -5 × ln(h + 1))` | 1 = -3.5, 3 = -7, 5+ = -10 | Add/remove = price sensitivity |
| `hasAbandonedBefore` | -8 flat | — | Second chance, needs nudge |
| `abandonmentCount` | `max(-6, -2.5 × ln(count + 1))` | 1 = -1.7, 3 = -3.5 | Repeat abandoner |

**Context Signals (max ~10 points):**

| Signal | Formula | Examples | Reasoning |
|--------|---------|----------|-----------|
| `deviceType` | mobile: -4, desktop: +2, tablet: 0 | — | Mobile converts ~50% lower |
| `localHour` | 22-5: +4, 5-8: +2, 11-13: +1, 14-17: -3 | — | Time-of-day intent patterns |
| `dayOfWeek` | Sat/Sun: +2, weekday: 0 | — | Weekend leisure shopping |

**Contradiction Handling:** If `visitFrequency = 1` but `purchaseHistoryCount > 0`, the first-visit penalty is skipped (returning customer on a new device/session).

Enterprise AI also uses time of day to adjust discount sizing: late-night shoppers get ~20% smaller discounts (impulse buyers need less incentive), while afternoon browsers get ~15% larger discounts (casual browsers need more nudging).

---

## Tier Comparison

### Starter Tier
- **No AI** - Manual settings only
- Merchant configures fixed discount and copy
- Modal shows based on simple triggers (exit intent, timer)
- **Contributes to AI training** (see below)

#### Starter Tier Learning (Background)

Even though Starter customers can't enable AI, their data helps train it:

1. **Signal Collection**: Starter tier collects the same customer signals as Pro/Enterprise
2. **Outcome Tracking**: Impressions, clicks, and conversions are recorded
3. **Settings Capture**: Manual settings (headline, body, CTA, discount) are stored
4. **Meta-Learning**: This data feeds into the cross-store learning system

**What Starter Data Teaches the AI:**
- Which headlines convert best for different segments
- Optimal discount amounts by device type and traffic source
- CTA text effectiveness
- Copy patterns (emoji, urgency, questions, numbers)

**Benefits:**
- More training data = better AI for Pro/Enterprise users
- New stores get better defaults based on aggregate learnings
- No privacy concerns - data is anonymized and aggregated

### Pro Tier
- **Basic AI** with core signals
- AI determines **what**, **when**, and **whether** to show
- Uses 10 core signals (including time-of-day) + basic high-value signals for decision-making
- Simpler "should we show" logic than Enterprise
- Trigger type is an evolved gene (`exit_intent`, `idle`, or `exit_intent_or_idle`)
- Activates at add-to-cart time (watches for cart changes if cart is initially empty)

**Pro AI "Should We Show" Logic:**

Pro uses an intent scoring system to make show/no-show decisions. Hard overrides are kept for the strongest signals, but the gray zone is now handled by **adaptive intervention thresholds** (see [Adaptive Intervention Thresholds](#adaptive-intervention-thresholds)).

| Condition | Decision |
|-----------|----------|
| Score < 0 | Don't show — very unlikely to convert |
| First visit + quick exit + cart < $50 | Don't show — accidental visit |
| `failedCouponAttempt` | Always show — explicitly seeking discount |
| `exitPage = 'checkout'` | Always show — needs help completing |
| `cartHesitation > 1` | Always show — price-sensitive |
| Otherwise | **Adaptive threshold decides** (Thompson Sampling per score bucket) |

### Enterprise Tier
- **Advanced AI** with all signals including high-value indicators
- AI determines **what**, **when**, and **whether** to show
- Access to 17+ signals including failed coupon detection and time-of-day
- Dynamic timing control (immediate, exit_intent, delayed)
- Smart "should we show" logic
- Promotional intelligence integration
- Budget-aware offer sizing

**Enterprise-Exclusive Features:**

1. **Failed Coupon Detection**: If customer tries an invalid coupon code, they're flagged as discount-seeking. Enterprise AI immediately shows a targeted offer.

2. **Exit Page Context**: Different strategies for checkout abandonment vs. product page exit.

3. **Cart Age Tracking**: Stale carts (60+ minutes) get proactive offers.

4. **Cart Hesitation Analysis**: Add/remove behavior indicates price sensitivity.

5. **Smart Timing**: AI decides optimal moment to show modal:
   - `immediate`: Show right away (high intent signals)
   - `exit_intent`: Wait for exit (standard)
   - `delayed`: Wait X seconds (building engagement)

---

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

// Thompson Sampling selection (trigger-aware)
selectVariantForImpression(shopId, baseline, segment, triggerReason?)
→ Variant (Champion gets 70%, others use Thompson Sampling)
// When triggerReason is provided and ≥20 trigger-specific impressions exist,
// Thompson Sampling uses trigger-specific conversion rates instead of overall stats.
// This lets different copy win for different trigger reasons (e.g., failedCoupon vs general).

// Record events
recordImpression(variantId, shopId, context) // context includes triggerReason
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
    headlinesWithUrgency: [...],    // Expiry-aware copy for unique codes
    subheads: [...],
    subheadsWithSocialProof: [...],
    subheadsWithUrgency: [...],     // Expiry-aware copy for unique codes
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

**Urgency Gene & Countdown Timer:**

The `urgency` gene controls how the 24-hour discount code expiry is communicated to the customer. It is only active for baselines with discount codes (`revenue_with_discount`, `conversion_with_discount`):

- **`urgency: false`** — A subtle countdown timer appears in the bottom-left of the modal (e.g., "Offer expires in 23:59:45"). Regular headline/subhead copy is used.
- **`urgency: true`** — No separate timer element. Instead, the headline and subhead are drawn exclusively from `headlinesWithUrgency` / `subheadsWithUrgency` pools, which integrate the expiry into the copy (e.g., "Your 15% discount expires in 24 hours").

The timer/urgency copy only appears for **unique discount codes** (which have a 24h expiry via `expiresAt`). Generic codes and no-discount offers never show a timer.

The system A/B tests both approaches via Thompson Sampling and converges on whichever drives more `profitPerImpression`.

**Total Gene Space:**
- 5 baselines × ~800 combinations each = 4,000+ possible variants

---

### 3. `baseline-selector.js`

**Purpose:** Determine which baseline to use based on funnel-stage detection from signals

The AI automatically selects between revenue (upsell/threshold) and conversion (direct discount) per customer based on their journey position. This replaced the old static `aiGoal` merchant toggle.

**Logic:**
```javascript
export function selectBaseline(signals) {
  // Auto-detect funnel stage from signals
  const goal = detectFunnelGoal(signals);
  // Revenue signals: browsing products, fresh cart, multiple page views, high cart value
  // Conversion signals: cart/checkout page, cart hesitation, failed coupon, stale cart

  const propensity = signals.propensityScore || 50;
  const needsIncentive = propensity < 70;

  if (goal === 'revenue') {
    return needsIncentive
      ? 'revenue_with_discount'
      : 'revenue_no_discount';
  } else {
    return needsIncentive
      ? 'conversion_with_discount'
      : 'conversion_no_discount';
  }
}
```

**Propensity Score Calculation (see [Customer Signals](#customer-signals) section for full breakdown):**
- Baseline: 50
- Positive signals increase score (returning visitors, logged-in, long sessions)
- Negative signals decrease score (first-time, quick exit, mobile)
- High-value signals have outsized impact (failed coupon attempt: ±35)

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

### 6. `ai-decision.server.js`

**Purpose:** Determine offer type and amount based on signals

**Key Functions:**
```javascript
// Pro AI: Main decision function
determineOffer(signals, aggression, _aiGoal, cartValue, shopId, plan)  // aiGoal ignored, auto-detected from signals
→ { type, amount, threshold, confidence, reasoning }

// Enterprise AI: Advanced decision with timing and high-value signals
enterpriseAI(signals, aggression, _aiGoal, shopId)  // aiGoal ignored, auto-detected from signals
→ { type, amount, timing, confidence, reasoning }

// Budget check
checkBudget(db, shopId, budgetPeriod)
→ { hasRoom, remaining, totalSpent }

// Cart composition analysis
analyzeCartComposition(signals)
→ { isHighTicket, isMultiItem, avgItemPrice, itemCount }
```

**Pro vs Enterprise Decision Flow:**

```
┌─────────────────────────────────────────────────────────────┐
│                     PRO AI FLOW                             │
├─────────────────────────────────────────────────────────────┤
│ 1. ACTIVATION (page load or add-to-cart):                   │
│    - If cart has items → activate immediately               │
│    - If cart empty → watchForAddToCart() listens for:       │
│      • cart:updated event                                   │
│      • Add-to-cart button click                             │
│      • Cart polling fallback (every 3s)                     │
│    - Once cart has items → activate                         │
│ 2. Pre-fetch AI decision (POST /api/ai-decision)           │
│ 3. Collect signals (core + basic high-value)                │
│ 4. Calculate intent score                                   │
│ 5. SHOULD WE SHOW? (adaptive thresholds)                     │
│    - Score < 0 → NO                                         │
│    - First visit + quick exit + low cart → NO               │
│    - Hard overrides (coupon/checkout/hesitation) → YES      │
│    - Otherwise: shouldIntervene() per score bucket           │
│ 6. WHEN TO SHOW? (evolved trigger gene)                     │
│    - exit_intent: mouseout on desktop                       │
│    - idle: fires after X seconds of inactivity              │
│    - exit_intent_or_idle: whichever fires first             │
│    - Mobile fallback: idle 30s if exit_intent-only          │
│ 7. Calculate offer based on score + aggression              │
│ 8. Show modal with offer                                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   ENTERPRISE AI FLOW                        │
├─────────────────────────────────────────────────────────────┤
│ 1. ACTIVATION (page load or add-to-cart):                   │
│    - Same watchForAddToCart() as Pro (see above)            │
│    - Once cart has items → evaluate                         │
│ 2. Collect ALL 16+ signals (including high-value)           │
│ 3. Enrich signals server-side (POST /api/enrich-signals):   │
│    - Purchase history, CLV, avg order value                 │
│    - Cart composition, premium item detection               │
│    - Temporal patterns (hour/day)                           │
│    - Propensity score (0-100)                               │
│ 4. CHECK HIGH-VALUE SIGNALS FIRST:                          │
│    - Failed coupon? → IMMEDIATE targeted offer              │
│    - Checkout exit? → IMMEDIATE recovery offer              │
│    - Cart hesitation > 1? → Price-sensitive offer           │
│    - Stale cart (60+ min)? → IMMEDIATE nudge                │
│ 5. Calculate propensity score with full signal set          │
│ 6. SHOULD WE SHOW? (adaptive thresholds)                    │
│    - Hard overrides: failedCoupon/checkout/hesitation/stale │
│    - Otherwise: adaptive threshold per score bucket          │
│ 7. WHEN TO SHOW? (dynamic timing)                           │
│    - immediate: High-value signals detected (1s delay)      │
│    - exit_intent: Wait for mouseout                         │
│    - delayed: Wait X seconds                                │
│ 8. Calculate specialized offer for situation                │
│ 9. Return decision with timing control                      │
└─────────────────────────────────────────────────────────────┘
```

**Key Differences:**

| Capability | Pro | Enterprise |
|------------|-----|------------|
| Add-to-cart activation | ✓ watchForAddToCart | ✓ watchForAddToCart |
| Decides whether to show | ✓ Adaptive thresholds | ✓ Adaptive thresholds |
| Decides what offer | ✓ Score-based | ✓ Situation-specific |
| Decides when (timing) | Evolved gene (exit/idle/both) | Immediate/exit/delayed |
| Failed coupon detection | Scores it | Acts on it immediately |
| Checkout recovery | Scores it | Special recovery offer |
| Cart hesitation handling | Scores it | Price-sensitive offer |
| Stale cart detection | Scores it | Proactive nudge |
| Per-store threshold learning | ✓ Per score bucket | ✓ Per score bucket |
| Signal enrichment | ✗ | ✓ Server-side propensity scoring |

**Enterprise-Only Helper Functions:**
```javascript
// For customers who tried invalid coupon codes
calculateOfferForDiscountSeeker(signals, aggression, aiGoal, cartValue, cart)

// For checkout page abandonment
calculateCheckoutRecoveryOffer(signals, aggression, cartValue, cart)

// For add/remove cart behavior
calculateOfferForPriceSensitive(signals, aggression, aiGoal, cartValue, cart)

// For carts sitting 60+ minutes
calculateStaleCartOffer(signals, aggression, aiGoal, cartValue, cart)
```

---

### 7. `intervention-threshold.server.js`

**Purpose:** Adaptive per-store learning of whether to show or skip the modal per propensity/intent score bucket. Uses the same Thompson Sampling pattern as `variant-engine.js`.

**Key Functions:**
```javascript
// Map a score (0-100) into its bucket label
scoreToBucket(score) → "0-10" | "10-20" | ... | "90-100"

// Core decision: should we show the modal for this customer?
// Thompson Sampling between show/skip arms per bucket.
// Falls through to defaults for cold-start (<10 outcomes).
shouldIntervene(db, shopId, score, segment)
→ { shouldShow: boolean, isExploring: boolean, bucket: string }

// Record an intervention outcome (shown, skipped, or holdout)
// Updates running counters on InterventionThreshold (holdout excluded from learning)
recordInterventionOutcome(db, { shopId, wasShown, isHoldout, converted, revenue, ... })
→ InterventionOutcome record

// Update existing outcome when a conversion comes in later (webhook)
recordInterventionConversion(db, outcomeId, revenue, discountAmount)
→ Updated InterventionOutcome

// Recalculate shouldShow/confidence for all buckets (called by cron)
// Uses Monte Carlo Bayesian comparison (10k samples)
recalculateThresholds(db, shopId) → number of updated thresholds
```

**Constants:**
- `MIN_OUTCOMES_FOR_LEARNING = 10` — Below this, use defaults
- `EXPLORATION_FLOOR = 0.05` — Always allocate 5% to the losing arm

---

### 8. `threshold-learning-cycle.js` (Cron)

**Purpose:** Recalculate intervention thresholds for all shops when enough new data exists

**Schedule:** Every 5 minutes (alongside evolution-cycle.js)

**Process:**
1. Find all shops in AI mode (pro or enterprise plan)
2. Count `InterventionOutcome` records since `lastThresholdUpdate`
3. If 50+ new outcomes → run `recalculateThresholds(shopId)`
4. Update `shop.lastThresholdUpdate`

Trigger threshold (50) is lower than variant evolution (100) because each outcome is binary show/skip — we need data in both arms to learn.

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
  aiGoal            String   @default("revenue")  // Deprecated: now auto-detected per customer from funnel-stage signals
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

  // Promotional Intelligence (Enterprise)
  promotionalIntelligenceEnabled Boolean @default(true)

  lastEvolutionCycle DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  // Adaptive Threshold System
  lastThresholdUpdate DateTime?

  variants          Variant[]
  discountOffers    DiscountOffer[]
  aiDecisions       AIDecision[]
  promotions        Promotion[]
  interventionThresholds InterventionThreshold[]
  interventionOutcomes   InterventionOutcome[]
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
  deviceType     String?  // desktop, mobile, tablet
  trafficSource  String?  // paid, organic, social, direct, email
  cartValue      Float?
  accountStatus  String?  // guest, logged_in
  visitFrequency Int?     // 1 = first-time, 2+ = returning
  triggerReason  String?  // failedCoupon, checkoutExit, cartHesitation, staleCart, general
  duringPromo    Boolean  @default(false)

  clicked        Boolean  @default(false)
  converted      Boolean  @default(false)
  revenue        Float?
  discountAmount Float?
  profit         Float?

  timestamp      DateTime @default(now())

  @@index([shopId, duringPromo])
  @@index([shopId, deviceType])
  @@index([shopId, accountStatus])
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

**Promotion** (Enterprise)
```prisma
model Promotion {
  id              String   @id @default(uuid())
  shopId          String
  shop            Shop     @relation(fields: [shopId], references: [id])

  discountCode    String
  discountType    String
  discountAmount  Float
  startDate       DateTime?
  endDate         DateTime?

  strategy        String   @default("ignore")
  seenByMerchant  Boolean  @default(false)

  totalRevenue    Float    @default(0)
  totalOffers     Int      @default(0)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([shopId, seenByMerchant])
}
```

**InterventionOutcome** (Adaptive Threshold Learning)
```prisma
model InterventionOutcome {
  id              String   @id @default(uuid())
  shopId          String
  shop            Shop     @relation(...)

  wasShown        Boolean              // true = modal shown, false = no_intervention
  isHoldout       Boolean  @default(false) // true = 5% holdout group (excluded from learning)
  converted       Boolean  @default(false)
  revenue         Float?
  discountAmount  Float?
  profit          Float?               // revenue - discountAmount

  propensityScore Int?                 // 0-100 (Enterprise)
  intentScore     Int?                 // Pro AI score
  cartValue       Float?
  deviceType      String?
  trafficSource   String?
  segment         String   @default("all")
  scoreBucket     String               // "0-10", "10-20", ..., "90-100"

  aiDecisionId    String?
  impressionId    String?
  timestamp       DateTime @default(now())

  @@index([shopId, scoreBucket, wasShown])
  @@index([shopId, timestamp])
  @@index([shopId, wasShown, converted])
}
```

**InterventionThreshold** (Per-Bucket Thompson Sampling State)
```prisma
model InterventionThreshold {
  id              String   @id @default(uuid())
  shopId          String
  shop            Shop     @relation(...)

  scoreBucket     String               // "0-10", "10-20", ..., "90-100"
  segment         String   @default("all")

  showImpressions   Int    @default(0)
  showConversions   Int    @default(0)
  showRevenue       Float  @default(0)
  showProfit        Float  @default(0)

  skipImpressions   Int    @default(0)
  skipConversions   Int    @default(0)
  skipRevenue       Float  @default(0)
  skipProfit        Float  @default(0)

  shouldShow        Boolean @default(true)
  confidence        Float   @default(0.5)
  lastUpdated       DateTime @updatedAt

  @@unique([shopId, scoreBucket, segment])
  @@index([shopId, segment])
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

### 6. GET `/api/promotions-count`

**Purpose:** Get count of unseen promotions for notification badge (Enterprise)

**Authentication:** Requires Shopify admin session

**Process:**
1. Authenticate admin
2. Find shop by session.shop
3. Count promotions with `seenByMerchant: false`
4. Return count

**Response:**
```json
{
  "count": 3
}
```

**Usage:**
- Called by NavigationMenu component to show notification badge
- Polled periodically for real-time updates
- Resets when merchant visits promotions page

---

## Data Flow

### Impression Flow
```
0. ACTIVATION:
   - Page load: check cart → has items? → activate AI
   - Page load: cart empty? → watchForAddToCart()
     → listens for cart:updated, button clicks, polls /cart.js
     → once items detected → activate AI
   ↓
1. AI activates (pre-fetches decision)
   ↓
2. Frontend calls POST /api/ai-decision
   {
     shop: "store.myshopify.com",
     signals: { ... }
   }
   ↓
3. Backend:
   - selectBaseline(signals) — auto-detects revenue vs conversion from funnel-stage signals
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

## Variant Performance Analysis (Enterprise)

### Component-Based View Architecture

**Page:** `app.variants.jsx`

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  AppLayout (Shopify Polaris)                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Statistics Cards (4 cards)                          │  │
│  │  - Total Variants | Active | Eliminated | Max Gen   │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Filters                                              │  │
│  │  - Promo Toggle (No Promo / During Promo)            │  │
│  │  - Segment Dropdown (All / Desktop / Mobile / etc)   │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌──────────┬──────────┬──────────┐                         │
│  │ Headlines│ Subheads │   CTAs   │                         │
│  │          │          │          │                         │
│  │ [Elite]  │ [Elite]  │ [Elite]  │                         │
│  │ CVR: 8%  │ CVR: 7%  │ CVR: 9%  │                         │
│  │ Rev: $5k │ Rev: $4k │ Rev: $6k │                         │
│  │ vs Avg:  │ vs Avg:  │ vs Avg:  │                         │
│  │ +150%    │ +120%    │ +180%    │                         │
│  │          │          │          │                         │
│  │ [Strong] │ [Strong] │ [Strong] │                         │
│  │ ...      │ ...      │ ...      │                         │
│  └──────────┴──────────┴──────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

**Data Flow:**
```
1. Loader runs on page load
   ↓
2. Read URL params: ?promo=no-promo&segment=all
   ↓
3. Fetch shop and all variant impressions
   ↓
4. Filter impressions by promo context:
   - promo=no-promo → duringPromo = false
   - promo=during-promo → duringPromo = true
   - promo=all → no filter
   ↓
5. Filter impressions by segment:
   - segment=desktop → deviceType = 'desktop'
   - segment=mobile → deviceType = 'mobile'
   - segment=tablet → deviceType = 'tablet'
   - segment=logged-in → accountStatus = 'logged_in'
   - segment=guest → accountStatus = 'guest'
   - segment=first-time → visitFrequency = 1
   - segment=returning → visitFrequency >= 2
   - segment=high-value → cartValue >= 100
   - segment=low-value → cartValue < 50
   - segment=paid-traffic → trafficSource = 'paid'
   - segment=organic-traffic → trafficSource = 'organic'
   - segment=all → no filter
   ↓
6. Aggregate performance by component:
   - Group by headline → calculate CVR, revenue, impressions
   - Group by subhead → calculate CVR, revenue, impressions
   - Group by cta → calculate CVR, revenue, impressions
   ↓
7. Calculate performance tiers:
   - Elite: revenue >= avgRevenue * 1.5
   - Strong: revenue >= avgRevenue * 1.1
   - Average: revenue >= avgRevenue * 0.9
   - Poor: revenue < avgRevenue * 0.9
   ↓
8. Sort by revenue (descending)
   ↓
9. Return top 10 per component
```

**React Architecture:**
```javascript
// app.variants.jsx
export async function loader({ request }) {
  const url = new URL(request.url);
  const promoFilter = url.searchParams.get('promo') || 'all';
  const segmentFilter = url.searchParams.get('segment') || 'all';

  // Build where clause for impressions
  const where = { shopId };

  if (promoFilter === 'no-promo') {
    where.duringPromo = false;
  } else if (promoFilter === 'during-promo') {
    where.duringPromo = true;
  }

  // Fetch filtered impressions
  const impressions = await db.variantImpression.findMany({
    where,
    include: { variant: true }
  });

  // Aggregate by component
  const headlineStats = aggregateByComponent(impressions, 'headline');
  const subheadStats = aggregateByComponent(impressions, 'subhead');
  const ctaStats = aggregateByComponent(impressions, 'cta');

  return json({
    headlines: headlineStats.slice(0, 10),
    subheads: subheadStats.slice(0, 10),
    ctas: ctaStats.slice(0, 10),
    stats: { totalVariants, activeVariants, ... }
  });
}

function aggregateByComponent(impressions, componentType) {
  const grouped = {};

  impressions.forEach(imp => {
    const key = imp.variant[componentType];
    if (!grouped[key]) {
      grouped[key] = {
        text: key,
        impressions: 0,
        conversions: 0,
        revenue: 0,
        variantCount: new Set()
      };
    }

    grouped[key].impressions++;
    if (imp.converted) grouped[key].conversions++;
    if (imp.revenue) grouped[key].revenue += imp.revenue;
    grouped[key].variantCount.add(imp.variantId);
  });

  // Calculate metrics
  const results = Object.values(grouped).map(item => ({
    text: item.text,
    conversionRate: (item.conversions / item.impressions) * 100,
    impressions: item.impressions,
    revenue: item.revenue,
    variantCount: item.variantCount.size
  }));

  // Sort by revenue
  return results.sort((a, b) => b.revenue - a.revenue);
}
```

**UI Components:**
```javascript
// Promo Toggle (uses URL params)
<ChoiceList
  title="Promo Context"
  choices={[
    { label: 'All', value: 'all' },
    { label: 'No Promo', value: 'no-promo' },
    { label: 'During Promotions', value: 'during-promo' }
  ]}
  selected={[promoFilter]}
  onChange={(value) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('promo', value[0]);
    setSearchParams(newParams);
  }}
/>

// Segment Dropdown (uses URL params)
<Select
  label="Customer Segment"
  options={[
    { label: 'All Customers', value: 'all' },
    { label: 'Desktop Only', value: 'desktop' },
    { label: 'Mobile Only', value: 'mobile' },
    // ... more segments
  ]}
  value={segmentFilter}
  onChange={(value) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('segment', value);
    setSearchParams(newParams);
  }}
/>

// Component Card
<Card>
  <Box borderColor={tierColor} borderWidth="2">
    <BlockStack gap="200">
      <Badge tone={tierBadgeTone}>{tier}</Badge>
      <Text variant="headingMd">{text}</Text>
      <InlineGrid columns={2} gap="200">
        <Text>CVR: {conversionRate}%</Text>
        <Text>Rev: ${revenue}</Text>
        <Text>Imp: {impressions}</Text>
        <Text>vs Avg: {vsAverage}%</Text>
      </InlineGrid>
    </BlockStack>
  </Box>
</Card>
```

**Performance Tier Colors:**
- Elite (Green): `success` tone, green border
- Strong (Blue): `info` tone, blue border
- Average (Gray): default tone, gray border
- Poor (Red): `critical` tone, red border

**URL Parameter State Management:**
```javascript
import { useSearchParams } from '@remix-run/react';

const [searchParams, setSearchParams] = useSearchParams();
const promoFilter = searchParams.get('promo') || 'all';
const segmentFilter = searchParams.get('segment') || 'all';

// Update URL when filter changes (triggers loader re-run)
const newParams = new URLSearchParams(searchParams);
newParams.set('promo', 'no-promo');
setSearchParams(newParams);
```

**Key Benefits:**
- Real-time filtering without manual state management
- URL is shareable and bookmarkable
- Browser back/forward works correctly
- Loader automatically re-runs on URL change
- Clean separation of concerns

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

## Adaptive Intervention Thresholds

### The Problem

The AI system learned **what** to show (variant genes via genetic algorithm) but not **whether** to show. Show/no-show thresholds were hardcoded and identical across all stores, despite the fact that a luxury brand's customers at propensity 60 behave completely differently from a fast-fashion store's customers at the same score.

### The Solution

Per-store, per-score-bucket learning using Thompson Sampling (same Bayesian bandit pattern as variant selection). The system treats "show modal" and "skip modal" as two arms and learns which generates more profit per impression for each score bucket.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              ADAPTIVE THRESHOLD FLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. Customer triggers AI decision                            │
│     ↓                                                         │
│  1.5 HOLDOUT CHECK: 5% random → no intervention              │
│     → Stamp cart: exit_intent_holdout={aiDecisionId}         │
│     → Record outcome(isHoldout: true) — excluded from learning│
│     → If customer buys → webhook tracks holdout conversion   │
│     ↓ (95% continue)                                          │
│  2. Hard override check (failedCoupon, checkout, etc.)       │
│     → If match: ALWAYS SHOW (bypass adaptive system)         │
│     ↓                                                         │
│  3. shouldIntervene(shopId, score, segment)                   │
│     → Find InterventionThreshold for score bucket            │
│     → Cold start (<10 outcomes): use defaults (show)         │
│     → Thompson Sample: show arm vs skip arm                  │
│     → 5% exploration floor (always test losing arm)          │
│     ↓                                                         │
│  4A. SHOW → recordInterventionOutcome(wasShown: true)        │
│      → Later: webhook fires → recordInterventionConversion() │
│      → Matched by unique aiDecisionId on cart attribute      │
│                                                               │
│  4B. SKIP → recordInterventionOutcome(wasShown: false)       │
│      → Frontend stamps cart: exit_intent_decision={decisionId}│
│      → If customer buys → webhook looks up exact decision ID │
│      → recordInterventionOutcome(wasShown: false, conv: true)│
│                                                               │
│  5. Cron (every 5 min): 50+ new outcomes per shop?           │
│     → recalculateThresholds() — 10k Monte Carlo samples      │
│     → Update shouldShow + confidence per bucket              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Score Buckets

Propensity/intent scores (0-100) are partitioned into 10-point buckets:
`0-10`, `10-20`, `20-30`, `30-40`, `40-50`, `50-60`, `60-70`, `70-80`, `80-90`, `90-100`

Each bucket × segment (mobile/desktop/all) gets its own `InterventionThreshold` record with independent Thompson Sampling state.

### Natural Conversion Tracking

The critical feedback loop: when the AI decides NOT to show a modal, we need to know if the customer converted anyway (proving "don't show" was the right call).

**Mechanism:**
1. Frontend stamps cart attribute `exit_intent_decision: {aiDecisionId}` on no-show (unique ID, not a boolean)
2. Order webhook detects this attribute and looks up the exact `AIDecision` record by ID
3. Creates `InterventionOutcome(wasShown: false, converted: true, revenue)`
4. Updates the "skip" arm counters on the matching `InterventionThreshold`

**Decision ID matching** ensures accurate attribution even on high-traffic stores where multiple no_intervention decisions may exist within the same time window. Legacy `no_intervention` string values are handled as a fallback.

Without this, the system can only learn from shown-modal conversions and would never have evidence that skipping is profitable.

### Holdout Group Conversion Tracking

Separate from natural conversion tracking. Holdout conversions:
1. Frontend stamps cart attribute `exit_intent_holdout: {aiDecisionId}`
2. Order webhook detects this attribute (checked before other signals)
3. Creates `InterventionOutcome(wasShown: false, isHoldout: true, converted: true, revenue)`
4. Returns immediately — holdout conversions don't flow into analytics/revenue attribution
5. Holdout outcomes are **never** fed into the Thompson Sampling learning loop

### Cold Start / Bootstrap

For new stores with no `InterventionOutcome` data:
1. Use current behavior as defaults (`shouldIntervene` returns `shouldShow: true`)
2. Every AI decision creates an `InterventionOutcome` record
3. After ~10 outcomes per bucket, Thompson Sampling kicks in
4. After ~50 outcomes per bucket, the cron recalculates confidence
5. After ~200 outcomes per bucket, the system has enough data to confidently deviate from defaults

### Key Files

| File | Purpose |
|------|---------|
| `app/utils/intervention-threshold.server.js` | Core engine: `shouldIntervene()`, `recordInterventionOutcome()`, `recalculateThresholds()` |
| `app/cron/threshold-learning-cycle.js` | Cron job: recalculate thresholds every 5 min when 50+ new outcomes |
| `app/utils/ai-decision.server.js` | Calls `shouldIntervene()` instead of hardcoded rules |
| `app/routes/apps.exit-intent.api.ai-decision.jsx` | 5% holdout coin flip, records `InterventionOutcome` on every show/no-show/holdout, returns `aiDecisionId` |
| `app/routes/webhooks.orders.create.jsx` | Holdout conversion tracking, natural conversion tracking (by decision ID), intervention conversion tracking (by decision ID) |
| `extensions/exit-intent-modal/assets/exit-intent-modal.js` | Stamps cart with unique `aiDecisionId` on no-intervention, holdout, and CTA click |

---

**Related Docs:**
- [Complete AI Guide](./AI_SYSTEM_COMPLETE_GUIDE.md)
- [Pro vs Enterprise](./AI_PRO_VS_ENTERPRISE.md)
- [Social Proof Docs](./SOCIAL_PROOF_TECHNICAL_DOCS.md)

