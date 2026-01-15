-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyDomain" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'manual',
    "plan" TEXT NOT NULL DEFAULT 'pro',
    "aiGoal" TEXT NOT NULL DEFAULT 'revenue',
    "aggression" INTEGER NOT NULL DEFAULT 5,
    "budgetEnabled" BOOLEAN NOT NULL DEFAULT false,
    "budgetAmount" REAL NOT NULL DEFAULT 500,
    "budgetPeriod" TEXT NOT NULL DEFAULT 'month',
    "budgetStartDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "copyVariants" TEXT DEFAULT '{"variants":[],"segmentBestVariants":{}}',
    "lastVariantUpdate" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "contributeToMetaLearning" BOOLEAN NOT NULL DEFAULT true,
    "lastEvolutionCycle" DATETIME,
    "mutationRate" INTEGER NOT NULL DEFAULT 15,
    "crossoverRate" INTEGER NOT NULL DEFAULT 70,
    "selectionPressure" INTEGER NOT NULL DEFAULT 5,
    "populationSize" INTEGER NOT NULL DEFAULT 10,
    "brandPrimaryColor" TEXT DEFAULT '#000000',
    "brandSecondaryColor" TEXT DEFAULT '#ffffff',
    "brandAccentColor" TEXT DEFAULT '#f59e0b',
    "brandFont" TEXT DEFAULT 'system',
    "brandLogoUrl" TEXT,
    "customCSS" TEXT,
    "exitIntentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "timeDelayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "timeDelaySeconds" INTEGER NOT NULL DEFAULT 30,
    "cartValueEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cartValueMin" REAL NOT NULL DEFAULT 0,
    "cartValueMax" REAL NOT NULL DEFAULT 999999
);
INSERT INTO "new_Shop" ("aggression", "aiGoal", "brandAccentColor", "brandFont", "brandLogoUrl", "brandPrimaryColor", "brandSecondaryColor", "budgetAmount", "budgetEnabled", "budgetPeriod", "budgetStartDate", "cartValueEnabled", "cartValueMax", "cartValueMin", "contributeToMetaLearning", "copyVariants", "createdAt", "crossoverRate", "customCSS", "exitIntentEnabled", "id", "lastEvolutionCycle", "lastVariantUpdate", "mode", "mutationRate", "plan", "populationSize", "selectionPressure", "shopifyDomain", "timeDelayEnabled", "timeDelaySeconds", "updatedAt") SELECT "aggression", "aiGoal", "brandAccentColor", "brandFont", "brandLogoUrl", "brandPrimaryColor", "brandSecondaryColor", "budgetAmount", "budgetEnabled", "budgetPeriod", "budgetStartDate", "cartValueEnabled", "cartValueMax", "cartValueMin", "contributeToMetaLearning", "copyVariants", "createdAt", "crossoverRate", "customCSS", "exitIntentEnabled", "id", "lastEvolutionCycle", "lastVariantUpdate", "mode", "mutationRate", "plan", "populationSize", "selectionPressure", "shopifyDomain", "timeDelayEnabled", "timeDelaySeconds", "updatedAt" FROM "Shop";
DROP TABLE "Shop";
ALTER TABLE "new_Shop" RENAME TO "Shop";
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
