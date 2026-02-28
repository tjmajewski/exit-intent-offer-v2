-- AlterTable: Add discount code mode fields to Shop
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "discountCodeMode" TEXT NOT NULL DEFAULT 'unique';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "genericDiscountCode" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "discountCodePrefix" TEXT DEFAULT 'EXIT';

-- AlterTable: Add mode field to DiscountOffer
ALTER TABLE "DiscountOffer" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'unique';

-- AlterTable: Make expiresAt nullable (converted from SQLite table redefine)
ALTER TABLE "DiscountOffer" ALTER COLUMN "expiresAt" DROP NOT NULL;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS "DiscountOffer_shopId_expiresAt_idx" ON "DiscountOffer"("shopId", "expiresAt");
CREATE INDEX IF NOT EXISTS "DiscountOffer_shopId_redeemed_idx" ON "DiscountOffer"("shopId", "redeemed");
