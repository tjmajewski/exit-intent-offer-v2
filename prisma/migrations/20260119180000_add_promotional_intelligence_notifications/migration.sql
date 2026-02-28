-- Add promotional intelligence enabled field to Shop
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "promotionalIntelligenceEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Add seenByMerchant field to Promotion
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "seenByMerchant" BOOLEAN NOT NULL DEFAULT false;

-- Create index on Promotion for efficient queries
CREATE INDEX IF NOT EXISTS "Promotion_shopId_seenByMerchant_idx" ON "Promotion"("shopId", "seenByMerchant");
