import { testSocialProofFormatting } from './app/utils/social-proof.js';
import { createRandomVariantWithSocialProof } from './app/utils/variant-engine.js';

console.log('🧪 Testing Social Proof System\n');
console.log('='.repeat(50));
console.log('\n');

// Test 1: Formatting functions
testSocialProofFormatting();

console.log('\n');
console.log('='.repeat(50));
console.log('\n');

// Test 2: Variant creation with social proof
console.log('🧪 Testing Variant Creation with Social Proof');
console.log('===============================================\n');

const TEST_SHOP_ID = 'aa3a1d44-aa3b-45d2-b86c-a57b3fbc5fdc';

try {
  console.log(`Creating 5 test variants for shop: ${TEST_SHOP_ID}\n`);
  
  for (let i = 0; i < 5; i++) {
    const variant = await createRandomVariantWithSocialProof(
      TEST_SHOP_ID,
      'conversion_no_discount',
      'all'
    );
    
    console.log(`\n--- Variant ${i + 1} ---`);
    console.log('Headline:', variant.headline);
    console.log('Subhead:', variant.subhead);
    console.log('CTA:', variant.cta);
    
    // Check if social proof was used
    const headlineHasProof = variant.headline.includes('5k+') || variant.headline.includes('4.8');
    const subheadHasProof = variant.subhead.includes('5k+') || variant.subhead.includes('4.8');
    
    if (headlineHasProof || subheadHasProof) {
      console.log('✅ Social proof detected!');
    } else {
      console.log('ℹ️  Regular variant (no social proof gene selected)');
    }
  }
  
  console.log('\n✅ All variants created successfully!');
  
} catch (error) {
  console.error('❌ Error creating variant:', error.message);
  console.error(error.stack);
}

console.log('\n');
console.log('='.repeat(50));
console.log('\n✅ Social Proof System Test Complete!\n');
