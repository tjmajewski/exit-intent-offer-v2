import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { default: db } = await import("../db.server.js");
  const { session } = await authenticate.admin(request);

  // Dev-only diagnostic. Never run in production — an evolution cycle is
  // expensive and any merchant could trigger it on their own shop.
  // eslint-disable-next-line no-undef
  if (process.env.NODE_ENV === "production") {
    console.warn(`[Test Evolution] Blocked in production for ${session.shop}`);
    return json({ success: false, error: "Not available" }, { status: 403 });
  }

  // Get shop
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop }
  });
  
  if (!shop) {
    return json({ error: "Shop not found" });
  }
  
  // Import evolution function
  const { evolutionCycle } = await import("../utils/variant-engine.js");
  
  // Run evolution cycle for first baseline
  console.log("\n TEST: Running evolution cycle with custom settings...");
  
  try {
    const result = await evolutionCycle(shop.id, 'conversion_with_discount', 'all');
    
    return json({
      success: true,
      shopSettings: {
        mutationRate: shop.mutationRate,
        crossoverRate: shop.crossoverRate,
        selectionPressure: shop.selectionPressure,
        populationSize: shop.populationSize
      },
      evolutionResult: result,
      message: "Check console logs to see if your custom settings were used!"
    });
  } catch (error) {
    return json({
      success: false,
      error: error.message
    });
  }
}

export default function TestEvolution() {
  return <div>Check your terminal/logs for evolution test results!</div>;
}
