# Database Schema - ResparQ

Complete documentation of all database models, relationships, and data flows in the ResparQ application.

---

## Overview

ResparQ uses **Prisma ORM** with **SQLite** (development) and **PostgreSQL** (production). All models are defined in `prisma/schema.prisma`.

### Core Models

- **Shop** - Master record for each merchant installation
- **Session** - Shopify app session storage
- **Variant** - AI-generated modal variants (Enterprise evolution system)
- **VariantImpression** - Individual customer exposures to variants
- **Conversion** - Orders attributed to exit intent modals
- **DiscountOffer** - Dynamically created discount codes (AI mode)
- **AIDecision** - Audit trail of AI decisions
- **MetaLearningInsights** - Cross-store intelligence aggregates
- **MetaLearningGene** - Gene-level performance across network
- **SeasonalPattern** - Historical seasonal performance data
- **BrandSafetyRule** - Content guardrails (Enterprise)
- **Promotion** - Detected site-wide promotions (Enterprise)

---

## Entity Relationship Diagram

```
┌──────────┐         ┌─────────────┐         ┌──────────────┐
│  Shop    │1───────n│  Variant    │1───────n│ VariantImp.  │
│          │         │             │         │              │
│ (Master) │         │ (Evolution) │         │ (Tracking)   │
└──────────┘         └─────────────┘         └──────────────┘
     │ 1                                             │ 1
     │                                               │
     │ n                                             │ n
┌──────────────┐                             ┌────────────┐
│ Conversion   │                             │ Conversion │
│              │◄────────────────────────────┤            │
│ (Orders)     │      Links via discount     │            │
└──────────────┘                             └────────────┘
     │ 1
     │
     │ n
┌──────────────┐         ┌──────────────┐
│DiscountOffer │         │ AIDecision   │
│              │         │              │
│ (AI Codes)   │         │ (Audit)      │
└──────────────┘         └──────────────┘
     │ 1                      │ 1
     │                        │
     │ n                      │ n
┌──────────┐                ┌──────────┐
│   Shop   │                │   Shop   │
└──────────┘                └──────────┘

Cross-Store Models:
┌───────────────────┐         ┌──────────────────┐
│MetaLearningInsights│         │ MetaLearningGene │
│                   │         │                  │
│ (Aggregates)      │         │ (Gene Performance)│
└───────────────────┘         └──────────────────┘

Shop-Specific:
┌─────────────────┐         ┌────────────┐
│SeasonalPattern  │         │ Promotion  │
│                 │         │            │
│ (History)       │         │ (Promo AI) │
└─────────────────┘         └────────────┘
```

---

## Model Definitions

### Shop

**Purpose:** Master record for each installed shop. Stores configuration, plan info, and branding.

**File:** `prisma/schema.prisma`

```prisma
model Shop {
  id              String   @id @default(uuid())
  shopifyDomain   String   @unique
  accessToken     String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Plan & Status
  plan            String   @default("pro")
  enabled         Boolean  @default(true)
  mode            String   @default("manual")

  // Modal Content
  modalHeadline       String?  @default("Wait! Don't leave yet 🎁")
  modalBody           String?  @default("Complete your purchase now and get an exclusive discount!")
  ctaButton           String?  @default("Complete My Order")
  redirectDestination String?  @default("checkout")

  // Discount Settings
  discountCode        String?
  discountEnabled     Boolean  @default(false)
  offerType           String?  @default("percentage")

  // Triggers
  exitIntentEnabled   Boolean  @default(true)
  timeDelayEnabled    Boolean  @default(false)
  timeDelaySeconds    Int      @default(30)
  cartValueEnabled    Boolean  @default(false)
  cartValueMin        Float    @default(0)
  cartValueMax        Float    @default(999999)

  // AI Settings
  aiAggression        Int      @default(5)
  aiGoal              String   @default("revenue")
  budgetEnabled       Boolean  @default(false)
  budgetAmount        Float    @default(1000)
  budgetPeriod        String   @default("month")
  metaLearningEnabled Boolean  @default(true)

  // Evolution System (Enterprise)
  mutationRate        Float    @default(0.1)
  crossoverRate       Float    @default(0.3)
  selectionPressure   Float    @default(0.2)
  populationSize      Int      @default(10)
  lastEvolutionCycle  DateTime?
  impressionsSinceEvolution Int @default(0)

  // Social Proof
  socialProofEnabled    Boolean  @default(false)
  socialProofType       String?  @default("orders")
  socialProofMinimum    Int      @default(100)
  socialProofUpdatedAt  DateTime?
  orderCount            Int      @default(0)
  customerCount         Int      @default(0)
  avgRating             Float?
  reviewCount           Int      @default(0)

  // Branding (Enterprise)
  brandPrimaryColor   String?  @default("#8B5CF6")
  brandSecondaryColor String?  @default("#FFFFFF")
  brandAccentColor    String?  @default("#10B981")
  brandFontFamily     String?  @default("system")
  brandLogoUrl        String?
  customCSS           String?  @db.Text

  // Relationships
  discountOffers      DiscountOffer[]
  aiDecisions         AIDecision[]
  variants            Variant[]
  conversions         Conversion[]
  seasonalPatterns    SeasonalPattern[]
  brandSafetyRules    BrandSafetyRule[]
  promotions          Promotion[]
}
```

**Indexes:**
- `shopifyDomain` (unique)
- `plan`
- `enabled`

**Key Fields:**
- `plan`: `"starter"`, `"pro"`, or `"enterprise"`
- `mode`: `"manual"` or `"ai"`
- `aiAggression`: 0-10 (0 = reminder only, 10 = max discounts)
- `aiGoal`: `"revenue"` (maximize total) or `"conversions"` (maximize count)

---

### Session

**Purpose:** Shopify app session storage (managed by Shopify package).

```prisma
model Session {
  id          String    @id
  shop        String
  state       String
  isOnline    Boolean   @default(false)
  scope       String?
  expires     DateTime?
  accessToken String
  userId      BigInt?
}
```

**Managed by:** `@shopify/shopify-app-session-storage-prisma`

---

### Variant

**Purpose:** AI-generated modal variants (Enterprise evolution system).

```prisma
model Variant {
  id          String   @id @default(uuid())
  shopId      String
  shop        Shop     @relation(fields: [shopId], references: [id])

  // Genetics
  baseline        String   // "revenue_with_discount", "conversion_no_discount", etc.
  generation      Int      @default(1)
  parentIds       String?  // Comma-separated UUIDs

  // Content Genes
  headline        String
  subhead         String?
  ctaText         String
  offerAmount     Int      // Percentage or fixed amount
  urgencyLevel    String   // "low", "medium", "high"

  // Visual Genes
  colorScheme     String   // "purple", "green", "blue", "gradient"
  layout          String   // "centered", "bottom", "side"
  buttonStyle     String   // "rounded", "sharp", "pill"
  animation       String   // "fade", "slide", "bounce"
  typography      String   // "modern", "classic", "bold"

  // Segmentation
  segment         String   // "all", "mobile", "desktop", "mobile_paid", etc.

  // Performance Metrics
  impressions        Int     @default(0)
  clicks             Int     @default(0)
  conversions        Int     @default(0)
  revenue            Float   @default(0)
  discountAmount     Float   @default(0)
  profit             Float   @default(0)
  profitPerImpression Float  @default(0)

  // Status
  status          String   @default("alive") // "alive", "dying", "dead", "champion"

  // Timestamps
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  killedAt        DateTime?

  // Relationships
  impressionRecords VariantImpression[]

  @@index([shopId])
  @@index([baseline])
  @@index([generation])
  @@index([status])
}
```

**Key Fields:**
- `baseline`: Which fitness function this variant optimizes for
- `generation`: Evolution cycle number (starts at 1, increments on breed)
- `status`:
  - `alive` - Active variant
  - `dying` - Poor performer (marked for death)
  - `dead` - Killed by evolution
  - `champion` - Best performer (protected from death)
- `segment`: Target audience segment for this variant

**Performance Calculation:**
```javascript
profitPerImpression = (revenue - discountAmount) / impressions
```

---

### VariantImpression

**Purpose:** Tracks individual customer exposures to specific variants.

```prisma
model VariantImpression {
  id           String    @id @default(uuid())
  variantId    String
  variant      Variant   @relation(fields: [variantId], references: [id])

  // Customer Context
  segment          String    // Same as variant.segment
  deviceType       String    // "mobile", "tablet", "desktop"
  trafficSource    String    // "direct", "organic", "paid", "social"
  cartValue        Float     @default(0)

  // Interaction
  clicked          Boolean   @default(false)
  converted        Boolean   @default(false)

  // Conversion Details (if converted)
  orderNumber      String?
  revenue          Float     @default(0)
  discountAmount   Float     @default(0)
  profit           Float     @default(0)

  // Timestamps
  shownAt          DateTime  @default(now())
  clickedAt        DateTime?
  convertedAt      DateTime?

  @@index([variantId])
  @@index([converted])
}
```

**Usage:** Evolution system queries this to calculate variant performance.

---

### Conversion

**Purpose:** Links Shopify orders to exit intent modal interactions.

```prisma
model Conversion {
  id              String   @id @default(uuid())
  shopId          String
  shop            Shop     @relation(fields: [shopId], references: [id])

  // Order Details
  orderId         String   // Shopify order ID
  orderNumber     String   // e.g., "#1001"
  orderValue      Float
  customerEmail   String?
  orderedAt       DateTime

  // Modal Attribution
  modalHadDiscount    Boolean  @default(false)
  discountCode        String?
  discountRedeemed    Boolean  @default(false)
  discountAmount      Float?

  // Modal Configuration Snapshot (Enterprise only)
  modalHeadline    String?
  modalBody        String?
  modalCta         String?
  modalOfferType   String?
  modalOfferAmount Float?

  // Timestamps
  createdAt       DateTime @default(now())

  @@unique([shopId, orderId])
  @@index([shopId])
  @@index([orderedAt])
}
```

**Unique Constraint:** One conversion per order (shopId + orderId)

**Tracking Flow:**
1. Modal shown → VariantImpression created
2. Order placed → `orders/create` webhook fires
3. Webhook finds matching impression by discount code
4. Creates/updates Conversion record

---

### DiscountOffer

**Purpose:** Tracks dynamically created discount codes (AI mode).

```prisma
model DiscountOffer {
  id              String    @id @default(uuid())
  shopId          String
  shop            Shop      @relation(fields: [shopId], references: [id])

  discountCode    String    // Unique code (e.g., "EXIT15-ABC123")
  offerType       String    // "percentage", "fixed"
  amount          Float     // 10, 15, 20, etc.
  cartValue       Float?    // Customer's cart value when offer made

  expiresAt       DateTime  // 24 hours from creation
  redeemed        Boolean   @default(false)
  redeemedAt      DateTime?

  createdAt       DateTime  @default(now())

  @@index([shopId])
  @@index([discountCode])
  @@index([expiresAt])
}
```

**Lifecycle:**
1. AI decision creates offer → DiscountOffer record
2. Code created in Shopify
3. Customer uses code → `redeemed` set to `true`
4. Expires after 24 hours (cleanup job deletes)

---

### AIDecision

**Purpose:** Audit trail of AI decisions for analysis.

```prisma
model AIDecision {
  id              String   @id @default(uuid())
  shopId          String
  shop            Shop     @relation(fields: [shopId], references: [id])

  // Input Signals
  signals         Json     // All 13 customer signals as JSON

  // Decision Output
  action          String   // "offer", "no_offer"
  offerType       String?  // "percentage", "fixed", "reminder"
  offerAmount     Float?   // Discount amount
  discountCode    String?  // Generated code (if applicable)

  // Metadata
  reason          String?  // Why no offer (if no_offer)
  confidence      Float?   // AI confidence level (0-1)

  createdAt       DateTime @default(now())

  @@index([shopId])
  @@index([createdAt])
}
```

**Usage:** Analyze AI decision patterns, debug offer logic.

---

### MetaLearningInsights

**Purpose:** Cross-store aggregated intelligence.

```prisma
model MetaLearningInsights {
  id              String   @id @default(uuid())

  segment         String   // "mobile_paid", "desktop_organic", etc.
  insightType     String   // "signal_correlation", "copy_pattern", "benchmark"

  // Insight Data
  key             String   // e.g., "urgency_effectiveness"
  value           Json     // Insight data as JSON

  // Confidence
  confidenceLevel Float    // 0-1 (based on sample size)
  sampleSize      Int      // Number of shops contributing

  // Timestamps
  calculatedAt    DateTime @default(now())
  expiresAt       DateTime // Refresh weekly

  @@unique([segment, insightType, key])
  @@index([segment])
  @@index([expiresAt])
}
```

**Example Insight:**
```json
{
  "segment": "mobile_paid",
  "insightType": "copy_pattern",
  "key": "urgency_effectiveness",
  "value": {
    "withUrgency": { "conversionRate": 0.085 },
    "withoutUrgency": { "conversionRate": 0.042 },
    "liftMultiplier": 2.02
  },
  "confidenceLevel": 0.87,
  "sampleSize": 15
}
```

---

### MetaLearningGene

**Purpose:** Gene-level performance tracking across all shops.

```prisma
model MetaLearningGene {
  id              String   @id @default(uuid())

  geneType        String   // "headline", "subhead", "cta", "color", etc.
  geneValue       String   // Actual gene content

  // Segmentation
  segment         String?  // "mobile", "desktop", null = all
  industry        String?  // "fashion", "electronics", null = all
  avgOrderValue   String?  // "low", "medium", "high", null = all

  // Performance Across Network
  impressions        Int     @default(0)
  clicks             Int     @default(0)
  conversions        Int     @default(0)
  revenue            Float   @default(0)
  conversionRate     Float   @default(0)
  revenuePerImpression Float @default(0)

  // Confidence
  confidenceLevel    Float   @default(0)
  shopsContributing  Int     @default(0)

  // Timestamps
  lastAggregated     DateTime @default(now())

  @@unique([geneType, geneValue, segment, industry, avgOrderValue])
  @@index([geneType])
  @@index([confidenceLevel])
}
```

**Usage:** New shops bootstrap with high-performing genes from the network.

---

### SeasonalPattern

**Purpose:** Historical seasonal performance tracking per shop.

```prisma
model SeasonalPattern {
  id              String   @id @default(uuid())
  shopId          String
  shop            Shop     @relation(fields: [shopId], references: [id])

  season          String   // "blackFriday", "holidaySeason", "backToSchool", etc.
  year            Int

  // Performance During Season
  impressions        Int
  clicks             Int
  conversions        Int
  revenue            Float
  conversionRate     Float

  // Winning Genes
  topHeadline     String?
  topSubhead      String?
  topOfferAmount  Int?
  topColorScheme  String?

  // Timestamps
  seasonStart     DateTime
  seasonEnd       DateTime
  createdAt       DateTime @default(now())

  @@unique([shopId, season, year])
  @@index([shopId])
  @@index([season])
}
```

**Usage:** Recommend seasonal genes (e.g., "Black Friday last year, your best headline was X").

---

### BrandSafetyRule

**Purpose:** Content guardrails for Enterprise shops.

```prisma
model BrandSafetyRule {
  id              String   @id @default(uuid())
  shopId          String
  shop            Shop     @relation(fields: [shopId], references: [id])

  ruleType        String   // "prohibited_word", "required_phrase", "tone", "max_discount"
  ruleValue       String   // Rule configuration as string or JSON

  isActive        Boolean  @default(true)

  createdAt       DateTime @default(now())

  @@index([shopId])
}
```

**Example Rules:**
- Prohibited word: `"urgent"`, `"hurry"`, `"act now"`
- Required phrase: `"100% satisfaction guaranteed"`
- Tone: `"professional"`, `"casual"`, `"playful"`
- Max discount: `20` (never offer more than 20%)

---

### Promotion

**Purpose:** Tracks detected site-wide promotions (Enterprise promotional intelligence).

```prisma
model Promotion {
  id              String   @id @default(uuid())
  shopId          String
  shop            Shop     @relation(fields: [shopId], references: [id])

  // Promotion Details
  title           String   // "SUMMER20", "BLACKFRIDAY", etc.
  percentage      Float?   // 20, 30, etc.
  fixedAmount     Float?   // $10, $25, etc.

  // Usage Tracking
  usageTotal      Int      @default(0)
  usageLast24h    Int      @default(0)

  // Classification
  classification  String   // "site_wide", "product_specific", "customer_specific"
  aiStrategy      String   // "pause", "increase", "continue", "ignore"

  // Merchant Override
  merchantOverride String?  // Overrides AI strategy
  merchantNotes    String?

  // Timestamps
  detectedAt      DateTime @default(now())
  lastUsedAt      DateTime?

  @@index([shopId])
  @@index([classification])
}
```

**AI Strategies:**
- `pause` - Stop showing exit intent (customer already has better discount)
- `increase` - Offer higher discount to compete
- `continue` - Keep current strategy
- `ignore` - Promotion is product-specific, doesn't affect exit intent

---

## Database Queries

### Common Query Patterns

#### Get Shop with Plan Info
```javascript
const shop = await db.shop.findUnique({
  where: { shopifyDomain: session.shop },
  select: {
    id: true,
    plan: true,
    enabled: true,
    mode: true,
    modalHeadline: true,
    modalBody: true,
    discountCode: true,
    triggers: true
  }
});
```

#### Get Active Variants for Shop
```javascript
const variants = await db.variant.findMany({
  where: {
    shopId: shopRecord.id,
    status: 'alive'
  },
  orderBy: {
    profitPerImpression: 'desc'
  },
  take: 10
});
```

#### Get Conversions with Pagination
```javascript
const conversions = await db.conversion.findMany({
  where: {
    shopId: shopRecord.id,
    orderedAt: {
      gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
    }
  },
  orderBy: {
    orderedAt: 'desc'
  },
  skip: (page - 1) * limit,
  take: limit
});
```

#### Track Variant Impression
```javascript
const impression = await db.variantImpression.create({
  data: {
    variantId: variant.id,
    segment: 'mobile_paid',
    deviceType: 'mobile',
    trafficSource: 'paid',
    cartValue: 89.50
  }
});

// Update variant impression count
await db.variant.update({
  where: { id: variant.id },
  data: {
    impressions: { increment: 1 }
  }
});
```

#### Record Conversion
```javascript
await db.conversion.create({
  data: {
    shopId: shopRecord.id,
    orderId: order.id,
    orderNumber: order.name,
    orderValue: parseFloat(order.total_price),
    customerEmail: order.email,
    orderedAt: new Date(order.created_at),
    modalHadDiscount: true,
    discountCode: discountCode,
    discountRedeemed: true,
    discountAmount: discountAmount
  }
});
```

---

## Migrations

### Running Migrations

```bash
# Create migration
npx prisma migrate dev --name add_custom_css_field

# Apply to production
npx prisma migrate deploy

# Reset database (dev only)
npx prisma migrate reset
```

### Important Migrations

**Recent migrations:**
- `add_trigger_settings` - Added trigger fields to Shop
- `add_modal_content` - Added modal content fields to Shop
- `add_discount_code` - Added discount code tracking
- `add_cart_value_max_default` - Updated cart value max default to 999999

---

## Performance Considerations

### Indexes

Ensure these indexes exist for optimal query performance:

```prisma
@@index([shopId]) // On all related tables
@@index([orderedAt]) // On Conversion for date filtering
@@index([status]) // On Variant for status filtering
@@index([discountCode]) // On DiscountOffer for lookup
@@index([expiresAt]) // On DiscountOffer for cleanup
```

### Query Optimization

**Bad (N+1 queries):**
```javascript
const variants = await db.variant.findMany({ where: { shopId } });
for (const variant of variants) {
  const impressions = await db.variantImpression.findMany({
    where: { variantId: variant.id }
  });
}
```

**Good (Include relation):**
```javascript
const variants = await db.variant.findMany({
  where: { shopId },
  include: {
    impressionRecords: {
      where: { converted: true }
    }
  }
});
```

### Connection Pooling

**Production (PostgreSQL):**
```env
DATABASE_URL="postgresql://user:password@host:5432/dbname?connection_limit=10&pool_timeout=10"
```

**Development (SQLite):**
```env
DATABASE_URL="file:./dev.db"
```

---

## Data Privacy & Security

### Personal Data

**Stored:**
- Customer email (Conversion table)
- Order numbers and values

**NOT stored:**
- Customer names
- Customer addresses
- Payment information
- Cart contents (only cart value)

### GDPR Compliance

**Data Deletion:**
When shop uninstalls, all shop data is marked inactive but not immediately deleted (30-day retention for support).

**Data Export:**
Merchants can export their conversion data via Excel export feature.

**Cross-Store Data:**
MetaLearning models only store aggregate performance data (no customer PII).

---

**Last Updated:** January 2026
**Schema Version:** Pre-launch v1
**Database:** SQLite (dev), PostgreSQL (production)
