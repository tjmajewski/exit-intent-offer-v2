-- CreateTable
CREATE TABLE "InterventionOutcome" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "wasShown" BOOLEAN NOT NULL,
    "isHoldout" BOOLEAN NOT NULL DEFAULT false,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "revenue" DOUBLE PRECISION,
    "discountAmount" DOUBLE PRECISION,
    "profit" DOUBLE PRECISION,
    "propensityScore" INTEGER,
    "intentScore" INTEGER,
    "cartValue" DOUBLE PRECISION,
    "deviceType" TEXT,
    "trafficSource" TEXT,
    "segment" TEXT NOT NULL DEFAULT 'all',
    "scoreBucket" TEXT NOT NULL,
    "aiDecisionId" TEXT,
    "impressionId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterventionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterventionThreshold" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "scoreBucket" TEXT NOT NULL,
    "segment" TEXT NOT NULL DEFAULT 'all',
    "showImpressions" INTEGER NOT NULL DEFAULT 0,
    "showConversions" INTEGER NOT NULL DEFAULT 0,
    "showRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "showProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "skipImpressions" INTEGER NOT NULL DEFAULT 0,
    "skipConversions" INTEGER NOT NULL DEFAULT 0,
    "skipRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "skipProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shouldShow" BOOLEAN NOT NULL DEFAULT true,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "lastUpdated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterventionThreshold_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "lastThresholdUpdate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "InterventionOutcome_shopId_scoreBucket_wasShown_idx" ON "InterventionOutcome"("shopId", "scoreBucket", "wasShown");

-- CreateIndex
CREATE INDEX "InterventionOutcome_shopId_timestamp_idx" ON "InterventionOutcome"("shopId", "timestamp");

-- CreateIndex
CREATE INDEX "InterventionOutcome_shopId_wasShown_converted_idx" ON "InterventionOutcome"("shopId", "wasShown", "converted");

-- CreateIndex
CREATE UNIQUE INDEX "InterventionThreshold_shopId_scoreBucket_segment_key" ON "InterventionThreshold"("shopId", "scoreBucket", "segment");

-- CreateIndex
CREATE INDEX "InterventionThreshold_shopId_segment_idx" ON "InterventionThreshold"("shopId", "segment");

-- AddForeignKey
ALTER TABLE "InterventionOutcome" ADD CONSTRAINT "InterventionOutcome_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterventionThreshold" ADD CONSTRAINT "InterventionThreshold_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
