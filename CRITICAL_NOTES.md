# Critical App Embed Fix

## Issue: Extension Not Appearing in Theme Customizer

**Date Fixed:** December 23, 2025

### Symptoms
- Extension loads in terminal (`npm run dev` shows it building)
- Does NOT appear in Shopify Theme Customizer → App Embeds
- Cannot enable modal on storefront

### Required Files

**File 1:** `extensions/exit-intent-modal/blocks/exit-intent-app-block.liquid`
```liquid
{% render 'exit-intent-modal' %}

{% schema %}
{
  "name": "Exit Intent Modal",
  "target": "body",
  "settings": [
    {
      "type": "paragraph",
      "content": "This app block enables the exit intent modal on your store."
    }
  ]
}
{% endschema %}
```

**File 2:** `extensions/exit-intent-modal/shopify.extension.toml`
```toml
api_version = "2024-10"
name = "exit-intent-modal"
uid = "149bec6a-746c-0616-8f2d-f6810f0bd373e82dc3e7"
type = "theme"

[[extension_points]]
target = "body"
```

### Why This Works
- The `blocks/` folder contains app blocks that appear in theme customizer
- The `{% schema %}` tag registers the block with Shopify
- `target: "body"` makes it appear in "App embeds" section
- Without these, extension exists but isn't accessible to merchants

### If This Breaks Again
1. Check these two files exist with correct content
2. Run `npm run dev` or `shopify app deploy`
3. Hard refresh theme customizer (Cmd+Shift+R)
4. Look for "Exit Intent Modal" in App embeds

### Reference
This was debugged across multiple sessions. Full context in:
- `/mnt/transcripts/2025-12-22-07-33-03-shopify-exit-intent-offer-types-update.txt`
- GitHub commit: "Fix theme extension registration - add app block"

---

# Critical: Production Does Not Run Migrations

**Date documented:** September 20, 2026

## The trap

`npm run setup` is `prisma generate && prisma db push`, and it is the
container's entrypoint (Dockerfile `CMD` → `docker-start`). There is no
`release_command` in `fly.toml`. **Nothing in `prisma/migrations/` ever
executes in production** — those 43 folders are for local work and for
migrate-managed environments only.

## Why it matters

A schema change that `db push` cannot apply cleanly is an **outage**, not a
failed migration. `setup` exits non-zero and the container never starts.

The sharp edge is **adding a unique index to a table that already contains
duplicates**. `db push` issues a bare `CREATE UNIQUE INDEX`, Postgres returns
23505, and the app boot-loops. There is no migration step to fail safely in —
the failure happens at boot, after deploy, on every restart.

It also means a data repair written as a migration is dead code. Repairs
belong in `scripts/ops/`, where an operator runs them deliberately and can read
the output before committing to anything.

## Before adding any constraint

1. Write the repair as a script with a dry-run default.
2. Run the dry run against production and read it.
3. Apply, confirm it reports clean.
4. Only then add the constraint to `schema.prisma`.

Live example: `@@unique([shopId, aiDecisionId])` on `InterventionOutcome` is
deliberately absent for exactly this reason. See
`scripts/ops/repair-duplicate-outcomes.mjs` and `HANDOFF-2026-09-20.md` §5.1.

## Safe under `db push`

New tables, nullable columns, plain (non-unique) indexes, default values.

---

# Critical: `flyctl deploy` Does Not Register Webhooks

**Date documented:** September 20, 2026

Webhook topics live in `shopify.app.toml` and reach Shopify only through
`shopify app deploy` (`npm run deploy`). `flyctl deploy` ships the backend
alone.

Add a topic, deploy to Fly, and the handler is live but never called. Nothing
errors — the webhook simply never arrives, so the feature looks implemented and
does nothing. The reversal webhooks (`orders/updated`, `orders/cancelled`) are
the current example: without registration, refunds never reach the app and
recovered revenue can only go up.

`shopify app deploy` also ships theme-extension changes. Adding a **scope**
is different again: it forces every merchant to re-authorise.
