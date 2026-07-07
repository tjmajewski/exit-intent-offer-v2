# Super Admin Console — Usage Guide
**Date:** July 7, 2026
**Audience:** app operator (you). Merchants never see any of this.
**Specs:** `SUPER_ADMIN_CONSOLE_SPEC.md`, `ADMIN_AI_GLOBAL_DASHBOARD_SPEC.md`

## What it is
Password-protected operator console at **`/admin`** — switch between customer stores, view each one's plan subscription and performance, edit their settings, and see how the AI decision engine performs across ALL customers.

---

## One-time setup (before first use)

Set two secrets on Fly (both required — console rejects everything if either is missing):

```bash
fly secrets set \
  ADMIN_PASSWORD="$(openssl rand -base64 24)" \
  ADMIN_SESSION_SECRET="$(openssl rand -base64 32)"
```

Save the `ADMIN_PASSWORD` value in your password manager — it's your login. Deploy (schema changes apply automatically via `prisma db push` on boot).

Local dev: add both to `.env` and use `http://localhost:3000/admin`.

## Getting in

1. Go to **`https://resparq.fly.dev/admin`** (or your app URL + `/admin`).
2. You're redirected to the login page. Enter `ADMIN_PASSWORD`.
3. Session lasts **12 hours**, then you log in again. **Log out** link is top-right.
4. 5 wrong attempts = locked out for 15 minutes (per IP). Every login and failed attempt is recorded in the audit log.

## Switching between customers (the store switcher)

**`/admin` (Customers page)** lists every installed store with plan badge, mode, vertical, install date, and 30-day impressions/conversions/revenue. Search by domain, filter by plan. Dev/test stores show a yellow `dev` badge; a red `no sub` badge means a paid tier in the DB with no Shopify subscription ID recorded.

**Click any store** → that customer's detail page, 4 tabs:

| Tab | What you can do |
|---|---|
| **Plan & Billing** | View only. DB plan tier + subscription/promo info, live Shopify subscription status, and the plan metafield — with a drift warning if DB and metafield disagree. **You cannot change anyone's plan here, by design.** |
| **Performance** | 7/30/90-day stats: impressions, clicks, conversions, revenue, profit, AI shown/skipped counts, attributed orders, top 25 variants, last 50 AI decisions. |
| **Settings** | Editable. Mode, AI goal, aggression, budget, triggers, modal content, social proof, vertical, evolution controls. Saves apply to the live storefront immediately and are audit-logged with a before/after diff. Plan, discount codes, and branding are excluded — those go through the merchant app. |
| **Audit log** | Last 20 admin actions on this shop: when, what changed, from which IP. |

## AI Dashboard (`/admin/ai`)

Cross-customer view of the decision engine. Top nav → **AI Dashboard**.

- **Filters** (all combinable, live in the URL so views are bookmarkable): time range 24h/7d/30d/90d, chart bucket hourly/daily/weekly/monthly, plan, device, traffic source, store vertical, shop name(s) (comma-separated, partial match), dev-shops toggle (off by default).
- **Trend banner**: auto-generated summary — profit vs prior period, CVR/show-rate/holdout-lift movement, biggest segment mover, and a watch list.
- **KPI tiles** with ▲▼ vs the prior period of the same length. Holdout lift = shown-group CVR minus 5% holdout CVR — same numbers as each merchant's dashboard lift card.
- **Modal impressions over time** — the primary troubleshooting chart. When your filter is ≤5 shops it overlays one line per shop so a flatlined store is obvious.
- **Red banner: "Modals may have stopped showing"** — any store with impressions in the last 7 days but zero in the last 24h, linked straight to its detail page.
- Shown-vs-skipped decisions, CVR vs holdout, revenue & profit charts; profit breakdowns by plan/device/traffic/trigger/archetype; threshold-learning score-bucket chart; customer leaderboard (sortable columns link back to each store); engine health (AI shops, variants alive, champions, stale evolution warnings).

### Troubleshooting "modals aren't showing" — fast path
1. `/admin/ai` → is the store in the red zero-impressions banner? Click it.
2. On its Performance tab: **shown vs skipped** — decisions flowing but skipped high → threshold learning or budget; nothing at all → storefront/extension or traffic problem.
3. Settings tab: check `exitIntentEnabled`, budget not exhausted, mode as expected.
4. Still stuck → `TROUBLESHOOTING.md`.

## Security notes
- Fails closed: no secrets set → console unreachable.
- Cookie is HttpOnly/Secure/SameSite=Lax, HMAC-signed, 12h expiry.
- All `/admin` responses send `noindex` + `no-store`; nothing in the merchant app links to it.
- Every write lands in the `AdminAuditLog` table permanently.
- Rotate the password anytime with `fly secrets set ADMIN_PASSWORD=...` (existing sessions stay valid until their 12h expiry; rotate `ADMIN_SESSION_SECRET` too to kill them instantly).
