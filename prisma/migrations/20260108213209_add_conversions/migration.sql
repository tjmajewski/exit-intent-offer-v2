-- CreateTable
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderValue" REAL NOT NULL,
    "customerEmail" TEXT,
    "orderedAt" DATETIME NOT NULL,
    "modalId" TEXT NOT NULL,
    "modalName" TEXT,
    "variantId" TEXT,
    "modalHadDiscount" BOOLEAN NOT NULL DEFAULT false,
    "discountCode" TEXT,
    "discountRedeemed" BOOLEAN NOT NULL DEFAULT false,
    "discountAmount" REAL,
    "modalSnapshot" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Conversion_shopId_idx" ON "Conversion"("shopId");

-- CreateIndex
CREATE INDEX "Conversion_orderedAt_idx" ON "Conversion"("orderedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversion_shopId_orderId_key" ON "Conversion"("shopId", "orderId");
