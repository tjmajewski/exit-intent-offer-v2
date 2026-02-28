-- AddColumn (converted from SQLite RedefineTables)
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'pro';
