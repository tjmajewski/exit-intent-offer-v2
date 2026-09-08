# Guided (Hybrid) Mode — Implementation & Go-to-Market Plan

> Companion to [HYBRID_MODE_SPEC.md](HYBRID_MODE_SPEC.md). The spec is the source of
> truth for *what* to build; this doc is the *sequence, milestones, and launch*.
> Internal code name: `hybrid`. Customer-facing: **Guided**.

---

## Part A — Implementation Plan

### Phase 0 — Pre-flight (0.5 day)
- Confirm §13 open decisions with yourself (name = "Guided", threshold offers → v2, Pro+ gate, Starter-Guided deferred).
- `git checkout main && git pull origin main`.
- If `.claude/worktrees/` exists: `rm -rf .claude/worktrees && git worktree prune`.
- Snapshot current AI-mode behavior (manual test of one full flow) so regression is provable later.

### Phase 1 — Data layer (0.5 day) · *shippable, no user-visible change*
- Add 5 `hybrid*` columns to `Shop` (§4).
- Additive migration, `ADD COLUMN IF NOT EXISTS`, no backfill.
- Extend `exit_intent/settings` metafield schema to carry hybrid fields.
- **Gate:** migration runs clean on dev DB; existing rows default correctly.
- Commit + push.

### Phase 2 — Server serving path (2 days) · *the core*
- `ai-decision.jsx`: `isHybrid` flag; accept `mode==='hybrid'` (L92); read hybrid settings; Pro+ plan gate.
- Force discount arm; bypass aggression cap + margin guard; `amount = pinned`.
- Hybrid discount-code creation (generic drift-reconcile / unique per-shopper).
- Keep untouched: holdout, propensity, `no_intervention`, variant selection, all learning writes.
- Stacking: use `getDiscountCodeDetails` to predict stackability; reminder-only fallback when unproven.
- **Gate:** unit-test decision in isolation — pinned amount returned exactly, margin guard never fires, `$0` → `pure_reminder`, `no_intervention` still possible.
- Commit + push.

### Phase 3 — Admin UI (2 days)
- `QuickSetupTab.jsx`: 2-card → 3-card (Manual · Guided · AI); Guided gated to Pro+ with `PRO` badge.
- New `HybridSettingsTab.jsx`: pinned offer (type + amount), code type (generic/unique), one-line explainer. Do **not** render aggression slider.
- `app.settings.jsx`: parse/persist hybrid fields to DB **and** metafield (gate mode server-side *before* both writes; write together). Discount update-on-pin-change.
- Live preview reflects the pinned Guided offer.
- **Gate:** settings round-trip persists to both stores; no field bleed switching modes.
- Commit + push.

### Phase 4 — Storefront client (1 day)
- `exit-intent-modal.js`: route `hybrid` through the Pro AI trigger + render path.
- 403 `upgradeRequired` → fail closed and silent (no modal, no console error, no retry).
- No flash of manual content; frequency caps + session gating inherited.
- **Gate:** Guided modal renders on dev store via AI path; lapsed-plan store shows nothing.
- Commit + push.

### Phase 5 — End-to-end on dev store (1 day)
- Run the storefront rows of §11 QA.
- Verify learning writes land (not preview/dev traffic).

### Phase 6 — Upsell CTA (0.5 day)
- "Switch to Autopilot" card, Guided-only, **no dollar/savings figure**, flips `mode` to `ai` preserving history.

### Phase 7 — Onboarding docs (0.5 day)
- Reframe binary Manual/AI framing → three-level spectrum (Manual → Guided → Autopilot) where it appears.
- Update `ONBOARDING.md`, `OnboardingChecklist.jsx` (completion accepts hybrid), Pro/Enterprise/Starter welcome docs, metafield doc. Flag `.docx` exports for regeneration, don't hand-edit.

### Phase 8 — Full QA + release gate (1 day)
- Complete §11 checklist. **Stacking rows are the release blocker** — prove real-world stack (Resparq PRODUCT-class code + competing ORDER-class code) on a real store before the "stacks on top" claim ships anywhere.
- Regression: Manual and full-AI behavior identical to Phase-0 snapshot.

**Core (Phases 1–5) is the shippable engine (~7 days). 6–8 make it sell & gate release (~2 days).**

### Risk register
| Risk | Severity | Mitigation |
|------|----------|------------|
| Same-class discount collision blocks stacking | High | Inspect applied code; reminder-only fallback; QA on real store before claim ships |
| Automatic discounts invisible → doomed second code | High | "When unsure, don't mint" rule |
| DB row / metafield mode drift | Med | Gate before both writes; write together; fail if metafield write fails |
| Stale generic code after pin change | Med | Update/re-mint on save (Phase 3) |
| Starter POSTs `mode=hybrid` | Med | Server plan gate is source of truth; client hiding is cosmetic |

---

## Part B — Go-to-Market Plan

> **Guardrail:** zero paying stores today. No invented uplift %, recovered $, CVR,
> or testimonials anywhere. Measurement-*capability* claims are fine (the holdout
> measures real per-store lift). No em dashes in marketing copy.

### B1 — Positioning
**One line:** *"You set the offer. AI does the rest."*

Guided is a **first-class mode**, not a trial. It is the control bridge:

> **Manual** — you set everything · **Guided** — you set the offer, AI sets who/when/how · **Autopilot** — AI sets everything, including the offer.

**Who it's for:** margin- and brand-protective stores that want AI optimization but will not hand different discounts to different shoppers.

**Why it wins:** Resparq only fires when a shopper is abandoning despite what they already had, so its offer stacks on top as the closing nudge. Pay-for-performance narrative: *"Resparq earns its keep by closing the shoppers your existing offers couldn't."*

### B2 — Messaging pillars
1. **Control without compromise** — pin one offer for everyone; AI never changes the number.
2. **AI where it's safe** — copy, timing, placement, targeting are automated; your margin exposure is exactly what you set.
3. **Stacks on top** (common case only, honest caveat) — layers on your existing order-level codes; reminder-only when it can't.
4. **Warm upgrade path** — the engine learns the whole time, so switching to Autopilot later starts warm.

### B3 — Launch assets
| Asset | Location | Notes |
|-------|----------|-------|
| Pricing reframe | `resparqwebsite` `components/site/Pricing.tsx` | Pro shows two lines: "Guided — you set the offer, AI does the rest" + "Full AI — AI optimizes everything". Optional Manual→Guided→Autopilot caption. |
| Homepage feature + FAQ | `resparqwebsite` `app/page.tsx` | Control-spectrum feature block; one FAQ: "What's the difference between Guided and full AI mode?" |
| Consistency pass | `resparqwebsite` `app`/`components` | Grep "manual"/"AI mode", align spectrum across hero/features/pricing/FAQ. |
| In-app upsell CTA | admin analytics surface | Capability copy, no savings figure. |
| Onboarding docs | Part A Phase 7 | Position Guided as recommended Pro starting point. |
| LinkedIn / IG launch posts | `linkedin-drafts/`, `instagram-drafts/` | Positioning + pillars above. No fabricated results. No em dashes. |

### B4 — Pricing & packaging
- **v1: Guided requires Pro+** (same gate as AI). It becomes the concrete reason to move Starter → Pro: *"get AI working on the offer you already trust."*
- Starter welcome doc carries the upsell paragraph.
- Growth option (later, not v1): limited Guided on Starter as the ultimate on-ramp — tracked follow-up, not a launch blocker.

### B5 — Launch sequence
1. **Ship the engine** (Part A 1–5) behind the Pro+ gate.
2. **Prove stacking** on a real store (release blocker) before any "stacks on top" claim goes live.
3. **Ship upsell CTA + onboarding docs.**
4. **Update website** (pricing, homepage, FAQ) in the `resparqwebsite` repo — deploy only after the app supports Guided so copy and product agree.
5. **Announce** (LinkedIn/IG drafts) once website + app are live and consistent.

### B6 — Success signals (per store, honest)
- Holdout-measured lift of Guided vs nothing (real, per store — the only conversion claim we can make).
- Starter → Pro conversions attributable to Guided.
- Guided → Autopilot flips (warm-start upgrade path working).
- No fabricated aggregate metrics until real store data exists.

---

## Appendix — Files touched (from spec §14)
**exit-intent-offer-v2:** `prisma/schema.prisma` + migration · `apps.exit-intent.api.ai-decision.jsx` · `app.settings.jsx` · `QuickSetupTab.jsx` · `HybridSettingsTab.jsx` (new) · `SettingsPreview.jsx` · `exit-intent-modal.js` · upsell CTA card · `ONBOARDING.md` · `OnboardingChecklist.jsx` · `docs/onboarding/*.md`

**resparqwebsite:** `components/site/Pricing.tsx` · `app/page.tsx` · consistency pass.
