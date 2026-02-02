# Usage-Based Billing

ResparQ uses a hybrid pricing model: a flat monthly subscription fee plus a commission on recovered revenue.

## Commission Rates by Plan

| Plan | Monthly Fee | Commission | Monthly Cap |
|------|-------------|------------|-------------|
| Starter | $29 | 5% | $500 |
| Pro | $79 | 2% | $2,000 |
| Enterprise | $199 | 1% | $5,000 |

## How It Works

### 1. Conversion Detection
When an order is placed with an `EXIT` discount code:
1. `webhooks.orders.create.jsx` receives the order
2. Detects the discount code was from ResparQ
3. Records the conversion in the `Conversion` table
4. Triggers usage billing

### 2. Commission Calculation
```javascript
commissionRate = {
  starter: 0.05,    // 5%
  pro: 0.02,        // 2%
  enterprise: 0.01  // 1%
}

chargeAmount = orderTotal * commissionRate
```

### 3. Shopify Usage Billing API
The app calls Shopify's `appUsageRecordCreate` mutation:
```graphql
mutation AppUsageRecordCreate(
  $subscriptionLineItemId: ID!
  $price: MoneyInput!
  $description: String!
  $idempotencyKey: String!
) {
  appUsageRecordCreate(
    subscriptionLineItemId: $subscriptionLineItemId
    price: $price
    description: $description
    idempotencyKey: $idempotencyKey
  ) {
    appUsageRecord { id }
    userErrors { field message }
  }
}
```

### 4. Database Recording
Every charge (successful or failed) is stored in the `UsageCharge` table for reporting.

## Database Schema

```prisma
model UsageCharge {
  id                String   @id @default(uuid())
  shopId            String

  // Order Reference
  orderId           String   @unique  // Idempotency key
  orderNumber       String?

  // Revenue & Commission
  recoveredRevenue  Float    // Order total
  commissionRate    Float    // 0.05, 0.02, or 0.01
  chargeAmount      Float    // What we charged
  currency          String   @default("USD")

  // Status
  status            String   // pending, charged, failed, skipped
  shopifyChargeId   String?  // Shopify's charge ID
  errorMessage      String?  // If failed

  // Context
  planTier          String   // starter, pro, enterprise
  conversionAt      DateTime // When order was placed
  chargedAt         DateTime? // When we charged
  createdAt         DateTime @default(now())
}
```

## Charge Statuses

| Status | Meaning |
|--------|---------|
| `charged` | Successfully billed to merchant |
| `pending` | No active subscription, stored for later |
| `skipped` | Below $0.50 minimum threshold |
| `failed` | Shopify API error |

## Key Files

| File | Purpose |
|------|---------|
| `app/utils/billing.server.js` | Core billing functions |
| `app/routes/webhooks.orders.create.jsx` | Triggers usage billing on conversion |
| `app/routes/app.billing-callback.jsx` | Stores subscription ID after approval |
| `prisma/schema.prisma` | UsageCharge model definition |

## Billing Functions

### `getCommissionRate(tier)`
Returns the commission rate for a plan tier.

### `recordUsageCharge(admin, lineItemId, orderId, revenue, tier)`
Calls Shopify API to record a usage charge. Returns:
```javascript
{
  success: true/false,
  skipped: true/false,  // If below minimum
  chargeId: "gid://...",
  chargeAmount: 5.00,
  error: "..." // If failed
}
```

### `getUsageLineItemId(admin)`
Gets the usage line item ID from the active subscription (required for charging).

## Safeguards

### Idempotency
Each order can only be charged once. The `orderId` field is unique in the database, and we pass `idempotencyKey: order-{orderId}` to Shopify.

### Minimum Threshold
Charges under $0.50 are skipped (not worth the transaction overhead).

### Monthly Caps
Shopify enforces the `cappedAmount` set when creating the subscription:
- Starter: $500/month max
- Pro: $2,000/month max
- Enterprise: $5,000/month max

### Graceful Failures
If billing fails, the webhook still succeeds. The charge is stored with `status: failed` for manual review.

## Testing Usage Billing

### 1. Create a Test Subscription
In development, subscriptions are created with `test: true`:
```javascript
createSubscription(admin, "pro", "monthly", returnUrl, true)
```

### 2. Place a Test Order
1. Add items to cart on your dev store
2. Trigger exit intent modal
3. Click to apply discount
4. Complete checkout

### 3. Check the Logs
```bash
fly logs | grep Billing
```

Expected output:
```
[Billing] Usage charge recorded: $2.00 (2% of $100.00)
```

### 4. Verify in Database
```sql
SELECT * FROM "UsageCharge" ORDER BY "createdAt" DESC LIMIT 5;
```

## Monitoring

### Check Pending Charges
Charges that couldn't be billed (no subscription):
```sql
SELECT * FROM "UsageCharge" WHERE status = 'pending';
```

### Check Failed Charges
```sql
SELECT * FROM "UsageCharge" WHERE status = 'failed';
```

### Revenue by Plan
```sql
SELECT
  "planTier",
  COUNT(*) as charges,
  SUM("recoveredRevenue") as total_recovered,
  SUM("chargeAmount") as total_commission
FROM "UsageCharge"
WHERE status = 'charged'
GROUP BY "planTier";
```

## Troubleshooting

### "No active subscription found"
The merchant hasn't approved a subscription yet. Charges are stored as `pending`.

**Fix:** Merchant needs to approve the subscription in Shopify admin.

### "Amount below minimum threshold"
The commission was less than $0.50.

**Example:** 5% of $5.00 = $0.25 (skipped)

This is expected behavior - not worth charging.

### "Capped amount exceeded"
The merchant hit their monthly usage cap.

**Fix:** They'll need to wait for the next billing cycle or upgrade.

### Missing `subscriptionLineItemId`
The subscription doesn't have a usage pricing line item.

**Fix:** Check that subscriptions are created with both recurring AND usage line items in `createSubscription()`.
