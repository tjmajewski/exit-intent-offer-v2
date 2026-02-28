-- AddColumns (converted from SQLite RedefineTables)
ALTER TABLE "Variant" ADD COLUMN IF NOT EXISTS "colorScheme" TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE "Variant" ADD COLUMN IF NOT EXISTS "layout" TEXT NOT NULL DEFAULT 'centered';
ALTER TABLE "Variant" ADD COLUMN IF NOT EXISTS "buttonStyle" TEXT NOT NULL DEFAULT 'solid';
ALTER TABLE "Variant" ADD COLUMN IF NOT EXISTS "animation" TEXT NOT NULL DEFAULT 'fade';
ALTER TABLE "Variant" ADD COLUMN IF NOT EXISTS "typography" TEXT NOT NULL DEFAULT 'modern';

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Variant_variantId_key" ON "Variant"("variantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Variant_shopId_status_idx" ON "Variant"("shopId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Variant_shopId_baseline_segment_idx" ON "Variant"("shopId", "baseline", "segment");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Variant_status_profitPerImpression_idx" ON "Variant"("status", "profitPerImpression");
