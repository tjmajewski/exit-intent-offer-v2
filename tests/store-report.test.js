// The merchant-facing store report: findings logic and PDF rendering.
//
// This document gets emailed to customers, so the things worth pinning are the
// ones that would embarrass you in an inbox: a finding that fires on the wrong
// store, a date off by one, money printed as "$1,162.5", a three-page report
// that renders as nine.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFindings } from '../app/utils/store-report.server.js';
import { renderStoreReportPdf } from '../app/utils/store-report-pdf.server.js';

const money = (n) => {
  const v = Number(n) || 0;
  const digits = Number.isInteger(v) ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(v);
};

/** A healthy store that should trigger no findings at all. */
function baseReport(over = {}) {
  return {
    fmt: money,
    shop: {
      domain: 'example.myshopify.com', mode: 'ai', plan: 'pro', aggression: 5,
      installedAt: new Date('2026-09-14T00:00:00Z'), hasControlArm: true,
    },
    window: { days: 30, since: new Date('2026-08-23T00:00:00Z'), until: new Date('2026-09-22T00:00:00Z') },
    engagement: { visitors: 900, sessions: 1200, impressions: 800, clicks: 60 },
    delivery: { decided: 1000, rendered: 800, notRendered: 200, ratePct: 80 },
    money: { orders: 40, revenue: 4000, discountGiven: 200, aov: 100 },
    codes: { minted: 20, redeemed: 6 },
    cart: { count: 1000, p10: 40, median: 90, p90: 180 },
    devices: { mobile: 600, desktop: 580, other: 20, total: 1200 },
    arms: {
      treated: { customers: 800, converted: 40, rate: 5 },
      control: { customers: 90, converted: 4, rate: 4.44 },
      crossedArms: 0, controlReady: true, controlMinimum: 10,
    },
    findings: [],
    ...over,
  };
}

const ids = (r) => deriveFindings(r).map(f => f.id);

describe('store report — findings fire on data, not on the store', () => {
  test('a healthy store gets no findings', () => {
    assert.deepEqual(ids(baseReport()), []);
  });

  test('a poor delivery rate is called out', () => {
    const r = baseReport({ delivery: { decided: 55, rendered: 13, notRendered: 42, ratePct: 23.6 } });
    assert.ok(ids(r).includes('low_delivery_rate'));
  });

  test('a healthy delivery rate is not', () => {
    const r = baseReport({ delivery: { decided: 100, rendered: 60, notRendered: 40, ratePct: 60 } });
    assert.ok(!ids(r).includes('low_delivery_rate'));
  });

  test('delivery is silent when nothing was decided', () => {
    // A brand-new install must not be told its delivery rate is 0%.
    const r = baseReport({ delivery: { decided: 0, rendered: 0, notRendered: 0, ratePct: 0 } });
    assert.ok(!ids(r).includes('low_delivery_rate'));
  });

  test('large baskets trigger the sizing note, small ones do not', () => {
    assert.ok(ids(baseReport({ cart: { count: 50, p10: 900, median: 1150, p90: 1725 } }))
      .includes('large_cart'));
    assert.ok(!ids(baseReport({ cart: { count: 50, p10: 20, median: 60, p90: 120 } }))
      .includes('large_cart'));
  });

  test('a store with no cart data gets no cart finding', () => {
    assert.ok(!ids(baseReport({ cart: null })).includes('large_cart'));
  });

  test('orders with zero clicks are explained, not hidden', () => {
    const r = baseReport({
      engagement: { visitors: 33, sessions: 60, impressions: 13, clicks: 0 },
      money: { orders: 2, revenue: 2325, discountGiven: 0, aov: 1162.5 },
    });
    assert.ok(ids(r).includes('orders_without_clicks'));
  });

  test('zero clicks and zero orders says nothing about clicks', () => {
    // Nothing happened; that is not an insight about how the product works.
    const r = baseReport({
      engagement: { visitors: 5, sessions: 8, impressions: 2, clicks: 0 },
      money: { orders: 0, revenue: 0, discountGiven: 0, aov: 0 },
    });
    assert.ok(!ids(r).includes('orders_without_clicks'));
  });

  test('unredeemed codes are flagged only once some exist', () => {
    assert.ok(ids(baseReport({ codes: { minted: 5, redeemed: 0 } })).includes('codes_unredeemed'));
    assert.ok(!ids(baseReport({ codes: { minted: 0, redeemed: 0 } })).includes('codes_unredeemed'));
    assert.ok(!ids(baseReport({ codes: { minted: 5, redeemed: 2 } })).includes('codes_unredeemed'));
  });

  test('device skew names the leading device', () => {
    const mob = deriveFindings(baseReport({ devices: { mobile: 49, desktop: 11, other: 0, total: 60 } }))
      .find(f => f.id === 'device_skew');
    assert.ok(mob && mob.title.includes('mobile'));
    const desk = deriveFindings(baseReport({ devices: { mobile: 5, desktop: 55, other: 0, total: 60 } }))
      .find(f => f.id === 'device_skew');
    assert.ok(desk && desk.title.includes('desktop'));
  });

  test('an even device split is not a finding', () => {
    assert.ok(!ids(baseReport({ devices: { mobile: 30, desktop: 30, other: 0, total: 60 } }))
      .includes('device_skew'));
  });

  test('no division by zero on an empty store', () => {
    const empty = baseReport({
      engagement: { visitors: 0, sessions: 0, impressions: 0, clicks: 0 },
      delivery: { decided: 0, rendered: 0, notRendered: 0, ratePct: 0 },
      money: { orders: 0, revenue: 0, discountGiven: 0, aov: 0 },
      codes: { minted: 0, redeemed: 0 },
      cart: null,
      devices: { mobile: 0, desktop: 0, other: 0, total: 0 },
      arms: null,
    });
    assert.deepEqual(deriveFindings(empty), []);
  });

  test('every finding carries a title and a body', () => {
    const r = baseReport({
      delivery: { decided: 55, rendered: 13, notRendered: 42, ratePct: 23.6 },
      cart: { count: 50, p10: 900, median: 1150, p90: 1725 },
      engagement: { visitors: 33, sessions: 60, impressions: 13, clicks: 0 },
      money: { orders: 2, revenue: 2325, discountGiven: 0, aov: 1162.5 },
      codes: { minted: 5, redeemed: 0 },
      devices: { mobile: 49, desktop: 11, other: 0, total: 60 },
    });
    const found = deriveFindings(r);
    assert.equal(found.length, 5);
    for (const f of found) {
      assert.ok(f.id && f.title && f.body, `finding ${f.id} is incomplete`);
      assert.ok(!/undefined|NaN|\[object/.test(f.title + f.body),
        `finding ${f.id} interpolated a bad value`);
    }
  });
});

describe('store report — money formatting', () => {
  test('whole amounts print without cents, fractional ones with both digits', () => {
    // Intl's min 0 / max 2 renders 1162.5 as "$1,162.5", which reads as a typo.
    assert.equal(money(2325), '$2,325');
    assert.equal(money(1162.5), '$1,162.50');
    assert.equal(money(0), '$0');
  });
});

describe('store report — PDF rendering', () => {
  const full = () => baseReport({
    delivery: { decided: 55, rendered: 13, notRendered: 42, ratePct: 23.6 },
    cart: { count: 59, p10: 900, median: 1150, p90: 1725 },
    engagement: { visitors: 33, sessions: 60, impressions: 13, clicks: 0 },
    money: { orders: 2, revenue: 2325, discountGiven: 0, aov: 1162.5 },
    codes: { minted: 5, redeemed: 0 },
    devices: { mobile: 49, desktop: 11, other: 0, total: 60 },
    arms: {
      treated: { customers: 27, converted: 2, rate: 7.4 },
      control: { customers: 1, converted: 0, rate: 0 },
      crossedArms: 0, controlReady: false, controlMinimum: 10,
    },
  });

  test('produces a valid PDF', async () => {
    const r = full(); r.findings = deriveFindings(r);
    const buf = await renderStoreReportPdf(r);
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(buf.length > 2000, 'suspiciously small for a multi-section report');
  });

  test('does not emit a blank page per page of content', async () => {
    // Footer text sits below the bottom margin; without suppressing pdfkit's
    // auto-paginate that produced a blank page after every real one — a
    // 3-page report rendered as 9.
    const r = full(); r.findings = deriveFindings(r);
    const buf = await renderStoreReportPdf(r);
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.ok(pages > 0 && pages <= 5, `expected a short report, got ${pages} pages`);
  });

  test('renders for a store with no data at all', async () => {
    const r = baseReport({
      engagement: { visitors: 0, sessions: 0, impressions: 0, clicks: 0 },
      delivery: { decided: 0, rendered: 0, notRendered: 0, ratePct: 0 },
      money: { orders: 0, revenue: 0, discountGiven: 0, aov: 0 },
      codes: { minted: 0, redeemed: 0 },
      cart: null,
      devices: { mobile: 0, desktop: 0, other: 0, total: 0 },
      arms: null,
    });
    r.findings = deriveFindings(r);
    const buf = await renderStoreReportPdf(r);
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  });

  test('renders for a manual-mode store with no control arm', async () => {
    const r = baseReport({
      shop: { ...baseReport().shop, mode: 'manual', hasControlArm: false },
      arms: null,
    });
    r.findings = deriveFindings(r);
    const buf = await renderStoreReportPdf(r);
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  });

  test('renders a Guided-mode store, which does have a control arm', async () => {
    const r = baseReport({ shop: { ...baseReport().shop, mode: 'hybrid', hasControlArm: true } });
    r.findings = deriveFindings(r);
    const buf = await renderStoreReportPdf(r);
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  });

  test('a long window and many findings still render', async () => {
    const r = full();
    r.window = { days: 365, since: new Date('2025-09-22T00:00:00Z'), until: new Date('2026-09-22T00:00:00Z') };
    r.findings = deriveFindings(r);
    const buf = await renderStoreReportPdf(r);
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  });
});
