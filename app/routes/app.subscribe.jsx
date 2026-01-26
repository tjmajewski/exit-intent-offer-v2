import { authenticate, BILLING_PLANS } from "../shopify.server";

const PLAN_NAME_MAP = {
  "starter-monthly": BILLING_PLANS.STARTER_MONTHLY,
  "starter-annual": BILLING_PLANS.STARTER_ANNUAL,
  "pro-monthly": BILLING_PLANS.PRO_MONTHLY,
  "pro-annual": BILLING_PLANS.PRO_ANNUAL,
  "enterprise-monthly": BILLING_PLANS.ENTERPRISE_MONTHLY,
  "enterprise-annual": BILLING_PLANS.ENTERPRISE_ANNUAL,
};

/**
 * Dedicated billing route. Navigating here triggers billing.request()
 * in the loader, which properly handles the App Bridge redirect
 * to Shopify's charge approval page.
 *
 * URL: /app/subscribe?tier=pro&cycle=monthly
 */
export async function loader({ request }) {
  const { billing } = await authenticate.admin(request);

  const url = new URL(request.url);
  const tier = url.searchParams.get("tier");
  const cycle = url.searchParams.get("cycle") || "monthly";

  const planKey = `${tier}-${cycle}`;
  const planName = PLAN_NAME_MAP[planKey];

  if (!planName) {
    throw new Response("Invalid plan", { status: 400 });
  }

  const appUrl = process.env.SHOPIFY_APP_URL || url.origin;

  await billing.request({
    plan: planName,
    isTest: true,
    returnUrl: `${appUrl}/app/billing-callback?tier=${tier}&cycle=${cycle}`,
  });
}
