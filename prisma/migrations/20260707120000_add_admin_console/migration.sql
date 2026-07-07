-- Super admin console: audit trail for admin writes + global time indexes
-- so the cross-shop AI dashboard can bucket by date without shop-scoped scans.

CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "shopId" TEXT,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdminAuditLog_shopId_createdAt_idx" ON "AdminAuditLog"("shopId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

CREATE INDEX IF NOT EXISTS "VariantImpression_timestamp_idx" ON "VariantImpression"("timestamp");
CREATE INDEX IF NOT EXISTS "InterventionOutcome_timestamp_idx" ON "InterventionOutcome"("timestamp");
