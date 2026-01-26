import { authenticate } from "../shopify.server";
import { createSubscription } from "../utils/billing.server";

/**
 * Resource route (no default export) that creates a Shopify subscription
 * and returns the confirmationUrl as JSON.
 *
 * Called via fetch() from the upgrade page. App Bridge automatically
 * adds session token headers to fetch() calls within the embedded app.
 *
 * GET /app/api/create-subscription?tier=pro&cycle=monthly
 */
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const tier = url.searchParams.get("tier");
  const cycle = url.searchParams.get("cycle") || "monthly";

  if (!tier || !["starter", "pro", "enterprise"].includes(tier)) {
    return Response.json({ error: "Invalid tier" }, { status: 400 });
  }

  const appUrl = process.env.SHOPIFY_APP_URL || url.origin;
  const returnUrl = `${appUrl}/app/billing-callback?tier=${tier}&cycle=${cycle}`;

  try {
    const { confirmationUrl } = await createSubscription(
      admin,
      tier,
      cycle,
      returnUrl,
      true,
    );
    return Response.json({ confirmationUrl });
  } catch (error) {
    console.error("[Billing API] Error creating subscription:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
