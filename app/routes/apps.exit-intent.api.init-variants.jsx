import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { initializeCopyVariants } from "../utils/copy-variants.js";

const db = new PrismaClient();

export async function action({ request }) {
  try {
    await authenticate.public.appProxy(request);
    const { shop } = await request.json();
    
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shop }
    });
    
    if (!shopRecord) {
      return json({ error: "Shop not found" }, { status: 404 });
    }
    
    await initializeCopyVariants(db, shopRecord.id);
    
    return json({ success: true, message: "Variants initialized" });
  } catch (error) {
    console.error("[Init Variants] Error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}