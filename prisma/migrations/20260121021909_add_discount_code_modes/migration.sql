-- AlterTable: Add discount code mode fields to Shop
ALTER TABLE "Shop" ADD COLUMN "discountCodeMode" TEXT NOT NULL DEFAULT 'unique';
ALTER TABLE "Shop" ADD COLUMN "genericDiscountCode" TEXT;
ALTER TABLE "Shop" ADD COLUMN "discountCodePrefix" TEXT DEFAULT 'EXIT';

-- AlterTable: Add mode field to DiscountOffer and make expiresAt nullable
ALTER TABLE "DiscountOffer" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'unique';

-- SQLite doesn't support altering column nullability directly, so we need to:
-- 1. Create new table with nullable expiresAt
-- 2. Copy data
-- 3. Drop old table
-- 4. Rename new table

CREATE TABLE "DiscountOffer_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "discountCode" TEXT NOT NULL,
    "offerType" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "cartValue" REAL,
    "mode" TEXT NOT NULL DEFAULT 'unique',
    "expiresAt" TIMESTAMP,
    "redeemed" BOOLEAN NOT NULL DEFAULT 0,
    "redeemedAt" TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscountOffer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy existing data
INSERT INTO "DiscountOffer_new" ("id", "shopId", "discountCode", "offerType", "amount", "cartValue", "expiresAt", "redeemed", "redeemedAt", "createdAt")
SELECT "id", "shopId", "discountCode", "offerType", "amount", "cartValue", "expiresAt", "redeemed", "redeemedAt", "createdAt"
FROM "DiscountOffer";

-- Drop old table
DROP TABLE "DiscountOffer";

-- Rename new table
ALTER TABLE "DiscountOffer_new" RENAME TO "DiscountOffer";

-- Recreate indexes
CREATE INDEX "DiscountOffer_shopId_expiresAt_idx" ON "DiscountOffer"("shopId", "expiresAt");
CREATE INDEX "DiscountOffer_shopId_redeemed_idx" ON "DiscountOffer"("shopId", "redeemed");
