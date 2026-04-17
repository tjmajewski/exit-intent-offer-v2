// Test script to verify Evolution Control System works
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

async function testEvolutionSettings() {
  console.log('\n🧪 TESTING EVOLUTION CONTROL SYSTEM');
  console.log('=' .repeat(80));
  
  // Step 1: Find or create a test shop
  let shop = await db.shop.findFirst({
    where: { mode: 'ai' }
  });
  
  if (!shop) {
    console.log('❌ No AI-enabled shop found. Please enable AI mode first.');
    process.exit(1);
  }
  
  console.log(`\n✅ Found shop: ${shop.shopifyDomain}`);
  console.log(`   Current Settings:`);
  console.log(`   - Mutation Rate: ${shop.mutationRate}%`);
  console.log(`   - Crossover Rate: ${shop.crossoverRate}%`);
  console.log(`   - Selection Pressure: ${shop.selectionPressure}/10`);
  console.log(`   - Population Size: ${shop.populationSize}`);
  
  // Step 2: Test changing settings
  console.log('\n📝 Testing: Update to custom settings...');
  const testSettings = {
    mutationRate: 50,     // High mutation
    crossoverRate: 30,    // Low crossover
    selectionPressure: 8, // Ruthless
    populationSize: 5     // Small population
  };
  
  await db.shop.update({
    where: { id: shop.id },
    data: testSettings
  });
  
  console.log('   ✅ Settings updated to test values');
  
  // Step 3: Run evolution cycle and verify settings are used
  console.log('\n🧬 Running evolution cycle...\n');
  
  const { evolutionCycle } = await import('./app/utils/variant-engine.js');
  
  try {
    const result = await evolutionCycle(shop.id, 'conversion_with_discount', 'all');
    
    console.log('\n✅ Evolution cycle completed!');
    console.log(`   - Killed: ${result.killed} variants`);
    console.log(`   - Bred: ${result.bred} new variants`);
    console.log(`   - Population: ${result.population} variants`);
    console.log(`   - Champion: ${result.champion || 'None yet'}`);
    
    // Verify population matches setting
    if (result.population === testSettings.populationSize) {
      console.log('\n✅ PASS: Population size matches custom setting!');
    } else {
      console.log(`\n⚠️  Population is ${result.population}, expected ${testSettings.populationSize}`);
    }
    
    // Step 4: Restore original settings
    console.log('\n🔄 Restoring original settings...');
    await db.shop.update({
      where: { id: shop.id },
      data: {
        mutationRate: shop.mutationRate,
        crossoverRate: shop.crossoverRate,
        selectionPressure: shop.selectionPressure,
        populationSize: shop.populationSize
      }
    });
    console.log('   ✅ Original settings restored');
    
    console.log('\n' + '='.repeat(80));
    console.log('🎉 TEST COMPLETE - Check logs above for "Evolution Settings" line');
    console.log('    It should show: Mutation 50%, Crossover 30%, Pressure 8/10, Pop 5');
    console.log('='.repeat(80) + '\n');
    
  } catch (error) {
    console.error('\n❌ Evolution cycle failed:', error.message);
    console.error(error.stack);
  }
  
  await db.$disconnect();
}

testEvolutionSettings();
