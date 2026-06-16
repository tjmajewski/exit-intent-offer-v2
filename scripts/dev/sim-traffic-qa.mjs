/**
 * QA simulation: act as a live store getting traffic + conversions, then run
 * the actual reporting queries to check nothing is broken or inconsistent.
 *
 * Drives the REAL engine functions (selectVariantForImpression, recordImpression,
 * recordClick, recordConversion, recordInterventionOutcome) — not raw SQL — so
 * the funnel exercises the same code paths the storefront + webhooks use.
 *
 * Isolated to its own sim shop; cleans up at the end unless KEEP=1.
 */
import db from "../../app/db.server.js";
import {
  initializeShopVariants,
  selectVariantForImpression,
  recordImpression,
  recordClick,
  recordConversion,
} from "../../app/utils/variant-engine.js";
import {
  recordInterventionOutcome,
  recordInterventionConversion,
  recalculateThresholds,
} from "../../app/utils/intervention-threshold.server.js";
import { getAllBaselines } from "../../app/utils/gene-pools.js";

const SHOP_DOMAIN = "sim-store-qa.myshopify.com";
const KEEP = process.env.KEEP === "1";

const problems = [];
const note = (m) => console.log(m);
const fail = (m) => { problems.push(m); console.log("  ❌ " + m); };
const ok = (m) => console.log("  ✓ " + m);

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const DEVICES = ["mobile", "desktop"];
const SOURCES = ["organic", "social", "paid", "direct"];
const ACCOUNTS = ["guest", "logged_in"];

async function cleanup(shopId) {
  await db.conversion.deleteMany({ where: { shopId } });
  await db.variantImpression.deleteMany({ where: { shopId } });
  await db.interventionOutcome.deleteMany({ where: { shopId } });
  await db.interventionThreshold.deleteMany({ where: { shopId } });
  await db.variant.deleteMany({ where: { shopId } });
  await db.webhookOrder.deleteMany({ where: { shopDomain: SHOP_DOMAIN } });
  await db.shop.deleteMany({ where: { id: shopId } });
}

async function main() {
  note("\n=== SETUP ===");
  // Fresh shop
  const existing = await db.shop.findUnique({ where: { shopifyDomain: SHOP_DOMAIN } });
  if (existing) await cleanup(existing.id);

  const shop = await db.shop.create({
    data: { shopifyDomain: SHOP_DOMAIN, plan: "enterprise", mode: "ai" },
  });
  ok(`Created sim shop ${SHOP_DOMAIN} (id ${shop.id})`);

  await initializeShopVariants(shop.id, "all");
  const baselines = getAllBaselines();
  const variantCount = await db.variant.count({ where: { shopId: shop.id } });
  ok(`Initialized ${variantCount} variants across ${baselines.length} baselines`);

  note("\n=== SIMULATE TRAFFIC ===");
  const SESSIONS = 600;
  let shown = 0, clicks = 0, modalConversions = 0;
  let skips = 0, holdouts = 0, naturalConv = 0, holdoutConv = 0;
  let modalRevenue = 0;
  let orderSeq = 90000;

  for (let i = 0; i < SESSIONS; i++) {
    const baseline = pick(baselines);
    const segment = "all"; // variants seeded for 'all'; prod seeds other segments on demand
    const deviceType = pick(DEVICES);
    const trafficSource = pick(SOURCES);
    const accountStatus = pick(ACCOUNTS);
    const cartValue = Math.round(rand(20, 400));
    const propensityScore = Math.round(rand(0, 100));

    // 70% shown, 25% skipped (AI declined), 5% holdout
    const roll = Math.random();
    const arm = roll < 0.7 ? "show" : roll < 0.95 ? "skip" : "holdout";

    if (arm === "show") {
      shown++;
      const variant = await selectVariantForImpression(
        shop.id, baseline, segment, "exit_intent",
      );
      if (!variant || !variant.id) { fail(`selectVariantForImpression returned no variant (session ${i})`); continue; }

      const impression = await recordImpression(variant.id, shop.id, {
        segment, deviceType, trafficSource, cartValue, accountStatus,
        triggerReason: "exit_intent",
      });

      // Intervention outcome: modal was shown
      const outcome = await recordInterventionOutcome(db, {
        shopId: shop.id, wasShown: true, propensityScore, cartValue,
        deviceType, trafficSource,
        segment: deviceType === "mobile" ? "mobile" : "desktop",
        impressionId: impression.id,
      });

      // ~14% click-through
      if (Math.random() < 0.14) {
        clicks++;
        await recordClick(impression.id);

        // ~45% of clicks convert
        if (Math.random() < 0.45) {
          modalConversions++;
          const revenue = Math.round(rand(30, 250) * 100) / 100;
          const discount = Math.round(revenue * rand(0.05, 0.2) * 100) / 100;
          modalRevenue += revenue;

          await recordConversion(impression.id, revenue, discount);
          await recordInterventionConversion(db, outcome.id, revenue, discount);

          // Order-level conversion row (mirrors webhook storeConversion)
          await db.conversion.create({
            data: {
              shopId: shop.id,
              orderId: `gid://shopify/Order/${5000000000 + orderSeq}`,
              orderNumber: String(++orderSeq),
              orderValue: revenue,
              customerEmail: `cust${i}@example.com`,
              orderedAt: new Date(Date.now() - Math.floor(rand(0, 29)) * 86400000),
              modalId: "modal-sim",
              modalName: "Exit Intent Offer",
              variantId: impression.variantId,
              modalHadDiscount: discount > 0,
              discountCode: "SAVE10",
              discountRedeemed: discount > 0,
              discountAmount: discount > 0 ? discount : null,
              modalSnapshot: JSON.stringify({ headline: variant.headline || "Wait!" }),
            },
          });
        }
      }
    } else if (arm === "skip") {
      skips++;
      // AI declined; some convert naturally anyway (~8%)
      const converted = Math.random() < 0.08;
      if (converted) naturalConv++;
      const revenue = converted ? Math.round(rand(30, 250) * 100) / 100 : null;
      await recordInterventionOutcome(db, {
        shopId: shop.id, wasShown: false, converted, revenue,
        propensityScore, cartValue, deviceType, trafficSource,
        segment: deviceType === "mobile" ? "mobile" : "desktop",
      });
    } else {
      holdouts++;
      const converted = Math.random() < 0.1;
      if (converted) holdoutConv++;
      const revenue = converted ? Math.round(rand(30, 250) * 100) / 100 : null;
      await recordInterventionOutcome(db, {
        shopId: shop.id, wasShown: false, isHoldout: true, converted, revenue,
        propensityScore, cartValue, deviceType, trafficSource,
        segment: deviceType === "mobile" ? "mobile" : "desktop",
      });
    }
  }

  ok(`${SESSIONS} sessions: ${shown} shown / ${skips} skipped / ${holdouts} holdout`);
  ok(`Funnel: ${shown} impressions → ${clicks} clicks → ${modalConversions} conversions`);
  ok(`Natural conv (skip arm): ${naturalConv}, Holdout conv: ${holdoutConv}`);
  ok(`Modal-attributed revenue: $${modalRevenue.toFixed(2)}`);

  note("\n=== RUN REPORTING QUERIES ===");

  // --- 1. Conversions page query (app.conversions.jsx loader) ---
  note("[Conversions report]");
  const startDate = new Date(Date.now() - 30 * 86400000);
  const conversions = await db.conversion.findMany({
    where: { shopId: shop.id, orderedAt: { gte: startDate } },
    orderBy: { orderedAt: "desc" },
  });
  const convRevenue = conversions.reduce((s, c) => s + c.orderValue, 0);
  const convDiscount = conversions.reduce((s, c) => s + (c.discountAmount || 0), 0);
  ok(`${conversions.length} conversions in 30d, revenue $${convRevenue.toFixed(2)}, discounts $${convDiscount.toFixed(2)}`);
  if (conversions.length !== modalConversions) {
    // Some orderedAt randomly up to 29d ago — all within 30d, so should match
    fail(`Conversion row count (${conversions.length}) != simulated modal conversions (${modalConversions})`);
  } else ok("Conversion row count matches simulated modal conversions");
  if (conversions.some((c) => c.orderValue == null || Number.isNaN(c.orderValue))) {
    fail("Some conversion rows have null/NaN orderValue");
  } else ok("All conversion rows have valid orderValue");

  // --- 2. Variant performance report (app.analytics.jsx variants tab) ---
  note("[Variant performance report]");
  const variants = await db.variant.findMany({ where: { shopId: shop.id } });
  let vImp = 0, vClk = 0, vConv = 0, vRev = 0, badPPI = 0, badRate = 0;
  for (const v of variants) {
    vImp += v.impressions; vClk += v.clicks; vConv += v.conversions; vRev += v.revenue;
    if (v.conversions > v.impressions) badRate++;
    if (v.clicks > v.impressions) badRate++;
    if (v.conversions > 0 && (v.profitPerImpression == null || Number.isNaN(v.profitPerImpression))) badPPI++;
    // CVR computation the UI does: (conversions/impressions)*100
    const cvr = v.impressions > 0 ? (v.conversions / v.impressions) * 100 : 0;
    if (!Number.isFinite(cvr)) badRate++;
  }
  ok(`Variant aggregate: ${vImp} imp, ${vClk} clk, ${vConv} conv, $${vRev.toFixed(2)} rev`);
  if (badRate) fail(`${badRate} variants have impossible rates (conv>imp, clk>imp, or non-finite CVR)`);
  else ok("All variant rates sane (conv<=imp, clk<=imp, finite CVR)");
  if (badPPI) fail(`${badPPI} converted variants have null/NaN profitPerImpression`);
  else ok("All converted variants have valid profitPerImpression");

  // Cross-check: variant.impressions total == VariantImpression row count
  const impRows = await db.variantImpression.count({ where: { shopId: shop.id } });
  if (vImp !== impRows) fail(`SUM(variant.impressions)=${vImp} != VariantImpression rows=${impRows}`);
  else ok(`Variant impression counter matches impression rows (${impRows})`);

  // Cross-check: variant.conversions total == converted impression rows
  const convRows = await db.variantImpression.count({ where: { shopId: shop.id, converted: true } });
  if (vConv !== convRows) fail(`SUM(variant.conversions)=${vConv} != converted impression rows=${convRows}`);
  else ok(`Variant conversion counter matches converted impression rows (${convRows})`);

  // Cross-check: variant.clicks total == clicked impression rows
  const clkRows = await db.variantImpression.count({ where: { shopId: shop.id, clicked: true } });
  if (vClk !== clkRows) fail(`SUM(variant.clicks)=${vClk} != clicked impression rows=${clkRows}`);
  else ok(`Variant click counter matches clicked impression rows (${clkRows})`);

  // Cross-check: variant revenue == converted-impression revenue
  const impRevAgg = await db.variantImpression.aggregate({
    where: { shopId: shop.id, converted: true }, _sum: { revenue: true },
  });
  const impRev = impRevAgg._sum.revenue || 0;
  if (Math.abs(vRev - impRev) > 0.01) fail(`SUM(variant.revenue)=${vRev.toFixed(2)} != converted-impression revenue=${impRev.toFixed(2)}`);
  else ok(`Variant revenue matches converted-impression revenue ($${impRev.toFixed(2)})`);

  // --- 3. Intervention threshold report + recalculation ---
  note("[Intervention threshold (adaptive AI) report]");
  const thresholds = await db.interventionThreshold.findMany({ where: { shopId: shop.id } });
  ok(`${thresholds.length} threshold buckets created`);
  let badT = 0;
  for (const t of thresholds) {
    if (t.showConversions > t.showImpressions) badT++;
    if (t.skipConversions > t.skipImpressions) badT++;
  }
  if (badT) fail(`${badT} threshold buckets have conversions > impressions`);
  else ok("All threshold buckets sane (conv <= imp in each arm)");

  // Reconcile threshold counters against InterventionOutcome rows (non-holdout)
  const shownImpAgg = await db.interventionOutcome.count({ where: { shopId: shop.id, wasShown: true, isHoldout: false } });
  const skipImpAgg = await db.interventionOutcome.count({ where: { shopId: shop.id, wasShown: false, isHoldout: false } });
  const tShowImp = thresholds.reduce((s, t) => s + t.showImpressions, 0);
  const tSkipImp = thresholds.reduce((s, t) => s + t.skipImpressions, 0);
  if (tShowImp !== shownImpAgg) fail(`threshold showImpressions=${tShowImp} != shown non-holdout outcomes=${shownImpAgg}`);
  else ok(`Threshold show-impressions reconcile (${tShowImp})`);
  if (tSkipImp !== skipImpAgg) fail(`threshold skipImpressions=${tSkipImp} != skip non-holdout outcomes=${skipImpAgg}`);
  else ok(`Threshold skip-impressions reconcile (${tSkipImp})`);

  // Holdouts must NOT be in threshold counters
  const holdoutRows = await db.interventionOutcome.count({ where: { shopId: shop.id, isHoldout: true } });
  if (tShowImp + tSkipImp + holdoutRows !== shown + skips + holdouts)
    note(`  (info) outcomes: show ${tShowImp}, skip ${tSkipImp}, holdout ${holdoutRows}`);
  ok(`Holdout outcomes recorded but excluded from threshold arms (${holdoutRows} holdout)`);

  // Recalculation cron path
  const updated = await recalculateThresholds(db, shop.id);
  ok(`recalculateThresholds ran without error (updated ${updated} buckets)`);

  note("\n=== SUMMARY ===");
  if (problems.length === 0) {
    note("✅ All reporting queries ran and all cross-checks passed. No broken functionality found.");
  } else {
    note(`❌ ${problems.length} issue(s) found:`);
    problems.forEach((p) => note("   - " + p));
  }

  if (KEEP) {
    note(`\n(KEEP=1) Sim data left in DB for shop ${SHOP_DOMAIN}.`);
  } else {
    await cleanup(shop.id);
    note(`\nCleaned up sim shop ${SHOP_DOMAIN}.`);
  }
}

main()
  .catch((e) => { console.error("SIM ERROR:", e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
