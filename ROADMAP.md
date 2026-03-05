# Repsarq Prioritized Roadmap
**Updated: March 5, 2026**
**App:** Exit Intent Modal with AI-Powered Cart Recovery

---

## CURRENT STATUS (March 2026)

The app is live, passed Shopify review fixes, and core functionality is solid:
- AI Decision Engine (13 signals), all triggers (exit intent, timer, cart value), discount codes (percentage + fixed), conversion tracking with cart attribute attribution, variant evolution system, promotional intelligence, custom CSS (Enterprise), mobile-first modal, Sentry monitoring, and usage-based billing are all built and working.
- Recent work (March 3) fixed conversion tracking attribution and checkout discount application for Checkout 2.0.
- Gift card offer type has backend stubs but is NOT fully functional (returns Shopify GID instead of redeemable code, cart add likely broken).

---

## REPRIORITIZED ROADMAP

### TIER 1: Polish & Revenue Essentials (Do Now — Week 1-2)
*These directly increase merchant value, reduce churn, and fix first impressions.*

#### 1. Settings Preview Modal — ~4 hours
**Status:** Dashboard preview works, Settings "Preview" button is broken.
**Why first:** This is the #1 thing merchants try after configuring settings. A broken preview makes the app feel unfinished. Low effort, high polish payoff.
- Live preview overlay using current form values (headline, body, CTA, colors)
- Desktop + mobile responsive preview
- AI mode shows placeholder copy with explanation
- No impression tracked
- Preview button near Save button, available on all settings tabs

#### 2. Upgrade Page Polish — ~2 hours
**Why:** Merchants who hit tier gates need a clear, compelling reason to upgrade. The current page is functional but could convert better.
- Clear tier comparison table with feature checkmarks
- "Current plan" indicator with visual highlight
- Pricing with annual discount option
- FAQ section addressing common objections
- Smooth upgrade CTA flow

#### 3. Bug Cleanup — ~4 hours
**What remains:**
- Plan navigation/persistence (#2 from original bug list) — investigate and fix
- Console error audit across all pages
- Mobile rendering edge cases
- Form validation edge cases
- Verify all tier gates work correctly (Starter/Pro/Enterprise)

#### 4. Countdown Timer in Modal ⭐ NEW — ~3 hours
**Why:** Urgency is the single highest-converting psychological trigger in e-commerce. A visible countdown ("This offer expires in 14:59") dramatically increases CTA click rates. Very simple to build, massive conversion lift. Every competitor that has this sees higher engagement.
- Configurable duration (5-30 minutes)
- Visual countdown displayed in modal
- Offer expires when timer hits zero (modal auto-closes or switches to reminder-only)
- Works with all offer types (percentage, fixed, free shipping)
- Enterprise/Pro feature

#### 5. Free Shipping Threshold Offer ⭐ NEW — ~5 hours
**Why:** Free shipping is the #1 conversion driver in e-commerce — often more effective than percentage discounts — and it costs merchants nothing in margin on orders above their threshold. "Add $12 more for free shipping!" is a proven AOV booster.
- New offer type: `freeShipping` alongside percentage/fixed
- Calculate gap between current cart value and threshold
- Dynamic messaging: "You're only $X away from free shipping!"
- Merchant-configurable threshold amount
- Option to auto-detect shop's existing free shipping rates via Shopify API
- No discount code needed — just redirects to checkout (shipping is free at that cart level)

---

### TIER 2: Prove ROI & Build Trust (Weeks 2-4)
*These prove value to merchants and build confidence to stay on paid plans.*

#### 6. Google Analytics 4 Events — ~3 hours
**Why:** Merchants live in GA4. If they can't see your modal's impact in their existing analytics workflow, they question whether it's working. Low effort, massive trust signal.
- Push events: `modal_shown`, `modal_clicked`, `modal_closed`, `discount_applied`, `conversion`
- Custom dimensions: variant_id, discount_amount, cart_value, offer_type
- Drop-in integration — just needs merchant's GA4 measurement ID in settings
- Works alongside existing impression/click tracking

#### 7. Gift Card Offer (Fix & Complete) — ~6 hours
**Why:** Gift cards are a unique offer type no competitor provides. The backend stubs exist but it's broken — `createGiftCard` returns a Shopify GID not a redeemable code, and the storefront modal's cart-add flow doesn't work. Fixing this unlocks a genuinely differentiating offer type.
- Fix `createGiftCard` to return the actual redeemable code (not GID)
- Proper storefront flow: generate gift card → display code in modal → customer applies at checkout
- Settings UI: gift card amount configuration
- Track gift card redemption in conversions
- Consider: gift card as "bonus" (spend $100, get $10 gift card for next visit) vs. instant discount

#### 8. Margin Protection — ~4 hours
**Why:** This is a unique differentiator that no competitor offers. Merchants fear discounts eating their margins. This feature prevents them from accidentally running money-losing promotions, which builds deep trust.
- Fetch product costs via Shopify Admin API (inventory cost field)
- "Minimum margin %" setting per shop
- AI checks margin before offering discount
- Falls back to reminder-only if discount would break margin floor
- Dashboard shows "margin preserved" metric

#### 9. Product Images in Modal ⭐ NEW — ~4 hours
**Why:** Showing the actual products in the customer's cart makes the modal personal and harder to dismiss. "You're leaving these behind..." with product thumbnails creates visual anchoring that plain text can't match.
- Fetch cart items with product images (already polling cart for value)
- Display first 3 products as small thumbnails in modal
- "Don't forget these items" or similar messaging
- Graceful fallback if images fail to load
- Consider mobile data: lazy-load, small thumbnails only

#### 10. Variant Tracking / Advanced Analytics — ~6 hours
**Why:** Pro/Enterprise merchants want to see which copy/offers perform best. Also a prerequisite for the Community Gene Pool feature later.
- Win rate per variant with statistical significance indicators
- Confidence intervals and A/B test duration recommendations
- Revenue attribution per variant
- Variant lifecycle visualization (born → tested → champion/dead)
- Export capability

---

### TIER 3: Integrations & Stickiness (Weeks 4-8)
*These expand reach and create switching costs.*

#### 11. Klaviyo Integration — ~8 hours
**Why:** Klaviyo is the #1 email platform for Shopify. Pushing modal events into Klaviyo profiles lets merchants build combined instant (modal) + delayed (email) recovery flows. Creates deep integration stickiness that reduces churn.
- Push events: "Viewed Exit Modal", "Clicked Discount", "Ignored Modal"
- Profile properties: last_modal_variant, last_discount_offered, cart_value
- Settings UI: API key input, event toggle
- Enables segmentation: "showed modal but didn't convert" → email follow-up

#### 12. Express Checkout in Modal — ~8 hours
**Why:** Shop Pay, Apple Pay, Google Pay — reducing clicks from 5 to 1. But this is complex (Shopify payment APIs, Dynamic Checkout Buttons), so it sits behind simpler wins.
- Shop Pay button in modal
- Apple Pay / Google Pay detection
- One-click checkout flow
- A/B test: with/without express checkout

#### 13. Spin-to-Win / Gamification Mode ⭐ NEW — ~8 hours
**Why:** Gamified modals (spin wheels, scratch cards) consistently show 2-3x higher engagement than static modals in e-commerce. This would be a Pro/Enterprise feature that differentiates from the "boring popup" category.
- Spin wheel with configurable prizes (10% off, 15% off, free shipping, no prize)
- Weighted probability (merchant controls odds)
- Smooth animation
- Prize auto-applied as discount code
- Falls back to static modal on low-power/old devices

#### 14. Email Performance Comparison Dashboard (Enterprise) — ~6 hours
**Why:** Enterprise merchants need to justify cost. Showing "Repsarq recovered $X in 2 seconds vs. your abandoned cart emails recovered $Y over 3 days" is a retention power move.
- Compare Repsarq recovery vs abandoned cart email recovery rates
- Time-to-conversion comparison
- Dashboard widget with visual comparison chart

---

### TIER 4: Platform & Moat (Weeks 8-12+)
*Long-term competitive advantages and advanced features.*

#### 15. Community Gene Pool — ~10 hours
**Dependency:** Variant Tracking (#10) must ship first.
**Why:** Network effect moat. More merchants → better copy variants → better results for everyone.
- Opt-in contribution of high-performing variants
- Performance gate: variant must hit minimum CVR threshold
- Normalization: strip brand-specific values, add placeholders
- Category tagging by store vertical
- TOS disclosure

#### 16. Upsell/Cross-Sell Recommendations ⭐ NEW — ~8 hours
**Why:** Instead of just saving the current cart, suggest complementary products. "Complete the look" or "Customers also bought" turns a recovery moment into an AOV-boosting moment.
- Fetch Shopify product recommendations API
- "Frequently bought together" suggestions in modal
- Add-to-cart button within modal
- Track incremental revenue from upsells

#### 17. Exit Survey / Quiz Modal Mode ⭐ NEW — ~6 hours
**Why:** Some merchants want to understand *why* customers leave. A quick 1-2 question exit survey provides insights AND can route to the right offer based on the answer.
- 1-3 question flow before showing offer
- Answer-based routing (price concern → discount, shipping concern → free shipping, just browsing → reminder)
- Survey data dashboard for merchants
- Enterprise feature

#### 18. Multi-Currency Support — ~6 hours
**Why:** International merchants need discounts in local currency. Important for growth beyond US/UK.

#### 19. Multi-Language Variants — ~8 hours
**Why:** AI-generated copy in customer's browser language. Goes with multi-currency.

#### 20. SMS / WhatsApp Recovery ⭐ NEW — ~10 hours
**Why:** Follow-up channel for customers who dismiss the modal. High recovery rates but requires phone collection + compliance (TCPA opt-in), making it a later-stage feature.
- Optional phone input in modal
- Twilio integration
- Time-delayed follow-up (15-60 min)
- Compliance: opt-in, unsubscribe

---

## NEW FEATURE SUGGESTIONS — SUMMARY

| # | Feature | Effort | Conversion Impact | Priority | Rationale |
|---|---------|--------|-------------------|----------|-----------|
| 4 | **Countdown Timer** | 3h | Very High | Tier 1 | Urgency = highest converting trigger, trivial to build |
| 5 | **Free Shipping Threshold** | 5h | Very High | Tier 1 | #1 e-commerce conversion driver, zero margin cost |
| 9 | **Product Images in Modal** | 4h | High | Tier 2 | Visual anchoring, personalization |
| 13 | **Spin-to-Win Gamification** | 8h | High | Tier 3 | 2-3x engagement vs static modals |
| 16 | **Upsell/Cross-Sell** | 8h | High | Tier 4 | AOV booster, turns recovery into growth |
| 17 | **Exit Survey/Quiz** | 6h | Medium | Tier 4 | Insights + smart offer routing |
| 20 | **SMS/WhatsApp Recovery** | 10h | Medium-High | Tier 4 | Follow-up channel, compliance-heavy |

---

## WHAT CHANGED FROM THE OLD ROADMAP (AND WHY)

### Deprioritized
- **Load Testing** — moved to pre-scaling phase. With Sentry live and low merchant count, this matters more at 100+ merchants, not at launch.
- **Website** — external project, not blocking app work. Continue in parallel.
- **Help Documentation** — build iteratively from actual support tickets rather than guessing what merchants will ask.
- **BFCM/Flash Sale Mode** — too seasonal for March. Build in September.
- **Geolocation-Based Offers** — low ROI for complexity. Most Shopify stores serve one market.
- **NPS Score Collection** — nice-to-have but doesn't drive merchant revenue.
- **Push Notification Recovery** — browser push has poor opt-in rates on mobile.

### Promoted / Added
- **Countdown Timer** — moved from Phase 3 "nice-to-have" to Tier 1. Too high-impact and too easy to build to leave in the backlog.
- **Free Shipping Threshold** — new addition to Tier 1. Was not in old roadmap at all despite being the #1 conversion driver in e-commerce.
- **Gift Card Fix** — promoted to Tier 2. Was listed as "done" but is actually broken.
- **Product Images** — moved from Phase 1 post-launch to Tier 2. High impact, medium effort.

---

## COMPETITIVE EDGE AFTER IMPLEMENTATION

| Feature | Repsarq | OptiMonk | Wisepops | Privy | Justuno |
|---------|---------|----------|----------|-------|---------|
| No Email Required | ✅ | ❌ | ❌ | ❌ | ❌ |
| Auto-Applied Discounts | ✅ | ❌ | ❌ | ❌ | ❌ |
| AI Decision Engine (13 signals) | ✅ | ❌ | Limited | ❌ | ✅ |
| Free Shipping Threshold | ✅ | ✅ | ❌ | ✅ | ❌ |
| Countdown Timer | ✅ | ✅ | ✅ | ❌ | ✅ |
| Product Images in Modal | ✅ | ❌ | ❌ | ❌ | ✅ |
| Margin Protection | ✅ | ❌ | ❌ | ❌ | ❌ |
| Spin-to-Win | ✅ | ✅ | ❌ | ❌ | ✅ |
| Cart Attribute Attribution | ✅ | ❌ | ❌ | ❌ | ❌ |
| Promotional Intelligence | ✅ | ❌ | ❌ | ❌ | ❌ |
| Gift Card Offers | ✅ | ❌ | ❌ | ❌ | ❌ |
| Exit Survey → Smart Offer | ✅ | ❌ | ❌ | ❌ | ❌ |
| Upsell/Cross-Sell in Modal | ✅ | ❌ | ❌ | ❌ | ✅ |

---

**Last Updated:** March 5, 2026
**Status:** Post-launch — Shopify review fixes merged, conversion tracking working
**Next Milestone:** Settings Preview → Countdown Timer → Free Shipping Threshold
