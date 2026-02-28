-- AlterTable
ALTER TABLE "VariantImpression" ADD COLUMN IF NOT EXISTS "accountStatus" TEXT;

-- AlterTable
ALTER TABLE "VariantImpression" ADD COLUMN IF NOT EXISTS "visitFrequency" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VariantImpression_shopId_deviceType_idx" ON "VariantImpression"("shopId", "deviceType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VariantImpression_shopId_accountStatus_idx" ON "VariantImpression"("shopId", "accountStatus");
