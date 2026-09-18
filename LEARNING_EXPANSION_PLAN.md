# Resparq — Expanding What the AI Learns

**Written:** September 17, 2026
**Revised:** September 18, 2026 — §0 added, §2's fix recommendation reversed, §5 unblocked, §9 reordered.
**Status:** Plan. Items marked SHIPPED are on `main` and not yet deployed at time of writing.
**Successor to:** [AI_LEARNING_AUDIT.md](./AI_LEARNING_AUDIT.md) (July 10) — that doc audited what learns; this one covers a structural defect it did not catch, and the work queued behind fixing it.

**Read this first if you are a future instance.** Read §0, then §2, in that
order. The September 17 draft of this document named §2 as the single most
important fact in it. That was wrong, in two ways, and both were found on
September 18:

1. **§0 outranks it.** The engine is barely emitting offers at all. Scoring
   which trigger reaches people is a second-order question while most of the
   population being scored is seeing no-offer copy.
2. **§2's own diagnosis is unsafe.** The trigger gene is not faithfully
   executed by the storefront, so the arms it describes are not distinct
   treatments. See §2's *Prerequisite* subsection. The fix it originally
   recommended (Option B) has been reversed to A′.

Both sections still hold that several plausible-sounding fixes are actively
wrong until the underlying defect is resolved. That part was right.

---
---

## 0. The engine is barely emitting offers (September 18 — outranks everything below)

Added after §2 was written. **Read this before §2.** §2 asks why the AI keeps
picking a trigger that does not work. This section asks a prior question: why
almost every modal that renders carries `amount: 0`. Until that is answered,
§2's premise is not safe to build on, because the copy variants being scored
are mostly no-offer variants.

### Symptom

On the one live store, with `aggression` reported as 7/10, every modal the
merchant sees is a cart reminder with no discount in it.

### Eight paths produce `amount: 0`. Four are intended. Four are failures.

| # | Path | Moves with aggression? |
|---|---|---|
| 1 | High propensity + cart < $40 → `revenue_no_discount` | **No** |
| 2 | Generic code type mismatch → neutral copy | **No** |
| 3 | Budget exhausted (counter inflated 10–20×) | No — hard short-circuit |
| 4 | Hybrid mode with a $0 pin | No — `effectiveAggression` overwritten to 0 |
| 5 | Discount-arm bandit starved below the confidence bar | Fractionally |
| 6 | Fixed-dollar lane floored to $0 on small carts | No |
| 7 | `assumedGrossMargin <= 0.20` → global announce-only | No — kills every visitor |
| 8 | Propensity ≥ ~85 → announce-only taper | **Yes** — the dial's intended job |

Only #8 is the branch the aggression slider was designed to move. On #1–#4 the
dial is inert, which is why turning it to 7 changed nothing.

### #1 — verified

`selectBaseline` runs *before* any aggression logic
(`apps.exit-intent.api.ai-decision.jsx:581`):

```js
// app/utils/baseline-selector.js:155
if (propensityScore >= highIntentBar) {
  return 'revenue_no_discount';
}
```

That pool is `offerAmounts: [0]` (`gene-pools.js:140`) with headlines
*"Your cart is waiting for you"* / *"Your order is almost complete"* — the exact
copy being reported. Because the baseline name does not contain
`with_discount`, the entire aggression block (`:603-645`) and the margin guard
(`:739-796`) are skipped.

**Propensity is systematically inflated**, which makes this fire far more than
intended:

- `getScrollDepth()` returns **100** when the page does not scroll
  (`exit-intent-modal.js:876` — `maxScroll > 0 ? … : 100`), a flat +8.
- `visitFrequency` is a `localStorage` counter incremented on every signal
  collection — every page load with a cart — and never reset
  (`exit-intent-modal.js:824`), worth up to +12.
- Logged-in +6, purchase history up to +20, desktop +2, from a base of 45
  (`propensity.server.js:25`).

An ordinary engaged desktop shopper lands at P=75–85 routinely. Above the bar
with a sub-$40 cart there is exactly one outcome: zero.

Both inflation sources are bugs in their own right. A page that does not scroll
is not evidence of engagement, and a never-reset visit counter converts
tenure into intent.

### #2 — verified, and worse than it reads

`ai-decision.jsx:1084` reconciles the merchant's generic code against the
decision by **type equality**:

```js
if (realDetails && realDetails.type === decision.type) { …align amount… }
else { decision.type = 'no-discount'; decision.amount = 0; … }
```

The AI picks its type per-visitor from three pools — `threshold`, `percentage`,
`fixed` (`baseline-selector.js:84-96`). A merchant's generic code is one fixed
shape. So a percentage code degrades every `threshold` and every `fixed`
decision; a free-shipping / BXGY / deleted code returns `null` and degrades
**100%** of them. The `null` is cached 5 minutes per code
(`discount-codes.js:190`), so one transient Admin API failure blanks every offer
for five minutes.

The fallback copy is *"You left something in your cart"* / *"Your discount is
waiting at checkout"* — a cart reminder, verbatim.

**The discount is still granted.** Per the comment at `:1101`, `decision.code`
still flows to checkout. So the store pays the full margin and buys none of the
persuasion, because the modal never names the offer. This is the worst cell in
the matrix and it is invisible from the payload.

Compounding: `aiGenericDiscountCode` is only ever minted inside
`if (settings.discountEnabled)` (`app.settings.jsx:350-390`), a *manual*-mode
toggle, with a value derived from the manual `discountPercentage`. The stored
code disagrees with the AI's three pools by construction.

### #3 — budget exhaustion on an inflated counter

`checkBudget()` (`ai-decision.server.js:443-459`) sums every `DiscountOffer`
row created in a rolling month, redeemed or not, with no `redeemed` filter. At
a realistic 5–10% redemption rate the counter runs 10–20× ahead of real spend.
At the default `budgetAmount: 500` with ~20% offers on ~$120 carts, **~21
impressions exhausts a month**. Once over, every request returns at `:217-225`
with `{type:'no-discount', amount:0, code:null}` and **no `variant` object at
all** — the client then renders the stock Pro copy
(`exit-intent-modal.js:2853`), *"Wait! Don't leave yet"*.

This is the only candidate that yields a clean 100% with no exceptions, and it
has a distinct fingerprint: no evolved copy, no variant ID.

Same finding as §6.1, promoted here because it does not merely mis-report
spend — it silently disables the product.

### #4 — hybrid with a $0 pin

```js
// apps.exit-intent.api.ai-decision.jsx:410
if (isHybrid) effectiveAggression = hybridOfferAmount > 0 ? 10 : 0;
```

Then `:587-590` forces `baseline = 'pure_reminder'` (`offerAmounts: [0]`,
`gene-pools.js:333`). The aggression slider is deliberately not rendered in
Hybrid (`HybridSettingsTab.jsx:4-5`), and `effectiveAggression` overwrites the
metafield value outright. So a Hybrid store with an unset pin shows a bare
reminder on 100% of traffic **while the metafield still reads
`aggression: 7`** — precisely the reported perception gap.

### P0 — the settings form silently resets aggression and budget

Independent of which path above is live, this corrupts the config itself.

```js
// app/routes/app.settings.jsx:250
aggression:    parseInt(formData.get("aggression") || "5"),
budgetEnabled: formData.get("budgetEnabled") === "on",
budgetAmount:  parseFloat(formData.get("budgetAmount") || "500"),
mode:          formData.get("mode") || "manual",
```

The aggression slider only mounts on the Quick tab in AI mode
(`AISettingsTab.jsx:186`, gated by `QuickSetupTab.jsx:200`). One `<Form>` wraps
every tab (`app.settings.jsx:994`), and unmounted tabs submit nothing. So **any
save from the Advanced or Branding tab rewrites aggression to 5**,
`budgetEnabled` to `false`, `aiDiscountCodeMode` to `"unique"` — and `mode`
to `"manual"`.

The fix already exists in the same file, fifteen lines above, for the hybrid
fields:

```js
// Fields may be absent when saving from a tab that doesn't mount the Guided
// inputs — resolved against the existing DB row below so a cross-tab save
// can't wipe them.
hybridOfferType: formData.get("hybridOfferType") || undefined,
```

`BrandingTab.jsx:70-75` carries hidden inputs for the trigger fields for the
same reason. This bug class was found and fixed twice and never swept for.
Apply the same `undefined`-and-resolve treatment to `aggression`,
`budgetEnabled`, `budgetAmount`, `aiDiscountCodeMode`, `mode`.

**Do this first.** It is a few lines, and until it lands you cannot know what
aggression was live when any given decision was minted — which makes every
experiment below unattributable.

### The structural problem: degraded states wear the intended output's clothes

Three of the six archetypes are *intentional* no-offer modals — `SOFT_UPSELL`,
`TRUST_REMINDER`, `PURE_REMINDER` — with a sound rationale: do not buy a
conversion you already had. The announce-only margin guard is intentional. The
aggression-0 path is intentional.

But #2, #3, #5 and #6 are **failures that return the identical payload**:
`type: 'no-discount', amount: 0`. #2 even fabricates plausible reminder copy.
Nothing downstream can distinguish "the AI decided you did not need a discount"
from "the AI could not produce one". That ambiguity is the entire reason this
went undiagnosed for as long as it did.

The data to separate them already exists — `AIDecision.decision` JSON preserves
`budget-exhausted` vs `no_intervention` vs the real baseline name. It is simply
never surfaced. **Surface it on the decision log and the live-config card.**
That is a small console change and it is the one that would have caught this.

### Ruled out

- **Variant genome bias.** Genomes carry `offerAmount` but not offer type or
  archetype; the reminder-vs-offer decision is made upstream by `selectBaseline`
  and each baseline has an isolated population (`ai-decision.jsx:664-669`). A
  no-offer pool is all-zero *by design*. Evolution is not the culprit and
  re-seeding will not help.
- **Unique-code mint failure.** `createPercentageDiscount` throws on userErrors
  (`discount-codes.js:342`), the outer catch returns 500, and the client fails
  closed with **no modal at all** (`exit-intent-modal.js:2589`). It does not
  degrade to a reminder. Only the *generic* path degrades silently.
- **Mode drift between storefront and endpoint.** `exit-intent-modal.liquid:16`
  seeds mode from the metafield and `exit-intent-modal.js:3866` merges with
  liquid winning. Both read the same source. Settings-*value* drift is real
  (see P0 above); mode drift is not.
- **`hasPromoActive` → no-discount baselines** (`baseline-selector.js:143`).
  The storefront never sets this signal — `collectCustomerSignals` emits
  `promoInCart`, never `hasPromoActive`. Dead branch.

### Order of diagnosis

1. Read the live-config card in the super-admin console. It already renders
   `mode`, `aggression`, `aiDiscountCodeMode`, `hybridOfferAmount` and
   `budgetEnabled` straight from the metafield (`live-config.js:70-88`). One
   card read kills or confirms #2, #3 and #4.
2. If `aggression` reads 5 rather than 7, the P0 cross-tab reset has already
   happened on this store.
3. Only if that does not settle it, run the decision-type histogram in §7.


## 1. Context — what shipped on September 17

All on `main`, all in the super-admin console except where noted.

| Change | Files |
|---|---|
| Decision log rendered as sentences, not raw JSON | `app/components/admin/decision-summary.js` |
| Decision → impression → click/order outcome linkage | `admin.shops.$shopId.jsx` loader |
| Live config read from the settings **metafield**, not the Shop row | `app/components/admin/live-config.js` |
| Settings tab writes the metafield (so support edits actually take effect) | `writeSettingsMetafield()` in `admin.shops.$shopId.jsx` |
| Trigger shown per decision (exit intent vs idle Ns) | `decision-summary.js` |
| Trigger performance panel (chosen vs actually shown) | `TriggerPerformance` in `admin.shops.$shopId.jsx` |
| **Lift switched to intention-to-treat** (merchant-facing) | `app/utils/shop-metrics.server.js` |
| Three-way treatment breakdown vs control | `computeHoldout()` / `segment()` |

Three display bugs of one class were fixed along the way: the console was
rendering stored settings that the AI path never reads (modal copy, trigger
flags), which made AI stores look broken or misconfigured when they were not.
**If you add anything to the live-config card, check whether the mode you are
describing actually reads that field.**

---

## 2. The core defect: the AI cannot learn which trigger works

### What is true today

Variant selection is Thompson sampling over a Beta posterior:

```js
// app/utils/variant-engine.js — selection
betaSample(alpha = conversions, beta = impressions - conversions)
```

and evolution fitness is:

```js
// app/utils/variant-engine.js — recordConversion
cvr = conversions / impressions
profitPerImpression = (aov - avgDiscountPerConversion) * cvr
```

`Variant.impressions` is **only incremented in `confirmImpressionRender()`** —
never in `recordImpression()`, which runs at decision prefetch. This is
deliberate and correct for copy: decisions are minted before any trigger fires,
so counting them would credit variants for exposures nobody saw.

### Why it breaks trigger learning

`triggerType` and `idleSeconds` are genes in the same genome as the copy. But
the denominator excludes exactly the sessions a bad trigger causes:

| Variant | Chosen | Rendered | Converted | Scored CVR |
|---|---|---|---|---|
| A — `exit_intent` | 100 | 5 | 1 | **20%** |
| B — `idle 30s` | 100 | 60 | 12 | **20%** |

Identical scores. A reached 5 people, B reached 60. A's 95 misses are not
counted against it — they are *absent from the denominator*. Selection and
evolution cannot distinguish these, so a trigger that never fires is never
punished, and exit intent persists indefinitely.

This is not a cold-start problem. The signal never arrives, at any sample size.

### Consequence for other work

**Do not add offer amount (or any other gene) as a learned arm before fixing
this.** A new arm would optimize within the sessions that already render and
stay blind to the ones that never did — you would be tuning the reachable
population while the reach problem gets worse.

### Prerequisite: the storefront does not honour the trigger gene

**Found September 18. Nothing in this section works until this is fixed, and it
may invert the diagnosis above.**

`setupAITriggers` (`extensions/exit-intent-modal/assets/exit-intent-modal.js:1912`):

```js
if (!isMobile) {
  document.addEventListener('mouseout', ...)   // armed regardless of triggerType
}
if (triggerType === 'idle' || triggerType === 'exit_intent_or_idle') {
  this.setupIdleTrigger(idleSeconds, ...)
}
if (isMobile && triggerType === 'exit_intent') {
  this.setupIdleTrigger(Math.min(idleSeconds, 15), ...)   // fallback
}
```

Desktop arms `mouseout` unconditionally — the gene never suppresses it. Mobile
coerces `exit_intent` into an idle timer. The actual treatment per arm:

| gene | desktop | mobile |
|---|---|---|
| `exit_intent` | exit | **idle 15s (always)** |
| `idle` | exit + idle | idle(g) |
| `exit_intent_or_idle` | exit + idle | idle(g) |

Two consequences:

1. **`idle` and `exit_intent_or_idle` are the same treatment on both devices.**
   Two of three arms are duplicates splitting one population. No bandit
   distinguishes them because there is nothing to distinguish.
2. **`exit_intent` is mislabelled on mobile.** Because the idle gene pool is
   `[15, 30, 45, 60]` (`gene-pools.js:122`), `Math.min(idleSeconds, 15)` is
   *always exactly 15*. So on mobile the `exit_intent` arm is silently the most
   aggressive idle timer in the pool — it fires fastest, renders most, and
   accumulates the most impressions of any arm.

The same unconditional `mouseout` appears in the escalation-watch path at
`:726`.

**This may invert the section above.** The claim "exit intent persists because
bad triggers are never punished" has a competing explanation that fits the same
symptom: exit intent persists because on mobile it *is* winning, as a 15-second
idle timer wearing the wrong label. Reach-blindness says add pressure against
triggers that do not fire. Contamination says exit intent was never tested and
what is actually winning is speed. Opposite fixes.

**Settle it before writing any of the fix below.** The §7 render-rate query
already groups by `deviceType`. A **high** mobile render rate on `exit_intent`
means contamination and the premise above is wrong; a low one means the original
diagnosis holds.

The repair is roughly five lines: gate the desktop `mouseout` registration on
the gene, and stop coercing `exit_intent` on mobile — instead make it
*ineligible*, see below.

### Proposed fix (P0)

Score on **decisions**, not renders, for the trigger dimension. Two options:

**Option A — render rate as a selection multiplier (contained).**
Multiply the Thompson sample by the variant's historical render rate:

```js
sample *= (variant.rendered / variant.decided)   // needs a `decided` counter
```

Requires incrementing a new `Variant.decisions` counter in `recordImpression()`
(leave `impressions` alone — copy fitness must stay render-based). Smallest
change that creates real pressure. Risk: conflates two effects in one scalar,
and a cold variant with 1 decision / 0 renders gets crushed — needs a prior.

**Option B — trigger as its own bandit arm (correct).**
Separate the trigger decision from the copy decision. Score trigger arms on
`conversions / decisions` per `(shop, segment)`, the way `discount-arm.server.js`
already scores discount vs no-discount per propensity bucket. Copy keeps its
render-based fitness. Follow the existing pattern in
`app/utils/discount-arm.server.js` — it is the closest working template
(Monte-Carlo on profit-weighted EV, confidence bar, cold-start fallback,
`MIN_ARM_OUTCOMES = 50`).

**Recommendation: reversed on September 18 — A′, not B.**

The original recommendation was B, on the grounds that A "conflates two effects
in one scalar". That is backwards. Copy is not seen until the modal renders, so
copy cannot influence whether the trigger fires. That gives a clean
factorisation:

```
EV(trigger, copy) = fireRate(trigger, device, context) × cvr(copy | rendered)
```

A **separates** those two factors. B fuses them back together into a single
conversion rate scored on decisions.

Convergence settles it. Firing is a tens-of-percent event and its rate
stabilises in ~50 sessions per cell. Conversion is a ~2% event, so B needs
thousands of decisions *per arm per segment* before its posteriors separate —
`discount-arm.server.js` sets `MIN_ARM_OUTCOMES = 50`, `surface-arm.server.js`
uses 20, and at one store neither arm leaves cold start this year. **B is a
structure that never converges on the traffic that exists.**

**A′ — the corrected version of A.** A was weak only because the multiplier was
estimated *per variant* (`variant.rendered / variant.decided`), which is why it
needed a prior and crushed cold variants. Estimate it per
**(trigger × device)** instead — six cells, not one per variant — with a Beta
prior, pooled across shops:

```js
sample *= betaMean(fireRate[triggerType][deviceType])   // 6 cells, globally pooled
```

Copy fitness stays render-based and untouched.

**Add a hard eligibility filter first.** A mobile session should never be dealt
an exit-intent-only gene. That is a device capability constraint, not something
to discover at 50 outcomes per arm. Filter the gene pool at selection time and
delete the mobile coercion described in the *Prerequisite* above — the coercion
is what created the mislabelling in the first place.

**Pool the fire rate globally.** `fireRate(exit_intent | mobile)` is close to a
universal constant; it is not shop-specific knowledge. `cluster-priors.server.js`
and `archetype-priors.js` already exist for exactly this. With one paying store,
pooled priors are worth more than any new per-shop arm — and that is true of
every arm in this document, not just this one.

B remains the right shape *if* traffic ever justifies it. It does not yet.

### How to verify it worked

The `TriggerPerformance` panel (Performance tab) shows chosen / shown / show
rate per trigger gene. After the fix, a trigger with a low show rate should lose
share over successive generations. Before the fix it will not, no matter how
long you wait.

**September 18 caveat.** This verification is only meaningful *after* the
*Prerequisite* lands. Until the storefront honours the gene, the panel is
reporting on arms that are not distinct treatments — `idle` and
`exit_intent_or_idle` are the same thing, and mobile `exit_intent` is a 15s idle
timer. A show rate read off the current panel describes the coercion, not the
gene. Check the render-rate-by-device query in §7 before reading this panel at
all.

---

## 3. Measurement: intention-to-treat (SHIPPED, not deployed)

### The bug

The holdout coin is flipped at `apps.exit-intent.api.ai-decision.jsx:344`,
**before** `decideOffer()` runs and before any trigger fires. Lift compared only
`{ wasShown: true, rendered: true }` against the control.

That drops sessions *after* randomization, on grounds correlated with the
outcome. A high-propensity visitor gets skipped by the engine and leaves the
treatment arm; their statistical twin in the control arm still counts. The arms
stop being comparable and the number stops meaning "did Resparq cause this".

### The fix

Treatment is now every non-holdout `InterventionOutcome` row — shown, skipped,
and decided-but-never-rendered alike. Predicates live in `canonicalWhere()`:

```
treated          isHoldout: false
shown            isHoldout: false, wasShown: true,  rendered: true
skipped          isHoldout: false, wasShown: false
missed           isHoldout: false, wasShown: true,  rendered: false
```

`shown + skipped + missed === treated`, exactly. Verified against the dev DB
(8 + 4 + 0 = 12). **If you add a fourth state, re-check this partition.**

The old per-protocol figure survives as `holdout.perProtocol`, labelled a
diagnostic. It is selected on a post-randomization event and must never be
quoted as lift.

Put plainly: **per-protocol measures the modal; ITT measures the product.** The
merchant is buying the product.

### Raise the holdout to 20% while there is one store (September 18)

`HOLDOUT_RATE = 0.05` (`apps.exit-intent.api.ai-decision.jsx:340`) is a bad
split at this volume. Power is governed by the smaller arm and scales with
`4 × p × (1 − p)`:

| split | effective N |
|---|---|
| 5 / 95 | 0.19 N |
| 20 / 80 | 0.64 N |
| 50 / 50 | 1.00 N |

Moving to 20% **more than triples** statistical power on identical traffic.
`computeHoldout()` returns `null` below 10 holdout sessions and only sets
`hasEnoughData` at 20 — at 5% that needs ~400 treatment sessions before the
number is even shown, and far more before it means anything.

The cost is foregone uplift on 15% more sessions — a quantity that is currently
unmeasured and might be zero. Establishing whether it is zero is the entire
purpose of the holdout. Buying that answer faster is worth more right now than
protecting an uplift that cannot yet be demonstrated. Drop back to 5% once lift
is established.

Ship it in the same deploy as the ITT change; both alter the same endpoint and
both are cheapest at one customer.

### Later: size the holdout from the store's own early data (idea, not planned)

Raised September 18. Not scheduled, recorded so it is not lost.

The 20% argument above is a blunt instrument: one number for every store,
chosen because the *first* store has no data. The better version sizes the
holdout from what the store is actually doing — wide while volume is low and
lift is unknown, narrowing as the interval tightens. A store doing 50 sessions
a day needs a much bigger control share to answer the question this quarter
than one doing 5,000.

**The trap, specific to this implementation.** Assignment is
`fnv1a(visitorId:shopId) % 100 < HOLDOUT_RATE * 100`
(`apps.exit-intent.api.ai-decision.jsx:345`). The hash is stable per visitor but
the *threshold* is what moves, so changing the rate REASSIGNS people. Going
20% → 5% flips everyone in buckets 5-19 from control to treatment, carrying an
unexposed history into the treated arm. They are contaminated for both arms,
and nothing in the schema records that they switched.

**So the clean shape is cohorts, not a dial.** Assign a visitor to a cohort at
first contact and freeze it; each cohort is its own experiment with its own
fixed rate; lift is computed per cohort and combined, rather than pooled over a
period whose mix changed underneath it. That keeps the power benefit and drops
the reassignment problem entirely.

Needs, roughly: a stored per-visitor arm assignment (or a cohort id derived
from first-seen date), a rate schedule per cohort, and a combined estimator in
`computeHoldout()`. None of it is hard; all of it is wasted before there is
more than one store to run it on.

### Reading the three slices

Each has a distinct meaning when it sits *below* control:

- **Modal shown** — the modal itself is not persuading anyone. Copy/offer problem.
- **AI chose silence** — it held back from people who needed a push. Threshold too conservative.
- **Trigger never fired** — it wanted to act and never got the chance. §2's problem, made visible.

None is causal alone. Only the ITT number on top is.

---

## 4. Merchant dashboard (P1 — decided, not yet built)

### What the ITT change does to merchant-facing numbers

The hero stat on the merchant dashboard is `holdoutLift.incrementalRevenue`
(`app/routes/app._index.jsx`), and the ROI line — *"That's Nx your $X/mo plan
cost"* — divides it by plan price. This is the number the merchant judges the
product by.

| Metric | Direction | Why |
|---|---|---|
| Holdout CVR | unchanged | control arm untouched |
| Treatment CVR | **falls** | denominator now includes skipped + missed |
| Lift % | **falls** | follows |
| Incremental revenue | ≈unchanged, or falls | see below |
| Headline CVR / impressions / clicks | unchanged | still impression-based |

**Incremental revenue is subtler than it looks.** It is
`treatmentRevenue − (holdoutRevPerSession × treatmentTotal)`. Adding N non-shown
sessions adds to the first term *and* to the baseline in the second. If those
sessions convert at the control rate the two cancel and **the number does not
move**. It only falls if non-shown sessions convert below control — exactly the
case where the revenue should not have been claimed.

So: incremental revenue survives roughly intact; the CVR comparison panel gets
much less flattering (illustratively, "8.00% vs 11.00%" → "8.00% vs 8.17%").

**This is the cheapest moment in the product's life to make that switch** — one
customer. Later means a merchant watching lift drop 35 points overnight.

### Agreed design

Keep the main dashboard header as-is. Add the holdout-split explanation as sub-modules
or banners beneath it, not as a replacement for the headline.

### Negative lift — the transparency question

The instinct not to headline a negative number is right; hiding it is not. The
resolution is a **symmetric evidence bar**, not a one-sided filter:

> If you would display +40% at N=25, you must display −40% at N=25.
> If you would not display −40% at N=25, do not display +40% either.

At current sample sizes a negative point estimate is almost always noise, not a
finding — and so is a positive one. So the correct UI is three states, gated on
the same test in both directions:

1. **Not enough evidence** (interval spans zero) — "Still measuring. N sessions
   in the control group so far." Shown regardless of sign. This will be the
   state most of the time early on, for good reasons.
2. **Measurably positive** — the current celebratory panel.
3. **Measurably negative** — shown, plainly, with what is being done about it.
   Do not bury it; a merchant who finds out later trusts nothing else on the page.

Today's gates are sample-size only: `computeHoldout()` returns `null` below 10
holdout sessions and sets `hasEnoughData` at 20. Neither is a significance test.
**Add a two-proportion interval on the difference and gate on that.** This is
the single change that makes the negative case safe to show honestly.

Current behaviour to fix while you are there: when lift is negative,
`incrementalRevenue` clamps at `Math.max(0, …)` and the ROI line silently
vanishes. The merchant sees `$0` with no explanation.

### The holdout panel is revenue-only. This is a product decision — keep it.

> Named "the 95 vs 5 panel" on September 17. §3 now recommends an 80/20 split
> while there is one store, so the name is stale but the decision below is
> unaffected — it is about *what the panel measures*, not the split.

**Decided September 18, 2026. Do not "improve" this by adding profit or margin
to the holdout panel.** The premise the merchant buys is: Resparq gives away
some discount in exchange for more revenue. The panel measures that bargain on
its own terms.

No code change was needed — `computeHoldout()` already returns only
`incrementalRevenue`, `grossRevenue` and order-based CVRs. Top-level
`buildResult()` still carries `profit` for the headline counts; that is a
different block and stays.

**The number is stronger than "revenue" makes it sound.** Attributed revenue is
`parseFloat(payload.total_price)` (`webhooks.orders.create.jsx`), and Shopify's
`total_price` is what the customer actually **paid — after the discount was
applied**. So `incrementalRevenue` is already net of the discount granted. It is
not a gross figure that ignores the giveaway; it is extra money in the till
*after* the giveaway. That is exactly the claim the product makes.

Two honest limits, neither a reason to add profit here:

- `total_price` includes shipping and tax, which are not merchant margin. It is
  therefore slightly generous as "money earned" — but *equally* generous in both
  arms, and lift is a difference, so it largely cancels.
- COGS is not in the data at all (`assumedGrossMargin` is a merchant-entered
  guess used to cap discounts, not to measure outcomes). A true profit lift
  figure is not currently computable from real data, only estimable from that
  guess. One more reason the revenue framing is the defensible one.

Residual risk the panel cannot show: **discount cannibalization** — a visitor
who would have paid full price pays 17% less. Under ITT with a proper control
this mostly *does* surface, because those visitors exist in both arms and the
control arm captures what they would have paid. That is the holdout earning its
keep. Other mechanisms worth remembering if a store ever does go negative:
interruption cost on mobile (modal covers the viewport, idle timer can fire
mid-browse), and trained discount-seeking across repeat visits.

---

## 5. Offer amount as a learned arm (P2 — ~~blocked on §2~~ blocked on §0)

Currently `offerCeilingPercent()` (`app/utils/ai-decision.server.js`) is a
deterministic function of propensity × aggression × assumed margin. Nothing ever
tests whether 12% would have closed the visitor that 17% closed.

What *is* already learned: **discount vs no-discount**, per propensity bucket,
via `discount-arm.server.js` — Monte-Carlo on profit-weighted EV against a
confidence bar set by aggression, 50-outcome cold start. The binary is handled;
the magnitude is not.

Proposal: test ±5pp around the computed ceiling, inside the existing margin
guard (which caps the downside automatically). Score on profit per *decision*,
not per render, for the same reason as §2. Reuse the `discount-arm` structure.

Note this is not in tension with §4's revenue-only display decision. Internally,
`profit = revenue − discountAmount` is real data on `InterventionOutcome` and is
the right thing to optimize against — spending margin to buy an order it would
have got for free is exactly what the arm must avoid. §4 governs what the
**merchant is shown**, not what the optimizer maximizes.

Expected payoff is real: this is the most direct lever on close rate that does
not require new storefront instrumentation.

**Correction, September 18 — this is not blocked on §2.** The original claim was
that adding an arm here would "tune the reachable population while the reach
problem gets worse". It would not. Offer amount is not visible before the modal
renders, so it cannot influence whether the trigger fires — the same
separability argument that reverses §2's recommendation applies here. Trigger
bias does not contaminate this arm; it only shrinks the population the arm
learns on. **Power-limited, not biased.**

Once the trigger gene is actually honoured (§2 *Prerequisite*), the real spread
between trigger arms is narrow — exit versus exit+idle. Offer amount varies on
every rendered session. Per unit of work this is the better lever, and it can
run in parallel with §2 rather than behind it.

**It is blocked on §0.** An arm that learns offer magnitude needs the engine to
emit offers. Today a large share of decisions return `amount: 0` for four
reasons that have nothing to do with what this arm would optimise. Fix the
plumbing before putting an optimiser on top of it.

---

## 6. Smaller items found in passing

| # | Item | Evidence | Note |
|---|---|---|---|
| 1 | **Budget counts codes issued, not redeemed** | `checkBudget()` in `ai-decision.server.js` — no `redeemed` filter | Dev data: 9 offers issued / 1 redeemed → budget charged $98, actually given $8. 12x over. `DiscountOffer.redeemed` exists and is indexed. Middle option: count redeemed + unredeemed-but-unexpired, so expired-unused codes release their hold. Surfaced on the live-config card; logic unchanged. **Promoted to §0 #3 on September 18** — this does not merely mis-report spend, it silently disables the product once the inflated counter crosses the cap. |
| 2 | **Manual mode has no mobile fallback** | `setupTriggers()` ~line 2183, `exit-intent-modal.js` | If a Manual store enables only exit intent, mobile visitors never see the modal at all — no idle timer is registered. Both AI paths handle this; manual does not. Storefront behaviour change affecting live merchants, so it was left alone. **September 18:** "handle" is doing too much work here — the AI paths *coerce* `exit_intent` into a 15s idle timer, which is what mislabels the arm. See §2 *Prerequisite*. The manual gap and the AI mislabelling are the same missing abstraction: device capability should filter the trigger, not silently substitute for it. |
| 3 | **No add-to-cart event** | — | `InterventionOutcome` has no cart-creation event, so "close rate" is order-based only. Tracking ATC needs a new storefront event and a column. Blocks true funnel analysis. |
| 4 | **Modal copy fields editable but inert in AI mode** | Settings tab | `modalHeadline` / `modalBody` / `ctaButton` write through correctly but the AI path reads variant genes instead. Should be disabled in AI/Hybrid, as the pinned-offer fields already are. |
| 5 | **Console cannot edit discount codes or branding** | `EDITABLE_FIELDS` | Deliberate — those mint Shopify-side resources. Supporting them needs the creation flow, not just a config write. |
| 6 | **Scroll depth reports 100 on non-scrolling pages** | `getScrollDepth()`, `exit-intent-modal.js:876` — `maxScroll > 0 ? … : 100` | A page that does not scroll is not evidence of engagement, but it scores a flat +8 propensity. Contributes to §0 #1. |
| 7 | **`visitFrequency` never resets** | `exit-intent-modal.js:824` | A `localStorage` counter incremented on every signal collection, worth up to +12. Converts tenure into intent and never decays. Contributes to §0 #1. |
| 8 | **Learning cron has no npm script** | `app/cron/threshold-learning-cycle.js`, `PRODUCTION-CRON-SETUP.md:38` | Manually-created Fly scheduled machine. If it is not running, `rebuildDiscountArmStats` never builds and every discount decision is a coin flip forever. It also selects shops on the **Shop row** `mode: 'ai'`, so row/metafield drift silently excludes a store. Verify the machine exists. |
| 9 | **Settings form wipes unmounted fields** | `app.settings.jsx:250` | See §0 P0. `aggression`, `budgetEnabled`, `budgetAmount`, `aiDiscountCodeMode` and `mode` all reset on a cross-tab save. The `undefined`-and-resolve fix already exists in the same file for hybrid fields. |

---

## 7. Verification queries

Against the app database. Used repeatedly while writing this.

```sql
-- Treatment partition — must sum exactly
select count(*) filter (where "wasShown" and rendered)      as shown,
       count(*) filter (where not "wasShown")               as skipped,
       count(*) filter (where "wasShown" and not rendered)  as missed,
       count(*)                                             as treated
from "InterventionOutcome" where not "isHoldout";

-- Render rate by trigger gene — the §2 symptom
select v."triggerType", vi."deviceType",
       count(*) as decided,
       count(*) filter (where vi.rendered)  as rendered,
       count(*) filter (where vi.converted) as converted
from "VariantImpression" vi join "Variant" v on v.id = vi."variantId"
group by 1,2 order by 3 desc;

-- Decisions that never entered the tracked path, by writer
select coalesce(decision::json->>'source','(live decision path)') as source,
       count(*) filter (where io.id is null) as untracked, count(*) as total
from "AIDecision" d
left join "InterventionOutcome" io on io."aiDecisionId" = d.id
where decision like '{%' group by 1 order by 3 desc;

-- =====================================================================
-- Added September 18 for the §0 zero-offer diagnosis.
-- Run the live-config card FIRST; these are only for what it cannot settle.
-- =====================================================================

-- The single most discriminating query. Separates §0 #1 / #2 / #3 / #4 at once.
--   budget-exhausted                      -> #3
--   baseline = 'pure_reminder'            -> #4
--   baseline = 'revenue_no_discount'      -> #1
--   type='no-discount' on a *_with_discount baseline -> #2 or #6
select (decision::jsonb->>'type')      as decision_type,
       (decision::jsonb->>'baseline')  as baseline,
       (decision::jsonb->>'archetype') as archetype,
       count(*),
       round(avg((decision::jsonb->>'amount')::numeric), 2) as avg_amount
from "AIDecision"
where "shopId" = '<SHOP_ID>' and "createdAt" > now() - interval '14 days'
group by 1,2,3 order by 4 desc;

-- Smoking gun for §0 #2. The generic-reconciliation fallback is the only thing
-- that writes this row shape. Any non-zero count here IS #2.
select "offerType", mode, count(*), sum(amount) as sum_amount
from "DiscountOffer"
where "shopId" = '<SHOP_ID>' and "createdAt" > now() - interval '30 days'
group by 1,2 order by 3 desc;

-- Confirms §0 #1 — is propensity inflated into the no-discount band?
-- Mass at p_bucket >= 70 with high cart_under_40 confirms it.
select width_bucket((signals::jsonb->>'propensityScore')::numeric, 0, 100, 10) * 10 as p_bucket,
       count(*) filter (where (signals::jsonb->>'cartValue')::numeric < 40) as cart_under_40,
       count(*) as total,
       round(avg((signals::jsonb->>'cartValue')::numeric), 2) as avg_cart
from "AIDecision"
where "shopId" = '<SHOP_ID>' and "createdAt" > now() - interval '14 days'
  and signals::jsonb->>'propensityScore' is not null
group by 1 order by 1;

-- Are the discount-arm bandit arms mature, or starved? (§0 #5)
-- Zero rows => the threshold-learning cron never ran => coin flip forever.
-- Check the Fly scheduled machine exists; there is no npm script for it.
select segment, "sampleSize", "confidenceLevel", "lastUpdated", data
from "MetaLearningInsights"
where "insightType" = 'discount_arm_stats' and segment like '<SHOP_ID>::%'
order by "lastUpdated" desc;

-- Sanity: is the AI endpoint being reached at all?
-- No rows => not in AI mode; the modals are manual-mode renders.
select date_trunc('day', "createdAt") as day, count(*)
from "AIDecision"
where "shopId" = '<SHOP_ID>' and "createdAt" > now() - interval '14 days'
group by 1 order by 1;

-- Not answerable in SQL: the serving config lives in the Shopify metafield,
-- not the Shop row. The live-config card renders it already; raw read is:
--   { shop { metafield(namespace:"exit_intent", key:"settings") { value } } }
-- Any disagreement between that and the Shop row is itself a finding.

-- Budget: charged vs actually given (item 6.1)
select count(*) as offers, count(*) filter (where redeemed) as redeemed,
       round(sum(case when "offerType"='percentage'
                      then (amount/100.0)*coalesce("cartValue",0)
                      else amount end)::numeric, 2) as budget_charged,
       round(sum(case when redeemed then (case when "offerType"='percentage'
                      then (amount/100.0)*coalesce("cartValue",0)
                      else amount end) else 0 end)::numeric, 2) as actually_given
from "DiscountOffer" where "createdAt" >= now() - interval '1 month';
```

---

## 8. Traps for a future instance

- **Local dev Postgres holds one seeded store** (`exit-intent-test-2`, on the
  `DEFAULT_DEV_SHOPS` allowlist, so every learning write is suppressed and
  ~97% of its decisions have no outcome row). Production has different stores
  in different modes. **Never quote a dev-DB number as a customer fact** — that
  mistake was made once in the session that produced this document.
- **The settings metafield is the source of truth**, not the `Shop` row, for
  `mode`, `aiGoal`, `aggression`, `budget*` and `hybrid*`. The row is a mirror
  the merchant app keeps in sync. The console now writes both; anything else
  that writes one must write the other.
- **Decisions are minted at prefetch.** "A decision exists" and "a visitor saw
  something" are different facts. Any new metric must say which it counts.
- **`rendered` vs `wasShown` are not the same thing.** `wasShown` is the AI's
  intent; `rendered` is what happened.
- **Zero paying stores as of writing.** Never invent uplift %, recovered $, CVR
  or testimonials. Measurement-capability claims are fine — the holdout does
  measure real per-store lift.
- **A gene being stored is not a gene being executed.** The trigger genes are
  written, read, evolved and reported on, and the storefront still does not obey
  them (§2 *Prerequisite*). Before trusting any arm, read the code that consumes
  its output, not just the code that produces it.
- **`amount: 0` is ambiguous.** Four intended paths and four failure paths emit
  the identical payload (§0). Never read a no-offer decision as "the AI chose
  not to discount" without checking `AIDecision.decision`'s baseline field.
- **Aggression does nothing on most branches.** It is inert on §0 #1–#4 and only
  genuinely moves #8 and the discount-arm confidence bar. "Turn the dial up" is
  not a diagnosis.
- **One paying store.** Every arm in this document is keyed per
  `(shop, segment)` with a 20–50 outcome cold start. Nothing converges on this
  traffic. Pooled priors (`cluster-priors.server.js`, `archetype-priors.js`)
  are worth more than any new per-shop arm until that changes.

---

## 9. Suggested order

Revised September 18. The September 17 order assumed the engine was emitting
offers and that the trigger gene was being executed. Neither holds.

1. **Fix the settings cross-tab wipe** (§0, P0). A few lines. Until it lands you
   cannot know what config was live when any decision was minted, which makes
   everything below unattributable.
2. **Diagnose the zero-offer paths** (§0). Start with the live-config card — one
   read kills or confirms three of the four candidates. Whatever it names, fix
   that before adding anything that learns.
3. **Surface intended-vs-degraded** on the decision log (§0). Small console
   change; it is the observability that would have caught this. Do it while the
   diagnosis is fresh.
4. **Deploy ITT** (§3) — already written, changes merchant numbers, do it while
   there is one customer. Raise `HOLDOUT_RATE` to 0.20 in the same deploy (§3).
5. **Honour the trigger gene** (§2 *Prerequisite*, ~5 lines) and run the
   render-rate-by-device query. Nothing about triggers can be learned or even
   diagnosed until the arms are distinct treatments.
6. Watch the **Trigger never fired** slice for a week, now that it is both
   visible and meaningful.
7. **Fire-rate multiplier** (§2, option A′) with globally pooled priors.
8. **Significance gate + dashboard sub-modules** (§4). This is what tells you
   whether any of 1–7 did anything.
9. **Offer amount as an arm** (§5) — can start from step 2 onward, in parallel.
10. Then §6 items by whatever hurts most.

Steps 1–3 are all §0 and none of them are learning work. That is the point:
the September 17 plan was optimising a system that was not running.
