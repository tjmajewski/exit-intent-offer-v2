// =============================================================================
// DETERMINISTIC FORMATTERS — hydration safety
//
// `toLocaleDateString()` / `toLocaleString()` with no arguments resolve against
// the *runtime's* locale and timezone. That is UTC/en-US inside the Fly
// container and whatever the shopper or operator has set in their browser. The
// two produce different strings for the same value, so the server HTML and the
// client's first render disagree and React discards the tree — surfacing as
// minified errors 418 / 423 / 425 and a blank page.
//
// Everything rendered during SSR must therefore pin both locale and timezone.
// These helpers are the only sanctioned way to format a date or a number in a
// component. If you need the viewer's local timezone, render a placeholder on
// the server and fill it in after mount (see `useClientValue` below).
// =============================================================================

const LOCALE = 'en-US';
const TZ = 'UTC';

/** "Sep 18, 2026" — stable on both sides of hydration. */
export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, {
    timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric',
  });
}

/** "Sep 18, 2026, 14:32 UTC" — the suffix is deliberate; the time is not local. */
export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleString(LOCALE, {
    timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })} UTC`;
}

// The operator console is read by one person, in US Eastern. A UTC timestamp
// there is arithmetic they have to do in their head on every row, and getting
// it wrong is how a decision at 2am looks like a decision at lunchtime.
//
// Pinning the ZONE (rather than reading the viewer's) keeps this deterministic
// across SSR and hydration exactly like the UTC helpers above: the server and
// the browser both resolve America/New_York, so the strings agree. Intl
// applies the DST rule for the instant being formatted, so a July row prints
// EDT and a January row prints EST without any manual offset.
const TZ_ET = 'America/New_York';

/** "2:07p" — compact clock for a dense table cell, Eastern. */
export function fmtTimeET(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d
    .toLocaleString(LOCALE, {
      timeZone: TZ_ET, hour: 'numeric', minute: '2-digit', hour12: true,
    })
    .replace(/\s?AM$/, 'a')
    .replace(/\s?PM$/, 'p');
}

/** "Sep 24" — the date half of the same cell, Eastern. */
export function fmtDayET(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, { timeZone: TZ_ET, month: 'short', day: 'numeric' });
}

/** "Sep 24, 2026, 2:07 PM EDT" — the full stamp, for a detail pane or tooltip. */
export function fmtDateTimeET(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(LOCALE, {
    timeZone: TZ_ET, year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  });
}

/** Thousands separators pinned to en-US ("1,234" never "1.234"). */
export function fmtNum(value, opts = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(LOCALE, opts);
}

/** "$1,234" — whole dollars by default. */
export function fmtMoney(value, opts = { maximumFractionDigits: 0 }) {
  return `$${fmtNum(value, opts)}`;
}
