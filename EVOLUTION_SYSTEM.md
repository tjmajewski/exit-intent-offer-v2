# Evolution System - Repsarq AI

Deep dive into the genetic algorithm powering Repsarq's AI-driven variant optimization system.

---

## Overview

The **Evolution System** is Repsarq's Enterprise-tier feature that automatically generates, tests, and optimizes exit intent modal variants using a genetic algorithm. Unlike traditional A/B testing which compares 2-3 manually-created options, the Evolution System:

- **Generates** a population of 10+ variants automatically
- **Tests** them simultaneously with real customers
- **Kills** poor performers every cycle (5 minutes)
- **Breeds** winners to create improved variants
- **Evolves** over generations toward maximum performance

**Result:** Merchants get continuously improving modals without manual optimization.

---

## Core Concepts

### 1. Genes

A **gene** is a heritable trait that defines modal appearance or behavior.

**Content Genes:**
- `headline` - Main modal headline text
- `subhead` - Supporting text below headline
- `ctaText` - Call-to-action button text
- `offerAmount` - Discount percentage or fixed amount
- `urgencyLevel` - Urgency messaging intensity (`low`, `medium`, `high`)

**Visual Genes:**
- `colorScheme` - Color palette (`purple`, `green`, `blue`, `gradient`)
- `layout` - Modal positioning (`centered`, `bottom`, `side`)
- `buttonStyle` - CTA button styling (`rounded`, `sharp`, `pill`)
- `animation` - Entry animation (`fade`, `slide`, `bounce`)
- `typography` - Font styling (`modern`, `classic`, `bold`)

**Example Variant Genome:**
```javascript
{
  headline: "Wait! Don't miss out on 15% off",
  subhead: "Complete your order in the next 10 minutes",
  ctaText: "Claim My Discount",
  offerAmount: 15,
  urgencyLevel: "high",
  colorScheme: "purple",
  layout: "centered",
  buttonStyle: "rounded",
  animation: "fade",
  typography: "modern"
}
```

---

### 2. Baselines

A **baseline** defines the fitness function (what to optimize for).

**Available Baselines:**
- `revenue_with_discount` - Maximize total revenue (includes discount costs)
- `revenue_no_discount` - Maximize revenue without discounting (reminder modals)
- `conversion_with_discount` - Maximize conversion count
- `conversion_no_discount` - Maximize conversions without discounts
- `profit` - Maximize profit (revenue minus discount amount)

Each shop can have multiple variant populations, one per baseline.

---

### 3. Population

A **population** is the set of all active variants for a given baseline.

**Population Parameters:**
- `size` - Number of variants per baseline (default: 10)
- `mutationRate` - Probability of random gene changes (default: 0.1 = 10%)
- `crossoverRate` - Probability of breeding between winners (default: 0.3 = 30%)
- `selectionPressure` - Percentage of population killed each cycle (default: 0.2 = 20%)

---

### 4. Generation

A **generation** is one complete evolution cycle.

**Cycle Triggers:**
- Minimum 100 new impressions since last cycle
- At least 5 minutes since last cycle
- Or manually triggered by merchant

**Generation Phases:**
1. **Evaluation** - Calculate fitness for all variants
2. **Selection** - Kill bottom 20% performers
3. **Breeding** - Crossover top 20% performers
4. **Mutation** - Apply random changes to offspring
5. **Population Replenishment** - Create new variants to maintain population size

---

## Genetic Algorithm Implementation

### File Location

**Core Logic:** `app/utils/variant-engine.js`

### Evolution Cycle Flow

```
Cron Job (every 5 minutes)
  ↓
Check: 100+ impressions since last cycle?
  ↓
YES → Start Evolution Cycle
  ↓
┌──────────────────────────────────────┐
│ 1. Fetch All Alive Variants          │
│    - Group by baseline                │
│    - Filter: status = 'alive'         │
└──────────────────────────────────────┘
  ↓
┌──────────────────────────────────────┐
│ 2. Calculate Fitness                  │
│    - revenue_with_discount:           │
│      fitness = profitPerImpression    │
│    - conversion_with_discount:        │
│      fitness = conversionRate         │
└──────────────────────────────────────┘
  ↓
┌──────────────────────────────────────┐
│ 3. Sort by Fitness                    │
│    - Rank variants high to low        │
└──────────────────────────────────────┘
  ↓
┌──────────────────────────────────────┐
│ 4. Selection (Kill Poor Performers)   │
│    - Bottom 20% → status = 'dead'     │
│    - Champions protected from death   │
└──────────────────────────────────────┘
  ↓
┌──────────────────────────────────────┐
│ 5. Crossover (Breed Winners)          │
│    - Top 20% randomly paired          │
│    - 50% genes from parent A          │
│    - 50% genes from parent B          │
│    - Create offspring variants        │
└──────────────────────────────────────┘
  ↓
┌──────────────────────────────────────┐
│ 6. Mutation                            │
│    - 10% chance per gene               │
│    - Replace gene with random value    │
│    - from gene pool                    │
└──────────────────────────────────────┘
  ↓
┌──────────────────────────────────────┐
│ 7. Repopulation                        │
│    - Create new random variants        │
│    - to maintain population size = 10 │
└──────────────────────────────────────┘
  ↓
┌──────────────────────────────────────┐
│ 8. Save New Generation                 │
│    - Increment generation number       │
│    - Reset impressionsSinceEvolution   │
│    - Update lastEvolutionCycle         │
└──────────────────────────────────────┘
```

---

## Code Examples

### 1. Initialize Variants for New Shop

```javascript
// app/utils/variant-engine.js

export async function initializeVariants(db, shopId) {
  const baselines = [
    'revenue_with_discount',
    'revenue_no_discount',
    'conversion_with_discount',
    'conversion_no_discount'
  ];

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  const populationSize = shop.populationSize || 10;

  for (const baseline of baselines) {
    // Create initial population
    for (let i = 0; i < populationSize; i++) {
      const genes = generateRandomGenes(baseline);

      await db.variant.create({
        data: {
          shopId: shopId,
          baseline: baseline,
          generation: 1,
          status: 'alive',
          ...genes
        }
      });
    }
  }
}

function generateRandomGenes(baseline) {
  const headlinePool = [
    "Wait! Don't miss out on {amount}% off",
    "Special offer just for you",
    "Complete your purchase and save {amount}%",
    "Don't leave without your discount"
  ];

  const subheadPool = [
    "Complete your order in the next {time} minutes",
    "This offer expires soon",
    "Exclusive discount for first-time customers",
    "Limited time offer"
  ];

  const ctaPool = [
    "Claim My Discount",
    "Get My Offer",
    "Complete My Order",
    "Save Now"
  ];

  const offerAmounts = baseline.includes('no_discount') ? [0] : [5, 10, 15, 20];

  return {
    headline: headlinePool[Math.floor(Math.random() * headlinePool.length)],
    subhead: subheadPool[Math.floor(Math.random() * subheadPool.length)],
    ctaText: ctaPool[Math.floor(Math.random() * ctaPool.length)],
    offerAmount: offerAmounts[Math.floor(Math.random() * offerAmounts.length)],
    urgencyLevel: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
    colorScheme: ['purple', 'green', 'blue', 'gradient'][Math.floor(Math.random() * 4)],
    layout: ['centered', 'bottom'][Math.floor(Math.random() * 2)],
    buttonStyle: ['rounded', 'sharp', 'pill'][Math.floor(Math.random() * 3)],
    animation: ['fade', 'slide', 'bounce'][Math.floor(Math.random() * 3)],
    typography: ['modern', 'classic', 'bold'][Math.floor(Math.random() * 3)]
  };
}
```

---

### 2. Run Evolution Cycle

```javascript
// app/cron/evolution-cycle.js

import db from "../db.server";
import { runEvolutionCycle } from "../utils/variant-engine";

export async function evolutionCronJob() {
  console.log('[Evolution] Starting cron job');

  // Get all shops with AI mode enabled
  const shops = await db.shop.findMany({
    where: {
      mode: 'ai',
      enabled: true,
      impressionsSinceEvolution: {
        gte: 100 // Minimum threshold
      }
    }
  });

  console.log(`[Evolution] Found ${shops.length} shops ready for evolution`);

  for (const shop of shops) {
    try {
      await runEvolutionCycle(db, shop.id);
      console.log(`[Evolution] ✓ Completed for shop ${shop.shopifyDomain}`);
    } catch (error) {
      console.error(`[Evolution] ✗ Failed for shop ${shop.shopifyDomain}:`, error);
    }
  }

  console.log('[Evolution] Cron job complete');
}
```

---

### 3. Calculate Fitness

```javascript
// app/utils/variant-engine.js

function calculateFitness(variant, baseline) {
  if (variant.impressions < 50) {
    // Not enough data yet, use neutral fitness
    return 0;
  }

  switch (baseline) {
    case 'revenue_with_discount':
      // Maximize profit per impression
      return variant.profitPerImpression;

    case 'revenue_no_discount':
      // Maximize revenue with no discount cost
      return variant.revenue / variant.impressions;

    case 'conversion_with_discount':
      // Maximize conversion rate
      return variant.conversions / variant.impressions;

    case 'conversion_no_discount':
      // Maximize conversions without discounting
      return (variant.offerAmount === 0)
        ? (variant.conversions / variant.impressions)
        : 0;

    case 'profit':
      // Maximize total profit
      return variant.profit / variant.impressions;

    default:
      return variant.profitPerImpression;
  }
}
```

---

### 4. Crossover (Breeding)

```javascript
// app/utils/variant-engine.js

function crossover(parentA, parentB) {
  const offspring = {
    generation: Math.max(parentA.generation, parentB.generation) + 1,
    parentIds: `${parentA.id},${parentB.id}`,
    baseline: parentA.baseline,
    status: 'alive'
  };

  // Randomly inherit genes from either parent
  const genes = [
    'headline', 'subhead', 'ctaText', 'offerAmount', 'urgencyLevel',
    'colorScheme', 'layout', 'buttonStyle', 'animation', 'typography'
  ];

  for (const gene of genes) {
    offspring[gene] = Math.random() < 0.5 ? parentA[gene] : parentB[gene];
  }

  return offspring;
}
```

---

### 5. Mutation

```javascript
// app/utils/variant-engine.js

function mutate(variant, mutationRate = 0.1) {
  const genes = ['headline', 'subhead', 'ctaText', 'offerAmount', 'urgencyLevel'];

  for (const gene of genes) {
    if (Math.random() < mutationRate) {
      // Mutate this gene
      variant[gene] = getRandomGeneValue(gene, variant.baseline);
    }
  }

  return variant;
}

function getRandomGeneValue(geneType, baseline) {
  const genePools = {
    headline: [
      "Wait! Don't miss out on {amount}% off",
      "Special offer just for you",
      "Complete your purchase and save"
    ],
    offerAmount: baseline.includes('no_discount') ? [0] : [5, 10, 15, 20],
    urgencyLevel: ['low', 'medium', 'high']
  };

  const pool = genePools[geneType];
  return pool[Math.floor(Math.random() * pool.length)];
}
```

---

## Segmentation

Variants can target specific customer segments:

**Segment Types:**
- `all` - All customers
- `mobile` - Mobile devices only
- `desktop` - Desktop/laptop only
- `mobile_paid` - Mobile + paid traffic
- `desktop_organic` - Desktop + organic traffic
- `high_value` - Cart value > $100
- `low_value` - Cart value < $30

**Segment Matching:**
```javascript
function selectVariantForCustomer(signals, variants) {
  // Filter variants by segment
  const matchingVariants = variants.filter(variant => {
    if (variant.segment === 'all') return true;
    if (variant.segment === 'mobile' && signals.deviceType === 'mobile') return true;
    if (variant.segment === 'mobile_paid' && signals.deviceType === 'mobile' && signals.trafficSource === 'paid') return true;
    // ... other segment logic
    return false;
  });

  // Randomly select from matching variants
  return matchingVariants[Math.floor(Math.random() * matchingVariants.length)];
}
```

---

## Manual Controls (Enterprise)

Enterprise merchants can manually intervene in the evolution process:

### Kill Variant

Mark a variant for immediate death (bypasses fitness evaluation).

```javascript
await db.variant.update({
  where: { id: variantId },
  data: {
    status: 'dead',
    killedAt: new Date()
  }
});
```

**Use Case:** Merchant dislikes the copy or branding, wants to remove immediately.

---

### Protect Variant

Mark a variant as "champion" to protect from death.

```javascript
await db.variant.update({
  where: { id: variantId },
  data: {
    status: 'champion'
  }
});
```

**Use Case:** Variant performs well, merchant wants to ensure it stays alive.

---

### Champion Variant

Promote a variant to champion status and kill all others in its baseline.

```javascript
// Set all others to dead
await db.variant.updateMany({
  where: {
    shopId: shopId,
    baseline: baseline,
    id: { not: variantId }
  },
  data: {
    status: 'dead',
    killedAt: new Date()
  }
});

// Set this one as champion
await db.variant.update({
  where: { id: variantId },
  data: {
    status: 'champion'
  }
});
```

**Use Case:** Merchant finds a winner and wants to stop testing for this baseline.

---

## Performance Metrics

### Variant Performance

**Key Metrics:**
- `impressions` - Total times shown
- `clicks` - Total CTA clicks
- `conversions` - Total orders placed
- `revenue` - Total order value
- `discountAmount` - Total discount given
- `profit` - Revenue minus discounts
- `profitPerImpression` - Profit divided by impressions (primary fitness metric)

**Derived Metrics:**
- `conversionRate` - conversions / impressions
- `clickThroughRate` - clicks / impressions
- `averageOrderValue` - revenue / conversions

---

## Testing & Debugging

### Manual Evolution Trigger

```bash
npm run evolution
```

### View Variants in Database

```bash
npm run prisma:studio
```

Navigate to `Variant` table, filter by `shopId` and `status = 'alive'`.

---

### Evolution Activity Feed

Dashboard shows recent evolution events:

```javascript
const events = await db.variantActivityLog.findMany({
  where: { shopId: shopRecord.id },
  orderBy: { createdAt: 'desc' },
  take: 20
});
```

**Event Types:**
- `variant_created` - New variant generated
- `variant_killed` - Poor performer eliminated
- `variant_bred` - Offspring created from parents
- `variant_mutated` - Random mutation applied
- `champion_promoted` - Variant promoted to champion

---

## Best Practices

### For Merchants

1. **Let it run** - Evolution needs 1000+ impressions to stabilize
2. **Monitor generations** - Should increase every 5-10 minutes (if traffic sufficient)
3. **Use manual controls sparingly** - AI performs better over time
4. **Check activity feed** - See what AI is doing
5. **Compare baselines** - Test revenue vs conversions to find best strategy

### For Developers

1. **Test with load** - Need real traffic volume to see evolution in action
2. **Monitor fitness calculations** - Ensure baseline logic is correct
3. **Check for outliers** - Variants with very few impressions can skew results
4. **Validate gene pools** - Ensure gene combinations make sense
5. **Watch for infinite loops** - Mutation should introduce novelty, not chaos

---

## Limitations & Future Improvements

### Current Limitations

- Minimum 100 impressions per cycle (can be slow for low-traffic shops)
- No multi-variant testing (only one variant shown per customer)
- Gene pools are hardcoded (not learned from data)
- No A/B testing statistical significance (uses simple fitness ranking)

### Future Enhancements

- **Dynamic gene pools** - Learn new headlines from successful merchants
- **Multi-armed bandits** - Explore/exploit tradeoff for faster convergence
- **Bayesian optimization** - Statistical significance testing
- **Transfer learning** - Apply learnings from one shop to others
- **Seasonal genes** - Automatically use holiday-themed copy during seasons

---

**Last Updated:** January 2026
**Status:** Production-ready
**File:** `app/utils/variant-engine.js`
**Cron:** Every 5 minutes via `app/cron/evolution-cycle.js`
