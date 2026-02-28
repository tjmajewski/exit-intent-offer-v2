-- CreateTable
CREATE TABLE IF NOT EXISTS "MetaLearningInsights" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "insightType" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "confidenceLevel" REAL NOT NULL,
    "lastUpdated" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1
);

-- AddColumn (converted from SQLite RedefineTables)
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "contributeToMetaLearning" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MetaLearningInsights_segment_insightType_idx" ON "MetaLearningInsights"("segment", "insightType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MetaLearningInsights_lastUpdated_idx" ON "MetaLearningInsights"("lastUpdated");
