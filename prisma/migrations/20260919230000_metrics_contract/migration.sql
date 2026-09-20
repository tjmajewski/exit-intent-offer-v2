-- HANDOFF-2026-09-19 §2.5 — the metrics contract.
--
-- Creates AttributedOrder: one row per attributed order, unique on the
-- Shopify order id, carrying subtotal/tax/shipping/currency and the reversal
-- fields M1 needs in order to be able to go DOWN.
--
-- NOTE: production does not run migrations (see section 2 below). This file
-- exists so migrate-managed environments stay in step; the table itself
-- reaches production via `prisma db push`, which is safe here because the
-- table is new and empty.

-- ---------------------------------------------------------------------------
-- 1. AttributedOrder
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AttributedOrder" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "arm" TEXT NOT NULL,
    "rendered" BOOLEAN NOT NULL DEFAULT false,
    "renderedAt" TIMESTAMP(3),
    "decisionAt" TIMESTAMP(3),
    "aiDecisionId" TEXT,
    "impressionId" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "totalTax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalShipping" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shopCurrency" TEXT,
    "presentmentCurrency" TEXT,
    "refundedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cancelledAt" TIMESTAMP(3),
    "testOrder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributedOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AttributedOrder_shopId_orderId_key"
    ON "AttributedOrder"("shopId", "orderId");
CREATE INDEX IF NOT EXISTS "AttributedOrder_shopId_orderedAt_idx"
    ON "AttributedOrder"("shopId", "orderedAt");
CREATE INDEX IF NOT EXISTS "AttributedOrder_shopId_arm_rendered_idx"
    ON "AttributedOrder"("shopId", "arm", "rendered");
CREATE INDEX IF NOT EXISTS "AttributedOrder_shopId_aiDecisionId_idx"
    ON "AttributedOrder"("shopId", "aiDecisionId");

DO $$
BEGIN
  ALTER TABLE "AttributedOrder"
    ADD CONSTRAINT "AttributedOrder_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. InterventionOutcome uniqueness — NOT HERE.
-- ---------------------------------------------------------------------------
-- The unique index on (shopId, aiDecisionId) that §2.1 left open is NOT in
-- this migration, and the dedupe repair that has to precede it is not either.
--
-- Production applies schema with `prisma db push` at container boot
-- (package.json `setup`, Dockerfile CMD `docker-start`); there is no
-- `release_command` in fly.toml and nothing runs `prisma migrate deploy`. So
-- these migration files do not execute in production at all, and a unique
-- index declared in schema.prisma would be issued by `db push` as a bare
-- CREATE UNIQUE INDEX against a table that still holds the §2.1 duplicate
-- pairs: 23505, `setup` exits non-zero, container never starts.
--
-- The repair lives in scripts/ops/repair-duplicate-outcomes.mjs, where an
-- operator runs it deliberately, reads the dry-run output, and can stop. The
-- index is added in its own change once that reports zero duplicate groups.
