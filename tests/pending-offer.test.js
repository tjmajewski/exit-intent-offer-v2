// The pending-offer contract: how a shopper who dismissed the modal and kept
// browsing can still claim their code.
//
// Three surfaces read one stored record — the pill on every page, the cart
// banner on /cart, the mini-cart drawer — across two separately-loaded
// storefront assets that share no module. The rules they must agree on are
// pinned here, because a disagreement means a shopper sees an offer on one
// page and nothing on the next.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modal = readFileSync(
  new URL('../extensions/exit-intent-modal/assets/exit-intent-modal.js', import.meta.url), 'utf8');
const cart = readFileSync(
  new URL('../extensions/exit-intent-modal/assets/cart-monitor.js', import.meta.url), 'utf8');

describe('pending offer — survives the tab', () => {
  test('neither asset reads or writes the offer on sessionStorage directly', () => {
    // sessionStorage dies when the tab closes. The modal promises the code is
    // good for 24 hours and the DiscountOffer row agrees, so a shopper who
    // closes the tab and returns must still be able to claim it.
    for (const [name, src] of [['modal', modal], ['cart-monitor', cart]]) {
      assert.ok(!/sessionStorage\.\w+\(\s*'exitIntentPendingOffer'/.test(src),
        `${name} still touches the pending offer on sessionStorage`);
      assert.ok(!/sessionStorage\.\w+\(\s*'exitIntentPillDismissed'/.test(src),
        `${name} still touches the pill dismissal on sessionStorage`);
    }
  });

  test('both assets go through an offerStore that prefers localStorage', () => {
    for (const [name, src] of [['modal', modal], ['cart-monitor', cart]]) {
      assert.match(src, /const offerStore = \{/, `${name} has no offerStore`);
      const store = src.slice(src.indexOf('const offerStore = {'),
        src.indexOf('const offerStore = {') + 700);
      assert.match(store, /localStorage\.getItem/, `${name} offerStore does not read localStorage`);
      assert.match(store, /localStorage\.setItem/, `${name} offerStore does not write localStorage`);
    }
  });

  test('storage access is wrapped so a blocked store cannot break the page', () => {
    // Safari private mode throws on localStorage.setItem. A thrown write must
    // lose the offer, never take the storefront down with it.
    for (const [name, src] of [['modal', modal], ['cart-monitor', cart]]) {
      const store = src.slice(src.indexOf('const offerStore = {'),
        src.indexOf('const offerStore = {') + 700);
      const tries = (store.match(/try \{/g) || []).length;
      assert.ok(tries >= 5, `${name} offerStore has only ${tries} guarded accesses`);
      assert.match(store, /sessionStorage/,
        `${name} offerStore has no fallback when localStorage is blocked`);
    }
  });
});

describe('pending offer — expiry', () => {
  test('both assets share one expiry rule', () => {
    for (const [name, src] of [['modal', modal], ['cart-monitor', cart]]) {
      assert.match(src, /function offerExpired\(offer\)/, `${name} has no offerExpired`);
    }
  });

  test('expiry prefers the code\'s real expiresAt over the save time', () => {
    for (const [name, src] of [['modal', modal], ['cart-monitor', cart]]) {
      const fn = src.slice(src.indexOf('function offerExpired(offer)'),
        src.indexOf('function offerExpired(offer)') + 450);
      assert.match(fn, /offer\.expiresAt/, `${name} ignores the server expiry`);
      assert.match(fn, /24 \* 60 \* 60 \* 1000/, `${name} has no 24h fallback`);
    }
  });

  // Behavioural check of the rule both files implement.
  const offerExpired = (offer) => {
    if (!offer) return true;
    if (offer.expiresAt) {
      const at = Date.parse(offer.expiresAt);
      if (!Number.isNaN(at)) return Date.now() >= at;
    }
    if (offer.timestamp) return Date.now() - offer.timestamp > 24 * 60 * 60 * 1000;
    return false;
  };

  test('a fresh offer is live and a day-old one is not', () => {
    assert.equal(offerExpired({ timestamp: Date.now() }), false);
    assert.equal(offerExpired({ timestamp: Date.now() - 23 * 3600 * 1000 }), false);
    assert.equal(offerExpired({ timestamp: Date.now() - 25 * 3600 * 1000 }), true);
  });

  test('the server expiry wins over the save time in both directions', () => {
    // Saved a minute ago but the code expired: gone.
    assert.equal(offerExpired({
      timestamp: Date.now() - 60000,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }), true);
    // Saved two days ago but the code runs longer: still live.
    assert.equal(offerExpired({
      timestamp: Date.now() - 48 * 3600 * 1000,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    }), false);
  });

  test('an unreadable record is dropped, not shown forever', () => {
    assert.equal(offerExpired(null), true);
    assert.equal(offerExpired(undefined), true);
  });

  test('a garbage expiresAt falls back to the save time rather than vanishing', () => {
    assert.equal(offerExpired({ expiresAt: 'not-a-date', timestamp: Date.now() }), false);
    assert.equal(offerExpired({ expiresAt: 'not-a-date', timestamp: Date.now() - 25 * 3600 * 1000 }), true);
  });

  test('a generic code with no expiry and no timestamp stays live', () => {
    // Generic codes genuinely do not expire; nothing to drop them on.
    assert.equal(offerExpired({ code: 'SAVE10' }), false);
  });
});

describe('pending offer — the stored record carries the expiry', () => {
  test('buildPendingOfferData writes expiresAt from the decision', () => {
    const start = modal.indexOf('    buildPendingOfferData(');
    const fn = modal.slice(start, start + 2200);
    assert.match(fn, /expiresAt: this\.offerExpiresAt/,
      'the stored offer must carry the code\'s real expiry');
  });
});

describe('pending offer — expiry clears the dismissal with it', () => {
  test('both readers drop the dismissal when the offer expires', () => {
    // Otherwise a shopper who dismissed yesterday's pill is permanently opted
    // out of every future one, since the dismissal outlives the offer now that
    // both live in localStorage.
    for (const [name, src] of [['modal', modal], ['cart-monitor', cart]]) {
      const idx = src.indexOf('offerExpired(offer)', src.indexOf('function offerExpired') + 40);
      const reader = src.slice(idx, idx + 320);
      assert.match(reader, /remove\(['"]?(exitIntentPillDismissed|PILL_DISMISSED_KEY)/,
        `${name} leaves a stale dismissal behind after expiry`);
    }
  });
});

describe('every close path saves the offer', () => {
  test('overlay click, ESC and the close button all route to closeModal', () => {
    // "Saved if they click outside the modal or close it" — all of these land
    // in closeModal, which is where the pending offer is written.
    assert.match(modal, /if \(e\.target === this\.modalElement\) \{\s*\n\s*this\.closeModal\(\);/);
    assert.match(modal, /e\.key === 'Escape'[\s\S]{0,80}this\.closeModal\(\)/);
    assert.match(modal, /closeBtn\.onclick = \(\) => this\.closeModal\(\)/);
  });

  test('closeModal is what writes the pending offer', () => {
    const close = modal.slice(modal.indexOf('    closeModal() {'),
      modal.indexOf('    closeModal() {') + 2600);
    assert.match(close, /offerStore\.write\(PILL_OFFER_KEY/,
      'closing the modal must persist the offer for the pill and cart banner');
  });

  test('a shopper who clicked the CTA does not also get a pill', () => {
    const close = modal.slice(modal.indexOf('    closeModal() {'),
      modal.indexOf('    closeModal() {') + 2600);
    assert.match(close, /!this\.ctaClicked/,
      'taking the offer must not leave a reminder to take the offer');
  });
});

describe('super-admin console shows what the shopper saw', () => {
  const summary = readFileSync(
    new URL('../app/components/admin/decision-summary.js', import.meta.url), 'utf8');

  test('placeholders are filled before display', () => {
    // The console printed the raw gene under "Visitor saw:", so an operator
    // read `Your {{amount}} discount expires in 24 hours` and concluded
    // interpolation was broken in production. It was not.
    assert.match(summary, /function interpolate\(text, decision\)/);
    assert.match(summary, /\.map\(part => interpolate\(part, decision\)\)/);
  });

  // Behavioural mirror of the console helper.
  const interpolate = (text, decision) => {
    if (typeof text !== 'string' || !text.includes('{{')) return text;
    const money = (n) => {
      if (n == null || n === '') return null;
      const v = Number(n);
      return Number.isFinite(v) ? `$${v % 1 === 0 ? v : v.toFixed(2)}` : null;
    };
    const amount = decision?.amount;
    const values = {
      '{{amount}}': decision?.type === 'percentage'
        ? (amount == null || amount === '' || !Number.isFinite(Number(amount))
            ? null : String(amount))
        : money(amount),
      '{{threshold}}': money(decision?.threshold),
    };
    let out = text;
    for (const [t, v] of Object.entries(values)) if (v != null) out = out.split(t).join(v);
    return out;
  };

  test('a fixed offer renders as currency', () => {
    assert.equal(
      interpolate('Your {{amount}} discount expires in 24 hours', { type: 'fixed', amount: 45 }),
      'Your $45 discount expires in 24 hours');
  });

  test('a percentage offer renders as a bare number', () => {
    // The % sign lives in the template; adding another would read "20%% off".
    assert.equal(interpolate('{{amount}}% off today', { type: 'percentage', amount: 20 }),
      '20% off today');
  });

  test('every occurrence is replaced, not just the first', () => {
    assert.equal(
      interpolate('Claim {{amount}} — yes, {{amount}}', { type: 'fixed', amount: 45 }),
      'Claim $45 — yes, $45');
  });

  test('a threshold renders alongside the amount', () => {
    assert.equal(
      interpolate('Spend {{threshold}} to save {{amount}}',
        { type: 'threshold', amount: 70, threshold: 1500 }),
      'Spend $1500 to save $70');
  });

  test('a placeholder with nothing to fill it is left standing', () => {
    // A genuinely broken gene must still look broken in the console.
    assert.equal(interpolate('Your {{amount}} off', { type: 'fixed', amount: null }),
      'Your {{amount}} off');
  });

  test('copy with no placeholders is returned untouched', () => {
    assert.equal(interpolate('Ready to finish up?', { type: 'no-discount', amount: 0 }),
      'Ready to finish up?');
  });
});
