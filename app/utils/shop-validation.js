/**
 * Validates a Shopify shop domain string.
 *
 * Accepts only lowercase alphanumeric + hyphen subdomains under
 * `.myshopify.com`, which is the canonical form Shopify uses everywhere.
 * Rejects malformed values before they reach the DB layer so route logic
 * can't be confused by weird inputs.
 */
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function isValidShopDomain(shop) {
  return typeof shop === "string" && shop.length <= 255 && SHOP_DOMAIN_RE.test(shop);
}
