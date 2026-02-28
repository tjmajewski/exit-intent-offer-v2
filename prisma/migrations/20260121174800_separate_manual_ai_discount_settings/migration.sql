-- AlterTable: Add separate discount code settings for Manual and AI modes
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "manualDiscountCodeMode" TEXT NOT NULL DEFAULT 'unique';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "manualGenericDiscountCode" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "manualDiscountCodePrefix" TEXT DEFAULT 'EXIT';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "aiDiscountCodeMode" TEXT NOT NULL DEFAULT 'unique';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "aiGenericDiscountCode" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "aiDiscountCodePrefix" TEXT DEFAULT 'EXIT';

-- Migrate existing data from shared fields to mode-specific fields
UPDATE "Shop" SET
  "manualDiscountCodeMode" = COALESCE("discountCodeMode", 'unique'),
  "manualGenericDiscountCode" = "genericDiscountCode",
  "manualDiscountCodePrefix" = COALESCE("discountCodePrefix", 'EXIT'),
  "aiDiscountCodeMode" = COALESCE("discountCodeMode", 'unique'),
  "aiGenericDiscountCode" = "genericDiscountCode",
  "aiDiscountCodePrefix" = COALESCE("discountCodePrefix", 'EXIT')
WHERE TRUE;
