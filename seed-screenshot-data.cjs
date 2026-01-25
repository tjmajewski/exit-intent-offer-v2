/**
 * Comprehensive Screenshot Data Seed Script
 *
 * Populates all dashboards with realistic test data for Shopify app listing screenshots.
 * Run with: node seed-screenshot-data.cjs
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const db = new Database(path.join(__dirname, 'prisma', 'dev.sqlite'));

// Helper to generate UUID
const uuid = () => crypto.randomUUID();

// Helper to generate random number in range
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max) => Math.random() * (max - min) + min;

// Helper to get random item from array
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Generate a date within the last N days
const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
};

// Generate random date between two dates
const randomDateBetween = (startDays, endDays) => {
  const start = new Date();
  start.setDate(start.getDate() - startDays);
  const end = new Date();
  end.setDate(end.getDate() - endDays);
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime())).toISOString();
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
const STATUSES = ['alive', 'alive', 'alive', 'alive', 'dying', 'dead', 'champion']; // weighted toward alive

// Realistic promotion codes
const PROMOTIONS = [
  { code: 'SUMMER25', amount: 25, type: 'percentage', classification: 'site_wide', aiStrategy: 'pause', reason: 'Site-wide promotion detected - pausing exit modal to avoid discount stacking' },
  { code: 'WELCOME10', amount: 10, type: 'percentage', classification: 'targeted', aiStrategy: 'continue', reason: 'Targeted new customer promotion - exit modal still effective for returning visitors' },
  { code: 'FLASH30', amount: 30, type: 'percentage', classification: 'site_wide', aiStrategy: 'increase', reason: 'High-value promotion - increasing modal urgency to capture abandoners' },
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

function seedData() {
  console.log('\n======================================');
  console.log('  ResparQ Screenshot Data Seeder');
  console.log('======================================\n');

  // Find the shop
  const shop = db.prepare('SELECT * FROM Shop LIMIT 1').get();
  if (!shop) {
    console.error('ERROR: No shop found in database. Please install the app first.');
    process.exit(1);
  }

  console.log(`Found shop: ${shop.shopifyDomain}`);
  console.log(`Current plan: ${shop.plan}\n`);

  // Step 1: Update shop to Enterprise with full features
  console.log('Step 1: Configuring shop for Enterprise tier...');
  db.prepare(`
    UPDATE Shop SET
      plan = 'enterprise',
      mode = 'ai',
      aiGoal = 'revenue',
      aggression = 7,
      budgetEnabled = 1,
      budgetAmount = 2500,
      budgetPeriod = 'month',
      socialProofEnabled = 1,
      socialProofType = 'orders',
      socialProofMinimum = 100,
      orderCount = 12847,
      customerCount = 8523,
      avgRating = 4.8,
      reviewCount = 2156,
      mutationRate = 15,
      crossoverRate = 70,
      selectionPressure = 5,
      populationSize = 12,
      lastEvolutionCycle = ?,
      brandPrimaryColor = '#1a1a2e',
      brandSecondaryColor = '#ffffff',
      brandAccentColor = '#e94560',
      brandFont = 'Inter',
      exitIntentEnabled = 1,
      timeDelayEnabled = 1,
      timeDelaySeconds = 45,
      cartValueEnabled = 1,
      cartValueMin = 25,
      cartValueMax = 500,
      modalHeadline = 'Wait! Here''s 15% Off Your Order',
      modalBody = 'Don''t miss out on your items! Complete your purchase now and save.',
      ctaButton = 'Claim My 15% Off',
      redirectDestination = 'checkout',
      discountEnabled = 1,
      manualDiscountCodeMode = 'unique',
      manualDiscountCodePrefix = 'SAVE',
      aiDiscountCodeMode = 'unique',
      aiDiscountCodePrefix = 'RESPARQ',
      promotionalIntelligenceEnabled = 1,
      contributeToMetaLearning = 1,
      updatedAt = ?
    WHERE id = ?
  `).run(daysAgo(1), new Date().toISOString(), shop.id);
  console.log('  [OK] Shop configured as Enterprise tier with AI mode\n');

  // Step 2: Clear existing test data
  console.log('Step 2: Clearing existing test data...');
  db.prepare('DELETE FROM VariantImpression WHERE shopId = ?').run(shop.id);
  db.prepare('DELETE FROM Variant WHERE shopId = ?').run(shop.id);
  db.prepare('DELETE FROM Conversion WHERE shopId = ?').run(shop.id);
  db.prepare('DELETE FROM Promotion WHERE shopId = ?').run(shop.id);
  db.prepare('DELETE FROM SeasonalPattern WHERE shopId = ?').run(shop.id);
  db.prepare('DELETE FROM AIDecision WHERE shopId = ?').run(shop.id);
  db.prepare('DELETE FROM DiscountOffer WHERE shopId = ?').run(shop.id);
  console.log('  [OK] Cleared existing data\n');

  // Step 3: Create variants
  console.log('Step 3: Creating AI variants...');
  const variants = [];
  const numVariants = 10;

  const insertVariant = db.prepare(`
    INSERT INTO Variant (
      id, shopId, variantId, baseline, segment, status, generation, parents,
      offerAmount, headline, subhead, cta, redirect, urgency,
      colorScheme, layout, buttonStyle, animation, typography,
      impressions, clicks, conversions, revenue, profitPerImpression,
      birthDate, deathDate, championDate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < numVariants; i++) {
    const offerAmount = pick([10, 12, 15, 18, 20, 25]);
    const headline = pick(HEADLINES).replace('{amount}', offerAmount);
    const cta = pick(CTAS).replace('{amount}', offerAmount);
    const status = pick(STATUSES);
    const generation = rand(1, 5);

    // Performance varies by status
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
    } else { // dead
      baseImpressions = rand(50, 100);
      conversionRate = randFloat(0.01, 0.04);
    }

    const impressions = baseImpressions;
    const clicks = Math.floor(impressions * randFloat(0.25, 0.45));
    const conversions = Math.floor(impressions * conversionRate);
    const avgOrderValue = randFloat(65, 145);
    const revenue = conversions * avgOrderValue;
    const profitPerImpression = revenue / impressions;

    const variantId = `VAR_${String(i + 1).padStart(3, '0')}_${Date.now().toString(36).toUpperCase()}`;
    const id = uuid();

    insertVariant.run(
      id, shop.id, variantId, pick(BASELINES), pick(SEGMENTS), status, generation,
      generation > 1 ? JSON.stringify([`VAR_PARENT_${rand(1, 5)}`]) : null,
      offerAmount, headline, pick(SUBHEADS), cta, pick(['cart', 'checkout']),
      Math.random() > 0.3 ? 1 : 0,
      pick(COLOR_SCHEMES), pick(LAYOUTS), pick(BUTTON_STYLES), pick(ANIMATIONS), pick(TYPOGRAPHIES),
      impressions, clicks, conversions,
      parseFloat(revenue.toFixed(2)), parseFloat(profitPerImpression.toFixed(2)),
      daysAgo(rand(7, 30)),
      status === 'dead' ? daysAgo(rand(1, 5)) : null,
      status === 'champion' ? daysAgo(rand(1, 10)) : null
    );

    variants.push({ id, variantId, offerAmount, headline, status, segment: pick(SEGMENTS) });
    console.log(`  [OK] Created variant ${i + 1}/${numVariants}: ${status.toUpperCase()} - ${headline.substring(0, 40)}...`);
  }
  console.log('');

  // Step 4: Create variant impressions
  console.log('Step 4: Creating variant impressions (this may take a moment)...');
  let totalImpressions = 0;

  const insertImpression = db.prepare(`
    INSERT INTO VariantImpression (
      id, variantId, shopId, segment, deviceType, trafficSource, cartValue,
      accountStatus, visitFrequency, clicked, converted, revenue, discountAmount,
      profit, duringPromo, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertManyImpressions = db.transaction((impressions) => {
    for (const imp of impressions) {
      insertImpression.run(...imp);
    }
  });

  for (const variant of variants) {
    const numImpressions = rand(50, 200);
    const impressions = [];

    for (let i = 0; i < numImpressions; i++) {
      const clicked = Math.random() < 0.35;
      const converted = clicked && Math.random() < 0.35;
      const cartValue = randFloat(25, 250);
      const orderValue = converted ? cartValue * randFloat(0.9, 1.1) : null;
      const discountAmount = converted ? orderValue * (variant.offerAmount / 100) : null;

      impressions.push([
        uuid(), variant.id, shop.id, variant.segment, pick(DEVICE_TYPES), pick(TRAFFIC_SOURCES),
        parseFloat(cartValue.toFixed(2)), pick(ACCOUNT_STATUSES), pick([1, 1, 1, 2, 2, 3, 5]),
        clicked ? 1 : 0, converted ? 1 : 0,
        orderValue ? parseFloat(orderValue.toFixed(2)) : null,
        discountAmount ? parseFloat(discountAmount.toFixed(2)) : null,
        orderValue && discountAmount ? parseFloat((orderValue - discountAmount).toFixed(2)) : null,
        Math.random() < 0.15 ? 1 : 0, randomDateBetween(30, 0)
      ]);
    }

    insertManyImpressions(impressions);
    totalImpressions += numImpressions;
  }
  console.log(`  [OK] Created ${totalImpressions} variant impressions\n`);

  // Step 5: Create conversions
  console.log('Step 5: Creating conversion records...');
  const numConversions = rand(45, 65);

  const insertConversion = db.prepare(`
    INSERT INTO Conversion (
      id, shopId, orderId, orderNumber, orderValue, customerEmail, orderedAt,
      modalId, modalName, variantId, modalHadDiscount, discountCode,
      discountRedeemed, discountAmount, modalSnapshot, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < numConversions; i++) {
    const variant = pick(variants.filter(v => v.status !== 'dead'));
    const orderValue = randFloat(45, 225);
    const discountRedeemed = Math.random() > 0.15;
    const discountAmount = discountRedeemed ? orderValue * (variant.offerAmount / 100) : 0;

    insertConversion.run(
      uuid(), shop.id, `${rand(100000, 999999)}`, `#${1000 + i}`,
      parseFloat(orderValue.toFixed(2)), `customer${i}@example.com`,
      randomDateBetween(30, 0), 'exit-intent-modal', 'Exit Intent Offer',
      variant.variantId, 1, `RESPARQ${rand(10000, 99999)}`,
      discountRedeemed ? 1 : 0, parseFloat(discountAmount.toFixed(2)),
      JSON.stringify({ headline: variant.headline, offerAmount: variant.offerAmount }),
      new Date().toISOString()
    );
  }
  console.log(`  [OK] Created ${numConversions} conversion records\n`);

  // Step 6: Create promotions
  console.log('Step 6: Creating promotional intelligence data...');
  const insertPromotion = db.prepare(`
    INSERT INTO Promotion (
      id, shopId, code, amount, type, detectedVia, status, validFrom, validUntil,
      usageStats, classification, aiStrategy, aiStrategyReason, seenByMerchant,
      detectedAt, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const promo of PROMOTIONS) {
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + rand(5, 20));

    insertPromotion.run(
      uuid(), shop.id, promo.code, promo.amount, promo.type,
      pick(['webhook', 'usage_spike']), 'active',
      daysAgo(rand(5, 15)), validUntil.toISOString(),
      JSON.stringify({ total: rand(150, 800), last24h: rand(20, 120) }),
      promo.classification, promo.aiStrategy, promo.reason,
      Math.random() > 0.3 ? 1 : 0, daysAgo(rand(1, 10)), new Date().toISOString()
    );
    console.log(`  [OK] Created promotion: ${promo.code} (${promo.aiStrategy})`);
  }
  console.log('');

  // Step 7: Create seasonal patterns
  console.log('Step 7: Creating seasonal pattern data...');
  const insertSeason = db.prepare(`
    INSERT INTO SeasonalPattern (
      id, shopId, season, startDate, endDate, avgCVR, avgAOV, avgProfitPerImpression,
      trafficMultiplier, recommendedOfferAmounts, recommendedUrgency, recommendedHeadlines
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const season of SEASONS) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - rand(1, 3));

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + rand(7, 30));

    insertSeason.run(
      uuid(), shop.id, season.season, startDate.toISOString(), endDate.toISOString(),
      season.avgCVR, season.avgAOV, season.avgCVR * season.avgAOV * 0.85,
      season.trafficMultiplier, JSON.stringify(season.offers), season.urgency ? 1 : 0,
      JSON.stringify([
        `${season.season === 'blackFriday' ? 'Black Friday Special' : season.season === 'holidaySeason' ? 'Holiday Special' : 'Limited Time'}: {amount}% Off!`,
        "Don't Miss These Savings!"
      ])
    );
    console.log(`  [OK] Created seasonal pattern: ${season.season}`);
  }
  console.log('');

  // Step 8: Create AI decisions (audit trail)
  console.log('Step 8: Creating AI decision audit trail...');
  const insertDecision = db.prepare(`
    INSERT INTO AIDecision (id, shopId, signals, decision, offerId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const decisions = [
    { decision: 'show_variant', signals: { cartValue: 85, deviceType: 'mobile', returning: false } },
    { decision: 'suppress_promo_active', signals: { promoCode: 'SUMMER25', promoAmount: 25 } },
    { decision: 'show_aggressive', signals: { cartValue: 245, highIntent: true } },
    { decision: 'show_variant', signals: { cartValue: 55, deviceType: 'desktop', trafficSource: 'paid' } },
    { decision: 'show_variant', signals: { cartValue: 120, returning: true, previousPurchase: true } }
  ];

  for (let i = 0; i < 25; i++) {
    const decision = pick(decisions);
    insertDecision.run(
      uuid(), shop.id,
      JSON.stringify({ ...decision.signals, timestamp: Date.now() - rand(0, 7 * 24 * 60 * 60 * 1000) }),
      decision.decision, `OFFER_${rand(10000, 99999)}`, randomDateBetween(7, 0)
    );
  }
  console.log(`  [OK] Created 25 AI decision records\n`);

  // Step 9: Create discount offers
  console.log('Step 9: Creating discount offer records...');
  const insertOffer = db.prepare(`
    INSERT INTO DiscountOffer (
      id, shopId, discountCode, offerType, amount, cartValue, mode,
      expiresAt, redeemed, redeemedAt, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < 30; i++) {
    const redeemed = Math.random() > 0.4;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 1);

    insertOffer.run(
      uuid(), shop.id, `RESPARQ${rand(10000, 99999)}`, 'percentage',
      pick([10, 12, 15, 18, 20]), parseFloat(randFloat(35, 200).toFixed(2)),
      'unique', expiresAt.toISOString(),
      redeemed ? 1 : 0, redeemed ? randomDateBetween(7, 0) : null,
      randomDateBetween(30, 0)
    );
  }
  console.log(`  [OK] Created 30 discount offer records\n`);

  // Step 10: Create/update brand safety rule
  console.log('Step 10: Creating brand safety rules...');
  const existingRule = db.prepare('SELECT id FROM BrandSafetyRule WHERE shopId = ?').get(shop.id);

  if (existingRule) {
    db.prepare(`
      UPDATE BrandSafetyRule SET
        prohibitedWords = ?,
        requiredPhrases = ?,
        maxDiscountPercent = 30,
        tone = 'professional',
        enabled = 1
      WHERE shopId = ?
    `).run(
      JSON.stringify(['cheap', 'clearance', 'liquidation', 'going out of business']),
      JSON.stringify([]),
      shop.id
    );
  } else {
    db.prepare(`
      INSERT INTO BrandSafetyRule (id, shopId, prohibitedWords, requiredPhrases, maxDiscountPercent, tone, enabled)
      VALUES (?, ?, ?, ?, 30, 'professional', 1)
    `).run(
      uuid(), shop.id,
      JSON.stringify(['cheap', 'clearance', 'liquidation', 'going out of business']),
      JSON.stringify([])
    );
  }
  console.log('  [OK] Created brand safety rules\n');

  // Summary
  console.log('======================================');
  console.log('  Data Population Complete!');
  console.log('======================================\n');

  // Calculate totals
  const totalVariantsCount = db.prepare('SELECT COUNT(*) as count FROM Variant WHERE shopId = ?').get(shop.id).count;
  const totalImpressionsCount = db.prepare('SELECT COUNT(*) as count FROM VariantImpression WHERE shopId = ?').get(shop.id).count;
  const totalConversionsCount = db.prepare('SELECT COUNT(*) as count FROM Conversion WHERE shopId = ?').get(shop.id).count;
  const totalPromotionsCount = db.prepare('SELECT COUNT(*) as count FROM Promotion WHERE shopId = ?').get(shop.id).count;

  const conversionSum = db.prepare('SELECT SUM(orderValue) as total FROM Conversion WHERE shopId = ?').get(shop.id);

  console.log('Summary:');
  console.log(`  - Shop Plan: Enterprise`);
  console.log(`  - Mode: AI`);
  console.log(`  - Variants: ${totalVariantsCount}`);
  console.log(`  - Impressions: ${totalImpressionsCount}`);
  console.log(`  - Conversions: ${totalConversionsCount}`);
  console.log(`  - Total Revenue: $${(conversionSum.total || 0).toFixed(2)}`);
  console.log(`  - Promotions: ${totalPromotionsCount}`);
  console.log(`  - Social Proof: 12,847 orders, 4.8 rating`);
  console.log('\nDashboards ready for screenshots:');
  console.log('  - Main Dashboard (/app)');
  console.log('  - Analytics (/app/analytics)');
  console.log('  - Conversions (/app/conversions)');
  console.log('  - AI Variants (/app/variants)');
  console.log('  - Promotions (/app/promotions)');
  console.log('  - Settings (/app/settings)');
  console.log('\nHappy screenshotting!\n');

  db.close();
}

// Run the seeder
try {
  seedData();
} catch (e) {
  console.error('Error seeding data:', e);
  process.exit(1);
}
