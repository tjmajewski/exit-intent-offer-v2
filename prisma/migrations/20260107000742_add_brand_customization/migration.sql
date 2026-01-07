-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "brandAccentColor" TEXT DEFAULT '#f59e0b';
ALTER TABLE "Shop" ADD COLUMN "brandFont" TEXT DEFAULT 'system';
ALTER TABLE "Shop" ADD COLUMN "brandLogoUrl" TEXT;
ALTER TABLE "Shop" ADD COLUMN "brandPrimaryColor" TEXT DEFAULT '#000000';
ALTER TABLE "Shop" ADD COLUMN "brandSecondaryColor" TEXT DEFAULT '#ffffff';
ALTER TABLE "Shop" ADD COLUMN "customCSS" TEXT;
