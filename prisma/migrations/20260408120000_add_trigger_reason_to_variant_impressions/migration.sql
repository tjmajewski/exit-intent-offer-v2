-- AlterTable: Add triggerReason to VariantImpression for per-trigger variant evolution
ALTER TABLE "VariantImpression" ADD COLUMN "triggerReason" TEXT;

-- CreateIndex
CREATE INDEX "VariantImpression_shopId_triggerReason_idx" ON "VariantImpression"("shopId", "triggerReason");
