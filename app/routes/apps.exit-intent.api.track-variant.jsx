import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { trackVariantPerformance } from "../utils/copy-variants.js";

const db = new PrismaClient();

export async function action({ request }) {
  try {
    await authenticate.public.appProxy(request);
    const body = await request.json();
    const { shop, variantId, event, revenue } = body;
    
    if (!shop || !variantId || !event) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }
    
    // Find shop in database
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });
    
    if (!shopRecord) {
      return json({ error: "Shop not found" }, { status: 404 });
    }
    
    await trackVariantPerformance(db, shopRecord.id, variantId, event, revenue || 0);
    
    console.log(`[Track Variant] ${event} tracked for variant ${variantId}`);
    
    return json({ success: true });
  } catch (error) {
    console.error("[Track Variant] Error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}