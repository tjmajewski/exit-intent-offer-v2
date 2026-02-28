-- CreateTable
CREATE TABLE "MetaLearningInsights" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "insightType" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "confidenceLevel" REAL NOT NULL,
    "lastUpdated" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyDomain" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'manual',
    "plan" TEXT NOT NULL DEFAULT 'pro',
    "aiGoal" TEXT NOT NULL DEFAULT 'revenue',
    "aggression" INTEGER NOT NULL DEFAULT 5,
    "budgetEnabled" BOOLEAN NOT NULL DEFAULT false,
    "budgetAmount" REAL NOT NULL DEFAULT 500,
    "budgetPeriod" TEXT NOT NULL DEFAULT 'month',
    "budgetStartDate" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "copyVariants" TEXT DEFAULT '{"variants":[],"segmentBestVariants":{}}',
    "lastVariantUpdate" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "contributeToMetaLearning" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_Shop" ("aggression", "aiGoal", "budgetAmount", "budgetEnabled", "budgetPeriod", "budgetStartDate", "copyVariants", "createdAt", "id", "lastVariantUpdate", "mode", "plan", "shopifyDomain", "updatedAt") SELECT "aggression", "aiGoal", "budgetAmount", "budgetEnabled", "budgetPeriod", "budgetStartDate", "copyVariants", "createdAt", "id", "lastVariantUpdate", "mode", "plan", "shopifyDomain", "updatedAt" FROM "Shop";
DROP TABLE "Shop";
ALTER TABLE "new_Shop" RENAME TO "Shop";
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "MetaLearningInsights_segment_insightType_idx" ON "MetaLearningInsights"("segment", "insightType");

-- CreateIndex
CREATE INDEX "MetaLearningInsights_lastUpdated_idx" ON "MetaLearningInsights"("lastUpdated");
