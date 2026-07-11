# Evolution System - Resparq AI

Deep dive into the genetic algorithm powering Resparq's AI-driven variant optimization.

**Last Updated:** July 11, 2026
**Core file:** `app/utils/variant-engine.js`
**Cron:** hourly via `app/cron/evolution-cycle.js`

---

## Overview

The Evolution System automatically generates, tests, and optimizes exit-intent
modal variants using a genetic algorithm layered under Bayesian bandits.
Unlike traditional A/B testing (2-3 manually-created options, one global
winner), the Evolution System:

- **Generates** a population of variants automatically (tier-capped: Pro 2, default 10, Enterprise up to 20)
- **Tests** them simultaneously with real customers via Thompson Sampling
- **Kills** poor performers on Bayesian statistical evidence — never on raw rank
- **Breeds** winners to create improved offspring (crossover + mutation)
- **Evolves** independently per baseline × device segment — mobile and desktop populations each converge on their own winners

**Result:** merchants get continuously improving modals without configuring anything.

---

## Core Concepts

### 1. Genes (ten per variant)

**Content genes:**
- `headline` — main headline (regular, social-proof, or urgency pools)
- `subhead` — supporting text
- `showSubhead` — whether the subhead renders at all
- `cta` — button text
- `offerAmount` — discount % (or $ for threshold offers); always clamped at serve time by the margin guard
- `redirect` — CTA destination (`cart`, `checkout`)
- `urgency` — expiry presentation (`true` = expiry-aware copy, `false` = countdown timer)

**Behavior genes:**
- `triggerType` — WHEN the modal fires (`exit_intent`, `idle`, `exit_intent_or_idle`)
- `idleSeconds` — idle-trigger delay (15/30/45/60)

**Design gene:**
- `templateId` — one of 8 modal layout templates (merchants can disable layouts that clash with their theme; the AI never generates or serves a disabled one)

### 2. Baselines

A baseline is a strategy population: `revenue_with_discount`,
`revenue_no_discount`, `conversion_with_discount`, `conversion_no_discount`,
`pure_reminder`. The funnel-stage detector routes each visitor to a baseline;
the evidence-gated discount decision (see AI_SYSTEM_COMPLETE_GUIDE) can
downgrade `with_discount` → `no_discount` per visitor.

### 3. Population cells

Populations exist per **(shop, baseline, segment)** where segment is
`mobile` / `desktop` / `all`. Each cell has its own `EvolutionCursor` row —
cycles trigger on that cell's own impression count, so one baseline's cycle
never resets another's counter, and device populations evolve independently.

### 4. Fitness

One metric everywhere: **profit per impression** =
(revenue − actual recorded discount cost) / impressions. Recomputed from the
per-conversion discount records each cycle (dollar-off offers are costed in
dollars, not misread as percentages). This is why a no-discount reminder can
beat a 25%-off variant: it keeps full margin.

---

## Evolution Cycle (per baseline × segment, at 100+ new impressions)

```
Hourly cron
  ↓ for each shop × baseline × live segment:
  ↓ impressions since this cell's EvolutionCursor >= 100?
  ↓ YES:
1. Recompute fitness for all live variants (actual discount costs)
2. Bayesian kill test vs top performer (10,000-sample Monte Carlo):
   - kill only at confidence >= 0.80–0.99, scaled by merchant
     selectionPressure (default 5 → ~0.92)
   - variants under 50 impressions are NEVER killed (no coin-flip deaths)
   - the top performer and the champion are never killed
3. Breed replacements up to the tier population cap:
   - parents selected weighted by profit/impression
   - crossover (default 70%) mixes parent genes
   - mutation (default 15%) draws random genes from the pool
   - offspring layouts clamped to the merchant's enabled set
   - Enterprise: bred copy passes brand-safety validation (bounded retries)
4. Champion detection: 500+ impressions, 7+ days alive, beats ALL others
   with 95% Bayesian confidence → crowned, gets 70% of traffic
5. Advance this cell's EvolutionCursor
```

### Serving-side selection (every impression)

Selection is Thompson Sampling with a hierarchy of priors — see
AI_SYSTEM_COMPLETE_GUIDE "The Shrinkage Chain":

- **Per-cell stats** (`VariantSegmentStat`): the visitor's exact composite
  segment (device × traffic × account × page × promo × frequency) or its
  device-coarsened form, when the cell has ≥30 impressions
- **Trigger-conditioned stats**: variants proven for this trigger reason
  (failedCoupon / checkoutExit / cartHesitation / staleCart) when ≥20
  trigger-specific impressions exist
- **Cluster prior**: the store's vertical × AOV cluster CVR as 100
  pseudo-impressions (new stores sample around cluster reality on day one)
- **Archetype + template priors**: cross-store multipliers per segment
- **Cell-aware champion**: the 70% champion override is suspended in any
  cell where a challenger's cell posterior beats the champion's

### Cold start (new store, <100 impressions)

Seed population inherits proven genes from the network, cluster-first:
vertical × AOV band → vertical → global (first level with ≥3 qualifying
genes: 3+ stores, 70%+ confidence, positive profit). Half proven, half
random exploration. Gated by the shop's `contributeToMetaLearning` setting
on the contribution side.

---

## Manual Controls (Enterprise)

- **Kill variant** — immediate death regardless of stats (merchant dislikes the copy)
- **Protect / champion variant** — pin a winner
- Evolution settings dials: `mutationRate`, `crossoverRate`, `selectionPressure`, `populationSize` (tier caps still apply)

---

## Performance Metrics

Per variant: `impressions`, `clicks`, `conversions`, `revenue`,
`profitPerImpression` (primary fitness). Per cell: `VariantSegmentStat`
rows. Per intervention: `InterventionOutcome` (show/skip arms, holdout).
Journey-level: `VisitorTouch`.

---

## Testing & Debugging

```bash
npm run evolution                                   # run the cycle now
node scripts/dev/test-cluster-priors.mjs            # pooling math
node scripts/dev/test-segment-stats.mjs             # cell shrinkage + coarsening
node scripts/dev/test-discount-arm.mjs              # evidence-gated discounting
node scripts/dev/golden-master.mjs                  # decision-engine regression guard
node scripts/dev/backfill-variant-segment-stats.mjs # rebuild cell stats from history
```

---

## Design Guarantees

1. **No kill without evidence** — Bayesian confidence + a 50-impression floor; low-traffic stores never watch good variants die on noise.
2. **Small stores run small populations** — Pro's 2-variant cap keeps every cell statistically meaningful at trial-merchant traffic.
3. **Priors never gate** — every cross-store prior is pseudo-counts inside a sampler; exploration floors and the 5% holdout are untouched by pooling.
4. **Merchant control is absolute** — disabled layouts are clamped at serve time; brand-safety rules filter bred copy; aggression 0 forces pure reminders.

---

## Investor Summary

**In plain terms:** every store runs a population of competing "recovery
offers" — different messages, designs, discount sizes, and even different
timing for when the popup appears. Each offer is like an organism with ten
genes. Shoppers vote with their wallets: offers that recover carts profitably
earn more traffic automatically, weak ones are killed once the statistics are
conclusive, and winners "breed" — their traits are recombined into new
candidates. The store's recovery experience literally evolves, week over
week, with no one writing copy or configuring tests.

**What makes this stronger than an A/B test:**
- It optimizes for **profit after discount cost**, not clicks — a variant
  that converts slightly less but gives away far less margin wins, which is
  what the merchant's P&L wants.
- It learns **per audience**: mobile shoppers from ads and returning desktop
  customers get separately-evolved treatment, because the data shows they
  respond to different things.
- New stores don't start from zero: they inherit the accumulated learning of
  similar stores (same category, same price band) and their own data takes
  over as it accumulates. Every merchant who joins makes the system smarter
  for every other merchant — a compounding network effect.
- Statistical discipline is built in: nothing is killed or crowned without
  Bayesian confidence, and a permanent 5% control group measures the revenue
  the system actually causes.

**Customer benefit:** merchants get the output of a full-time CRO
(conversion-rate-optimization) team — continuous multivariate testing,
audience segmentation, margin protection, and honest lift measurement —
as software that configures itself.
