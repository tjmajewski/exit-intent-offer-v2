# Repsarq Feature Roadmap
**Updated: March 5, 2026**
**App:** Exit Intent Modal with AI-Powered Cart Recovery

---

## Guiding Principle: Analytics & Variants Evolve With Every Feature

Every feature below has an **analytics and variants tail**. When we ship a new capability, the analytics pages must surface data about it, and the AI variant system must be able to evolve it. This is not a separate line item — it's baked into every scope estimate.

Example: shipping "Countdown Timer" means the analytics page shows timer-driven conversion lift, and the variant system can evolve timer durations, urgency copy, and display triggers.

---

## Priority Tier 1: High-Impact Revenue Drivers

These features directly increase conversion rates and recovered revenue. Ship these first.

### 1.1 Countdown Timer in Modal
**Impact:** High — urgency is the #1 psychological conversion driver
**Effort:** Medium (3-5 days)
**Tier:** Pro+

Add a visible countdown timer to the modal that creates urgency around the offer expiring.

**Core scope:**
- Configurable duration (5min, 15min, 30min, 1hr, custom)
- Visual styles: bar countdown, digital clock, circular progress
- Behavior on expiry: dismiss modal, show "expired" state, or extend silently
- Mobile-optimized rendering (no layout shift)

**Analytics surface:**
- Conversion rate with timer vs. without timer (historical baseline)
- Avg time-to-click when timer is present
- Drop-off rate at different remaining-time thresholds
- Optimal duration discovery per store

**Variant genes:**
- Timer duration
- Timer visual style
- Timer position (top of modal, inline with CTA, below offer)
- Urgency copy paired with timer ("Only X:XX left!", "Expires soon")

---

### 1.2 Product Images in Modal
**Impact:** High — showing what's in the cart makes it personal and concrete
**Effort:** Medium (3-5 days)
**Tier:** All tiers (basic), Pro+ (AI-optimized)

Display cart product thumbnails in the modal so the customer sees *their* items.

**Core scope:**
- Fetch cart items with images from Shopify storefront API
- Display first 1-3 products (configurable) with thumbnails
- Graceful fallback when images unavailable
- Lazy loading, optimized for mobile data
- Layout options: horizontal row, stacked, or hero (single large image)

**Analytics surface:**
- Conversion rate with images vs. without
- Click-through rate by number of images shown
- Performance impact (load time delta)

**Variant genes:**
- Number of images (1, 2, 3)
- Image size (small thumbnails vs. medium)
- Layout style (row, stack, hero)
- With/without product names
- With/without price display

---

### 1.3 Free Shipping Threshold Bar
**Impact:** High — free shipping is the #1 reason customers increase cart value
**Effort:** Medium (4-6 days)
**Tier:** Pro+

A progress bar showing how close the customer is to free shipping, displayed in the modal.

**Core scope:**
- Merchant configures free shipping threshold (or auto-detect from Shopify shipping rules)
- Dynamic progress bar: "You're $12.50 away from FREE shipping!"
- When threshold met: celebratory state ("You qualify for FREE shipping!")
- Pairs with discount offer or stands alone
- Works with multi-currency if applicable

**Analytics surface:**
- AOV lift when shipping bar is present
- Threshold completion rate (what % of customers actually hit the threshold)
- Revenue from upsell vs. discount cost
- Optimal threshold discovery

**Variant genes:**
- Messaging tone ("Almost there!" vs. "Add $X more for free shipping")
- Bar visual style (gradient, segmented, minimal)
- Position in modal (top, middle, bottom)
- Whether to show exact dollar amount or percentage
- Paired offer strategy (discount + shipping bar vs. shipping bar alone)

---

### 1.4 Promo Code Automation by Offer Type
**Impact:** High — removes manual work and prevents promo conflicts
**Effort:** Small (2-3 days)
**Tier:** Pro+

Automatically generate and manage the right type of Shopify discount code based on the offer being made.

**Core scope:**
- Percentage off → auto-creates percentage price rule
- Fixed amount off → auto-creates fixed amount price rule
- Free shipping → auto-creates free shipping discount
- Gift with purchase → auto-creates BXGY or automatic discount
- **Two code modes:**
  - **Generic code** (e.g. "SAVE10") — merchant-defined, stays active indefinitely, reusable by anyone. No expiration messaging.
  - **Unique code** (e.g. "EXIT-A7k9x") — auto-generated per customer, expires in 24 hours and is set to disabled in Shopify. Modal displays "Code expires in 24 hours" to create urgency and prevent code sharing.
- Code rotation: auto-expire and regenerate codes on schedule
- Conflict detection: warn if another active discount would stack or override

**Analytics surface:**
- Redemption rate by discount type
- Revenue per discount type
- Code expiration vs. usage timing
- Stacking/conflict incident log

**Variant genes:**
- Offer type (percentage, fixed, shipping, gift)
- Offer amount within type
- Code format (branded prefix vs. random)
- Expiration window

---

## Priority Tier 2: Merchant Experience & Retention

These features reduce churn and make the product stickier. They don't directly convert customers but they make merchants love the product.

### 2.1 Live Preview Panel (Split-Screen Settings)
**Impact:** High for merchant satisfaction — eliminates the clunky preview-button loop
**Effort:** Medium (4-6 days)
**Tier:** All tiers

Replace the current "Preview Modal" button with a persistent side-by-side layout: settings on the left, live modal preview on the right, updating in real time.

**Core scope:**
- Split-screen layout on settings page (collapsible on smaller screens)
- Preview updates instantly as merchant changes any setting
- Shows actual modal with current brand colors, fonts, copy
- Device toggle: preview as desktop or mobile
- Preview includes all active features (timer, images, shipping bar if enabled)
- Does NOT count as an impression

**Implementation notes:**
- Reuse modal rendering logic from the storefront extension
- React component that mirrors the modal output
- Debounce updates (100ms) to avoid jank during typing

---

### 2.2 Customer Support Lookup / Mirror View
**Impact:** Medium-high — critical for support teams at scale
**Effort:** Medium (3-5 days)
**Tier:** Enterprise

Let support agents look up what a specific customer saw and reconstruct their experience.

**Core scope:**
- Search by email, order number, or Shopify customer ID
- Timeline view: what modal was shown, when, what variant, what offer
- Whether they clicked, converted, or dismissed
- The exact modal state they saw (copy, offer amount, design)
- "Replay" button to see the modal as the customer saw it

**Analytics surface:**
- Support lookup frequency (are merchants using this?)
- Resolution patterns (what do they look up most?)

---

### 2.3 Advanced Targeting Rules
**Impact:** Medium — lets merchants get surgical about who sees what
**Effort:** Medium-large (5-8 days)
**Tier:** Pro (basic rules), Enterprise (advanced combinations)

Go beyond the current triggers with audience-level targeting.

**Core scope:**
- **Page-level:** Show on specific pages, collections, or product types
- **Customer-level:** New vs. returning, logged in vs. guest, tag-based
- **Behavior-level:** Pages viewed this session, time on site threshold, scroll depth
- **Cart-level:** Contains specific product/collection, item count
- **Exclusions:** Don't show to customers who converted in last X days
- Rule builder UI with AND/OR logic (Enterprise)

**Analytics surface:**
- Performance breakdown by targeting rule
- Audience segment comparison
- Rule overlap detection ("these 2 rules cover the same people")

**Variant genes:**
- Per-segment variant evolution (different winning copy for new vs. returning)

---

## Priority Tier 3: Competitive Moat & Intelligence

These features build defensible advantages that competitors can't easily replicate.

### 3.1 Enhanced AI System
**Impact:** High long-term — compounds over time
**Effort:** Large (ongoing)
**Tier:** Pro+ (basic), Enterprise (full)

Level up the existing AI evolution system with smarter signals and faster learning.

**Core scope:**
- **More signals:** Add scroll velocity, mouse movement patterns, tab-switching behavior, referral page context
- **Faster convergence:** Bayesian optimization to replace pure genetic algorithm for small-traffic stores
- **Cross-store learning improvements:** Better normalization, industry-specific baselines, seasonal adjustment
- **Explainability:** "Why this variant won" summary for merchants
- **Auto-pause losing variants faster** with early stopping rules

**Analytics surface:**
- AI performance over time chart (learning curve)
- Signal importance ranking ("cart value was the strongest predictor this month")
- Generation-over-generation improvement visualization
- Confidence intervals on all AI-driven metrics

---

### 3.2 3rd Party App Awareness
**Impact:** Medium-high — prevents conflicts that cause merchant churn
**Effort:** Medium (4-6 days)
**Tier:** All tiers

Detect other popups, modals, and overlays running on the store and react intelligently.

**Core scope:**
- DOM scanning for known popup app signatures (Klaviyo, Privy, OptiMonk, Justuno, etc.)
- Detection of generic overlay/modal patterns (z-index stacking, fixed positioning)
- Behavior: delay Repsarq modal if another popup is active, queue instead of overlap
- Settings: merchant can set priority rules ("always show after Klaviyo", "never show if Privy is active")
- Alert in admin: "We detected [App X] running popups — here's how we're handling it"

**Analytics surface:**
- Conflict frequency log
- Conversion rate when competing popup was present vs. absent
- Which apps are most commonly co-installed

---

### 3.3 Full-Funnel Orchestrator
**Impact:** High — moves Repsarq from "exit popup" to "conversion platform"
**Effort:** Large (2-4 weeks)
**Tier:** Enterprise

Orchestrate multiple touchpoints across the customer journey, not just exit intent.

**Core scope:**
- **Pre-cart nudges:** Subtle product page messaging ("Buy today, get 10% off")
- **Cart page reinforcement:** In-cart banner echoing the offer
- **Post-dismiss follow-up:** If they dismiss the modal, show a minimized sticky reminder
- **Multi-step sequences:** First visit = soft nudge, second visit = stronger offer, third = best offer
- **Touchpoint coordination:** Ensure the customer sees a coherent story, not random popups
- **Frequency capping across touchpoints**

**Analytics surface:**
- Full funnel visualization: awareness → consideration → offer → conversion
- Touchpoint attribution: which combination of touchpoints converts best
- Sequence performance: 1-touch vs. 2-touch vs. 3-touch journeys
- Diminishing returns analysis

**Variant genes:**
- Sequence strategy (escalating, consistent, front-loaded)
- Touchpoint copy coherence
- Timing between touchpoints
- Nudge intensity per step

---

### 3.4 Cart CTA for Missed Promos
**Impact:** Medium — recovers customers who dismissed the modal but stay on site
**Effort:** Small-medium (3-4 days)
**Tier:** Pro+

If a customer dismisses the exit intent modal, show a persistent but non-intrusive reminder near the cart icon.

**Core scope:**
- Small badge/tooltip near cart icon: "Your 10% off is still available!"
- Appears after modal dismissal, persists for the session
- Clicking it re-opens the offer (or goes straight to checkout with discount)
- Auto-dismisses after X minutes or on conversion
- Respects frequency caps

**Analytics surface:**
- Recovery rate from cart CTA (% of dismissers who come back via CTA)
- Time between dismissal and cart CTA click
- Revenue attributed to cart CTA specifically

---

## Priority Tier 4: Platform & Ecosystem

These features make Repsarq a platform, not just an app.

### 4.1 Developer Onboarding & Documentation
**Impact:** Medium — enables integrations and reduces support burden
**Effort:** Medium (3-5 days for initial version)
**Tier:** All tiers

Comprehensive documentation for merchants and developers who want to customize or integrate.

**Core scope:**
- **Merchant docs:** Setup guides, feature explanations, FAQ, troubleshooting
- **Developer docs:** API reference, webhook events, custom CSS guide, theme extension customization
- **Interactive examples:** Code snippets for common customizations
- **Video walkthroughs:** Quick setup, AI configuration, reading analytics
- **Changelog:** What shipped and when

**Where it lives:**
- In-app help panel (contextual, per-page)
- External docs site (searchable, comprehensive)
- Inline tooltips for complex settings

---

## Priority Tier 5: Future Exploration

Ideas worth validating but not yet committed. Revisit after Tiers 1-3 ship.

- **Spin-to-win / gamification** — engagement play, but risks brand perception
- **SMS/WhatsApp recovery** — requires partnerships and compliance work
- **Multi-language variants** — important for international stores
- **Express checkout in modal** (Shop Pay / Apple Pay) — high-impact but complex integration
- **Inventory-aware discounts** — discount more on overstocked items
- **Quiz/survey modals** — different product category, evaluate if it fits
- **NPS collection** — nice-to-have, low priority
- **Geolocation-based offers** — useful for multi-region stores
- **BFCM / Flash sale mode** — seasonal preset that auto-adjusts aggression and offers

---

## Cross-Cutting Requirements

### Generic vs. Unique Promo Codes (Applies Everywhere)
Merchants choose between two code modes. This choice affects behavior across all features that generate or display a promo code (modal, cart CTA, shipping bar, full-funnel touchpoints, etc.).

**Generic codes** (e.g. "SAVE10"):
- Merchant creates and manages the code themselves
- Stays active indefinitely — no expiration messaging shown
- Reusable by multiple customers
- Simpler setup, but susceptible to coupon site sharing

**Unique codes** (e.g. "EXIT-A7k9x"):
- Auto-generated per customer session
- **Expires in 24 hours** and is automatically **set to disabled** in Shopify
- The modal/touchpoint must visually communicate: **"Code expires in 24 hours"**
- If the customer returns after expiration, they get a fresh code (if eligible)
- Prevents code sharing on coupon sites and creates genuine urgency

---

## Implementation Principles

1. **Ship incrementally.** Each feature should be usable on its own. Don't build a 3-feature bundle — ship one, learn, ship the next.

2. **Analytics tail is mandatory.** No feature ships without its corresponding analytics surface. If we can't measure it, we don't ship it.

3. **Variant genes expand naturally.** Every new visual or behavioral element becomes a gene the AI can evolve. This is what makes the AI system get better over time.

4. **Tier gating is a growth lever.** Give Starter enough to see value. Give Pro enough to feel powerful. Give Enterprise enough to feel indispensable.

5. **Mobile-first always.** 60%+ of traffic is mobile. Every feature must work on mobile before desktop polish.

---

## Rough Sequencing

| Quarter | Focus | Key Deliverables |
|---------|-------|-----------------|
| **Q2 2026** | Revenue drivers | Countdown timer, product images, shipping bar, promo automation, live preview |
| **Q3 2026** | Intelligence | Enhanced AI, 3rd party awareness, advanced targeting, support mirror view |
| **Q4 2026** | Platform | Full-funnel orchestrator, cart CTA, developer docs, API/webhooks |
| **Q1 2027** | Expansion | Tier 5 exploration based on merchant feedback and data |

---

**Last Updated:** March 5, 2026
**Status:** Post-launch — feature expansion phase
