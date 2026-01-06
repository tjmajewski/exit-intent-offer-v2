import db from './app/db.server.js';

async function checkClicks() {
  const impressions = await db.variantImpression.findMany({
    where: { clicked: true },
    orderBy: { timestamp: 'desc' },
    take: 5,
    include: {
      variant: {
        select: {
          variantId: true,
          headline: true
        }
      }
    }
  });
  
  console.log('\n=== Recent Clicks ===');
  console.log(`Total clicks found: ${impressions.length}\n`);
  
  impressions.forEach(imp => {
    console.log(`Impression: ${imp.id}`);
    console.log(`Variant: ${imp.variant.variantId}`);
    console.log(`Headline: ${imp.variant.headline}`);
    console.log(`Clicked at: ${imp.timestamp}`);
    console.log(`Converted: ${imp.converted}`);
    console.log('---');
  });
  
  await db.$disconnect();
}

checkClicks();
