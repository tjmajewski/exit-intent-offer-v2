# Feature Queue — ResparQ

> **Purpose:** This is the task queue for the next Claude instance. Pick the top unchecked item, read its spec file, and build it. Check it off when done.
>
> **Rule:** Do NOT push code changes while Shopify is reviewing the app. Only docs/planning until review is complete.
>
> **Review Status:** Pending Shopify approval
> **Last Updated:** February 7, 2026

---

## Core Principle: Every Modal Feature Must Be a Testable Gene

> **IMPORTANT:** When building any new modal feature (product images, social proof, expiry copy, mobile design, etc.), it MUST be added as a **boolean gene** in the variant gene pool. The AI should be able to toggle the feature on/off per variant and measure its impact on conversions via Thompson Sampling.
>
> This means the AI doesn't just optimize copy — it learns whether product images help or hurt for a specific store, whether social proof converts better than urgency, whether showing the expiry line increases or decreases clicks. Every feature is an experiment the AI runs automatically.
>
> **Implementation pattern for each new feature gene:**
> 1. Add the gene to relevant baselines in `gene-pools.js` (e.g., `showProductImage: [true, false]`)
> 2. Store the gene value on each variant in `variant-engine.js`
> 3. Pass the gene value to `createModal()` / `showModalWithOffer()` in `exit-intent-modal.js`
> 4. Conditionally render the feature based on the gene value
> 5. Thompson Sampling naturally evolves toward the best combination — variants with the feature survive if it helps, die if it hurts
> 6. Track the gene value in `VariantImpression` so performance can be analyzed per-feature in analytics

---

## Queue (in priority order)

### 1. Simplified Promo Code System
- [ ] **Remove text inputs** for discount code prefix and generic code from QuickSetupTab
- [ ] **Auto-generate codes with RESPARQ prefix** using format: `RESPARQ-{amount}{type}` for static, `RESPARQ-{amount}{type}-XXXX` for unique
- [ ] **Format: `P` for percentage, `F` for fixed** — e.g., `RESPARQ-5P` (5% off static), `RESPARQ-10F` (fixed $10 off), `RESPARQ-5P-A7K2` (5% off unique)
- [ ] **Update discount creation logic** in backend to use new format
- [ ] **Update settings UI** — remove code prefix/generic code fields, just show a preview of what the code will look like based on their discount settings

**Spec:** Inline (no separate doc needed)
- Current code inputs in `QuickSetupTab.jsx` lines 337-421 — replace with auto-generated preview
- Discount creation in `apps.exit-intent.api.ai-decision.jsx` and manual flow — update code generation
- Shopify discount codes cannot contain `%`, `$`, or spaces — only letters, numbers, hyphens
- Stores need to distinguish percentage vs fixed when filtering in Shopify discount admin, hence `P` vs `F` suffix
- For AI mode, the AI already controls offer type/amount — just apply the same naming convention

---

### 2. Product Images in Modal
- [ ] **Parse cart item images** from `/cart.js` response (already fetched in `collectCustomerSignals()`)
- [ ] **Pass featured image URL** to `showModalWithOffer()` — use the most expensive item's image
- [ ] **Add image element to modal** — circular or rounded product thumbnail next to headline
- [ ] **Fallback** — if no image available or image fails to load, hide the image element (don't break layout)
- [ ] **Mobile layout** — image above headline on mobile, beside headline on desktop
- [ ] **AI gene: `showProductImage: [true, false]`** — AI tests image vs no-image per variant and evolves toward what converts best for each store

**Spec:** Inline
- `/cart.js` response includes `items[].image` (URL) and `items[].featured_image.url`
- Sort items by `items[].price` descending, use first item's image
- In `createModal()` in `exit-intent-modal.js`, add an `<img>` element before the headline
- Desktop: `display: flex` row with image (80px) + text. Mobile: image centered above text (60px)
- Set `loading="eager"` since modal may show immediately
- Add `showProductImage: [true, false]` to all baselines in `gene-pools.js`
- Variant engine stores the gene value; modal conditionally renders image based on it
- This lets the AI discover that e.g. fashion stores convert better with images but SaaS stores don't

---

### 3. 24-Hour Expiry Copy for Unique Codes
- [ ] **Add expiry line to modal** when discount code is unique (has 24hr expiry)
- [ ] **Text:** "Valid for 24 hours" displayed below the CTA button in smaller muted text
- [ ] **Do NOT show for static codes** (no expiry) — only unique codes
- [ ] **AI gene: `showExpiry: [true, false]`** — AI tests whether showing the expiry line increases urgency-driven conversions or scares people off, per store

**Spec:** Inline
- In `showModalWithOffer()` in `exit-intent-modal.js`, after CTA button, conditionally add a `<div>` with expiry text
- Condition: `settings.manualDiscountCodeMode === 'unique'` (manual) or `settings.aiDiscountCodeMode === 'unique'` (AI)
- Style: `fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 8`
- Gene pool addition: add `showExpiry: [true, false]` to all discount baselines in `gene-pools.js`

---

### 4. Social Proof as AI-Controlled Toggle
- [ ] **Add single "Enable Social Proof" toggle** to AI Settings tab — no dropdown, no text box
- [ ] **When enabled, AI mixes social proof variants into the gene pool** alongside regular variants
- [ ] **AI measures performance** of social proof vs non-social proof copy via Thompson Sampling
- [ ] **Social proof data sources:** `shop.orderCount`, `shop.avgRating`, `shop.reviewCount` (already in Shop model)
- [ ] **Remove any existing social proof dropdowns/inputs** if they exist — simplify to just the toggle
- [ ] **AI gene: `useSocialProof: [true, false]`** — AI tests social proof copy vs standard copy per variant, evolves toward what works for each store's audience

**Spec:** Inline
- `socialProofEnabled` already exists in Shop model
- Gene pools already have `headlinesWithSocialProof` and `subheadsWithSocialProof` arrays
- `social-proof.js` and `social-proof-cache.js` already exist with `hasSocialProof()` and `replaceSocialProofPlaceholders()`
- `createRandomVariantWithSocialProof()` in `variant-engine.js` already handles this
- What's needed: wire the toggle in AISettingsTab → save to shop settings → variant engine checks `socialProofEnabled` when creating variants → if enabled, includes social proof pool in Thompson Sampling
- The AI naturally A/B tests social proof vs non-social proof because both types are in the variant population
- Track `useSocialProof` on VariantImpression so analytics can show "social proof converts X% better/worse for your store"

---

### 5. Mobile-Specific Modal Design
- [ ] **Bottom sheet on mobile** — modal slides up from bottom, full-width, rounded top corners
- [ ] **Shorter copy on mobile** — AI should prefer shorter headlines for mobile segment
- [ ] **Larger tap targets** — CTA button full-width, minimum 48px height
- [ ] **Swipe to dismiss** — swipe down gesture to close (in addition to X button)
- [ ] **Product image above headline** (if images enabled) vs beside on desktop
- [ ] **AI gene: `copyLength: ['short', 'standard']`** — AI tests short vs standard copy length, especially for mobile segment
- [ ] **AI gene: `modalLayout: ['bottom_sheet', 'center']`** on mobile — AI tests which layout converts better

**Spec:** Inline
- `isMobileDevice()` already exists in `exit-intent-modal.js`
- `createModal()` already has some mobile detection but uses same layout
- Mobile modal styles for bottom sheet: `position: fixed, bottom: 0, left: 0, right: 0, borderRadius: '16px 16px 0 0', maxHeight: '70vh'`
- Add touch event listener for swipe-down dismiss: track `touchstart` Y, compare to `touchend` Y, if delta > 50px dismiss
- Add `copyLength` and `modalLayout` genes to baselines in `gene-pools.js`
- Short copy = headline only (no subhead). Standard = headline + subhead as today
- Track both genes on VariantImpression for per-store learning

---

### 6. Live Preview in Settings
- [ ] **Side-by-side layout** — settings form on left (60%), live modal preview on right (40%)
- [ ] **Preview updates in real-time** as merchant types headline, body, CTA, changes colors, toggles discount
- [ ] **Preview shows actual modal** — not a screenshot, the real HTML/CSS that customers will see
- [ ] **Mobile/desktop toggle** on preview — let merchant see both versions
- [ ] **Replace current "Show Preview" toggle button** with the persistent side panel

**Spec:** Inline
- Current preview toggle in `QuickSetupTab.jsx` line 293-306
- Create new component: `app/components/settings/ModalPreview.jsx`
- Receives all current settings as props, renders a scaled-down version of the modal
- Use `transform: scale(0.6)` with `transform-origin: top right` to fit in the side panel
- Wrap the settings page in a flex container: `display: flex, gap: 24`
- Preview component should render the same HTML structure as `createModal()` in `exit-intent-modal.js` — keep them in sync
- On mobile viewport (< 1024px), preview goes below settings instead of beside

---

### 7. Smart Defaults from Store Data
- [ ] **On first install, fetch store data** via Admin API (shop name, currency, average order value from recent orders)
- [ ] **Pre-fill discount amount** based on AOV — stores with $200+ AOV get 10% default, stores with <$50 AOV get $5 fixed default
- [ ] **Pre-fill brand colors** by running auto-detect on install (already exists as a button — make it automatic)
- [ ] **Set currency-aware copy** — "Get $10 off" vs "Get €10 off" based on store currency
- [ ] **Pre-fill headline** with store name: "Wait! {StoreName} has a special offer for you"

**Spec:** Inline
- Auto-detect brand colors button already exists in `BrandingTab.jsx` line 107-124 — trigger this logic on first install
- Store currency available from `window.Shopify.currency.active` (client) and Shopify Admin API (server)
- Fetch recent orders in the loader of `app.settings.jsx` to calculate AOV — `orders(first: 50) { edges { node { totalPriceSet { shopMoney { amount } } } } }`
- Store these as defaults only if settings are empty (first install) — never overwrite existing config
- Files: `app/routes/app.settings.jsx` (loader), settings tab components

---

### 8. Visual Templates
- [ ] **Templates change design, not just copy** — each template sets colors, layout, button style, animation, and typography
- [ ] **Template preview cards** show a visual thumbnail of what the modal will look like
- [ ] **Applying a template sets branding + copy + design in one click**
- [ ] **Templates:** Minimal (clean white), Bold (dark bg, large text), Playful (rounded, bright accent), Premium (elegant, serif font), Urgent (red accents, countdown feel)

**Spec:** Inline
- Current templates in `app/utils/templates.js` — extend to include visual settings
- Each template should set: `brandPrimaryColor`, `brandSecondaryColor`, `brandAccentColor`, `brandFont`, `layout`, `buttonStyle`, `animation`, `typography` in addition to existing `headline`, `body`, `ctaButton`
- `applyTemplate()` in `QuickSetupTab.jsx` currently only sets copy — extend to also set branding values
- Template preview cards: render a tiny modal thumbnail (CSS only, no actual modal) using the template's colors/style

---

### 9. Smarter "Don't Show" Modal Logic
- [ ] **Suppress when customer just added item** (< 10 seconds ago)
- [ ] **Suppress on product pages** (only show on cart/checkout)
- [ ] **Suppress for previous ResparQ converters** (cookie/localStorage flag)
- [ ] **Suppress when customer arrived with email discount code** (UTM param check)

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #6
- All client-side checks in `exit-intent-modal.js` before calling API
- High impact, low effort — no backend changes needed

---

### 10. Segment-Aware Variant Selection
- [ ] **Define segments** (new_visitor, returning_browser, loyal_customer, price_sensitive, high_value_cart, mobile_shopper, paid_traffic, aeo_geo_traffic)
- [ ] **Compute segment from signals** in AI decision endpoint
- [ ] **Filter Thompson Sampling by segment** so variants optimize per-audience
- [ ] **Track per-segment performance** in VariantImpression table
- [ ] **AEO/GEO detection:** Identify visitors arriving from AI answer engines (ChatGPT, Perplexity, Google AI Overviews, Bing Copilot, Claude, etc.) via `document.referrer` and UTM parameters. Treat as a distinct high-intent segment similar to paid_traffic or returning_browser — these visitors were specifically recommended by an AI, so they're likely high-intent but brand-unfamiliar. The AI should learn the optimal strategy independently for this segment (e.g., social proof to build trust may outperform discounting since they're already convinced enough to click through).

**AEO/GEO referrer detection:**
- `document.referrer` containing: `chat.openai.com`, `chatgpt.com`, `perplexity.ai`, `bing.com/chat`, `copilot.microsoft.com`, `claude.ai`, `bard.google.com`, `you.com`, `phind.com`
- Google AI Overviews: harder to distinguish from regular Google organic — look for UTM params like `utm_source=google_ai` or referrer path patterns if available
- Pass `trafficSource: 'aeo_geo'` as a signal alongside existing `trafficSource` detection (organic, paid, direct, social, referral)
- This segment should be tracked separately in analytics so merchants can see "X% of your recovered revenue came from AI-referred visitors"

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #1
- Files: `variant-engine.js`, `ai-decision.server.js`, `exit-intent-modal.js`, `apps.exit-intent.api.ai-decision.jsx`
- VariantImpression table already has `segment` column

---

### 11. Copy Personalization Tokens
- [ ] **Add new placeholders** (`{{cart_item_name}}`, `{{customer_first_name}}`, `{{cart_total}}`, `{{cart_item_count}}`, `{{savings_amount}}`)
- [ ] **Add personalized headline/subhead variants** to gene pools
- [ ] **Expand replacement logic** in `showModalWithOffer()` with fallback for missing data (e.g., guest users)

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #2
- Cart data already available from `/cart.js` call
- Customer name from `window.Shopify.customer.first_name`
- Files: `gene-pools.js`, `exit-intent-modal.js`

---

### 12. Profit-Optimized Discounting
- [ ] **Add "Average Margin" merchant setting** (default 50%)
- [ ] **Factor margin into offer calculation** — don't offer 20% on a 30% margin product
- [ ] **Weight PPI (profit per impression) higher** in Thompson Sampling fitness
- [ ] **Track discountAmount on every converting VariantImpression**

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #7
- New field: `averageMargin` on Shop model in `prisma/schema.prisma`
- Files: `ai-decision.server.js`, `variant-engine.js`, `app.settings.jsx` (AI Settings tab)

---

### 13. Discount Escalation (2-Step Offers)
- [ ] **First dismiss → flag, don't session-block**
- [ ] **Second exit intent → escalated offer** (+5%, different urgency copy)
- [ ] **Max 2 shows per session**, track escalation conversion separately
- [ ] **Add escalation gene pool** with "last chance" copy variants
- [ ] **Gate behind aggression >= 5** (conservative merchants opt out)

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #3
- Files: `exit-intent-modal.js`, `gene-pools.js`, `ai-decision.server.js`

---

### 14. Time-of-Day & Day-of-Week Optimization
- [ ] **Add hourOfDay and dayOfWeek to signals**
- [ ] **Store time data in VariantImpression** (new columns or JSON field)
- [ ] **Calculate conversion rate multipliers** per time bucket after 2+ weeks of data
- [ ] **Adjust score in `determineOffer()`** — reduce discount during peak, increase during slow

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #4
- Time buckets: morning/afternoon/evening/late-night, weekday/weekend
- Files: `exit-intent-modal.js`, `ai-decision.server.js`, `prisma/schema.prisma`

---

### 15. Product Category Awareness
- [ ] **Parse product_type, tags, title, price** from `/cart.js` response
- [ ] **Send cartComposition signal** to AI decision endpoint
- [ ] **Adjust strategy by category** (consumables → "stock up", gifts → urgency, sale items → smaller discount)
- [ ] **Reference most expensive item** in personalized copy

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #5
- `/cart.js` already returns full product data per line item
- Files: `exit-intent-modal.js`, `ai-decision.server.js`

---

### 16. Cross-Store Meta-Learning (Long-term)
- [ ] **Aggregate anonymized variant performance** across stores
- [ ] **Push data after each evolution cycle** (contributing stores only)
- [ ] **Pull meta-learned priors for new stores** — bootstrap Thompson Sampling
- [ ] **MetaLearning table** in database
- [ ] **Include feature gene performance** — aggregate conversion rates per gene value across stores so new stores benefit from what the network has already learned

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #8
- `contributeToMetaLearning` flag already exists in shop settings
- `meta-learning.js` already exists but needs implementation
- Files: `meta-learning.js`, `evolution-cycle.js`, `variant-engine.js`, `prisma/schema.prisma`

**Feature gene data to aggregate (anonymized, no store identity):**

| Gene | What to share | How it helps new stores |
|------|--------------|----------------------|
| `showProductImage` | Conversion rate with/without, by store product category | Fashion store instantly knows images help; digital store knows they don't |
| `useSocialProof` | Conversion rate with/without, by store order volume | High-volume stores may benefit more from "X customers bought today" |
| `showExpiry` | Conversion rate with/without, by discount code type | Learn whether expiry urgency helps across store types |
| `copyLength` | Short vs standard performance, by device type | Instant mobile optimization for new stores |
| `modalLayout` | Bottom sheet vs center, by device type | Skip the layout testing phase entirely |
| `urgency` | On/off performance, by offer type and segment | Already exists as gene — include in meta-learning |
| `offerAmount` | Conversion rate by discount %, by cart value range | Learn optimal discount ranges across the network |
| `redirect` | Cart vs checkout performance, by cart value | Learn which redirect converts better by context |

**Privacy rules:**
- Never share store domain, customer data, revenue numbers, or product names
- Only share gene-level conversion rates with minimum 100 impressions (prevent fingerprinting small stores)
- Stores must opt in via `contributeToMetaLearning` toggle
- Data is aggregated into buckets (e.g., "stores with AOV $50-100") not individual store records

---

### 17. Customer Onboarding Experience
- [ ] **Dashboard setup checklist** — Dismissible 5-step card on the Dashboard that guides new merchants from install to first live modal
- [ ] **Getting Started page** — New `/app/getting-started` route with reference guide, accordion FAQ sections, and quick-start steps
- [ ] **Sidebar nav update** — Add "Getting Started" link between Dashboard and Settings in `AppLayout.jsx`

**Spec file:** `ONBOARDING_PLAN.md`
- **Note:** Build this LAST — the settings UI changes from items 1, 6, 7, 8 above will change what the onboarding checklist references. Update `ONBOARDING_PLAN.md` to reflect the simplified settings before building.
- Exact checklist steps with completion detection logic
- Component props, file creation list, files to modify
- UI design tokens matching existing app style
- What NOT to build (no email drips, no wizards, no videos)

---

## Internal Tools (Owner-Only)

### 18. Admin Console — Store Switcher & Customer View
- [ ] **New route: `/app/admin`** — locked to owner's store domain only (`session.shop === OWNER_DOMAIN`)
- [ ] **Store numbering** — Your demo store is `#000`. Each customer gets a sequential number (`#001`, `#002`, etc.) based on install date from the `Shop` table
- [ ] **Store selector** — Search box + dropdown listing all active stores by number, name, and domain. Filter by plan tier, status (active/churned), install date
- [ ] **"View as Store" mode** — When you select a store, the entire app context switches to that store's data:
  - Their Dashboard (analytics, metrics, enable/disable status)
  - Their Settings (all 4 tabs showing their exact configuration)
  - Their Performance/Conversions data
  - Their active variants and evolution state
  - Their plan tier and usage
- [ ] **Read-only banner** — When viewing another store, show a persistent top banner: "Viewing Store #001 — nike-store.myshopify.com (READ ONLY)" with a "Back to Home" button
- [ ] **Home view (#000)** — Your demo store dashboard, PLUS a summary widget showing:
  - Total active stores
  - Total impressions/conversions/revenue across all stores (last 30 days)
  - Stores by plan tier breakdown
  - Recently installed stores
  - Stores with issues (modal disabled, no impressions in 7 days, etc.)
- [ ] **Never write data** when viewing another store — all forms disabled, save buttons hidden

**Spec:** Inline
- **Auth gate:** In the route loader, check `session.shop` against an env var `OWNER_SHOP_DOMAIN`. If mismatch, redirect to `/app`
- **Store list:** Query `prisma.shop.findMany()` ordered by `createdAt`. Assign sequential numbers in the UI (not stored — just array index + 1)
- **Reading customer data:** Use the customer's stored session token from `prisma.session.findFirst({ where: { shop: selectedShopDomain } })` to create an admin API client for that shop. Read their metafields (settings, plan, analytics, status) and database records (conversions, variantImpressions, promotions)
- **API client for other shops:**
  ```
  // Pseudocode for reading another shop's data
  const session = await prisma.session.findFirst({ where: { shop: targetDomain, isOnline: false } });
  const admin = shopifyApp.createAdminApiClient({ storeDomain: targetDomain, accessToken: session.accessToken });
  const metafields = await admin.graphql(`query { shop { metafield(namespace: "exit_intent", key: "settings") { value } } }`);
  ```
- **Database records:** Direct Prisma queries filtered by `shopId` — conversions, variant impressions, promotions, discount offers
- **Home view aggregation:** `prisma.shop.count()`, `prisma.conversion.aggregate()` with `_sum` on revenue, group by to get per-tier counts
- **Files to create:** `app/routes/app.admin.jsx`, `app/components/admin/StoreSelector.jsx`, `app/components/admin/StoreOverview.jsx`
- **Files to modify:** `app/components/AppLayout.jsx` (add Admin nav item, only visible when `session.shop === OWNER_DOMAIN`)
- **Env var:** Add `OWNER_SHOP_DOMAIN` to `.env` and `ENVIRONMENT_VARIABLES.md`

**Security rules:**
- Route loader MUST check owner domain before loading any data — no client-side-only checks
- Never expose this route or nav item to non-owner shops
- All API calls to customer shops are read-only — no mutations
- Log every admin view for audit trail (optional but recommended)
- If a customer's session token is missing/expired, show "Store unavailable — reinstall required" instead of crashing

---

### 19. Admin Console — Cross-Store Performance Summary (Future)
- [ ] **Dashboard widget on admin home** — table of all stores with key metrics columns
- [ ] **Columns:** Store #, Name, Plan, Status, Impressions (30d), Conversions (30d), Revenue (30d), Conversion Rate, Last Active
- [ ] **Sortable and filterable** — click column headers to sort, filter by plan tier or date range
- [ ] **Alert flags** — highlight stores with: modal disabled, zero impressions in 7+ days, trial expiring soon, approaching impression limit
- [ ] **Export to CSV** — download the table for offline analysis

**Spec:** Inline
- This builds on top of #18 — requires the admin route and store list to exist first
- Aggregate data from Prisma: `conversion` table grouped by `shopId`, `variantImpression` table for impression counts
- For revenue and conversion counts, use date-range filtered queries
- Alert logic: compare `lastImpressionDate` to `now - 7 days`, check `plan.usage.impressionsThisMonth` vs `plan.impressionLimit`
- Files: `app/components/admin/CrossStoreTable.jsx` (new), `app/routes/app.admin.jsx` (extend)

---

## Expansion Roadmap: Multi-Touchpoint Orchestration

> **Status:** Future — build AFTER the current queue is complete and the exit-intent experience is fully optimized.
>
> **Trigger to start:** When you're ready to add the first non-exit-intent touchpoint (e.g., free shipping bar, welcome modal, return visitor offer).
>
> **Key principle:** The orchestrator ships WITH the second touchpoint. One touchpoint doesn't need orchestration. Two or more do.

### The Problem

Multiple on-site interventions (exit-intent modal, welcome offer, free shipping bar, cart upsell, social proof toasts, return visitor modal) can overwhelm and annoy customers if they fire independently. A welcome modal + a free shipping bar + an exit-intent modal in one session is spam.

### The Solution: Session-Level Orchestrator

A coordination layer that sits ABOVE all individual touchpoints and makes a single decision: **"What is the ONE best intervention for this visitor right now, if any?"**

**Core logic flow:**
```
Visitor arrives
    ↓
Collect signals (existing system)
    ↓
Orchestrator checks:
  - Visitor's intervention history (this session + cross-session for Enterprise)
  - Current patience budget (depleted or available?)
  - Funnel stage (browsing / carting / checkout / post-purchase)
  - Landing page context (homepage vs product page vs collection — did they see the store's promo banners?)
  - Active store promotions (is a sale running that this visitor may not know about?)
  - Session behavior (engaged? rushing? idle?)
  - Third-party popup detection (did Klaviyo/Privy already fire?)
    ↓
Orchestrator decides: "eligible touchpoints for this moment"
  (usually 0-1 candidates, sometimes 2, often 0)
    ↓
If candidates exist → AI ranks them → picks the best one (or none)
    ↓
If shown → log it, deduct patience budget, track conversion
If not shown → log the "control" observation for learning
```

### Third-Party Popup Detection

Other apps (Klaviyo, Privy, Justuno, OptinMonster) inject modals into the DOM. ResparQ should detect these and treat them as if an intervention already fired.

**Detection methods:**
- **MutationObserver** on body — detect new overlay/modal elements that aren't ResparQ's
- **Known selectors** — `.klaviyo-popup`, `#privy-popup`, `.ju-popup`, `#om-popup`, etc.
- **Generic detection** — any new `position: fixed` element with high z-index and backdrop that appeared after page load

**This applies to ALL tiers.** Even Starter customers deserve not to have ResparQ pile on top of another app's popup. The detection is basic DOM watching, not AI.

**Selling point:** "ResparQ is the only app smart enough to back off when another app already engaged your visitor." Surface in dashboard: "ResparQ suppressed X modals this week because another app had already engaged the visitor."

### How the Orchestrator Maps to Plan Tiers

Every tier gets the same touchpoints. The tiers separate **how smart the orchestration is.**

#### Starter ($29) — Manual Touchpoints, Rule-Based Protection

- Merchant manually configures each touchpoint individually (on/off, offer type, discount, copy) — same as today's manual mode, just applied to more surfaces
- Orchestration is simple rules:
  - One popup per session (hard cap)
  - Funnel stage gate: welcome offer only if no cart, exit-intent only if cart exists, etc.
  - Third-party detection: if another app's popup fired, ResparQ waits
- If multiple touchpoints are eligible, system fires the first one that matches the visitor's funnel stage and blocks the rest for that session
- **Predictable and safe.** Merchant controls everything, rules prevent collisions.
- Non-modal touchpoints (free shipping bar, social proof toasts) DON'T count against the popup limit — they're passive, not interruptive

#### Pro ($79) — AI Picks the Best Intervention

- Same touchpoints available
- AI mode means the system decides WHICH touchpoint to show, not just what copy to use
- Thompson Sampling runs across touchpoints: "for this returning mobile shopper with an $80 cart, is the exit-intent modal or the free shipping nudge more likely to convert?"
- AI also optimizes copy/design within the chosen touchpoint (same as today)
- Includes a "do nothing" arm — the AI actively measures whether staying silent outperforms every intervention, and backs off when silence wins
- Merchant gets an "intervention style" control (conservative ↔ balanced ↔ aggressive) that maps to how willing the AI is to intervene vs stay quiet
- Third-party detection included
- **Session-only awareness** — Pro orchestrator only knows about the current visit, not past visits

#### Enterprise ($199) — AI Learns Optimal Strategy Across the Lifecycle

Everything Pro has, plus:
- **Cross-session visitor history** (server-side tracking): knows this visitor saw a modal on their last 2 visits and backs off on visit 3
- **Patience budgets per visitor:** every modal shown depletes patience, every un-interrupted visit restores it. AI learns the optimal cadence per segment.
- **Segment-aware orchestration:** AI learns that new visitors from paid ads convert best with a welcome offer, returning organic visitors convert best when left alone until exit, and AEO/GEO visitors (from ChatGPT, Perplexity, Google AI Overviews, etc.) may respond better to trust-building than discounting since they arrived via an AI recommendation. Different segments get different strategies.
- **Cadence learning per store:** fashion stores might need more frequent touchpoints, B2B stores might need fewer. Enterprise AI discovers this.
- **Third-party detection with learning:** not just detecting other popups, but learning patterns (e.g., "Klaviyo fires on every first visit to this store, so always defer the welcome offer")

### How Settings Evolve Per Tier

#### Starter Settings UI

```
── Touchpoints ──────────────────────────────────
☑ Exit-Intent Modal           [Configure →]
☑ Free Shipping Progress Bar  [Configure →]
☐ Welcome Offer               [Configure →]
☐ Return Visitor Offer        [Configure →]

── Session Rules ────────────────────────────────
Max popups per visit: [1 ▾]
```

Each "Configure" opens manual settings for that touchpoint: offer type, discount amount, copy, design. Same UX pattern as today's manual mode. The "max popups per visit" dropdown is their only orchestration control (default 1, option for 2). Non-modal touchpoints (free shipping bar) don't count against the limit.

#### Pro Settings UI (adds AI section)

```
── AI Optimization ──────────────────────────────
☑ Let AI choose which touchpoint to show
  Intervention style: [Balanced ▾]
  (Conservative / Balanced / Aggressive)

── Touchpoints ──────────────────────────────────
☑ Exit-Intent Modal           [AI-Managed ✦]
☑ Free Shipping Progress Bar  [AI-Managed ✦]
☐ Welcome Offer               [Configure →]
☐ Return Visitor Offer        [Configure →]
```

When AI mode is on, enabled touchpoints switch from "Configure" to "AI-Managed" — merchant can view what the AI is currently running but doesn't manually set copy. They still toggle touchpoints on/off (the AI only uses enabled touchpoints). The intervention style slider controls how willing the AI is to intervene vs stay silent.

#### Enterprise Settings UI (adds cross-session + segments)

```
── Cross-Session Intelligence ───────────────────
☑ Track visitor history across sessions
  Patience budget: [Standard ▾]
  (Relaxed / Standard / Persistent)

── Segment Strategies (AI-managed) ──────────────
  New visitors:        Moderate engagement ↕
  Returning browsers:  Low engagement ↕
  Loyal customers:     Minimal engagement ↕
  Price-sensitive:     High engagement ↕
  AI-referred (AEO/GEO): Moderate engagement ↕
  Paid traffic:        High engagement ↕
  (AI adjusts automatically. Read-only view.)
```

Enterprise merchants see what the AI learned about their segments but don't configure it. The AI discovers "loyal customers at your store convert better when left alone" and the merchant sees that reflected. The patience budget slider lets them influence how aggressively the system re-engages across visits.

### Tier Comparison Table

| Capability | Starter | Pro | Enterprise |
|---|---|---|---|
| Available touchpoints | All | All | All |
| Touchpoint configuration | Manual per touchpoint | AI-optimized | AI-optimized |
| Session orchestration | Rules (1 per visit) | AI picks best | AI picks best |
| "Do nothing" intelligence | Rule-based (max cap) | AI-measured control arm | AI-learned per segment |
| Cross-session memory | None | None (session only) | Full visitor lifecycle |
| Segment-aware strategies | None | None | AI-learned per segment |
| Third-party popup detection | Basic DOM detection | Same | Learns patterns over time |
| Intervention cadence learning | None | Per-session | Per-store, per-segment |

### Upgrade Pitch

- **Starter → Pro:** "Stop guessing which touchpoint works. Let the AI figure out the best intervention for each visitor."
- **Pro → Enterprise:** "Stop treating every visitor the same. Let the AI learn when to engage and when to back off across their entire relationship with your store."

### Orchestrator Genes (AI-Evolved)

When the orchestrator is built, these become testable genes in the evolution system:

| Gene | Values | What it controls |
|------|--------|-----------------|
| `maxInterventionsPerSession` | `1`, `2` | Hard cap on popups per visit |
| `patienceBudget` | `3`, `5`, `7` | How many sessions before re-engaging (Enterprise) |
| `cooldownVisits` | `1`, `2`, `3` | Quiet visits required after showing a modal (Enterprise) |
| `funnelStageStrictness` | `strict`, `permissive` | How tightly touchpoints are locked to funnel stages |
| `suppressOnHighEngagement` | `true`, `false` | Back off when visitor is already actively browsing |
| `thirdPartyBackoffMinutes` | `5`, `15`, `session` | How long to wait after another app's popup |

### Free Shipping Threshold Detection

The free shipping progress bar needs to know the store's free shipping threshold. Auto-detect on install, let the merchant adjust if wrong.

**Auto-detection via Shopify Admin API:**
- Query `deliveryProfiles` → each profile has `profileLocationGroups` → `locationGroupZones` → `methodDefinitions`
- Look for shipping rates with `rateProvider` price of $0.00 that have a price-based condition (minimum order subtotal)
- Extract the minimum subtotal value — that's the free shipping threshold
- Example: a rate named "Free Shipping" with condition "order subtotal >= $75" → threshold = $75

**Settings UX:**
```
── Free Shipping Bar ────────────────────────────
☑ Enable free shipping progress bar

  Free shipping threshold: [$75.00    ]
  (Auto-detected from your shipping settings.
   Update this if the detected value is incorrect.)
```

- On install or when the touchpoint is first enabled, run auto-detect and pre-fill the text input
- The text input is always editable — merchant can override if auto-detect picked the wrong rate (e.g., they have multiple shipping zones with different thresholds)
- If auto-detect finds no free shipping rate, leave the field empty and show: "We couldn't detect a free shipping threshold. Enter your free shipping minimum to enable the progress bar."
- The field is **required** — if the merchant enables the free shipping bar but leaves the threshold empty, the save button stays enabled (assuming other settings changed), but on save show an inline error: "Enter your free shipping threshold to activate the progress bar." The bar stays inactive until the threshold is set, but other settings still save normally.
- Store as `freeShippingThreshold` on the Shop model

**Edge cases:**
- Multiple shipping zones with different thresholds → pick the most common one, let merchant adjust
- No free shipping configured → field empty, merchant must enter manually
- Free shipping with no minimum (always free) → detect and show "Free shipping is always active — progress bar not needed"
- Threshold changes in Shopify → re-detect periodically (e.g., on each settings page load) and show a notice: "Your shipping settings changed — update threshold?"

### Implementation Order (when ready to build)

1. **Pick the second touchpoint** — likely free shipping progress bar (non-modal, low risk, high value)
2. **Build the basic orchestrator** — session flag + funnel stage gate + third-party detection (~30 lines of JS wrapping existing trigger logic)
3. **Add the touchpoint** — with the orchestrator already preventing collisions
4. **Wire up Starter settings** — touchpoint toggles + max popups dropdown
5. **Add AI orchestration for Pro** — Thompson Sampling across touchpoints + "do nothing" arm + intervention style slider
6. **Add cross-session tracking for Enterprise** — server-side visitor history, patience budgets, segment strategies
7. **Add more touchpoints** — each new one plugs into the orchestrator automatically
8. **Evolve orchestrator genes** — once enough data exists, the AI optimizes orchestration parameters themselves

### New Touchpoints to Consider (in order of value)

> **Lane constraint:** ResparQ is a **promotional intelligence** platform. Every touchpoint must be about surfacing or creating promotional value. No shipping info, trust badges, loyalty programs, or general e-commerce widgets — those are other apps' lanes.

| Touchpoint | Type | Why | Funnel stage |
|---|---|---|---|
| Promotion awareness | Passive (multiple formats) | Surfaces EXISTING store promotions to visitors who missed them (deep-link arrivals from ads, AEO/GEO, shared links). Costs the merchant nothing — no new discount, just visibility. Highest ROI touchpoint. | Product/collection pages (when visitor hasn't seen homepage) |
| Compare-at-price awareness | Passive (multiple formats) | Surfaces EXISTING markdowns the visitor may not notice. Shopify `compare_at_price` is already set on the product — ResparQ makes it prominent. "This item was $120 — now $89, you're saving $31." Zero cost to merchant, same AI-tested formats as promotion awareness (banner, price slash, badge, cart callout). | Product pages (when compare_at_price is set) |
| Free shipping progress bar | Passive (not a popup) | High conversion impact, doesn't annoy | Cart/browsing |
| Return visitor offer | Modal | Re-engage people who left before with a promotional offer | First pageview (returning) |
| Welcome offer | Modal | First-purchase promotional discount | First pageview (new) |
| Cart upsell/cross-sell | Modal or inline | Increase AOV with promotional bundle/add-on | Cart page |
| Post-purchase next-order offer | Modal or inline | Promotional offer to drive repeat purchase — **NOTE:** requires separate Shopify checkout extension, NOT the app proxy. Different integration surface, heavier lift. Build last. | Thank you page |

### Promotion Awareness Touchpoint — Detailed Spec

> **Core idea:** Stores run promotions (20% off, BOGO, seasonal sales) but visitors who arrive via deep links (Instagram ads, Google Shopping, AEO/GEO, shared links) land on product pages and never see the homepage banners. They're looking at full price while the store is literally running a sale. ResparQ surfaces the existing promotion to these visitors — zero cost to the merchant, pure conversion lift.

**Detection — does the store have an active promotion?**
- ResparQ already detects active promotions via promotional intelligence in `ai-decision.server.js`
- Shopify Admin API: `priceRules` / `discountNodes` to get active automatic discounts and discount codes
- Store the active promotion data (code, type, amount, end date) so the storefront JS can access it

**Filtering — mass promotions vs customer service codes:**
- **CRITICAL:** Only surface promotions intended for all customers. Never surface one-time CS codes.
- Filter using Shopify discount API fields:
  - `usageLimit`: must be `null` (unlimited) or `> 10` — codes with `usageLimit: 1` are almost certainly CS codes for individual customers
  - `customerSelection`: must be `ALL` — codes with `PREREQUISITE` are restricted to specific customers and should never be surfaced
  - `prerequisiteCustomerIds`: must be empty — if specific customer IDs are set, it's a targeted code
- **Automatic discounts** (applied at checkout without a code) are always safe to surface — they're inherently mass promotions
- **Additional safety:** if a code has been used 0 times and has a usage limit of 1, it's definitely a CS code. If a code has a very specific/unusual naming pattern (contains order numbers, customer names, "sorry", "cs-", "support-"), flag it as potentially CS and exclude by default
- **Usage velocity check:** the promo code must have been redeemed by **3+ unique customers in the last 24 hours** to qualify as an active mass promotion. This filters out old/stale codes that technically still exist but aren't part of a current campaign. **Exception:** if the code was created less than 24 hours ago AND passes all other filters (unlimited usage, ALL customers), surface it immediately — it's a fresh campaign that hasn't had time to accumulate uses yet. Query via Shopify Admin API `discountNode` → `usageCount` + `createdAt`, or track redemptions in ResparQ's own database.
- Store a `promotionType` field: `mass` (safe to surface) vs `targeted` (never surface) vs `unknown` (exclude by default, err on the side of caution)

**Detection — did this visitor miss the promotion?**
- Track `landingPage` signal: `window.location.pathname` on first pageview
- Track `pagesViewed` signal: list of pages visited this session
- If `landingPage` is a product or collection page AND the visitor has NOT visited the homepage → they likely missed the promotion
- If the visitor arrived from an ad (`utm_medium=cpc/paid`), AEO/GEO, or a direct product link → high probability they missed it

**Presentation — AI-tested formats (genes):**

The AI should test which presentation format converts best for each store. This is NOT a merchant setting — the AI learns the optimal format automatically.

| Gene: `promoFormat` | What it looks like | When it works best |
|---|---|---|
| `banner` | Slide-in toast/banner: "Sale happening now — 20% off everything with code SUMMER20" | General awareness, non-intrusive |
| `price_slash` | Injected near the product price: "~~$80~~ $64 with code SUMMER20" | Product pages, price-sensitive shoppers |
| `cart_callout` | Message in/near cart: "Apply SUMMER20 at checkout for 20% off your order" | Cart page, when customer is close to purchasing |
| `badge` | Small badge on product image or near CTA: "SALE 20% OFF" | Browse/collection pages, visual shoppers |

**AI genes for this touchpoint:**

| Gene | Values | What AI learns |
|------|--------|---------------|
| `promoFormat` | `banner`, `price_slash`, `cart_callout`, `badge` | Which presentation converts best for this store's audience |
| `promoCopyStyle` | `informational`, `urgency`, `savings_focused` | "Sale ends Sunday" vs "Save $16 on this item" vs "20% off everything" |
| `promoPlacement` | `top`, `bottom`, `inline_near_price`, `inline_near_cta` | Where on the page the promotion surfaces |
| `promoTiming` | `immediate`, `after_5s`, `after_scroll` | Show right away or after the visitor engages |

**Interaction with exit-intent modal:**
- If the visitor saw the promotion awareness touchpoint but still tries to leave WITHOUT applying the promo code → the exit-intent modal can reinforce: "Don't forget — your 20% off code SUMMER20 is still available"
- If the visitor already applied the promo code to their cart → exit-intent uses a different strategy (urgency, social proof, free shipping) instead of offering a new discount on top of an existing one
- The orchestrator checks `cartHasDiscount` signal (from `/cart.js` response `total_discount` field) before deciding whether to create a new ResparQ discount or reinforce the existing store promotion

**Landing page segmentation for orchestrator:**

| Signal | How to collect | Why it matters |
|---|---|---|
| `landingPage` | `window.location.pathname` on first pageview | Determines if visitor saw homepage promo banners |
| `landingPageType` | Parse path: `/products/*` = product, `/collections/*` = collection, `/` = homepage | Different touchpoint eligibility per page type |
| `hasVisitedHomepage` | Track in sessionStorage as visitor navigates | If they've been to homepage, they may already know about the promo |
| `entrySource` | Existing `trafficSource` signal (organic, paid, direct, social, aeo_geo, referral) | Ad and AEO/GEO traffic almost always deep-links |
| `cartHasDiscount` | `/cart.js` response `total_discount > 0` | Whether the visitor already applied a promo code |

**Revenue attribution for this touchpoint:**
- The store created the discount, but without ResparQ the visitor would never have known
- Attribution: if the visitor saw the promotion awareness touchpoint AND used the store's promo code → attribute the full purchase as ResparQ Revenue (the conversion would not have happened without the awareness)
- Track with a `resparq_promo_surfaced` flag in sessionStorage so the attribution is clean

### Compare-at-Price Awareness Touchpoint — Detailed Spec

> **Core idea:** Shopify products have a `compare_at_price` field that stores the original price before a markdown. Many themes show a slash-through price, but it's often subtle, and deep-link visitors may not notice it — especially on mobile. ResparQ makes the savings explicit and prominent.

**Detection:**
- Storefront JS reads the product's `compare_at_price` from the product JSON (available on product pages via `{{ product | json }}` or Shopify's global JS data)
- If `compare_at_price > price` → the product is on sale, savings = `compare_at_price - price`
- No API call needed — this data is already on the product page

**Presentation — same AI-tested format system as promotion awareness:**

| Gene: `compareFormat` | What it looks like |
|---|---|
| `banner` | Slide-in toast: "You're saving $31 on this item — was $120, now $89" |
| `price_slash` | Enhanced price display near buy button: "~~$120~~ $89 — Save 26%" |
| `cart_callout` | In cart: "You're saving $31 on Denim Jacket" |
| `badge` | Badge on product image: "SAVE $31" or "26% OFF" |

**AI genes:** Same structure as promotion awareness — `compareFormat`, `compareCopyStyle` (savings_amount vs savings_percent vs both), `comparePlacement`, `compareTiming`. The AI learns whether "$31 off" or "26% off" resonates better per store's audience.

**When NOT to show:**
- Visitor arrived from homepage and likely already saw sale banners
- Theme already has a prominent compare-at-price display (harder to detect — could check for existing strikethrough elements near the price)
- Product is not on sale (`compare_at_price` not set or equal to `price`)

**Revenue attribution:**
- If visitor saw the compare-at-price awareness AND purchased the item → attribute the purchase as ResparQ Revenue
- The product was already on sale, but the visitor may not have noticed without the prominent callout
- Track with `resparq_compare_surfaced` flag in sessionStorage

### Pricing & Revenue Metric Update

> **IMPORTANT:** As soon as a pre-add-to-cart touchpoint is added (free shipping bar, welcome offer, etc.), the revenue metric and calculation must be updated.

**Current metric:** "Recovered Revenue" — works for exit-intent only because the customer was leaving and ResparQ saved the sale.

**New metric:** "ResparQ Revenue" — measures the **incremental value created** by each touchpoint, not the total purchase.

**Revenue share rates (applied to ResparQ Revenue):**

| Tier | Rate | Why |
|------|------|-----|
| Starter ($29) | 5% | Higher rate, lower volume. Incentivizes upgrade to Pro. |
| Pro ($79) | 2% | AI generates more value, so lower rate still yields more absolute revenue. |
| Enterprise ($199) | 1% | Lowest rate, highest volume stores. Absolute dollars are highest. |

**Value calculation per touchpoint type:**

| Touchpoint | Attribution method | Value created |
|---|---|---|
| Exit-intent modal | RESPARQ discount code used | Full cart value (saved from $0) |
| Free shipping bar | Cart snapshot before bar vs cart at checkout | Delta only (e.g., cart was $60, purchased $85 → value = $25) |
| Cart upsell | Items added after upsell shown | Value of added items |
| Welcome offer | RESPARQ discount code used | Full purchase value (converted from bounce) |
| Return visitor modal | RESPARQ discount code used | Full purchase value (re-engaged from $0) |
| Promotion awareness | Visitor saw promo surfacing + used store's promo code | Full purchase value (visitor would have bounced or paid full price without awareness) |
| Compare-at-price awareness | Visitor saw savings callout + purchased the item | Full purchase value (visitor may not have noticed the markdown without ResparQ surfacing it) |
| Passive touchpoints (toasts, badges) | No direct attribution | Covered by subscription — no rev share |

**Why this model works:**
- Aligned incentives: ResparQ only earns when the merchant earns. Showing a pointless popup earns nothing.
- Discount codes provide clean attribution for modal-based touchpoints
- Cart snapshots provide clean attribution for passive upsell touchpoints (free shipping bar)
- No impression-based pricing concerns — merchants won't worry "the AI is spamming my customers to charge me more"
- The orchestrator actively suppresses low-value interventions, which aligns with the pricing model

**Dashboard display:** "ResparQ created $4,200 in incremental revenue this month. Your fee: $84 (2%)" — makes the ROI undeniable.

**Implementation notes:**
- Track `cartValueAtIntervention` on every touchpoint event (snapshot cart via `/cart.js` when touchpoint fires)
- Track `purchaseValue` when RESPARQ discount code is redeemed (Shopify webhook or order API)
- For free shipping bar: `resparqRevenue = purchaseValue - cartValueAtIntervention` (only if positive)
- For modal touchpoints with discount codes: `resparqRevenue = purchaseValue`
- Store per-touchpoint attribution in the `Conversion` table so the dashboard can break down value by touchpoint type
- Monthly billing: sum all `resparqRevenue` for the period, apply tier rate

---

## Reference Docs

| Doc | What it covers |
|-----|---------------|
| `ONBOARDING_PLAN.md` | Customer onboarding UX — checklist + Getting Started page |
| `AI_IMPROVEMENTS_PLAN.md` | 8 AI improvements with implementation details per section |
| `AI_SYSTEM_COMPLETE_GUIDE.md` | Current AI architecture — evolution, Thompson Sampling, gene pools |
| `AI_TECHNICAL_ARCHITECTURE.md` | Technical details of AI decision flow |
| `AI_PRO_VS_ENTERPRISE.md` | Differences between Pro and Enterprise AI |
| `DEVELOPER_ONBOARDING.md` | Dev environment setup and codebase walkthrough |
| `DEPLOYMENT_GUIDE.md` | Fly.io deployment, env vars, production config |
| `DATABASE_SCHEMA.md` | Prisma schema reference |

---

## Instructions for Claude

1. Read this file first
2. Pick the top unchecked item
3. Read its spec file (or inline spec) for implementation details
4. Build it, commit, push to your working branch
5. Tell the user to merge with: `git fetch origin <branch> && git checkout main && git merge origin/<branch> --no-edit && git push origin main`
6. Check off completed items in this file and push the update
7. Move to the next item
