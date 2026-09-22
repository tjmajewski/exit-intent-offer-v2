// The two dashboard tiles: "With Resparq" vs "Without Resparq (Control)".
//
// The unit is the CUSTOMER, not the session. The holdout coin is a sticky
// per-visitor hash, so one visitor's every page load lands in the same arm and
// the arms do not produce rows at the same rate — the live store's first
// control visitor produced 5 rows in 28 seconds against ~1.7 for a typical
// treated visitor. A pair of rates built on rows compares browsing depth as
// much as behaviour, so these tests pin the denominator as much as the maths.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shapeArms, CONTROL_CUSTOMER_MINIMUM } from '../app/utils/shop-metrics.server.js';

const rows = (treated, control, crossed = 0) => [
  { holdout: false, customers: treated[0], converted: treated[1], crossed: 0 },
  { holdout: true, customers: control[0], converted: control[1], crossed: 0 },
  // The query emits the crossed-arms tally as its own row with a null arm.
  { holdout: null, customers: 0, converted: 0, crossed }
];

describe('arm tiles — rate arithmetic', () => {
  test('each arm divides its own conversions by its own customers', () => {
    const a = shapeArms(rows([32, 2], [20, 1]));
    assert.equal(a.treated.customers, 32);
    assert.equal(a.treated.converted, 2);
    assert.ok(Math.abs(a.treated.rate - 6.25) < 1e-9);
    assert.equal(a.control.customers, 20);
    assert.ok(Math.abs(a.control.rate - 5) < 1e-9);
  });

  test('an arm with no customers reports 0 rather than dividing by zero', () => {
    const a = shapeArms(rows([0, 0], [0, 0]));
    assert.equal(a.treated.rate, 0);
    assert.equal(a.control.rate, 0);
    assert.ok(Number.isFinite(a.treated.rate));
    assert.ok(Number.isFinite(a.control.rate));
  });

  test('a missing arm row is treated as empty, not as undefined', () => {
    const a = shapeArms([{ holdout: false, customers: 12, converted: 1 }]);
    assert.equal(a.control.customers, 0);
    assert.equal(a.control.converted, 0);
    assert.equal(a.control.rate, 0);
  });

  test('no rows at all still returns a renderable shape', () => {
    for (const input of [[], null, undefined]) {
      const a = shapeArms(input);
      assert.equal(a.treated.customers, 0);
      assert.equal(a.control.customers, 0);
      assert.equal(a.controlReady, false);
    }
  });
});

describe('arm tiles — the control gate', () => {
  test('control stays TBD below the minimum', () => {
    for (let n = 0; n < CONTROL_CUSTOMER_MINIMUM; n++) {
      assert.equal(shapeArms(rows([50, 3], [n, 0])).controlReady, false,
        `${n} control customers should not unlock a rate`);
    }
  });

  test('control unlocks exactly at the minimum, not one short', () => {
    assert.equal(shapeArms(rows([50, 3], [CONTROL_CUSTOMER_MINIMUM - 1, 0])).controlReady, false);
    assert.equal(shapeArms(rows([50, 3], [CONTROL_CUSTOMER_MINIMUM, 0])).controlReady, true);
    assert.equal(shapeArms(rows([50, 3], [CONTROL_CUSTOMER_MINIMUM + 40, 2])).controlReady, true);
  });

  test('the gate counts customers, never conversions', () => {
    // A control arm big enough to read is big enough whether or not anyone in
    // it has ordered. Gating on conversions instead would hide precisely the
    // result that matters — a control group that converts at zero.
    const zeroConversions = shapeArms(rows([50, 3], [CONTROL_CUSTOMER_MINIMUM, 0]));
    assert.equal(zeroConversions.controlReady, true);
    assert.equal(zeroConversions.control.rate, 0);
  });

  test('the treated tile does not wait on the control gate', () => {
    // Intention-to-treat is readable from day one; only the comparison waits.
    const a = shapeArms(rows([32, 2], [1, 0]));
    assert.equal(a.controlReady, false);
    assert.ok(a.treated.rate > 0);
  });

  test('the minimum is carried in the payload so the tile can name it', () => {
    const a = shapeArms(rows([5, 0], [3, 0]));
    assert.equal(a.controlMinimum, CONTROL_CUSTOMER_MINIMUM);
  });
});

describe('arm tiles — a visitor belongs to one arm', () => {
  // HOLDOUT_RATE went 5% -> 10% and assignment is a sticky per-visitor hash,
  // so every visitor in buckets 5..9 was treated before that deploy and is
  // control after it. Rows for such a visitor exist in both arms.

  test('the crossed-arms tally is reported, not folded into an arm', () => {
    const a = shapeArms(rows([30, 2], [12, 1], 4));
    assert.equal(a.crossedArms, 4);
    assert.equal(a.treated.customers, 30, 'crossed visitors must not inflate treated');
    assert.equal(a.control.customers, 12, 'crossed visitors must not inflate control');
  });

  test('the null-arm tally row is never mistaken for the treated arm', () => {
    // Boolean(null) === false, so a naive arm match would return the tally row
    // for the treated arm and report 0 treated customers on every shop.
    const a = shapeArms([
      { holdout: null, customers: 0, converted: 0, crossed: 7 },
      { holdout: false, customers: 41, converted: 3, crossed: 0 }
    ]);
    assert.equal(a.treated.customers, 41);
    assert.equal(a.crossedArms, 7);
  });

  test('crossedArms is 0 when the query returns no tally row', () => {
    const a = shapeArms([
      { holdout: false, customers: 10, converted: 1 },
      { holdout: true, customers: 10, converted: 0 }
    ]);
    assert.equal(a.crossedArms, 0);
  });

  test('the arms query resolves each visitor before counting', () => {
    const metrics = readFileSync(
      new URL('../app/utils/shop-metrics.server.js', import.meta.url), 'utf8'
    );
    // Counting rows grouped by isHoldout is the shape this replaced; a visitor
    // with rows in both arms landed in both denominators.
    assert.match(metrics, /WITH per_visitor AS/);
    assert.match(metrics, /WHERE any_holdout <> any_treated/);
  });
});

describe('arm tiles — failure is contained', () => {
  test('a failing arms query returns null instead of throwing', async () => {
    // getShopMetrics runs this inside a shared Promise.all. A rejection there
    // propagates to the dashboard loader's catch, which replaces every number
    // on the page with zeroes — the merchant reads $0 revenue rather than two
    // hidden tiles. Production applies schema with `prisma db push` at boot,
    // so a request served before the new column exists hits exactly this.
    const metrics = readFileSync(
      new URL('../app/utils/shop-metrics.server.js', import.meta.url), 'utf8'
    );
    const fn = metrics.slice(
      metrics.indexOf('async function armsByCustomer'),
      metrics.indexOf('export function shapeArms')
    );
    assert.match(fn, /try \{/, 'armsByCustomer must not let its query escape');
    assert.match(fn, /return null;/, 'a failed arms query degrades to hidden tiles');
  });

  test('the tiles render nothing when arms is null', () => {
    const dashboard = readFileSync(
      new URL('../app/routes/app._index.jsx', import.meta.url), 'utf8'
    );
    assert.match(dashboard, /&& arms && \(/);
  });
});

describe('arm tiles — intention to treat', () => {
  test('treated counts every assigned customer, not just the ones shown a modal', () => {
    // 32 customers landed in treatment. Only 13 were ever shown anything; the
    // rest were decided-for and never rendered, or deliberately left alone.
    // All 32 belong in the denominator: filtering to the ones who saw a modal
    // selects on a post-randomisation event correlated with the outcome, and
    // the two arms stop being comparable.
    const a = shapeArms(rows([32, 2], [20, 1]));
    assert.equal(a.treated.customers, 32,
      'treated denominator must be every assigned customer');
    assert.ok(a.treated.rate < 2 / 13 * 100,
      'ITT rate must be lower than the shown-only rate, or it is not ITT');
  });
});

describe('holdout rate', () => {
  const source = readFileSync(
    new URL('../app/routes/apps.exit-intent.api.ai-decision.jsx', import.meta.url),
    'utf8'
  );

  test('the coin is set to 10%', () => {
    assert.match(source, /const HOLDOUT_RATE = 0\.10;/,
      'HOLDOUT_RATE must be 0.10 — 5% left the control arm dominating the error term');
  });

  test('assignment is still a sticky per-visitor hash, not per request', () => {
    // Per-request randomness flickers a visitor between arms across page loads
    // and contaminates the measurement in both directions. Raising the rate
    // must not quietly revert that.
    assert.match(source, /fnv1a\(`\$\{holdoutVisitorId\}:\$\{shopRecord\.id\}`\) % 100\) < HOLDOUT_RATE \* 100/);
  });

  test('the sticky hash lands close to the configured rate', () => {
    // Reimplements the endpoint's hash so a change to either side shows up as
    // a failure here rather than as a silently mis-sized control group.
    const fnv1a = (str) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h >>> 0;
    };
    const shopId = 'shop-under-test';
    let held = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      if ((fnv1a(`v_visitor_${i}:${shopId}`) % 100) < 10) held++;
    }
    const pct = (held / N) * 100;
    assert.ok(pct > 8.5 && pct < 11.5, `expected ~10% holdout, got ${pct.toFixed(2)}%`);
  });

  test('the same visitor always resolves to the same arm', () => {
    const fnv1a = (str) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h >>> 0;
    };
    const key = 'v_mu4ad19o151rn6bp:shop-under-test';
    const first = (fnv1a(key) % 100) < 10;
    for (let i = 0; i < 50; i++) {
      assert.equal((fnv1a(key) % 100) < 10, first);
    }
  });
});

describe('manual mode', () => {
  const dashboard = readFileSync(
    new URL('../app/routes/app._index.jsx', import.meta.url),
    'utf8'
  );

  test('the tile pair is gated on having a control arm, not on AI mode', () => {
    // Manual mode randomises nothing, so there is no control arm and the
    // comparison is meaningless. But hybrid/Guided DOES run the holdout coin,
    // and gating on isAIMode (which is `=== 'ai'`) would have made a Guided
    // shop pay for a control group it could never see.
    assert.match(dashboard, /\{hasControlArm && arms && \(/);
  });

  test('Guided mode counts as having a control arm', () => {
    assert.match(
      dashboard,
      /const hasControlArm = \(settings\?\.mode === 'ai' \|\| settings\?\.mode === 'hybrid'\)/
    );
  });

  test('the lifetime metrics call skips the arm query', () => {
    // Only the 30-day window feeds the tiles; computing arms from epoch on the
    // lifetime call is a discarded full scan on every dashboard load.
    assert.match(dashboard, /days: null, mode: shopMode, includeArms: false/);
  });

  // Match RENDERED labels only — a label sitting on its own line between JSX
  // tags. Substring matching would also hit the prose in the comment that
  // explains why these tiles were removed, and pass or fail on the wrong text.
  const renderedLabels = new Set(
    dashboard.split('\n').map(l => l.trim()).filter(Boolean)
  );

  test('the "Times Shown" tile is gone', () => {
    assert.ok(!renderedLabels.has('Times Shown'),
      'the display-count tile was replaced by the arm comparison');
  });

  test('the click tiles are gone', () => {
    // Clicks are not the mechanism for a view-through attention product, and
    // two of three tiles reporting 0% actively undersold it.
    assert.ok(!renderedLabels.has('People Clicked'));
    assert.ok(!renderedLabels.has('Click Rate'));
  });

  test('both tiles are labelled in merchant vocabulary', () => {
    assert.ok(renderedLabels.has('With Resparq'));
    assert.ok(renderedLabels.has('Without Resparq (Control)'));
  });
});
