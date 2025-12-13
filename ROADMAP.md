# Exit Intent Offer - Product Roadmap

## Strategic Positioning

**Core Position:** "The Performance-First Exit Intent App for Merchants Who Want Sales, Not Subscribers"

**Key Differentiators:**
1. No email bloat - Just convert sales
2. Automatic discount application - One-click, no copy/paste
3. Revenue tracking - Show dollars recovered, not vanity metrics
4. Ultra-lightweight - <50kb, doesn't slow site
5. Flat pricing - Predictable, not pageview-based
6. Smart A/B testing - Statistical significance guidance
7. 5-minute setup - No complexity

---

## A/B Testing Framework

### Two-Level System

**LEVEL 1: CAMPAIGNS** (Business Comparison)
- Campaign = Complete modal with trigger, audience, and timing
- Compare campaigns by efficiency metrics (Revenue per Impression)
- Don't declare statistical "winners" - let merchants choose strategy
- Examples:
  - "Exit Intent - 10% Off"
  - "Cart Abandonment - Free Shipping"
  - "30-Second Delay - Gift Offer"

**LEVEL 2: TESTS** (Within Campaign)
- A/B Test = Variants within single campaign (same trigger/audience)
- Can test: Offer amount, offer type, copy, CTA, design
- Cannot test: Different triggers, timing, pages, audiences
- Declare statistical winners with confidence levels

### Traffic-Based Variant Recommendations

```
Minimum sample size per variant = 100 conversions
(industry standard for 95% confidence)

Monthly traffic → Recommended max variants

< 5,000 visitors/mo → 1 variant only (A vs B)
  - "Need 2+ weeks for reliable results"
  
5,000-15,000 visitors/mo → 2 variants (A vs B vs C)
  - "Results in 7-14 days"
  
15,000-30,000 visitors/mo → 3 variants (A vs B vs C vs D)
  - "Results in 5-10 days"
  
30,000+ visitors/mo → 3 variants (but faster results)
  - "Results in 3-5 days"
```

### Traffic Splits

- 2 variants: 50/50 split
- 3 variants (with control): 33/33/34 split
- 4 variants (with control): 25/25/25/25 split

### Key Metrics

**For Campaign Comparison:**
- Revenue per impression (RPV) - Primary metric
- Total revenue (volume)
- Conversion rate (effectiveness)
- Average order value (cart size)

**For A/B Tests:**
- Total revenue - Primary metric (since impressions are equal)
- Conversion rate
- Revenue per conversion
- Statistical confidence level

---

## Implementation Roadmap

### PHASE 1: CORE REVENUE FEATURES (Months 1-3)

#### Week 1-4: Automatic Discount Application ⭐ CRITICAL

**Goal:** One-click discount application with zero friction

**Technical Implementation:**
1. Add `write_discounts` scope to shopify.app.toml
2. Create discount codes via GraphQL Admin API when merchant saves offer
3. Store discount code in shop metafields (e.g., "EXIT10")
4. Update theme extension CTA to redirect with `?discount=CODE`
5. Set up ORDERS_CREATE webhook to track redemptions
6. Update analytics metafields with conversion + revenue data

**Files to Modify:**
- `shopify.app.toml` - Add discount scope
- `app/routes/app.settings.jsx` - Create discount code on save
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` - Auto-apply discount
- `app/routes/webhooks.orders.create.jsx` - Track order conversions
- `app/shopify.server.js` - Add webhook subscription

**Testing:**
1. Create discount in Settings → Should appear in Shopify Admin
2. Trigger modal → Click CTA → Should redirect to checkout with discount applied
3. Complete order → Webhook fires → Dashboard shows revenue

#### Week 1-4: Revenue Dashboard

**Updates Needed:**
- Display "Revenue Recovered" as hero metric
- Show Revenue per Impression (RPV)
- Track conversion funnel: impression → click → checkout → purchase
- Add conversion rate percentage

**Files to Modify:**
- `app/routes/app._index.jsx` - Update dashboard UI
- `app/routes/apps.exit-intent.track.jsx` - Already tracking impressions/clicks
- Webhook handler - Add conversion/revenue tracking

#### Week 5-8: Professional Templates

**Create 5 High-Converting Templates:**
1. Discount-focused (10%, 15%, 20% off)
2. Free shipping
3. Gift with purchase
4. Cart reminder ("You left items in your cart!")
5. Seasonal/urgency ("Limited time offer")

**Technical:**
- Pre-built modal designs with proven copy
- One-click selection in Settings
- Customize colors/text while maintaining structure

#### Week 5-8: One-Click Installation

**Goal:** "Live in 3 minutes" promise

**Features:**
- Auto-detect theme name and colors
- Pre-populate modal with store branding
- Instant preview before going live
- Guided setup flow with progress indicator

#### Week 9-12: Launch Preparation

**Tasks:**
1. Polish UI/UX across all pages
2. Fix any bugs from analytics/discount implementation
3. Create comparison marketing site
4. Test with 3-5 pilot stores
5. Gather testimonials and revenue recovery data
6. Prepare launch announcement

---

### PHASE 2: SMART A/B TESTING (Months 4-6)

#### Week 13-16: Traffic Calculator & Guidance

**Features:**
1. Pull monthly pageview data from Shopify
2. Calculate recommended max variants based on traffic
3. Show in-app guidance with expected timeline
4. Allow override but show warning
5. Educational tooltips explaining statistical significance

**Technical:**
- Query Shopify Analytics API for traffic data
- Build variant limit system in Settings
- Create UI components for recommendations

#### Week 17-20: A/B Test Builder

**Features:**
1. Simple test creation within campaigns
2. Test types:
   - Discount amount (10% vs 15% vs 20%)
   - Offer type (discount vs free shipping vs gift)
   - Copy variants (2-3 headlines)
3. Auto-calculate traffic split
4. Show "Results expected in X days"

**Technical:**
- Campaign entity with multiple variants
- Traffic routing logic (random assignment)
- Test metadata storage in metafields

#### Week 21-24: Statistical Significance & Results

**Features:**
1. Track conversions per variant
2. Calculate confidence level (Chi-square test)
3. Progress indicator: "67% confidence, need 6 more days"
4. Clear winner declaration when significant
5. Revenue comparison (not just conversion rate)
6. "Make winner permanent" button
7. Archive test results

**Technical:**
- Statistical significance calculation
- Test state management
- Winner promotion logic
- Historical test storage

---

### PHASE 3: TRAFFIC CONTROL & INTELLIGENCE (Months 7-9)

#### Week 25-28: Traffic Management

**Features:**
1. Traffic percentage slider: "Show to X% of exit-intent visitors"
2. Use cases: Margin protection, gradual rollout
3. Show impact: "Currently showing to 50% = ~2,500 visitors/mo"
4. Offer fatigue prevention (1x per customer per week)
5. Override options for merchants

#### Week 29-32: Cart Intelligence

**Features:**
1. Cart value-based offers (automatic scaling)
   - $0-50 cart → 10% off
   - $50-150 cart → Free shipping
   - $150+ cart → Gift with purchase
2. Auto-configure based on store AOV
3. Manual override available
4. Test different value tiers

#### Week 33-36: Historical Campaign Library

**Features:**
1. Archive old campaigns with complete results
2. Display: "Holiday 2024: $2,340 recovered"
3. "Reactivate" button for seasonal campaigns
4. Year-over-year comparison
5. Export reports

**Additional Polish:**
- White label option (Business plan)
- Custom CSS for advanced users
- Webhooks/API for integrations

---

## Technical Architecture Notes

### Current Stack
- React Router v7
- Shopify App Bridge
- Theme App Extensions
- GraphQL Admin API
- Shop Metafields for data persistence

### Key Files
- `app/routes/app._index.jsx` - Dashboard
- `app/routes/app.settings.jsx` - Settings page
- `app/routes/apps.exit-intent.track.jsx` - Analytics endpoint (app proxy)
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` - Storefront JavaScript
- `extensions/exit-intent-modal/snippets/exit-intent-modal.liquid` - Liquid template
- `shopify.app.toml` - App configuration

### App Proxy Pattern
```
Frontend: POST /apps/exit-intent/track
→ Shopify App Proxy
→ Backend: app/routes/apps.exit-intent.track.jsx
→ Update shop metafields
→ Return success/error
```

### Analytics Events
- `impression` - Modal shown
- `click` - CTA clicked
- `closeout` - Modal closed without action
- `conversion` - Order completed with discount code

---

## Competitive Positioning

### vs Wisepops/OptiMonk
"They want to replace your entire marketing stack. We just want to save abandoned carts."

### vs Privy
"Unlike all-in-one platforms that charge more as you grow, we keep it simple and affordable."

### vs Free Apps
"Free popup builders show modals. We recover revenue with automatic discounts and real analytics."

---

## Pricing Strategy

**Free Plan:**
- 1 modal
- 1,000 modal views/month
- Exit intent only
- Basic analytics

**Pro Plan: $19/mo**
- 3 modals
- Unlimited views
- All triggers
- Revenue tracking
- A/B testing (up to 3 variants)
- Priority support

**Business Plan: $49/mo**
- 5 modals
- Cart value intelligence
- Traffic % control
- Historical campaign library
- White label (remove branding)

**Rationale:** Flat rate (predictable), not pageview-based. Forces focus with modal limits. Better for small-medium stores.

---

## Success Metrics

### Product Metrics
- Revenue recovered per merchant (target: $500+/month)
- Conversion rate (target: 8-12%)
- Setup time (target: <5 minutes)
- Page speed impact (target: <50kb, <100ms)

### Business Metrics
- Monthly Recurring Revenue (MRR)
- Churn rate (target: <5%/month)
- Customer Acquisition Cost (CAC)
- Lifetime Value (LTV)

### Engagement Metrics
- % of merchants with active campaigns
- Average # campaigns per merchant
- A/B test completion rate
- Dashboard usage frequency

---

## Next Immediate Actions

1. **This Week:** Implement automatic discount code application
   - Add discount scope
   - Create discount codes programmatically
   - Test auto-apply at checkout
   - Set up order webhook

2. **Next Week:** Revenue tracking dashboard
   - Update analytics to track conversions + revenue
   - Build revenue recovery UI
   - Test end-to-end with real orders

3. **Following Weeks:** Templates + polish
   - Create 5 professional templates
   - Polish dashboard UI
   - Fix any bugs
   - Prepare for pilot testing

---

## Key Differentiators to Emphasize

1. **"Test What Actually Matters"** - Statistical significance guidance
2. **"No Email Bloat"** - Sales-focused, not list-building
3. **"One-Click Everything"** - Auto-apply discounts, instant setup
4. **"Revenue Not Vanity Metrics"** - Show dollars recovered
5. **"Smart by Default"** - Traffic-based recommendations, cart intelligence

---

*Last Updated: December 12, 2024*
