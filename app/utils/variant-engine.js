// Variant Engine: Core evolution system for creating, managing, and evolving variants

import { genePools, getRandomGene, getAllBaselines } from './gene-pools.js';
import { generateVisualGenes } from './visual-gene-pools.js';
import { validateVariantCopy } from './brand-safety.js';
import { hasSocialProof, replaceSocialProofPlaceholders } from './social-proof.js';
import { getSocialProofFromCache, setSocialProofCache } from './social-proof-cache.js';

// Helper to get db instance (dynamic import for React Router 7 compatibility)
let dbInstance = null;
async function getDb() {
  if (!dbInstance) {
    const { default: db } = await import('../db.server.js');
    dbInstance = db;
  }
  return dbInstance;
}
// import db from '../db.server.js';
import jStat from 'jstat';

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
function createRandomVariant(baseline, segment = 'all', useSocialProof = false) {
  const pool = genePools[baseline];
  
  // Decide which gene pools to use based on social proof availability
  const headlinePool = useSocialProof && pool.headlinesWithSocialProof
    ? [...pool.headlines, ...pool.headlinesWithSocialProof]
    : pool.headlines;
  
  const subheadPool = useSocialProof && pool.subheadsWithSocialProof
    ? [...pool.subheads, ...pool.subheadsWithSocialProof]
    : pool.subheads;
  
  return {
    variantId: generateVariantId(),
    baseline: baseline,
    segment: segment,
    status: 'alive',
    generation: 0,
    parents: null,
    
    // Random genes (using appropriate pools)
    offerAmount: pool.offerAmounts[Math.floor(Math.random() * pool.offerAmounts.length)],
    headline: headlinePool[Math.floor(Math.random() * headlinePool.length)],
    subhead: subheadPool[Math.floor(Math.random() * subheadPool.length)],
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
 * Create a random variant with social proof support
 * Checks cache for shop's social proof data and uses it to:
 * 1. Decide whether to use social proof gene pools
 * 2. Replace placeholders with actual values
 */
export async function createRandomVariantWithSocialProof(shopId, baseline, segment = 'all') {
  // Try cache first
  let shop = getSocialProofFromCache(shopId);
  
  // If not cached, fetch from database
  if (!shop) {
    shop = await (await getDb()).shop.findUnique({
      where: { id: shopId },
      select: {
        orderCount: true,
        customerCount: true,
        avgRating: true,
        reviewCount: true,
        socialProofEnabled: true,
        socialProofType: true,
        socialProofMinimum: true
      }
    });
    
    // Cache it for next time
    if (shop) {
      setSocialProofCache(shopId, shop);
    }
  }
  
  // Check if shop qualifies for social proof
  const socialProofAvailable = shop?.socialProofEnabled && hasSocialProof(shop);
  
  // Create variant with appropriate gene pool
  const variant = createRandomVariant(baseline, segment, socialProofAvailable);
  
  // Replace placeholders if this variant has social proof genes
  if (socialProofAvailable && variant.headline.includes('{{')) {
    variant.headline = replaceSocialProofPlaceholders(variant.headline, shop);
  }
  
  if (socialProofAvailable && variant.subhead.includes('{{')) {
    variant.subhead = replaceSocialProofPlaceholders(variant.subhead, shop);
  }
  
  return variant;
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
  console.log(` Seeding initial population for shop ${shopId}, baseline ${baseline}, segment ${segment}`);
  
  // Check if shop is new
  const shop = await (await getDb()).shop.findUnique({
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
    console.log(` Variants already exist for ${baseline}/${segment}. Skipping seed.`);
    return shop.variants;
  }
  
  // Count total impressions across all variants
  const totalImpressions = await (await getDb()).variantImpression.count({
    where: { shopId: shopId }
  });
  
  let variants = [];
  
  // NEW STORE: Inherit proven genes from network
  if (totalImpressions < 100 && shop.contributeToMetaLearning) {
    console.log('🆕 New store detected - checking for proven genes from network...');
    
    // Query top-performing genes from meta-learning
    const provenGenes = await (await getDb()).metaLearningGene.findMany({
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
      console.log(` Found ${provenGenes.length} proven genes from network`);
      
      // Create 5 variants using proven genes + some random genes
      const variantPromises = [];
      for (let i = 0; i < 5; i++) {
        variantPromises.push(createRandomVariantWithSocialProof(shopId, baseline, segment));
      }
      const createdVariants = await Promise.all(variantPromises);
      
      createdVariants.forEach(variant => {
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
      });
      
      // Add 5 random exploration variants
      variants.push(...generateDiverseVariants(5, baseline, segment));
      
      console.log(' Created 5 proven + 5 random variants');
    } else {
      console.log(' Not enough proven genes found, using random seed');
      variants = generateDiverseVariants(10, baseline, segment);
    }
  }
  // EXISTING STORE: Pure random exploration
  else {
    console.log(' Existing store - generating diverse random variants');
    variants = generateDiverseVariants(10, baseline, segment);
  }
  
  // Save variants to database
  const createdVariants = [];
  for (const variantData of variants) {
    const created = await (await getDb()).variant.create({
      data: {
        shopId: shopId,
        ...variantData
      }
    });
    createdVariants.push(created);
  }
  
  console.log(` Created ${createdVariants.length} generation 0 variants`);
  
  return createdVariants;
}

/**
 * Get live variants for a shop/baseline/segment
 */
export async function getLiveVariants(shopId, baseline, segment = 'all') {
  return await (await getDb()).variant.findMany({
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
  console.log(` Initializing all baselines for shop ${shopId}`);
  
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
      console.error(` Failed to seed ${baseline}:`, error);
      results[baseline] = {
        success: false,
        error: error.message
      };
    }
  }
  
  const totalVariants = Object.values(results)
    .filter(r => r.success)
    .reduce((sum, r) => sum + r.count, 0);
  
  console.log(` Initialized ${totalVariants} variants across ${baselines.length} baselines`);
  
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
    console.log(` Champion ${champion.variantId} selected (70% traffic)`);
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
  console.log(` Thompson Sampling selected ${winner.variantId} (sample: ${samples[0].sample.toFixed(4)})`);
  
  return winner;
}

/**
 * Record an impression for a variant
 */
export async function recordImpression(variantId, shopId, context = {}) {
  // Update variant impression count
  await (await getDb()).variant.update({
    where: { id: variantId },
    data: {
      impressions: { increment: 1 }
    }
  });

  // Check if there's an active promotion
  const activePromo = await (await getDb()).promotion.findFirst({
    where: {
      shopId: shopId,
      status: 'active'
    }
  });

  // Create impression record
  const impression = await (await getDb()).variantImpression.create({
    data: {
      variantId: variantId,
      shopId: shopId,
      segment: context.segment || 'all',
      deviceType: context.deviceType || null,
      trafficSource: context.trafficSource || null,
      cartValue: context.cartValue || null,
      duringPromo: activePromo ? true : false,
      clicked: false,
      converted: false
    }
  });

  console.log(` Recorded impression for variant ${variantId}${activePromo ? ' (during promo)' : ''}`);

  return impression;
}

/**
 * Record a click on a variant
 */
export async function recordClick(impressionId) {
  const impression = await (await getDb()).variantImpression.update({
    where: { id: impressionId },
    data: { clicked: true }
  });
  
  // Update variant click count
  await (await getDb()).variant.update({
    where: { id: impression.variantId },
    data: {
      clicks: { increment: 1 }
    }
  });
  
  console.log(` Recorded click for impression ${impressionId}`);
  
  return impression;
}

/**
 * Record a conversion for a variant
 */
export async function recordConversion(impressionId, revenue, discountAmount = 0) {
  const profit = revenue - discountAmount;
  
  const impression = await (await getDb()).variantImpression.update({
    where: { id: impressionId },
    data: {
      converted: true,
      revenue: revenue,
      discountAmount: discountAmount,
      profit: profit
    }
  });
  
  // Update variant performance
  const variant = await (await getDb()).variant.findUnique({
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
  
  await (await getDb()).variant.update({
    where: { id: impression.variantId },
    data: {
      conversions: newConversions,
      revenue: newRevenue,
      profitPerImpression: profitPerImpression
    }
  });
  
  console.log(` Recorded conversion for impression ${impressionId}: $${revenue} revenue, $${discountAmount} discount`);
  
  return impression;
}



/**
 * Bayesian A/B Test: Compare two variants
 * Returns probability that variantA beats variantB
 * Uses Monte Carlo simulation with beta distributions
 */
function bayesianCompare(variantA, variantB) {
  const samplesA = [];
  const samplesB = [];
  const numSamples = 10000;
  
  // Sample from beta distributions
  for (let i = 0; i < numSamples; i++) {
    const sampleA = betaSample(variantA.conversions + 1, variantA.impressions - variantA.conversions + 1);
    const sampleB = betaSample(variantB.conversions + 1, variantB.impressions - variantB.conversions + 1);
    
    samplesA.push(sampleA);
    samplesB.push(sampleB);
  }
  
  // Calculate probability that A beats B
  let aWins = 0;
  for (let i = 0; i < numSamples; i++) {
    if (samplesA[i] > samplesB[i]) {
      aWins++;
    }
  }
  
  const probability = aWins / numSamples;
  
  // Calculate lift (how much better is A than B)
  const avgA = samplesA.reduce((sum, v) => sum + v, 0) / numSamples;
  const avgB = samplesB.reduce((sum, v) => sum + v, 0) / numSamples;
  const lift = avgB > 0 ? (avgA - avgB) / avgB : 0;
  
  return {
    probability: probability,
    lift: lift,
    avgCVR_A: avgA,
    avgCVR_B: avgB
  };
}

/**
 * Weighted random selection (for parent selection in breeding)
 * Higher weight = higher chance of selection
 */
function weightedRandomSelection(variants, weightFn) {
  const weights = variants.map(v => Math.max(weightFn(v), 0.001)); // Prevent zero weights
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  
  let random = Math.random() * totalWeight;
  
  for (let i = 0; i < variants.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return variants[i];
    }
  }
  
  return variants[variants.length - 1]; // Fallback
}

/**
 * Breed a new variant from two parents using genetic algorithm
 */
async function breedNewVariant(parents, baseline, segment = 'all', shopId = null, evolutionSettings = null) {
  const pool = genePools[baseline];
  
  // Default settings if not provided
  const settings = evolutionSettings || {
    mutationRate: 15,
    crossoverRate: 70
  };
  
  const crossoverRate = settings.crossoverRate / 100; // Convert to 0-1
  const mutationRate = settings.mutationRate / 100; // Convert to 0-1
  
  // Select two parents weighted by profit per impression
  const parent1 = weightedRandomSelection(parents, v => v.profitPerImpression + 1);
  const parent2 = weightedRandomSelection(parents, v => v.profitPerImpression + 1);
  
  console.log(` Breeding from parents: ${parent1.variantId} (Gen ${parent1.generation}) + ${parent2.variantId} (Gen ${parent2.generation})`);
  console.log(`   Settings: ${(crossoverRate*100).toFixed(0)}% crossover, ${(mutationRate*100).toFixed(0)}% mutation`);
  
  // Crossover: Inherit genes from both parents based on crossoverRate
  // High crossover rate = more mixing of parent genes
  // Low crossover rate = more likely to take all genes from one parent
  const childGenes = {
    offerAmount: Math.random() < crossoverRate ? (Math.random() < 0.5 ? parent1.offerAmount : parent2.offerAmount) : parent1.offerAmount,
    headline: Math.random() < crossoverRate ? (Math.random() < 0.5 ? parent1.headline : parent2.headline) : parent1.headline,
    subhead: Math.random() < crossoverRate ? (Math.random() < 0.5 ? parent1.subhead : parent2.subhead) : parent1.subhead,
    cta: Math.random() < crossoverRate ? (Math.random() < 0.5 ? parent1.cta : parent2.cta) : parent1.cta,
    redirect: Math.random() < crossoverRate ? (Math.random() < 0.5 ? parent1.redirect : parent2.redirect) : parent1.redirect,
    urgency: Math.random() < crossoverRate ? (Math.random() < 0.5 ? parent1.urgency : parent2.urgency) : parent1.urgency
  };
  
  // Mutation: Randomize each gene based on mutationRate
  const mutations = [];
  Object.keys(childGenes).forEach(gene => {
    if (Math.random() < mutationRate) {
      const geneKey = gene === 'offerAmount' ? 'offerAmounts' : 
                      gene === 'urgency' ? 'urgency' :
                      gene + 's';
      const options = pool[geneKey];
      childGenes[gene] = options[Math.floor(Math.random() * options.length)];
      mutations.push(gene);
    }
  });
  
  if (mutations.length > 0) {
    console.log(`   Mutations in: ${mutations.join(', ')}`);
  }
  
  const newGeneration = Math.max(parent1.generation, parent2.generation) + 1;
  
  const newVariant = {
    variantId: generateVariantId(),
    baseline: baseline,
    segment: segment,
    status: 'alive',
    generation: newGeneration,
    parents: JSON.stringify([parent1.variantId, parent2.variantId]),
    
    ...childGenes,
    
    impressions: 0,
    clicks: 0,
    conversions: 0,
    revenue: 0,
    profitPerImpression: 0,
    
    birthDate: new Date(),
    deathDate: null,
    championDate: null
  };
  
  // Brand Safety: Validate variant copy (Enterprise only)
  if (shopId) {
    const validation = await validateVariantCopy(
      shopId,
      childGenes.headline,
      childGenes.subhead,
      childGenes.cta,
      childGenes.offerAmount
    );
    
    if (!validation.valid) {
      console.log(`   Brand safety violation, re-breeding...`);
      console.log(`     ${validation.violations.join(', ')}`);
      // Recursively breed again until valid
      return await breedNewVariant(parents, baseline, segment, shopId);
    }
  }
  
  return newVariant;
}

/**
 * Check if a variant should be declared champion
 * Must beat all others with 95% confidence + 500 impressions + 7 days alive
 */
function detectChampion(liveVariants) {
  // High bar for championship
  const candidates = liveVariants.filter(v => {
    if (v.impressions < 500) return false;  // Need data
    
    const ageDays = (new Date() - v.birthDate) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) return false;  // Need time (7 days minimum)
    
    return true;
  });
  
  if (candidates.length === 0) return null;
  
  const topPerformer = candidates
    .sort((a, b) => b.profitPerImpression - a.profitPerImpression)[0];
  
  // Must beat ALL others with 95% confidence
  const beatsAll = liveVariants
    .filter(v => v.id !== topPerformer.id)
    .every(v => {
      if (v.impressions < 50) return true; // Too early to compare
      
      const test = bayesianCompare(topPerformer, v);
      return test.probability > 0.95;  // 95% confident we're better
    });
  
  if (beatsAll) {
    console.log(` New champion detected: ${topPerformer.variantId} (Gen ${topPerformer.generation})`);
    return topPerformer;
  }
  
  return null;
}

/**
 * Evolution Cycle: Kill poor performers, breed replacements
 * Runs every 100 impressions
 */
export async function evolutionCycle(shopId, baseline, segment = 'all') {
  console.log(`\n EVOLUTION CYCLE: Shop ${shopId}, Baseline ${baseline}, Segment ${segment}`);
  console.log('='.repeat(80));
  
  // Load shop's evolution settings
  const shop = await (await getDb()).shop.findUnique({
    where: { id: shopId },
    select: {
      plan: true,
      mutationRate: true,
      crossoverRate: true,
      selectionPressure: true,
      populationSize: true
    }
  });

  // Apply tier-based population size limits
  let populationSize = shop?.populationSize || 10;
  if (shop?.plan === 'pro') {
    // Pro tier: max 2 variants
    populationSize = Math.min(populationSize, 2);
  } else if (shop?.plan === 'enterprise') {
    // Enterprise tier: max 20 variants
    populationSize = Math.min(populationSize, 20);
  }

  const evolutionSettings = {
    mutationRate: shop?.mutationRate || 15,
    crossoverRate: shop?.crossoverRate || 70,
    selectionPressure: shop?.selectionPressure || 5,
    populationSize: populationSize
  };

  console.log(`  Evolution Settings: Mutation ${evolutionSettings.mutationRate}%, Crossover ${evolutionSettings.crossoverRate}%, Pressure ${evolutionSettings.selectionPressure}/10, Pop ${evolutionSettings.populationSize} (Tier: ${shop?.plan || 'unknown'})`);
  
  let liveVariants = await getLiveVariants(shopId, baseline, segment);
  
  if (liveVariants.length === 0) {
    console.log(' No live variants found. Skipping evolution.');
    return;
  }
  
  console.log(` Current population: ${liveVariants.length} live variants`);
  
  // Step 1: Calculate profit/impression for all variants
  liveVariants.forEach(v => {
    if (v.impressions > 0 && v.conversions > 0) {
      const cvr = v.conversions / v.impressions;
      const aov = v.revenue / v.conversions;
      const avgDiscountCost = (v.offerAmount / 100) * aov; // Assume percentage discount
      const profitPerConversion = aov - avgDiscountCost;
      v.profitPerImpression = profitPerConversion * cvr;
    }
    console.log(`  ${v.variantId}: ${v.impressions} imp, ${v.conversions} conv (${(v.conversions/v.impressions*100).toFixed(1)}%), $${v.profitPerImpression.toFixed(2)}/imp`);
  });
  
  // Step 2: Identify dying variants (Bayesian confidence)
  const dying = [];
  const champion = liveVariants.find(v => v.status === 'champion');
  
  const contenders = liveVariants
    .filter(v => v.status !== 'champion')
    .sort((a, b) => b.profitPerImpression - a.profitPerImpression);
  
  if (contenders.length > 1) {
    const topPerformer = contenders[0];
    
    contenders.forEach(variant => {
      if (variant.impressions < 50) return; // Too early
      if (variant.id === topPerformer.id) return; // Can't kill the top performer
      
      // Bayesian A/B test: Are we confident enough this variant is worse?
      // Convert selectionPressure (1-10) to confidence threshold (0.80-0.99)
      const confidenceThreshold = 0.70 + (evolutionSettings.selectionPressure / 10) * 0.29; // Maps 1→0.799, 5→0.915, 10→0.99
      const test = bayesianCompare(topPerformer, variant);
      
      if (test.probability > confidenceThreshold) {
        console.log(` Marking for death: ${variant.variantId} (${test.probability.toFixed(3)} confidence it's worse)`);
        dying.push(variant);
      }
    });
  }
  
  // Step 3: Kill variants
  if (dying.length > 0) {
    console.log(`\n Killing ${dying.length} variant(s)`);
    
    for (const variant of dying) {
      await (await getDb()).variant.update({
        where: { id: variant.id },
        data: {
          status: 'dead',
          deathDate: new Date()
        }
      });
    }
    
    // Remove from live pool
    liveVariants = liveVariants.filter(v => !dying.includes(v));
  }
  
  // Step 4: Breed replacements
  const targetPopulation = evolutionSettings.populationSize;
  const needToBreed = targetPopulation - liveVariants.length;
  
  if (needToBreed > 0 && liveVariants.length >= 2) {
    console.log(`\n Breeding ${needToBreed} new variant(s)`);
    
    for (let i = 0; i < needToBreed; i++) {
      const childData = await breedNewVariant(liveVariants, baseline, segment, shopId, evolutionSettings);
      
      const newVariant = await (await getDb()).variant.create({
        data: {
          shopId: shopId,
          ...childData
        }
      });
      
      console.log(`   Born: ${newVariant.variantId} (Gen ${newVariant.generation})`);
      liveVariants.push(newVariant);
    }
  }
  
  // Step 5: Check for new champion
  const newChampion = detectChampion(liveVariants);
  
  if (newChampion) {
    // Dethrone old champion if exists
    if (champion && champion.id !== newChampion.id) {
      await (await getDb()).variant.update({
        where: { id: champion.id },
        data: { status: 'alive', championDate: null }
      });
      console.log(`   Dethroned: ${champion.variantId}`);
    }
    
    // Crown new champion
    await (await getDb()).variant.update({
      where: { id: newChampion.id },
      data: { status: 'champion', championDate: new Date() }
    });
    console.log(`   Crowned: ${newChampion.variantId}`);
  }
  
  // Step 6: Update shop's last evolution cycle timestamp
  await (await getDb()).shop.update({
    where: { id: shopId },
    data: { lastEvolutionCycle: new Date() }
  });
  
  console.log(`\n Evolution cycle complete. Population: ${liveVariants.length}`);
  console.log('='.repeat(80) + '\n');
  
  return {
    killed: dying.length,
    bred: needToBreed,
    champion: newChampion?.variantId || null,
    population: liveVariants.length
  };
}

/**
 * Test variant creation (for development)
 */
export async function testVariantCreation() {
  console.log(' Testing Variant Creation');
  console.log('===========================\n');
  
  // Test 1: Create random variant
  console.log('Test 1: Random variant creation');
  const randomVariant = createRandomVariant('conversion_with_discount', 'mobile');
  console.log(' Random variant:', {
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
  console.log(` Created ${diverseVariants.length} diverse variants`);
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
  
  console.log('\n All tests passed!');
}
