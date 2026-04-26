# Campaign & A/B Testing System Architecture

## Problem Statement

Traditional A/B testing tools let you test anything against anything, leading to meaningless comparisons:
- Exit intent modal vs 30-second delay modal (different audiences)
- Cart page modal vs product page modal (different contexts)
- 10% off vs $10 off on different triggers (incomparable)

**Result:** Merchants get confused data and can't make informed decisions.

---

## Solution: Two-Level System

### LEVEL 1: CAMPAIGNS
Business-level comparison of different strategies

### LEVEL 2: A/B TESTS
Statistical testing within a single strategy

---

## Campaign Entity

### Definition
A **Campaign** = Complete modal configuration with consistent trigger, timing, and audience

### Components
```javascript
{
  id: "campaign_1",
  name: "Exit Intent Offers",
  status: "active",
  
  // Trigger configuration (consistent for all variants)
  trigger: {
    type: "exit_intent",        // or "time_delay", "scroll_depth", "cart_abandonment"
    timing: null,               // e.g., 30 (seconds) for time_delay
    scrollPercent: null,        // e.g., 50 (%) for scroll_depth
    pageType: "cart"            // "all", "cart", "product", "collection"
  },
  
  // Variants (for A/B testing within campaign)
  variants: [
    {
      id: "variant_control",
      name: "Control - 10% Off",
      isControl: true,
      trafficPercent: 33,
      offer: {
        type: "discount_percentage",
        value: 10,
        discountCode: "EXIT10",
        text: "Get 10% off your order!",
        ctaText: "Claim Discount"
      },
      design: {
        // Modal styling
      }
    },
    {
      id: "variant_a",
      name: "Variant A - 15% Off",
      isControl: false,
      trafficPercent: 33,
      offer: {
        type: "discount_percentage",
        value: 15,
        discountCode: "EXIT15",
        text: "Get 15% off your order!",
        ctaText: "Claim Discount"
      },
      design: {
        // Modal styling
      }
    }
  ],
  
  // Analytics (aggregated across all variants)
  analytics: {
    impressions: 1500,
    clicks: 180,
    conversions: 42,
    revenue: 1250,
    
    // Calculated metrics
    conversionRate: 0.028,          // conversions / impressions
    revenuePerImpression: 0.83,     // revenue / impressions
    averageOrderValue: 29.76        // revenue / conversions
  },
  
  // Test status
  test: {
    isRunning: true,
    startDate: "2024-12-01",
    targetSampleSize: 100,           // conversions per variant
    daysRemaining: 9,
    confidenceLevel: 0.58
  }
}
```

---

## Campaign Comparison Metrics

### Primary Metric: Revenue per Impression (RPV)
```javascript
RPV = Total Revenue / Total Impressions
```

**Why:** Normalizes for different impression volumes. Shows efficiency regardless of reach.

**Example:**
- Exit Intent: $1,250 revenue / 100 impressions = $12.50 RPV
- Cart Delay: $900 revenue / 500 impressions = $1.80 RPV
- **Insight:** Exit intent is 7x more efficient per person reached

### Secondary Metrics

**Total Revenue**
```javascript
Total Revenue = Sum of all order values using campaign's discount codes
```
Shows absolute business impact.

**Conversion Rate**
```javascript
Conversion Rate = Conversions / Impressions
```
Shows effectiveness at converting viewers.

**Average Order Value**
```javascript
AOV = Revenue / Conversions
```
Shows typical cart size captured.

---

## A/B Test Entity

### Definition
An **A/B Test** = Multiple variants within a single campaign that share identical trigger/audience

### What Can Be Tested
✅ **Offer amount:** 10% vs 15% vs 20% off
✅ **Offer type:** Percentage vs fixed amount discount
✅ **Copy:** Headlines, descriptions, urgency language
✅ **CTA text:** "Claim Discount" vs "Get My Code" vs "Save Now"
✅ **Design:** Button colors, modal styles, layouts

### What Cannot Be Tested
❌ **Trigger type:** Exit intent vs time delay (different audiences)
❌ **Timing:** 10-second delay vs 30-second delay (different engagement points)
❌ **Pages:** Cart page vs product page (different contexts)
❌ **Targeting:** New visitors vs returning customers (different segments)

**Why:** These change WHO sees the modal, making results incomparable.

---

## Traffic-Based Recommendations

### Calculation Logic

```javascript
function calculateRecommendedVariants(monthlyTraffic, exitIntentRate = 0.05) {
  const monthlyExitIntentShows = monthlyTraffic * exitIntentRate;
  const avgConversionRate = 0.10; // 10% industry average
  const monthlyConversions = monthlyExitIntentShows * avgConversionRate;
  
  const minSampleSize = 100; // conversions per variant for 95% confidence
  const maxVariants = Math.floor(monthlyConversions / minSampleSize);
  
  // Cap at 3 variants + control (4 total)
  return Math.min(maxVariants, 3);
}

// Examples:
// 3,000 monthly visitors → 150 shows → 15 conversions → 0 variants (control only)
// 8,000 monthly visitors → 400 shows → 40 conversions → 0 variants (control only)
// 12,000 monthly visitors → 600 shows → 60 conversions → 0 variants (needs more traffic)
// 25,000 monthly visitors → 1,250 shows → 125 conversions → 1 variant (A/B test)
// 50,000 monthly visitors → 2,500 shows → 250 conversions → 2 variants (A/B/C test)
// 100,000+ monthly visitors → 5,000+ shows → 500+ conversions → 3 variants (A/B/C/D test)
```

### Traffic Splits

**2 options (Control + 1 variant):**
```
Control: 50%
Variant A: 50%
```

**3 options (Control + 2 variants):**
```
Control: 33%
Variant A: 33%
Variant B: 34%
```

**4 options (Control + 3 variants):**
```
Control: 25%
Variant A: 25%
Variant B: 25%
Variant C: 25%
```

---

## Statistical Significance Tracking

### Chi-Square Test for Conversion Rate

```javascript
function calculateChiSquare(variantA, variantB) {
  const totalA = variantA.impressions;
  const successA = variantA.conversions;
  const failureA = totalA - successA;
  
  const totalB = variantB.impressions;
  const successB = variantB.conversions;
  const failureB = totalB - successB;
  
  const totalSuccess = successA + successB;
  const totalFailure = failureA + failureB;
  const totalTotal = totalA + totalB;
  
  const expectedSuccessA = (totalA * totalSuccess) / totalTotal;
  const expectedFailureA = (totalA * totalFailure) / totalTotal;
  const expectedSuccessB = (totalB * totalSuccess) / totalTotal;
  const expectedFailureB = (totalB * totalFailure) / totalTotal;
  
  const chiSquare = 
    Math.pow(successA - expectedSuccessA, 2) / expectedSuccessA +
    Math.pow(failureA - expectedFailureA, 2) / expectedFailureA +
    Math.pow(successB - expectedSuccessB, 2) / expectedSuccessB +
    Math.pow(failureB - expectedFailureB, 2) / expectedFailureB;
  
  return chiSquare;
}

function isSignificant(chiSquare, degreesOfFreedom = 1) {
  // For 95% confidence, df=1, critical value = 3.841
  return chiSquare > 3.841;
}
```

### Confidence Level Display

```javascript
function calculateConfidence(variantA, variantB) {
  const chiSquare = calculateChiSquare(variantA, variantB);
  
  // Map chi-square to confidence percentage (simplified)
  if (chiSquare < 1) return 0.50; // 50%
  if (chiSquare < 2) return 0.65; // 65%
  if (chiSquare < 3) return 0.80; // 80%
  if (chiSquare < 3.841) return 0.90; // 90%
  return 0.95; // 95% - statistically significant
}
```

---

## UI States

### Campaign Dashboard

```
🎯 Your Campaigns

[+ New Campaign]

────────────────────────────────

Exit Intent Offers
Active • 2 variants testing

Revenue: $1,250 (30 days)
RPV: $12.50 per impression
Conversion: 2.8%

Test Progress: Day 5 of 14 (64% confident)

[View Details] [Pause] [Archive]

────────────────────────────────

Cart Abandonment Recovery  
Active • Single offer

Revenue: $900 (30 days)
RPV: $1.80 per impression
Conversion: 6.0%

[View Details] [Start A/B Test] [Archive]

────────────────────────────────

💡 Tip: Run multiple campaigns targeting different 
behaviors. They work together, not against each other.

[Compare Campaigns]
```

### Campaign Detail - Test Running

```
Exit Intent Offers

🎯 Trigger: Exit intent on cart page
📊 Test Status: Running (Day 5 of 14)

Your site gets ~12,000 visitors/month
Recommended: Test up to 1 variant

────────────────────────────────

Test Progress

Need 100 conversions per variant for 95% confidence
Current confidence: 64% ⚠️ Keep running

Control - 10% Off
• Impressions: 248
• Conversions: 18
• Revenue: $524
• Conversion rate: 7.3%

Variant A - 15% Off
• Impressions: 252  
• Conversions: 24
• Revenue: $642
• Conversion rate: 9.5% (+30% vs control)

Status: Not enough data yet. Keep running for 9 more days.

[View Detailed Stats] [Stop Test Early] [Extend Test]

────────────────────────────────

💡 Both variants use exit intent on cart page, 
so results are directly comparable.
```

### Campaign Detail - Test Complete

```
✅ Test Complete - Clear Winner

Exit Intent Offers • Results

Test ran for 14 days with 95% confidence

────────────────────────────────

Control - 10% Off
• Conversions: 147
• Revenue: $1,470
• Conversion rate: 7.4%
• RPV: $7.35

Variant A - 15% Off ⭐ WINNER
• Conversions: 178
• Revenue: $1,602 (+9% vs control)
• Conversion rate: 8.9% (+20% vs control)
• RPV: $8.01 (+9% vs control)

────────────────────────────────

🎉 Variant A won with 95% confidence

Estimated impact: +$132/month if you keep using it

[Make Variant A Permanent] [Run Another Test] [Archive Results]
```

### Campaign Comparison View

```
Compare Campaigns

Selected: 2 campaigns

────────────────────────────────

                    Exit Intent    Cart Delay
────────────────────────────────────────────
Revenue             $1,602         $900
Impressions         2,000          5,000
Conversions         178            300
Conv. Rate          8.9%           6.0%
RPV                 $0.80 ⭐       $0.18
AOV                 $9.00          $3.00

────────────────────────────────

💡 Analysis

Exit intent is 4.4x more efficient (RPV), but 
cart delay reaches 2.5x more people.

Exit intent captures higher-value carts ($9 AOV 
vs $3 AOV), suggesting it catches customers who 
were close to purchasing.

Recommendation: Keep both campaigns running. 
They complement each other.

[View Exit Intent] [View Cart Delay] [Export Report]
```

---

## Database Schema

### Campaigns Table (Metafield)
```javascript
{
  namespace: "exit_intent",
  key: "campaigns",
  value: JSON.stringify([
    {
      id: "campaign_1",
      name: "Exit Intent Offers",
      status: "active",
      trigger: {...},
      variants: [...],
      analytics: {...},
      test: {...},
      createdAt: "2024-12-01",
      updatedAt: "2024-12-12"
    }
  ])
}
```

### Analytics Table (Separate Metafield per Campaign)
```javascript
{
  namespace: "exit_intent_analytics",
  key: "campaign_1",
  value: JSON.stringify({
    // Daily breakdown for charting
    daily: [
      {
        date: "2024-12-01",
        impressions: 100,
        clicks: 12,
        conversions: 3,
        revenue: 89.50,
        variants: {
          control: {...},
          variant_a: {...}
        }
      }
    ],
    
    // Lifetime totals
    lifetime: {
      impressions: 2000,
      clicks: 240,
      conversions: 178,
      revenue: 1602
    }
  })
}
```

---

## Implementation Priority

### Phase 1: Campaign Foundation
1. Create campaign entity structure
2. Single campaign with single offer (no testing yet)
3. Track impressions, clicks, conversions, revenue per campaign
4. Campaign dashboard with RPV metric

### Phase 2: A/B Testing
1. Add variant support to campaign entity
2. Traffic routing logic (random assignment)
3. Statistical significance calculation
4. Test progress UI
5. Winner declaration UI

### Phase 3: Campaign Comparison
1. Multi-select campaign comparison
2. Side-by-side metrics
3. Automated insights ("7x more efficient")
4. Export/reporting

---

## Key User Flows

### Creating First Campaign
1. Click "New Campaign"
2. Choose trigger: Exit Intent
3. Set timing: Cart page only
4. Configure offer: 10% off
5. Preview modal
6. Launch campaign
7. See: "Campaign active - collecting data"

### Starting A/B Test
1. Open campaign detail
2. Click "Start A/B Test"
3. System checks traffic: "You can test 1 variant"
4. Click "Add Variant"
5. Change offer to 15% off
6. System shows: "Results in 14 days with 95% confidence"
7. Launch test
8. Track progress daily

### Completing Test
1. System detects 100+ conversions per variant
2. Calculates statistical significance
3. Shows banner: "Test complete - view results"
4. User reviews: Variant A won
5. User clicks: "Make Variant A permanent"
6. Campaign updated, control retired
7. Option to archive or start new test

---

## Marketing Positioning

**Headline:**
"Test What Actually Matters"

**Body:**
"Other apps let you A/B test anything—even things that aren't comparable. We guide you to test correctly:

• Compare campaigns by efficiency (which strategy works best?)
• Test offers within campaigns (which offer converts best?)
• Get clear answers with statistical confidence

No confusion. No meaningless data. Just actionable insights."

---

*Last Updated: December 12, 2024*
