import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function setTestData() {
  const shopId = 'aa3a1d44-aa3b-45d2-b86c-a57b3fbc5fdc';
  
  const updated = await db.shop.update({
    where: { id: shopId },
    data: {
      orderCount: 5000,
      customerCount: 2500,
      avgRating: 4.8,
      reviewCount: 1200,
      socialProofEnabled: true,
      socialProofType: 'orders',
      socialProofMinimum: 100,
      socialProofUpdatedAt: new Date()
    }
  });
  
  console.log('✅ Test data set for shop:', updated.shopifyDomain);
  console.log('   Orders:', updated.orderCount);
  console.log('   Customers:', updated.customerCount);
  console.log('   Rating:', updated.avgRating);
  
  await db.$disconnect();
}

setTestData();
