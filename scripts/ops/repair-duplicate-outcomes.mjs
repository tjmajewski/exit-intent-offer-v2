#!/usr/bin/env node
/**
 * Repair the duplicate InterventionOutcome rows written by the §2.1 bug, then
 * rebuild the InterventionThreshold counters that bug corrupted.
 *
 *   node --env-file=.env scripts/ops/repair-duplicate-outcomes.mjs           # dry run
 *   node --env-file=.env scripts/ops/repair-duplicate-outcomes.mjs --apply   # execute
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION
 * Production applies schema with `prisma db push` at container boot
 * (package.json `setup`, Dockerfile CMD). Nothing runs `prisma migrate deploy`,
 * so a repair placed in prisma/migrations/ would never execute — and a unique
 * index declared in schema.prisma would be issued by `db push` against a table
 * that still holds the duplicates, fail with 23505, and boot-loop the
 * container. An operator runs this, reads the output, and decides.
 *
 * WHAT THE §2.1 BUG DID (fixed in 89b4132)
 * The order webhook CREATED a second InterventionOutcome on conversion for the
 * holdout and skip paths instead of updating the row minted at decision time.
 * Two consequences, and this script fixes both:
 *
 *   1. Duplicate rows. getIncrementality computed c/(n+c) instead of c/n, so
 *      holdout/skip CVR read low and reported lift read high.
 *   2. Double-bumped counters. The second row went through
 *      recordInterventionOutcome with pendingRender:false, so it bumped
 *      skipImpressions AND skipConversions while the decision-time row had
 *      already bumped skipImpressions. skipImpressions is over-counted by
 *      roughly the number of skip conversions, which deflates skipCVR and
 *      biases the live sampler toward SHOWING.
 *
 * Repairing (1) without (2) is worse than doing neither: the evidence table
 * and the state table would disagree, and the sampler would stay biased with
 * nothing left to explain why. They run together or not at all.
 *
 * NOT TRANSACTIONAL ACROSS THE WHOLE RUN. The decision endpoint writes to both
 * tables continuously. The counter rebuild is a single pass and any decision
 * landing during it is counted on one side only; the window is seconds and
 * self-corrects as traffic continues. Run it at low traffic anyway.
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function say(...args) { console.log(...args); }

async function findDuplicateGroups() {
  // Groups of >1 outcome row sharing a (shopId, aiDecisionId). NULL decision
  // ids are legacy pre-id rows and are left alone — they are indistinguishable
  // from each other and merging them would invent attribution.
  return db.$queryRawUnsafe(`
    SELECT "shopId", "aiDecisionId", COUNT(*)::int AS row_count
    FROM "InterventionOutcome"
    WHERE "aiDecisionId" IS NOT NULL
    GROUP BY "shopId", "aiDecisionId"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `);
}

async function dedupe() {
  // Keeper = earliest row in the group (the decision-time row). Conversion
  // data is folded onto it from whichever row in the group carries it.
  //
  // `rendered` is deliberately NOT merged with bool_or. The duplicate was
  // created by recordInterventionOutcome with pendingRender defaulting false,
  // i.e. rendered:true unconditionally — merging it would manufacture render
  // evidence for a modal that was never displayed, during a repair whose whole
  // point is that the numbers stopped being invented.
  const folded = await db.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT "id", "shopId", "aiDecisionId",
             ROW_NUMBER() OVER (PARTITION BY "shopId", "aiDecisionId"
                                ORDER BY "timestamp" ASC, "id" ASC) AS rn,
             COUNT(*) OVER (PARTITION BY "shopId", "aiDecisionId") AS grp_size
      FROM "InterventionOutcome"
      WHERE "aiDecisionId" IS NOT NULL
    ),
    keepers AS (
      SELECT "id" AS keeper_id, "shopId", "aiDecisionId"
      FROM ranked WHERE rn = 1 AND grp_size > 1
    ),
    merged AS (
      SELECT k.keeper_id,
             bool_or(io."converted")                                AS any_converted,
             MAX(io."revenue")        FILTER (WHERE io."converted") AS revenue,
             MAX(io."discountAmount") FILTER (WHERE io."converted") AS discount_amount,
             MAX(io."impressionId")                                 AS impression_id
      FROM keepers k
      JOIN "InterventionOutcome" io
        ON io."shopId" = k."shopId" AND io."aiDecisionId" = k."aiDecisionId"
      GROUP BY k.keeper_id
    )
    UPDATE "InterventionOutcome" io
    SET "converted"      = m.any_converted,
        "revenue"        = COALESCE(m.revenue, io."revenue"),
        "discountAmount" = COALESCE(m.discount_amount, io."discountAmount"),
        -- Derived, never taken from a sibling row: picking revenue from one
        -- row and profit from another leaves a keeper where
        -- profit != revenue - discount.
        "profit"         = CASE
                             WHEN m.any_converted AND m.revenue IS NOT NULL
                               THEN m.revenue - COALESCE(m.discount_amount, 0)
                             ELSE io."profit"
                           END,
        "impressionId"   = COALESCE(io."impressionId", m.impression_id)
    FROM merged m
    WHERE io."id" = m.keeper_id
  `);

  const deleted = await db.$executeRawUnsafe(`
    DELETE FROM "InterventionOutcome" io
    USING (
      SELECT "id",
             ROW_NUMBER() OVER (PARTITION BY "shopId", "aiDecisionId"
                                ORDER BY "timestamp" ASC, "id" ASC) AS rn
      FROM "InterventionOutcome"
      WHERE "aiDecisionId" IS NOT NULL
    ) ranked
    WHERE io."id" = ranked."id" AND ranked.rn > 1
  `);

  return { folded, deleted };
}

/**
 * Rebuild InterventionThreshold counters from the repaired outcome rows.
 *
 * The per-column semantics have to match how the counters are MAINTAINED, not
 * a naive count of each arm:
 *
 *   showImpressions   wasShown AND rendered AND NOT holdout
 *                     (confirmInterventionRender only bumps on rendered)
 *   showConversions   the same set AND converted — the rendered filter must
 *                     stay, or a converted-but-never-rendered row rebuilds
 *                     CVR > 100% straight back into the table
 *   skipImpressions   NOT wasShown AND NOT holdout   (bumped on every such row)
 *   skipConversions   the same set AND converted
 *   holdout rows      touch nothing, by design — they are a measurement
 *                     control, not a decision the engine made
 */
async function rebuildCounters() {
  return db.$executeRawUnsafe(`
    WITH agg AS (
      SELECT "shopId", "scoreBucket", "segment",
        COUNT(*) FILTER (WHERE "wasShown" AND "rendered" AND NOT "isHoldout")                   AS show_imp,
        COUNT(*) FILTER (WHERE "wasShown" AND "rendered" AND NOT "isHoldout" AND "converted")   AS show_conv,
        COALESCE(SUM("revenue") FILTER (WHERE "wasShown" AND "rendered" AND NOT "isHoldout" AND "converted"), 0) AS show_rev,
        COALESCE(SUM("profit")  FILTER (WHERE "wasShown" AND "rendered" AND NOT "isHoldout" AND "converted"), 0) AS show_profit,
        COUNT(*) FILTER (WHERE NOT "wasShown" AND NOT "isHoldout")                              AS skip_imp,
        COUNT(*) FILTER (WHERE NOT "wasShown" AND NOT "isHoldout" AND "converted")              AS skip_conv,
        COALESCE(SUM("revenue") FILTER (WHERE NOT "wasShown" AND NOT "isHoldout" AND "converted"), 0) AS skip_rev,
        COALESCE(SUM("profit")  FILTER (WHERE NOT "wasShown" AND NOT "isHoldout" AND "converted"), 0) AS skip_profit
      FROM "InterventionOutcome"
      GROUP BY "shopId", "scoreBucket", "segment"
    )
    -- UPDATE only: a threshold row whose outcome rows have all been deleted
    -- keeps stale counters rather than being zeroed. Deliberate — this script
    -- repairs a known double-count, and zeroing a bucket the repair did not
    -- touch would throw away learning it has no evidence against.
    UPDATE "InterventionThreshold" t
    SET "showImpressions" = agg.show_imp,
        "showConversions" = agg.show_conv,
        "showRevenue"     = agg.show_rev,
        "showProfit"      = agg.show_profit,
        "skipImpressions" = agg.skip_imp,
        "skipConversions" = agg.skip_conv,
        "skipRevenue"     = agg.skip_rev,
        "skipProfit"      = agg.skip_profit
    FROM agg
    WHERE t."shopId" = agg."shopId"
      AND t."scoreBucket" = agg."scoreBucket"
      AND t."segment" = agg."segment"
  `);
}

/** Counters that claim more conversions than impressions — the bug's signature. */
async function impossibleCounters() {
  return db.$queryRawUnsafe(`
    SELECT "shopId", "scoreBucket", "segment",
           "showImpressions", "showConversions", "skipImpressions", "skipConversions"
    FROM "InterventionThreshold"
    WHERE "showConversions" > "showImpressions" OR "skipConversions" > "skipImpressions"
  `);
}

async function main() {
  say(APPLY ? '=== REPAIR (APPLY) ===' : '=== REPAIR (DRY RUN — nothing will be written) ===');

  const groups = await findDuplicateGroups();
  const totalRows = groups.reduce((s, g) => s + g.row_count, 0);
  const excess = totalRows - groups.length;

  say(`\nDuplicate (shopId, aiDecisionId) groups : ${groups.length}`);
  say(`Rows in those groups                    : ${totalRows}`);
  say(`Rows that would be DELETED              : ${excess}`);
  if (groups.length > 0) {
    say('\nLargest groups:');
    for (const g of groups.slice(0, 10)) {
      say(`  shop=${g.shopId} decision=${g.aiDecisionId} rows=${g.row_count}`);
    }
  }

  const before = await impossibleCounters();
  say(`\nInterventionThreshold rows with conversions > impressions: ${before.length}`);
  for (const r of before.slice(0, 10)) {
    say(`  ${r.shopId} ${r.scoreBucket}/${r.segment} ` +
        `show ${r.showConversions}/${r.showImpressions} skip ${r.skipConversions}/${r.skipImpressions}`);
  }

  if (!APPLY) {
    say('\nDry run complete. Nothing was written.');
    say('Re-run with --apply to fold the duplicates and rebuild the counters.');
    say('Only add @@unique([shopId, aiDecisionId]) to schema.prisma once this');
    say('reports 0 duplicate groups — `prisma db push` runs at container boot');
    say('and a failed index build is a boot loop, not a failed migration.');
    return;
  }

  say('\nApplying...');
  const { folded, deleted } = await dedupe();
  say(`  conversion data folded onto keeper rows : ${folded}`);
  say(`  duplicate rows deleted                  : ${deleted}`);

  const rebuilt = await rebuildCounters();
  say(`  InterventionThreshold rows rebuilt      : ${rebuilt}`);

  const remaining = await findDuplicateGroups();
  const after = await impossibleCounters();
  say(`\nDuplicate groups remaining               : ${remaining.length}`);
  say(`Impossible counter rows remaining        : ${after.length}`);
  say(remaining.length === 0
    ? '\nClean. The unique index can now be added in its own change.'
    : '\nSTILL DIRTY — do not add the unique index. Investigate before deploying.');
}

main()
  .catch(err => { console.error('Repair failed:', err); process.exitCode = 1; })
  .finally(() => db.$disconnect());
