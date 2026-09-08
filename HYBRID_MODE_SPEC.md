# Hybrid Mode ("Guided") — Build Specification

> **Status:** Approved concept, ready to build. This document is the complete
> hand-off for the implementation session. It spans TWO repos:
> - **`exit-intent-offer-v2`** (Shopify app: engine, admin UI, storefront) — this repo
> - **`resparqwebsite`** (Next.js marketing site: pricing + product copy) — separate repo
>
> Author: product brainstorm session. Every product decision below is locked
> unless flagged in **§13 Open Decisions**.

---

## 1. What we're building (one paragraph)

A third optimization mode that sits between **Manual** (merchant sets
everything) and **AI / Autopilot** (AI sets everything). Hybrid's promise:
**the merchant keeps control of the promo — one fixed, independent offer for
everyone — and hands the AI the levers they're comfortable automating: copy,
placement, timing, and targeting.** It is the comfort bridge for a merchant who
wants AI's optimization but will **not** let a machine hand different discounts
to different people.

The pinned offer is **Resparq's own independent code** (never tied to another
app's promo), served to every eligible shopper with no margin-based
suppression. Critically, Resparq fires **because** it judges a shopper is about
to abandon — meaning whatever offers they already had were **not enough** — so
Resparq's code is designed to **stack on top by default** (see §2b). The engine
keeps learning the whole time, so a merchant who later flips to full AI starts
warm.

---

## 2. Locked product decisions

| # | Decision | Ruling |
|---|----------|--------|
| 1 | Does Hybrid honor the pin over the margin guard? | **Yes.** Every eligible shopper gets the exact pinned offer. The AI margin guard and aggression size-cap are **bypassed** in Hybrid. |
| 2 | What happens to the aggression slider? | **It does not exist in Hybrid.** Pinning the number *is* the aggression setting. The slider is AI-mode-only. |
| 3 | Does the AI skip shoppers for margin reasons? | **No.** No margin-based suppression. Every eligible exit-intent shopper gets the offer. |
| 4 | Timing / copy / layout? | **AI-controlled** (full variant engine + evolution, unchanged). |
| 5 | Measurement holdout (5%)? | **Kept.** Proves Resparq's real lift per store (Hybrid vs nothing). Invisible to the merchant. |
| 6 | $0 pinned offer? | **Announce-only** (`pure_reminder` baseline). Behaves exactly like AI aggression = 0. |
| 7 | Learning continuity? | **Preserved.** Hybrid runs through the same learning writes as AI, so flipping to full AI later starts warm. |
| 8 | Upsell mechanic? | **Capability CTA only — NO fabricated savings number.** A "Switch to Autopilot" CTA pitches what full AI adds (per-shopper offer sizing to protect margin). We do **NOT** claim "full AI would have saved you $X" — that counterfactual is unmeasurable (we only observe conversions that happened *with* the pinned offer; whether they'd convert at a smaller offer is unknowable). No shadow log. |
| 9 | Discount code source? | **Independent.** Resparq mints/owns its own code — never tied to another app's promo. Merchant sets the value; Resparq owns the rules. |
| 10 | Stack with the shopper's existing discounts? | **Stack by default.** Resparq fires *because* the shopper is abandoning despite what they had, so its offer is meant to sit on top. ⚠️ Bounded by Shopify's discount-combination limits — see §2b. |
| 11 | Abandonment signals into the decision? | **`promoInCart` + `failedCoupon` are model inputs, NOT forced interventions.** Feed both into the show/skip model and copy selection; let the AI *learn* whether they predict a genuine abandoner. A failed coupon does **not** automatically warrant a popup — the model decides. |

**Naming:** internal `mode` value is **`"hybrid"`** (never change this — it's the
code contract). Customer-facing name is **"Guided"** (alt: "Guided AI"). Keep the
two decoupled so a marketing rename never touches code.

**Positioning:** Hybrid is a **first-class mode** — "AI for delivery, you for the
discount" — **not** merely a trial for full AI. Most brand-/margin-protective
stores may live here permanently. A quiet "Switch to Autopilot" CTA is available
for stores open to letting AI size the discount too — pitched on capability, not
on any fabricated savings figure (see §2 decision #8).

---

## 2b. Stacking, independence & abandonment signals

**The selling point:** Resparq only intervenes when the orchestrator judges a
shopper is about to abandon — which means whatever they had so far (browsing
freely, or even a discount already applied) **wasn't enough** to convert them.
Resparq's offer is therefore the *additional* nudge, and it is designed to
**stack on top of** whatever the shopper already has. "Resparq earns its keep by
closing the shoppers your existing offers couldn't" is the pay-for-performance
narrative — lean on it.

**Signals to use (already in the engine) — as model inputs, not forced rules:**
- **`promoInCart`** — the shopper is abandoning *with a discount code already
  applied*. A strong "current offer insufficient" candidate signal; when the
  model does choose to show, copy can acknowledge it ("here's a little more...").
- **`failedCoupon`** (already a `triggerReason` in the engine) — the shopper
  *tried* a code that failed (expired/invalid). A high-intent signal, but **not**
  an automatic trigger: a failed coupon alone does not mean a popup is warranted.
  The AI learns from outcomes whether it predicts a genuine abandoner.
- Both feed the show/skip **model** and the copy/variant selection. Neither
  bypasses the propensity/targeting decision — the AI stays in control of *whether*
  to show.

> ⚠️ **Stacking is bounded by Shopify's rules — see §2b.1 for the accurate model.**
> Short version: Resparq's code already stacks on the *common* case (store's
> `WELCOME15`-style order code + Resparq's product-class code), but not always.
> When it can't stack, fall back to reminder-only. Prove it on a real store in QA
> (§11) before shipping the "stacks on top" claim.

**Margin exposure note:** stack-by-default + honor-the-pin + no margin guard means
total discount depth is uncapped by Resparq. This is expected and accepted — the
merchant is deliberately setting a discount and knows it stacks; no in-app margin
warning is needed. The only mitigant that matters is **targeting quality** (the
AI's show/skip firing on genuine abandoners), so the show/skip decision carries
more weight in Hybrid than in AI mode.

### 2b.1 Shopify stacking — technical appendix (good news: mostly already built)

The earlier "two codes can't stack" warning was too pessimistic. Actual Shopify
combination model + what the codebase already does:

**How Shopify combines discounts.** Every discount has a **class** — `ORDER`,
`PRODUCT`, or `SHIPPING` — plus a `combinesWith { orderDiscounts,
productDiscounts, shippingDiscounts }` boolean set. Two discounts stack at
checkout only if they are **different classes** AND **each** permits the other's
class. Two discounts of the **same class never stack** (two ORDER codes can't
both apply; two PRODUCT codes can't either).

**What Resparq already issues** (`app/utils/discount-codes.js`,
`createPercentageDiscount` / `createFixedDiscount`, and `createGenericDiscountCode`):
```
customerGets: { value: {...}, items: { all: true } }   // → PRODUCT-class discount
combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true }
```
Because it targets `items.all` (not the order subtotal), Resparq's code is
already a **PRODUCT-class** discount and already marked combinable with
everything. So it *is* built to layer on top of a store's typical
`WELCOME15`-style **ORDER-class** "amount off order" code. Little-to-no new code
needed here — the plumbing exists.

**The two things that actually block stacking (call these out to merchants):**
1. **The other app's code must permit product discounts** —
   `combinesWith.productDiscounts: true` on *their* code. Resparq cannot set
   this; it's the merchant's/other app's config. If it's off, they won't stack.
2. **Same-class collision** — if the competing code is *also* product-class
   (an "amount off products" code, not "off order"), the two can't stack no
   matter what.

**What "detection gap" means in plain terms:** sometimes we can't tell in advance
whether our code will stack, because we can't always see what's already in the
cart. We can inspect a *code* the shopper applied (`promoInCart`), but Shopify
**automatic discounts** have no code, so they're invisible to us. If we mint a
second code that Shopify then refuses to combine, the shopper sees a broken/ignored
discount. The safe rule: **when unsure, don't mint — show the reminder instead.**

**Design/build actions:**
- Use `getDiscountCodeDetails` (already exists) to inspect an applied code's
  class + combinesWith and predict stackability.
- Keep Resparq's code **PRODUCT-class + combinesWith all-true** (already the
  case) — do not "fix" it to an order-subtotal discount, which would *reduce*
  stackability.
- **Fallback = reminder-only** whenever stacking is unproven for this cart:
  a same-class/non-combinable applied code, **or** any case we can't inspect
  (e.g. an automatic discount). Don't mint a doomed second code.
- **Pitch honestly:** "stacks on top of your existing offers" is true for the
  common case (ORDER-class code + Resparq PRODUCT-class), false otherwise. QA
  must confirm on a real store before the claim ships (§11 Stacking rows).

---

## 3. Architecture context (why this is small)

The engine already separates **"what offer amount"** from **"everything else."**
Hybrid freezes only the amount. Concretely, the current AI decision flow in
`app/routes/apps.exit-intent.api.ai-decision.jsx` is:

1. **Show at all?** → propensity + `decideOffer` (can return `no_intervention`)
2. **Discount or reminder?** → discount-arm evidence gate + aggression roll
3. **How big?** → variant gene pool picks amount → aggression cap → **margin guard**
4. **Copy / layout / timing** → Thompson Sampling over variants

**Hybrid changes only steps 2 and 3:** force step 2 to "always discount" for
eligible shoppers, and replace step 3's gene-pool amount with the merchant's
pinned number (skipping the cap + margin guard). Steps 1 and 4 run untouched.
Two facts confirm the fit:
- Aggression `0` already forces `pure_reminder` (see `ai-decision.jsx` ~L556) → our `$0` case is free.
- The generic-code reconciliation path (~L975–1035) already aligns copy to a fixed merchant code value — in Hybrid this becomes trivially correct because `decision.amount` already equals the pinned value.

---

## 4. Data model changes (`prisma/schema.prisma` + migration)

Add to the `Shop` model (mirrors the existing `manual*` / `ai*` discount split
at L122–130):

```prisma
// Hybrid ("Guided") Mode — merchant pins the offer, AI does the rest
hybridOfferType        String  @default("percentage") // "percentage" | "fixed"
hybridOfferAmount      Float   @default(15)            // pinned value (15 => 15% or $15)
hybridDiscountCodeMode String  @default("generic")     // "generic" | "unique"
hybridGenericDiscountCode String?
hybridDiscountCodePrefix  String? @default("EXIT")
```

Notes:
- `mode` column already accepts any string (`@default("manual")`) — no enum to widen. Values become `manual | hybrid | ai`.
- Default `hybridDiscountCodeMode = "generic"`: a fixed offer maps naturally to one reusable code (e.g. `YOURSTORESAVE15`). Unique still allowed.
- **Threshold offers** ("spend $X get $Y") are **out of scope for v1** (§13). `hybridOfferType` is `percentage | fixed` only.
- Migration: additive `ALTER TABLE ADD COLUMN IF NOT EXISTS` (follow the pattern in `prisma/migrations/20260121174800_separate_manual_ai_discount_settings/migration.sql`). No backfill needed — defaults cover existing rows.

The pinned amount is also written into the **`exit_intent/settings` metafield**
(the storefront + decision endpoint read settings from the metafield, not the DB
row — see `ai-decision.jsx` L70–106). Both must carry the hybrid fields.

---

## 5. Core serving logic — `app/routes/apps.exit-intent.api.ai-decision.jsx`

This endpoint currently rejects anything but AI mode (L92). Make it serve Hybrid
through the same path with the following surgical changes. Add near the top:
`const isHybrid = settings.mode === 'hybrid';`

| Location (current) | Change |
|--------------------|--------|
| **L92** `if (settings.mode !== 'ai')` | Accept both: reject only if `mode !== 'ai' && mode !== 'hybrid'`. |
| **L96–106** settings destructure | Also read `hybridOfferType`, `hybridOfferAmount`, `hybridDiscountCodeMode`, `hybridGenericDiscountCode`, `hybridDiscountCodePrefix`. |
| **L170–181** plan gate | Hybrid requires **Pro or Enterprise**, same as AI (see §9). Starter → 403 `upgradeRequired`. |
| **L387 / L554** aggression | In Hybrid, **ignore `aggression` entirely.** Set an internal `effectiveAggression` that means "always discount, no size cap" — but do NOT run the aggression cap or roll below. |
| **L556–598** discount-vs-reminder arm | **Skip for Hybrid.** If `hybridOfferAmount > 0` → force a `*_with_discount` baseline (keep the `selectBaseline` revenue/conversion split from `aiGoal`). If `hybridOfferAmount == 0` → force `pure_reminder` (same as aggression 0). No evidence gate, no coin flip. |
| **L677–720** aggression cap + margin guard | **Skip entirely for Hybrid.** Set `cappedOfferAmount = hybridOfferAmount` and `decision.type = hybridOfferType` (`percentage` → `'percentage'`, `fixed` → `'fixed'`). The margin guard's announce-only downgrade must NOT run. |
| **L970–1050** discount code creation | Use the **hybrid** discount settings (`hybridDiscountCodeMode` etc.) instead of the `ai*` ones. **Generic path (L975):** the served code value must equal the *current* pinned amount. Keep the drift-reconciliation as a live safety net (not a no-op): if the stored generic code's value ≠ `hybridOfferAmount` (merchant changed the pin), update/re-mint before serving so copy and code never disagree. **Unique path:** minted fresh per shopper at the current pin, so no drift. |

**Everything else stays:** holdout (L230–288), propensity enrichment, variant
selection / Thompson Sampling (copy/layout/timing), impression + intervention +
journey writes, `no_intervention` when propensity says "don't show" (this is
eligibility/targeting, which we keep — it is NOT margin suppression).

> **Subtlety to get right:** `no_intervention` (L473) must still be allowed — it
> is the AI deciding this visitor isn't a genuine abandoner (targeting), which is
> the value Hybrid keeps. What we remove is the *margin guard* dropping a real
> abandoner to announce-only to protect margin. Do not conflate the two.

### 5.1 No shadow log

**Removed.** An earlier draft logged what full AI "would have offered" to power a
"margin saved" report. We are **not** building that — the counterfactual is
unmeasurable (we only observe conversions that happened *with* the pinned offer;
whether the same shopper would convert at a smaller offer is unknowable), so any
savings figure would be fabricated. No `computeShadowOffer`, no
`hybrid-shadow.server.js`, no `decision.shadow`.

### 5.2 "Switch to Autopilot" CTA (admin) — capability, not fabricated savings

- A simple upsell card/CTA on the AI/analytics surface, visible only when
  `mode === 'hybrid'`.
- Copy pitches **what full AI adds**, with **no dollar figure**: *"Autopilot also
  sizes each offer per shopper — giving less where less will do — to protect your
  margin automatically. Switch to Autopilot →"*
- The **"Switch to Autopilot"** CTA flips `mode` to `'ai'` (carrying the warm
  learning history). Make it prominent, but never attach a "$X saved" claim to it.

---

## 6. Storefront client — `extensions/exit-intent-modal/assets/exit-intent-modal.js`

Hybrid needs the AI decision (for timing/copy/layout), so on the client it
behaves like **Pro AI**: it calls `/apps/exit-intent/api/ai-decision` and renders
the returned decision. Changes:

| Location (current) | Change |
|--------------------|--------|
| **L764–790** trigger setup branch | Add Hybrid to the AI path. `mode === 'ai' \|\| mode === 'hybrid'` → use `setupAITriggers()` (Pro AI path) for all plans in v1. Enterprise-only surface arms stay AI-only. |
| **L2245** render branch | `else if (mode === 'ai' \|\| mode === 'hybrid')` → `getAIDecision()` + honor `aiDecidedNoIntervention`. |
| **L2253** manual/starter branch | Unchanged — Hybrid never falls here. |
| `generate-code` usage (L2255, L2422) | No change. Hybrid mints codes server-side inside `ai-decision` (like AI), never via `generate-code`. |

No "flash of manual content": Hybrid follows the same pre-fetch-before-show
discipline as AI (L2227 comment). Frequency capping, session gating, preview/test
mode all inherit from the AI path unchanged.

**Storefront feature gating (item 6):** the client must not assume `mode==='hybrid'`
is always allowed. If the store's plan lapsed to Starter while the saved mode is
still `hybrid`, `ai-decision` returns **403 `upgradeRequired`**. Handle it exactly
like the AI path already does: **show nothing** (no modal, no console error, no
retry loop) — treat a 403 as "no intervention." The server plan gate (§5, L170–181)
is the source of truth; the client just fails closed and silent.

`generate-code.jsx` L49 (`mode === "ai" ? aiDiscountCodeMode : manualDiscountCodeMode`)
does **not** need to know about Hybrid, because Hybrid doesn't use that endpoint.
Leave it, but add a code comment noting Hybrid is served via `ai-decision`.

---

## 7. Admin UI

### 7.1 `app/routes/app.settings.jsx` (action + hidden inputs)

- **L172 / L187–188 / L229–231:** the `mode === "ai"` checks that force
  exit-intent-on / time-delay-off must become `(mode === "ai" || mode === "hybrid")`
  — Hybrid lets the AI own timing, same as AI.
- **Server-side plan gate (feature gating, item 6):** the action must **reject**
  a save that sets `mode === 'hybrid'` when the shop is not Pro+ (reuse
  `canUseAIMode` / the same check as AI). Do not trust the client to hide the
  card — a Starter POSTing `mode=hybrid` must be refused and the mode left
  unchanged. The DB row and the metafield must never disagree on mode, so gate
  **before** either write and write both together (if the metafield write fails,
  don't leave the DB row on `hybrid`).
- Parse and persist the new fields into both the DB `upsert` (L352–436) and the
  `settings` metafield JSON (L181–244, L549):
  `hybridOfferType`, `hybridOfferAmount`, `hybridDiscountCodeMode`,
  `hybridGenericDiscountCode`, `hybridDiscountCodePrefix`.
- In the discount-code creation block (L300–349), add a Hybrid branch that mints
  the generic code from the pinned amount (reuse `createGenericDiscountCode` +
  `derivePrefixFromShop`, mirroring the existing generic path).
- **Discount update on pin change (item 7):** on save, if a `hybridGenericDiscountCode`
  already exists and the pinned `hybridOfferType`/`hybridOfferAmount` changed since
  last save, **update the existing Shopify discount's value (or re-mint and replace
  the stored code)** so the live code always matches the current pin. Never leave a
  stale `SAVE15` code applying 15% after the merchant moved the pin to 20%. Unique
  codes need no update (minted fresh per shopper at serve time).

### 7.2 `app/components/settings/tabs/QuickSetupTab.jsx` (the mode selector)

- Change the 2-card grid (L65, `gridTemplateColumns: "1fr 1fr"`) to **3 cards**:
  **Manual · Guided · AI** (`"1fr 1fr 1fr"`, tighten padding for the narrower cards).
- **Guided card:** gate to Pro+ exactly like the AI card (`canUseAIMode`), show
  a `PRO` badge + the same upgrade nudge when locked. Copy: *"You set the offer.
  AI decides who sees it, when, and how — for maximum conversions."*
- When `optimizationMode === 'hybrid'`, render a **new `HybridSettings` block**
  (create `app/components/settings/tabs/HybridSettingsTab.jsx`) containing ONLY:
  1. **Pinned offer**: offer-type radio (Percentage / Fixed) + amount input
     (reuse the exact inputs from the manual Discount section, L439–524, wired to
     `hybridOfferType` / `hybridOfferAmount`).
  2. **Discount code type**: generic / unique radios (reuse manual pattern,
     default **generic**). This is the merchant's choice between a shared code and
     a personalized per-shopper code — **no separate checkbox needed, this radio
     already covers it.** Customer-facing labels: "Same code for everyone"
     (generic) vs "Unique code per shopper" (unique/personalized). Unique prevents
     code leakage/sharing; generic is simpler.
  3. A one-line explainer: *"Every eligible shopper gets this exact offer. AI
     handles the rest."*
  - **Do NOT render `AISettingsTab`** (that's the aggression slider) for Hybrid.
- `AISettingsTab` (aggression slider) stays gated to `optimizationMode === 'ai'`
  only (currently L151).

### 7.3 Live preview (`SettingsPreview` / `app.settings.jsx` L735–759)

- Pass `optimizationMode` + the pinned offer to the preview so a Hybrid config
  shows the fixed offer (not a manual template or an AI placeholder).

---

## 8. Onboarding docs to update (`docs/onboarding/*.md`, `ONBOARDING.md`)

These are stale (binary manual-vs-AI framing throughout) — the user has approved
fixing what we touch. Concrete edits:

| File | Change |
|------|--------|
| **`ONBOARDING.md`** (L20–27) | The Pro/Enterprise checklist step 2 "Configure AI decisioning" completes on `settings.mode === "ai"`. Update trigger to `mode === "ai" \|\| mode === "hybrid"` and reword step to "Configure AI or Guided mode." |
| **`app/components/OnboardingChecklist.jsx`** (L43–44) | Same: the step-completion check and label/description must accept Hybrid. (Code change referenced by ONBOARDING.md.) |
| **`docs/onboarding/PRO_WELCOME_ONBOARDING.md`** | Pro is where Guided lives — add a "Guided Mode (recommended starting point)" section before the AI-mode section (L304). Frame Guided as the low-risk on-ramp: keep your offer, let AI optimize delivery. Note the aggression slider is AI-only. |
| **`docs/onboarding/ENTERPRISE_WELCOME_ONBOARDING.md`** | Add Guided as available; clarify Enterprise still gets full AI + overrides. |
| **`docs/onboarding/STARTER_WELCOME_ONBOARDING.md`** | Add a "want AI to optimize your fixed offer? Upgrade to Pro for Guided mode" upsell paragraph. |
| **`docs/onboarding/PRO_VS_ENTERPRISE_AI_METAFIELDS.md`** | Document the new `hybrid*` metafield/DB fields and how the metafield carries the pinned offer. Add a Guided row to the comparison table (L39). |
| `.docx` siblings | These are generated exports — regenerate or flag for manual re-export; do NOT hand-edit binary docx. |

**Audit instruction for the build session:** grep each onboarding doc for
"manual mode" / "AI mode" / "two modes" and reframe as a **three-level control
spectrum** (Manual → Guided → Autopilot) wherever the binary framing appears.
Don't rewrite wholesale — insert Guided and fix contradictions only.

---

## 9. Plan gating decision

**v1: Guided requires Pro or Enterprise** (same gate as AI — reuse `canUseAIMode`
and the L170–181 server gate). Rationale: it runs the full AI engine
(propensity, variant selection, learning), which Starter is architecturally
blocked from. This is the cheapest correct v1 and positions Guided as the
**reason to move from Starter → Pro** ("get AI working on the offer you already
trust").

**Growth option (later, not v1):** offer a limited Guided to Starter as the
ultimate on-ramp. This requires running the engine for Starter and is a bigger
lift + cost — track as a follow-up, don't build now. (See §13.)

---

## 10. Website changes — `resparqwebsite` repo (SEPARATE repo/branch)

### 10.1 `components/site/Pricing.tsx`

- Reframe the ladder as **three levels of control**. Concrete edits to the
  `plans` array (L15–71):
  - **Starter** (L22): keep "Manual mode (you set what appears and when)".
  - **Pro** (L39–50): replace the bare "AI mode" line with two lines that tell
    the control story:
    - `Guided mode — you set the offer, AI does the rest`
    - `Full AI mode — AI optimizes everything, including the offer`
  - **Enterprise**: unchanged, still "Everything in Pro" + overrides.
- Optional: add a small "Manual → Guided → Autopilot" control-spectrum caption
  above the tiles.

### 10.2 `app/page.tsx` (homepage copy + FAQ)

- **Features array** (~L60+): add/adjust a feature block introducing the control
  spectrum — "Start with your offer locked, graduate to full autopilot."
- **FAQ** (`faqItems`): add one entry:
  - Q: *"What's the difference between Guided and full AI mode?"*
  - A: In **Guided**, you pin the discount (say 15% off) and Resparq's AI decides
    who sees it, when, and with what message — your margin exposure is exactly
    what you set. In **full AI (Autopilot)**, the AI also chooses the discount
    size per shopper to protect margin and maximize profit. Guided is the
    confident first step; Autopilot is the profit-max endgame.
- Keep the existing "17 signals" / "right message to the right customer" FAQ — it
  already supports the Guided story (AI decides *who/when*, merchant sets *what*).

### 10.3 Product-description consistency pass

Grep the site (`app`, `components`) for "manual" / "AI mode" and make sure the
control spectrum reads consistently across hero, features, pricing, and FAQ.

---

## 11. QA plan (for the build/QA Claude session)

Run after implementation. **Expected result in bold.**

### Settings round-trip
- [ ] Select Guided, pin 15% / generic code, save → reload: mode persists, offer persists in **both DB row and `exit_intent/settings` metafield**.
- [ ] Aggression slider is **not rendered** in Guided; **is** rendered in AI.
- [ ] Switching Manual ↔ Guided ↔ AI saves cleanly, no field bleed (manual copy not wiped, etc.).

### Server decision (`ai-decision`)
- [ ] Guided decision returns `amount` **exactly equal to the pinned value** for an eligible shopper.
- [ ] Margin guard does **NOT** fire in Guided: a high-propensity cart still gets the full pinned offer (in AI mode the same cart would be announced-only).
- [ ] Aggression cap does **NOT** fire: pinned 15% is never reduced.
- [ ] Pinned $0 → **announce-only** modal (`pure_reminder`), code = null.
- [ ] Copy / layout / timing **still vary** across impressions (variant engine live).
- [ ] `no_intervention` (targeting) **still possible** — a clearly non-abandoning visit can be skipped.
- [ ] Holdout: ~**5%** of eligible visitors still get nothing, logged as holdout.
- [ ] Learning writes present: `VariantImpression`, `InterventionOutcome`, `AIDecision`, `VisitorTouch` all written for Guided (not dev/preview traffic).

### Plan gating
- [ ] Starter cannot select Guided (card locked, `PRO` badge).
- [ ] Shop with `mode='hybrid'` downgraded to Starter → server **403 `upgradeRequired`** (same as AI).

### Discount codes
- [ ] Guided generic: one reusable code whose value **matches the pinned amount** (no "Save 25%" vs 15% drift).
- [ ] Guided unique: fresh per-shopper code, correct amount, 24h expiry.
- [ ] Code is **independent** (Resparq-owned), not read from any other app.

### Stacking (§2b) — highest-risk verification
- [ ] Put a competing Order-class code (e.g. `WELCOME15`) on the store. Confirm whether Resparq's code **actually stacks** at checkout, per Shopify's combination rules.
- [ ] Resparq's code is issued in a class/config that **permits combination** (Product-class or automatic + combinable).
- [ ] When stacking is impossible, Resparq falls back to **reminder-only** (no failed second code, no broken checkout).
- [ ] `promoInCart` / `failedCoupon` are passed to the model as inputs; a failed coupon does **not** force a popup (model still decides show/skip). When the model does show a `promoInCart` shopper, copy can acknowledge it.

### Client / storefront
- [ ] Guided uses the AI trigger path (calls `ai-decision`), **no flash of manual content**.
- [ ] Frequency caps + session gating respected.
- [ ] Preview / `?resparq_test=1` renders a Guided modal and does **not** pollute learning.

### Upsell CTA
- [ ] "Switch to Autopilot" CTA shows only in Guided, carries **no dollar/savings figure**, and flips `mode` to `ai` preserving learning history.

### Regression (must be untouched)
- [ ] Manual mode: identical behavior to before.
- [ ] Full AI mode: identical behavior to before (aggression, margin guard, discount-arm all still active).

---

## 12. Suggested build sequence

1. **Schema + migration** (§4) — additive columns, deploy first.
2. **Server serving path** (§5) — Guided decision returns pinned offer (incl. server plan gate + discount-update-on-pin-change). Unit-test the decision in isolation.
3. **Admin UI** (§7) — 3-card selector + HybridSettings block + settings action.
4. **Client** (§6) — Guided → AI trigger path (incl. 403 fail-closed).
5. **End-to-end** on a dev store (§11 storefront rows).
6. **"Switch to Autopilot" CTA** (§5.2) — capability copy, no savings figure.
7. **Onboarding docs** (§8).
8. **Website** (§10) — separate repo/branch.
9. **Full QA pass** (§11).

Steps 1–5 are the shippable core; 6–8 make it sell; 9 gates release.

---

## 13. Open decisions (confirm before/during build)

1. **Customer-facing name:** "Guided" (recommended) vs "Guided AI" vs "Copilot". Code value stays `hybrid` regardless.
2. **Threshold offers** ("spend $X get $Y off") in Guided — **deferred to v2.** Confirm OK for v1 (percentage + fixed only).
3. **Enterprise Guided timing:** v1 uses the Pro AI trigger path for all plans (no enterprise surface-arm/pill in Guided). Confirm acceptable, or scope enterprise timing into Guided later.
4. **Starter Guided (growth option, §9):** explicitly out of v1. Confirm as a tracked follow-up, not a launch blocker.
5. **Discount stacking (§2b) — HIGHEST-RISK ITEM.** "Stack by default" is the intended behavior, but Shopify's discount-combination rules may block two same-class codes from stacking. Build session must prove real-world stacking (Resparq code + a competing Order-class code) before the "stacks on top" claim ships; design the code's discount class for combinability, with reminder-only as the fallback when stacking is impossible.

---

## 14. Files touched (index)

**`exit-intent-offer-v2`:**
- `prisma/schema.prisma` + new migration
- `app/routes/apps.exit-intent.api.ai-decision.jsx` (core)
- `app/routes/app.settings.jsx` (action + preview props)
- `app/components/settings/tabs/QuickSetupTab.jsx` (3-card selector)
- `app/components/settings/tabs/HybridSettingsTab.jsx` (new)
- `app/components/settings/SettingsPreview.jsx` (Guided preview)
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` (client trigger + render branches)
- "Switch to Autopilot" CTA card (analytics/admin route — locate existing AI analytics surface; no shadow/savings data)
- `ONBOARDING.md`, `app/components/OnboardingChecklist.jsx`, `docs/onboarding/*.md`

**`resparqwebsite`:**
- `components/site/Pricing.tsx`
- `app/page.tsx` (features + FAQ)
- consistency pass across `app` / `components`
