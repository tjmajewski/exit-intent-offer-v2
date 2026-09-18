# Resparq — Expanding What the AI Learns

**Written:** September 17, 2026
**Status:** Plan. Items marked SHIPPED are on `main` and not yet deployed at time of writing.
**Successor to:** [AI_LEARNING_AUDIT.md](./AI_LEARNING_AUDIT.md) (July 10) — that doc audited what learns; this one covers a structural defect it did not catch, and the work queued behind fixing it.

**Read this first if you are a future instance.** The single most important fact
in this document is §2. Almost every "the AI keeps choosing X and X isn't
working" symptom traces back to it, and several plausible-sounding fixes are
actively wrong until it is resolved.

---

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

**Recommendation: B.** A is a patch on a metric that is measuring the wrong
thing; B measures the right thing. A is acceptable as a two-day stopgap if
there is urgency.

### How to verify it worked

The `TriggerPerformance` panel (Performance tab) shows chosen / shown / show
rate per trigger gene. After the fix, a trigger with a low show rate should lose
share over successive generations. Before the fix it will not, no matter how
long you wait.

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

Keep the main dashboard header as-is. Add the 95/5 explanation as sub-modules
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

### "Hard to imagine doing worse than control"

Mostly true for *orders*, and genuinely possible for *profit*. Real mechanisms:

- **Discount cannibalization.** A visitor who would have bought at full price
  buys at 17% off. Orders flat, revenue down, profit down more. This is the
  likeliest way a healthy-looking store is losing money.
- **Interruption cost on mobile**, where the modal covers the viewport and the
  only trigger is an idle timer that can fire mid-browse.
- **Trained discount-seeking** over repeat visits — abandoning to farm the offer.

`computeHoldout()` measures revenue-based incremental, and the three slices are
order-based. **A store can show positive order lift and negative profit lift
simultaneously.** Worth surfacing profit lift explicitly rather than leaving it
to be inferred.

---

## 5. Offer amount as a learned arm (P2 — blocked on §2)

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

Expected payoff is real: this is the most direct lever on close rate that does
not require new storefront instrumentation. **Blocked until §2 lands.**

---

## 6. Smaller items found in passing

| # | Item | Evidence | Note |
|---|---|---|---|
| 1 | **Budget counts codes issued, not redeemed** | `checkBudget()` in `ai-decision.server.js` — no `redeemed` filter | Dev data: 9 offers issued / 1 redeemed → budget charged $98, actually given $8. 12x over. `DiscountOffer.redeemed` exists and is indexed. Middle option: count redeemed + unredeemed-but-unexpired, so expired-unused codes release their hold. Surfaced on the live-config card; logic unchanged. |
| 2 | **Manual mode has no mobile fallback** | `setupTriggers()` ~line 2183, `exit-intent-modal.js` | If a Manual store enables only exit intent, mobile visitors never see the modal at all — no idle timer is registered. Both AI paths handle this; manual does not. Storefront behaviour change affecting live merchants, so it was left alone. |
| 3 | **No add-to-cart event** | — | `InterventionOutcome` has no cart-creation event, so "close rate" is order-based only. Tracking ATC needs a new storefront event and a column. Blocks true funnel analysis. |
| 4 | **Modal copy fields editable but inert in AI mode** | Settings tab | `modalHeadline` / `modalBody` / `ctaButton` write through correctly but the AI path reads variant genes instead. Should be disabled in AI/Hybrid, as the pinned-offer fields already are. |
| 5 | **Console cannot edit discount codes or branding** | `EDITABLE_FIELDS` | Deliberate — those mint Shopify-side resources. Supporting them needs the creation flow, not just a config write. |

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

---

## 9. Suggested order

1. Deploy ITT (§3) — already written, changes merchant numbers, do it while there is one customer.
2. Watch the **Trigger never fired** slice for a week. It is now visible for the first time.
3. Fix the denominator (§2, option B). Nothing else learns correctly until this lands.
4. Significance gate + dashboard sub-modules (§4).
5. Offer amount as an arm (§5).
6. Then §6 items by whatever hurts most.
