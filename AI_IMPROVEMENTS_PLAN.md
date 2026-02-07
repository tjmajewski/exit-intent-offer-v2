# ResparQ AI Improvements Plan

## Current State Summary

### What the AI Does Today

**Signals Collected (client-side, `collectCustomerSignals()` in exit-intent-modal.js):**
- Visit frequency (localStorage counter)
- Cart value + item count (from `/cart.js`)
- Device type (mobile/desktop via user agent)
- Account status (logged_in/guest via `window.Shopify.customer`)
- Traffic source (referrer parsing: paid/organic/social/direct/email)
- Time on site (session timer)
- Page views (sessionStorage counter)
- Has abandoned before (cookie check)
- Scroll depth (Enterprise only)

**Enterprise-only enriched signals (server-side, via `/api/enrich-signals`):**
- Propensity score
- Failed coupon attempt
- Exit page context (checkout vs cart)
- Cart hesitation (add/remove behavior)
- Cart age in minutes
- Purchase history count
- Customer lifetime value
- Product dwell time

**AI Decision Flow:**
1. Signals collected client-side
2. Sent to `/api/ai-decision`
3. Pro: `determineOffer()` scores signals (0-100), decides show/no-show, picks offer type/amount
4. Enterprise: `enterpriseAI()` uses propensity score + high-value signals for smarter decisions
5. Variant selected via Thompson Sampling from gene pool
6. Copy placeholders replaced and modal shown

**Gene Pools (5 baselines):**
- `revenue_with_discount` — threshold offers to increase cart size
- `revenue_no_discount` — encouragement without discount
- `conversion_with_discount` — percentage/fixed discounts to convert
- `conversion_no_discount` — social proof only
- `pure_reminder` — simple cart reminders

**Evolution System:**
- Variants have: headline, subhead, CTA, offer amount, redirect, urgency, color scheme, layout, button style, animation, typography
- Thompson Sampling selects which variant to show
- Variants are born, evolve (crossover), and die based on performance
- Tracks: impressions, clicks, conversions, revenue, profit per impression

---

## Improvement Areas

### 1. Segment-Aware Variant Selection (HIGH IMPACT)

**Problem:** The AI picks the same variant pool for everyone. A returning loyal customer sees the same copy as a first-time visitor from a Facebook ad.

**Solution:** Create segment-specific variant performance tracking and selection.

**Segments to implement:**

| Segment | Definition | Why Different |
|---------|-----------|---------------|
| `new_visitor` | visitFrequency === 1 | Needs trust-building copy ("Join thousands of...") |
| `returning_browser` | visitFrequency > 1, no purchases | Needs urgency ("Still thinking about it?") |
| `loyal_customer` | purchaseHistoryCount > 0 | Needs exclusivity ("As a valued customer...") |
| `price_sensitive` | failedCouponAttempt OR cartHesitation > 1 | Needs clear savings messaging |
| `high_value_cart` | cartValue > 2x store average | Needs premium tone, smaller % discount |
| `mobile_shopper` | deviceType === 'mobile' | Needs shorter copy, bigger buttons |
| `paid_traffic` | trafficSource === 'paid' | Already pre-qualified, smaller discount needed |

**Implementation:**
- Add `segment` field to AI decision request
- Track variant performance per-segment in `VariantImpression` table (already has `segment` column)
- Thompson Sampling should pull stats filtered by segment, not globally
- Different gene pools can weight differently per segment (e.g., urgency=true more likely for price_sensitive)

**Files to modify:**
- `app/utils/variant-engine.js` — `selectVariant()` should filter by segment
- `app/utils/ai-decision.server.js` — Compute segment from signals and pass through
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` — Include segment in tracking calls
- `app/routes/apps.exit-intent.api.ai-decision.jsx` — Pass segment to variant selection

---

### 2. Copy Personalization Tokens (HIGH IMPACT)

**Problem:** Gene pool copy is generic. "Wait! Get 15% off before you go" works but doesn't reference the customer's actual situation.

**Solution:** Add new dynamic placeholders that reference the customer's context.

**New placeholders:**

| Placeholder | Source | Example Output |
|-------------|--------|----------------|
| `{{cart_item_name}}` | First item in cart | "Don't leave your Blue Snowboard behind!" |
| `{{cart_item_count}}` | Cart item count | "You have 3 items waiting" |
| `{{cart_total}}` | Cart total formatted | "Your $147 order is almost complete" |
| `{{time_on_site}}` | Session timer | "You've been browsing for 5 minutes" |
| `{{customer_first_name}}` | Shopify customer object | "Hey Sarah, before you go..." |
| `{{savings_amount}}` | Calculated discount | "Save $22 on your order today" |

**Implementation:**
- Cart data already available from `/cart.js` call in `collectCustomerSignals()`
- Customer name available from `window.Shopify.customer.first_name` (for logged-in users)
- Add placeholders to gene pools alongside existing ones
- Replace in `showModalWithOffer()` alongside existing `{{amount}}`, `{{threshold}}` etc.

**New gene pool headlines (examples):**
```javascript
// conversion_with_discount
"Don't leave {{cart_item_name}} behind — save {{amount}}%"
"Hey {{customer_first_name}}, here's {{amount}}% off your {{cart_item_count}} items"
"Your {{cart_total}} order deserves {{amount}}% off"

// revenue_with_discount
"Add {{threshold_remaining}} more to save on {{cart_item_name}} and more"
"{{customer_first_name}}, you're {{percent_to_goal}}% to unlocking {{amount}} off"
```

**Fallback logic:** If a placeholder can't be resolved (e.g., guest user for `{{customer_first_name}}`), fall back to generic copy. The variant engine should track whether personalized vs generic copy converts better per segment.

**Files to modify:**
- `app/utils/gene-pools.js` — Add personalized headline/subhead variants
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` — Expand replacement logic in `showModalWithOffer()` to include new placeholders, pass cart data through

---

### 3. Discount Ladder / Escalation (MEDIUM IMPACT)

**Problem:** The AI makes a single offer. If the customer closes the modal, that's it — the interaction is lost. There's no second chance with a better offer.

**Solution:** Implement a 2-step escalation for customers who dismiss the first modal.

**How it works:**
1. First modal: Standard AI-calculated offer (e.g., 10% off)
2. Customer closes modal → set a flag, don't count as "shown" for session blocking
3. On next exit intent trigger (or after 30s delay): Show escalated offer (e.g., 15% off with "Last chance!" urgency)
4. Second dismiss = done, mark as shown for session

**Rules:**
- Maximum 2 shows per session (never 3)
- Escalation amount: +5% for percentage, +$5 for fixed, lower threshold by 10% for threshold offers
- Second modal must have different copy (not just higher number) — urgency framing
- Only escalate if merchant's aggression is >= 5 (conservative merchants opted out)
- Track escalation conversion rate separately to measure if it's worth it

**Escalation gene pool (new):**
```javascript
escalation: {
  headlines: [
    "Okay, how about {{amount}}% off?",
    "Last chance — {{amount}}% off expires now",
    "We really don't want you to miss out"
  ],
  subheads: [
    "This is our best offer — it won't come back",
    "Exclusive one-time deal just for you",
    "{{social_proof_count}} customers saved with this offer today"
  ],
  ctas: [
    "Fine, Take My Discount",
    "Claim {{amount}}% Off Now",
    "Last Chance — Save Now"
  ]
}
```

**Files to modify:**
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` — Track dismiss, re-trigger logic, separate session key for escalation
- `app/utils/gene-pools.js` — Add escalation gene pool
- `app/utils/ai-decision.server.js` — Accept `isEscalation` flag, return boosted offer

---

### 4. Time-of-Day & Day-of-Week Optimization (MEDIUM IMPACT)

**Problem:** The AI treats Monday morning and Saturday night the same. Shopping behavior varies significantly by time.

**Solution:** Track conversion rates by time bucket and adjust offer aggressiveness.

**Time buckets:**
- Morning (6am–12pm) — browsing, comparison shopping
- Afternoon (12pm–5pm) — lunch break impulse buys
- Evening (5pm–10pm) — peak shopping hours
- Late night (10pm–6am) — high intent, lower volume

**Day buckets:**
- Weekday vs Weekend
- Payday windows (1st and 15th of month ± 2 days)

**Implementation:**
- Add `hourOfDay` and `dayOfWeek` to signals sent to API
- Store in VariantImpression table (add columns or include in existing JSON)
- After 2+ weeks of data, calculate conversion rate multipliers per time bucket
- Adjust the score in `determineOffer()`:
  - High-conversion time bucket → reduce discount (they'd buy anyway)
  - Low-conversion time bucket → increase discount or suppress (don't waste)

**Files to modify:**
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` — Add time signals to `collectCustomerSignals()`
- `app/utils/ai-decision.server.js` — Use time-based multiplier in scoring
- `prisma/schema.prisma` — Add time columns to VariantImpression (or use existing JSON field)

---

### 5. Product Category Awareness (MEDIUM IMPACT)

**Problem:** The AI doesn't know what's in the cart beyond total value and item count. A $100 cart of consumables (replenishable) is different from a $100 cart with a single luxury item.

**Solution:** Pass product type/category info from the cart and adjust strategy.

**Categories and strategies:**

| Category Signal | Strategy |
|----------------|----------|
| High-ticket single item (>$200) | Already implemented — encourage accessories |
| Consumables / replenishables | Lower discount, mention "stock up" or subscription |
| Gift items (detected by gift wrap, "gift" in notes) | Urgency: "Don't let them down!" |
| Sale/clearance items | Already bargain hunting — smaller additional discount |
| Full-price items | Standard discount strategy |
| Mixed cart | Reference the most expensive item in personalized copy |

**Implementation:**
- The `/cart.js` response already includes `product_type`, `tags`, `title`, and `price` per item
- Parse in `collectCustomerSignals()` and send as `cartComposition` signal
- Use in copy personalization (reference the most expensive item by name)
- Adjust discount strategy based on category mix

**Files to modify:**
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` — Parse product data from cart, send to API
- `app/utils/ai-decision.server.js` — Use product categories in offer calculation

---

### 6. Smarter "Don't Show" Logic (HIGH IMPACT, LOW EFFORT)

**Problem:** The current don't-show logic is basic score thresholds. Some cases where showing a modal actively hurts conversions aren't covered.

**Suppress the modal when:**

| Condition | Reason |
|-----------|--------|
| Customer just added an item < 10 seconds ago | They're actively shopping — don't interrupt |
| Customer is on a product page (not cart/checkout) | They haven't committed to buying yet — exit intent here is just browsing |
| Customer has converted from a ResparQ modal before (cookie/localStorage) | Returning customers who already got a discount — don't train them to always expect one |
| Cart has only free/gift-with-purchase items | No margin to discount |
| Customer arrived from an email campaign with a discount code | They already have an offer — don't stack |

**Implementation:**
- Most of these are client-side checks in `exit-intent-modal.js` before calling the API
- Check `document.referrer` or URL params for email campaign UTMs with discount codes
- Check localStorage for previous ResparQ conversion flag
- Check current page path (only show on cart-related pages)

**Files to modify:**
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` — Add pre-API suppression checks

---

### 7. Profit-Optimized Discounting (HIGH IMPACT)

**Problem:** The AI optimizes for conversion rate or revenue, but doesn't account for the actual cost of the discount. A 25% discount that converts at 10% may be less profitable than a 10% discount that converts at 6%.

**Solution:** Track and optimize for profit per impression (revenue minus discount cost).

**The metric: Profit Per Impression (PPI)**
```
PPI = (conversions × avg_order_value - total_discounts_given) / total_impressions
```

**Already partially implemented:** The variant model has `profitPerImpression` field and `profit_per_impression` baseline in gene pools. But the actual calculation and optimization against it needs strengthening.

**What to improve:**
- In the evolution system, when evaluating variant fitness, weight PPI higher than raw conversion rate
- When the AI calculates offer amount, factor in the store's average margin (new setting)
- Add a "margin protection" setting: "Never discount more than X% of my margin"
- Track `discountAmount` on every `VariantImpression` that converts, not just on `DiscountOffer`

**New merchant setting:**
```
Average Margin: ___% (default: 50%)
```
This lets the AI know that a 20% discount on a 30% margin product is terrible (eats 2/3 of profit), while a 20% discount on a 70% margin product is fine.

**Files to modify:**
- `app/utils/ai-decision.server.js` — Factor margin into offer calculation
- `app/utils/variant-engine.js` — Weight PPI in Thompson Sampling fitness
- `app/routes/app.settings.jsx` — Add margin setting to AI Settings tab
- `prisma/schema.prisma` — Add `averageMargin` to Shop model

---

### 8. Cross-Store Meta-Learning (ENTERPRISE, LONG-TERM)

**Problem:** Every new store starts from zero. The AI has to re-learn everything from scratch.

**Solution:** Aggregate anonymized learnings across all ResparQ stores to bootstrap new ones.

**What to share (anonymized):**
- Which headline patterns convert best for each segment
- Optimal discount percentages by cart value range
- Best performing time-of-day windows
- Which CTA text drives most clicks
- Urgency on/off performance by segment

**What NOT to share:**
- Store identity, domain, customer data
- Specific cart contents or product names
- Revenue numbers

**Implementation approach:**
- Already have `contributeToMetaLearning` flag in shop settings
- Create a `MetaLearning` table that stores aggregated insights
- On each evolution cycle, contributing stores push anonymized variant performance
- New stores pull the meta-learned priors as starting weights for Thompson Sampling (instead of flat priors)

**This means a new Enterprise store's AI is immediately informed by what works across all other stores — massive cold-start advantage.**

**Files to modify:**
- `app/utils/meta-learning.js` — Already exists, needs implementation
- `app/cron/evolution-cycle.js` — Push anonymized data after each cycle
- `app/utils/variant-engine.js` — Pull meta-learned priors for new stores
- `prisma/schema.prisma` — MetaLearning model

---

## Priority Order

| Priority | Improvement | Impact | Effort | Dependencies |
|----------|-------------|--------|--------|-------------|
| 1 | Smarter "Don't Show" Logic (#6) | High | Low | None |
| 2 | Segment-Aware Variant Selection (#1) | High | Medium | None |
| 3 | Copy Personalization Tokens (#2) | High | Medium | None |
| 4 | Profit-Optimized Discounting (#7) | High | Medium | New merchant setting |
| 5 | Discount Ladder / Escalation (#3) | Medium | Medium | None |
| 6 | Time-of-Day Optimization (#4) | Medium | Medium | 2+ weeks of data |
| 7 | Product Category Awareness (#5) | Medium | Medium | None |
| 8 | Cross-Store Meta-Learning (#8) | High | High | Multiple Enterprise stores |

**Recommended build order:** Start with #6 (quick win), then #1 and #2 together (they complement each other), then #7 (makes the evolution system smarter). #3 and #4 are good follow-ups. #5 and #8 are longer-term.

---

## Signals Not Yet Collected (Future Data Sources)

These signals would improve AI decisions but require additional Shopify API integration or storefront tracking:

| Signal | Source | Value |
|--------|--------|-------|
| Wishlist activity | Shopify customer metafields or app | High intent — they saved items |
| Product review reading | Custom JS tracking on PDP | Research phase = higher intent |
| Search queries on site | Shopify search analytics | Shows what they're looking for |
| Previous discount usage | Order history via Admin API | Discount-dependent customers vs full-price buyers |
| Email signup status | Klaviyo/Mailchimp integration | Already in funnel = different approach |
| Geographic location | `Shopify.country` | Regional pricing sensitivity |
| Currency / purchasing power | `Shopify.currency.active` | Adjust absolute discount amounts |
| Inventory levels | Admin API product data | Low stock = real urgency, not fake |
| Collection browsing path | sessionStorage tracking | Shows consideration depth |

---

## Measuring Success

For each improvement, track these metrics before/after:

1. **Conversion rate** — % of impressions that convert
2. **Revenue per impression** — Total revenue / total impressions
3. **Profit per impression** — (Revenue - discount cost) / impressions
4. **Suppression rate** — % of potential shows that AI chose not to show
5. **Discount efficiency** — Average discount % given on converting impressions
6. **Time to first conversion** — For new stores, how fast do they see results

The goal is not just higher conversion rate — it's higher **profit per impression** with fewer wasted discounts.
