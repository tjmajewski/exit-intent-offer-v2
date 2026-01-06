import db from '../db.server.js';

/**
 * Detect current season based on date
 */
export function detectCurrentSeason() {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();
  
  // Black Friday / Cyber Monday (week of Thanksgiving)
  if (month === 11 && day >= 20 && day <= 30) {
    return 'blackFriday';
  }
  
  // Holiday Season (Dec 1 - Dec 31)
  if (month === 12) {
    return 'holidaySeason';
  }
  
  // Back to School (Aug 1 - Sep 15)
  if ((month === 8) || (month === 9 && day <= 15)) {
    return 'backToSchool';
  }
  
  // Valentine's Day (Feb 1 - Feb 14)
  if (month === 2 && day <= 14) {
    return 'valentines';
  }
  
  // Spring Sale (Mar 15 - Apr 30)
  if ((month === 3 && day >= 15) || month === 4) {
    return 'springSale';
  }
  
  // Summer Sale (Jun 1 - Jul 31)
  if (month === 6 || month === 7) {
    return 'summerSale';
  }
  
  // Default: regular season
  return 'regular';
}

/**
 * Record variant performance for current season
 */
export async function recordSeasonalPerformance(shopId) {
  const season = detectCurrentSeason();
  
  // Get all conversions from last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const impressions = await db.variantImpression.findMany({
    where: {
      shopId: shopId,
      timestamp: { gte: thirtyDaysAgo }
    }
  });
  
  if (impressions.length < 50) {
    console.log(`[Seasonal] Not enough data yet (${impressions.length} impressions)`);
    return;
  }
  
  // Calculate metrics
  const conversions = impressions.filter(i => i.converted);
  const avgCVR = conversions.length / impressions.length;
  const avgAOV = conversions.reduce((sum, i) => sum + (i.revenue || 0), 0) / conversions.length;
  const avgProfit = conversions.reduce((sum, i) => sum + (i.profit || 0), 0) / impressions.length;
  
  // Find or create seasonal pattern
  const existing = await db.seasonalPattern.findFirst({
    where: {
      shopId: shopId,
      season: season
    }
  });
  
  const seasonData = {
    avgCVR: avgCVR,
    avgAOV: avgAOV || 0,
    avgProfitPerImpression: avgProfit || 0,
    trafficMultiplier: impressions.length / 30 // impressions per day
  };
  
  if (existing) {
    await db.seasonalPattern.update({
      where: { id: existing.id },
      data: seasonData
    });
    console.log(`[Seasonal] Updated ${season}: ${(avgCVR * 100).toFixed(1)}% CVR, $${avgProfit.toFixed(2)} profit/imp`);
  } else {
    await db.seasonalPattern.create({
      data: {
        shopId: shopId,
        season: season,
        startDate: new Date(),
        endDate: new Date(), // Will be updated
        ...seasonData
      }
    });
    console.log(`[Seasonal] Created pattern for ${season}`);
  }
}

/**
 * Get recommended genes for current season
 */
export async function getSeasonalRecommendations(shopId) {
  const season = detectCurrentSeason();
  
  const pattern = await db.seasonalPattern.findFirst({
    where: {
      shopId: shopId,
      season: season
    }
  });
  
  if (!pattern) {
    return null; // No historical data for this season
  }
  
  return {
    season: season,
    offerAmounts: JSON.parse(pattern.recommendedOfferAmounts || '[]'),
    urgency: pattern.recommendedUrgency,
    headlines: JSON.parse(pattern.recommendedHeadlines || '[]'),
    expectedCVR: pattern.avgCVR,
    expectedProfit: pattern.avgProfitPerImpression
  };
}

/**
 * Analyze top-performing genes during a season and save recommendations
 */
export async function analyzeSeasonalGenes(shopId, season) {
  // Get all variants that performed during this season
  const seasonStart = getSeasonStartDate(season);
  const seasonEnd = getSeasonEndDate(season);
  
  const impressions = await db.variantImpression.findMany({
    where: {
      shopId: shopId,
      timestamp: {
        gte: seasonStart,
        lte: seasonEnd
      },
      converted: true
    },
    include: {
      variant: true
    }
  });
  
  if (impressions.length < 20) {
    return; // Not enough conversions to analyze
  }
  
  // Find top-performing offer amounts
  const offerPerformance = {};
  impressions.forEach(imp => {
    const amount = imp.variant.offerAmount;
    if (!offerPerformance[amount]) {
      offerPerformance[amount] = { count: 0, profit: 0 };
    }
    offerPerformance[amount].count++;
    offerPerformance[amount].profit += imp.profit || 0;
  });
  
  const topOffers = Object.entries(offerPerformance)
    .map(([amount, data]) => ({
      amount: parseInt(amount),
      avgProfit: data.profit / data.count
    }))
    .sort((a, b) => b.avgProfit - a.avgProfit)
    .slice(0, 3)
    .map(o => o.amount);
  
  // Find top-performing headlines
  const headlinePerformance = {};
  impressions.forEach(imp => {
    const headline = imp.variant.headline;
    if (!headlinePerformance[headline]) {
      headlinePerformance[headline] = { count: 0, profit: 0 };
    }
    headlinePerformance[headline].count++;
    headlinePerformance[headline].profit += imp.profit || 0;
  });
  
  const topHeadlines = Object.entries(headlinePerformance)
    .filter(([_, data]) => data.count >= 5) // Minimum 5 conversions
    .map(([headline, data]) => ({
      headline,
      avgProfit: data.profit / data.count
    }))
    .sort((a, b) => b.avgProfit - a.avgProfit)
    .slice(0, 5)
    .map(h => h.headline);
  
  // Check if urgency helped
  const withUrgency = impressions.filter(i => i.variant.urgency);
  const withoutUrgency = impressions.filter(i => !i.variant.urgency);
  const urgencyProfit = withUrgency.reduce((sum, i) => sum + (i.profit || 0), 0) / withUrgency.length;
  const noUrgencyProfit = withoutUrgency.reduce((sum, i) => sum + (i.profit || 0), 0) / withoutUrgency.length;
  const recommendUrgency = urgencyProfit > noUrgencyProfit;
  
  // Update pattern with recommendations
  await db.seasonalPattern.updateMany({
    where: {
      shopId: shopId,
      season: season
    },
    data: {
      recommendedOfferAmounts: JSON.stringify(topOffers),
      recommendedUrgency: recommendUrgency,
      recommendedHeadlines: JSON.stringify(topHeadlines)
    }
  });
  
  console.log(`[Seasonal] Analyzed ${season}:`);
  console.log(`  Top offers: ${topOffers.join(', ')}`);
  console.log(`  Urgency: ${recommendUrgency ? 'Yes' : 'No'}`);
  console.log(`  Top headlines: ${topHeadlines.length} saved`);
}

function getSeasonStartDate(season) {
  const year = new Date().getFullYear();
  const seasonDates = {
    blackFriday: new Date(year, 10, 20), // Nov 20
    holidaySeason: new Date(year, 11, 1), // Dec 1
    backToSchool: new Date(year, 7, 1), // Aug 1
    valentines: new Date(year, 1, 1), // Feb 1
    springSale: new Date(year, 2, 15), // Mar 15
    summerSale: new Date(year, 5, 1), // Jun 1
    regular: new Date(year, 0, 1) // Jan 1
  };
  return seasonDates[season] || new Date(year, 0, 1);
}

function getSeasonEndDate(season) {
  const year = new Date().getFullYear();
  const seasonDates = {
    blackFriday: new Date(year, 10, 30), // Nov 30
    holidaySeason: new Date(year, 11, 31), // Dec 31
    backToSchool: new Date(year, 8, 15), // Sep 15
    valentines: new Date(year, 1, 14), // Feb 14
    springSale: new Date(year, 3, 30), // Apr 30
    summerSale: new Date(year, 6, 31), // Jul 31
    regular: new Date(year, 11, 31) // Dec 31
  };
  return seasonDates[season] || new Date(year, 11, 31);
}
