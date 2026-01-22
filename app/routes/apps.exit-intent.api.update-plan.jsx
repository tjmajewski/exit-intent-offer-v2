import { authenticate } from "../shopify.server.js";
import { json } from "@remix-run/node";

export async function action({ request }) {
  const { default: db } = await import("../db.server.js");
  try {
    const { session } = await authenticate.admin(request);
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
