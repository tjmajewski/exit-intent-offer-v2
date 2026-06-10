import { authenticate } from "../shopify.server.js";
import { json } from "@remix-run/node";

export async function action({ request }) {
  const { default: db } = await import("../db.server.js");
  try {
    const { session } = await authenticate.admin(request);

    // SECURITY: orphaned dev/test endpoint that sets any tier with no billing
    // check (no caller in the app). Like /app/dev-update-plan it must never run
    // in production — a merchant could self-upgrade to Enterprise for free.
    // Real upgrades go through /app/upgrade → Shopify billing → billing-callback.
    if (process.env.NODE_ENV === "production") {
      console.warn(`[Update Plan API] Blocked in production for ${session.shop}`);
      return json({ success: false, error: 'Not available' }, { status: 403 });
    }

    const { tier } = await request.json();

    if (!['starter', 'pro', 'enterprise'].includes(tier)) {
      return json({ success: false, error: 'Invalid tier' }, { status: 400 });
    }

    await db.shop.update({
      where: { shopifyDomain: session.shop },
      data: { plan: tier }
    });
    
    return json({ success: true });
    
  } catch (error) {
    console.error('[Update Plan API] Error:', error);
    return json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
