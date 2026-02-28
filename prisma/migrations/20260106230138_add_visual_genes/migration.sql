-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Variant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "baseline" TEXT NOT NULL,
    "segment" TEXT NOT NULL DEFAULT 'all',
    "status" TEXT NOT NULL DEFAULT 'alive',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "parents" TEXT,
    "offerAmount" INTEGER NOT NULL,
    "headline" TEXT NOT NULL,
    "subhead" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "redirect" TEXT NOT NULL,
    "urgency" BOOLEAN NOT NULL,
    "colorScheme" TEXT NOT NULL DEFAULT 'classic',
    "layout" TEXT NOT NULL DEFAULT 'centered',
    "buttonStyle" TEXT NOT NULL DEFAULT 'solid',
    "animation" TEXT NOT NULL DEFAULT 'fade',
    "typography" TEXT NOT NULL DEFAULT 'modern',
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "revenue" REAL NOT NULL DEFAULT 0,
    "profitPerImpression" REAL NOT NULL DEFAULT 0,
    "birthDate" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deathDate" TIMESTAMP,
    "championDate" TIMESTAMP,
    CONSTRAINT "Variant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Variant" ("baseline", "birthDate", "championDate", "clicks", "conversions", "cta", "deathDate", "generation", "headline", "id", "impressions", "offerAmount", "parents", "profitPerImpression", "redirect", "revenue", "segment", "shopId", "status", "subhead", "urgency", "variantId") SELECT "baseline", "birthDate", "championDate", "clicks", "conversions", "cta", "deathDate", "generation", "headline", "id", "impressions", "offerAmount", "parents", "profitPerImpression", "redirect", "revenue", "segment", "shopId", "status", "subhead", "urgency", "variantId" FROM "Variant";
DROP TABLE "Variant";
ALTER TABLE "new_Variant" RENAME TO "Variant";
CREATE UNIQUE INDEX "Variant_variantId_key" ON "Variant"("variantId");
CREATE INDEX "Variant_shopId_status_idx" ON "Variant"("shopId", "status");
CREATE INDEX "Variant_shopId_baseline_segment_idx" ON "Variant"("shopId", "baseline", "segment");
CREATE INDEX "Variant_status_profitPerImpression_idx" ON "Variant"("status", "profitPerImpression");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
