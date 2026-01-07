import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { PrismaClient } from "@prisma/client";

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const tier = formData.get("tier");
  
  if (!['starter', 'pro', 'enterprise'].includes(tier)) {
    return redirect("/app");
  }
  
  const db = new PrismaClient();
  
  await db.shop.upsert({
    where: { shopifyDomain: session.shop },
    update: { plan: tier },
    create: { 
      shopifyDomain: session.shop,
      plan: tier
    }
  });
  
  await db.$disconnect();
  
  return redirect(request.headers.get("Referer") || "/app");
}
