# Pop-up QA: Preview & Disable Layouts

**Date:** June 26, 2026
**Status:** ✅ Shipped
**Plan Tier:** All (Starter, Pro, Enterprise)
**Mode:** Affects AI mode selection; manual mode unaffected
**Admin page:** `/app/qa-layouts` ("Pop-up QA" in the sidebar)
**Merchant guide:** [docs/POPUP_QA_GUIDE.md](./docs/POPUP_QA_GUIDE.md)

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

There are **two** previews, and they answer different questions.

### 1. In-app preview ("Preview here") — desktop/mobile, no theme

The primary preview. Renders the **real** storefront template inside the admin,
with a desktop/mobile toggle, on a neutral placeholder page.

**Why not just iframe the live storefront?** You can't. Shopify sends
`X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` on
every storefront (verified on both a dev store and a production store). Browsers
refuse to embed it in any iframe. So the live theme can never be shown inside the
admin — that's a Shopify anti-clickjacking policy, not our limitation.

Instead, the in-app preview renders the templates directly:

- A **public resource route** [`app/routes/qa-modal-templates.jsx`](./app/routes/qa-modal-templates.jsx)
  serves the extension's `modal-templates.js` (read from disk) at
  `/qa-modal-templates.js`. Single source of truth — the admin renders the exact
  same code shoppers see, no copy/drift. Unauthenticated because it's loaded via a
  `<script>` tag from a srcdoc iframe (which can't carry the session token); the
  file is just render code.
- The preview (`PreviewOverlay` in `app.qa-layouts.jsx`) mounts a **same-origin
  `srcDoc` iframe** we fully control — no storefront CSP involved. It injects the
  renderer, builds sample props (mirroring the storefront's `buildTemplateProps`,
  including the merchant's brand colors/font), and appends the rendered overlay.
- **Accurate desktop/mobile:** the renderer decides "mobile" via
  `matchMedia('(max-width: 768px)')` against *the iframe's own viewport*. Sizing
  the iframe to a phone width (390px) makes the modal render its true mobile
  behavior (bottom-sheet anchoring, full-width CTAs) with no device spoofing.
  Verified headlessly: classic-card applies its mobile bottom-anchored radius at
  390px and not at 1000px.
- CTA/close clicks are neutralized in the preview (no navigation).
- The one tradeoff: the backdrop is a **neutral placeholder page**, not the
  merchant's theme — so this answers "what does each layout look like, on desktop
  and mobile" but not "does it clash with my header/colors."

### 2. Storefront preview ("Open on your live store") — true theme fit

The definitive theme-fit check, reusing the pre-existing harness:

- An `<a href target="_blank">` to `https://{shop}/?resparqPreview={templateId}`.
- The extension JS (`getPreviewTemplateId` / `renderPreviewTemplate`) validates the
  id and renders that layout immediately with sample copy.
- Sets `isPreview = true`, so it **never writes analytics, fires a conversion, or
  redirects**.

**Prerequisite (storefront preview only):** renders only if the Resparq **app
embed is enabled** (Online Store → Themes → Customize → App embeds). The in-app
preview has no such requirement. The QA page banner explains the distinction.

---

## Admin Page Behavior

[`app/routes/app.qa-layouts.jsx`](./app/routes/app.qa-layouts.jsx)

- **Loader** reads `Shop.disabledLayouts`, builds the 8 cards (name, description,
  enabled flag), returns `shop.mode` for the mode-aware note, and counts live
  variants still pointing at a disabled layout (`staleVariantCount`) to surface
  the runtime-fallback note.
- **Layout schematics** — each card renders a `LayoutThumbnail` SVG wireframe
  showing where/how that pop-up sits on the page (top bar, centered card, bottom
  sheet, split, etc.). Clicking the schematic (or "Preview here") opens the in-app
  preview. The thumbnail desaturates when the layout is off.
- **In-app preview overlay** — `PreviewOverlay` gives a full desktop/mobile modal
  preview with layout switching (prev/next, arrow keys), an Enable/Disable control,
  and an "Open on your live store" link. Loader passes the shop's `brand` tokens
  and `showPoweredBy` so the preview matches production props. See Preview
  Mechanism above.
- **Mode-aware note** — when `shop.mode !== 'ai'`, the page explains that the
  on/off switches take effect in AI mode (manual mode always uses the merchant's
  one chosen layout). Preview works in either mode.
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
| `app/routes/app.qa-layouts.jsx` | Admin page (loader, action, UI, `PreviewOverlay`, `LayoutThumbnail`) |
| `app/routes/qa-modal-templates.jsx` | Public resource route serving `modal-templates.js` to the in-app preview iframe |
| `app/components/AppLayout.jsx` | "Pop-up QA" nav entry |
| `extensions/exit-intent-modal/assets/modal-templates.js` | Storefront modal renderer — shared by production + in-app preview |
| `extensions/exit-intent-modal/assets/exit-intent-modal.js` | `?resparqPreview=` storefront harness (pre-existing) |

---

## Testing Checklist

1. `npx prisma db push` to add the column, then `npm run dev`.
2. Open **Pop-up QA**; confirm 8 cards render with schematics and "8 of 8 layouts enabled".
3. Click **Preview here** (or a schematic) → in-app overlay opens with the real
   modal. Toggle **Desktop/Mobile** and confirm the modal reflows (e.g. bottom-sheet
   anchoring on mobile). Use prev/next (or arrow keys) to cycle all 8.
4. Click **Open on your live store** → new tab on the live theme (requires app
   embed on). Confirm no discount/analytics.
5. **Disable** a layout (from card or preview) → toast confirms, card flips to
   "Off", count drops.
6. Try to disable down to the last one → blocked with "Keep at least one layout on."
7. Re-enable → toast confirms, card flips back.
8. In AI mode, confirm the disabled layout no longer appears in newly bred
   variants (`templateId`) and never renders for shoppers (watch for the
   `[Layout QA]` clamp log on any legacy variant).
