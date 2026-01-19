-- Add promotional intelligence enabled field to Shop
ALTER TABLE Shop ADD COLUMN promotionalIntelligenceEnabled BOOLEAN NOT NULL DEFAULT 1;

-- Add seenByMerchant field to Promotion
ALTER TABLE Promotion ADD COLUMN seenByMerchant BOOLEAN NOT NULL DEFAULT 0;

-- Create index on Promotion for efficient queries
CREATE INDEX "Promotion_shopId_seenByMerchant_idx" ON "Promotion"("shopId", "seenByMerchant");
