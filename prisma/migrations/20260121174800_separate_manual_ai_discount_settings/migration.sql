-- AlterTable: Add separate discount code settings for Manual and AI modes
ALTER TABLE Shop ADD COLUMN manualDiscountCodeMode TEXT NOT NULL DEFAULT 'unique';
ALTER TABLE Shop ADD COLUMN manualGenericDiscountCode TEXT;
ALTER TABLE Shop ADD COLUMN manualDiscountCodePrefix TEXT DEFAULT 'EXIT';
ALTER TABLE Shop ADD COLUMN aiDiscountCodeMode TEXT NOT NULL DEFAULT 'unique';
ALTER TABLE Shop ADD COLUMN aiGenericDiscountCode TEXT;
ALTER TABLE Shop ADD COLUMN aiDiscountCodePrefix TEXT DEFAULT 'EXIT';

-- Migrate existing data from shared fields to mode-specific fields
-- Copy existing settings to both Manual and AI (they start the same, but will diverge)
UPDATE Shop SET
  manualDiscountCodeMode = COALESCE(discountCodeMode, 'unique'),
  manualGenericDiscountCode = genericDiscountCode,
  manualDiscountCodePrefix = COALESCE(discountCodePrefix, 'EXIT'),
  aiDiscountCodeMode = COALESCE(discountCodeMode, 'unique'),
  aiGenericDiscountCode = genericDiscountCode,
  aiDiscountCodePrefix = COALESCE(discountCodePrefix, 'EXIT')
WHERE TRUE;
