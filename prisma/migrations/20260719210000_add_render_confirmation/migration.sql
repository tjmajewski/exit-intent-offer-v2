-- Two-phase render confirmation: decisions (and their impression/outcome rows)
-- are minted at prefetch, before any trigger fires. "rendered" marks that the
-- client confirmed the surface actually displayed. Backfill existing rows to
-- true so pre-change data keeps its prior semantics.
ALTER TABLE "VariantImpression" ADD COLUMN "rendered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InterventionOutcome" ADD COLUMN "rendered" BOOLEAN NOT NULL DEFAULT false;
UPDATE "VariantImpression" SET "rendered" = true;
UPDATE "InterventionOutcome" SET "rendered" = true;
