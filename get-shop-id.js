import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function getShops() {
  const shops = await db.shop.findMany({
    select: {
      id: true,
      shopifyDomain: true,
      orderCount: true,
      customerCount: true,
      socialProofEnabled: true
    }
  });
  
  console.log('📊 Shops in database:\n');
  shops.forEach(shop => {
    console.log(`ID: ${shop.id}`);
    console.log(`Domain: ${shop.shopifyDomain}`);
    console.log(`Orders: ${shop.orderCount || 0}`);
    console.log(`Customers: ${shop.customerCount || 0}`);
    console.log(`Social Proof Enabled: ${shop.socialProofEnabled ?? true}`);
    console.log('---\n');
  });
  
  await db.$disconnect();
}

getShops();
