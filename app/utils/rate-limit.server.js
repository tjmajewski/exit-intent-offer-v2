/**
 * Simple in-memory rate limiter for public app-proxy endpoints.
 *
 * Keyed by IP + route. Uses a fixed window with automatic cleanup.
 * Not distributed — fine for single-process deployments. For multi-instance
 * deployments, swap for a Redis-backed implementation.
 */

const buckets = new Map();

// Periodically drop expired buckets so the map doesn't grow unbounded.
const CLEANUP_INTERVAL_MS = 60_000;
let cleanupTimer = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't hold the event loop open just for cleanup.
  if (cleanupTimer.unref) cleanupTimer.unref();
}

/**
 * Extract the client IP from a Request, honoring the usual proxy headers.
 *
 * Order matters for spoof resistance. We deploy on Fly, whose edge sets
 * `Fly-Client-IP` to the real client and strips any client-supplied copy, so
 * it's the most trustworthy source. `X-Forwarded-For` is checked LAST because
 * a client can send their own value and rotate it per request to bypass the
 * per-IP limiter — we only fall back to its first hop when no
 * platform-controlled header is present.
 */
export function getClientIp(request) {
  const headers = request.headers;
  const trusted =
    headers.get("fly-client-ip") ||
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip");
  if (trusted) return trusted.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return "unknown";
}

/**
 * Check whether a request should be rate-limited.
 *
 * @param {string} key - unique bucket key (e.g. `${route}:${ip}`)
 * @param {object} opts
 * @param {number} opts.limit - max requests per window
 * @param {number} opts.windowMs - window length in ms
 * @returns {{ allowed: boolean, remaining: number, resetAt: number, retryAfter: number }}
 */
export function checkRateLimit(key, { limit, windowMs }) {
  startCleanup();
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs, retryAfter: 0 };
  }

  existing.count += 1;
  const remaining = Math.max(0, limit - existing.count);
  const allowed = existing.count <= limit;
  const retryAfter = allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000);
  return { allowed, remaining, resetAt: existing.resetAt, retryAfter };
}

/**
 * Convenience: enforce a rate limit on a Request and return a 429 Response
 * if exceeded, or `null` if the request may proceed.
 */
export function enforceRateLimit(request, routeKey, opts) {
  const ip = getClientIp(request);
  const result = checkRateLimit(`${routeKey}:${ip}`, opts);
  if (result.allowed) return null;
  return new Response(
    JSON.stringify({ error: "Too many requests" }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfter),
      },
    },
  );
}
