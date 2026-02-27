# Repsarq AI System - Complete Guide
**Last Updated:** January 19, 2026
**Version:** 2.1 (with Promotional Intelligence & Variant Analytics)

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
- **Generations** = Evolution cycles
- **Fitness** = Profit per impression
- **Selection** = Best survive, poor die
- **Breeding** = Top performers create offspring
- **Mutation** = Random changes for exploration

### The Flow
```
User Exits → AI Detects → Baseline Selected → Variant Selected (Thompson Sampling)
→ Social Proof Applied → Modal Shown → Impression Recorded → User Interacts
→ Evolution Cycle (every 100 impressions) → Champion Detection
```

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
| urgency | Time pressure | true, false |

### Gene Pools Structure

Each baseline has separate pools for regular and social proof genes:
```javascript
conversion_with_discount: {
  offerAmounts: [10, 15, 20, 25],
  
  headlines: [
    'Wait! Get {{amount}}% off before you go',
    'Your exclusive {{amount}}% discount is ready'
  ],
  
  headlinesWithSocialProof: [
    '{{social_proof_count}} customers claimed this {{amount}}% off',
    'Rated {{rating}} stars - get {{amount}}% off now'
  ],
  
  // Same pattern for subheads
}
```

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

## Four AI Modes

### Mode Selection
```javascript
if (aggression === 0) return 'pure_reminder';
if (aiGoal === 'revenue') {
  return propensityScore < 70 ? 'revenue_with_discount' : 'revenue_no_discount';
} else {
  return propensityScore < 70 ? 'conversion_with_discount' : 'conversion_no_discount';
}
```

### 1. Revenue with Discount
- Goal: Increase cart size
- Example: "Add $25 more, save $10"
- When: Low propensity, revenue mode

### 2. Revenue without Discount
- Goal: Increase cart size
- Example: "You're building a great cart!"
- When: High propensity, revenue mode

### 3. Conversion with Discount
- Goal: Convert immediately
- Example: "Get 15% off before you go"
- When: Low propensity, conversion mode

### 4. Conversion without Discount
- Goal: Convert immediately
- Example: "Rated 4.8★ by verified buyers"
- When: High propensity, conversion mode

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

