// Behavioral guard for subscription Slice B (spec 2.0 / 2.3 / 2.5). No test
// runner in this project, so this is a standalone node harness:
//
//   node scripts/dev/verify-subscription-slice-b.mjs
//
// verify-margin-invariant.mjs proves the amortization breaks nothing; this
// proves each piece actually DOES its job, and that the guards around it hold:
//   - amortization moves the ceiling on subscription carts, and ONLY via the
//     two margin caps (aggression 0, high propensity, D_MAX, and the merchant's
//     aggression ceiling must all still bind)
//   - subShareFromSignals is div-by-zero / garbage safe
//   - the 2.5 subscriber signal nudges baseline selection without blocking
//   - the 2.0 backfill updates exactly once, skips current + non-basic codes,
//     and never throws on the offer-delivery hot path (mocked Admin client)
import {
  offerCeilingPercent, subscriptionAmortization, subShareFromSignals
} from '../../app/utils/ai-decision.server.js';
import { selectBaseline } from '../../app/utils/baseline-selector.js';
import { ensureSubscriptionEligibility } from '../../app/utils/discount-subscription.js';

let fails = 0;
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) fails++;
};

// ---------------------------------------------------------------------------
console.log('\n2.3 amortization factor');
ok(subscriptionAmortization(0, 3) === 1, 'one-time cart => factor 1');
ok(Math.abs(subscriptionAmortization(1, 3) - 1 / 3) < 1e-9, 'all-sub, 3 cycles => 1/3');
ok(Math.abs(subscriptionAmortization(0.5, 3) - (0.5 + 0.5 / 3)) < 1e-9, 'mixed 50% => blended');
ok(subscriptionAmortization(1, 1) === 1, '1 cycle => no discount (factor 1)');
ok(subscriptionAmortization(1, 999) === subscriptionAmortization(1, 24), 'cycles clamped at 24');
ok(subscriptionAmortization(1, 0) === 1, 'cycles < 1 clamped to 1');
ok(subscriptionAmortization(2, 3) === subscriptionAmortization(1, 3), 'subShare clamped at 1');
ok(subscriptionAmortization(NaN, NaN) === 1, 'garbage inputs => identity');

// ---------------------------------------------------------------------------
console.log('\n2.3 ceiling actually moves on a thin-margin subscription cart');
// agm 0.25 makes the SHARE cap (12.5%) bind, so amortization has room to matter.
const thin = { propensity: 20, aggression: 8, assumedGrossMargin: 0.25 };
const oneTime = offerCeilingPercent(thin);
const allSub = offerCeilingPercent({ ...thin, subShare: 1, expectedCycles: 3 });
const mixed = offerCeilingPercent({ ...thin, subShare: 0.5, expectedCycles: 3 });
console.log(`     one-time=${oneTime}%  mixed50=${mixed}%  all-sub=${allSub}%`);
ok(allSub > oneTime, 'all-subscription cart clears a deeper offer');
ok(mixed > oneTime && mixed < allSub, 'mixed cart lands between');

console.log('\n2.3 amortization NEVER relaxes the non-margin caps');
const agg0 = offerCeilingPercent({ propensity: 20, aggression: 0, subShare: 1, expectedCycles: 24 });
ok(agg0 === 0, 'aggression 0 still announce-only');
const hiP = offerCeilingPercent({ propensity: 95, aggression: 10, subShare: 1, expectedCycles: 24 });
ok(hiP === 0, 'high propensity still announce-only (curve, not a margin cap)');
const maxed = offerCeilingPercent({ propensity: 0, aggression: 10, assumedGrossMargin: 0.65, subShare: 1, expectedCycles: 24 });
ok(maxed <= 25, 'absolute 25% cap still holds', `${maxed}%`);
const aggrCapped = offerCeilingPercent({ propensity: 0, aggression: 2, assumedGrossMargin: 0.65, subShare: 1, expectedCycles: 24 });
ok(aggrCapped <= 10 + 2 * 1.5, "merchant's aggression ceiling still holds", `${aggrCapped}%`);

// ---------------------------------------------------------------------------
console.log('\n2.3 subShareFromSignals');
ok(subShareFromSignals({ cartSubscription: 'none', subscriptionValue: 50 }, 100) === 0, 'none => 0');
ok(subShareFromSignals({ cartSubscription: 'all', subscriptionValue: 100 }, 100) === 1, 'all => 1');
ok(subShareFromSignals({ cartSubscription: 'mixed', subscriptionValue: 30 }, 120) === 0.25, 'mixed => ratio');
ok(subShareFromSignals({ cartSubscription: 'mixed', subscriptionValue: 500 }, 100) === 1, 'over-100% clamped');
ok(subShareFromSignals({ cartSubscription: 'all' }, 100) === 0, 'missing subscriptionValue => 0');
ok(subShareFromSignals({ cartSubscription: 'all', subscriptionValue: 50 }, 0) === 0, 'zero cart => 0 (no div-by-zero)');
ok(subShareFromSignals({}, 100) === 0, 'no signal => 0');

// ---------------------------------------------------------------------------
console.log('\n2.5 active-subscriber baseline nudge');
const base = { exitPage: 'cart', cartValue: 80, cartHesitation: 2 };
const at65 = { ...base, propensityScore: 65 };
ok(selectBaseline(at65).includes('with_discount'), 'P=65 normal visitor => discount pool');
ok(selectBaseline({ ...at65, isActiveSubscriber: true }).includes('no_discount'), 'P=65 subscriber => no-discount pool');
const at55 = { ...base, propensityScore: 55 };
ok(selectBaseline({ ...at55, isActiveSubscriber: true }).includes('with_discount'),
   'P=55 subscriber STILL reaches discount pool (nudge, not a block)');
ok(selectBaseline({ ...at65, isActiveSubscriber: false }) === selectBaseline(at65), 'false === absent');
ok(selectBaseline({ ...at65, isActiveSubscriber: 'yes' }) === selectBaseline(at65), 'only strict true triggers it');

// ---------------------------------------------------------------------------
console.log('\n2.0 backfill on a mocked Admin client');
function mockAdmin({ appliesOnSubscription, missingNode = false, notBasic = false, userErrors = [], throwOn = null }) {
  const calls = [];
  return {
    calls,
    graphql: async (query, opts) => {
      const isUpdate = query.includes('discountCodeBasicUpdate');
      calls.push({ op: isUpdate ? 'update' : 'check', vars: opts?.variables });
      if (throwOn === (isUpdate ? 'update' : 'check')) throw new Error('network boom');
      if (isUpdate) return { json: async () => ({ data: { discountCodeBasicUpdate: { userErrors } } }) };
      if (missingNode) return { json: async () => ({ data: { codeDiscountNodeByCode: null } }) };
      return {
        json: async () => ({
          data: {
            codeDiscountNodeByCode: {
              id: 'gid://shopify/DiscountCodeNode/1',
              codeDiscount: notBasic ? {} : { customerGets: { appliesOnOneTimePurchase: true, appliesOnSubscription } }
            }
          }
        })
      };
    }
  };
}

let a = mockAdmin({ appliesOnSubscription: false });
let r = await ensureSubscriptionEligibility(a, 'LEGACY10');
ok(r === true && a.calls.length === 2 && a.calls[1].op === 'update', 'stale code => repaired with one update');
const sent = a.calls[1].vars.basicCodeDiscount;
ok(sent.customerGets.appliesOnSubscription === true
   && sent.customerGets.appliesOnOneTimePurchase === true
   && sent.recurringCycleLimit === 1, 'update sets all three fields, first cycle only');

a = mockAdmin({ appliesOnSubscription: true });
r = await ensureSubscriptionEligibility(a, 'CURRENT10');
ok(r === true && a.calls.length === 1, 'already-current code => no update (self-limiting)');

a = mockAdmin({ appliesOnSubscription: false, notBasic: true });
r = await ensureSubscriptionEligibility(a, 'MERCHANT_BXGY');
ok(r === false && a.calls.length === 1, 'non-DiscountCodeBasic left untouched');

a = mockAdmin({ appliesOnSubscription: false, missingNode: true });
r = await ensureSubscriptionEligibility(a, 'GONE');
ok(r === false && a.calls.length === 1, 'missing code => no update');

a = mockAdmin({ appliesOnSubscription: false, userErrors: [{ field: 'id', message: 'nope' }] });
r = await ensureSubscriptionEligibility(a, 'ERRS');
ok(r === false, 'userErrors => false, no throw');

for (const stage of ['check', 'update']) {
  a = mockAdmin({ appliesOnSubscription: false, throwOn: stage });
  let threw = false;
  try { r = await ensureSubscriptionEligibility(a, 'BOOM'); } catch { threw = true; }
  ok(!threw && r === false, `network failure at ${stage} => swallowed (code still servable)`);
}

console.log('');
if (fails > 0) { console.error(`SLICE B BEHAVIOR: ${fails} FAILURE(S)`); process.exit(1); }
console.log('SLICE B BEHAVIOR: ALL CHECKS PASS');
