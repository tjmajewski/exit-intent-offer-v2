// Vertical derivation must say why it failed.
//
// It shipped with `sortKey: BEST_SELLING`, which is not a member of
// ProductSortKeys (that value exists only on a collection's products
// connection). Shopify returns HTTP 200 with a top-level `errors` array and a
// null `data` for a validation failure, and the old code read straight through
// it to `undefined` and returned null — the same null a store selling 50
// unrelated things returns. So derivation failed for every store on the
// platform, for its entire life, and looked exactly like a correct answer.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVertical, deriveVerticalDetailed } from '../app/utils/store-cluster.server.js';

const dbWithToken = { session: { findFirst: async () => ({ accessToken: 'shpat_x' }) } };
const dbNoToken = { session: { findFirst: async () => null } };

/** A fetch that returns one canned Admin API body. */
const fakeFetch = (body, { ok = true, status = 200 } = {}) => async () => ({
  ok, status, statusText: 'x', json: async () => body
});

const productsBody = (types) => ({
  data: { products: { nodes: types.map((t) => ({ productType: t, category: null })) } }
});

describe('deriveVerticalDetailed names the failure', () => {
  test('a missing offline session is not reported as an unclassifiable store', () => {
    return deriveVerticalDetailed(dbNoToken, 's.myshopify.com', { fetchImpl: fakeFetch({}) })
      .then((r) => {
        assert.equal(r.vertical, null);
        assert.equal(r.reason, 'no_offline_session');
      });
  });

  test('a GraphQL validation error is its own reason, and carries the message', async () => {
    // The exact shape that hid the sortKey bug: HTTP 200, data null, errors set.
    const body = {
      errors: [{ message: "Argument 'sortKey' on Field 'products' has an invalid value (BEST_SELLING)." }]
    };
    const r = await deriveVerticalDetailed(dbWithToken, 's.myshopify.com', { fetchImpl: fakeFetch(body) });
    assert.equal(r.vertical, null);
    assert.equal(r.reason, 'graphql_error');
    assert.match(r.detail, /sortKey/);
  });

  test('an HTTP failure is distinguished from a valid empty catalog', async () => {
    const bad = await deriveVerticalDetailed(dbWithToken, 's.myshopify.com', {
      fetchImpl: fakeFetch({}, { ok: false, status: 401 })
    });
    assert.equal(bad.reason, 'http_error');
    assert.match(bad.detail, /401/);

    const empty = await deriveVerticalDetailed(dbWithToken, 's.myshopify.com', {
      fetchImpl: fakeFetch(productsBody([]))
    });
    assert.equal(empty.reason, 'no_products');
  });

  test('unmatched product types report the types, so the vocabulary can be fixed', async () => {
    const r = await deriveVerticalDetailed(dbWithToken, 's.myshopify.com', {
      fetchImpl: fakeFetch(productsBody(['Widget', 'Doohickey', 'Thingamajig']))
    });
    assert.equal(r.vertical, null);
    assert.equal(r.reason, 'no_keyword_match');
    assert.match(r.detail, /Widget/);
  });

  test('a real catalog classifies and reports its votes', async () => {
    const r = await deriveVerticalDetailed(dbWithToken, 's.myshopify.com', {
      fetchImpl: fakeFetch(productsBody(['Wigs', 'Wigs', 'Hair Extensions', 'Lace Front Wig']))
    });
    assert.equal(r.vertical, 'beauty');
    assert.equal(r.reason, 'ok');
    assert.equal(r.votes.beauty, 4);
    assert.equal(r.sampled, 4);
  });

  test('a store of 50 unrelated things is "other", and says so', async () => {
    const r = await deriveVerticalDetailed(dbWithToken, 's.myshopify.com', {
      fetchImpl: fakeFetch(productsBody(['Laptops', 'Dog Leashes', 'Diamond Rings', 'Coffee', 'Widget', 'Sprocket', 'Gizmo', 'Doodad']))
    });
    assert.equal(r.vertical, 'other');
    assert.equal(r.reason, 'no_majority');
  });
});

describe('deriveVertical stays a thin wrapper', () => {
  test('returns the bare vertical, so existing callers are unchanged', async () => {
    const v = await deriveVertical(dbWithToken, 's.myshopify.com', {
      fetchImpl: fakeFetch(productsBody(['Wigs', 'Wigs', 'Hair Extensions']))
    });
    assert.equal(v, 'beauty');
  });

  test('still collapses every failure to null', async () => {
    assert.equal(await deriveVertical(dbNoToken, 's.myshopify.com', { fetchImpl: fakeFetch({}) }), null);
  });
});

describe('the products query itself', () => {
  test('sends no invalid sortKey', async () => {
    // The bug was in the query string, not the logic, so the regression test
    // has to look at the query string.
    let sent = null;
    await deriveVerticalDetailed(dbWithToken, 's.myshopify.com', {
      fetchImpl: async (_url, opts) => {
        sent = JSON.parse(opts.body).query;
        return { ok: true, status: 200, json: async () => productsBody(['Wigs']) };
      }
    });
    assert.ok(sent, 'no request was made');
    assert.ok(!/BEST_SELLING/.test(sent), 'BEST_SELLING is not a member of ProductSortKeys');
    assert.ok(!/sortKey/.test(sent), 'a sortKey here is a second failure mode for no benefit');
  });
});
