# Pop-up QA: Preview & Disable Layouts

**Date:** June 26, 2026
**Status:** ✅ Shipped
**Plan Tier:** All (Starter, Pro, Enterprise)
**Mode:** Affects AI mode selection; manual mode unaffected
**Admin page:** `/app/qa-layouts` ("Pop-up QA" in the sidebar)

---

## Overview

Resparq ships **8 visual layouts** for the exit-intent pop-up (Classic Card,
Top Banner, Bottom Sheet, Coupon Ticket, Split Hero, Timer Front, Testimonial,
Scratch Reveal). In AI mode the genetic engine picks a layout per variant and
learns which ones convert. A layout that looks great on one theme can clash with
another (fonts, z-index, colors, spacing).

**Pop-up QA** lets a merchant:

1. **Preview** any layout on their **live theme** in a new tab, with sample copy,
   without firing analytics or creating a discount.
2. **Disable** any layout that clashes. The AI then never generates, learns on,
   or renders that layout for shoppers.

### Business Value

- **Theme safety** - merchants kill layouts that break their storefront before a shopper ever sees one.
- **Trust** - removes the "what if the AI shows something ugly" objection to AI mode.
- **Zero risk** - disabling is reversible and never deletes variants; the engine refills enabled layouts naturally.

---

## Key Distinction: Layouts vs Variants

| Concept | What it is | Where defined |
|---|---|---|
| **Layout** (`templateId`) | The *visual* shell (Classic Card, Top Banner…). 8 total. This is what clashes with a theme. | `MODAL_LAYOUTS` in [`app/utils/templates.js`](./app/utils/templates.js); renderers in `extensions/exit-intent-modal/assets/modal-templates.js` |
| **Variant** | An AI-generated *copy* combo (headline + subhead + CTA + offer) that **picks one layout**. Churns constantly via evolution. | `Variant` model; `app/utils/variant-engine.js` |

Pop-up QA operates at the **layout** level, not the variant level. Theme
conflicts are a property of the visual shell, and layouts are a stable set of 8
(variants come and go every evolution cycle). Disabling a layout removes it from
every variant's option set at once.

---

## Data Model

A single column on `Shop`:

```prisma
// Layout QA — JSON array of templateIds the merchant turned off because they
// clash with their theme. The AI never generates or renders these. Empty
// array = all 8 layouts enabled.
disabledLayouts String @default("[]")
```

- Stored as a JSON string array of `templateId`s, e.g. `["scratch-reveal","timer-front"]`.
- `"[]"` (default) = all 8 layouts enabled.
- Applied to the live DB via `prisma db push` (this repo's deploy mechanism), not `migrate deploy`. A migration file is committed for record only.

---

## Enforcement: Two Layers

The policy is enforced in two places. **The runtime clamp is the hard
guarantee; generation-side filtering is an optimization.**

### Layer 1 — Runtime clamp (the guarantee)

In [`apps.exit-intent.api.ai-decision.jsx`](./app/routes/apps.exit-intent.api.ai-decision.jsx),
right before the decision payload is built, the selected variant's `templateId`
is checked against the enabled set. If it points at a disabled layout, it is
remapped to an enabled one (prefer `classic-card`):

```js
const enabledLayouts = getEnabledLayoutIds(shopRecord.disabledLayouts);
let effectiveTemplateId = selectedVariant.templateId || 'classic-card';
if (!enabledLayouts.includes(effectiveTemplateId)) {
  const remapped = enabledLayouts.includes('classic-card') ? 'classic-card' : enabledLayouts[0];
  effectiveTemplateId = remapped; // logged as [Layout QA] ...
}
```

This is the single chokepoint every AI render flows through. It holds even when
generation-side filtering can't, because disabled layouts can still enter the
pipeline via:

- **Legacy variants** already in the DB from before the layout was disabled.
- **Crossover** inheriting a parent's `templateId` directly (no gene pool involved).
- **Meta-learning** proven genes overriding `templateId` from the network.

### Layer 2 — Generation-side filtering (the optimization)

In [`variant-engine.js`](./app/utils/variant-engine.js), the enabled-layout set
is threaded through every creation path so the AI stops *producing* variants on
disabled layouts (which would otherwise waste population slots and skew template
learning):

- `getEnabledLayoutIds(shop.disabledLayouts)` is resolved once in
  `seedInitialPopulation` and `evolutionCycle`, then passed down.
- `createRandomVariant`, `generateDiverseVariants`,
  `createRandomVariantWithSocialProof`, and `breedNewVariant` accept an
  `enabledLayouts` param (default `null` = no policy, full pool).
- Two helpers do the work: `allowedTemplateIds(pool, enabled)` intersects, and
  `pickTemplateId(pool, enabled)` samples. Both fall back to the full pool if the
  intersection is empty, so a variant is never stranded without a layout.
- The proven-gene override and the post-crossover/mutation child are both
  clamped to an enabled layout.

The engine itself stays config-agnostic: callers that know the shop resolve the
policy and pass it in. Functions called without the param behave exactly as
before (used by dev/test paths).

---

## Preview Mechanism

Preview reuses an existing storefront harness — **no new storefront code**.

- The "Preview on store" button is an `<a href target="_blank">` to
  `https://{shop}/?resparqPreview={templateId}`.
- The extension JS ([`exit-intent-modal.js`](./extensions/exit-intent-modal/assets/exit-intent-modal.js),
  `getPreviewTemplateId` / `renderPreviewTemplate`) reads the param, validates the
  id against the loaded template registry, and renders that layout immediately
  with representative sample copy.
- The harness sets `isPreview = true`, so it **never writes analytics, fires a
  conversion, or redirects** — it can't poison learning data.

**Prerequisite:** preview only renders if the Resparq **app embed is enabled** on
the theme (Online Store → Themes → Customize → App embeds). The QA page shows a
standing banner saying so, because the admin can't reliably detect embed state.

---

## Admin Page Behavior

[`app/routes/app.qa-layouts.jsx`](./app/routes/app.qa-layouts.jsx)

- **Loader** reads `Shop.disabledLayouts`, builds the 8 cards (name, description,
  enabled flag), and counts live variants still pointing at a disabled layout
  (`staleVariantCount`) to surface the runtime-fallback note.
- **Action** (`intent: "toggle"`) flips one layout via read-modify-write on the
  JSON set. It **blocks disabling the last enabled layout** so a pop-up can
  always render.
- Toggles use `useFetcher`; React Router revalidates the loader so the card
  state and "X of 8 enabled" count update in place. Results surface as a toast.
- The page is **available on all plans** — preview is useful to everyone, and the
  disable policy simply has no effect until a shop runs AI mode.

### Manual mode

Manual mode renders the merchant's single explicitly-chosen
`settings.templateId`, so disabling layouts does **not** override it. The feature
targets AI-mode auto-selection only.

---

## Edge Cases & Guarantees

| Case | Behavior |
|---|---|
| All 8 disabled | Prevented at the write boundary; `getEnabledLayoutIds` also falls back to `classic-card` as belt-and-suspenders. |
| Malformed/unknown ids in the column | `parseDisabledLayouts` filters to known ids; bad JSON → treated as empty. |
| Legacy variant on a now-disabled layout | Runtime clamp renders Classic Card instead; QA page shows a note until those variants evolve out. |
| `disabledLayouts` undefined (old row, pre-migration read) | Helpers treat it as `"[]"` → all enabled. Safe. |
| Rapid double-toggles | Read-modify-write, last-write-wins; the shared fetcher serializes on the client and the UI revalidates to DB truth. |

### Known minor quirk

A clamped legacy variant still attributes its impressions to its *nominal*
(disabled) layout in template-priors. This is bounded and irrelevant — the layout
is off and will never be selected — and the variant ages out via evolution.

---

## Source Map

| File | Role |
|---|---|
| `prisma/schema.prisma` | `Shop.disabledLayouts` column |
| `app/utils/templates.js` | `ALL_LAYOUT_IDS`, `parseDisabledLayouts`, `getEnabledLayoutIds` (single source of truth for the policy) |
| `app/routes/apps.exit-intent.api.ai-decision.jsx` | Runtime clamp (Layer 1) |
| `app/utils/variant-engine.js` | Generation-side filtering (Layer 2) |
| `app/routes/app.qa-layouts.jsx` | Admin page (loader, action, UI) |
| `app/components/AppLayout.jsx` | "Pop-up QA" nav entry |
| `extensions/exit-intent-modal/assets/exit-intent-modal.js` | `?resparqPreview=` harness (pre-existing) |

---

## Testing Checklist

1. `npx prisma db push` to add the column, then `npm run dev`.
2. Open **Pop-up QA**; confirm 8 cards render and "8 of 8 layouts enabled".
3. Click **Preview on store** on a layout → new tab opens on the live theme with
   that pop-up showing (requires app embed on). Confirm no discount/analytics.
4. **Disable** a layout → toast confirms, card flips to "Off", count drops.
5. Try to disable down to the last one → blocked with "Keep at least one layout on."
6. Re-enable → toast confirms, card flips back.
7. In AI mode, confirm the disabled layout no longer appears in newly bred
   variants (`templateId`) and never renders for shoppers (watch for the
   `[Layout QA]` clamp log on any legacy variant).
