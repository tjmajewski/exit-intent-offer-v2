-- AlterTable
ALTER TABLE "VariantImpression" ADD COLUMN "duringPromo" BOOLEAN NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "VariantImpression_shopId_duringPromo_idx" ON "VariantImpression"("shopId", "duringPromo");
