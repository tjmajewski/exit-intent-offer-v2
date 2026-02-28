# API Reference - Repsarq

Complete reference for all API endpoints, webhooks, and integration points in the Repsarq exit intent application.

---

## Table of Contents

1. [Admin API Routes](#admin-api-routes)
2. [Public API Routes (Storefront)](#public-api-routes-storefront)
3. [Webhook Routes](#webhook-routes)
4. [Cron Job Routes](#cron-job-routes)
5. [Authentication](#authentication)
6. [Error Handling](#error-handling)
7. [Rate Limiting](#rate-limiting)

---

## Admin API Routes

These routes require Shopify Admin authentication via App Bridge.

### GET /app

**Dashboard / Homepage**

Returns dashboard data including modal status, plan information, and quick stats.

**Authentication:** Required (Shopify Admin session)

**Response:**
```json
{
  "plan": {
    "tier": "pro",
    "status": "active",
    "billingCycle": "monthly"
  },
  "shop": {
    "enabled": true,
    "mode": "ai",
    "modalHeadline": "Wait! Don't leave yet",
    "modalBody": "Complete your purchase now..."
  },
  "stats": {
    "impressions": 1250,
    "clicks": 180,
    "conversions": 42,
    "revenue": 1520.50
  }
}
```

---

### GET /app/settings

**Load Settings Page**

Returns current shop settings including modal configuration, triggers, AI settings, and branding.

**Authentication:** Required

**Response:**
```json
{
  "settings": {
    "enabled": true,
    "mode": "ai",
    "modalHeadline": "Wait! Don't leave yet",
    "modalBody": "Complete your purchase now...",
    "ctaButton": "Complete My Order",
    "redirectDestination": "checkout",
    "discountEnabled": true,
    "discountCode": "10OFF",
    "offerType": "percentage",
    "exitIntentEnabled": true,
    "timeDelayEnabled": true,
    "timeDelaySeconds": 30,
    "cartValueEnabled": false,
    "cartValueMin": 0,
    "cartValueMax": 999999,
    "aiAggression": 5,
    "aiGoal": "revenue",
    "brandPrimaryColor": "#8B5CF6",
    "brandSecondaryColor": "#FFFFFF",
    "brandAccentColor": "#10B981"
  },
  "plan": {
    "tier": "pro"
  }
}
```

---

### POST /app/settings

**Save Settings**

Saves modal configuration. Creates discount codes in Shopify if needed.

**Authentication:** Required

**Request Body:**
```json
{
  "enabled": true,
  "mode": "manual",
  "modalHeadline": "Wait! Special offer for you",
  "modalBody": "Complete your purchase and save 15%",
  "ctaButton": "Get My Discount",
  "redirectDestination": "checkout",
  "discountEnabled": true,
  "offerType": "percentage",
  "discountPercentage": 15,
  "exitIntentEnabled": true,
  "timeDelayEnabled": true,
  "timeDelaySeconds": 30,
  "cartValueEnabled": false,
  "brandPrimaryColor": "#8B5CF6"
}
```

**Response:**
```json
{
  "success": true,
  "discountCode": "15OFF",
  "message": "Settings saved successfully"
}
```

**Side Effects:**
- Creates discount code in Shopify Admin
- Updates database Shop record
- Updates Shopify metafields (for backwards compatibility)

---

### GET /app/analytics

**Analytics Dashboard**

Returns performance metrics with optional date range filtering.

**Authentication:** Required

**Query Parameters:**
- `range` (optional): `"7d"`, `"30d"`, or `"all"` (default: `"30d"`)

**Response:**
```json
{
  "analytics": {
    "impressions": 1250,
    "clicks": 180,
    "conversions": 42,
    "revenue": 1520.50,
    "conversionRate": 0.0336,
    "clickThroughRate": 0.144,
    "revenuePerImpression": 1.22
  },
  "plan": {
    "tier": "pro"
  }
}
```

---

### GET /app/conversions

**Conversion History**

Returns detailed conversion records with pagination and date filtering.

**Authentication:** Required

**Query Parameters:**
- `range` (optional): `"7d"`, `"30d"`, or `"all"` (default: `"30d"`)
- `page` (optional): Page number for pagination (default: `1`)
- `limit` (optional): Records per page (default: `15`)

**Response:**
```json
{
  "conversions": [
    {
      "id": "conv_123",
      "orderNumber": "#1001",
      "orderValue": 89.99,
      "customerEmail": "customer@example.com",
      "orderedAt": "2026-01-15T14:30:00Z",
      "modalHadDiscount": true,
      "discountRedeemed": true,
      "discountAmount": 9.00
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 15,
    "total": 42,
    "pages": 3
  },
  "plan": {
    "tier": "pro"
  },
  "canExport": true
}
```

---

### GET /app/variants

**Variant Performance** (Enterprise Only)

Returns evolution system variants with performance metrics.

**Authentication:** Required

**Plan Required:** Enterprise

**Query Parameters:**
- `range` (optional): Date range filter
- `page` (optional): Page number
- `limit` (optional): Records per page

**Response:**
```json
{
  "variants": [
    {
      "id": "var_123",
      "generation": 5,
      "status": "alive",
      "headline": "Don't miss out! Save 15% now",
      "subhead": "Complete your order in the next 10 minutes",
      "ctaText": "Claim My Discount",
      "offerAmount": 15,
      "impressions": 450,
      "clicks": 65,
      "conversions": 12,
      "revenue": 580.50,
      "conversionRate": 0.0267,
      "profitPerImpression": 1.29
    }
  ],
  "summary": {
    "totalVariants": 25,
    "alive": 15,
    "dying": 5,
    "dead": 3,
    "champions": 2,
    "currentGeneration": 5,
    "nextEvolutionIn": 45
  }
}
```

---

### GET /app/promotions

**Promotional Intelligence** (Enterprise Only)

Returns detected site-wide promotions and AI recommendations.

**Authentication:** Required

**Plan Required:** Enterprise

**Response:**
```json
{
  "promotions": [
    {
      "id": "promo_123",
      "title": "SUMMER20",
      "percentage": 20,
      "usageTotal": 145,
      "usageLast24h": 18,
      "detectedAt": "2026-01-10T00:00:00Z",
      "classification": "site_wide",
      "aiStrategy": "pause",
      "merchantOverride": null
    }
  ],
  "plan": {
    "tier": "enterprise"
  }
}
```

---

### POST /app/promotions

**Update Promotion Strategy**

Allows merchant to override AI strategy for promotional intelligence.

**Authentication:** Required

**Plan Required:** Enterprise

**Request Body:**
```json
{
  "promotionId": "promo_123",
  "merchantOverride": "continue",
  "notes": "Keep showing exit intent, our margin is good"
}
```

**Response:**
```json
{
  "success": true,
  "promotion": {
    "id": "promo_123",
    "merchantOverride": "continue"
  }
}
```

---

### GET /app/upgrade

**Upgrade Page**

Returns plan comparison and upgrade options.

**Authentication:** Required

**Response:**
```json
{
  "currentPlan": {
    "tier": "starter",
    "status": "active"
  },
  "availablePlans": [
    {
      "tier": "pro",
      "price": 79,
      "features": ["AI mode", "10k impressions", "Full analytics"]
    },
    {
      "tier": "enterprise",
      "price": 299,
      "features": ["Unlimited impressions", "Manual controls", "Custom CSS"]
    }
  ]
}
```

---

## Public API Routes (Storefront)

These routes are accessed from the storefront theme extension and don't require admin authentication.

### GET /apps/exit-intent/api/shop-settings

**Get Shop Settings for Modal**

Returns modal configuration for the storefront JavaScript to render.

**Authentication:** None (public, but shop-scoped via `shop` query parameter)

**Query Parameters:**
- `shop` (required): Shopify shop domain (e.g., `example.myshopify.com`)

**Response:**
```json
{
  "plan": "pro",
  "mode": "manual",
  "enabled": true,
  "modalHeadline": "Wait! Don't leave yet",
  "modalBody": "Complete your purchase now and get 10% off",
  "ctaButton": "Complete My Order",
  "redirectDestination": "checkout",
  "discountCode": "10OFF",
  "discountEnabled": true,
  "offerType": "percentage",
  "triggers": {
    "exitIntent": true,
    "timeDelay": true,
    "timeDelaySeconds": 30,
    "cartValue": false,
    "cartValueMin": 0,
    "cartValueMax": 999999
  },
  "branding": {
    "primaryColor": "#8B5CF6",
    "secondaryColor": "#FFFFFF",
    "accentColor": "#10B981",
    "fontFamily": "system"
  }
}
```

**Performance:** Optimized for fast response (<100ms target), reads from database cache.

---

### POST /apps/exit-intent/api/ai-decision

**Get AI-Powered Offer Decision**

Analyzes customer signals and returns personalized offer configuration.

**Authentication:** None (public API)

**Request Body:**
```json
{
  "shop": "example.myshopify.com",
  "signals": {
    "visitFrequency": "first_time",
    "cartValue": 89.50,
    "deviceType": "mobile",
    "accountStatus": "guest",
    "trafficSource": "paid",
    "timeOnSite": 125,
    "pageViews": 3,
    "scrollDepth": 75,
    "abandonmentHistory": 0,
    "cartHesitation": 45,
    "productDwellTime": 30,
    "addToCartVelocity": 2,
    "exitVelocity": 1
  }
}
```

**Response (Offer):**
```json
{
  "action": "offer",
  "offer": {
    "type": "percentage",
    "amount": 15,
    "discountCode": "EXIT15-ABC123",
    "expiresAt": "2026-01-16T14:30:00Z",
    "headline": "Special offer just for you!",
    "body": "Complete your order now and save 15%",
    "ctaText": "Claim My Discount",
    "urgency": "high"
  },
  "variantId": "var_123"
}
```

**Response (No Offer):**
```json
{
  "action": "no_offer",
  "reason": "budget_exhausted"
}
```

**Side Effects:**
- Creates unique discount code in Shopify
- Records AI decision in database
- Tracks against budget cap (if enabled)
- Creates DiscountOffer record

---

### POST /apps/exit-intent/track

**Track Modal Events**

Records impressions, clicks, and conversions.

**Authentication:** None (public API)

**Request Body:**
```json
{
  "shop": "example.myshopify.com",
  "event": "impression",
  "variantId": "var_123",
  "sessionId": "sess_abc123",
  "metadata": {
    "cartValue": 89.50,
    "deviceType": "mobile"
  }
}
```

**Event Types:**
- `impression` - Modal shown to customer
- `click` - Customer clicked CTA button
- `closeout` - Customer closed modal without clicking
- `conversion` - Order completed (tracked via webhook, not direct API call)

**Response:**
```json
{
  "success": true,
  "tracked": true
}
```

---

### POST /apps/exit-intent/api/track-variant

**Track Variant Impression** (Enterprise Evolution System)

Records variant-level impression for evolution tracking.

**Authentication:** None (public API)

**Request Body:**
```json
{
  "shop": "example.myshopify.com",
  "variantId": "var_123",
  "segment": "mobile_paid",
  "signals": {
    "cartValue": 89.50,
    "deviceType": "mobile",
    "trafficSource": "paid"
  }
}
```

**Response:**
```json
{
  "success": true,
  "impressionId": "imp_123"
}
```

---

### POST /apps/exit-intent/api/track-click

**Track Variant Click** (Enterprise Evolution System)

Records when customer clicks CTA on a specific variant.

**Authentication:** None (public API)

**Request Body:**
```json
{
  "impressionId": "imp_123",
  "buttonType": "primary"
}
```

**Response:**
```json
{
  "success": true
}
```

---

### GET /apps/exit-intent/api/custom-css-public

**Get Custom CSS** (Enterprise Only)

Returns merchant's custom CSS for modal styling.

**Authentication:** None (public API)

**Query Parameters:**
- `shop` (required): Shop domain

**Response:**
```css
.exit-intent-modal {
  border-radius: 24px !important;
  box-shadow: 0 20px 50px rgba(0,0,0,0.3) !important;
}

.exit-intent-modal .cta-button {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
}
```

**Content-Type:** `text/css`

---

### GET /apps/exit-intent/api/custom-css

**Get Custom CSS for Editor** (Admin)

Returns custom CSS for Monaco editor in settings.

**Authentication:** Required

**Response:**
```json
{
  "css": ".exit-intent-modal { ... }"
}
```

---

### POST /apps/exit-intent/api/custom-css

**Save Custom CSS** (Admin, Enterprise Only)

Saves merchant's custom CSS.

**Authentication:** Required

**Plan Required:** Enterprise

**Request Body:**
```json
{
  "css": ".exit-intent-modal { border-radius: 24px !important; }"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Custom CSS saved successfully"
}
```

**Validation:**
- Max length: 100KB
- Sanitized for security
- Must use `!important` to override inline styles

---

### POST /apps/exit-intent/api/enrich-signals

**Enrich Customer Signals with Meta-Learning**

Enhances customer signals with cross-store intelligence.

**Authentication:** None (public API)

**Request Body:**
```json
{
  "shop": "example.myshopify.com",
  "signals": {
    "visitFrequency": "first_time",
    "cartValue": 89.50,
    "deviceType": "mobile"
  }
}
```

**Response:**
```json
{
  "enrichedSignals": {
    "visitFrequency": "first_time",
    "cartValue": 89.50,
    "deviceType": "mobile",
    "predictedConversionLikelihood": 0.35,
    "recommendedOfferAmount": 15,
    "confidenceLevel": 0.85
  },
  "insights": [
    "Mobile users convert 2x better with urgency copy",
    "15% discount optimal for cart value $80-100",
    "First-time visitors prefer percentage discounts"
  ]
}
```

---

### POST /apps/exit-intent/api/init-variants

**Initialize Variants** (Admin, Enterprise Only)

Manually triggers variant initialization for a shop.

**Authentication:** Required

**Plan Required:** Enterprise

**Response:**
```json
{
  "success": true,
  "variantsCreated": 10,
  "baselines": ["revenue_with_discount", "revenue_no_discount"]
}
```

---

### POST /apps/exit-intent/api/aggregate-meta-learning

**Trigger Meta-Learning Aggregation** (Admin)

Manually triggers cross-store gene aggregation.

**Authentication:** Required (or cron secret)

**Response:**
```json
{
  "success": true,
  "genesAggregated": 45,
  "shopsContributing": 12,
  "confidenceThreshold": 0.8
}
```

---

## Webhook Routes

These routes handle Shopify webhook events.

### POST /webhooks/orders/create

**Order Creation Webhook**

Tracks conversions when orders are placed.

**Authentication:** Shopify HMAC verification

**Request Body:** (Shopify order object)

**Processing:**
1. Extracts discount code from order
2. Finds matching Conversion or VariantImpression record
3. Updates with order details (order number, value, customer email)
4. Calculates profit (order value - discount amount)
5. Triggers evolution cycle if threshold reached

**Response:**
```json
{
  "success": true
}
```

---

### POST /webhooks/discounts/create

**Discount Creation Webhook** (Enterprise Promotional Intelligence)

Detects when merchants create site-wide discounts.

**Authentication:** Shopify HMAC verification

**Request Body:** (Shopify discount object)

**Processing:**
1. Analyzes discount for site-wide classification
2. Creates Promotion record if applicable
3. AI determines strategy (pause, increase, continue, ignore)

**Response:**
```json
{
  "success": true
}
```

---

### POST /webhooks/app/scopes_update

**App Scopes Update**

Handles when app permissions change.

**Authentication:** Shopify HMAC verification

**Processing:**
1. Logs scope change
2. Updates internal permissions tracking

---

### POST /webhooks/app/uninstalled

**App Uninstall**

Cleanup when merchant uninstalls app.

**Authentication:** Shopify HMAC verification

**Processing:**
1. Marks shop as inactive
2. Stops cron jobs for this shop
3. Archives data (does not delete)

---

## Cron Job Routes

These routes are triggered by scheduled jobs (not directly by users).

### GET /api/cron/social-proof

**Refresh Social Proof Metrics**

Updates customer counts and ratings for all shops.

**Authentication:** Cron secret (query parameter `?secret=CRON_SECRET`)

**Frequency:** Daily

**Processing:**
1. Fetches order count from Shopify
2. Fetches customer count
3. Calculates average rating (if reviews available)
4. Updates Shop records in database

**Response:**
```json
{
  "success": true,
  "shopsUpdated": 25,
  "errors": []
}
```

---

## Authentication

### Admin Routes

Admin routes use Shopify App Bridge authentication:

```javascript
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  // ... access admin API and session.shop
}
```

**Session includes:**
- `shop` - Shop domain
- `accessToken` - Shopify API access token
- `scope` - Granted permissions

### Public API Routes

Public API routes use shop domain for scoping:

```javascript
const { shop } = await request.json();
const shopRecord = await db.shop.findUnique({
  where: { shopifyDomain: shop }
});
```

**No authentication required** but data is shop-scoped.

### Webhook Routes

Webhooks use HMAC verification:

```javascript
export async function action({ request }) {
  await authenticate.webhook(request);
  // ... process webhook
}
```

Shopify signs webhooks with secret key for security.

---

## Error Handling

### Standard Error Responses

All API routes return consistent error format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "discountPercentage",
    "reason": "Must be between 1 and 100"
  }
}
```

### HTTP Status Codes

- `200` - Success
- `400` - Bad request (invalid input)
- `401` - Unauthorized (authentication required)
- `403` - Forbidden (plan restriction)
- `404` - Not found
- `500` - Internal server error

### Common Error Codes

- `SHOP_NOT_FOUND` - Shop record doesn't exist in database
- `PLAN_RESTRICTION` - Feature requires higher tier
- `INVALID_INPUT` - Request validation failed
- `DISCOUNT_CREATION_FAILED` - Shopify discount API error
- `BUDGET_EXHAUSTED` - Monthly budget cap reached
- `RATE_LIMIT_EXCEEDED` - Too many requests

---

## Rate Limiting

**Admin Routes:**
- No rate limiting (authenticated by Shopify)

**Public API Routes:**
- `shop-settings`: No limit (cached response)
- `ai-decision`: 100 requests/minute per shop
- `track`: 1000 requests/minute per shop
- `track-variant`, `track-click`: 1000 requests/minute per shop

**Exceeded Rate Limit Response:**
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 60
}
```

**HTTP Status:** `429 Too Many Requests`

---

## Best Practices

### Calling Public APIs from Storefront

1. **Always include shop parameter**
```javascript
const response = await fetch('/apps/exit-intent/api/shop-settings?shop=' + window.Shopify.shop);
```

2. **Handle errors gracefully**
```javascript
if (!response.ok) {
  console.error('Failed to load settings');
  return;
}
```

3. **Cache settings to avoid repeated calls**
```javascript
const settings = await fetchSettings();
window.exitIntentSettings = settings; // Cache in memory
```

4. **Track events asynchronously (don't block UI)**
```javascript
fetch('/apps/exit-intent/track', {
  method: 'POST',
  body: JSON.stringify({ event: 'impression', ... })
}).catch(err => console.warn('Tracking failed:', err));
```

### Calling Admin APIs from React Components

1. **Use loaders for GET requests**
```javascript
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const data = await fetchData(admin);
  return json(data);
}
```

2. **Use actions for POST requests**
```javascript
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  // ... process and save
  return json({ success: true });
}
```

3. **Use fetcher for client-side mutations**
```javascript
const fetcher = useFetcher();

function handleSave() {
  fetcher.submit(formData, { method: 'post' });
}
```

---

**Last Updated:** January 2026
**API Version:** v1 (pre-launch)
