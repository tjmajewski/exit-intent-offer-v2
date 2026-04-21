-- Phase 2A: Add scenario signals + archetype tracking + store vertical clustering.
-- Enables meta-learning to answer "which archetype wins for which person × scenario
-- × store type" and to group similar stores together when sharing insights.

-- Store vertical enables cross-store learning within similar store types
-- (e.g. fashion stores learn from fashion stores, not electronics).
-- Nullable: self-reported via admin settings; null = include in all-verticals pool.
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "storeVertical" TEXT;

-- Scenario signals captured per impression (who the person is + where they are).
-- pageType: home | product | collection | cart | checkout | search | blog | account | other
-- promoInCart: true if the cart has any applied discount code or per-item discount allocation
-- archetype: denormalized archetype name (e.g. THRESHOLD_DISCOUNT) for fast aggregation
--            without joining Variant -> baseline -> gene-pools at query time
-- segmentKey: composite stable key like "d:mobile|t:paid|a:guest|p:product|pr:no|f:first"
--             composed by app/utils/segment-key.js; enables rich segment partitioning
--             beyond the legacy {device}_{traffic} segment field
ALTER TABLE "VariantImpression" ADD COLUMN IF NOT EXISTS "pageType" TEXT;
ALTER TABLE "VariantImpression" ADD COLUMN IF NOT EXISTS "promoInCart" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VariantImpression" ADD COLUMN IF NOT EXISTS "archetype" TEXT;
ALTER TABLE "VariantImpression" ADD COLUMN IF NOT EXISTS "segmentKey" TEXT;

-- Indexes sized for the aggregation queries that will read them.
-- archetype + timestamp: per-archetype rolling window CVR queries
-- segmentKey + timestamp: per-composite-segment rolling window queries
-- shopId + pageType: admin dashboard "which pages drive conversions" filter
-- storeVertical: cross-store aggregator filters stores by vertical
CREATE INDEX IF NOT EXISTS "VariantImpression_archetype_timestamp_idx" ON "VariantImpression"("archetype", "timestamp");
CREATE INDEX IF NOT EXISTS "VariantImpression_segmentKey_timestamp_idx" ON "VariantImpression"("segmentKey", "timestamp");
CREATE INDEX IF NOT EXISTS "VariantImpression_shopId_pageType_idx" ON "VariantImpression"("shopId", "pageType");
CREATE INDEX IF NOT EXISTS "Shop_storeVertical_idx" ON "Shop"("storeVertical");
