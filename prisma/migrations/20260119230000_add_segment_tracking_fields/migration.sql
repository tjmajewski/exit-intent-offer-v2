-- AlterTable
ALTER TABLE "VariantImpression" ADD COLUMN "accountStatus" TEXT;

-- AlterTable
ALTER TABLE "VariantImpression" ADD COLUMN "visitFrequency" INTEGER;

-- CreateIndex
CREATE INDEX "VariantImpression_shopId_deviceType_idx" ON "VariantImpression"("shopId", "deviceType");

-- CreateIndex
CREATE INDEX "VariantImpression_shopId_accountStatus_idx" ON "VariantImpression"("shopId", "accountStatus");
