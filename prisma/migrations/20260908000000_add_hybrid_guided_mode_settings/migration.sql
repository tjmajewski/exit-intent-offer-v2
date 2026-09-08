-- AlterTable: Add Hybrid ("Guided") mode settings — merchant pins the offer, AI does the rest.
-- Additive only; defaults cover existing rows, no backfill needed.
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "hybridOfferType" TEXT NOT NULL DEFAULT 'percentage';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "hybridOfferAmount" DOUBLE PRECISION NOT NULL DEFAULT 15;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "hybridDiscountCodeMode" TEXT NOT NULL DEFAULT 'generic';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "hybridGenericDiscountCode" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "hybridDiscountCodePrefix" TEXT DEFAULT 'EXIT';
