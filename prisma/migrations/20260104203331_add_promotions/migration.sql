-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "type" TEXT NOT NULL,
    "detectedVia" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'monitoring',
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "usageStats" TEXT NOT NULL DEFAULT '{"total":0,"last24h":0}',
    "classification" TEXT,
    "aiStrategy" TEXT,
    "aiStrategyReason" TEXT,
    "merchantOverride" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Promotion_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Promotion_shopId_status_idx" ON "Promotion"("shopId", "status");

-- CreateIndex
CREATE INDEX "Promotion_shopId_code_idx" ON "Promotion"("shopId", "code");

-- CreateIndex
CREATE INDEX "Promotion_detectedAt_idx" ON "Promotion"("detectedAt");
