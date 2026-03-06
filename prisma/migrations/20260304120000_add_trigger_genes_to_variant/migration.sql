-- AlterTable
ALTER TABLE "Variant" ADD COLUMN "triggerType" TEXT NOT NULL DEFAULT 'exit_intent';
ALTER TABLE "Variant" ADD COLUMN "idleSeconds" INTEGER NOT NULL DEFAULT 30;
