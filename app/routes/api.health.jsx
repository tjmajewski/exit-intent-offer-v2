// Health endpoint for Fly health checks + Sentry alerting.
//
// Hard fail (throws -> 500, Fly pulls the machine out of the load balancer):
//   1. Database unreachable. The app genuinely cannot serve traffic.
//
// Soft fail (200 with status "degraded", logged for Sentry):
//   2. Evolution cron stalled: newest Variant.birthDate across AI-mode shops
//      is > 2h old while traffic exists. That is a data-pipeline problem, not
//      a liveness problem. The web process is fine and must keep serving.
//      Failing hard here 503'd the entire app.

const FRESHNESS_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const TRAFFIC_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function loader() {
  const { default: db } = await import("../db.server.js");

  const checks = {
    db: "unknown",
    cronFreshness: "unknown",
  };
  let degraded = false;

  // 1. DB reachable
  try {
    await db.shop.count();
    checks.db = "ok";
  } catch (err) {
    checks.db = `fail: ${err.message}`;
    const error = new Error(`[health] DB unreachable: ${err.message}`);
    console.error(error);
    throw error;
  }

  // 2. Cron freshness — only meaningful if there's recent traffic
  const trafficSince = new Date(Date.now() - TRAFFIC_LOOKBACK_MS);
  const recentImpression = await db.variantImpression.findFirst({
    where: { timestamp: { gte: trafficSince } },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });

  if (!recentImpression) {
    checks.cronFreshness = "skipped (no traffic in 24h)";
  } else {
    const newestVariant = await db.variant.findFirst({
      where: {
        shop: { mode: "ai", plan: { in: ["pro", "enterprise"] } },
      },
      orderBy: { birthDate: "desc" },
      select: { birthDate: true },
    });

    const ageMs = newestVariant
      ? Date.now() - newestVariant.birthDate.getTime()
      : Infinity;

    if (ageMs > FRESHNESS_MAX_AGE_MS) {
      checks.cronFreshness = `stale (${Math.round(ageMs / 60000)}m old)`;
      degraded = true;
      // Log only. Do NOT throw: a stalled cron must not de-route the machine.
      console.error(
        new Error(
          `[health] Evolution cron stalled — newest Variant.birthDate is ${Math.round(ageMs / 60000)}m old (max ${FRESHNESS_MAX_AGE_MS / 60000}m). Traffic exists (impression at ${recentImpression.timestamp.toISOString()}).`
        )
      );
    } else {
      checks.cronFreshness = `ok (${Math.round(ageMs / 60000)}m old)`;
    }
  }

  return new Response(
    JSON.stringify({
      status: degraded ? "degraded" : "ok",
      checks,
      timestamp: new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
