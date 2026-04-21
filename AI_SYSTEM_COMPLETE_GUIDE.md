# Repsarq AI System - Complete Guide
**Last Updated:** April 21, 2026
**Version:** 2.4 (archetype meta-layer + segment-aware Thompson Sampling)

---

## Quick Navigation

- **[Full System Guide](./AI_SYSTEM_COMPLETE_GUIDE.md)** - This file (overview, evolution, genes)
- **[Pro vs Enterprise Comparison](./AI_PRO_VS_ENTERPRISE.md)** - Feature differences
- **[Technical Architecture](./AI_TECHNICAL_ARCHITECTURE.md)** - Code structure, APIs
- **[Social Proof Documentation](./SOCIAL_PROOF_TECHNICAL_DOCS.md)** - Social proof system

---

## System Overview

Repsarq uses a **genetic algorithm** + **Bayesian statistics** to automatically optimize exit-intent modals.

**Key Concepts:**
- **Variants** = Individual modal versions (organisms)
- **Genes** = Components (headline, CTA, offer, etc.)
- **Archetypes** = Coherent modal patterns (e.g. "Threshold Discount", "Soft Upsell") — the meta-layer above genes that the AI uses for cross-segment learning. See "Archetype meta-layer" below.
- **Segment keys** = Composite tokens describing each visitor (device · traffic · account · page · promo-in-cart · frequency) — used for per-segment performance tracking and runtime variant biasing.
- **Generations** = Evolution cycles
- **Fitness** = Profit per impression
- **Selection** = Best survive, poor die
- **Breeding** = Top performers create offspring
- **Mutation** = Random changes for exploration

### The Flow
```
Page Load (or Add-to-Cart) → AI Activates → Signals Collected
→ Holdout Check (5% random → never show, stamp cart for incrementality measurement)
→ Should We Show? (Adaptive Threshold per score bucket)
  → NO: stamp cart with decision ID, track natural conversion if purchase happens
  → YES: Baseline Selected → Variant Selected (Thompson Sampling)
    → Trigger Set (exit_intent/idle/immediate) → Trigger Fires
    → Social Proof Applied → Modal Shown → Impression Recorded
    → User Interacts → Evolution Cycle (every 100 impressions) → Champion Detection
    → Threshold Learning Cycle (every 50 outcomes) → Per-bucket show/skip refinement
    → If Dismissed (not CTA click): 60s later → Reminder Toast (discount offers only)
      → Click toast → checkout with discount (attributed as conversion)
      → Auto-dismiss after 30s or manual close
```

**Activation**: AI pre-fetches its decision as soon as the cart has items. If the
cart is empty at page load, a `watchForAddToCart()` listener activates AI the
moment items are added (via `cart:updated` events, button click detection, or
polling fallback).

---

## Evolutionary Algorithm

### Generation Lifecycle

**Gen 0 (Day 1):**
- 10 random variants created
- Genes randomly selected from pools
- Pure exploration phase

**Gen 1-3 (Week 1):**
- Evolution runs every 100 impressions
- Poor performers killed via Bayesian confidence
- Top performers breed offspring
- Crossover mixes parent genes
- Mutation adds random changes

**Gen 4+ (Maturity):**
- Clear patterns emerge
- Champion crowned (500+ imp, 7+ days, 95% confidence)
- Champion gets 70% traffic
- 30% continues exploring

### Evolution Cycle (Every 100 Impressions)

1. **Calculate Fitness**: Profit Per Impression = (Revenue - Discount) / Impressions
2. **Identify Dying**: Bayesian test - if 95% confident variant is worse than top performer
3. **Kill**: Status → 'dead', removed from pool
4. **Breed Replacements**: Select parents by fitness, crossover genes, mutate
5. **Detect Champion**: Check if any variant beats all others with 95% confidence

---

## Gene System

### Six Genes Per Variant

| Gene | Controls | Options |
|------|----------|---------|
| offerAmount | Discount size | 0, 10, 15, 20, 25 |
| headline | Main message | 3-6 per baseline |
| subhead | Supporting text | 3-6 per baseline |
| cta | Button text | 3-4 per baseline |
| redirect | Destination | cart, checkout |
| urgency | Expiry presentation | true, false |

### Gene Pools Structure

Each baseline has separate pools for regular, social proof, and urgency genes:
```javascript
conversion_with_discount: {
  offerAmounts: [10, 15, 20, 25],

  headlines: [
    'Hold on — take {{amount}}% off your order',
    'Your {{amount}}% discount is waiting'
  ],

  headlinesWithSocialProof: [
    '{{social_proof_count}} shoppers claimed this {{amount}}% off today',
    'Join {{social_proof_count}} customers saving {{amount}}%'
  ],

  headlinesWithUrgency: [
    'Your {{amount}}% discount expires in 24 hours',
    'Act fast — {{amount}}% off won\'t last forever'
  ],

  // Same pattern for subheads, subheadsWithSocialProof, subheadsWithUrgency
}
```

### Urgency Gene & Countdown Timer

The `urgency` gene controls how unique discount code expiry (24 hours) is shown to the customer. Only active for discount baselines (`revenue_with_discount`, `conversion_with_discount`):

- **`urgency: false`** — Subtle countdown timer in the modal (bottom-left, "Offer expires in 23:59:45"). Regular headline/subhead copy used.
- **`urgency: true`** — No timer element. Headline/subhead drawn exclusively from `headlinesWithUrgency` / `subheadsWithUrgency` pools that integrate expiry into the copy.

No timer or urgency copy for generic codes (no expiry) or no-discount offers. The variant engine selects the urgency gene first, then picks the appropriate headline/subhead pool. Thompson Sampling converges on whichever approach (timer vs. copy) drives more profit.

**Possible Combinations:** 4 × 6 × 6 × 3 × 2 × 2 = **864 variants per baseline**

---

## Social Proof System

### Overview

Displays customer counts/ratings in modals: "Join 5k+ happy customers"

### Flow

1. **Data Collection**: Daily cron fetches orders/customers from Shopify
2. **Formatting**: 5000 → "5k+", 4.8 → "4.8★"
3. **Gene Selection**: If shop qualifies, add social proof genes to pool
4. **Replacement**: `{{social_proof_count}}` → "5k+"

### Qualification

Shop must have:
- `socialProofEnabled: true`
- `orderCount >= 100` OR `customerCount >= 100`
- `avgRating >= 4.0` (if using rating)

If ANY fails → only regular genes used, no broken placeholders

### Caching

1-hour in-memory cache:
- First variant: fetch from DB, cache
- Subsequent variants (< 1hr): use cache
- After 1hr: refresh from DB

**Result:** 95%+ reduction in DB queries

---

## Four AI Modes (Auto-Selected by Funnel Stage)

### Funnel-Stage Detection

The AI automatically selects between revenue (upsell/threshold) and conversion (direct discount) mode per customer based on their position in the post-ATC journey. This replaces the old static merchant toggle.

```javascript
// Funnel-stage scoring: revenue vs conversion signals
// Revenue signals: browsing products, fresh cart, multiple page views, high cart value
// Conversion signals: on cart/checkout page, cart hesitation, failed coupon, stale cart, abandoner
// Higher score wins → determines baseline selection

// Then: adaptive threshold decides whether to show at all
// If show:
if (aggression === 0) return 'pure_reminder';
if (funnelGoal === 'revenue') {
  return propensityScore < 70 ? 'revenue_with_discount' : 'revenue_no_discount';
} else {
  return propensityScore < 70 ? 'conversion_with_discount' : 'conversion_no_discount';
}
```

**Funnel-Stage Signals:**
| Signal | Revenue | Conversion |
|--------|---------|------------|
| Exit from product/collection page | +25 | — |
| Exit from cart page | — | +25 |
| Exit from checkout page | — | +40 |
| Cart hesitation > 1 | — | +20 |
| No cart hesitation | +10 | — |
| Failed coupon attempt | — | +30 |
| Cart age < 10 min | +15 | — |
| Cart age > 30 min | — | +15 |
| Previous abandoner | — | +15 |
| 5+ page views | +15 | — |
| < 2 page views | — | +5 |
| Cart value > $100 | +10 | — |
| Cart value < $30 | — | +10 |

### 1. Revenue with Discount
- Goal: Increase cart size
- Example: "Add $25 more, save $10"
- When: Low propensity + browsing after ATC (revenue funnel stage)

### 2. Revenue without Discount
- Goal: Increase cart size
- Example: "You're building a great cart!"
- When: High propensity + browsing after ATC (revenue funnel stage)

### 3. Conversion with Discount
- Goal: Convert immediately
- Example: "Get 15% off before you go"
- When: Low propensity + on cart/checkout page or price-sensitive (conversion funnel stage)

### 4. Conversion without Discount
- Goal: Convert immediately
- Example: "Rated 4.8★ by verified buyers"
- When: High propensity + evaluating purchase (conversion funnel stage)

### 5. Pure Reminder
- Goal: Remind only
- Example: "You have items in your cart"
- When: Aggression = 0 OR budget exhausted

---

## Thompson Sampling

### How It Works

1. **Model each variant's conversion rate** as Beta(α, β)
   - α = conversions + 1
   - β = failures + 1

2. **Sample from each distribution**
   - Variant A: 0.042
   - Variant B: 0.051 ← Winner

3. **Show highest sample** → Gets this impression

4. **Update based on result**
   - Converted → α increases
   - Failed → β increases

**Over time**: Good variants get more traffic automatically

### Champion Override

- Champion exists → 70% traffic to Champion
- Remaining 30% → Thompson Sampling among others
- Balance: Exploit winner (70%) + Explore alternatives (30%)

### Segment-Aware Bias (Archetype Priors)

Thompson Sampling is now visitor-aware: at decision time, the engine looks up which **archetypes** (modal patterns) historically win for the current visitor's segment, and tilts the beta sample.

**Multiplier shape (linear by archetype CVR rank):**
- Rank #1 archetype → sample × **1.30**
- Rank #N archetype → sample × **0.85**
- Interior ranks linearly interpolated

**Cascade for the prior source** (most-specific wins):
1. Own-shop impressions for this exact `segmentKey`, last 30 days, ≥50 imps
2. Network meta-learning insight keyed by `segmentKey`
3. Network meta-learning insight keyed by (vertical, legacy segment)
4. None — fall back to uniform Thompson Sampling

**Conservative on purpose.** A 1.30× nudge can be overcome by a strong beta sample, so exploration is preserved. The engine never *forces* an archetype — it just biases the dice.

**Tier behavior:**
- **Enterprise** (10–20 variants): genuine per-segment routing — different archetypes win for different shopper personas.
- **Pro** (2 variants): when the two variants represent different archetypes, the bias routes ~70/30 by segment. When they share an archetype, the prior map is empty and standard A/B testing resumes.

See [`app/utils/archetype-priors.js`](app/utils/archetype-priors.js).

---

## Archetype Meta-Layer

### What is an archetype?

An archetype is a **coherent modal pattern** that combines a headline style, an offer type, and a CTA into one recognizable persuasion strategy. Examples:

| Archetype | Headline style | Offer | CTA |
|-----------|----------------|-------|-----|
| `THRESHOLD_DISCOUNT` | "Spend $X more, save Y%" | Tiered discount | "Add to qualify" |
| `SOFT_UPSELL` | Recommendation-based | None or small | "See picks" |
| `FREE_SHIPPING_INCENTIVE` | "You're $X away from free shipping" | Free shipping | "Add more" |
| `URGENCY_PUSH` | Countdown-driven | Time-bound discount | "Claim now" |
| `LOYALTY_NUDGE` | Customer-status copy | Loyalty perk | "Use my reward" |

Archetype is **denormalized onto every `VariantImpression`** for fast aggregator queries (no joins to figure out which baseline a variant came from).

### Why archetypes (not just genes)?

Genes (raw headline/CTA/offer text) are the AI's atoms — but the patterns *between* genes are where merchant insight lives. Telling a merchant "your top headline is X" is less actionable than "your customers respond to upsells, not discounts."

Archetypes also enable cross-store learning that doesn't leak copy: the meta-learning aggregator can publish "stores in this vertical win with FREE_SHIPPING_INCENTIVE for first-time mobile guests" without exposing any specific headline text or revenue figure.

### Brand-safety guard

Each archetype has a tone profile. The selector validates that the chosen variant's copy is consistent with its archetype's tone — preventing drift where, e.g., a `SOFT_UPSELL` variant accidentally evolves into hard-discount language. See `app/utils/brand-safety.js`.

---

## Composite Segment Keys

The legacy `segment` field on `VariantImpression` is a coarse `{device}_{traffic}` string (e.g. `mobile_paid`). Rich meta-learning needed finer partitioning, so each impression now also carries a **composite `segmentKey`**:

```
d:{device}|t:{traffic}|a:{account}|p:{pageType}|pr:{promoInCart}|f:{frequency}
```

Example: `d:mobile|t:paid|a:guest|p:product|pr:no|f:first`

**Dimensions** (closed vocabularies for stability):
- `d` device — mobile / desktop / tablet / unknown
- `t` traffic — paid / organic / social / direct / referral / email / unknown
- `a` account — guest / returning / loyal / unknown
- `p` pageType — home / product / collection / cart / checkout / search / blog / account / other / unknown
- `pr` promoInCart — yes / no
- `f` frequency — first / occasional / frequent / unknown

This is the unit of aggregation used by archetype priors and by the Variants → Segments heatmap. See [`app/utils/segment-key.js`](app/utils/segment-key.js).

---

## Adaptive Intervention Thresholds (Per-Store Learning)

### What It Learns

The variant system learns **what** to show (copy, offer, CTA). The adaptive threshold system learns **whether** to show at all. Each store develops its own show/no-show policy per propensity score bucket.

### How It Works

1. **Score Bucketing**: Propensity scores (0-100) split into 10 buckets: 0-10, 10-20, ..., 90-100
2. **Two Arms**: For each bucket, "show modal" and "skip modal" are competing strategies
3. **Thompson Sampling**: Same Bayesian bandit as variant selection — sample from each arm's beta distribution, pick the winner
4. **Profit-Weighted**: Not just conversion rate — the system optimizes for profit per impression (revenue minus discount cost)
5. **Exploration Floor**: 5% of traffic always tests the losing arm to keep gathering data
6. **Natural Conversion Tracking**: When AI skips the modal, the cart is stamped so we know if the customer buys anyway

### Hard Overrides

Some signals always trigger a show regardless of learned thresholds:
- `failedCouponAttempt` — customer explicitly wants a discount
- `exitPage = 'checkout'` — needs help completing purchase
- `cartHesitation > 1` — price-sensitive behavior
- `cartAgeMinutes > 60` — stale cart needs a nudge (Enterprise)

### Cold Start

New stores start with "always show" defaults. After ~10 outcomes per bucket, Thompson Sampling begins. After ~200 outcomes, the system has strong per-store recommendations.

### Cron Job

Runs every 5 minutes. When a store has 50+ new intervention outcomes since last update, recalculates all bucket thresholds using 10,000-sample Monte Carlo Bayesian comparison.

---

## Incrementality Measurement (5% Holdout)

### Purpose

Proves the causal revenue lift from Repsarq. Without a holdout, the system can optimize but can't answer "how much incremental revenue did we generate?"

### How It Works

1. **Random Assignment**: 5% of eligible traffic is randomly assigned to the holdout group at add-to-cart time — before hard overrides, before Thompson Sampling, before any AI logic
2. **No Intervention**: Holdout customers never see a modal, regardless of signals
3. **Cart Stamping**: Holdout carts are stamped with `exit_intent_holdout: {aiDecisionId}` so the webhook can track conversions
4. **Separate Tracking**: Holdout outcomes are stored with `isHoldout: true` in InterventionOutcome — excluded from the Thompson Sampling learning loop
5. **Incrementality Calculation**: Treatment CVR minus Holdout CVR = incremental lift attributable to the app

### Key Design Decisions

- Holdout coin flip happens **before** hard overrides to avoid systematic bias (if holdout excluded hard-override signals, the comparison would be unfair)
- Holdout outcomes **never** train the adaptive threshold system — they're measurement-only
- 5% holdout is small enough that the revenue cost is minimal while still gathering enough data for statistical significance
- Unique decision IDs (not booleans) stamped on cart attributes for accurate webhook matching at any traffic volume

### Statistical Requirements

- ~500-1000 holdout conversions needed for meaningful results
- At 5% holdout rate and ~5% CVR, that's ~10,000-20,000 eligible sessions
- Bayesian comparison (same pattern as variant evolution) determines confidence

---

## Post-Dismissal Reminder Toast

### Purpose

Recovers value from customers who dismissed the main modal but are still browsing. Instead of giving up after one attempt, a small non-intrusive reminder appears 60 seconds after dismissal.

### Design

- **Small floating pill** in the bottom corner (not a full-width bar that blocks content)
- Dark background (#1f2937) with white text — minimal, unobtrusive
- Shows "Your offer is still available" + the discount code
- Matches store's `brandFont` for consistency
- Click → applies discount and redirects to checkout
- Close button (×) to dismiss manually
- Auto-dismisses after 30 seconds

### When It Shows

- Only for offers with a discount code (percentage, fixed, threshold)
- Only when the customer **dismissed** the modal (not when they clicked the CTA)
- 60-second delay after dismissal — gives the customer time to continue browsing
- Does NOT show for no-discount offers (nothing to remind about)

### Chat Widget Detection

Detects common chat widgets (Tidio, HubSpot, Intercom, Drift, Gorgias, Shopify Chat, Crisp, Tawk, Zendesk) in the bottom-right corner. If found, the toast appears in the bottom-left instead to avoid overlap.

### Attribution

Toast clicks stamp the same cart attributes (`exit_intent: true`, `exit_intent_ai_decision: {id}`) as CTA clicks, so conversions are attributed correctly through the existing webhook pipeline.

---

## Trigger-Reason Variant Evolution

### Why

Different trigger reasons need different copy. A customer who tried a failed coupon needs "We have something for you" — not the same messaging as someone whose cart has been sitting for an hour ("Still thinking it over?"). Without trigger-aware evolution, the system optimizes copy across ALL customers, which means the winning copy is a compromise that's mediocre for every trigger reason.

### How It Works

1. Every `VariantImpression` is tagged with a `triggerReason`: `failedCoupon`, `checkoutExit`, `cartHesitation`, `staleCart`, or `general`
2. When selecting a variant via Thompson Sampling, if the current trigger reason has 20+ impressions for any variant, the sampling uses trigger-specific conversion rates instead of overall stats
3. This means a variant with 15% CVR for `failedCoupon` customers will be preferred over one with 10% CVR for `failedCoupon`, even if the second variant has higher overall CVR
4. When trigger-specific data is insufficient (<20 impressions), the system falls back to overall stats — no cold start penalty

### Trigger Reasons

| Trigger Reason | Source | Description |
|---|---|---|
| `failedCoupon` | Hard override | Customer tried a coupon code that didn't work |
| `checkoutExit` | Hard override | Customer is leaving from the checkout page |
| `cartHesitation` | Hard override | Customer added/removed items multiple times |
| `staleCart` | Hard override | Cart has been sitting for 60+ minutes |
| `general` | Adaptive threshold | No specific hard-override signal; AI decided to show via Thompson Sampling |

### Key Design Decision

Trigger reason is NOT a separate variant population dimension (like baseline × segment). That would fragment data too aggressively. Instead, all trigger reasons share the same variant pool, but Thompson Sampling uses trigger-specific conversion rates when enough data exists. This means:
- Variants are shared across trigger reasons (no population explosion)
- Evolution (breeding, killing) uses overall stats (sufficient data)
- Selection biases toward variants proven for the current trigger context

---

## Champion Detection

### Requirements

1. 500+ impressions
2. 7+ days alive
3. Beats ALL others with 95% Bayesian confidence

### Process
```javascript
1. Filter candidates (500+ imp, 7+ days)
2. Get top performer by profitPerImpression
3. Bayesian test against all others
4. If beats all with 95%+ confidence → Crown Champion
```

Once crowned:
- Gets 70% of traffic
- Status = 'champion'
- Continues evolving (can be dethroned)

---

## Network Meta-Learning

### For New Stores (<100 impressions)

**Problem**: New stores start with random variants, slow to converge

**Solution**: Inherit proven genes from network

### How It Works

1. **Check if store is new** (<100 total impressions)
2. **Query top genes from network**:
   - Must be used by 3+ stores
   - Must have 70%+ confidence
   - Must have positive profit

3. **Create hybrid population**:
   - 5 variants with proven genes
   - 5 random exploration variants

4. **Result**: Faster convergence, better initial performance

### Privacy

- Store data never leaves your database
- Aggregate genes only (no PII)
- Opt-out available in settings

---

## Enterprise Features

### Promotional Intelligence (Active)

**For:** Enterprise tier only (Pro tier shows detection warnings only)

**Purpose:** Automatically detect site-wide promotions and adjust exit-intent strategy

#### How It Works

1. **Automatic Detection**
   - Scans for active discount codes site-wide
   - Tracks code, discount amount, start/end dates
   - Monitors promotional context continuously

2. **Notification System**
   - **Sidebar Badge**: Shows count of unseen promotions
   - **Page Banner**: Displays new promotion alerts on promotions page
   - **Dashboard Widget**: Shows up to 3 active promotions on main dashboard
   - **"Seen" Tracking**: Marks promotions as seen when merchant views them

3. **Strategy Options**
   When a promotion is detected, choose one of four strategies:

   **A. Pause AI**
   - Stops showing exit-intent modals during promotion
   - Prevents discount stacking
   - Use case: Black Friday sale already offering 30% off

   **B. Increase Offers**
   - AI automatically offers 5%+ more than site-wide promo
   - Example: 20% site-wide → AI offers 25%+
   - Use case: Want exit-intent to beat regular promotions

   **C. Merchant Override**
   - Manually set custom aggression level during promo
   - Example: Set aggression to 8 during sale
   - Use case: Manual control of promotional strategy

   **D. Ignore Promo**
   - Continue normal AI operation
   - Use case: Small discount doesn't affect exit strategy

4. **Performance Metrics**
   - Shows revenue impact for each promotion
   - Tracks total offers made during promo period
   - Calculates ROI of promotional adjustments

5. **Smart Recommendations**
   Based on discount levels:
   - **High discount (30%+)**: Suggests pausing to avoid margin erosion
   - **Moderate discount (20-30%)**: Suggests reducing offers
   - **Low discount (<20%)**: Suggests continuing normal operation

6. **Feature Toggle**
   - Enable/disable promotional intelligence from settings
   - Preference persists across sessions
   - Warning banner shown when disabled

#### How to Use

1. **View Notifications**
   - Check sidebar for notification badge count
   - Click to view promotions page
   - New promotions highlighted with banner

2. **Choose Strategy**
   - Review detected promotion details
   - Select appropriate strategy from dropdown
   - Save changes

3. **Monitor Performance**
   - Check revenue metrics on promotions page
   - Review smart recommendations
   - Adjust strategy if needed

4. **Manage Settings**
   - Toggle promotional intelligence on/off from dashboard
   - Preferences saved automatically
   - Disable temporarily if not needed

**Pro Tier Alternative:**
- Detects promotions and shows warning
- No automatic adjustments
- No notification system
- Manual settings changes required

---

### Variant Performance Analysis

**For:** Enterprise tier only (Pro tier: basic dashboard only)

**Purpose:** Analyze which headlines, subheads, and CTAs drive the most revenue

#### Component-Based View

The Variants page shows three columns side-by-side:

1. **Top Headlines** - Best performing headline copy
2. **Top Subheads** - Best performing subheadline copy
3. **Top CTAs** - Best performing call-to-action buttons

Each component shows:
- **Performance Tier**: Elite / Strong / Average / Poor
- **Color Coding**: Green / Blue / Gray / Red borders
- **Conversion Rate**: Percentage of impressions that converted
- **Total Impressions**: How many times shown
- **Revenue Impact**: Total dollars generated
- **vs Average**: Performance compared to average (as percentage)
- **Variant Count**: How many variants use this component

#### Performance Tiers

- **Elite (Green)**: Revenue 50%+ above average
- **Strong (Blue)**: Revenue 10-50% above average
- **Average (Gray)**: Revenue within 10% of average
- **Poor (Red)**: Revenue 10%+ below average

#### Filtering Options

**1. Promo Context Toggle**
- Filter by promotional context
- Options: All / No Promo / During Promotions
- Shows how copy performs with vs without site-wide promotions
- All metrics recalculate based on filtered impressions

**2. Customer Segment Dropdown**
- Filter by customer segment
- Options organized by category:
  - **Device Type**: Desktop, Mobile, Tablet
  - **Account Status**: Logged In, Guest
  - **Visitor Type**: First-Time, Returning
  - **Cart Value**: High Value ($100+), Low Value (<$50)
  - **Traffic Source**: Paid Traffic, Organic Traffic
- See which copy works best for each audience
- Optimize separately for different customer types
- All metrics recalculate based on selected segment

#### How to Use

1. **Access the Page**
   - Navigate to Variants from main menu
   - View loads automatically with current data

2. **Filter by Promo Context**
   - Toggle between "All", "No Promo", and "During Promotions"
   - See how copy performs in different promotional contexts
   - Example: Headlines that work during sales vs normal periods

3. **Filter by Customer Segment**
   - Select from dropdown to filter by specific audience
   - Examples:
     - Desktop vs Mobile: See if different copy works on different devices
     - Logged In vs Guest: Understand account status impact
     - First-Time vs Returning: Optimize for visitor familiarity
     - High Value vs Low Value: Tailor messaging to cart size
     - Paid vs Organic: See how traffic source affects performance
   - Combine with promo filter for deeper insights

4. **Identify Top Performers**
   - Look for Elite (green) components
   - Check "vs Average" metric for lift
   - Note revenue impact in dollars

5. **Find Patterns**
   - Compare Elite headlines vs Poor headlines
   - What makes them different?
   - Use insights to inform brand voice
   - Test hypotheses by filtering different segments

6. **Track Trends**
   - Page refreshes automatically every 30 seconds (optional)
   - See performance change in real-time
   - Monitor impact of new variants
   - Watch how segment performance evolves

#### Statistics Dashboard

At the top of the page:
- **Total Variants**: All variants ever created
- **Active Variants**: Currently being shown
- **Eliminated Variants**: Killed by evolution
- **Max Generation**: Highest generation reached

#### Key Insights

Use this page to answer:
- Which headlines drive the most revenue?
- Do customers respond better to urgency or social proof?
- Which CTAs get more clicks?
- How does copy perform during promotions?
- What's the revenue difference between top and average performers?

**Example:**
- Elite headline: "Join 5k+ customers - Save 20%" → $12,000 revenue
- Average headline: "Get 20% off today" → $5,000 revenue
- **Insight**: Social proof drives 2.4x more revenue

**Pro Tier Alternative:**
- No access to Variants performance page
- Basic analytics dashboard only
- Cannot filter by promo context
- Cannot analyze component-level performance

---

