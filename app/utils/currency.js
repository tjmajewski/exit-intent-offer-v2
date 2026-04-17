/**
 * Shared currency formatting helpers.
 *
 * Locale-aware: uses the browser's `navigator.language` so a German merchant
 * viewing EUR sees "1.234,56 €" rather than "$1,234.56". Each call site can
 * tune fraction digits to match its UI density (dashboard summaries typically
 * hide cents, conversion tables show cents, discount badges show whole units).
 */

/**
 * Build a currency formatter function bound to the shop's currency code.
 *
 * @param {string} currencyCode - ISO 4217 code (e.g. "USD", "EUR"). Falls back to "USD".
 * @param {object} [options]
 * @param {number} [options.minimumFractionDigits=0]
 * @param {number} [options.maximumFractionDigits=2]
 * @returns {(amount: number|string) => string}
 */
export function createCurrencyFormatter(currencyCode, options = {}) {
  const {
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
  } = options;

  try {
    const locale = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    const fmt = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode || "USD",
      minimumFractionDigits,
      maximumFractionDigits,
    });
    return (amount) => fmt.format(Number(amount) || 0);
  } catch {
    return (amount) => `${currencyCode || "USD"} ${(Number(amount) || 0).toFixed(maximumFractionDigits)}`;
  }
}

/**
 * Format a promo discount amount with correct currency symbol placement.
 * Percentage discounts show as "10% off". Fixed amounts use locale-aware
 * currency formatting (e.g. "$10 off" for USD, "10 € off" for EUR).
 *
 * @param {number|string} amount
 * @param {"percentage"|"fixed_amount"|string} type
 * @param {string} currencyCode
 * @returns {string}
 */
export function formatDiscount(amount, type, currencyCode) {
  if (type === "percentage") return `${amount}% off`;
  const fmt = createCurrencyFormatter(currencyCode, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${fmt(amount)} off`;
}
