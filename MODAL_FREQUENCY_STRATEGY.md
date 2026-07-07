# Modal Frequency Strategy — Implementation Handoff

Goal: change modal frequency from **once per session** to a **cross-session cadence**
that re-shows fresh offers on a cooldown, so we can learn what converts — without
nagging the customer.

Strategy name: **cooldown + backoff + rotate + suppress**.

---

## 1. Current behavior (baseline)

The only frequency gate is a per-session flag in `sessionStorage`.

- `extensions/exit-intent-modal/assets/exit-intent-modal.js`
  - L301 `this.sessionKey = 'exitIntentShown';`
  - L316–324 constructor bails if `sessionStorage.getItem(this.sessionKey)` is set.
  - L1749–1754 stamps `sessionStorage.setItem(this.sessionKey, 'true')` when the modal renders.

Effect: shows at most once per browser session; clears on tab close. No cross-session
cooldown, no design rotation policy, no post-purchase suppression, no hard ceiling.
Customers perceive it as "once ever" because most don't return within one session.

Design rotation already exists for free: the bandit picks a fresh variant per impression
(`app/routes/apps.exit-intent.api.ai-decision.jsx` → `selectVariantForImpression`).
So every *new* impression after a cooldown naturally serves a different design/copy.
We just need to allow that second impression to happen on a controlled cadence.

---

## 2. Target behavior

Keep the once-per-session cap. Add a cross-session frequency cap in `localStorage`
(survives sessions), keyed per visitor. Four rules:

1. **Cooldown between shows — default 3 days.** After any show, do not re-pop for
   `cooldownDays`. 3 days = long enough not to nag, short enough to test a new offer
   inside a purchase-consideration window.
2. **Escalating backoff on ignore.** If dismissed without engaging, lengthen the next
   gap: 3d → 7d → 14d. A repeat-dismisser is saying no; back off automatically.
3. **Rotate design each show.** Free — let the bandit serve a new variant on the next
   allowed impression. No code beyond permitting the impression.
4. **Post-purchase suppression — default 30 days.** If they converted, go quiet for
   30 days (or campaign-scoped).

Hard ceiling: max **5 shows per visitor per rolling 30 days**, then dormant. Safety net.

All thresholds must be configurable (see §5) so they can be tuned per shop without a
redeploy.

---

## 3. Data model (client `localStorage`)

Single JSON record, one key. Reuse the existing visitor id (`resparqVisitorId`,
generated at exit-intent-modal.js:487–490).

Key: `exitIntentFrequency`

```json
{
  "lastShownAt": 1712345678000,   // ms epoch of last render
  "shownCount": 2,                 // shows within the rolling 30d window
  "windowStart": 1712000000000,    // start of the current 30d ceiling window
  "ignoreStreak": 1,               // consecutive dismiss-without-engage
  "convertedAt": null              // ms epoch of last conversion, or null
}
```

Notes:
- `sessionStorage.exitIntentShown` stays as the per-session gate (unchanged).
- Wrap all storage access in try/catch — storage is blocked in preview/incognito;
  on failure, fail **open** for preview but **closed** (don't show) is not required —
  match the existing preview fallback behavior at L322–324.

---

## 4. Algorithm

Replace the single session check in the constructor (L316–324) with a two-stage gate:
session gate first (unchanged), then `shouldShowCrossSession()`.

```
shouldShowCrossSession(cfg):
  rec = readFreqRecord()            // {} if none/blocked
  now = Date.now()

  // Post-purchase suppression
  if rec.convertedAt and now - rec.convertedAt < cfg.postPurchaseDays * DAY:
    return false

  // Rolling 30d ceiling window reset
  if !rec.windowStart or now - rec.windowStart > 30 * DAY:
    rec.windowStart = now; rec.shownCount = 0
  if rec.shownCount >= cfg.maxShowsPer30d:
    return false

  // Cooldown with escalating backoff
  cooldown = cfg.cooldownDays * DAY
  if rec.ignoreStreak == 1: cooldown = cfg.backoff7 * DAY   // 7
  if rec.ignoreStreak >= 2: cooldown = cfg.backoff14 * DAY  // 14
  if rec.lastShownAt and now - rec.lastShownAt < cooldown:
    return false

  return true
```

Stamp on render (add alongside L1749–1754):
```
rec.lastShownAt = now
rec.shownCount += 1
writeFreqRecord(rec)
```

Outcome tracking (drives backoff + suppression):
- On **conversion** (order attributed to the modal): set `rec.convertedAt = now`,
  reset `rec.ignoreStreak = 0`. Hook where the conversion/redirect fires.
- On **engagement** (CTA click / code copy): reset `rec.ignoreStreak = 0`.
- On **dismiss without engagement** (close/X, Escape at L1682, or timed auto-dismiss
  with no interaction): `rec.ignoreStreak += 1`.
  Define "engaged" = any CTA/copy/redirect click during that show.

---

## 5. Config plumbing

Surface four numbers so they're tunable. Follow the existing metafield → liquid →
settings path.

1. **Admin UI:** add fields in `app/components/settings/tabs/AdvancedTab.jsx`
   (Manual mode) mirroring existing numeric inputs (e.g. `settings.cartValueMin`
   pattern at ~L262). Fields: `cooldownDays`, `maxShowsPer30d`, `postPurchaseDays`,
   and optionally `backoff7` / `backoff14`.
2. **Persist:** save to the `exit_intent.settings` metafield alongside the other
   settings (same save action that writes `cartValueMin`, etc.).
3. **Inject:** add to `extensions/exit-intent-modal/snippets/exit-intent-modal.liquid`
   inside `window.exitIntentSettings` (pattern at L27–34), e.g.:
   ```liquid
   frequency: {
     cooldownDays:    {{ shop.metafields.exit_intent.settings.value.cooldownDays    | default: 3  | json }},
     maxShowsPer30d:  {{ shop.metafields.exit_intent.settings.value.maxShowsPer30d  | default: 5  | json }},
     postPurchaseDays:{{ shop.metafields.exit_intent.settings.value.postPurchaseDays| default: 30 | json }},
     backoff7:        {{ shop.metafields.exit_intent.settings.value.backoff7        | default: 7  | json }},
     backoff14:       {{ shop.metafields.exit_intent.settings.value.backoff14       | default: 14 | json }}
   },
   ```
4. **Consume:** in `ExitIntentModal`, read `this.settings.frequency` with the
   defaults above as fallback (settings may be undefined for old installs).

Recommended defaults: **cooldown 3d, backoff 3→7→14, max 5 / 30d, post-purchase 30d.**

---

## 6. Edge cases

- **Storage blocked (preview/incognito):** keep existing preview fallback (L322–324) —
  proceed so QA/preview still renders. `?resparqPreview=` path must bypass the gate.
- **No visitor id yet:** first-ever visit has no record → allowed (correct).
- **Clock skew / negative deltas:** treat negative `now - ts` as "cooldown elapsed"
  (allow) rather than blocking forever.
- **Test mode:** `resparqTestMode` (L39–42) should bypass the cross-session gate like
  it bypasses others, for QA.
- **Multiple tabs:** session gate + last-write-wins on the record is acceptable; no
  locking needed.
- **Conversion attribution timing:** the order webhook is server-side; the client
  `convertedAt` stamp should be set at the client redirect-to-checkout/convert moment
  (best-effort). Server remains source of truth for analytics; this flag only gates
  the client re-show.

---

## 7. Test plan

Manual (theme preview + real session):
1. Fresh visitor → modal shows. Reload same session → does not re-show (session gate).
2. New session within 3 days → does not re-show (cooldown).
3. New session after 3 days → re-shows with a **different** variant (rotation).
4. Dismiss without engaging twice → confirm next gap stretches to 7d then 14d.
5. Simulate conversion → no re-show for 30 days.
6. Force 5 shows in 30d → 6th suppressed until window resets.
7. `?resparqPreview=<template>` and `resparqTestMode` → always render (gate bypassed).
8. Block localStorage (incognito) → preview still renders; no JS errors.

Automated: extend the storefront sim script (`scripts/dev/sim-traffic-qa.mjs`) to
advance timestamps and assert show/no-show per rule.

---

## 8. Touchpoints summary

| File | Change |
|---|---|
| `extensions/exit-intent-modal/assets/exit-intent-modal.js` | Add `shouldShowCrossSession()`, freq read/write helpers, outcome hooks; call from constructor L316–324; stamp at L1749–1754; ignore-streak on dismiss (L1682 + close handlers); convert/engage resets. |
| `extensions/exit-intent-modal/snippets/exit-intent-modal.liquid` | Add `frequency` block to `window.exitIntentSettings` (~L27). |
| `app/components/settings/tabs/AdvancedTab.jsx` | Add numeric inputs for the four thresholds. |
| Settings save action (writes `exit_intent.settings` metafield) | Persist new fields. |

No DB migration required — state lives client-side in `localStorage`.

---

## 9. As implemented (deviations from the plan above)

Shipped 2026-07. Where the implementation differs from §2–§6, the implementation
is correct and this section wins:

1. **Conversion ≠ checkout redirect.** §6's "stamp convertedAt at redirect" was
   wrong: a CTA click is not a purchase, and it would 30-day-suppress the
   highest-intent recovery targets (checkout abandoners). Instead the client
   stamps `checkoutStartedAt` on any checkout-bound engagement (primary CTA,
   navigating secondary CTA, offer-pill redeem). On a later page load,
   `detectPostCheckoutConversion()` checks the cart: empty → Shopify cleared it
   at purchase → `convertedAt` set; still full after 24h → they bailed, flag
   dropped, visitor stays eligible.
2. **Backoff is one knob, not three.** `cooldownDays × 2^ignoreStreak`, capped
   at 30d (3 → 6 → 12 → 24 → 30). No `backoff7`/`backoff14` fields.
3. **True rolling ceiling.** The record stores the actual show timestamps
   (`shownAt: []`, pruned past 30d) instead of `windowStart`/`shownCount`, so
   the 5-per-30d cap is genuinely rolling.
4. **Dismiss counting is centralized.** All close paths (X, overlay, ESC,
   swipe) funnel through `closeModal()`; the existing `ctaClicked` flag
   distinguishes engaged closes. No per-handler hooks.
5. **Offer pill counts.** Pill redeem resets the ignore streak and arms
   purchase detection — a dismisser who redeems via the pill is engaged.
6. **Analytics added (was missing from the plan).**
   - `collectCustomerSignals()` now includes `modalShowCount`,
     `modalIgnoreStreak`, `daysSinceLastShow` → flows into AI-decision
     `signalsJson` + starter-learning storage automatically, so the bandit can
     learn first-show vs. re-show conversion.
   - Impression events to `/apps/exit-intent/track` carry sanitized
     `showNumber` / `daysSinceLastShow` / `ignoreStreak`, stored on the
     analytics + modal-library event records for first-vs-repeat reporting.
7. **QA exemptions.** `?resparqPreview=` and `resparq_test=1` bypass both gates
   and never write frequency state (a merchant self-testing doesn't burn their
   own cooldown).
8. **Config surface:** three fields in Advanced tab → `exit_intent.settings`
   metafield → liquid `frequency` block: `cooldownDays` (0 allowed = every
   visit), `maxShowsPer30d` (min 1), `postPurchaseDays`.
9. `scripts/dev/sim-traffic-qa.mjs` (§7) does not exist; manual test plan still
   applies.

localStorage record shape as shipped:

```json
{
  "shownAt": [1712345678000],      // render timestamps, rolling 30d window
  "lastShownAt": 1712345678000,
  "ignoreStreak": 0,               // consecutive dismiss-without-engage
  "convertedAt": null,             // set by cart-emptied detection
  "checkoutStartedAt": null        // armed on checkout-bound engagement
}
```
