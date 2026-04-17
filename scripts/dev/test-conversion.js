import db from './app/db.server.js';

async function testConversion() {
  // Find the most recent clicked impression
  const impression = await db.variantImpression.findFirst({
    where: {
      clicked: true,
      converted: false
    },
    orderBy: { timestamp: 'desc' },
    include: { 
      variant: {
        select: {
          variantId: true,
          headline: true,
          impressions: true,
          clicks: true,
          conversions: true,
          revenue: true
        }
      }
    }
  });

  if (!impression) {
    console.log('❌ No clicked impressions found to test');
    await db.$disconnect();
    return;
  }

  console.log('\n=== Before Conversion ===');
  console.log(`Impression ID: ${impression.id}`);
  console.log(`Variant: ${impression.variant.variantId}`);
  console.log(`Headline: ${impression.variant.headline}`);
  console.log(`Clicked: ${impression.clicked}`);
  console.log(`Converted: ${impression.converted}`);
  console.log(`\nVariant Stats:`);
  console.log(`  Impressions: ${impression.variant.impressions}`);
  console.log(`  Clicks: ${impression.variant.clicks}`);
  console.log(`  Conversions: ${impression.variant.conversions}`);
  console.log(`  Revenue: $${impression.variant.revenue}`);

  // Simulate conversion
  console.log('\n🧪 Recording test conversion...');
  const { recordConversion } = await import('./app/utils/variant-engine.js');
  await recordConversion(impression.id, 150.00, 15.00);

  // Check updated impression
  const updated = await db.variantImpression.findUnique({
    where: { id: impression.id },
    include: {
      variant: {
        select: {
          variantId: true,
          impressions: true,
          clicks: true,
          conversions: true,
          revenue: true,
          profitPerImpression: true
        }
      }
    }
  });

  console.log('\n=== After Conversion ===');
  console.log(`Converted: ${updated.converted}`);
  console.log(`Revenue: $${updated.revenue}`);
  console.log(`Discount: $${updated.discountAmount}`);
  console.log(`Profit: $${updated.profit}`);
  console.log(`\nVariant Stats:`);
  console.log(`  Impressions: ${updated.variant.impressions}`);
  console.log(`  Clicks: ${updated.variant.clicks}`);
  console.log(`  Conversions: ${updated.variant.conversions}`);
  console.log(`  Revenue: $${updated.variant.revenue.toFixed(2)}`);
  console.log(`  Profit/Impression: $${updated.variant.profitPerImpression.toFixed(2)}`);

  console.log('\n✅ Test conversion complete!');

  await db.$disconnect();
}

testConversion();
