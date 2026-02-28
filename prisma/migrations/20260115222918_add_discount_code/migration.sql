-- AddColumns (converted from SQLite RedefineTables)
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "discountCode" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "discountEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "offerType" TEXT DEFAULT 'percentage';
