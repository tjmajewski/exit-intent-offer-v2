-- AlterTable
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "ctaButton" TEXT DEFAULT 'Complete My Order';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "modalBody" TEXT DEFAULT 'Complete your purchase now and get an exclusive discount!';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "modalHeadline" TEXT DEFAULT 'Wait! Don''t leave yet 🎁';
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "redirectDestination" TEXT DEFAULT 'checkout';
