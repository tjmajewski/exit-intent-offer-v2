// The per-store report, as DATA. Rendering lives in store-report-pdf.server.js.
//
// Split deliberately. The content of this document is going to be argued over
// for a while — which sections, which findings, how they are worded — and that
// argument should never require touching layout code, nor should a layout
// change be able to alter a number. A future xlsx or email export reads this
// same object rather than re-deriving anything.
//
// EVERY HEADLINE FIGURE COMES FROM getShopMetrics. That module is the single
// source of truth the merchant dashboard and the super-admin console already
// share; a report that re-derived its own revenue would eventually contradict
// the screen the merchant is looking at while reading it. The extra queries
// below are strictly for things getShopMetrics does not carry — cart shape,
// device split, code redemption, and the delivery breakdown — and none of them
// recompute a number it already provides.

import db from "../db.server.js";
import { getShopMetrics } from "./shop-metrics.server.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cart values above this are excluded from the percentile summary.
 *
 * At least one storefront path has posted a cart in cents rather than dollars
 * (a $246,180 single-item cart on the first live store), and one such row drags
 * a p90 badly on a low-traffic shop. A cap is cruder than fixing the unit
 * mismatch and does not pretend otherwise — it keeps a known-bad row out of a
 * document sent to a merchant while that fix is pending.
 */
const CART_SANITY_CEILING = 100000;

/** Median cart at or above this triggers the offer-sizing finding. */
const LARGE_CART_THRESHOLD = 300;

/** Delivery rate below this triggers the reach finding. */
const LOW_DELIVERY_RATE = 50;

/** One device carrying at least this share triggers the device finding. */
const DEVICE_SKEW = 70;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function pct(n, d) {
  return d > 0 ? (n / d) * 100 : 0;
}

/**
 * Findings: the part of the report that is about THIS store rather than about
 * every store.
 *
 * Exported for tests: these thresholds decide what a merchant is told about
 * their own store, so they are worth pinning without standing up a database.
 *
 * Each one is a threshold over measured data, not a hand-written note, so the
 * same document generated for a different merchant says different things for
 * defensible reasons. A finding that cannot be triggered by data does not
 * belong here — it belongs in whatever the operator types into the email.
 */
export function deriveFindings(r) {
  const out = [];

  if (r.delivery.decided > 0 && r.delivery.ratePct < LOW_DELIVERY_RATE) {
    out.push({
      id: "low_delivery_rate",
      title: "Most offers never reach a shopper",
      body:
        `Resparq decided to make an offer ${r.delivery.decided} times and ` +
        `${r.delivery.rendered} of those reached the shopper — ` +
        `${r.delivery.ratePct.toFixed(0)}%. Some of that is deliberate: Resparq will ` +
        `not show the same person an offer repeatedly, and your frequency settings ` +
        `control how often it may. The rest is shoppers leaving before the exit ` +
        `signal fires. This is the largest single lever on your results, because ` +
        `every other number in this report is capped by it, and it is mostly a ` +
        `question of trigger and frequency settings rather than anything structural.`,
    });
  }

  if (r.cart?.median != null && r.cart.median >= LARGE_CART_THRESHOLD) {
    out.push({
      id: "large_cart",
      title: "Your baskets are large, and offers are sized to match",
      body:
        `Your typical cart is ${r.fmt(r.cart.median)}, with larger ones around ` +
        `${r.fmt(r.cart.p90)}. Flat-dollar offers are scaled to the basket in front ` +
        `of them rather than drawn from a fixed pool, with a ceiling tied to your ` +
        `category's typical margin so an offer can never cost more than the sale it ` +
        `earns. On a store with your cart sizes that is the difference between an ` +
        `offer worth about 1% of the basket and one a shopper actually notices.`,
    });
  }

  if (r.money.orders > 0 && r.engagement.clicks === 0) {
    out.push({
      id: "orders_without_clicks",
      title: "Orders without clicks is the expected pattern",
      body:
        `${r.money.orders} order${r.money.orders === 1 ? "" : "s"} followed a ` +
        `displayed offer, and no shopper clicked one. That is not a fault. An exit ` +
        `offer works by returning a leaving shopper's attention to their basket — ` +
        `a shopper who reads it, closes it and checks out is the intended outcome, ` +
        `not a missed one. Click rate is why this report does not lead with a click rate.`,
    });
  }

  if (r.codes.minted > 0 && r.codes.redeemed === 0) {
    out.push({
      id: "codes_unredeemed",
      title: "Discount codes issued, none redeemed yet",
      body:
        `${r.codes.minted} discount code${r.codes.minted === 1 ? " has" : "s have"} ` +
        `been created for shoppers and none have been used. Early on this is normal ` +
        `— codes are issued the moment an offer is shown and most shoppers who take ` +
        `one do so on a later visit. It is worth watching rather than acting on.`,
    });
  }

  const { mobile, desktop, total } = r.devices;
  if (total > 0) {
    const mobilePct = pct(mobile, total);
    const desktopPct = pct(desktop, total);
    if (mobilePct >= DEVICE_SKEW || desktopPct >= DEVICE_SKEW) {
      const leading = mobilePct >= desktopPct ? "mobile" : "desktop";
      const share = Math.max(mobilePct, desktopPct);
      out.push({
        id: "device_skew",
        title: `Your traffic is overwhelmingly ${leading}`,
        body:
          `${share.toFixed(0)}% of sessions are ${leading}. Resparq learns ${leading} ` +
          `and ${leading === "mobile" ? "desktop" : "mobile"} separately for this ` +
          `reason — timing, wording and offer size that work on one rarely transfer ` +
          `cleanly to the other.`,
      });
    }
  }

  return out;
}

/**
 * Build the report for one shop over a rolling window.
 *
 * @param {object} args
 * @param {string} args.shopId        Shop.id
 * @param {number} args.days          Rolling window, default 30
 * @param {string} args.currencyCode  For money formatting, default USD
 * @returns {Promise<object>} the report, ready to render
 */
export async function buildStoreReport({ shopId, days = 30, currencyCode = "USD" }) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`No shop ${shopId}`);

  const since = new Date(Date.now() - days * DAY_MS);
  const metrics = await getShopMetrics({ shopId, days, mode: shop.mode });

  const [
    decided,
    rendered,
    cartRows,
    outcomeRows,
    codesMinted,
    codesRedeemed,
    visitorRows,
  ] = await Promise.all([
    // Delivery: getShopMetrics reports impressions (rendered) but not the
    // decided-and-never-rendered count behind them, which is the finding.
    db.interventionOutcome.count({
      where: { shopId, timestamp: { gte: since }, wasShown: true, isHoldout: false },
    }),
    db.interventionOutcome.count({
      where: {
        shopId, timestamp: { gte: since },
        wasShown: true, rendered: true, isHoldout: false,
      },
    }),
    db.interventionOutcome.findMany({
      where: {
        shopId, timestamp: { gte: since },
        cartValue: { gt: 0, lt: CART_SANITY_CEILING },
      },
      select: { cartValue: true },
    }),
    db.interventionOutcome.findMany({
      where: { shopId, timestamp: { gte: since } },
      select: { deviceType: true },
    }),
    db.discountOffer.count({ where: { shopId, createdAt: { gte: since } } }),
    db.discountOffer.count({
      where: { shopId, createdAt: { gte: since }, redeemed: true },
    }),
    db.visitorTouch.findMany({
      where: { shopId, timestamp: { gte: since } },
      select: { visitorId: true },
      distinct: ["visitorId"],
    }),
  ]);

  const carts = cartRows.map(r => r.cartValue).sort((a, b) => a - b);
  const devices = outcomeRows.reduce((acc, r) => {
    const key = r.deviceType === "mobile" ? "mobile"
      : r.deviceType === "desktop" ? "desktop" : "other";
    acc[key]++; acc.total++;
    return acc;
  }, { mobile: 0, desktop: 0, other: 0, total: 0 });

  // Whole amounts print clean ($2,325), amounts with cents print both of them
  // ($1,162.50). Intl's min 0 / max 2 gives "$1,162.5", which reads as a typo
  // in a document sent to a merchant.
  const money = (n) => {
    const v = Number(n) || 0;
    const digits = Number.isInteger(v) ? 0 : 2;
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency", currency: currencyCode || "USD",
        minimumFractionDigits: digits, maximumFractionDigits: digits,
      }).format(v);
    } catch {
      return `${currencyCode || "USD"} ${v.toFixed(digits)}`;
    }
  };

  const report = {
    fmt: money,
    shop: {
      domain: shop.shopifyDomain,
      mode: shop.mode,
      plan: shop.plan,
      aggression: shop.aggression,
      installedAt: shop.createdAt,
      // Guided runs the holdout coin too, so it gets the arm comparison.
      hasControlArm: shop.mode === "ai" || shop.mode === "hybrid",
    },
    window: { days, since, until: new Date() },
    engagement: {
      visitors: visitorRows.length,
      sessions: devices.total,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
    },
    delivery: {
      decided,
      rendered,
      notRendered: Math.max(0, decided - rendered),
      ratePct: pct(rendered, decided),
    },
    money: {
      orders: metrics.conversions,
      revenue: metrics.revenue,
      discountGiven: metrics.discountGiven,
      aov: metrics.conversions > 0 ? metrics.revenue / metrics.conversions : 0,
    },
    codes: { minted: codesMinted, redeemed: codesRedeemed },
    cart: carts.length
      ? {
          count: carts.length,
          p10: percentile(carts, 0.1),
          median: percentile(carts, 0.5),
          p90: percentile(carts, 0.9),
        }
      : null,
    devices,
    // Null for manual mode and for any shop whose arm query failed — the
    // renderer drops the section rather than printing an empty comparison.
    arms: shop.mode === "ai" || shop.mode === "hybrid" ? metrics.arms : null,
  };

  report.findings = deriveFindings(report);
  return report;
}
