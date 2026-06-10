import { redirect } from "react-router";
import { authenticate } from "../shopify.server.js";

export async function action({ request }) {
  const { default: db } = await import("../db.server.js");
  const { session, admin } = await authenticate.admin(request);

  // SECURITY: this is the DEV plan switcher — it sets any tier with no billing
  // check. The UI control (DevPlanSwitcher) is tree-shaken out of production
  // bundles, but the route handler still runs in prod, so a merchant could POST
  // here directly to unlock Enterprise for free. Gate the handler server-side.
  // Real upgrades go through /app/upgrade → Shopify billing → billing-callback.
  if (process.env.NODE_ENV === "production") {
    console.warn(`[Dev Update Plan] Blocked in production for ${session.shop}`);
    return redirect("/app/upgrade");
  }

  const formData = await request.formData();
  const tier = formData.get("tier");

  if (!['starter', 'pro', 'enterprise'].includes(tier)) {
    return redirect("/app");
  }
  
  // Get shop ID for metafield update
  const shopResponse = await admin.graphql(`
    query {
      shop {
        id
        plan: metafield(namespace: "exit_intent", key: "plan") {
          value
        }
      }
    }
  `);
  const shopData = await shopResponse.json();
  const shopId = shopData.data.shop.id;
  
  // Update plan in metafields (source of truth for all pages)
  const currentPlan = shopData.data.shop?.plan?.value 
    ? JSON.parse(shopData.data.shop.plan.value)
    : { tier: "starter", status: "active" };
  
  currentPlan.tier = tier;
  
  await admin.graphql(`
    mutation UpdatePlan($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [{
        ownerId: $ownerId
        namespace: "exit_intent"
        key: "plan"
        value: $value
        type: "json"
      }]) {
        metafields { id }
      }
    }
  `, {
    variables: {
      ownerId: shopId,
      value: JSON.stringify(currentPlan)
    }
  });
  
  // Also update database for consistency
  await db.shop.upsert({
    where: { shopifyDomain: session.shop },
    update: { plan: tier },
    create: {
      shopifyDomain: session.shop,
      plan: tier
    }
  });
  
  return redirect(request.headers.get("Referer") || "/app");
}
