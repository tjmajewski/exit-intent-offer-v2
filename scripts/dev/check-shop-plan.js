import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function checkShopPlan() {
  const shops = await db.shop.findMany({
    select: {
      shopifyDomain: true,
      plan: true,
      mode: true
    }
  });
  
  console.log('Shops in database:');
  console.log(JSON.stringify(shops, null, 2));
  
  await db.$disconnect();
}

checkShopPlan();
