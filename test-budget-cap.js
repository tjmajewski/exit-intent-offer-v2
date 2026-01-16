import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function testBudgetCap() {
  console.log('\n💰 TESTING BUDGET CAP LOGIC');
  console.log('='.repeat(60));
  
  // Get shop settings
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: 'exit-intent-test-2.myshopify.com' }
  });
  
  if (!shop) {
    console.log('❌ Shop not found');
    return;
  }
  
  console.log('\n📊 Current Settings:');
  console.log(`Mode: ${shop.mode}`);
  console.log(`AI Goal: ${shop.aiGoal}`);
  console.log(`Base Aggression: ${shop.aggression}`);
  console.log(`Budget Enabled: ${shop.budgetEnabled}`);
  console.log(`Budget Amount: $${shop.budgetAmount}`);
  console.log(`Budget Period: ${shop.budgetPeriod}`);
  
  // Simulate budget scenarios
  console.log('\n🧪 TESTING SCENARIOS:');
  console.log('='.repeat(60));
  
  const scenarios = [
    { spent: 0, expected: 5 },
    { spent: 50, expected: 5 },
    { spent: 80, expected: 5 },
    { spent: 99, expected: 5 },
    { spent: 100, expected: 0 },
    { spent: 150, expected: 0 }
  ];
  
  scenarios.forEach(({ spent, expected }) => {
    const budgetRemaining = shop.budgetAmount - spent;
    const shouldOffer = budgetRemaining > 0;
    const effectiveAggression = shouldOffer ? shop.aggression : 0;
    
    const status = effectiveAggression === expected ? '✅' : '❌';
    console.log(`\n${status} Budget spent: $${spent} | Remaining: $${budgetRemaining}`);
    console.log(`   Expected aggression: ${expected} | Actual: ${effectiveAggression}`);
    
    if (effectiveAggression !== expected) {
      console.log(`   ⚠️  MISMATCH! Logic may be broken`);
    }
  });
  
  console.log('\n📝 NOTES:');
  console.log('- Budget cap should force aggression to 0 when budget is exhausted');
  console.log('- AI will still show modal but offer 0% discount');
  console.log('- Budget resets based on budgetPeriod (week/month)');
  console.log('');
}

testBudgetCap()
  .catch(console.error)
  .finally(() => db.$disconnect());