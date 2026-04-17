import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function simulateBudgetExhaustion() {
  console.log('\n💸 SIMULATING BUDGET EXHAUSTION');
  console.log('='.repeat(60));
  
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: 'exit-intent-test-2.myshopify.com' }
  });
  
  if (!shop) {
    console.log('❌ Shop not found');
    return;
  }
  
  console.log(`\n📊 Current budget: $${shop.budgetAmount} per ${shop.budgetPeriod}`);
  
  // Create fake discount offers to exhaust budget
  console.log('\n🎯 Creating test discount offers...');
  
  const offers = [
    { amount: 30, code: 'TEST30OFF' },
    { amount: 40, code: 'TEST40OFF' },
    { amount: 35, code: 'TEST35OFF' }
  ];
  
  for (const offer of offers) {
    await db.discountOffer.create({
      data: {
        shopId: shop.id,
        discountCode: offer.code,
        offerType: 'percentage',
        amount: offer.amount,
        cartValue: 100,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        redeemed: false
      }
    });
    console.log(`   Created: ${offer.code} ($${offer.amount})`);
  }
  
  // Check budget
  const { checkBudget } = await import('./app/utils/ai-decision.js');
  const budgetCheck = await checkBudget(db, shop.id, shop.budgetPeriod);
  
  console.log('\n💰 Budget Status:');
  console.log(`   Total spent: $${budgetCheck.totalSpent}`);
  console.log(`   Remaining: $${budgetCheck.remaining}`);
  console.log(`   Has room: ${budgetCheck.hasRoom ? '✅ YES' : '❌ NO'}`);
  
  if (!budgetCheck.hasRoom) {
    console.log('\n🎉 SUCCESS! Budget cap is working - AI will offer 0% discount');
  } else {
    console.log('\n⚠️  Budget still has room - need more test offers');
  }
  
  console.log('\n🧹 Cleaning up test offers...');
  await db.discountOffer.deleteMany({
    where: {
      shopId: shop.id,
      discountCode: {
        startsWith: 'TEST'
      }
    }
  });
  console.log('   ✓ Test offers removed\n');
}

simulateBudgetExhaustion()
  .catch(console.error)
  .finally(() => db.$disconnect());
