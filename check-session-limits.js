import { PrismaClient } from '@prisma/client';
import { PLAN_FEATURES, checkUsageLimit } from './app/utils/featureGates.js';

const db = new PrismaClient();

async function testSessionLimits() {
  console.log('\n📊 PLAN SESSION LIMITS:');
  console.log('='.repeat(50));
  
  Object.entries(PLAN_FEATURES).forEach(([tier, features]) => {
    const limit = features.impressionLimit;
    console.log(`${tier.toUpperCase()}: ${limit ? limit.toLocaleString() + ' sessions' : 'Unlimited'}`);
  });
  
  console.log('\n🧪 TESTING USAGE CHECK:');
  console.log('='.repeat(50));
  
  // Test different scenarios
  const testPlans = [
    {
      tier: 'starter',
      usage: { impressionsThisMonth: 847 }
    },
    {
      tier: 'starter',
      usage: { impressionsThisMonth: 950 }
    },
    {
      tier: 'pro',
      usage: { impressionsThisMonth: 8500 }
    },
    {
      tier: 'pro',
      usage: { impressionsThisMonth: 9800 }
    },
    {
      tier: 'enterprise',
      usage: { impressionsThisMonth: 50000 }
    }
  ];
  
  testPlans.forEach(plan => {
    const result = checkUsageLimit(plan, 'impressionsThisMonth');
    const status = result.allowed ? '✅ ALLOWED' : '🚫 BLOCKED';
    const warning = result.percentage >= 80 && result.percentage < 100 ? '⚠️  WARNING' : '';
    
    console.log(`\n${plan.tier.toUpperCase()}: ${result.usage.toLocaleString()} / ${result.limit ? result.limit.toLocaleString() : '∞'} (${result.percentage}%)`);
    console.log(`Status: ${status} ${warning}`);
  });
  
  console.log('\n');
}

testSessionLimits()
  .catch(console.error)
  .finally(() => db.$disconnect());
