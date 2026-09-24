/**
 * Simple in-memory rate limiter for public app-proxy endpoints.
 *
 * Fixed window with automatic cleanup. Not distributed — fine for
 * single-process deployments. For multi-instance deployments, swap for a
 * Redis-backed implementation.
 *
 * TWO KINDS OF CALLER, AND THEY MUST NOT SHARE A KEY.
 *
 * A direct browser request (admin login) reaches us from the operator's own
 * machine, so the connecting IP identifies them and `enforceRateLimit` is
 * right.
 *
 * An app-proxy request does not. Shopify receives the shopper's call to
 * `/apps/exit-intent/...` on the storefront and re-issues it to us, so the
 * connection is opened by Shopify's proxy and every platform-controlled IP
 * header resolves to Shopify — the same value for every shopper on every
 * store. Keying those routes by IP put the whole platform in ONE bucket: a
 * single busy store could throttle a different merchant's shoppers, and the
 * loss correlated with platform-wide traffic at that minute rather than with
 * anything the store did. Worse, the endpoints it silently dropped are the
 * ones that move learning counters — a throttled confirm-render leaves a row
 * indistinguishable from a modal that genuinely never rendered.
 *
 * So app-proxy routes use `enforceProxyRateLimit`, which buckets on the shop
 * domain Shopify puts in the proxied query string.
 *
 * Known tradeoff: that `shop` value is read BEFORE `authenticate.public
 * .appProxy` validates the request signature, so a crafted request can pick
 * its own bucket and evade the limiter. It cannot do anything with the
 * request — signature validation still rejects it a few lines later — so what
 * remains is the cost of reaching that check. That is the right trade: the
 * limiter exists to keep one store's traffic from becoming another store's
 * outage, and a shared global bucket guaranteed exactly that failure in
 * exchange for the same weak evasion resistance.
 */

import { isValidShopDomain } from "./shop-validation.js";

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
 *
 * NOT A SHOPPER IDENTIFIER ON AN APP-PROXY ROUTE. "The real client" there is
 * Shopify's proxy, which opened the connection; the shopper is upstream of it
 * and appears only in an `X-Forwarded-For` hop this function deliberately
 * ignores as spoofable. Use `getProxyShop` / `enforceProxyRateLimit` on those
 * routes. This stays correct for requests that reach us directly.
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
 * The shop domain an app-proxy request claims to be for, or null.
 *
 * Shopify appends `shop` to every proxied request's query string and signs it
 * along with the rest — which is how `shop-settings` and `custom-css-public`
 * have always found the store. So this is not a hopeful read of an optional
 * field; if it were absent, those endpoints would already be broken.
 *
 * Unvalidated all the same — the signature check that PROVES it happens later,
 * in `authenticate.public.appProxy`. Good enough to bucket by, and nothing
 * else. Shares `isValidShopDomain` with the routes that look a shop up by this
 * value, so a domain that would be rejected downstream cannot claim a bucket
 * of its own here either.
 */
export function getProxyShop(request) {
  let raw;
  try {
    raw = new URL(request.url).searchParams.get("shop");
  } catch {
    return null;
  }
  if (!raw) return null;
  const shop = raw.trim().toLowerCase();
  return isValidShopDomain(shop) ? shop : null;
}

/**
 * Per-shop-per-minute ceilings, by what the endpoint costs and what a drop
 * costs us.
 *
 * These numbers changed meaning when the key did. The old ones were a
 * platform-wide total — 10/min on `ai-decision` was "ten decisions a minute
 * across every store on Resparq". Carried over unchanged they would have
 * become a hard per-store traffic ceiling, converting a platform bug into a
 * per-merchant outage at the eleventh visitor in a minute. So they are set
 * for what one busy store plausibly does, not for what the platform does
 * today at ~4.5 impressions a day.
 *
 * `beacon` is deliberately the most generous. Those endpoints are idempotent,
 * carry a server-minted decision id, and cost one write — and dropping one
 * does not fail loudly, it quietly under-counts the evolution and threshold
 * learners while leaving a row that reads as "never rendered". A wrong number
 * there corrupts data; a wrong number on a minting tier costs a discount code.
 */
export const PROXY_LIMITS = {
  // Shopper telemetry: confirm-render, decision-miss, track-click,
  // track-variant, track-starter, journey.
  beacon: { limit: 600, windowMs: 60_000 },
  // Cheap reads of shop-scoped config: shop-settings, custom-css-public.
  read: { limit: 600, windowMs: 60_000 },
  // A decision per arriving visitor: ai-decision, enrich-signals. Admin API
  // round-trips and DB writes, so bounded well under `beacon`, but still far
  // above any real store's arrival rate.
  //
  // ai-decision ALSO mints a real price rule in unique-code mode, which reads
  // like it belongs on `mint` below. It does not, and the reason is worth
  // stating: on that route the minting rate IS the visitor arrival rate —
  // every shopper who gets a unique code causes exactly one mint. A tighter
  // cap there would not bound minting per visitor, it would turn visitors
  // away. What bounds the spend on that path is checkBudget, plus the fact
  // that an app-proxy signature is required, so this is real storefront
  // traffic rather than an open endpoint.
  decide: { limit: 300, windowMs: 60_000 },
  // generate-code: mints a price rule on demand, decoupled from any visitor
  // arrival, so here a tight cap genuinely does bound minting. This is the one
  // tier where the limit is the thing stopping a loop from minting freely.
  mint: { limit: 120, windowMs: 60_000 },
  // One-time per install: init-variants.
  setup: { limit: 60, windowMs: 60_000 },
};

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

function tooManyRequests(result) {
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

/**
 * Enforce a per-IP rate limit on a Request that reached us DIRECTLY, and
 * return a 429 Response if exceeded or `null` if it may proceed.
 *
 * For anything behind Shopify's app proxy use `enforceProxyRateLimit` — see
 * the note on `getClientIp`.
 */
export function enforceRateLimit(request, routeKey, opts) {
  const ip = getClientIp(request);
  const result = checkRateLimit(`${routeKey}:${ip}`, opts);
  if (result.allowed) return null;
  return tooManyRequests(result);
}

/**
 * Enforce a per-SHOP rate limit on an app-proxy Request.
 *
 * A request with no usable `shop` in its query string cannot be attributed to
 * a store and will fail signature validation moments later, so those share a
 * per-IP bucket of their own. That bucket is the one place the old global
 * behaviour survives, and it is where it belongs: garbage and probes, never a
 * real shopper.
 */
export function enforceProxyRateLimit(request, routeKey, opts) {
  const shop = getProxyShop(request);
  const subject = shop ? `shop:${shop}` : `unattributed:${getClientIp(request)}`;
  const result = checkRateLimit(`${routeKey}:${subject}`, opts);
  if (result.allowed) return null;
  return tooManyRequests(result);
}
