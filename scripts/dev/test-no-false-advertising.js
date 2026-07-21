// Test: Verify no false advertising in modal copy
// Ensures modals never promise offers/discounts that aren't actually given

import { genePools } from '../../app/utils/gene-pools.js';

console.log('🧪 Testing: No False Advertising in Modal Copy');
console.log('='.repeat(60));
console.log('');

// Words that indicate an offer/discount (false advertising if offerAmount = 0)
const OFFER_KEYWORDS = [
  'discount', 'off', 'save', 'deal', 'promo', 'offer',
  'free shipping', 'code', '%', 'exclusive', 'limited time'
];

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

// Test pure_reminder baseline
console.log('📋 Testing pure_reminder baseline...');
console.log('-'.repeat(60));

const pureReminder = genePools.pure_reminder;

if (!pureReminder) {
  console.log('❌ CRITICAL ERROR: pure_reminder baseline does not exist!');
  process.exit(1);
}

// Check 1: offerAmounts should only contain 0
console.log('\n✓ Check 1: Offer amounts');
totalTests++;
if (pureReminder.offerAmounts.every(amount => amount === 0)) {
  console.log('  ✅ PASS: All offer amounts are 0');
  passedTests++;
} else {
  console.log('  ❌ FAIL: Found non-zero offer amounts:', pureReminder.offerAmounts);
  failedTests++;
}

// Check 2: Headlines should not contain offer keywords
console.log('\n✓ Check 2: Headlines (no offer promises)');
pureReminder.headlines.forEach((headline, i) => {
  totalTests++;
  const lowerHeadline = headline.toLowerCase();
  const foundKeywords = OFFER_KEYWORDS.filter(keyword => 
    lowerHeadline.includes(keyword)
  );
  
  if (foundKeywords.length === 0) {
    console.log(`  ✅ PASS: "${headline}"`);
    passedTests++;
  } else {
    console.log(`  ❌ FAIL: "${headline}"`);
    console.log(`     Found forbidden words: ${foundKeywords.join(', ')}`);
    failedTests++;
  }
});

// Check 3: Subheads should not contain offer keywords
console.log('\n✓ Check 3: Subheads (no offer promises)');
pureReminder.subheads.forEach((subhead, i) => {
  totalTests++;
  const lowerSubhead = subhead.toLowerCase();
  const foundKeywords = OFFER_KEYWORDS.filter(keyword => 
    lowerSubhead.includes(keyword)
  );
  
  if (foundKeywords.length === 0) {
    console.log(`  ✅ PASS: "${subhead}"`);
    passedTests++;
  } else {
    console.log(`  ❌ FAIL: "${subhead}"`);
    console.log(`     Found forbidden words: ${foundKeywords.join(', ')}`);
    failedTests++;
  }
});

// Check 4: CTAs should not contain offer keywords
console.log('\n✓ Check 4: CTAs (no offer promises)');
pureReminder.ctas.forEach((cta, i) => {
  totalTests++;
  const lowerCta = cta.toLowerCase();
  const foundKeywords = OFFER_KEYWORDS.filter(keyword => 
    lowerCta.includes(keyword)
  );
  
  if (foundKeywords.length === 0) {
    console.log(`  ✅ PASS: "${cta}"`);
    passedTests++;
  } else {
    console.log(`  ❌ FAIL: "${cta}"`);
    console.log(`     Found forbidden words: ${foundKeywords.join(', ')}`);
    failedTests++;
  }
});

// Check 5: No urgency flags (shouldn't pressure with false scarcity)
console.log('\n✓ Check 5: Urgency flags');
totalTests++;
if (pureReminder.urgency.every(u => u === false)) {
  console.log('  ✅ PASS: No urgency tactics used');
  passedTests++;
} else {
  console.log('  ❌ FAIL: Urgency tactics found in no-offer baseline');
  failedTests++;
}

// Final summary
console.log('\n' + '='.repeat(60));
console.log('📊 TEST RESULTS');
console.log('='.repeat(60));
console.log(`Total Tests: ${totalTests}`);
console.log(`✅ Passed: ${passedTests}`);
console.log(`❌ Failed: ${failedTests}`);
console.log('');

if (failedTests === 0) {
  console.log('🎉 SUCCESS: All tests passed!');
  console.log('✅ No false advertising detected in pure_reminder baseline');
  console.log('');
  process.exit(0);
} else {
  console.log('⚠️  FAILURE: Some tests failed');
  console.log('❌ Fix the copy in pure_reminder baseline to remove offer promises');
  console.log('');
  process.exit(1);
}
