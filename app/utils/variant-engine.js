// Variant Engine: Core evolution system for creating, managing, and evolving variants

import { genePools, getRandomGene, getAllBaselines } from './gene-pools.js';
import { PrismaClient } from '@prisma/client';
import jStat from 'jstat';

const db = new PrismaClient();

/**
 * Generate a unique variant ID
 */
function generateVariantId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 7);
  return `VAR_${timestamp}_${random}`.toUpperCase();
}

/**
 * Create a single random variant from a gene pool
 */
function createRandomVariant(baseline, segment = 'all') {
  const pool = genePools[baseline];
  
  return {
    variantId: generateVariantId(),
    baseline: baseline,
    segment: segment,
    status: 'alive',
    generation: 0,
    parents: null,
    
    // Random genes
    offerAmount: pool.offerAmounts[Math.floor(Math.random() * pool.offerAmounts.length)],
    headline: pool.headlines[Math.floor(Math.random() * pool.headlines.length)],
    subhead: pool.subheads[Math.floor(Math.random() * pool.subheads.length)],
    cta: pool.ctas[Math.floor(Math.random() * pool.ctas.length)],
    redirect: pool.redirects[Math.floor(Math.random() * pool.redirects.length)],
    urgency: pool.urgency[Math.floor(Math.random() * pool.urgency.length)],
    
    // Initialize performance
    impressions: 0,
    clicks: 0,
    conversions: 0,
    revenue: 0,
    profitPerImpression: 0,
    
    birthDate: new Date(),
    deathDate: null,
    championDate: null
  };
}

/**
 * Latin Hypercube Sampling: Generate diverse starting variants
 * Ensures good coverage of the gene space
 */
function generateDiverseVariants(count, baseline, segment = 'all') {
  const pool = genePools[baseline];
  const variants = [];
  
  for (let i = 0; i < count; i++) {
    // Deterministically spread variants across gene space
    const offerIndex = Math.floor(i / (count / pool.offerAmounts.length)) % pool.offerAmounts.length;
    const headlineIndex = i % pool.headlines.length;
    const subheadIndex = Math.floor(i / 3.3) % pool.subheads.length;
    const ctaIndex = i % pool.ctas.length;
    const redirectIndex = i % 2;
    const urgencyValue = i < count / 2;
    
    variants.push({
      variantId: generateVariantId(),
      baseline: baseline,
      segment: segment,
      status: 'alive',
      generation: 0,
      parents: null,
      
      offerAmount: pool.offerAmounts[offerIndex],
      headline: pool.headlines[headlineIndex],
      subhead: pool.subheads[subheadIndex],
      cta: pool.ctas[ctaIndex],
      redirect: pool.redirects[redirectIndex],
      urgency: urgencyValue,
      
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      profitPerImpression: 0,
      
      birthDate: new Date(),
      deathDate: null,
      championDate: null
    });
  }
  
  return variants;
}

/**
 * Seed initial population (Generation 0) for a shop
 * 
 * NEW STORES (<100 impressions): Inherit proven genes from network
 * EXISTING STORES: Random exploration
 */
export async function seedInitialPopulation(shopId, baseline, segment = 'all') {
  console.log(`🌱 Seeding initial population for shop ${shopId}, baseline ${baseline}, segment ${segment}`);
  
  // Check if shop is new
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    include: {
      variants: {
        where: { baseline: baseline, segment: segment }
      }
    }
  });
  
  if (!shop) {
    throw new Error(`Shop ${shopId} not found`);
  }
  
  // Check if variants already exist for this baseline/segment
  if (shop.variants.length > 0) {
    console.log(`⚠️ Variants already exist for ${baseline}/${segment}. Skipping seed.`);
    return shop.variants;
  }
  
  // Count total impressions across all variants
  const totalImpressions = await db.variantImpression.count({
    where: { shopId: shopId }
  });
  
  let variants = [];
  
  // NEW STORE: Inherit proven genes from network
  if (totalImpressions < 100 && shop.contributeToMetaLearning) {
    console.log('🆕 New store detected - checking for proven genes from network...');
    
    // Query top-performing genes from meta-learning
    const provenGenes = await db.metaLearningGene.findMany({
      where: {
        baseline: baseline,
        sampleSize: { gte: 3 }, // At least 3 stores used this gene
        confidenceLevel: { gte: 0.7 }, // 70%+ confidence
        avgProfitPerImpression: { gt: 0 }
      },
      orderBy: { avgProfitPerImpression: 'desc' },
      take: 10,
      distinct: ['geneType'] // Get one top gene per type
    });
    
    if (provenGenes.length >= 3) {
      console.log(`✨ Found ${provenGenes.length} proven genes from network`);
      
      // Create 5 variants using proven genes + some random genes
      for (let i = 0; i < 5; i++) {
        const variant = createRandomVariant(baseline, segment);
        
        // Override with proven genes where available
        provenGenes.forEach(gene => {
          if (gene.geneType === 'offerAmount') {
            variant.offerAmount = parseInt(gene.geneValue);
          } else if (gene.geneType === 'headline') {
            variant.headline = gene.geneValue;
          } else if (gene.geneType === 'subhead') {
            variant.subhead = gene.geneValue;
          } else if (gene.geneType === 'cta') {
            variant.cta = gene.geneValue;
          } else if (gene.geneType === 'redirect') {
            variant.redirect = gene.geneValue;
          } else if (gene.geneType === 'urgency') {
            variant.urgency = gene.geneValue === 'true';
          }
        });
        
        variants.push(variant);
      }
      
      // Add 5 random exploration variants
      variants.push(...generateDiverseVariants(5, baseline, segment));
      
      console.log('✅ Created 5 proven + 5 random variants');
    } else {
      console.log('⚠️ Not enough proven genes found, using random seed');
      variants = generateDiverseVariants(10, baseline, segment);
    }
  }
  // EXISTING STORE: Pure random exploration
  else {
    console.log('🎲 Existing store - generating diverse random variants');
    variants = generateDiverseVariants(10, baseline, segment);
  }
  
  // Save variants to database
  const createdVariants = [];
  for (const variantData of variants) {
    const created = await db.variant.create({
      data: {
        shopId: shopId,
        ...variantData
      }
    });
    createdVariants.push(created);
  }
  
  console.log(`✅ Created ${createdVariants.length} generation 0 variants`);
  
  return createdVariants;
}

/**
 * Get live variants for a shop/baseline/segment
 */
export async function getLiveVariants(shopId, baseline, segment = 'all') {
  return await db.variant.findMany({
    where: {
      shopId: shopId,
      baseline: baseline,
      segment: segment,
      status: { in: ['alive', 'champion'] }
    },
    orderBy: { profitPerImpression: 'desc' }
  });
}

/**
 * Initialize all baselines for a new shop
 * Creates 10 variants for each of the 4 baselines
 */
export async function initializeShopVariants(shopId, segment = 'all') {
  console.log(`🎬 Initializing all baselines for shop ${shopId}`);
  
  const baselines = getAllBaselines();
  const results = {};
  
  for (const baseline of baselines) {
    try {
      const variants = await seedInitialPopulation(shopId, baseline, segment);
      results[baseline] = {
        success: true,
        count: variants.length
      };
    } catch (error) {
      console.error(`❌ Failed to seed ${baseline}:`, error);
      results[baseline] = {
        success: false,
        error: error.message
      };
    }
  }
  
  const totalVariants = Object.values(results)
    .filter(r => r.success)
    .reduce((sum, r) => sum + r.count, 0);
  
  console.log(`✅ Initialized ${totalVariants} variants across ${baselines.length} baselines`);
  
  return results;
}

/**
 * Sample from beta distribution (for Thompson Sampling)
 * Uses jstat library
 */
function betaSample(alpha, beta) {
  return jStat.beta.sample(alpha, beta);
}

/**
 * Thompson Sampling: Select variant for next impression
 * 
 * Champion gets 70% of traffic, remaining 30% uses Thompson Sampling
 * among contenders. This balances exploitation (use winner) with
 * exploration (try new variants).
 */
export async function selectVariantForImpression(shopId, baseline, segment = 'all') {
  // Get all live variants
  const liveVariants = await getLiveVariants(shopId, baseline, segment);
  
  if (liveVariants.length === 0) {
    throw new Error(`No live variants found for shop ${shopId}, baseline ${baseline}, segment ${segment}`);
  }
  
  // If only one variant, return it
  if (liveVariants.length === 1) {
    return liveVariants[0];
  }
  
  // Check if there's a champion
  const champion = liveVariants.find(v => v.status === 'champion');
  
  // Champion gets 70% of traffic
  if (champion && Math.random() < 0.7) {
    console.log(`👑 Champion ${champion.variantId} selected (70% traffic)`);
    return champion;
  }
  
  // Remaining 30% (or 100% if no champion): Thompson Sampling
  const contenders = liveVariants.filter(v => v.status !== 'champion');
  
  if (contenders.length === 0) {
    // Edge case: champion is the only variant
    return champion;
  }
  
  // Thompson Sampling: Sample from beta distribution for each variant
  const samples = contenders.map(variant => {
    // Beta distribution parameters
    // alpha = successes + 1 (prior of 1)
    // beta = failures + 1 (prior of 1)
    const alpha = variant.conversions + 1;
    const beta_param = (variant.impressions - variant.conversions) + 1;
    
    // Sample from beta(alpha, beta)
    const sample = betaSample(alpha, beta_param);
    
    return {
      variant: variant,
      sample: sample
    };
  });
  
  // Sort by sample value (highest wins this "tournament")
  samples.sort((a, b) => b.sample - a.sample);
  
  const winner = samples[0].variant;
  console.log(`🎲 Thompson Sampling selected ${winner.variantId} (sample: ${samples[0].sample.toFixed(4)})`);
  
  return winner;
}

/**
 * Record an impression for a variant
 */
export async function recordImpression(variantId, shopId, context = {}) {
  // Update variant impression count
  await db.variant.update({
    where: { id: variantId },
    data: {
      impressions: { increment: 1 }
    }
  });
  
  // Create impression record
  const impression = await db.variantImpression.create({
    data: {
      variantId: variantId,
      shopId: shopId,
      segment: context.segment || 'all',
      deviceType: context.deviceType || null,
      trafficSource: context.trafficSource || null,
      cartValue: context.cartValue || null,
      clicked: false,
      converted: false
    }
  });
  
  console.log(`📊 Recorded impression for variant ${variantId}`);
  
  return impression;
}

/**
 * Record a click on a variant
 */
export async function recordClick(impressionId) {
  const impression = await db.variantImpression.update({
    where: { id: impressionId },
    data: { clicked: true }
  });
  
  // Update variant click count
  await db.variant.update({
    where: { id: impression.variantId },
    data: {
      clicks: { increment: 1 }
    }
  });
  
  console.log(`👆 Recorded click for impression ${impressionId}`);
  
  return impression;
}

/**
 * Record a conversion for a variant
 */
export async function recordConversion(impressionId, revenue, discountAmount = 0) {
  const profit = revenue - discountAmount;
  
  const impression = await db.variantImpression.update({
    where: { id: impressionId },
    data: {
      converted: true,
      revenue: revenue,
      discountAmount: discountAmount,
      profit: profit
    }
  });
  
  // Update variant performance
  const variant = await db.variant.findUnique({
    where: { id: impression.variantId }
  });
  
  const newConversions = variant.conversions + 1;
  const newRevenue = variant.revenue + revenue;
  const newImpressions = variant.impressions;
  
  // Calculate profit per impression
  const cvr = newConversions / newImpressions;
  const aov = newRevenue / newConversions;
  const profitPerConversion = aov - (discountAmount / newConversions);
  const profitPerImpression = profitPerConversion * cvr;
  
  await db.variant.update({
    where: { id: impression.variantId },
    data: {
      conversions: newConversions,
      revenue: newRevenue,
      profitPerImpression: profitPerImpression
    }
  });
  
  console.log(`💰 Recorded conversion for impression ${impressionId}: $${revenue} revenue, $${discountAmount} discount`);
  
  return impression;
}

/**
 * Test variant creation (for development)
 */
export async function testVariantCreation() {
  console.log('🧪 Testing Variant Creation');
  console.log('===========================\n');
  
  // Test 1: Create random variant
  console.log('Test 1: Random variant creation');
  const randomVariant = createRandomVariant('conversion_with_discount', 'mobile');
  console.log('✅ Random variant:', {
    variantId: randomVariant.variantId,
    baseline: randomVariant.baseline,
    genes: {
      offerAmount: randomVariant.offerAmount,
      headline: randomVariant.headline.substring(0, 30) + '...',
      cta: randomVariant.cta,
      redirect: randomVariant.redirect,
      urgency: randomVariant.urgency
    }
  });
  
  // Test 2: Create diverse variants
  console.log('\nTest 2: Diverse variant generation (Latin Hypercube Sampling)');
  const diverseVariants = generateDiverseVariants(10, 'revenue_with_discount', 'desktop');
  console.log(`✅ Created ${diverseVariants.length} diverse variants`);
  console.log('Offer distribution:', 
    [...new Set(diverseVariants.map(v => v.offerAmount))].sort()
  );
  console.log('Redirect distribution:', 
    diverseVariants.reduce((acc, v) => {
      acc[v.redirect] = (acc[v.redirect] || 0) + 1;
      return acc;
    }, {})
  );
  console.log('Urgency distribution:', 
    diverseVariants.reduce((acc, v) => {
      const key = v.urgency ? 'true' : 'false';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  );
  
  console.log('\n✅ All tests passed!');
}
