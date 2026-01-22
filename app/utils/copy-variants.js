// Copy Variant Utilities for Exit Intent Offer
// Handles segment-based copy optimization with epsilon-greedy algorithm

/**
 * Get customer segment based on signals
 * Format: ${deviceType}_${trafficSource}
 */
export function getSegment(signals) {
  const device = signals.deviceType || 'desktop'; // mobile | desktop
  const source = signals.trafficSource || 'direct'; // paid | organic | social | direct | referral
  
  return `${device}_${source}`;
}

/**
 * Select a variant for the given segment using epsilon-greedy
 * 80% exploit (best performer), 20% explore (random)
 */
export function selectVariant(shop, segment) {
  const data = JSON.parse(shop.copyVariants || '{"variants":[],"segmentBestVariants":{}}');
  const variants = data.variants.filter(v => v.segment === segment && v.status === 'active');
  
  if (variants.length === 0) {
    // No variants for this segment, return default
    return getDefaultVariant(segment);
  }
  
  const epsilon = 0.2; // 20% exploration rate
  
  if (Math.random() < epsilon) {
    // Explore: Random variant
    return variants[Math.floor(Math.random() * variants.length)];
  } else {
    // Exploit: Best performer for this segment
    const bestVariantId = data.segmentBestVariants[segment];
    const bestVariant = variants.find(v => v.id === bestVariantId);
    
    // If no best variant identified yet, return random
    return bestVariant || variants[Math.floor(Math.random() * variants.length)];
  }
}

/**
 * Track variant performance
 */
export async function trackVariantPerformance(prisma, shopId, variantId, event, revenue = 0) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return;
  
  const data = JSON.parse(shop.copyVariants || '{"variants":[],"segmentBestVariants":{}}');
  const variant = data.variants.find(v => v.id === variantId);
  
  if (!variant) return;
  
  // Update performance metrics
  if (event === 'impression') {
    variant.performance.impressions += 1;
  } else if (event === 'click') {
    variant.performance.clicks += 1;
  } else if (event === 'conversion') {
    variant.performance.conversions += 1;
    variant.performance.revenue += revenue;
  }
  
  // Update best variant for segment if needed
  updateBestVariant(data, variant.segment);
  
  // Save to database
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      copyVariants: JSON.stringify(data),
      lastVariantUpdate: new Date()
    }
  });
  
  console.log(`[Copy Variants] Tracked ${event} for variant ${variantId}`);
}

/**
 * Calculate variant performance score
 * 70% weight on conversion rate, 30% on revenue per impression
 */
function calculatePerformance(variant) {
  const { impressions, clicks, conversions, revenue } = variant.performance;
  
  if (impressions === 0) return 0;
  
  const conversionRate = conversions / impressions;
  const revenuePerImpression = revenue / impressions;
  
  // Normalize RPI to 0-1 scale (assuming max $5 RPI)
  const normalizedRPI = Math.min(revenuePerImpression / 5, 1);
  
  return (conversionRate * 0.7) + (normalizedRPI * 0.3);
}

/**
 * Update best variant for a segment based on performance
 */
function updateBestVariant(data, segment) {
  const variants = data.variants.filter(v => v.segment === segment && v.status === 'active');
  
  if (variants.length === 0) return;
  
  // Find variant with highest performance score
  let bestVariant = variants[0];
  let bestScore = calculatePerformance(bestVariant);
  
  variants.forEach(variant => {
    const score = calculatePerformance(variant);
    if (score > bestScore) {
      bestScore = score;
      bestVariant = variant;
    }
  });
  
  data.segmentBestVariants[segment] = bestVariant.id;
}

/**
 * Retire losing variants
 * Retires if: impressions >= 100 AND performance < 50% of best
 */
export async function retireLosingVariants(prisma, shopId) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return;
  
  const data = JSON.parse(shop.copyVariants || '{"variants":[],"segmentBestVariants":{}}');
  const minImpressions = 100;
  const performanceThreshold = 0.5; // 50% of best performer
  
  const segments = [...new Set(data.variants.map(v => v.segment))];
  let retiredCount = 0;
  
  segments.forEach(segment => {
    const variants = data.variants.filter(v => v.segment === segment && v.status === 'active');
    const scores = variants.map(v => calculatePerformance(v));
    const bestScore = Math.max(...scores);
    
    variants.forEach(variant => {
      if (variant.performance.impressions >= minImpressions) {
        const score = calculatePerformance(variant);
        
        if (score < bestScore * performanceThreshold) {
          variant.status = 'retired';
          retiredCount++;
          console.log(`[Copy Variants] Retired variant ${variant.id} for segment ${segment} (score: ${score.toFixed(3)} vs best: ${bestScore.toFixed(3)})`);
        }
      }
    });
  });
  
  if (retiredCount > 0) {
    await prisma.shop.update({
      where: { id: shopId },
      data: { copyVariants: JSON.stringify(data) }
    });
  }
  
  return retiredCount;
}

/**
 * Get default variant for a segment (fallback)
 */
function getDefaultVariant(segment) {
  return {
    id: `default_${segment}`,
    headline: "Wait! Don't Miss Out ",
    body: "Complete your order now and save!",
    cta: "Get My Discount",
    segment: segment
  };
}

/**
 * Generate initial variants for a shop
 */
export async function initializeCopyVariants(prisma, shopId) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return;
  
  // Check if already initialized
  const existing = JSON.parse(shop.copyVariants || '{"variants":[]}');
  if (existing.variants.length > 0) {
    console.log('[Copy Variants] Already initialized');
    return;
  }
  
  const segments = [
    'mobile_paid', 'mobile_organic', 'mobile_social', 'mobile_direct', 'mobile_referral',
    'desktop_paid', 'desktop_organic', 'desktop_social', 'desktop_direct', 'desktop_referral'
  ];
  
  const variants = [];
  
  segments.forEach(segment => {
    const templates = getTemplatesForSegment(segment);
    templates.forEach((template, index) => {
      variants.push({
        id: `${segment}_var_${index + 1}`,
        segment: segment,
        headline: template.headline,
        body: template.body,
        cta: template.cta,
        performance: {
          impressions: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0
        },
        status: 'active',
        createdAt: new Date().toISOString()
      });
    });
  });
  
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      copyVariants: JSON.stringify({ variants, segmentBestVariants: {} }),
      lastVariantUpdate: new Date()
    }
  });
  
  console.log(`[Copy Variants] Initialized ${variants.length} variants across ${segments.length} segments`);
}

/**
 * Get copy templates for a specific segment
 */
function getTemplatesForSegment(segment) {
  const [device, source] = segment.split('_');
  
  // Mobile templates (shorter, punchier)
  if (device === 'mobile') {
    if (source === 'paid') {
      return [
        { headline: "Limited Time! ", body: "Your exclusive offer expires soon", cta: "Claim Discount" },
        { headline: "Exclusive Deal ", body: "Complete your order & save now", cta: "Get My Offer" },
        { headline: "Smart Shoppers Save ", body: "Don't miss this special discount", cta: "Apply Savings" }
      ];
    } else if (source === 'social') {
      return [
        { headline: "Treat Yourself! ", body: "You deserve this special offer", cta: "Get Deal" },
        { headline: "Perfect Timing! ", body: "Complete your order with savings", cta: "Claim Offer" },
        { headline: "Don't Miss Out! ", body: "Limited deal just for you", cta: "Save Now" }
      ];
    } else {
      return [
        { headline: "Wait! Special Offer ", body: "Complete your order & save", cta: "Get Discount" },
        { headline: "Before You Go... ", body: "Here's an exclusive deal for you", cta: "Claim Savings" },
        { headline: "One More Thing! ", body: "Don't forget your special offer", cta: "Apply Deal" }
      ];
    }
  }
  
  // Desktop templates (more detailed)
  if (device === 'desktop') {
    if (source === 'paid') {
      return [
        { headline: "Exclusive Offer Inside ", body: "You've earned a special discount on your order", cta: "Claim My Discount" },
        { headline: "Limited Time Savings ", body: "Complete your purchase with this exclusive deal", cta: "Get My Offer" },
        { headline: "Special Discount Unlocked ", body: "Apply this offer to your order right now", cta: "Apply Savings" }
      ];
    } else if (source === 'organic' || source === 'direct') {
      return [
        { headline: "Still Deciding? ", body: "Here's a special offer to help you complete your order", cta: "View Discount" },
        { headline: "Welcome Back! ", body: "Complete your order with this exclusive thank-you offer", cta: "Get My Deal" },
        { headline: "Your Exclusive Offer ", body: "Don't miss out on this special discount for your cart", cta: "Claim Offer" }
      ];
    } else {
      return [
        { headline: "Wait! Before You Go... ", body: "Complete your order now and unlock savings", cta: "Get Discount" },
        { headline: "One Last Thing ", body: "Here's an exclusive offer just for you", cta: "Claim Savings" },
        { headline: "Special Offer Available ", body: "Apply this discount to your order today", cta: "Apply Deal" }
      ];
    }
  }
  
  // Fallback
  return [
    { headline: "Wait! Don't Miss Out ", body: "Complete your order now and save", cta: "Get My Discount" }
  ];
}