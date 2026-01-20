# @shopify/shopify-app-template-react-router

## ResparQ AI - January 19, 2026

### Added
- **Promotional Intelligence Enhancements**:
  - Notification badge in sidebar showing unseen promotions count
  - Notification banner on promotions page for new detections
  - Dashboard widget displaying up to 3 active promotions
  - "Seen" tracking for promotions with merchant visibility status
  - Performance metrics showing revenue impact per promotion
  - Smart recommendations based on discount levels (30%+, 20-30%, <20%)
  - Feature toggle to enable/disable promotional intelligence
  - New "Ignore Promo" strategy option

- **Variant Performance Analysis Page**:
  - Complete redesign with component-based view
  - Three-column layout showing top Headlines, Subheads, and CTAs
  - Performance tier indicators (Elite/Strong/Average/Poor)
  - Color-coded borders (Green/Blue/Gray/Red) for visual assessment
  - Performance metrics per component (CVR, impressions, revenue, vs average)
  - Interactive component cards with click-to-view details
  - Promo context filtering (All/No Promo/During Promotions)
  - Customer segment dropdown (All/Desktop/Mobile/etc.)
  - Statistics dashboard showing variant counts and max generation
  - Auto-refresh capability (every 30 seconds)

- **Database Enhancements**:
  - Added `promotionalIntelligenceEnabled` field to Shop model
  - Added `seenByMerchant` field to Promotion model
  - Added `duringPromo` field to VariantImpression model for context tracking
  - Added index on `[shopId, duringPromo]` for performance
  - Added index on `[shopId, seenByMerchant]` for notification queries

- **API Endpoints**:
  - New `/api/promotions-count` endpoint for notification badge polling

### Changed
- Variants page now uses AppLayout with Polaris components (removed emojis)
- Promo context and segment filtering now use URL parameters for state management
- Navigation improved with proper useSearchParams implementation
- Dashboard widget shows promotional intelligence status and active promotions

### Fixed
- Navigation issues with URL parameter state management
- Plan relation error in variants loader (removed invalid include)

### Documentation
- Updated AI_PRO_VS_ENTERPRISE.md with new features and notification system details
- Updated AI_TECHNICAL_ARCHITECTURE.md with database schema changes and new architecture
- Updated AI_SYSTEM_COMPLETE_GUIDE.md with Enterprise features documentation
- Updated all documentation dates to January 19, 2026

## ResparQ AI - January 19, 2026 (Evening Update - Segment Tracking)

### Added
- **Complete Segment Tracking Implementation**:
  - Added `accountStatus` field to VariantImpression (guest/logged_in)
  - Added `visitFrequency` field to VariantImpression (first-time=1, returning=2+)
  - Full segment filtering in variants loader supporting:
    - Device Type (Desktop, Mobile, Tablet)
    - Account Status (Logged In, Guest)
    - Visitor Type (First-Time, Returning)
    - Cart Value (High Value $100+, Low Value <$50)
    - Traffic Source (Paid, Organic)
  - Comprehensive segment dropdown UI with organized categories
  - URL parameter-based segment filtering with state preservation
  - Database indexes on `deviceType` and `accountStatus` for performance

- **Component Aggregation System**:
  - Implemented `aggregateByComponent()` function for headlines, subheads, CTAs
  - Performance tier calculation (Elite/Strong/Average/Poor)
  - Revenue-based sorting and tier assignment
  - Component stats returned in loader response
  - Top 10 components per category display

### Changed
- Promo toggle updated to use consistent `promo` parameter (was `promoMode`)
- Added "All" option to promo filter for viewing all data
- Segment dropdown now uses URL search params for filtering
- All filters preserve other parameters when changed
- Variants page now fully supports combined promo + segment filtering

### Fixed
- URL parameter consistency between UI and loader
- Search params preservation when changing filters

### Documentation
- Removed "(Coming Soon)" from segment filtering documentation
- Added comprehensive segment filter options to all docs
- Updated database schema documentation with new fields
- Updated technical architecture with complete segment filtering logic

## 2025.10.10

- [#95](https://github.com/Shopify/shopify-app-template-react-router/pull/95) Swap the product link for [admin intents](https://shopify.dev/docs/apps/build/admin/admin-intents).

## 2025.10.02

- [#81](https://github.com/Shopify/shopify-app-template-react-router/pull/81) Add shopify global to eslint for ui extensions

## 2025.10.01

- [#79](https://github.com/Shopify/shopify-app-template-react-router/pull/78) Update API version to 2025-10.
- [#77](https://github.com/Shopify/shopify-app-template-react-router/pull/77) Update `@shopify/shopify-app-react-router` to V1.
- [#73](https://github.com/Shopify/shopify-app-template-react-router/pull/73/files) Rename @shopify/app-bridge-ui-types to @shopify/polaris-types

## 2025.08.30

- [#70](https://github.com/Shopify/shopify-app-template-react-router/pull/70/files) Upgrade `@shopify/app-bridge-ui-types` from 0.2.1 to 0.3.1.

## 2025.08.17

- [#58](https://github.com/Shopify/shopify-app-template-react-router/pull/58) Update Shopify & React Router dependencies.  Use Shopify React Router in graphqlrc, not shopify-api
- [#57](https://github.com/Shopify/shopify-app-template-react-router/pull/57) Update Webhook API version in `shopify.app.toml` to `2025-07`
- [#56](https://github.com/Shopify/shopify-app-template-react-router/pull/56) Remove local CLI from package.json in favor of global CLI installation
- [#53](https://github.com/Shopify/shopify-app-template-react-router/pull/53) Add the Shopify Dev MCP to the template

## 2025.08.16

- [#52](https://github.com/Shopify/shopify-app-template-react-router/pull/52) Use `ApiVersion.July25` rather than `LATEST_API_VERSION` in `.graphqlrc`.

## 2025.07.24

- [14](https://github.com/Shopify/shopify-app-template-react-router/pull/14/files) Add [App Bridge web components](https://shopify.dev/docs/api/app-home/app-bridge-web-components) to the template.

## July 2025

Forked the [shopify-app-template repo](https://github.com/Shopify/shopify-app-template-remix)

# @shopify/shopify-app-template-remix

## 2025.03.18

-[#998](https://github.com/Shopify/shopify-app-template-remix/pull/998) Update to Vite 6

## 2025.03.01

- [#982](https://github.com/Shopify/shopify-app-template-remix/pull/982) Add Shopify Dev Assistant extension to the VSCode extension recommendations

## 2025.01.31

- [#952](https://github.com/Shopify/shopify-app-template-remix/pull/952) Update to Shopify App API v2025-01

## 2025.01.23

- [#923](https://github.com/Shopify/shopify-app-template-remix/pull/923) Update `@shopify/shopify-app-session-storage-prisma` to v6.0.0

## 2025.01.8

- [#923](https://github.com/Shopify/shopify-app-template-remix/pull/923) Enable GraphQL autocomplete for Javascript

## 2024.12.19

- [#904](https://github.com/Shopify/shopify-app-template-remix/pull/904) bump `@shopify/app-bridge-react` to latest
-
## 2024.12.18

- [875](https://github.com/Shopify/shopify-app-template-remix/pull/875) Add Scopes Update Webhook
## 2024.12.05

- [#910](https://github.com/Shopify/shopify-app-template-remix/pull/910) Install `openssl` in Docker image to fix Prisma (see [#25817](https://github.com/prisma/prisma/issues/25817#issuecomment-2538544254))
- [#907](https://github.com/Shopify/shopify-app-template-remix/pull/907) Move `@remix-run/fs-routes` to `dependencies` to fix Docker image build
- [#899](https://github.com/Shopify/shopify-app-template-remix/pull/899) Disable v3_singleFetch flag
- [#898](https://github.com/Shopify/shopify-app-template-remix/pull/898) Enable the `removeRest` future flag so new apps aren't tempted to use the REST Admin API.

## 2024.12.04

- [#891](https://github.com/Shopify/shopify-app-template-remix/pull/891) Enable remix future flags.

## 2024.11.26

- [888](https://github.com/Shopify/shopify-app-template-remix/pull/888) Update restResources version to 2024-10

## 2024.11.06

- [881](https://github.com/Shopify/shopify-app-template-remix/pull/881) Update to the productCreate mutation to use the new ProductCreateInput type

## 2024.10.29

- [876](https://github.com/Shopify/shopify-app-template-remix/pull/876) Update shopify-app-remix to v3.4.0 and shopify-app-session-storage-prisma to v5.1.5

## 2024.10.02

- [863](https://github.com/Shopify/shopify-app-template-remix/pull/863) Update to Shopify App API v2024-10 and shopify-app-remix v3.3.2

## 2024.09.18

- [850](https://github.com/Shopify/shopify-app-template-remix/pull/850) Removed "~" import alias

## 2024.09.17

- [842](https://github.com/Shopify/shopify-app-template-remix/pull/842) Move webhook processing to individual routes

## 2024.08.19

Replaced deprecated `productVariantUpdate` with `productVariantsBulkUpdate`

## v2024.08.06

Allow `SHOP_REDACT` webhook to process without admin context

## v2024.07.16

Started tracking changes and releases using calver
