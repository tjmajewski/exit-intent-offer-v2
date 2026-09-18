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
