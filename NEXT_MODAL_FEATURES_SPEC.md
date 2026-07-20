# Next Modal Features — Technical Spec

Status: PLANNED. Covers the remaining features from the modal-performance roadmap,
in ship order. `showProductImages` (gene + manual toggle + QA) already shipped
(commits `95c0e41`, `0e2b725`) and is the reference implementation for every
"wire a gene" checklist below.

Contents:
1. [Gene wiring checklist (shared)](#1-gene-wiring-checklist-shared)
2. [Subscription & mixed-cart support (TOP PRIORITY)](#2-subscription--mixed-cart-support-top-priority)
3. [Currency-framed savings math](#3-currency-framed-savings-math-dollar-framing)
4. [Product-aware copy](#4-product-aware-copy)
5. [Mobile back-button trigger](#5-mobile-back-button-trigger)
6. [Free-shipping threshold archetype](#6-free-shipping-threshold-archetype) ← includes no-free-shipping behavior
7. [Claimed-code reminder bar](#7-claimed-code-reminder-bar)
8. [Real inventory scarcity](#8-real-inventory-scarcity)
9. [Trust row](#9-trust-row)
10. [Held-code signal + margin-aware response](#10-held-code-signal--margin-aware-response)
11. [Cross-store device priors (deferred)](#11-cross-store-device-priors-deferred)

---

## 1. Gene wiring checklist (shared)

Every learnable toggle touches the same 9 points. Proven twice (`showSubhead`
retrofit, `showProductImages`). Reference diff: commit `95c0e41`.

| # | File | What |
|---|------|------|
| 1 | `prisma/schema.prisma` + migration | Column on `Variant` (default = OFF so existing variants are unaffected; gene enters via seeding/breeding/mutation) |
| 2 | `app/utils/gene-pools.js` | `[true, false]` (or enum) in each eligible archetype pool |
| 3 | `app/utils/variant-engine.js` — `createRandomVariant` | Random draw from pool |
| 4 | `variant-engine.js` — `generateDiverseVariants` | Deterministic 50/50 spread, **phase-offset from existing booleans** (`showSubhead: i % 2`, `showProductImages: Math.floor(i/2) % 2` — next boolean uses `Math.floor(i/4) % 2`) so seed genes don't correlate |
| 5 | `variant-engine.js` — crossover `childGenes` | Inherit-from-parent line |
| 6 | `variant-engine.js` — `geneToPoolKey` map | Mutation lookup |
| 7 | `variant-engine.js` — proven-gene inheritance switch (~line 366) | Cold-start override case |
| 8 | `app/cron/aggregate-gene-performance.js` | Add to `geneAggregates` dict + `determineBaseline` type coercion (bool/int) |
| 9 | `app/routes/apps.exit-intent.api.ai-decision.jsx` | Into `decision` object + BOTH response `variant` payloads (discount + no-discount paths) |

Client side: read `decision.variant.<gene>` in `resolveModalContent`, plumb via
`buildTemplateProps`, render in `modal-templates.js` (shared primitive +
dispatcher injection, never per-template edits).

Device learning is free: `VariantSegmentStat` cells + champion suspension are
gene-agnostic. Meta-learning is free once step 8 is done (vertical × AOV
cluster scopes included).

**Traffic discipline: max 1–2 new genes live per release.** Every binary gene
splits learning signal; per-gene marginal stats prevent combinatorial blowup
but not slower convergence.

---

## 2. Subscription & mixed-cart support (TOP PRIORITY)

Resparq is subscription-blind today: every cart is treated as one-time D2C.
Subscription (selling-plan) stores and mixed stores are a growing share of
Shopify and the app either breaks (codes rejected at checkout — now fixed) or
leaves its biggest levers unused (LTV-aware sizing, subscribe-and-save as the
exit offer). This section is the new top of the ship order.

**Policy decision (locked):** a Resparq discount applies to the FIRST purchase
only. Subsequent subscription billing cycles are never discounted.

### 2.0 Shipped foundation

Commit `1276574`: all 6 `discountCodeBasicCreate` sites in
`app/utils/discounts.js` + `app/utils/discount-codes.js` now set
`customerGets.appliesOnSubscription: true`, `appliesOnOneTimePurchase: true`,
and top-level `recurringCycleLimit: 1` (schema-verified field names). New codes
apply to subscription line items, first billing cycle only.

**Open gap:** code-reuse paths return pre-existing Shopify codes untouched —
`createDiscountCode` / `createFixedAmountDiscountCode` early-return on the
`codeDiscountNodeByCode` hit, and `createGenericDiscountCode` early-returns via
`checkDiscountCodeExists`. Codes minted before `1276574` stay
one-time-purchase-only. Fix: on the reuse path, fire a
`discountCodeBasicUpdate` setting the same three fields (idempotent, cheap —
one extra mutation per reuse until the fleet is backfilled; or a one-time
backfill script over codes matching our title patterns).

### 2.1 Cart subscription signal (foundation — everything below depends on it)

**Data source:** `/cart.js` line items carry `selling_plan_allocation` —
`null` for one-time items, an object (`selling_plan.id`, `selling_plan.name`,
per-cycle `price`) for subscription items. Already fetched twice per session;
zero new requests.

**Client** (`exit-intent-modal.js`):
- `getCartSnapshot()` (~line 973) computes alongside `productImages`:
  ```js
  const subLines = items.filter(i => i.selling_plan_allocation);
  const hasSubscriptionItems = subLines.length > 0;
  const subscriptionOnly    = hasSubscriptionItems && subLines.length === items.length;
  const subscriptionValue   = subLines.reduce((s, i) => s + i.final_line_price, 0) / 100;
  ```
  Return them from the snapshot next to `value` / `productImages`.
- `collectCustomerSignals()` (~line 894 return) adds:
  `cartSubscription: 'none' | 'mixed' | 'all'` and `subscriptionValue`
  (share computation server-side: `subscriptionValue / cartValue`).

**Server:**
- `AIDecision.signals` is a JSON string — the signal logs for free once the
  client sends it. No migration for decision logging.
- `VariantImpression` gains `cartSubscription String @default("none")`
  (mirror the `promoInCart` column + plumbing exactly: decision route stamps
  it at impression mint, aggregator can segment on it later).
- ai-decision route: thread `signals.cartSubscription` into the `decision`
  object so the client resolver can branch on it (both response payload paths,
  per checklist step 9).

**Effort:** Low. ~15 lines client, 1 column, 1 plumb-through. Ship first —
every other subsection reads this signal.

### 2.2 First-order copy honesty

**Rule:** when the cart contains subscription lines AND the decision mints a
discount, the modal must not imply the discount recurs.

- **Deterministic disclosure line, not a gene** (compliance, like the trust
  row's fixed "Secure checkout" line — merchants and shoppers must be able to
  rely on it 100% of the time, so it never enters a learning pool):
  `resolveModalContent` renders a fixed fine-print line under the offer when
  `decision.variant` carries a discount and `cartSubscription !== 'none'`:
  "Discount applies to your first order." Shared primitive in
  `modal-templates.js` (same dispatcher-injection pattern as
  `makeProductImageRow`; same skip list: top-banner, scratch-reveal get a
  shortened inline variant).
- **Savings math is already correct:** `{{savings_amount}}` (section 3)
  computes off `/cart.js` totals = first-cycle price. Note it, change nothing.
- **Banned-pattern guard:** add `/every\s+(order|month|delivery)/i` +
  `/forever/i` to `UNIVERSAL_BANNED_PATTERNS` for discount archetypes so
  generated copy (phase 7c) can never promise a recurring discount. The
  subscription-upsell archetype (2.4) is the one pool that legitimately says
  "every order" — its `copyBannedPatterns` omits these, exactly the
  free-shipping firewall pattern (section 6.2 mode `none`).

**Effort:** Low. One resolver branch + one primitive + 2 banned patterns.

### 2.3 LTV-aware offer sizing (margin engine)

**Hypothesis:** a subscription conversion is worth `expectedCycles × margin`,
not one order. The margin ceiling should therefore tolerate deeper first-cycle
discounts on subscription carts — payback arrives in renewals that Resparq
never discounts (2.0 guarantees this).

- **New Shop column:** `subscriptionExpectedCycles Float @default(3)` —
  merchant-editable in the settings Free Shipping/margin card cluster.
  Conservative default; merchants with real retention data can raise it.
- **Engine change** (deterministic, NOT a gene — zero stores, nothing to
  learn from yet; same promote-to-learned path as the intervention
  threshold): in the margin clamp
  (`getMaxDiscountForMargin(price, cost, minimumMarginPercent)`,
  MARGIN_PROTECTION_SPEC), the *effective* margin cost of a discount on
  subscription value is amortized:
  ```
  subShare       = subscriptionValue / cartValue          // 0..1
  effectiveCost  = discount × (1 - subShare) + discount × subShare / expectedCycles
  ```
  The ceiling check runs against `effectiveCost`, not raw `discount`. Pure
  one-time carts: `subShare = 0`, formula degenerates to today's behavior —
  regression-safe by construction (extend
  `scripts/dev/verify-margin-invariant.mjs` with a `subShare = 0` identity
  case).
- **Hard clamp unchanged:** the offer can only move within the archetype's
  existing `offerAmounts` pool. Amortization unlocks deeper *pool values*
  previously vetoed by margin; it never invents amounts.
- Log `subShare` + amortized cost on the decision for auditability.

**Effort:** Med. One formula + column + settings field + invariant test case.

### 2.4 Subscribe-and-save exit offer (mixed stores) — new archetype

**Hypothesis:** for a one-time cart at a store that sells selling plans, the
best exit offer is the merchant's OWN subscription discount ("Save 15% on
every order — subscribe"). The selling-plan discount funds the save, Resparq
mints nothing, the merchant gains recurring revenue. No competitor runs
subscription upsell as an exit-intent play — this is the differentiator.

New archetype `subscription_upsell`, following the free-shipping archetype
contract (section 6) exactly: capability-gated, structurally unreachable when
ineligible.

**Capability model** — client-detected, zero scope changes:
- The storefront AJAX product endpoint `/products/{handle}.js` includes
  `selling_plan_groups[]` (`selling_plans[].id`, `.name`,
  `.price_adjustments[]` with `value_type: percentage | fixed_amount | price`
  and `value`). No auth, no Admin API.
- Shop column `subscriptionUpsellMode String @default("off")` (`off` | `on`)
  — merchant opt-in in settings (Quick Setup card, presence-marker pattern).
  Default off: switching a line to a subscription is a contract-shaped action;
  merchants must opt in.

**Eligibility (client resolves, server gates):**
- `subscriptionUpsellMode === 'on'`
- Cart non-empty, `cartSubscription === 'none'` (never pitch subscribing to
  someone already subscribing)
- Top cart item (existing `getCartSnapshot()` price-desc ordering) has ≥1
  selling plan whose price adjustment is `percentage` or `fixed_amount` with
  value > 0. Plans with `value_type: 'price'` or zero savings → ineligible
  (no honest savings claim possible — same no-fabrication rule as
  scarcity/timers).
- Client fetches `/products/{handle}.js` for the top item lazily at decision
  prefetch (parallel with the decision call; cache per handle in
  sessionStorage) and ships
  `topItemSellingPlan: { id, name, savingsType, savingsValue } | null` in
  signals.

**Offer mechanics:**
- `decision.type: 'subscription_upsell'` — no discount code minted, rides the
  existing no-code render path (like mode-`threshold` free shipping).
- New placeholders: `{{plan_savings}}` (client-formatted: `15%` or
  `formatCurrency(x)` — percentage plans are currency-closed like section 3;
  fixed-amount plans inherit the same base-vs-presentment caveat as fixed
  offers, so v1 restricts fixed-amount plan claims to shops where presentment
  = base currency) and `{{plan_name}}`.
- CTA action: `POST /cart/change.js` with
  `{ id: <line key>, quantity, selling_plan: <planId> }` — switches the line
  to the subscription in place — then redirect per the variant's `redirects`
  gene (`cart` | `checkout`). On AJAX failure: fall back to redirecting to the
  product page (never dead-end the click).
- Post-switch, re-fetch `/cart.js` and confirm `selling_plan_allocation` on
  the line before claiming success in the UI (two-phase confirm, same
  philosophy as render confirmation in `b28956e`).

**Archetype definition (gene-pools.js):**
```js
subscription_upsell: {
  archetypeName: 'SUBSCRIPTION_UPSELL',
  archetypeDescription: 'Convert a one-time cart to the merchant\'s own selling plan; savings funded by the plan, no code minted',
  slots: ['headline', 'subhead', 'cta'],          // no discount_code slot
  requiredSlots: ['headline', 'cta'],
  requires: { cartItemsMin: 1, subscriptionUpsellCapability: true }, // new require key, enforced in selectBaseline
  copyBannedPatterns: UNIVERSAL_BANNED_PATTERNS   // minus the recurring-language patterns added in 2.2
    .filter(p => !RECURRING_LANGUAGE_PATTERNS.includes(p)),
  offerAmounts: [0],                              // value comes from the plan, margin ceiling n/a
  headlines: ['Save {{plan_savings}} on every order', 'Never run out — {{plan_savings}} off when you subscribe', ...],
  ctas: ['Subscribe & save {{plan_savings}}', ...],
  redirects: ['cart', 'checkout'],
  urgency: [false],                               // nothing expires — honest-urgency rule
  showSubhead: [true, false],
  showProductImages: [true, false],
  triggerTypes / idleSeconds / templateIds: same as siblings
}
```

**Firewall (mode `off`):** identical 4-layer pattern as free-shipping mode
`none` (section 6.2): selection gate on `subscriptionUpsellMode`, seeding
skip, recurring-language banned patterns stay universal for all other pools,
render-time clamp with fallback to `conversion_no_discount` + nightly orphan
sweep on mode transitions.

**Learning:** new baseline through the standard pipeline — neutral 1.0
archetype prior, variant seeding, Thompson selection, meta-learning via
`determineBaseline` (no change needed). Zero-discount conversions will
structurally beat discount archetypes on profit-per-impression — correct, but
let evidence, not priors, move share (same note as free-shipping 6.4).

**Effort:** High. New pool + 1 Shop column + settings card + client plan fetch
+ cart/change CTA path + two-phase confirm + firewall. Ship after 2.1–2.3.

### 2.5 Active-subscriber suppression

**Hypothesis:** a logged-in customer with a live subscription buying a refill
or add-on converts anyway; discounting them is pure margin burn.

- **Detection:** the ai-decision route already enriches logged-in visitors via
  Admin GraphQL (`apps.exit-intent.api.ai-decision.jsx` ~lines 294–321,
  `numberOfOrders` + `amountSpent`). Add `tags` to that same query — zero new
  scope, zero new round-trips. Subscription apps tag customers
  (Recharge: "Active Subscriber"; Appstle/Skio similar). Signal:
  `isActiveSubscriber = tags.some(t => /active.?subscri|subscription/i.test(t))`.
  (Direct `subscriptionContracts` reads are NOT available — that field is
  scoped to the app that owns the contracts; tags are the practical proxy.)
- **Engine:** deterministic prior, same hook as `promoInCart` /
  held-code (section 10): down-weight discount archetypes, up-weight
  no-discount pools + `no_intervention` scoring. NOT a hard block — gift and
  one-time-item purchases are real; the prior nudges, the bandit keeps
  exploring.
- **Known limitation:** guest subscribers are invisible. Accept it —
  subscription customers are disproportionately logged in (account required
  to manage the subscription).
- Log the signal in `AIDecision.signals` (free) from day one, condition later
  — telemetry-first, same sequencing rule as section 10.

**Effort:** Low. One GraphQL field + regex + one scoring adjustment.

### 2.6 Subscription-aware attribution

Two correctness rules and one reporting upgrade:

- **Exclude renewals from attribution.** Recurring billing orders arrive on
  the same `orders/create` webhook with `source_name: 'subscription_contract'`.
  `webhooks.orders.create.jsx` currently doesn't check `source_name` — a
  renewal landing inside an attribution window would count as a recovered
  order Resparq had nothing to do with, silently inflating measured lift.
  Guard at the top of the handler: `source_name === 'subscription_contract'`
  → log + return before any attribution matching. (Holdout lift integrity
  depends on this — it's the highest-priority line in 2.6.)
- **Tag subscription conversions.** `Conversion` gains
  `subscriptionConversion Boolean @default(false)` — set when the matched
  decision's logged `cartSubscription !== 'none'` (join at conversion time via
  the existing decision linkage; no order-payload parsing needed, the REST
  webhook payload doesn't reliably expose selling plans).
- **Report LTV-adjusted value, clearly labeled.** Dashboard/analytics add
  "Subscriptions started: N" and an *estimated* LTV column
  (`orderValue × subscriptionExpectedCycles`, subscription share only),
  explicitly labeled as merchant-configured estimate. First-order revenue
  stays the headline number. (Consistent with the no-invented-metrics rule:
  per-store measurement + labeled estimates only, no fabricated uplift.)

**Effort:** Low-Med. One webhook guard + one column + two dashboard fields.

### 2.7 Interactions with existing planned features

- **Free-shipping archetype (section 6):** subscription items usually ship
  free per plan terms. Add to its selection gate: ineligible when
  `cartSubscription === 'all'`. Mixed carts stay eligible (threshold applies
  to whole cart).
- **Currency framing (section 3):** no change — savings compute off first-cycle
  cart totals, correct by construction. The disclosure line (2.2) carries the
  recurrence honesty.
- **Held-code signal (section 10):** an active-subscriber signal and a
  held-code signal can co-occur; both are down-weight priors on the same
  scoring hook — they compose additively, no special-casing.
- **Reminder bar (section 7):** inherits the disclosure line (2.2) when the
  offer it reminds about was minted against a subscription cart.

### 2.8 Ship order within this section

| Slice | Contents | Why |
|---|---|---|
| A | 2.1 signal + 2.2 disclosure + 2.6 webhook guard & column | Correctness + telemetry; tiny, zero learning surface |
| B | 2.0 legacy-code backfill + 2.3 margin amortization + 2.5 suppression | Engine wins on the new signal |
| C | 2.4 subscription-upsell archetype | The differentiator; needs A's signal and 2.2's banned-pattern split |

---

## 3. Currency-framed savings math ("dollar framing")

**Hypothesis:** "Save $12.60 on your $84 order" beats "Save 15%". Concrete
amounts > abstract percentages, especially at higher cart values. "Dollar" is
shorthand — the feature is **currency-framed** and must work identically for
€, £, ¥, kr, etc.

### Design
Not a copy-pool fork — a **placeholder + gene** so every existing headline
keeps working:

- New placeholders resolved client-side in `resolveModalContent` (which already
  resolves `{{amount}}`, `{{threshold}}`, `{{threshold_remaining}}`,
  `{{percent_to_goal}}` against live cart value):
  - `{{savings_amount}}` → `formatCurrency(cartValue * amount / 100)` for
    percentage offers.
  - `{{cart_total}}` → `formatCurrency(cartValue)`
- New gene `amountFraming: ['percent', 'currency']` on the two
  `*_with_discount` pools only (no-discount archetypes have nothing to frame).
- When `amountFraming === 'currency'` AND offer type is percentage AND
  `cartValue > 0`: the client does NOT attempt to rewrite `{{amount}}%`-style
  copy (too fragile). Instead the pools gain 2–3 currency-framed
  headline/subhead entries using the new placeholders, and the gene selects
  which sub-pool the variant draws from at creation time (same pattern as
  `urgency` selecting `headlinesWithUrgency`).

### Currency handling (multi-currency / Shopify Markets)
- **All money strings are produced client-side by `formatCurrency`**
  (`exit-intent-modal.js:67`), which already resolves
  `window.Shopify.currency.active` + buyer locale via `Intl.NumberFormat`.
  A German shopper on a Markets store sees `12 €`, a Japanese shopper `¥1,200`
  (zero-decimal currencies are handled by Intl; the helper already forces
  0 fraction digits). **No copy-pool entry may ever contain a literal
  currency symbol** — placeholders only. Add a startup assertion in
  `gene-pools.js` (dev-time, mirrors the banned-pattern philosophy):
  reject pool entries matching `/[$€£¥]\s?\d|\d\s?(USD|EUR|GBP)/`.
- **Why the gene is percentage-offers-only:** the savings math
  `cartValue × pct / 100` is currency-closed — `/cart.js` returns cart totals
  in the buyer's presentment currency, so the computed savings is
  automatically in the same currency the buyer pays in. Fixed-amount and
  threshold offers are NOT currency-closed: `decision.amount` is denominated
  in the shop's base currency, and formatting it with the buyer's presentment
  symbol would show the wrong number on Markets stores (pre-existing issue on
  the `{{amount}}` placeholder for fixed/threshold; tracked separately, not
  made worse here). So: `amountFraming = 'currency'` renders percent framing
  whenever `decision.type !== 'percentage'` — the resolver checks type, not
  just the gene.
- **Meta-learning is currency-agnostic for free:** headline gene values
  aggregate cross-store as the raw template string (placeholder unfilled), so
  a currency-framed headline proven on EUR stores transfers to USD stores
  without conversion.

### Guards
- `cartValue === 0` at render → savings copy would say "Save $0" (or `0 €`):
  client falls back to the percent variant of the same slot (resolver already
  has cartValue; add the branch where placeholders are filled).
- Brand-safety validator (`isValidHeadline` etc.) must accept the new pool
  entries — they're in-pool so this is automatic; generated-copy prompt
  (phase 7c) should be told about the new placeholders so it can emit them.
- Generic-code amount-drift reconciliation (ai-decision.jsx ~line 890) already
  rewrites `decision.amount` before the client fills placeholders — dollar
  framing inherits that correctness for free.

### Effort
Low. Steps 1–9 checklist + ~6 new pool strings + one resolver branch.
No schema change beyond the gene column (`amountFraming String @default("percent")`).

---

## 4. Product-aware copy

**Hypothesis:** "Your Blue Hoodie is still here" beats generic copy. The item
name creates ownership.

### Design
- New placeholder `{{top_item}}` → title of the highest-priced cart item.
  Client already computes this ordering in `getCartSnapshot()` (sorts
  `cart.items` by price desc); expose `topItemTitle` alongside
  `productImages`.
- 2–3 headline entries per archetype using `{{top_item}}`, tagged as their own
  sub-pool `headlinesWithProduct` (mirrors `headlinesWithSocialProof`).
- Gene: reuse nothing — this is a **copy variant**, not a toggle. The
  headline gene already IS the arm; product-aware entries compete against
  static and generated copy through normal Thompson draws. Zero new columns.

### Guards
- Truncate titles > 30 chars at word boundary + "…" (long product titles wreck
  headline layout at mobile sizes; verify in qa-product-images.html at 375px).
- Strip vendor SKU-ish noise: if title matches `/^[A-Z0-9\-_]{8,}$/` (all-caps
  SKU), fall back to non-product copy for that render (client-side check in
  the same resolver branch that fills the placeholder).
- Empty cart at render → placeholder unresolvable → resolver swaps to the
  paired non-product entry (each product headline declares a fallback index).
- Meta-learning: headline gene values are the literal strings — a
  `{{top_item}}` headline aggregates cross-store as the TEMPLATE string (the
  placeholder, not the filled value), which is exactly right.

### Effort
Low-Med. Pool entries + resolver + fallback pairing. No migration.

---

## 5. Mobile back-button trigger

**Hypothesis:** Mobile has no mouse-leave; idle is the only trigger today.
Back-button interception fires at true exit moment on the majority device.

### Design
- New value in the existing `triggerTypes` gene pool:
  `['exit_intent', 'idle', 'exit_intent_or_idle', 'back_button_or_idle']`.
  No new column — `triggerType` is already a learnable string gene, already
  aggregated (fixed in `95c0e41`), already inherited.
- Client (`exit-intent-modal.js`, `setupAITriggers` + manual trigger setup):
  ```
  armBackTrap():
    history.pushState({ resparq: true }, '')   // sentinel entry
    window.addEventListener('popstate', onPop)
  onPop():
    if modal not yet shown && cart has items && guards pass:
      showModal()                               // consumes the sentinel; user stays on page
    else:
      history.back()                            // pass-through: don't trap a real exit
  ```
- Arm ONLY when: mobile device, `triggerType` includes `back_button`, cart
  non-empty, frequency guards pass (same gate as `setupIdleTrigger`). Never arm
  on desktop.
- Disarm after first fire (one interception per session, hard rule) and on
  `pagehide`. If the shopper dismisses the modal and presses back again, the
  second press must actually navigate.

### Guards
- **This is the most complaint-prone pattern in the category.** Gate rollout:
  Enterprise + a per-shop flag (`enableBackButtonTrigger`, default false) in
  addition to the gene, mirroring `enableSurfaceArm`. The gene learns whether
  it converts; the flag lets a merchant kill it instantly.
- Never combine with pill-opener escalation watch (a pill session already has
  a reserved second surface; back-trap on top = two interruptions).
- iOS Safari swipe-back does not reliably fire `popstate` before navigation —
  accept the miss; Android + in-app browsers are the win.
- Journey event: log `trigger: 'back_button'` in `triggerReason` so the
  intervention-threshold bandit learns show/skip for this trigger bucket
  (plumbing exists — `triggerReason` already flows to
  `recordInterventionOutcome`).

### Effort
Med. Client trap (~60 lines incl. guards) + pool value + shop flag + settings
toggle. Gene/meta wiring is free (existing `triggerType` pipes).

---

## 6. Free-shipping threshold archetype

**Hypothesis:** "You're $12 from free shipping" converts without eating product
margin. Shipping-cost aversion is the #1 stated abandonment reason in every
Baymard survey.

This is a **new archetype** (new gene pool + baseline), not a gene — it changes
what the modal promises, so it must obey the archetype contract in
`gene-pools.js` (slots / requiredSlots / requires / copyBannedPatterns).

### 6.1 Capability model — the core design question

The app cannot see shipping rates without the `read_shipping` scope (we hold
`write_products, write_discounts, read_orders` — a scope addition forces a
re-auth prompt on every install). So capability is **merchant-declared first,
API-verified later**:

New Shop columns:
```prisma
freeShippingMode      String  @default("none")  // "none" | "threshold" | "offer"
freeShippingThreshold Float?                    // required when mode = "threshold"
```

Settings UI (Quick Setup → new "Free Shipping" card, presence-marker pattern
from `showProductImages`):
- "My store offers free shipping over $___" → mode `threshold`
- "Let Resparq offer free shipping as an incentive" → mode `offer`
- Neither → mode `none` (default)

### 6.2 The three modes

**Mode `threshold` — NUDGE.** Store has a standing threshold; the modal just
surfaces proximity. No discount code minted; the store's own rates apply at
checkout.
- Copy: "You're {{shipping_remaining}} away from free shipping."
- Requires `cartValue < freeShippingThreshold` (already qualifying carts get
  "You've unlocked free shipping — nothing extra to pay" congratulation copy,
  same enforce pattern as the THRESHOLD_DISCOUNT client branch).
- `decision.type: 'no-discount'` mechanics (no code) with archetype-specific
  copy — reuses the whole no-code render path.

**Mode `offer` — MINT.** Store has no standing free shipping, but merchant
opted in to using it as an incentive. The app mints a real Shopify
free-shipping discount:
- New util `createFreeShippingDiscount(admin, minSubtotal, prefix)` in
  `discount-codes.js` using the `discountCodeFreeShippingCreate` GraphQL
  mutation (covered by the existing `write_discounts` scope — **no scope
  change**). 24h expiry, same shape as `createPercentageDiscount`.
- Optional merchant-set `minSubtotal` floor (margin guard for cheap carts
  where shipping > margin; clamp: if `cartValue < minSubtotal`, archetype is
  ineligible for this visitor, fall through to normal baseline selection).
- Copy: "Free shipping on this order — applied at checkout."
- `decision.type: 'free_shipping'`, code flows through the existing
  `/discount/CODE?redirect=/checkout` auto-apply path unchanged (Shopify
  session-discount endpoint accepts free-shipping codes).

**Mode `none` — INELIGIBLE. (The "store doesn't offer free shipping" answer.)**
The archetype must be structurally unreachable, not just unlikely:
1. **Selection gate:** `selectBaseline` / the archetype resolver never returns
   the free-shipping baseline unless `shop.freeShippingMode !== 'none'`. This
   is the primary gate — same layer that forces `pure_reminder` at
   aggression 0.
2. **Seeding gate:** variant population seeding skips the pool for mode-`none`
   shops, and proven-gene inheritance never imports genes whose baseline is
   the free-shipping one into other pools (`determineBaseline` keys genes to
   their baseline, so this holds automatically).
3. **Copy firewall stays up:** `UNIVERSAL_BANNED_PATTERNS` keeps
   `/free\s+shipping/i` for ALL other archetypes. Only the new pool's
   `copyBannedPatterns` omits it. A mode-`none` shop can therefore never
   render the words "free shipping" from any pool, generated copy included
   (the generated-copy validator applies per-archetype banned patterns).
4. **Render clamp (belt-and-suspenders):** ai-decision route re-checks mode at
   decision time; if a stale variant carries the baseline (e.g. merchant
   turned the toggle off after variants seeded), swap to
   `conversion_no_discount` fallback copy exactly like the generic-code
   type-mismatch fallback (~line 922) — customer sees a valid modal, never a
   broken promise. Log loudly; the nightly evolution cycle kills orphaned
   variants (`status: 'dead'`) for shops whose mode changed.

Mode transitions: `threshold → none` and `offer → none` trigger the same
orphan-kill sweep. No data loss — dead variants keep their stats for
meta-learning.

### 6.3 Archetype definition

```js
// gene-pools.js
free_shipping: {
  archetypeName: 'FREE_SHIPPING',
  archetypeDescription: 'Shipping-cost objection removal: nudge to a standing threshold, or mint a free-shipping code',
  slots: ['headline', 'subhead', 'cta', 'discount_code'],   // code only in offer mode
  requiredSlots: ['headline', 'cta'],
  requires: { cartItemsMin: 1, freeShippingCapability: true },  // NEW require key, enforced in selection gate
  copyBannedPatterns: UNIVERSAL_BANNED_PATTERNS.filter(p => p.source !== 'free\\s+shipping'),
  offerAmounts: [0],            // value is shipping, not % — margin ceiling not applicable
  headlines / subheads / ctas:  // mode-split sub-pools:
    headlinesThreshold: ['You\'re {{shipping_remaining}} from free shipping', ...],
    headlinesOffer:     ['Free shipping on this order', ...],
  redirects: ['cart', 'checkout'],
  urgency: [true, false],       // offer mode only (24h code expiry is real); threshold mode forces false
  showSubhead: [true, false],
  showProductImages: [true, false],
  triggerTypes / idleSeconds / templateIds: same as siblings
}
```

New placeholder `{{shipping_remaining}}` =
`formatCurrency(freeShippingThreshold - cartValue)`, computed **client-side**
like `{{threshold_remaining}}` — the server ships the raw
`freeShippingThreshold` on the decision, the client does the subtraction and
formatting. Currency caveat: the merchant enters the threshold in the shop's
base currency, and on Shopify Markets stores `cartValue` is presentment
currency — same class of mismatch as fixed-amount offers. v1: threshold mode
is limited to shops whose presentment currency equals the base currency
(check `cart.currency` vs a `shopCurrency` field shipped on settings; on
mismatch, treat the visitor as mode-`offer`-or-skip). Offer mode is unaffected
(free shipping is free in any currency). `freeShippingThreshold` joins the
shop-settings API payload.

### 6.4 Learning integration
- New baseline string `free_shipping` flows through: variant seeding,
  Thompson selection, archetype priors (`archetype-priors.js` map gets a
  neutral 1.0 entry until data exists), meta-learning aggregation
  (`determineBaseline` needs no change — it reads baselines off variants),
  cluster priors.
- Holdout measurement: nothing to change — holdout is decision-level,
  archetype-agnostic.
- **Threshold-mode conversions have no discount cost** → profit-per-impression
  will structurally beat discount archetypes. That's correct (it IS cheaper),
  but cold-start priors should not let it cannibalize before data: neutral
  archetype prior, let evidence move it.

### 6.5 Effort
Med-High. New pool + 2 Shop columns + settings card + selection/seeding gates +
mint util + render branches + orphan sweep. The mode-`none` firewall is mostly
free because it reuses existing patterns (aggression-0 gate, generic-code
fallback, banned-pattern per-pool arrays).

---

## 7. Claimed-code reminder bar

**Hypothesis:** Shopper clicks CTA / copies code, then doesn't check out. A
persistent slim bar ("SAVE15 applied — expires in 3:59:12 → Checkout")
recovers them on later pages.

### Design
- Builds on the existing pill: `buildPendingOfferData()` +
  sessionStorage persistence + `bootPersistedPill()` already survive
  navigation. The reminder bar is a **variant of the pill for the
  post-engagement state**: pill today mounts on dismissal; the bar mounts on
  `ctaClicked === true` sessions that return to a non-checkout page with the
  offer still live and cart non-empty.
- State machine (sessionStorage `resparqPendingOffer` gains a `state` field):
  `offered → engaged (CTA clicked) → redeemed (conversion) | expired`.
  Bar renders only in `engaged`. Existing purchase-detection
  (`detectPostCheckoutConversion`) clears it on `redeemed`.
- Render: new slim component in `modal-templates.js` (shares `tokensFor`),
  bottom-fixed, real countdown from `offerExpiresAt` (no fake urgency — absent
  expiry = no timer, matches timer-front rule). Single CTA → existing
  `/discount/CODE?redirect=/checkout` path.
- Dismissable; dismissal is permanent for the session (respect the "no").

### Learning
- Not a variant gene (it renders across pages after the variant did its job).
  Learn it at the **surface-arm layer**: journey events
  `reminder_bar:shown / clicked / dismissed` via the existing
  `sendJourneyEvent` plumbing, attributed by the stamped `aiDecisionId`.
  Per-shop on/off arm with Thompson sampling comes later if volume justifies;
  ship v1 as an Enterprise flag (`enableReminderBar`).

### Effort
Med. Component + state field + mount logic (~120 lines client) + journey
events. No schema change beyond the shop flag.

---

## 8. Real inventory scarcity

**Hypothesis:** "Only 3 left" moves fence-sitters — but only honest counts
(hard rule: no fabricated urgency, consistent with the timer/urgency policy).

### Design
- Data: `/cart.js` does NOT include inventory. Server-side fetch at decision
  time: `productVariants(ids)` GraphQL for the cart's variant IDs (client
  already sends cart contents in signals), read `inventoryQuantity` +
  `inventoryPolicy`. Covered by existing `write_products` scope
  (read implied). Cache per shop+variant 5 min (inventory is jittery;
  staleness beyond that risks lying).
- Eligibility: only when `inventoryQuantity <= 5`, `> 0`, tracking enabled,
  and `inventoryPolicy === 'DENY'` (continue-selling items are never "almost
  gone" — that would be a lie).
- Copy: placeholder `{{stock_count}}` + sub-pool entries
  (`headlinesWithScarcity`) gated by a `scarcity: [true, false]` gene on the
  two conversion pools. Server resolves eligibility and ships
  `stockCount` on the decision; ineligible renders fall back to the paired
  non-scarcity entry (same fallback mechanic as product-aware copy).
- Interaction with `urgency` gene: mutually exclusive in copy selection
  (scarcity + expiry countdown in one headline reads as spam); if both genes
  are true, scarcity wins the headline, urgency keeps the timer.

### Effort
Med-High. GraphQL fetch + cache + eligibility + gene + sub-pools. The decision
endpoint gains one dependent API call — keep it parallel with the discount
mint to avoid latency regression.

---

## 9. Trust row

Payment-method icons + guarantee line above the CTA.

- Gene: `showTrustRow: [true, false]`, all pools. Checklist 1–9.
- Render: shared primitive next to `makeProductImageRow`, same dispatcher
  injection, same skip list (top-banner, scratch-reveal).
- Icons: inline SVGs bundled in `modal-templates.js` (no external requests
  from the storefront); show only methods the shop actually offers — read
  `window.Shopify.PaymentButton` hints is unreliable, so v1 ships the
  generic lock + "Secure checkout" line and NO brand marks (brand marks
  imply acceptance; wrong marks = merchant complaint).
- No guarantee copy ("money-back" is in `UNIVERSAL_BANNED_PATTERNS` for good
  reason — merchants may not offer it). Line is fixed: "Secure checkout".
- Effort: Low. Ship alongside another gene release, not alone (weakest
  expected effect; don't spend a solo learning cycle on it).

---

## 10. Held-code signal + margin-aware response

**Hypothesis:** a customer who just redeemed an email-capture popup (15% off
for their email) already holds a discount. Minting a second one burns margin
and trains discount-hunting. The profitable plays are (a) non-discount
interventions, or (b) reminding them to *use the code they already have* —
recovery at zero incremental margin cost.

### Detection (client)

Builds on the competing-popup gate (commit `75b83a5`), which already locates
vendor popups in the DOM. Three sources, descending confidence:

1. **Shopify `discount_code` cookie** — vendors that apply codes via
   `/discount/CODE` redirect set it; readable from JS. Exact code, highest
   confidence. Nearly free to check.
2. **Same-origin popups (Klaviyo, Privy):** capture-phase `submit` listener
   scoped to the detected popup subtree → `engaged`. Best-effort success-state
   scrape for a code-shaped token → `heldCode`. Fragile per vendor; fail to
   `engaged` when the scrape misses.
3. **Iframe vendors (Attentive etc.):** cross-origin, interaction invisible.
   Can only mark `shown`.

Signal shape in `collectCustomerSignals()`:
`emailPopup: { confidence: 'redeemed' | 'engaged' | 'shown' | 'none', heldCode: string | null }`.
Persist in sessionStorage — redemption often happens pages before the decision.

**PII rule:** never read or store the email input's value. Code only. (Email
capture is permanently out of scope; this signal must not creep toward it.)

### Telemetry first (build this slice before the response mode)

Highest-priority slice of this feature — with zero stores, collision and
held-code rates are unmeasured guesses. Ship the measurement, then decide:

- Journey events for the shipped competing-popup gate (`75b83a5`):
  `gate:deferred / gate:resumed / gate:dropped` via the existing
  `sendJourneyEvent` plumbing. Gives the dashboard an answer to "why didn't
  the modal show" and quantifies real vendor-collision rates per shop.
- Log the `emailPopup` signal (confidence tier + whether a code was
  captured) on `AIDecision` from day one, before any engine behavior changes.
- The response mode below gets built — or cut — on these measured rates.

Effort: Low (~30 lines client, journey plumbing exists).

### Sibling signal: automatic discounts

A sitewide automatic discount means every cart is already discounted — same
margin logic as a held code, no popup involved. The `promoInCart` signal
(cart-level/item-level discount from `/cart.js`) already exists on
`VariantImpression` — it is collected-not-conditioned today. Feed it into the
same deterministic prior: discount archetypes down-weighted when the cart is
already in a promo. No new detection work, just the engine hook.

### Decision engine (server)

Deterministic prior, **not a gene** — zero stores means nothing for the bandit
to learn from yet; hard-code the sensible prior, promote to learned weighting
once volume exists (same path as the adaptive intervention threshold).

- `redeemed` / `engaged` → down-weight discount archetypes, up-weight
  no-discount pools and `no_intervention` scoring.
- `heldCode` known → new response mode **held-code reminder**: copy reminds
  them the code they claimed still works ("Your welcome code is waiting — it
  applies at checkout"), CTA → `/discount/{heldCode}?redirect=/checkout`.
  **Never mint a Resparq code in the same session** — the double-discount ban
  is absolute regardless of what the AI scores.
- Log the signal + chosen response on `AIDecision` so the prior can be
  audited and later learned.

### Guards

- Foreign code validity/amount is unknown unless the cookie/scrape provided
  it — reminder copy stays generic ("your welcome code"), never asserts "15%"
  it can't verify. No fabricated claims, same rule as timers/scarcity.
- Scrape false positives: require the token to appear *after* a submit inside
  the popup subtree, not on first render (pre-filled "WELCOME15" teaser copy
  would otherwise mark every visitor `redeemed`).
- `confidence: 'shown'` alone changes nothing — seeing a popup isn't holding
  a code.
- **Resparq's own codes are not "held codes."** The `discount_code` cookie is
  also set by Resparq's own `/discount/CODE?redirect=/checkout` CTA. Detection
  must exclude self-issued codes via the existing `getIssuedCodes()` +
  prefix-match mechanics (`findAppliedIssuedCode`) — otherwise the signal
  fires on our own offer and suppresses the follow-up it was meant to enable.
- **Reverse stacking is accepted.** The gate yields to vendors, but nothing
  stops a vendor's exit popup from landing on top of an already-open Resparq
  modal. Mitigation: max z-index on our overlay; no further engineering.

### Positioning

The gate is invisible unless told: "Resparq automatically detects and yields
to your email capture popup" goes on the app listing and landing page — it
directly defuses the "will this fight my Klaviyo popup?" objection.

### Effort

Detection Low-Med (~80 lines riding on the gate). Engine prior Med (scoring
adjustment + reminder response mode). The reminder *surface* reuses the
claimed-code bar component (section 7) — sequence this after release 4 so the
component exists.

---

## 11. Cross-store device priors (deferred)

Known gap, out of scope for this cycle: `MetaLearningGene.deviceType` column
exists but aggregation only writes vertical × AOV scopes, and proven-gene
inheritance is seed-time (device-agnostic). Within-store device learning
already works via `VariantSegmentStat` cells. Revisit when the network has
enough per-device volume that device-scoped `MetaLearningGene` rows would
clear the `sampleSize >= 3, confidence >= 0.7` inheritance bar — requires
aggregating from `VariantImpression` (which carries `deviceType`) instead of
pooled `Variant` totals, plus serve-time gene biasing to consume the rows.

---

## Ship order

| Release | Contents | Why together |
|---|---|---|
| 1 | **Subscription slices A + B (section 2.8)**: cart signal, disclosure line, renewal-attribution guard, legacy-code backfill, margin amortization, subscriber suppression | Top priority. Correctness + telemetry first, engine wins in the same release; no new learning surface (deterministic priors + one impression column) |
| 2 | Currency framing + product-aware copy | Both are copy-pool work on existing genes/placeholders; one resolver PR; no new learning surface beyond one gene. Disclosure line (2.2) must already be live so currency-framed savings on subscription carts stay honest |
| 3 | **Subscription-upsell archetype (2.4)** + free-shipping archetype | Both are capability-gated archetypes sharing the same firewall pattern; one selection-gate PR; free-shipping gains its `cartSubscription === 'all'` ineligibility rule (2.7) here |
| 4 | Back-button trigger + reminder bar | Both are session-flow features; test interaction between them explicitly (bar must not mount in a back-trapped session that never engaged) |
| 5 | Scarcity + trust row | Scarcity carries the release; trust row rides along |
| 6 | Held-code signal + margin-aware response | Needs the reminder-bar component (release 4) and the competing-popup gate (shipped `75b83a5`); detection + engine prior land together. The telemetry slice (gate journey events + signal logging) is release-independent — ship it with whichever release goes out next |

Each release: run the aggregator dry (`npm run aggregate-genes`) against dev
data before deploy; QA every template × mobile/desktop via
`qa-product-images.html` (extend it per feature) and `/app/qa-layouts`.
