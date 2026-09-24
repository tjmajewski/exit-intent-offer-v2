// The formatters, and the hydration rule they exist to keep.
//
// format.js opens with a warning: `toLocaleString()` with no arguments
// resolves against the RUNTIME's locale and timezone, which is UTC inside the
// Fly container and whatever the operator's laptop is set to in the browser.
// The two disagree, React discards the tree, and the page renders blank with a
// minified 418/423/425. Every helper in that file exists to make one string
// that both sides produce identically.
//
// The file had no tests at all. These pin the rule itself, not just the
// output: a helper that stops pinning its timezone is a blank admin page.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fmtDate, fmtDateTime, fmtTimeET, fmtDayET, fmtDateTimeET } from '../app/utils/format.js';

const src = readFileSync(new URL('../app/utils/format.js', import.meta.url), 'utf8');

describe('every formatter pins its timezone', () => {
  // Comments stripped: the file's own header quotes the unsafe call as the
  // thing to avoid, and fmtNum formats a number, which has no timezone.
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const dateCalls = code.match(/\bd\s*(?:\n\s*)?\.\s*toLocale(?:Date|Time)?String\([\s\S]*?\n?\s*\}\)/g) || [];

  test('no date formatter omits a timeZone', () => {
    // The failure this catches is silent in dev (the container and a laptop
    // can agree) and fatal in production.
    assert.ok(dateCalls.length >= 5, `only found ${dateCalls.length} date formatters — this test has gone vacuous`);
    for (const call of dateCalls) {
      assert.ok(/timeZone:/.test(call), `a formatter renders without a pinned timeZone: ${call.slice(0, 90)}`);
    }
  });

  test('no formatter reads the runtime locale', () => {
    assert.equal((code.match(/toLocale(?:Date|Time)?String\(\s*\)/g) || []).length, 0,
      'a formatter resolves against the runtime locale');
    for (const call of dateCalls) {
      assert.ok(/\(\s*LOCALE\b/.test(call), `a formatter does not pin its locale: ${call.slice(0, 90)}`);
    }
  });
});

describe('Eastern time, across the boundary that catches people', () => {
  // Fly runs UTC. An operator reading these in Eastern was doing the offset in
  // their head on every row, and getting it wrong is how a 2am decision looks
  // like one made at lunchtime.
  test('summer is EDT, winter is EST, with no hand-rolled offset', () => {
    assert.match(fmtDateTimeET('2026-07-15T18:30:00Z'), /2:30 PM EDT/);
    assert.match(fmtDateTimeET('2026-01-15T18:30:00Z'), /1:30 PM EST/);
    assert.ok(!/getTimezoneOffset|[-+]\s*(4|5)\s*\*\s*60/.test(src), 'the offset is computed by hand somewhere');
  });

  test('the spring-forward gap and the fall-back repeat both resolve', () => {
    // 2026-03-08 02:00 ET does not exist; 2026-11-01 01:00 ET happens twice.
    assert.match(fmtDateTimeET('2026-03-08T06:59:00Z'), /1:59 AM EST/);
    assert.match(fmtDateTimeET('2026-03-08T07:00:00Z'), /3:00 AM EDT/);
    assert.match(fmtDateTimeET('2026-11-01T05:30:00Z'), /1:30 AM EDT/);
    assert.match(fmtDateTimeET('2026-11-01T06:30:00Z'), /1:30 AM EST/);
  });

  test('a date near midnight lands on the right ET day, not the UTC one', () => {
    // 01:00 UTC is still the previous evening in New York. Getting this wrong
    // files a decision under tomorrow.
    assert.equal(fmtDayET('2026-09-25T01:00:00Z'), 'Sep 24');
    assert.equal(fmtTimeET('2026-09-25T01:00:00Z'), '9:00p');
  });

  test('the compact clock is compact, and unambiguous about half the day', () => {
    assert.equal(fmtTimeET('2026-09-24T16:07:00Z'), '12:07p');
    assert.equal(fmtTimeET('2026-09-24T04:07:00Z'), '12:07a');
    // The suffix strip has to survive a narrow no-break space: ICU switched
    // U+0020 to U+202F before AM/PM, and a version skew between the container
    // and a browser is exactly the hydration mismatch this file guards against.
    for (const value of ['2026-09-24T16:07:00Z', '2026-01-24T16:07:00Z']) {
      assert.ok(!/[\sAPM\u202f]{2,}$/.test(fmtTimeET(value)), `unstripped suffix: ${fmtTimeET(value)}`);
      assert.match(fmtTimeET(value), /^\d{1,2}:\d{2}[ap]$/);
    }
  });
});

describe('absent stays absent', () => {
  test('nothing invents a date it was not given', () => {
    for (const fn of [fmtDate, fmtDateTime, fmtTimeET, fmtDayET, fmtDateTimeET]) {
      assert.equal(fn(null), '—', `${fn.name} rendered a null`);
      assert.equal(fn(undefined), '—', `${fn.name} rendered an undefined`);
      assert.equal(fn(''), '—', `${fn.name} rendered an empty string`);
      assert.equal(fn('not a date'), '—', `${fn.name} rendered garbage as a date`);
    }
  });
});
