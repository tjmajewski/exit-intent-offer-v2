import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function checkPlanData() {
  console.log('\n🔍 CHECKING PLAN DATA IN METAFIELDS:');
  console.log('='.repeat(50));
  
  // This would need Shopify admin API access
  // For now, let's just show what the dashboard expects
  
  console.log('\nThe dashboard expects plan data like this:');
  console.log(JSON.stringify({
    tier: "pro",
    status: "active",
    usage: {
      impressionsThisMonth: 73,
      resetDate: "2026-02-07T00:00:00.000Z"
    }
  }, null, 2));
  
  console.log('\n✅ If your plan has this structure, the counter will show');
  console.log('❌ If usage is missing, the counter won\'t render');
  
  console.log('\n📋 Current tiers and their limits:');
  console.log('- starter: 1,000 sessions (shows counter)');
  console.log('- pro: 10,000 sessions (shows counter)');
  console.log('- enterprise: unlimited (NO counter shown)\n');
}

checkPlanData()
  .catch(console.error)
  .finally(() => db.$disconnect());
