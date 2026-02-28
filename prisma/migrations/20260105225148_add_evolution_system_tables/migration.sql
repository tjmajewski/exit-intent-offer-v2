-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "lastEvolutionCycle" TIMESTAMP;

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "baseline" TEXT NOT NULL,
    "segment" TEXT NOT NULL DEFAULT 'all',
    "status" TEXT NOT NULL DEFAULT 'alive',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "parents" TEXT,
    "offerAmount" INTEGER NOT NULL,
    "headline" TEXT NOT NULL,
    "subhead" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "redirect" TEXT NOT NULL,
    "urgency" BOOLEAN NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "revenue" REAL NOT NULL DEFAULT 0,
    "profitPerImpression" REAL NOT NULL DEFAULT 0,
    "birthDate" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deathDate" TIMESTAMP,
    "championDate" TIMESTAMP,
    CONSTRAINT "Variant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VariantImpression" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variantId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "clicked" BOOLEAN NOT NULL DEFAULT false,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "revenue" REAL,
    "discountAmount" REAL,
    "profit" REAL,
    "segment" TEXT NOT NULL DEFAULT 'all',
    "deviceType" TEXT,
    "trafficSource" TEXT,
    "cartValue" REAL,
    "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VariantImpression_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MetaLearningGene" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "baseline" TEXT NOT NULL,
    "geneType" TEXT NOT NULL,
    "geneValue" TEXT NOT NULL,
    "totalImpressions" INTEGER NOT NULL DEFAULT 0,
    "totalConversions" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" REAL NOT NULL DEFAULT 0,
    "avgCVR" REAL NOT NULL DEFAULT 0,
    "avgProfitPerImpression" REAL NOT NULL DEFAULT 0,
    "confidenceLevel" REAL NOT NULL DEFAULT 0,
    "industry" TEXT,
    "avgOrderValue" TEXT,
    "deviceType" TEXT,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP NOT NULL
);

-- CreateTable
CREATE TABLE "SeasonalPattern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "startDate" TIMESTAMP NOT NULL,
    "endDate" TIMESTAMP NOT NULL,
    "avgCVR" REAL NOT NULL DEFAULT 0,
    "avgAOV" REAL NOT NULL DEFAULT 0,
    "avgProfitPerImpression" REAL NOT NULL DEFAULT 0,
    "trafficMultiplier" REAL NOT NULL DEFAULT 1,
    "recommendedOfferAmounts" TEXT NOT NULL DEFAULT '[]',
    "recommendedUrgency" BOOLEAN NOT NULL DEFAULT true,
    "recommendedHeadlines" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "SeasonalPattern_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrandSafetyRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "prohibitedWords" TEXT NOT NULL DEFAULT '[]',
    "requiredPhrases" TEXT NOT NULL DEFAULT '[]',
    "maxDiscountPercent" INTEGER NOT NULL DEFAULT 100,
    "tone" TEXT NOT NULL DEFAULT 'casual',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "BrandSafetyRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Variant_variantId_key" ON "Variant"("variantId");

-- CreateIndex
CREATE INDEX "Variant_shopId_status_idx" ON "Variant"("shopId", "status");

-- CreateIndex
CREATE INDEX "Variant_shopId_baseline_segment_idx" ON "Variant"("shopId", "baseline", "segment");

-- CreateIndex
CREATE INDEX "Variant_status_profitPerImpression_idx" ON "Variant"("status", "profitPerImpression");

-- CreateIndex
CREATE INDEX "VariantImpression_variantId_converted_idx" ON "VariantImpression"("variantId", "converted");

-- CreateIndex
CREATE INDEX "VariantImpression_shopId_timestamp_idx" ON "VariantImpression"("shopId", "timestamp");

-- CreateIndex
CREATE INDEX "VariantImpression_segment_timestamp_idx" ON "VariantImpression"("segment", "timestamp");

-- CreateIndex
CREATE INDEX "MetaLearningGene_baseline_avgProfitPerImpression_idx" ON "MetaLearningGene"("baseline", "avgProfitPerImpression");

-- CreateIndex
CREATE INDEX "MetaLearningGene_baseline_geneType_confidenceLevel_idx" ON "MetaLearningGene"("baseline", "geneType", "confidenceLevel");

-- CreateIndex
CREATE INDEX "SeasonalPattern_shopId_season_idx" ON "SeasonalPattern"("shopId", "season");

-- CreateIndex
CREATE UNIQUE INDEX "BrandSafetyRule_shopId_key" ON "BrandSafetyRule"("shopId");
