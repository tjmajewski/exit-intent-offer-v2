# Claude Handoff — Exit Intent Offer v2

**Branch:** `claude/fix-shopify-review-issues-bGFp2`
**Repo:** `tjmajewski/exit-intent-offer-v2`
**Session date:** 2026-03-03

---

## What We Worked On This Session

All commits below are on `claude/fix-shopify-review-issues-bGFp2` and have been pushed.

---

### 1. Dashboard Refresh Button (`422cc96`)

**File:** `app/routes/app._index.jsx`

Added a small "Refresh" button (rotate-arrow icon) to the top-right of the
"Your Performance (Last 30 Days)" banner on the admin dashboard. Merchants
need this because analytics only update after the order webhook fires — there
was no way to reload the numbers without a full page refresh.

---

### 2. Conversion Tracking Overhaul (`ce4a0bd`)

**Files:** `app/routes/webhooks.orders.create.jsx`, `extensions/exit-intent-modal/assets/exit-intent-modal.js`

**Problem:** Revenue Saved / Orders Created were always zero. The webhook only
counted a conversion when a recognizable discount code was on the order
(legacy regex, `EXIT` prefix, or a stored configured code). No-discount modals,
gift-card-only offers, and any custom code format were silently skipped.

**Fix:**
- `exit-intent-modal.js`: stamps `exit_intent: true` as a Shopify **cart
  attribute** on every CTA click (both gift-card and checkout/cart paths).
  Cart attributes flow into orders as `note_attributes`.
- `webhooks.orders.create.jsx`: checks `note_attributes` for the `exit_intent`
  flag as the **primary** attribution signal. Existing discount-code checks
  are kept as fallbacks.
- Fixed a `TypeError` crash where `exitDiscountUsed.code` was dereferenced
  when `exitDiscountUsed` was `null` (gift-card or attribute-only path).

---

### 3. Exit Intent Stamped at Modal Show, Not Just CTA Click (`3adfcb0`)

**File:** `extensions/exit-intent-modal/assets/exit-intent-modal.js`

Moved the `exit_intent: true` cart attribute stamp to fire when the modal is
**displayed** (not just when the CTA is clicked). This means customers who
dismiss the modal but return to checkout later are still correctly attributed
as recovered sales. CTA-click stamps are kept as a belt-and-suspenders fallback.

---

### 4. CTA Discount Not Applying in Shopify Checkout (`11e49f2`)

**File:** `extensions/exit-intent-modal/assets/exit-intent-modal.js`

**Problem:** Discount codes were not applying at Shopify checkout. Three
approaches that don't reliably work with Checkout 2.0 / `checkout.shopify.com`:
- `/checkout?discount=CODE` — URL param is stripped or ignored
- `fetch('/discount/CODE')` — sets a cookie but SameSite restrictions block
  it from carrying across to `checkout.shopify.com` (different origin)

**Fix:** All checkout redirects now use Shopify's session-based redemption
endpoint: `/discount/CODE?redirect=/checkout`. Direct navigation lets Shopify's
server set the session discount server-side, then redirect to checkout with it
already applied.

Changed in four places:
1. Top-of-file cart-page guard (sessionStorage → checkout redirect)
2. `handleCTAClick()` — `destination === 'checkout'` path
3. Threshold offer secondary CTA
4. Checkout-click interceptor / `autoApplyCartDiscount()` fallback

---

### 5. Cart-Page Short-Circuit for Discount (`61b83cd`) — LAST COMMIT

**File:** `extensions/exit-intent-modal/assets/exit-intent-modal.js`

**Problem:** When `destination === 'cart'` and the customer was already on
`/cart`, the code stored the discount in sessionStorage and redirected to
`/cart` anyway — causing a full page reload, after which the top-of-file guard
would catch it and redirect to checkout. Unnecessary extra round-trip.

**Fix:** `handleCTAClick()` now checks `window.location.pathname === '/cart'`
before deciding the redirect:

```
destination = 'cart' AND not on /cart  →  redirect to /cart (sessionStorage discount)
destination = 'cart' AND already on /cart  →  /discount/CODE?redirect=/checkout (direct)
destination = 'checkout'  →  /discount/CODE?redirect=/checkout (direct)
```

The discount is applied in all three cases.

---

## Current Discount Flow (How It Works Now)

```
Customer clicks CTA
│
├─ destination = 'cart', NOT on /cart
│   └─ Store discount in sessionStorage → redirect to /cart
│       └─ Cart page loads → top-of-file guard detects discount
│           └─ Clear sessionStorage → /discount/CODE?redirect=/checkout ✓
│
├─ destination = 'cart', ALREADY on /cart
│   └─ /discount/CODE?redirect=/checkout ✓
│
└─ destination = 'checkout'
    └─ /discount/CODE?redirect=/checkout ✓
```

All paths use `/discount/CODE?redirect=/checkout` — the only reliable
discount-application method for Checkout 2.0.

---

## Key Files

| File | Role |
|------|------|
| `extensions/exit-intent-modal/assets/exit-intent-modal.js` | Frontend modal — discount logic, cart attribute stamping, all redirect paths |
| `app/routes/webhooks.orders.create.jsx` | Shopify order webhook — conversion attribution logic |
| `app/routes/app._index.jsx` | Admin dashboard — analytics display + refresh button |

---

## Things Not Started / Possible Next Steps

- No open issues were discussed for this session — the work above was focused
  on Shopify review feedback items and the conversion tracking gap.
- The branch is fully pushed and ready for PR or further review.
