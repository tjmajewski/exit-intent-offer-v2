/**
 * Comprehensive Screenshot Data Seed Script
 *
 * Populates all dashboards with realistic test data for Shopify app listing screenshots.
 * Run with: node seed-screenshot-data.mjs
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

// Helper to generate random number in range
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max) => Math.random() * (max - min) + min;

// Helper to get random item from array
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Generate a date within the last N days
const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

// Generate random date between two dates
const randomDateBetween = (startDays, endDays) => {
  const start = new Date();
  start.setDate(start.getDate() - startDays);
  const end = new Date();
  end.setDate(end.getDate() - endDays);
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
};

// Realistic variant data
const HEADLINES = [
  "Wait! Get {amount}% Off Your Order",
  "Don't Leave Empty-Handed!",
  "Exclusive Offer Just For You",
  "Before You Go... {amount}% Off!",
  "Hold On! Special Discount Inside",
  "Your Cart Misses You Already",
  "Unlock Your Exclusive Savings",
  "One-Time Offer: {amount}% Off",
  "Complete Your Order & Save Big",
  "Last Chance: {amount}% Discount"
];

const SUBHEADS = [
  "Use code at checkout for instant savings",
  "Limited time offer - don't miss out!",
  "Your exclusive discount expires soon",
  "Complete your purchase now and save",
  "This offer won't last long",
  "Treat yourself - you deserve it!",
  "Free shipping on orders over $50",
  "Join thousands of happy customers"
];

const CTAS = [
  "Claim My Discount",
  "Get {amount}% Off Now",
  "Yes, I Want to Save!",
  "Apply My Discount",
  "Unlock Savings",
  "Complete My Order",
  "Shop With Discount",
  "Grab This Deal"
];

const SEGMENTS = ['all', 'mobile', 'desktop', 'mobile_paid', 'desktop_organic', 'high_value', 'returning'];
const DEVICE_TYPES = ['mobile', 'desktop', 'tablet'];
const TRAFFIC_SOURCES = ['paid', 'organic', 'social', 'direct', 'email'];
const ACCOUNT_STATUSES = ['guest', 'logged_in'];
const COLOR_SCHEMES = ['classic', 'modern', 'bold', 'minimal', 'purple', 'gradient'];
const LAYOUTS = ['centered', 'left', 'right', 'fullscreen'];
const BUTTON_STYLES = ['solid', 'outline', 'rounded', 'pill'];
const ANIMATIONS = ['fade', 'slide', 'bounce', 'scale'];
const TYPOGRAPHIES = ['modern', 'classic', 'playful', 'elegant'];
const BASELINES = ['revenue_with_discount', 'conversion_with_discount', 'profit_per_impression'];
const STATUSES = ['alive', 'alive', 'alive', 'alive', 'dying', 'dead', 'champion'];

// Realistic promotion codes
const PROMOTIONS = [
  { code: 'SUMMER25', amount: 25, type: 'percentage', classification: 'site_wide', aiStrategy: 'pause', reason: 'Site-wide promotion detected - pausing exit modal to avoid discount stacking' },
  { code: 'WELCOME10', amount: 10, type: 'percentage', classification: 'targeted', aiStrategy: 'continue', reason: 'Targeted new customer promotion - exit modal still effective for returning visitors' },
  { code: 'VIP15', amount: 15, type: 'percentage', classification: 'targeted', aiStrategy: 'continue', reason: 'VIP-only promotion - modal can run for non-VIP segments' },
  { code: 'FREESHIP', amount: 0, type: 'free_shipping', classification: 'site_wide', aiStrategy: 'ignore', reason: 'Free shipping only - does not conflict with discount offers' }
];

// Seasonal patterns
const SEASONS = [
  { season: 'blackFriday', avgCVR: 0.18, avgAOV: 125, trafficMultiplier: 3.2, urgency: true, offers: [25, 30, 35] },
  { season: 'holidaySeason', avgCVR: 0.15, avgAOV: 145, trafficMultiplier: 2.5, urgency: true, offers: [20, 25, 30] },
  { season: 'backToSchool', avgCVR: 0.12, avgAOV: 85, trafficMultiplier: 1.8, urgency: false, offers: [15, 20, 25] },
  { season: 'valentinesDay', avgCVR: 0.14, avgAOV: 95, trafficMultiplier: 1.5, urgency: true, offers: [15, 20] }
];

async function seedData() {
  console.log('\n======================================');
  console.log('  ResparQ Screenshot Data Seeder');
  console.log('======================================\n');

  // Find the shop
  const shop = await db.shop.findFirst();
  if (!shop) {
    console.error('ERROR: No shop found in database. Please run "shopify app dev" first to create a shop.');
    process.exit(1);
  }

  console.log(`Found shop: ${shop.shopifyDomain}`);
  console.log(`Current plan: ${shop.plan}\n`);

  // Step 1: Update shop to Enterprise with full features
  console.log('Step 1: Configuring shop for Enterprise tier...');
  await db.shop.update({
    where: { id: shop.id },
    data: {
      plan: 'enterprise',
      mode: 'ai',
      aiGoal: 'revenue',
      aggression: 7,
      budgetEnabled: true,
      budgetAmount: 2500,
      budgetPeriod: 'month',
      socialProofEnabled: true,
      socialProofType: 'orders',
      socialProofMinimum: 100,
      orderCount: 12847,
      customerCount: 8523,
      avgRating: 4.8,
      reviewCount: 2156,
      mutationRate: 15,
      crossoverRate: 70,
      selectionPressure: 5,
      populationSize: 12,
      lastEvolutionCycle: daysAgo(1),
      brandPrimaryColor: '#1a1a2e',
      brandSecondaryColor: '#ffffff',
      brandAccentColor: '#e94560',
      brandFont: 'Inter',
      exitIntentEnabled: true,
      timeDelayEnabled: true,
      timeDelaySeconds: 45,
      cartValueEnabled: true,
      cartValueMin: 25,
      cartValueMax: 500,
      modalHeadline: "Wait! Here's 15% Off Your Order",
      modalBody: "Don't miss out on your items! Complete your purchase now and save.",
      ctaButton: "Claim My 15% Off",
      redirectDestination: "checkout",
      discountEnabled: true,
      manualDiscountCodeMode: 'unique',
      manualDiscountCodePrefix: 'SAVE',
      aiDiscountCodeMode: 'unique',
      aiDiscountCodePrefix: 'RESPARQ',
      promotionalIntelligenceEnabled: true,
      contributeToMetaLearning: true
    }
  });
  console.log('  [OK] Shop configured as Enterprise tier with AI mode\n');

  // Step 2: Clear existing test data
  console.log('Step 2: Clearing existing test data...');
  await db.variantImpression.deleteMany({ where: { shopId: shop.id } });
  await db.variant.deleteMany({ where: { shopId: shop.id } });
  await db.conversion.deleteMany({ where: { shopId: shop.id } });
  await db.promotion.deleteMany({ where: { shopId: shop.id } });
  await db.seasonalPattern.deleteMany({ where: { shopId: shop.id } });
  await db.aIDecision.deleteMany({ where: { shopId: shop.id } });
  await db.discountOffer.deleteMany({ where: { shopId: shop.id } });
  console.log('  [OK] Cleared existing data\n');

  // Step 3: Create variants
  console.log('Step 3: Creating AI variants...');
  const variants = [];
  const numVariants = 10;

  for (let i = 0; i < numVariants; i++) {
    const offerAmount = pick([10, 12, 15, 18, 20, 25]);
    const headline = pick(HEADLINES).replace('{amount}', offerAmount);
    const cta = pick(CTAS).replace('{amount}', offerAmount);
    const status = pick(STATUSES);
    const generation = rand(1, 5);

    let baseImpressions, conversionRate;
    if (status === 'champion') {
      baseImpressions = rand(400, 600);
      conversionRate = randFloat(0.12, 0.18);
    } else if (status === 'alive') {
      baseImpressions = rand(150, 350);
      conversionRate = randFloat(0.08, 0.14);
    } else if (status === 'dying') {
      baseImpressions = rand(100, 200);
      conversionRate = randFloat(0.04, 0.07);
    } else {
      baseImpressions = rand(50, 100);
      conversionRate = randFloat(0.01, 0.04);
    }

    const impressions = baseImpressions;
    const clicks = Math.floor(impressions * randFloat(0.12, 0.20));
    const conversions = Math.floor(impressions * conversionRate);
    const avgOrderValue = randFloat(100, 150);
    const revenue = conversions * avgOrderValue;
    const profitPerImpression = revenue / impressions;

    const variant = await db.variant.create({
      data: {
        shopId: shop.id,
        variantId: `VAR_${String(i + 1).padStart(3, '0')}_${Date.now().toString(36).toUpperCase()}`,
        baseline: pick(BASELINES),
        segment: pick(SEGMENTS),
        status: status,
        generation: generation,
        parents: generation > 1 ? JSON.stringify([`VAR_PARENT_${rand(1, 5)}`]) : null,
        offerAmount: offerAmount,
        headline: headline,
        subhead: pick(SUBHEADS),
        cta: cta,
        redirect: pick(['cart', 'checkout']),
        urgency: Math.random() > 0.3,
        colorScheme: pick(COLOR_SCHEMES),
        layout: pick(LAYOUTS),
        buttonStyle: pick(BUTTON_STYLES),
        animation: pick(ANIMATIONS),
        typography: pick(TYPOGRAPHIES),
        impressions: impressions,
        clicks: clicks,
        conversions: conversions,
        revenue: parseFloat(revenue.toFixed(2)),
        profitPerImpression: parseFloat(profitPerImpression.toFixed(2)),
        birthDate: daysAgo(rand(7, 30)),
        deathDate: status === 'dead' ? daysAgo(rand(1, 5)) : null,
        championDate: status === 'champion' ? daysAgo(rand(1, 10)) : null
      }
    });

    variants.push(variant);
    console.log(`  [OK] Created variant ${i + 1}/${numVariants}: ${status.toUpperCase()} - ${headline.substring(0, 40)}...`);
  }
  console.log('');

  // Step 4: Create variant impressions
  console.log('Step 4: Creating variant impressions (this may take a moment)...');
  let totalImpressions = 0;

  for (const variant of variants) {
    const numImpressions = rand(50, 200);
    const impressions = [];

    for (let i = 0; i < numImpressions; i++) {
      const clicked = Math.random() < 0.16;
      const converted = clicked && Math.random() < 0.35;
      const cartValue = randFloat(25, 250);
      const orderValue = converted ? cartValue * randFloat(0.9, 1.1) : null;
      const discountAmount = converted ? orderValue * (variant.offerAmount / 100) : null;

      impressions.push({
        variantId: variant.id,
        shopId: shop.id,
        segment: variant.segment,
        deviceType: pick(DEVICE_TYPES),
        trafficSource: pick(TRAFFIC_SOURCES),
        cartValue: parseFloat(cartValue.toFixed(2)),
        accountStatus: pick(ACCOUNT_STATUSES),
        visitFrequency: pick([1, 1, 1, 2, 2, 3, 5]),
        clicked: clicked,
        converted: converted,
        revenue: orderValue ? parseFloat(orderValue.toFixed(2)) : null,
        discountAmount: discountAmount ? parseFloat(discountAmount.toFixed(2)) : null,
        profit: orderValue && discountAmount ? parseFloat((orderValue - discountAmount).toFixed(2)) : null,
        duringPromo: Math.random() < 0.15,
        timestamp: randomDateBetween(30, 0)
      });
    }

    await db.variantImpression.createMany({ data: impressions });
    totalImpressions += numImpressions;
  }
  console.log(`  [OK] Created ${totalImpressions} variant impressions\n`);

  // Step 5: Create conversions
  console.log('Step 5: Creating conversion records...');
  const numConversions = rand(45, 65);

  for (let i = 0; i < numConversions; i++) {
    const variant = pick(variants.filter(v => v.status !== 'dead'));
    const orderValue = randFloat(100, 150);
    const discountRedeemed = Math.random() > 0.15;
    const discountAmount = discountRedeemed ? orderValue * (variant.offerAmount / 100) : 0;

    await db.conversion.create({
      data: {
        shopId: shop.id,
        orderId: `${rand(100000, 999999)}`,
        orderNumber: `#${1000 + i}`,
        orderValue: parseFloat(orderValue.toFixed(2)),
        customerEmail: `customer${i}@example.com`,
        orderedAt: randomDateBetween(30, 0),
        modalId: 'exit-intent-modal',
        modalName: 'Exit Intent Offer',
        variantId: variant.variantId,
        modalHadDiscount: true,
        discountCode: `RESPARQ${rand(10000, 99999)}`,
        discountRedeemed: discountRedeemed,
        discountAmount: parseFloat(discountAmount.toFixed(2)),
        modalSnapshot: JSON.stringify({
          headline: variant.headline,
          offerAmount: variant.offerAmount,
          cta: variant.cta
        })
      }
    });
  }
  console.log(`  [OK] Created ${numConversions} conversion records\n`);

  // Step 6: Create promotions
  console.log('Step 6: Creating promotional intelligence data...');
  for (const promo of PROMOTIONS) {
    await db.promotion.create({
      data: {
        shopId: shop.id,
        code: promo.code,
        amount: promo.amount,
        type: promo.type,
        detectedVia: pick(['webhook', 'usage_spike']),
        status: 'active',
        validFrom: daysAgo(rand(5, 15)),
        validUntil: new Date(Date.now() + rand(5, 20) * 24 * 60 * 60 * 1000),
        usageStats: JSON.stringify({ total: rand(150, 800), last24h: rand(20, 120) }),
        classification: promo.classification,
        aiStrategy: promo.aiStrategy,
        aiStrategyReason: promo.reason,
        seenByMerchant: Math.random() > 0.3,
        detectedAt: daysAgo(rand(1, 10))
      }
    });
    console.log(`  [OK] Created promotion: ${promo.code} (${promo.aiStrategy})`);
  }
  console.log('');

  // Step 7: Create seasonal patterns
  console.log('Step 7: Creating seasonal pattern data...');
  for (const season of SEASONS) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - rand(1, 3));
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + rand(7, 30));

    await db.seasonalPattern.create({
      data: {
        shopId: shop.id,
        season: season.season,
        startDate: startDate,
        endDate: endDate,
        avgCVR: season.avgCVR,
        avgAOV: season.avgAOV,
        avgProfitPerImpression: season.avgCVR * season.avgAOV * 0.85,
        trafficMultiplier: season.trafficMultiplier,
        recommendedOfferAmounts: JSON.stringify(season.offers),
        recommendedUrgency: season.urgency,
        recommendedHeadlines: JSON.stringify([
          `${season.season === 'blackFriday' ? 'Black Friday Special' : season.season === 'holidaySeason' ? 'Holiday Special' : 'Limited Time'}: {amount}% Off!`,
          "Don't Miss These Savings!"
        ])
      }
    });
    console.log(`  [OK] Created seasonal pattern: ${season.season}`);
  }
  console.log('');

  // Step 8: Create AI decisions
  console.log('Step 8: Creating AI decision audit trail...');
  const decisions = [
    { decision: 'show_variant', signals: { cartValue: 85, deviceType: 'mobile', returning: false } },
    { decision: 'suppress_promo_active', signals: { promoCode: 'SUMMER25', promoAmount: 25 } },
    { decision: 'show_aggressive', signals: { cartValue: 245, highIntent: true } },
    { decision: 'show_variant', signals: { cartValue: 55, deviceType: 'desktop', trafficSource: 'paid' } },
    { decision: 'show_variant', signals: { cartValue: 120, returning: true, previousPurchase: true } }
  ];

  for (let i = 0; i < 25; i++) {
    const decision = pick(decisions);
    await db.aIDecision.create({
      data: {
        shopId: shop.id,
        signals: JSON.stringify({ ...decision.signals, timestamp: Date.now() - rand(0, 7 * 24 * 60 * 60 * 1000) }),
        decision: decision.decision,
        offerId: `OFFER_${rand(10000, 99999)}`,
        createdAt: randomDateBetween(7, 0)
      }
    });
  }
  console.log(`  [OK] Created 25 AI decision records\n`);

  // Step 9: Create discount offers
  console.log('Step 9: Creating discount offer records...');
  for (let i = 0; i < 30; i++) {
    const redeemed = Math.random() > 0.4;
    await db.discountOffer.create({
      data: {
        shopId: shop.id,
        discountCode: `RESPARQ${rand(10000, 99999)}`,
        offerType: 'percentage',
        amount: pick([10, 12, 15, 18, 20]),
        cartValue: parseFloat(randFloat(35, 200).toFixed(2)),
        mode: 'unique',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        redeemed: redeemed,
        redeemedAt: redeemed ? randomDateBetween(7, 0) : null,
        createdAt: randomDateBetween(30, 0)
      }
    });
  }
  console.log(`  [OK] Created 30 discount offer records\n`);

  // Step 10: Create brand safety rule
  console.log('Step 10: Creating brand safety rules...');
  await db.brandSafetyRule.upsert({
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      prohibitedWords: JSON.stringify(['cheap', 'clearance', 'liquidation', 'going out of business']),
      requiredPhrases: JSON.stringify([]),
      maxDiscountPercent: 30,
      tone: 'professional',
      enabled: true
    },
    update: {
      prohibitedWords: JSON.stringify(['cheap', 'clearance', 'liquidation', 'going out of business']),
      maxDiscountPercent: 30,
      tone: 'professional',
      enabled: true
    }
  });
  console.log('  [OK] Created brand safety rules\n');

  // Summary
  console.log('======================================');
  console.log('  Data Population Complete!');
  console.log('======================================\n');

  const totalVariants = await db.variant.count({ where: { shopId: shop.id } });
  const totalImpressionsCount = await db.variantImpression.count({ where: { shopId: shop.id } });
  const totalConversionsCount = await db.conversion.count({ where: { shopId: shop.id } });
  const totalPromotions = await db.promotion.count({ where: { shopId: shop.id } });

  const conversionSum = await db.conversion.aggregate({
    where: { shopId: shop.id },
    _sum: { orderValue: true }
  });

  console.log('Summary:');
  console.log(`  - Shop Plan: Enterprise`);
  console.log(`  - Mode: AI`);
  console.log(`  - Variants: ${totalVariants}`);
  console.log(`  - Impressions: ${totalImpressionsCount}`);
  console.log(`  - Conversions: ${totalConversionsCount}`);
  console.log(`  - Total Revenue: $${(conversionSum._sum.orderValue || 0).toFixed(2)}`);
  console.log(`  - Promotions: ${totalPromotions}`);
  console.log(`  - Social Proof: 12,847 orders, 4.8 rating`);
  console.log('\nDashboards ready for screenshots:');
  console.log('  - Main Dashboard (/app)');
  console.log('  - Analytics (/app/analytics)');
  console.log('  - Conversions (/app/conversions)');
  console.log('  - AI Variants (/app/variants)');
  console.log('  - Promotions (/app/promotions)');
  console.log('  - Settings (/app/settings)');
  console.log('\nHappy screenshotting!\n');
}

seedData()
  .catch((e) => {
    console.error('Error seeding data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
