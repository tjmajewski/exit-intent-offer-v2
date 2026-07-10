-- CreateTable
CREATE TABLE "VisitorTouch" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "variantId" TEXT,
    "impressionId" TEXT,
    "aiDecisionId" TEXT,
    "offerType" TEXT,
    "offerAmount" DOUBLE PRECISION,
    "discountCode" TEXT,
    "triggerReason" TEXT,
    "propensityScore" INTEGER,
    "segmentKey" TEXT,
    "showNumber" INTEGER,
    "ignoreStreak" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitorTouch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitorTouch_shopId_visitorId_timestamp_idx" ON "VisitorTouch"("shopId", "visitorId", "timestamp");

-- CreateIndex
CREATE INDEX "VisitorTouch_shopId_timestamp_idx" ON "VisitorTouch"("shopId", "timestamp");

-- CreateIndex
CREATE INDEX "VisitorTouch_visitorId_timestamp_idx" ON "VisitorTouch"("visitorId", "timestamp");

-- CreateIndex
CREATE INDEX "VisitorTouch_impressionId_idx" ON "VisitorTouch"("impressionId");
