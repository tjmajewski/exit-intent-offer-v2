-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "ctaButton" TEXT DEFAULT 'Complete My Order';
ALTER TABLE "Shop" ADD COLUMN "modalBody" TEXT DEFAULT 'Complete your purchase now and get an exclusive discount!';
ALTER TABLE "Shop" ADD COLUMN "modalHeadline" TEXT DEFAULT 'Wait! Don''t leave yet 🎁';
ALTER TABLE "Shop" ADD COLUMN "redirectDestination" TEXT DEFAULT 'checkout';
