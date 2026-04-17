const db = require('./app/db.server.js').default;

(async () => {
  const shop = await db.shop.findFirst();
  if (!shop) {
    console.log('No shop found');
    return;
  }
  
  console.log('Creating 3 test variants for shop:', shop.shopifyDomain);
  
  // Create 3 test variants
  for (let i = 1; i <= 3; i++) {
    await db.variant.create({
      data: {
        shopId: shop.id,
        variantId: 'TEST_VAR_00' + i,
        baseline: 'conversion_with_discount',
        segment: 'all',
        generation: i,
        offerAmount: 10 + (i * 5),
        headline: 'Test Variant ' + i + ' - Save ' + (10 + i*5) + '%',
        subhead: 'Limited time offer',
        cta: 'Claim Discount',
        redirect: 'checkout',
        urgency: true,
        impressions: 100 * i,
        clicks: 25 * i,
        conversions: 5 * i,
        revenue: 250 * i,
        status: 'live',
        alpha: 1,
        beta: 1
      }
    });
    console.log('  ✓ Created variant ' + i);
  }
  
  console.log('\n✓ Created 3 test variants successfully!');
  console.log('Go to Performance → AI Variants tab to see them');
  
  process.exit(0);
})();
