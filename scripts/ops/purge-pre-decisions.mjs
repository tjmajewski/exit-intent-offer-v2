#!/usr/bin/env node
/**
 * Delete the AIDecision rows that were minted for shoppers who were never on
 * the site — the cart-webhook and idle-cart-pickup "pre-decisions".
 *
 *   node --env-file=.env scripts/ops/purge-pre-decisions.mjs           # dry run
 *   node --env-file=.env scripts/ops/purge-pre-decisions.mjs --apply   # execute
 *
 * WHY THESE ROWS CAN GO, AND WHY THAT IS NOT OBVIOUS
 * Deleting decision history normally destroys evidence. These rows are the
 * exception, on three counts checked before writing this script:
 *
 *   1. Nothing trains on them. The propensity calibrator (cron/calibrate-
 *      propensity.js) reaches decisions through InterventionOutcome.aiDecisionId.
 *      A pre-decision has no outcome row — no impression, no order, no visitor —
 *      so it was never in the training set to begin with.
 *   2. Nothing attributes to them. The order webhook's fuzzy fallback matches
 *      on `no_intervention` within 24h and is used for cosmetic signal fields
 *      only; it writes a conversion against an exact cart-stamped id or none.
 *      The InterventionThreshold bandit reads its counters and never bumps them
 *      from this path.
 *   3. Nothing displays them any more. The console filters both sources out.
 *
 * What they DO cost is the last-50 window on the customer page: at two rows per
 * cart edit they pushed real impressions off the screen entirely.
 *
 * The writers were removed on 2026-09-25 (webhooks.carts.update.jsx,
 * app/utils/idle-cart-pickup.server.js). This clears what they already wrote.
 * It is safe to re-run; after the first apply it finds nothing.
 *
 * NOT TRANSACTIONAL AND DOES NOT NEED TO BE. Nothing else writes these rows
 * now, and a delete of rows nothing references cannot tear a live read.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// Matches the JSON as JSON.stringify wrote it — no spaces around the colon.
// Kept as a literal rather than a parse because `decision` is a text column
// holding hundreds of thousands of rows: a LIKE scan is one pass in the
// database, a parse is one round trip per row.
const SOURCES = ['cart_webhook', 'idle_cart_pickup'];
const where = { OR: SOURCES.map((s) => ({ decision: { contains: `"source":"${s}"` } })) };

async function main() {
  const total = await db.aIDecision.count();
  const doomed = await db.aIDecision.count({ where });

  console.log(`AIDecision rows: ${total}`);
  for (const source of SOURCES) {
    const n = await db.aIDecision.count({
      where: { decision: { contains: `"source":"${source}"` } },
    });
    console.log(`  ${source}: ${n}`);
  }
  const share = total ? ((doomed / total) * 100).toFixed(1) : '0.0';
  console.log(`Pre-decisions to delete: ${doomed} (${share}% of the table)`);

  // A pre-decision with an outcome row would mean one of the three claims in
  // the header is wrong. Check rather than assume: if any exist, they are real
  // history and this script stops instead of deleting them.
  const ids = await db.aIDecision.findMany({ where, select: { id: true } });
  let linked = 0;
  for (let i = 0; i < ids.length; i += 500) {
    linked += await db.interventionOutcome.count({
      where: { aiDecisionId: { in: ids.slice(i, i + 500).map((r) => r.id) } },
    });
  }
  if (linked > 0) {
    console.error(`\nREFUSING: ${linked} of these decisions have InterventionOutcome rows.`);
    console.error('That contradicts the premise of this purge — investigate before deleting.');
    process.exitCode = 1;
    return;
  }
  console.log('Outcome rows linked to them: 0 — as expected.');

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to delete.');
    return;
  }

  const { count } = await db.aIDecision.deleteMany({ where });
  console.log(`\nDeleted ${count} pre-decisions. Remaining: ${await db.aIDecision.count()}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
