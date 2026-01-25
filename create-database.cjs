/**
 * Create SQLite Database from Prisma Schema
 *
 * Creates the database tables based on the Prisma schema definition.
 * Run with: node create-database.cjs
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const db = new Database(path.join(__dirname, 'prisma', 'dev.sqlite'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

console.log('Creating database tables...\n');

// Session table
db.exec(`
  CREATE TABLE IF NOT EXISTS Session (
    id TEXT PRIMARY KEY,
    shop TEXT NOT NULL,
    state TEXT NOT NULL,
    isOnline INTEGER DEFAULT 0,
    scope TEXT,
    expires TEXT,
    accessToken TEXT NOT NULL,
    userId INTEGER,
    firstName TEXT,
    lastName TEXT,
    email TEXT,
    accountOwner INTEGER DEFAULT 0,
    locale TEXT,
    collaborator INTEGER DEFAULT 0,
    emailVerified INTEGER DEFAULT 0
  )
`);
console.log('  [OK] Session table');

// Shop table
db.exec(`
  CREATE TABLE IF NOT EXISTS Shop (
    id TEXT PRIMARY KEY,
    shopifyDomain TEXT UNIQUE NOT NULL,
    mode TEXT DEFAULT 'manual',
    plan TEXT DEFAULT 'pro',
    aiGoal TEXT DEFAULT 'revenue',
    aggression INTEGER DEFAULT 5,
    budgetEnabled INTEGER DEFAULT 0,
    budgetAmount REAL DEFAULT 500,
    budgetPeriod TEXT DEFAULT 'month',
    budgetStartDate TEXT DEFAULT CURRENT_TIMESTAMP,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    customerCount INTEGER,
    orderCount INTEGER,
    avgRating REAL,
    reviewCount INTEGER,
    socialProofEnabled INTEGER DEFAULT 1,
    socialProofType TEXT DEFAULT 'orders',
    socialProofMinimum INTEGER DEFAULT 100,
    socialProofUpdatedAt TEXT,
    copyVariants TEXT DEFAULT '{"variants":[],"segmentBestVariants":{}}',
    lastVariantUpdate TEXT DEFAULT CURRENT_TIMESTAMP,
    contributeToMetaLearning INTEGER DEFAULT 1,
    lastEvolutionCycle TEXT,
    mutationRate INTEGER DEFAULT 15,
    crossoverRate INTEGER DEFAULT 70,
    selectionPressure INTEGER DEFAULT 5,
    populationSize INTEGER DEFAULT 10,
    brandPrimaryColor TEXT DEFAULT '#000000',
    brandSecondaryColor TEXT DEFAULT '#ffffff',
    brandAccentColor TEXT DEFAULT '#f59e0b',
    brandFont TEXT DEFAULT 'system',
    brandLogoUrl TEXT,
    customCSS TEXT,
    promotionalIntelligenceEnabled INTEGER DEFAULT 1,
    exitIntentEnabled INTEGER DEFAULT 1,
    timeDelayEnabled INTEGER DEFAULT 0,
    timeDelaySeconds INTEGER DEFAULT 30,
    cartValueEnabled INTEGER DEFAULT 0,
    cartValueMin REAL DEFAULT 0,
    cartValueMax REAL DEFAULT 999999,
    modalHeadline TEXT DEFAULT 'Wait! Don''t leave yet',
    modalBody TEXT DEFAULT 'Complete your purchase now and get an exclusive discount!',
    ctaButton TEXT DEFAULT 'Complete My Order',
    redirectDestination TEXT DEFAULT 'checkout',
    discountCode TEXT,
    discountEnabled INTEGER DEFAULT 0,
    offerType TEXT DEFAULT 'percentage',
    manualDiscountCodeMode TEXT DEFAULT 'unique',
    manualGenericDiscountCode TEXT,
    manualDiscountCodePrefix TEXT DEFAULT 'EXIT',
    aiDiscountCodeMode TEXT DEFAULT 'unique',
    aiGenericDiscountCode TEXT,
    aiDiscountCodePrefix TEXT DEFAULT 'EXIT',
    discountCodeMode TEXT DEFAULT 'unique',
    genericDiscountCode TEXT,
    discountCodePrefix TEXT
  )
`);
console.log('  [OK] Shop table');

// DiscountOffer table
db.exec(`
  CREATE TABLE IF NOT EXISTS DiscountOffer (
    id TEXT PRIMARY KEY,
    shopId TEXT NOT NULL,
    discountCode TEXT NOT NULL,
    offerType TEXT NOT NULL,
    amount REAL NOT NULL,
    cartValue REAL,
    mode TEXT DEFAULT 'unique',
    expiresAt TEXT,
    redeemed INTEGER DEFAULT 0,
    redeemedAt TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shopId) REFERENCES Shop(id)
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_discount_shop_expires ON DiscountOffer(shopId, expiresAt)');
db.exec('CREATE INDEX IF NOT EXISTS idx_discount_shop_redeemed ON DiscountOffer(shopId, redeemed)');
console.log('  [OK] DiscountOffer table');

// AIDecision table
db.exec(`
  CREATE TABLE IF NOT EXISTS AIDecision (
    id TEXT PRIMARY KEY,
    shopId TEXT NOT NULL,
    signals TEXT NOT NULL,
    decision TEXT NOT NULL,
    offerId TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shopId) REFERENCES Shop(id)
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_aidecision_shop_created ON AIDecision(shopId, createdAt)');
console.log('  [OK] AIDecision table');

// MetaLearningInsights table
db.exec(`
  CREATE TABLE IF NOT EXISTS MetaLearningInsights (
    id TEXT PRIMARY KEY,
    insightType TEXT NOT NULL,
    segment TEXT NOT NULL,
    data TEXT NOT NULL,
    sampleSize INTEGER NOT NULL,
    confidenceLevel REAL NOT NULL,
    lastUpdated TEXT DEFAULT CURRENT_TIMESTAMP,
    version INTEGER DEFAULT 1
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_meta_segment ON MetaLearningInsights(segment, insightType)');
db.exec('CREATE INDEX IF NOT EXISTS idx_meta_updated ON MetaLearningInsights(lastUpdated)');
console.log('  [OK] MetaLearningInsights table');

// Variant table
db.exec(`
  CREATE TABLE IF NOT EXISTS Variant (
    id TEXT PRIMARY KEY,
    shopId TEXT NOT NULL,
    variantId TEXT UNIQUE NOT NULL,
    baseline TEXT NOT NULL,
    segment TEXT DEFAULT 'all',
    status TEXT DEFAULT 'alive',
    generation INTEGER DEFAULT 0,
    parents TEXT,
    offerAmount INTEGER NOT NULL,
    headline TEXT NOT NULL,
    subhead TEXT NOT NULL,
    cta TEXT NOT NULL,
    redirect TEXT NOT NULL,
    urgency INTEGER NOT NULL,
    colorScheme TEXT DEFAULT 'classic',
    layout TEXT DEFAULT 'centered',
    buttonStyle TEXT DEFAULT 'solid',
    animation TEXT DEFAULT 'fade',
    typography TEXT DEFAULT 'modern',
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    revenue REAL DEFAULT 0,
    profitPerImpression REAL DEFAULT 0,
    birthDate TEXT DEFAULT CURRENT_TIMESTAMP,
    deathDate TEXT,
    championDate TEXT,
    FOREIGN KEY (shopId) REFERENCES Shop(id)
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_variant_shop_status ON Variant(shopId, status)');
db.exec('CREATE INDEX IF NOT EXISTS idx_variant_shop_baseline ON Variant(shopId, baseline, segment)');
db.exec('CREATE INDEX IF NOT EXISTS idx_variant_status_profit ON Variant(status, profitPerImpression)');
console.log('  [OK] Variant table');

// VariantImpression table
db.exec(`
  CREATE TABLE IF NOT EXISTS VariantImpression (
    id TEXT PRIMARY KEY,
    variantId TEXT NOT NULL,
    shopId TEXT NOT NULL,
    clicked INTEGER DEFAULT 0,
    converted INTEGER DEFAULT 0,
    revenue REAL,
    discountAmount REAL,
    profit REAL,
    segment TEXT DEFAULT 'all',
    deviceType TEXT,
    trafficSource TEXT,
    cartValue REAL,
    accountStatus TEXT,
    visitFrequency INTEGER,
    duringPromo INTEGER DEFAULT 0,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (variantId) REFERENCES Variant(id)
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_impression_variant ON VariantImpression(variantId, converted)');
db.exec('CREATE INDEX IF NOT EXISTS idx_impression_shop_promo ON VariantImpression(shopId, duringPromo)');
db.exec('CREATE INDEX IF NOT EXISTS idx_impression_shop_timestamp ON VariantImpression(shopId, timestamp)');
db.exec('CREATE INDEX IF NOT EXISTS idx_impression_segment ON VariantImpression(segment, timestamp)');
db.exec('CREATE INDEX IF NOT EXISTS idx_impression_device ON VariantImpression(shopId, deviceType)');
db.exec('CREATE INDEX IF NOT EXISTS idx_impression_account ON VariantImpression(shopId, accountStatus)');
console.log('  [OK] VariantImpression table');

// MetaLearningGene table
db.exec(`
  CREATE TABLE IF NOT EXISTS MetaLearningGene (
    id TEXT PRIMARY KEY,
    baseline TEXT NOT NULL,
    geneType TEXT NOT NULL,
    geneValue TEXT NOT NULL,
    totalImpressions INTEGER DEFAULT 0,
    totalConversions INTEGER DEFAULT 0,
    totalRevenue REAL DEFAULT 0,
    avgCVR REAL DEFAULT 0,
    avgProfitPerImpression REAL DEFAULT 0,
    confidenceLevel REAL DEFAULT 0,
    industry TEXT,
    avgOrderValue TEXT,
    deviceType TEXT,
    sampleSize INTEGER DEFAULT 0,
    lastUpdated TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_gene_baseline_profit ON MetaLearningGene(baseline, avgProfitPerImpression)');
db.exec('CREATE INDEX IF NOT EXISTS idx_gene_baseline_type ON MetaLearningGene(baseline, geneType, confidenceLevel)');
console.log('  [OK] MetaLearningGene table');

// SeasonalPattern table
db.exec(`
  CREATE TABLE IF NOT EXISTS SeasonalPattern (
    id TEXT PRIMARY KEY,
    shopId TEXT NOT NULL,
    season TEXT NOT NULL,
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    avgCVR REAL DEFAULT 0,
    avgAOV REAL DEFAULT 0,
    avgProfitPerImpression REAL DEFAULT 0,
    trafficMultiplier REAL DEFAULT 1,
    recommendedOfferAmounts TEXT DEFAULT '[]',
    recommendedUrgency INTEGER DEFAULT 1,
    recommendedHeadlines TEXT DEFAULT '[]',
    FOREIGN KEY (shopId) REFERENCES Shop(id)
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_season_shop ON SeasonalPattern(shopId, season)');
console.log('  [OK] SeasonalPattern table');

// BrandSafetyRule table
db.exec(`
  CREATE TABLE IF NOT EXISTS BrandSafetyRule (
    id TEXT PRIMARY KEY,
    shopId TEXT UNIQUE NOT NULL,
    prohibitedWords TEXT DEFAULT '[]',
    requiredPhrases TEXT DEFAULT '[]',
    maxDiscountPercent INTEGER DEFAULT 100,
    tone TEXT DEFAULT 'casual',
    enabled INTEGER DEFAULT 1,
    FOREIGN KEY (shopId) REFERENCES Shop(id)
  )
`);
console.log('  [OK] BrandSafetyRule table');

// Promotion table
db.exec(`
  CREATE TABLE IF NOT EXISTS Promotion (
    id TEXT PRIMARY KEY,
    shopId TEXT NOT NULL,
    code TEXT NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL,
    detectedVia TEXT NOT NULL,
    status TEXT DEFAULT 'monitoring',
    validFrom TEXT,
    validUntil TEXT,
    usageStats TEXT DEFAULT '{"total":0,"last24h":0}',
    classification TEXT,
    aiStrategy TEXT,
    aiStrategyReason TEXT,
    merchantOverride TEXT,
    seenByMerchant INTEGER DEFAULT 0,
    detectedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shopId) REFERENCES Shop(id)
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_promo_shop_status ON Promotion(shopId, status)');
db.exec('CREATE INDEX IF NOT EXISTS idx_promo_shop_code ON Promotion(shopId, code)');
db.exec('CREATE INDEX IF NOT EXISTS idx_promo_shop_seen ON Promotion(shopId, seenByMerchant)');
db.exec('CREATE INDEX IF NOT EXISTS idx_promo_detected ON Promotion(detectedAt)');
console.log('  [OK] Promotion table');

// Conversion table
db.exec(`
  CREATE TABLE IF NOT EXISTS Conversion (
    id TEXT PRIMARY KEY,
    shopId TEXT NOT NULL,
    orderId TEXT NOT NULL,
    orderNumber TEXT NOT NULL,
    orderValue REAL NOT NULL,
    customerEmail TEXT,
    orderedAt TEXT NOT NULL,
    modalId TEXT NOT NULL,
    modalName TEXT,
    variantId TEXT,
    modalHadDiscount INTEGER DEFAULT 0,
    discountCode TEXT,
    discountRedeemed INTEGER DEFAULT 0,
    discountAmount REAL,
    modalSnapshot TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(shopId, orderId)
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_conversion_shop ON Conversion(shopId)');
db.exec('CREATE INDEX IF NOT EXISTS idx_conversion_ordered ON Conversion(orderedAt)');
console.log('  [OK] Conversion table');

console.log('\nDatabase schema created successfully!');
console.log(`Database file: ${path.join(__dirname, 'prisma', 'dev.sqlite')}`);

db.close();
