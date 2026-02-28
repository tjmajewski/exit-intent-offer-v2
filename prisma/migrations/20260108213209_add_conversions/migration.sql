-- CreateTable
CREATE TABLE IF NOT EXISTS "Conversion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderValue" REAL NOT NULL,
    "customerEmail" TEXT,
    "orderedAt" TIMESTAMP NOT NULL,
    "modalId" TEXT NOT NULL,
    "modalName" TEXT,
    "variantId" TEXT,
    "modalHadDiscount" BOOLEAN NOT NULL DEFAULT false,
    "discountCode" TEXT,
    "discountRedeemed" BOOLEAN NOT NULL DEFAULT false,
    "discountAmount" REAL,
    "modalSnapshot" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Conversion_shopId_idx" ON "Conversion"("shopId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Conversion_orderedAt_idx" ON "Conversion"("orderedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Conversion_shopId_orderId_key" ON "Conversion"("shopId", "orderId");
