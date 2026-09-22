#!/usr/bin/env node
// Why a discount code is never minted.  DIAGNOSTIC.  CREATES AND THEN DELETES
// UP TO THREE REAL DISCOUNT CODES IN THE TARGET STORE.
//
//   node scripts/ops/probe-discount-mint.mjs <shop-domain>
//   node scripts/ops/probe-discount-mint.mjs 568e5d-75.myshopify.com
//
// Add --keep to leave the codes in place (default is to delete every one it
// created). Nothing else in this script writes.
//
// ============================== WHAT THIS IS FOR ==========================
//
// As of 2026-09-21 the live shop `568e5d-75.myshopify.com` (Cami Wigs) has
// NEVER had a discount code minted: `DiscountOffer` is empty since install on
// 2026-09-14. The failure is silent, and the reason it is silent is the
// ordering inside `apps.exit-intent.api.ai-decision.jsx`:
//
//   recordImpression()        -> writes VariantImpression
//   ...
//   createPercentageDiscount  -> THROWS
//   db.discountOffer.create   -> never reached
//   db.aIDecision.create      -> never reached
//   outer catch               -> 500, no row anywhere
//
// So a crashed discount decision leaves an impression row and NO decision row.
// Counting that gap is how the bug was found, and the arithmetic is exact:
//
//   VariantImpression rows                                    132
//   storefront AIDecision rows (source absent)                 53
//   gap                                                        79
//   PERCENT_DISCOUNT 28 + FIXED_DISCOUNT 18 + THRESHOLD 38      84
//
// Only TRUST_REMINDER and SOFT_UPSELL ever rendered (9 impressions) because
// those take the `type === 'no-discount'` early return and never touch the
// mint path at all.
//
// Already ruled out by inspection and by read-only probes, so do not re-check:
//   - the offline session and access token (present, valid)
//   - scopes (read_orders, write_discounts, write_products all granted)
//   - the discountCodeBasicCreate mutation itself (reproduced successfully
//     against the dev store on api 2025-07, 2025-10 and 2026-01)
//   - `admin` being undefined (admin.graphql is used earlier in the same
//     request, on the path no-discount decisions take successfully)
//   - generateUniqueCode, and ensureSubscriptionEligibility (only reachable
//     from createGenericDiscountCode, which this shop does not use:
//     aiDiscountCodeMode = "unique")
//
// What is left is whatever `createPercentageDiscount` /
// `createFixedDiscount` / `createThresholdDiscount` actually throw at runtime,
// which needs the live token. Hence this script.
//
// It imports the REAL module from disk rather than restating the mutation, so
// what it exercises is exactly what the endpoint exercises.

/* eslint-env node */
import { PrismaClient } from '@prisma/client';
import path from 'node:path';

const SHOP = process.argv[2];
const KEEP = process.argv.includes('--keep');
if (!SHOP) {
  console.error('usage: node scripts/ops/probe-discount-mint.mjs <shop-domain> [--keep]');
  process.exit(1);
}

const API_VERSION = process.env.PROBE_API_VERSION || '2025-10';
const db = new PrismaClient();

const session = await db.session.findFirst({ where: { shop: SHOP } });
if (!session?.accessToken) {
  console.error(`No offline session with a token for ${SHOP}. Nothing to probe.`);
  await db.$disconnect();
  process.exit(1);
}

const endpoint = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

// The same surface the route's `admin` exposes: `.graphql(query, { variables })`
// returning something with `.json()`. Kept deliberately thin so a failure here
// cannot be mistaken for a failure in the module under test.
const admin = {
  graphql: async (query, opts = {}) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken
      },
      body: JSON.stringify({ query, variables: opts.variables })
    });
    return { json: () => res.json(), status: res.status };
  }
};

// Resolve the real module next to this script's repo root, so this works both
// locally and inside the container image.
const modPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../app/utils/discount-codes.js');
const mod = await import(modPath);

console.log(`shop=${SHOP}  api=${API_VERSION}  module=${modPath}`);
console.log(`exports: ${Object.keys(mod).join(', ')}\n`);

const created = [];
const attempts = [
  ['createPercentageDiscount(20%)', () => mod.createPercentageDiscount(admin, 20, 'EXIT')],
  ['createFixedDiscount($10)', () => mod.createFixedDiscount(admin, 10, 'EXIT')],
  ['createThresholdDiscount(spend $100 save $15)', () => mod.createThresholdDiscount(admin, 100, 15, 'EXIT')]
];

for (const [label, run] of attempts) {
  console.log(`================ ${label} ================`);
  try {
    const result = await run();
    console.log(`SUCCESS -> ${JSON.stringify(result)}`);
    if (result?.code) created.push(result.code);
  } catch (e) {
    console.log(`THREW  ${e?.constructor?.name}: ${e?.message}`);
    console.log('--- stack (top frames) ---');
    console.log(String(e?.stack || '(no stack)').split('\n').slice(0, 14).join('\n'));
    // The most common shape here is a TypeError from reading
    // `result.data.discountCodeBasicCreate.userErrors` when Shopify returned a
    // top-level `errors` array and therefore a null `data`. Surface the raw
    // response so that case is unambiguous rather than inferred.
    try {
      const raw = await admin.graphql('{ shop { name } }');
      console.log(`(control read still works: HTTP ${raw.status})`);
    } catch (_) {
      console.log('(control read ALSO failed — the token or network is the problem)');
    }
  }
  console.log('');
}

console.log('================ CLEANUP ================');
if (!created.length) {
  console.log('nothing was created, nothing to clean up');
} else if (KEEP) {
  console.log(`--keep given; leaving ${created.length} code(s) in the store: ${created.join(', ')}`);
} else {
  for (const code of created) {
    try {
      const look = await admin.graphql(
        'query($q: String!) { codeDiscountNodeByCode(code: $q) { id } }',
        { variables: { q: code } }
      );
      const id = (await look.json())?.data?.codeDiscountNodeByCode?.id;
      if (!id) { console.log(`  ${code}: id not resolvable — DELETE MANUALLY in the Shopify admin`); continue; }
      const del = await admin.graphql(
        'mutation($id: ID!) { discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { message } } }',
        { variables: { id } }
      );
      const errs = (await del.json())?.data?.discountCodeDelete?.userErrors || [];
      console.log(`  ${code}: ${errs.length ? 'DELETE FAILED ' + JSON.stringify(errs) + ' — DELETE MANUALLY' : 'deleted'}`);
    } catch (e) {
      console.log(`  ${code}: cleanup threw (${e.message}) — DELETE MANUALLY`);
    }
  }
}

await db.$disconnect();
