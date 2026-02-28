-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyDomain" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'manual',
    "aiGoal" TEXT NOT NULL DEFAULT 'revenue',
    "aggression" INTEGER NOT NULL DEFAULT 5,
    "budgetEnabled" BOOLEAN NOT NULL DEFAULT false,
    "budgetAmount" REAL NOT NULL DEFAULT 500,
    "budgetPeriod" TEXT NOT NULL DEFAULT 'month',
    "budgetStartDate" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "copyVariants" TEXT DEFAULT '{"variants":[],"segmentBestVariants":{}}',
    "lastVariantUpdate" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DiscountOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "discountCode" TEXT NOT NULL,
    "offerType" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "cartValue" REAL,
    "expiresAt" TIMESTAMP NOT NULL,
    "redeemed" BOOLEAN NOT NULL DEFAULT false,
    "redeemedAt" TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscountOffer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AIDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "signals" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "offerId" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIDecision_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE INDEX "DiscountOffer_shopId_expiresAt_idx" ON "DiscountOffer"("shopId", "expiresAt");

-- CreateIndex
CREATE INDEX "DiscountOffer_shopId_redeemed_idx" ON "DiscountOffer"("shopId", "redeemed");

-- CreateIndex
CREATE INDEX "AIDecision_shopId_createdAt_idx" ON "AIDecision"("shopId", "createdAt");
