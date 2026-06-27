-- AlterTable
-- Idempotent: the column may already exist on DBs where it was added via
-- `prisma db push` before this migration ran. IF NOT EXISTS makes re-apply safe.
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "disabledLayouts" TEXT NOT NULL DEFAULT '[]';
