# ResparQ AI System - Complete Guide
**Last Updated:** January 16, 2026  
**Version:** 2.0 (with Social Proof)

---

## Quick Navigation

- **[Full System Guide](./AI_SYSTEM_COMPLETE_GUIDE.md)** - This file (overview, evolution, genes)
- **[Pro vs Enterprise Comparison](./AI_PRO_VS_ENTERPRISE.md)** - Feature differences
- **[Technical Architecture](./AI_TECHNICAL_ARCHITECTURE.md)** - Code structure, APIs
- **[Social Proof Documentation](./SOCIAL_PROOF_TECHNICAL_DOCS.md)** - Social proof system

---

## System Overview

ResparQ uses a **genetic algorithm** + **Bayesian statistics** to automatically optimize exit-intent modals.

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

