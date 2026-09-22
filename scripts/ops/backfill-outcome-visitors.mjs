#!/usr/bin/env node
/**
 * Backfill InterventionOutcome.visitorId from the decision that produced it.
 *
 * The column was added 2026-09-22 so the dashboard could count DISTINCT
 * customers per arm instead of rows. Rows written before that carry null and
 * are invisible to both arm tiles — which would silently truncate a shop's
 * history the day the tiles ship.
 *
 * visitorId already exists on every one of those rows, one join away:
 * AIDecision.signals is the JSON the storefront posted, and it carries
 * visitorId. VisitorTouch is the fallback for outcomes whose decision row is
 * gone or whose signals failed to parse.
 *
 * Read-only unless --apply. Run on the container, never with a local .env.
 *
 *   flyctl ssh console -a resparq -C 'node scripts/ops/backfill-outcome-visitors.mjs'
 *   flyctl ssh console -a resparq -C 'node scripts/ops/backfill-outcome-visitors.mjs --apply'
 *   flyctl ssh console -a resparq -C 'node scripts/ops/backfill-outcome-visitors.mjs <shop> --apply'
 */
import db from '../../app/db.server.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const domain = args.find(a => !a.startsWith('--')) || null;

async function main() {
  let shopFilter = {};
  if (domain) {
    const shop = await db.shop.findUnique({ where: { shopifyDomain: domain } });
    if (!shop) {
      console.error(`No shop for ${domain}`);
      process.exitCode = 1;
      return;
    }
    shopFilter = { shopId: shop.id };
    console.log(`Scoped to ${domain} (${shop.id})`);
  } else {
    console.log('Scoped to ALL shops');
  }

  const total = await db.interventionOutcome.count({
    where: { ...shopFilter, visitorId: null }
  });
  console.log(`InterventionOutcome rows with a null visitorId: ${total}`);
  if (total === 0) {
    console.log('Nothing to do.');
    return;
  }

  const stats = { fromSignals: 0, fromTouch: 0, unresolved: 0, written: 0 };
  // Decision ids whose visitor came from the journey log rather than signals,
  // so the per-row tally below attributes each row to the right source.
  const fromTouchIds = new Set();
  const PAGE = 500;
  let cursor = null;

  for (;;) {
    const batch = await db.interventionOutcome.findMany({
      where: { ...shopFilter, visitorId: null },
      select: { id: true, shopId: true, aiDecisionId: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    // Resolve the whole page in two lookups rather than one to three per
    // row. Row-at-a-time was fine for the 60 rows on the first live store and
    // would be hours of serial round trips once the platform has real volume.
    const decisionIds = [...new Set(batch.map(r => r.aiDecisionId).filter(Boolean))];

    const decisions = decisionIds.length
      ? await db.aIDecision.findMany({
          where: { id: { in: decisionIds } },
          select: { id: true, signals: true }
        })
      : [];
    const visitorByDecision = new Map();
    for (const d of decisions) {
      if (!d.signals) continue;
      try {
        const parsed = JSON.parse(d.signals);
        if (typeof parsed?.visitorId === 'string' && parsed.visitorId.length > 0) {
          visitorByDecision.set(d.id, parsed.visitorId);
        }
      } catch {
        // Malformed signals blob — the journey-log fallback below covers it.
      }
    }

    // Fallback only for the decisions signals could not answer for: the
    // journey log recorded the same decision against a visitor even when the
    // decision row is gone or its blob is unusable.
    const unresolvedIds = decisionIds.filter(id => !visitorByDecision.has(id));
    if (unresolvedIds.length) {
      const touches = await db.visitorTouch.findMany({
        where: { aiDecisionId: { in: unresolvedIds } },
        select: { aiDecisionId: true, visitorId: true }
      });
      for (const t of touches) {
        if (t.visitorId && !visitorByDecision.has(t.aiDecisionId)) {
          visitorByDecision.set(t.aiDecisionId, t.visitorId);
          fromTouchIds.add(t.aiDecisionId);
        }
      }
    }

    // Group by the value being written so the page costs one updateMany per
    // distinct visitor instead of one update per row.
    const idsByVisitor = new Map();
    for (const row of batch) {
      const visitorId = row.aiDecisionId ? visitorByDecision.get(row.aiDecisionId) : null;
      if (!visitorId) {
        // Genuinely unattributable: a cached storefront script posted no
        // visitorId. Left null on purpose — both arm tiles exclude nulls, so
        // a guess here would put a fabricated customer into one of the arms.
        stats.unresolved++;
        continue;
      }
      if (fromTouchIds.has(row.aiDecisionId)) stats.fromTouch++;
      else stats.fromSignals++;
      if (!idsByVisitor.has(visitorId)) idsByVisitor.set(visitorId, []);
      idsByVisitor.get(visitorId).push(row.id);
      stats.written++;
    }

    if (apply) {
      for (const [visitorId, ids] of idsByVisitor) {
        await db.interventionOutcome.updateMany({
          where: { id: { in: ids } },
          data: { visitorId }
        });
      }
    }

    console.log(`  ...scanned through ${cursor}`);
  }

  console.log('');
  console.log(`resolved from AIDecision.signals : ${stats.fromSignals}`);
  console.log(`resolved from VisitorTouch       : ${stats.fromTouch}`);
  console.log(`unresolved (left null)           : ${stats.unresolved}`);
  console.log(`${apply ? 'WRITTEN' : 'would write'}                     : ${stats.written}`);
  if (!apply) console.log('\nDry run. Re-run with --apply to write.');
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
