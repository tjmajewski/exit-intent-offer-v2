-- CreateTable
CREATE TABLE "VariantSegmentStat" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "segmentKey" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "VariantSegmentStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VariantSegmentStat_variantId_segmentKey_key" ON "VariantSegmentStat"("variantId", "segmentKey");

-- CreateIndex
CREATE INDEX "VariantSegmentStat_segmentKey_idx" ON "VariantSegmentStat"("segmentKey");

-- CreateIndex
CREATE INDEX "VariantSegmentStat_shopId_idx" ON "VariantSegmentStat"("shopId");
