-- AlterTable
ALTER TABLE "VariantImpression" ADD COLUMN IF NOT EXISTS "duringPromo" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VariantImpression_shopId_duringPromo_idx" ON "VariantImpression"("shopId", "duringPromo");
