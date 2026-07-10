-- CreateTable
CREATE TABLE "EvolutionCursor" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "baseline" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "lastCycleAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionCursor_shopId_baseline_segment_key" ON "EvolutionCursor"("shopId", "baseline", "segment");
