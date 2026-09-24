// Who a rate-limit bucket belongs to.
//
// Every public endpoint here sits behind Shopify's app proxy, which means the
// connection is opened by Shopify and every platform-controlled IP header
// resolves to Shopify — identically, for every shopper on every store. Keying
// those routes by IP therefore did not produce a per-shopper limit or even a
// per-store one. It produced a single platform-wide bucket, shared by all of
// them, in front of the endpoints that move learning counters.
//
// That is a data-integrity bug before it is a fairness one: a throttled
// confirm-render leaves rendered=false, which is byte-identical to a modal
// that genuinely never displayed, and the loss rises with platform traffic —
// so the rows most likely to be missing are the ones from the busiest minutes.
//
// These tests pin the scoping, not the numbers. The one number they assert is
// that no tier is small enough to throttle a real storefront.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  getProxyShop,
  enforceProxyRateLimit,
  enforceRateLimit,
  PROXY_LIMITS,
} from '../app/utils/rate-limit.server.js';

// The IP every app-proxy request arrives with: Shopify's, not the shopper's.
const SHOPIFY_PROXY_IP = '23.227.38.74';

function proxyRequest(shop, { ip = SHOPIFY_PROXY_IP, path = '/apps/exit-intent/api/x' } = {}) {
  const qs = shop === null ? '' : `?shop=${encodeURIComponent(shop)}&signature=abc`;
  return new Request(`https://resparq.fly.dev${path}${qs}`, {
    headers: { 'fly-client-ip': ip },
  });
}

// Each test needs its own route key — buckets live in one module-level Map.
let n = 0;
const route = (label) => `test-${label}-${n++}`;

describe('app-proxy limits are scoped to a shop, not to Shopify', () => {
  test('one store exhausting its bucket does not touch another store', () => {
    const key = route('isolation');
    const limits = { limit: 2, windowMs: 60_000 };

    assert.equal(enforceProxyRateLimit(proxyRequest('busy.myshopify.com'), key, limits), null);
    assert.equal(enforceProxyRateLimit(proxyRequest('busy.myshopify.com'), key, limits), null);
    const throttled = enforceProxyRateLimit(proxyRequest('busy.myshopify.com'), key, limits);
    assert.equal(throttled?.status, 429, 'a store past its own limit is throttled');

    // Same route, same IP — the only thing that differs is the store. Under
    // the old IP keying this assertion failed: the second merchant's shoppers
    // were silently dropped because of traffic on the first merchant's store.
    assert.equal(
      enforceProxyRateLimit(proxyRequest('quiet.myshopify.com'), key, limits),
      null,
      'a quiet store is throttled by a busy one — buckets are shared',
    );
  });

  test('a 429 carries Retry-After so a beacon can be re-sent', () => {
    const key = route('retry-after');
    const limits = { limit: 1, windowMs: 60_000 };
    enforceProxyRateLimit(proxyRequest('a.myshopify.com'), key, limits);
    const res = enforceProxyRateLimit(proxyRequest('a.myshopify.com'), key, limits);
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('Retry-After')) > 0);
  });

  test('routes do not share a bucket with each other', () => {
    const limits = { limit: 1, windowMs: 60_000 };
    const shop = 'one.myshopify.com';
    const a = route('route-a');
    const b = route('route-b');
    enforceProxyRateLimit(proxyRequest(shop), a, limits);
    assert.equal(enforceProxyRateLimit(proxyRequest(shop), a, limits)?.status, 429);
    assert.equal(enforceProxyRateLimit(proxyRequest(shop), b, limits), null);
  });
});

describe('what counts as a shop', () => {
  test('the domain Shopify appends is read out of the query string', () => {
    assert.equal(getProxyShop(proxyRequest('cami-wigs.myshopify.com')), 'cami-wigs.myshopify.com');
  });

  test('case and whitespace land in the same bucket', () => {
    assert.equal(getProxyShop(proxyRequest('  CAMI-Wigs.MyShopify.com  ')), 'cami-wigs.myshopify.com');
  });

  test('anything that is not a myshopify domain is not a shop', () => {
    for (const bad of ['', 'evil.com', 'shop.myshopify.com.evil.com', '../etc', '-lead.myshopify.com']) {
      assert.equal(getProxyShop(proxyRequest(bad)), null, `${bad} was accepted as a shop`);
    }
    assert.equal(getProxyShop(proxyRequest(null)), null, 'a missing shop param is not a shop');
  });

  test('an unattributable request falls back to its IP, not to a shared bucket', () => {
    const key = route('unattributed');
    const limits = { limit: 1, windowMs: 60_000 };

    // No shop param: cannot be charged to a store, and will fail signature
    // validation moments later anyway.
    assert.equal(enforceProxyRateLimit(proxyRequest(null, { ip: '1.1.1.1' }), key, limits), null);
    assert.equal(enforceProxyRateLimit(proxyRequest(null, { ip: '1.1.1.1' }), key, limits)?.status, 429);

    // A different probe source is its own bucket...
    assert.equal(enforceProxyRateLimit(proxyRequest(null, { ip: '2.2.2.2' }), key, limits), null);
    // ...and a real store is untouched by either.
    assert.equal(enforceProxyRateLimit(proxyRequest('real.myshopify.com'), key, limits), null);
  });
});

describe('direct requests still key on IP', () => {
  test('admin login throttles one operator without throttling another', () => {
    const key = route('direct');
    const limits = { limit: 1, windowMs: 60_000 };
    const at = (ip) => new Request('https://resparq.fly.dev/admin/login', {
      headers: { 'fly-client-ip': ip },
    });
    assert.equal(enforceRateLimit(at('9.9.9.9'), key, limits), null);
    assert.equal(enforceRateLimit(at('9.9.9.9'), key, limits)?.status, 429);
    assert.equal(enforceRateLimit(at('8.8.8.8'), key, limits), null);
  });
});

describe('the routes are wired to the right limiter', () => {
  const dir = new URL('../app/routes/', import.meta.url);
  const proxyRoutes = readdirSync(dir).filter((f) => f.startsWith('apps.exit-intent.api.'));

  test('no app-proxy route keys on IP', () => {
    for (const file of proxyRoutes) {
      const src = readFileSync(new URL(file, dir), 'utf8');
      // \b will not match inside enforceProxyRateLimit — both sides are word chars.
      const callsIpLimiter = /\benforceRateLimit\(/.test(src);
      assert.ok(!callsIpLimiter, `${file} rate-limits by IP, which is Shopify's proxy on this route`);
    }
  });

  test('every proxy route that limits at all uses a named tier', () => {
    let limited = 0;
    for (const file of proxyRoutes) {
      const src = readFileSync(new URL(file, dir), 'utf8');
      if (!src.includes('enforceProxyRateLimit(')) continue;
      limited++;
      assert.match(
        src,
        /enforceProxyRateLimit\(request, "[a-z-]+", PROXY_LIMITS\.(beacon|read|decide|mint|setup)\)/,
        `${file} passes an inline limit instead of a tier`,
      );
    }
    assert.ok(limited >= 12, `expected the known proxy endpoints to be limited, found ${limited}`);
  });

  test('admin login is the one caller left on the IP limiter', () => {
    const src = readFileSync(new URL('../app/routes/admin.login.jsx', import.meta.url), 'utf8');
    assert.match(src, /enforceRateLimit\(request, "admin-login"/);
  });
});

describe('the tiers are sized for a store, not for the platform', () => {
  test('no tier would throttle a storefront doing one event a second', () => {
    // The old numbers (10–120/min) were platform-wide totals. Carried onto a
    // per-shop key unchanged, the smallest of them would have capped a single
    // store at ten visitors a minute.
    for (const [name, tier] of Object.entries(PROXY_LIMITS)) {
      assert.equal(tier.windowMs, 60_000, `${name} is not a per-minute tier`);
      assert.ok(tier.limit >= 60, `${name} at ${tier.limit}/min throttles a real storefront`);
    }
  });

  test('telemetry is the most generous tier — dropping it corrupts counters silently', () => {
    assert.ok(PROXY_LIMITS.beacon.limit >= PROXY_LIMITS.decide.limit);
    assert.ok(PROXY_LIMITS.decide.limit > PROXY_LIMITS.mint.limit, 'minting is not the tightest tier');
  });
});
