// Health endpoint for Fly health checks + Sentry alerting.
//
// Returns 200 only when:
//   1. Database is reachable.
//   2. If any AI-mode shop has had a VariantImpression in the last 24h
//      (i.e. there's real traffic), the newest Variant.birthDate across
//      AI-mode shops must be < 2h old. Older = evolution cron has stalled.
//
// On failure, throws so Sentry captures the error, AND returns 500 so Fly
// restarts the machine.

const FRESHNESS_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const TRAFFIC_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function loader() {
  const { default: db } = await import("../db.server.js");

  const checks = {
    db: "unknown",
    cronFreshness: "unknown",
  };

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
    where: { createdAt: { gte: trafficSince } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
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
      const error = new Error(
        `[health] Evolution cron stalled — newest Variant.birthDate is ${Math.round(ageMs / 60000)}m old (max ${FRESHNESS_MAX_AGE_MS / 60000}m). Traffic exists (impression at ${recentImpression.createdAt.toISOString()}).`
      );
      console.error(error);
      throw error;
    }

    checks.cronFreshness = `ok (${Math.round(ageMs / 60000)}m old)`;
  }

  return new Response(
    JSON.stringify({ status: "ok", checks, timestamp: new Date().toISOString() }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
